package billingoperatorpostgres_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingcustomer"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingoperator"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingprojection"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/authn"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingaccesspostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingcustomerpostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingoperatorpostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/pgtest"
	billingoperatorhttp "github.com/Mujhtech/mosaic/apps/api/internal/transport/billingoperator"
)

// These tests cover the guarantees that only exist once a real browser-session
// principal reaches real SQL, and that a unit test with a fake repository would
// report as passing while the shipped surface was wrong:
//
//   - the operator surface is permission-checked server-side (plan §15), at the
//     owner/admin bar the 9A billing operator pages use, and it does not leak
//     across Projects or Environments;
//   - the customer lookup is structurally incapable of creating anything, which
//     is the whole reason it is not the trusted create-or-get identify call;
//   - conflict resolution requires a reason, audits it, and reprojects both
//     candidates — the loser included, because the loser is the one holding a
//     committed snapshot that still grants the disputed purchase (OD-10);
//   - no operator response carries an alias value or an alias digest.
//
// Column mapping, cursor encoding, and view construction are not tested here:
// they are either exercised through these paths or are not risks worth a
// database round trip.

func testPool(t *testing.T) (*pgxpool.Pool, context.Context) {
	t.Helper()
	databaseURL := os.Getenv("DATABASE_TEST_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_TEST_URL is required for PostgreSQL integration tests")
	}

	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	if err := pgtest.Migrate(db, 0); err != nil {
		t.Fatal(err)
	}
	// The assertion clock starts after the schema is up: a deadline
	// created before migration is spent by migration.
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	t.Cleanup(cancel)
	_ = db.Close()

	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool, ctx
}

// recordingReprojector stands in for the projection service. The operator
// surface must be able to prove it *asked* for a recomputation; running one is
// the projection module's own tested behaviour.
type recordingReprojector struct {
	scopes   []billingprojection.Scope
	failures int
}

func (r *recordingReprojector) Enqueue(_ context.Context, scope billingprojection.Scope, _ string) error {
	r.scopes = append(r.scopes, scope)
	if r.failures > 0 {
		r.failures--
		return errors.New("injected projection enqueue failure")
	}
	return nil
}

type tenant struct {
	organizationID string
	projectID      string
	environmentID  string
	applicationID  string
	ownerActor     string
	memberActor    string
	firstCustomer  string
	secondCustomer string
	lineageID      string
	conflictID     string
	// applicationUserValue and installationValue are the raw identifiers. They
	// exist only in the test: Mosaic stores their digests.
	applicationUserValue string
	installationValue    string
}

func seedTenant(t *testing.T, ctx context.Context, pool *pgxpool.Pool, suffix string) tenant {
	t.Helper()
	now := time.Now().UTC()
	scope := tenant{
		organizationID:       "org_op_" + suffix,
		projectID:            "proj_op_" + suffix,
		environmentID:        "env_op_" + suffix,
		applicationID:        "app_op_" + suffix,
		ownerActor:           "actor_op_owner_" + suffix,
		memberActor:          "actor_op_member_" + suffix,
		firstCustomer:        "bcu_op_" + suffix + "_a",
		secondCustomer:       "bcu_op_" + suffix + "_b",
		lineageID:            "bpl_op_" + suffix,
		conflictID:           "bic_op_" + suffix,
		applicationUserValue: "user-" + suffix + "-secret-value",
		installationValue:    "install-" + suffix + "-secret-value",
	}
	cleanupTenant(ctx, pool, scope)

	aliasDigest := billingcustomer.AliasDigest(billingcustomer.AliasApplicationUser, scope.applicationUserValue)
	installationDigest := billingcustomer.AliasDigest(billingcustomer.AliasInstallation, scope.installationValue)
	lineageKey := billingcustomer.AliasDigest("lineage", scope.lineageID)

	statements := []struct {
		query string
		args  []any
	}{
		{`INSERT INTO organizations(id,name,created_at,updated_at) VALUES ($1,'Operator Test',$2,$2)
		  ON CONFLICT (id) DO NOTHING`, []any{scope.organizationID, now}},
		{`INSERT INTO organization_members(organization_id,actor_id,role,created_at,updated_at)
		  VALUES ($1,$2,'owner',$3,$3) ON CONFLICT (organization_id,actor_id) DO UPDATE SET role='owner'`,
			[]any{scope.organizationID, scope.ownerActor, now}},
		{`INSERT INTO organization_members(organization_id,actor_id,role,created_at,updated_at)
		  VALUES ($1,$2,'member',$3,$3) ON CONFLICT (organization_id,actor_id) DO UPDATE SET role='member'`,
			[]any{scope.organizationID, scope.memberActor, now}},
		{`INSERT INTO projects(id,organization_id,key,name,status,created_at,updated_at)
		  VALUES ($1,$2,$3,'Operator','active',$4,$4) ON CONFLICT (id) DO NOTHING`,
			[]any{scope.projectID, scope.organizationID, "operator-" + suffix, now}},
		{`INSERT INTO billing_project_settings(project_id,billing_enabled,updated_by_actor_id,created_at,updated_at)
		  VALUES ($1,true,'seed',$2,$2) ON CONFLICT (project_id) DO UPDATE SET billing_enabled=true`,
			[]any{scope.projectID, now}},
		{`INSERT INTO environments(id,project_id,key,name,mode,created_at,updated_at)
		  VALUES ($1,$2,'production','Production','production',$3,$3) ON CONFLICT (id) DO NOTHING`,
			[]any{scope.environmentID, scope.projectID, now}},
		{`INSERT INTO applications(id,project_id,name,platform,identifier,created_at,updated_at)
		  VALUES ($1,$2,'Operator App','ios',$3,$4,$4) ON CONFLICT (id) DO NOTHING`,
			[]any{scope.applicationID, scope.projectID, "com.mosaic.operator." + suffix, now}},
		{`INSERT INTO billing_customers(id,project_id,status,diagnostics_status,created_at,updated_at)
		  VALUES ($1,$2,'active','none',$3,$3) ON CONFLICT (id) DO NOTHING`,
			[]any{scope.firstCustomer, scope.projectID, now}},
		{`INSERT INTO billing_customers(id,project_id,status,diagnostics_status,created_at,updated_at)
		  VALUES ($1,$2,'active','none',$3,$3) ON CONFLICT (id) DO NOTHING`,
			[]any{scope.secondCustomer, scope.projectID, now}},
		{`INSERT INTO billing_customer_aliases(id,project_id,billing_customer_id,alias_type,alias_digest,
			source_authority,verification_status,effective_start,created_at)
		  VALUES ($1,$2,$3,'application_user_id',$4,'trusted_server','verified',$5,$5)`,
			[]any{"bca_op_" + suffix, scope.projectID, scope.firstCustomer, aliasDigest, now}},
		{`INSERT INTO billing_association_evidence(id,project_id,environment_id,evidence_type,evidence_digest,
			billing_customer_id,resolver_version,outcome,diagnostic_code,observed_at,created_at)
		  VALUES ($1,$2,$3,'installation_observation',$4,$5,1,'unsupported','installation_is_evidence_only',$6,$6)`,
			[]any{"bae_op_" + suffix, scope.projectID, scope.environmentID, installationDigest,
				scope.firstCustomer, now}},
		// A frozen lineage the conflict disputes: the incumbent is the first
		// customer, the challenger the second.
		{`INSERT INTO purchase_lineages(id,project_id,environment_id,environment_mode,application_id,provider,
			store_environment,lineage_key_digest,lineage_type,billing_customer_id,projection_frozen,
			diagnostic_status,created_at,updated_at)
		  VALUES ($1,$2,$3,'production',$4,'app_store','production',$5,'subscription',$6,true,
			'identity_conflict',$7,$7)`,
			[]any{scope.lineageID, scope.projectID, scope.environmentID, scope.applicationID,
				lineageKey, scope.firstCustomer, now}},
		{`INSERT INTO billing_identity_conflicts(id,project_id,conflict_scope,purchase_lineage_id,status,
			first_customer_id,second_customer_id,detail,opened_at)
		  VALUES ($1,$2,'lineage',$3,'open',$4,$5,
			jsonb_build_object('diagnosticCode','reassignment_requires_operator_resolution'),$6)`,
			[]any{scope.conflictID, scope.projectID, scope.lineageID,
				scope.firstCustomer, scope.secondCustomer, now}},
	}
	for _, statement := range statements {
		if _, err := pool.Exec(ctx, statement.query, statement.args...); err != nil {
			t.Fatalf("seed operator tenant: %v", err)
		}
	}
	t.Cleanup(func() { cleanupTenant(context.Background(), pool, scope) })
	return scope
}

func cleanupTenant(ctx context.Context, pool *pgxpool.Pool, scope tenant) {
	// Association evidence carries an append-only trigger, disabled for teardown
	// of test data only. No code path under test touches the trigger.
	_, _ = pool.Exec(ctx,
		`ALTER TABLE billing_association_evidence DISABLE TRIGGER billing_association_evidence_append_only`)
	for _, statement := range []string{
		`DELETE FROM audit_events WHERE project_id=$1`,
		`DELETE FROM billing_identity_conflicts WHERE project_id=$1`,
		`DELETE FROM billing_association_evidence WHERE project_id=$1`,
		`DELETE FROM billing_customer_aliases WHERE project_id=$1`,
		`DELETE FROM restore_sync_jobs WHERE project_id=$1`,
		`DELETE FROM purchase_lineages WHERE project_id=$1`,
		`DELETE FROM billing_customers WHERE project_id=$1`,
	} {
		_, _ = pool.Exec(ctx, statement, scope.projectID)
	}
	_, _ = pool.Exec(ctx,
		`ALTER TABLE billing_association_evidence ENABLE TRIGGER billing_association_evidence_append_only`)
	_, _ = pool.Exec(ctx, `DELETE FROM environments WHERE project_id=$1`, scope.projectID)
	_, _ = pool.Exec(ctx, `DELETE FROM applications WHERE project_id=$1`, scope.projectID)
	_, _ = pool.Exec(ctx, `DELETE FROM billing_project_settings WHERE project_id=$1`, scope.projectID)
	_, _ = pool.Exec(ctx, `DELETE FROM projects WHERE id=$1`, scope.projectID)
	_, _ = pool.Exec(ctx, `DELETE FROM organization_members WHERE organization_id=$1`, scope.organizationID)
	_, _ = pool.Exec(ctx, `DELETE FROM organizations WHERE id=$1`, scope.organizationID)
}

// surface mounts the operator routes exactly as the router does: inside the
// principal middleware, under /v1/projects/{projectId}. Testing through the
// HTTP boundary is what proves the *shipped* authorization, because the defect
// this batch corrects was a routing mistake — the service was always right,
// and the routes were registered where no browser session could reach them.
type surface struct {
	handler     http.Handler
	reprojector *recordingReprojector
	actorID     *string
}

func newSurface(t *testing.T, pool *pgxpool.Pool) *surface {
	t.Helper()
	reprojector := &recordingReprojector{}
	identity := billingcustomer.NewService(billingcustomerpostgres.New(pool), nil, reprojector)
	service := billingoperator.NewService(
		billingoperatorpostgres.New(pool), billingaccesspostgres.New(pool), identity)

	actorID := ""
	router := chi.NewRouter()
	router.Use(authn.Middleware(authn.ResolverFunc(func(*http.Request) (authn.Principal, error) {
		if actorID == "" {
			return authn.Principal{}, authn.ErrUnauthenticated
		}
		return authn.Principal{ActorID: actorID, Method: "browser_session"}, nil
	})))
	router.Route("/v1/projects/{projectId}", func(project chi.Router) {
		billingoperatorhttp.RegisterProjectRoutes(project, service)
		// The Environment-scoped half is registered into a subrouter the
		// composition owns, because three modules publish routes under that one
		// path and chi refuses to Mount() twice on it (defect D-3). This mirrors
		// what httpserver.NewWithDependencies does.
		project.Route("/environments/{environmentId}/billing", func(environment chi.Router) {
			billingoperatorhttp.RegisterEnvironmentRoutes(environment, service)
		})
	})
	return &surface{handler: router, reprojector: reprojector, actorID: &actorID}
}

func (s *surface) as(actorID string) *surface {
	*s.actorID = actorID
	return s
}

func (s *surface) do(t *testing.T, method, path, body string) (int, map[string]any) {
	t.Helper()
	var reader *strings.Reader
	if body == "" {
		reader = strings.NewReader("")
	} else {
		reader = strings.NewReader(body)
	}
	request := httptest.NewRequest(method, path, reader)
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	recorder := httptest.NewRecorder()
	s.handler.ServeHTTP(recorder, request)

	payload := map[string]any{}
	if recorder.Body.Len() > 0 {
		if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
			t.Fatalf("decode %s %s response: %v (%s)", method, path, err, recorder.Body.String())
		}
	}
	return recorder.Code, payload
}

func (s *surface) raw(t *testing.T, method, path, body string) (int, string) {
	t.Helper()
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	recorder := httptest.NewRecorder()
	s.handler.ServeHTTP(recorder, request)
	return recorder.Code, recorder.Body.String()
}

// The dashboard could not reach any 9B customer state before this batch, so the
// risk being protected is that it now reaches *too much*: every route must
// refuse a session that is authenticated but not an owner or admin, and must
// refuse an unauthenticated one, with the standard Mosaic error envelope so the
// dashboard renders a real message rather than a blank failure.
func TestOperatorSurfaceRequiresOwnerOrAdmin(t *testing.T) {
	pool, ctx := testPool(t)
	scope := seedTenant(t, ctx, pool, "authz")
	s := newSurface(t, pool)

	base := "/v1/projects/" + scope.projectID
	environment := base + "/environments/" + scope.environmentID + "/billing"
	routes := []struct {
		method string
		path   string
		body   string
	}{
		{http.MethodGet, environment + "/customers", ""},
		{http.MethodPost, environment + "/customer-lookups",
			`{"identifierType":"application_user_id","identifierValue":"x"}`},
		{http.MethodGet, environment + "/customers/" + scope.firstCustomer, ""},
		{http.MethodGet, environment + "/customers/" + scope.firstCustomer + "/entitlements", ""},
		{http.MethodGet, environment + "/customers/" + scope.firstCustomer + "/subscriptions", ""},
		{http.MethodPost, environment + "/customers/" + scope.firstCustomer + "/sync-requests", ""},
		{http.MethodGet, environment + "/restore-jobs", ""},
		{http.MethodGet, base + "/billing/identity-conflicts", ""},
		{http.MethodGet, base + "/billing/identity-conflicts/" + scope.conflictID, ""},
		{http.MethodPost, base + "/billing/identity-conflicts/" + scope.conflictID + "/resolution",
			`{"action":"keep_existing","reason":"support ticket 12"}`},
	}

	for _, route := range routes {
		status, payload := s.as(scope.memberActor).do(t, route.method, route.path, route.body)
		if status != http.StatusForbidden {
			t.Fatalf("%s %s as member: status %d, want 403", route.method, route.path, status)
		}
		errorPayload, ok := payload["error"].(map[string]any)
		if !ok || errorPayload["code"] != "forbidden" {
			t.Fatalf("%s %s as member: error envelope %v, want code forbidden", route.method, route.path, payload)
		}

		status, _ = s.as("").do(t, route.method, route.path, route.body)
		if status != http.StatusUnauthorized {
			t.Fatalf("%s %s unauthenticated: status %d, want 401", route.method, route.path, status)
		}
	}

	// The owner reaches the same routes. Without this the test would pass on a
	// surface that refused everyone.
	if status, _ := s.as(scope.ownerActor).do(t, http.MethodGet, environment+"/customers", ""); status != http.StatusOK {
		t.Fatalf("owner customer list: status %d, want 200", status)
	}
}

// A member of one Project must not read another's billing state, and pairing a
// Project with an Environment that belongs to someone else must not work
// either — the role check would pass on the first and every subsequent query
// filters on the second. Both are reported as absent rather than forbidden, so
// the surface is not an existence oracle over other tenants.
func TestOperatorSurfaceRefusesCrossProjectAndCrossEnvironment(t *testing.T) {
	pool, ctx := testPool(t)
	first := seedTenant(t, ctx, pool, "xproj1")
	second := seedTenant(t, ctx, pool, "xproj2")
	s := newSurface(t, pool).as(first.ownerActor)

	// First tenant's owner naming the second tenant's Project.
	status, _ := s.do(t, http.MethodGet,
		"/v1/projects/"+second.projectID+"/environments/"+second.environmentID+"/billing/customers", "")
	if status != http.StatusNotFound {
		t.Fatalf("cross-project customer list: status %d, want 404", status)
	}

	// Own Project paired with the other tenant's Environment.
	status, _ = s.do(t, http.MethodGet,
		"/v1/projects/"+first.projectID+"/environments/"+second.environmentID+"/billing/customers", "")
	if status != http.StatusNotFound {
		t.Fatalf("cross-environment customer list: status %d, want 404", status)
	}

	// A customer that exists, in another Project, read through this Project.
	status, _ = s.do(t, http.MethodGet,
		"/v1/projects/"+first.projectID+"/environments/"+first.environmentID+
			"/billing/customers/"+second.firstCustomer, "")
	if status != http.StatusNotFound {
		t.Fatalf("cross-project customer detail: status %d, want 404", status)
	}

	// The other Project's conflict, through this Project.
	status, _ = s.do(t, http.MethodGet,
		"/v1/projects/"+first.projectID+"/billing/identity-conflicts/"+second.conflictID, "")
	if status != http.StatusNotFound {
		t.Fatalf("cross-project conflict detail: status %d, want 404", status)
	}
}

// The trusted identify endpoint is create-or-get: used as a search it would
// mint one Billing Customer per mistyped support query, which is the
// duplicate-customer trap plan §5a exists to avoid. The lookup must therefore
// leave the database byte-for-byte unchanged on a miss, and resolve a hit
// without writing either.
func TestCustomerLookupNeverCreatesAnything(t *testing.T) {
	pool, ctx := testPool(t)
	scope := seedTenant(t, ctx, pool, "lookup")
	s := newSurface(t, pool).as(scope.ownerActor)
	path := "/v1/projects/" + scope.projectID + "/environments/" + scope.environmentID + "/billing/customer-lookups"

	counts := func() (customers, aliases, evidence int) {
		if err := pool.QueryRow(ctx,
			`SELECT (SELECT count(*) FROM billing_customers WHERE project_id=$1),
			        (SELECT count(*) FROM billing_customer_aliases WHERE project_id=$1),
			        (SELECT count(*) FROM billing_association_evidence WHERE project_id=$1)`,
			scope.projectID).Scan(&customers, &aliases, &evidence); err != nil {
			t.Fatalf("count rows: %v", err)
		}
		return
	}
	beforeCustomers, beforeAliases, beforeEvidence := counts()

	// A miss on every identifier type.
	for _, identifierType := range []string{"application_user_id", "installation_id", "billing_customer_id"} {
		status, payload := s.do(t, http.MethodPost, path,
			`{"identifierType":"`+identifierType+`","identifierValue":"nobody-has-this-value"}`)
		if status != http.StatusOK {
			t.Fatalf("lookup miss (%s): status %d, want 200", identifierType, status)
		}
		data, _ := payload["data"].(map[string]any)
		if found, _ := data["found"].(bool); found {
			t.Fatalf("lookup miss (%s): reported a match", identifierType)
		}
	}

	afterCustomers, afterAliases, afterEvidence := counts()
	if afterCustomers != beforeCustomers || afterAliases != beforeAliases || afterEvidence != beforeEvidence {
		t.Fatalf("lookup wrote rows: customers %d->%d, aliases %d->%d, evidence %d->%d",
			beforeCustomers, afterCustomers, beforeAliases, afterAliases, beforeEvidence, afterEvidence)
	}

	// Hits, through the alias digest and through installation evidence.
	for _, hit := range []struct{ identifierType, value string }{
		{"application_user_id", scope.applicationUserValue},
		{"installation_id", scope.installationValue},
		{"billing_customer_id", scope.firstCustomer},
	} {
		status, payload := s.do(t, http.MethodPost, path,
			`{"identifierType":"`+hit.identifierType+`","identifierValue":"`+hit.value+`"}`)
		if status != http.StatusOK {
			t.Fatalf("lookup hit (%s): status %d, want 200", hit.identifierType, status)
		}
		data, _ := payload["data"].(map[string]any)
		customer, _ := data["customer"].(map[string]any)
		if customer["billingCustomerId"] != scope.firstCustomer {
			t.Fatalf("lookup hit (%s): matched %v, want %s", hit.identifierType,
				customer["billingCustomerId"], scope.firstCustomer)
		}
	}

	finalCustomers, finalAliases, finalEvidence := counts()
	if finalCustomers != beforeCustomers || finalAliases != beforeAliases || finalEvidence != beforeEvidence {
		t.Fatalf("lookup wrote rows on a hit: customers %d->%d, aliases %d->%d, evidence %d->%d",
			beforeCustomers, finalCustomers, beforeAliases, finalAliases, beforeEvidence, finalEvidence)
	}
}

// OD-10: resolution is an explicit, justified, audited operator action, and it
// must reproject *both* candidates. Reprojecting only the winner is the
// stale-grant defect review finding I-10 named: the loser keeps a committed
// snapshot that still grants the purchase it no longer holds.
func TestConflictResolutionRequiresReasonAuditsAndReprojectsBothCandidates(t *testing.T) {
	pool, ctx := testPool(t)
	scope := seedTenant(t, ctx, pool, "resolve")
	s := newSurface(t, pool).as(scope.ownerActor)
	path := "/v1/projects/" + scope.projectID + "/billing/identity-conflicts/" + scope.conflictID + "/resolution"

	// A resolution without a reason is refused, and the conflict stays open.
	status, _ := s.do(t, http.MethodPost, path, `{"action":"reassign_to_candidate"}`)
	if status != http.StatusUnprocessableEntity {
		t.Fatalf("resolution without a reason: status %d, want 422", status)
	}
	var openStatus string
	if err := pool.QueryRow(ctx, `SELECT status FROM billing_identity_conflicts WHERE id=$1`,
		scope.conflictID).Scan(&openStatus); err != nil {
		t.Fatalf("read conflict: %v", err)
	}
	if openStatus != "open" {
		t.Fatalf("conflict status after refused resolution: %q, want open", openStatus)
	}

	status, payload := s.do(t, http.MethodPost, path,
		`{"action":"reassign_to_candidate","reason":"support ticket 4412: receipts belong to the second account"}`)
	if status != http.StatusOK {
		t.Fatalf("resolution: status %d, want 200 (%v)", status, payload)
	}
	data, _ := payload["data"].(map[string]any)
	if data["status"] != "resolved" || data["resolutionAction"] != billingoperator.ActionReassign {
		t.Fatalf("resolved conflict: %v", data)
	}

	// The lineage is unfrozen and moved to the challenger.
	var frozen bool
	var owner string
	if err := pool.QueryRow(ctx,
		`SELECT projection_frozen, COALESCE(billing_customer_id,'') FROM purchase_lineages WHERE id=$1`,
		scope.lineageID).Scan(&frozen, &owner); err != nil {
		t.Fatalf("read lineage: %v", err)
	}
	if frozen {
		t.Fatal("lineage is still frozen after resolution")
	}
	if owner != scope.secondCustomer {
		t.Fatalf("lineage owner after reassignment: %q, want %s", owner, scope.secondCustomer)
	}

	// The reason is on the audit event, which is what an investigation reads.
	var auditReason string
	if err := pool.QueryRow(ctx,
		`SELECT COALESCE(metadata->>'reason','') FROM audit_events
		  WHERE project_id=$1 AND action='billing.identity_conflict.resolved'`,
		scope.projectID).Scan(&auditReason); err != nil {
		t.Fatalf("read audit event: %v", err)
	}
	if !strings.Contains(auditReason, "support ticket 4412") {
		t.Fatalf("audit reason %q does not record the operator's justification", auditReason)
	}

	// Both candidates were reprojected.
	reprojected := map[string]bool{}
	for _, enqueued := range s.reprojector.scopes {
		reprojected[enqueued.CustomerID] = true
	}
	if !reprojected[scope.firstCustomer] || !reprojected[scope.secondCustomer] {
		t.Fatalf("reprojection scopes %v: both candidates must be recomputed", s.reprojector.scopes)
	}
}

// The conflict row and lineage reassignment commit before projection enqueue.
// If the queue is transiently unavailable, repeating the exact operator action
// must finish both aggregates rather than reject the already-resolved conflict
// and leave the previous customer with a stale grant.
func TestConflictResolutionRetryAfterReprojectorFailureConverges(t *testing.T) {
	pool, ctx := testPool(t)
	scope := seedTenant(t, ctx, pool, "resolve_retry")
	s := newSurface(t, pool).as(scope.ownerActor)
	s.reprojector.failures = 1
	path := "/v1/projects/" + scope.projectID + "/billing/identity-conflicts/" + scope.conflictID + "/resolution"
	body := `{"action":"reassign_to_candidate","reason":"support ticket 5519: verified store ownership"}`

	status, _ := s.do(t, http.MethodPost, path, body)
	if status != http.StatusServiceUnavailable {
		t.Fatalf("first resolution status = %d, want 503", status)
	}
	status, payload := s.do(t, http.MethodPost, path, body)
	if status != http.StatusOK {
		t.Fatalf("retry resolution status = %d, want 200 (%v)", status, payload)
	}

	reprojected := map[string]bool{}
	for _, scope := range s.reprojector.scopes {
		reprojected[scope.CustomerID] = true
	}
	if !reprojected[scope.firstCustomer] || !reprojected[scope.secondCustomer] {
		t.Fatalf("retry projections = %v, want both candidates", s.reprojector.scopes)
	}
}

// Aliases are the erasable PII surface — the person-to-purchase link — and an
// alias digest is still a stable per-person identifier. Neither the raw value
// nor its digest may appear in any operator response, however the page is
// reached.
func TestOperatorResponsesNeverCarryAliasValuesOrDigests(t *testing.T) {
	pool, ctx := testPool(t)
	scope := seedTenant(t, ctx, pool, "privacy")
	s := newSurface(t, pool).as(scope.ownerActor)

	digestHex := hexOf(billingcustomer.AliasDigest(billingcustomer.AliasApplicationUser, scope.applicationUserValue))
	installationHex := hexOf(billingcustomer.AliasDigest(billingcustomer.AliasInstallation, scope.installationValue))

	base := "/v1/projects/" + scope.projectID
	environment := base + "/environments/" + scope.environmentID + "/billing"
	responses := []struct {
		method, path, body string
	}{
		{http.MethodGet, environment + "/customers", ""},
		{http.MethodGet, environment + "/customers/" + scope.firstCustomer, ""},
		{http.MethodPost, environment + "/customer-lookups",
			`{"identifierType":"application_user_id","identifierValue":"` + scope.applicationUserValue + `"}`},
		{http.MethodGet, base + "/billing/identity-conflicts", ""},
		{http.MethodGet, base + "/billing/identity-conflicts/" + scope.conflictID, ""},
	}
	for _, call := range responses {
		status, body := s.raw(t, call.method, call.path, call.body)
		if status != http.StatusOK {
			t.Fatalf("%s %s: status %d, want 200 (%s)", call.method, call.path, status, body)
		}
		for _, forbidden := range []string{
			scope.applicationUserValue, scope.installationValue, digestHex, installationHex,
		} {
			if strings.Contains(body, forbidden) {
				t.Fatalf("%s %s leaked %q into the response body", call.method, call.path, forbidden)
			}
		}
	}
}

func hexOf(digest []byte) string {
	const alphabet = "0123456789abcdef"
	out := make([]byte, 0, len(digest)*2)
	for _, b := range digest {
		out = append(out, alphabet[b>>4], alphabet[b&0x0f])
	}
	return string(out)
}
