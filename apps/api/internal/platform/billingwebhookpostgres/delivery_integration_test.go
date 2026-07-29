package billingwebhookpostgres

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingwebhook"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/authn"
	billingwebhookhttp "github.com/Mujhtech/mosaic/apps/api/internal/transport/billingwebhook"
	"github.com/Mujhtech/mosaic/apps/api/migrations"
)

// Webhook delivery end-to-end persistence behaviour.
//
// Every guarantee exercised here lives in the schema and in the transaction
// boundaries around it — the (event, destination) uniqueness that makes a
// logical delivery singular, SELECT ... FOR UPDATE SKIP LOCKED under a real
// concurrent claim, the attempt-number uniqueness that makes history readable,
// and the stored event body that a replay re-sends unchanged. A unit test with
// a fake repository would pass with all four broken, because the database is
// the thing under test.

func testPool(t *testing.T) (*pgxpool.Pool, context.Context) {
	t.Helper()
	databaseURL := os.Getenv("DATABASE_TEST_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_TEST_URL is required for PostgreSQL integration tests")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	t.Cleanup(cancel)

	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	goose.SetBaseFS(migrations.Files)
	if err := goose.SetDialect("postgres"); err != nil {
		t.Fatal(err)
	}
	if err := goose.UpContext(ctx, db, "."); err != nil {
		t.Fatalf("apply migrations: %v", err)
	}
	_ = db.Close()

	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool, ctx
}

// fixture is one tenant with one active destination and one committed event
// ready to fan out.
type fixture struct {
	projectID     string
	environmentID string
	destinationID string
	eventID       string
	payload       string
	ownerActor    string
	adminActor    string
	memberActor   string
}

func seedWebhookFixture(t *testing.T, ctx context.Context, pool *pgxpool.Pool, suffix string) fixture {
	t.Helper()
	now := time.Now().UTC()
	f := fixture{
		projectID:     "proj_whd_" + suffix,
		environmentID: "env_whd_" + suffix,
		destinationID: "whd_" + suffix,
		eventID:       "whe_" + suffix,
		payload:       `{"eventId": "whe_` + suffix + `", "eventType": "customer.entitlements.changed"}`,
		ownerActor:    "actor_whd_owner_" + suffix,
		adminActor:    "actor_whd_admin_" + suffix,
		memberActor:   "actor_whd_member_" + suffix,
	}
	organizationID := "org_whd_" + suffix
	customerID := "bcus_whd_" + suffix
	snapshotID := "ces_whd_" + suffix

	cleanupWebhookFixture(ctx, pool, f, organizationID)
	statements := []struct {
		query string
		args  []any
	}{
		{`INSERT INTO organizations(id,name,created_at,updated_at) VALUES ($1,'Webhook Test',$2,$2)
		  ON CONFLICT (id) DO NOTHING`, []any{organizationID, now}},
		{`INSERT INTO projects(id,organization_id,key,name,status,created_at,updated_at)
		  VALUES ($1,$2,$3,'Webhook','active',$4,$4) ON CONFLICT (id) DO NOTHING`,
			[]any{f.projectID, organizationID, "webhook-" + suffix, now}},
		{`INSERT INTO organization_members(organization_id,actor_id,role,created_at,updated_at)
		  VALUES ($1,$2,'owner',$5,$5),($1,$3,'admin',$5,$5),($1,$4,'member',$5,$5)`,
			[]any{organizationID, f.ownerActor, f.adminActor, f.memberActor, now}},
		{`INSERT INTO environments(id,project_id,key,name,mode,created_at,updated_at)
		  VALUES ($1,$2,'production','Production','production',$3,$3) ON CONFLICT (id) DO NOTHING`,
			[]any{f.environmentID, f.projectID, now}},
		{`INSERT INTO billing_project_settings(project_id,billing_enabled,updated_by_actor_id,created_at,updated_at)
		  VALUES ($1,true,'seed',$2,$2) ON CONFLICT (project_id) DO UPDATE SET billing_enabled=true`,
			[]any{f.projectID, now}},
		{`INSERT INTO webhook_destinations(id,project_id,environment_id,url,status,created_at,updated_at)
		  VALUES ($1,$2,$3,'https://receiver.example.com/mosaic','active',$4,$4)`,
			[]any{f.destinationID, f.projectID, f.environmentID, now}},
		{`INSERT INTO billing_customers(id,project_id,created_at,updated_at) VALUES ($1,$2,$3,$3)`,
			[]any{customerID, f.projectID, now}},
		{`INSERT INTO customer_entitlement_snapshots(id,project_id,environment_id,billing_customer_id,
			snapshot_version,rule_version,computed_at,as_of,checksum,change_reason,created_at)
		  VALUES ($1,$2,$3,$4,1,1,$5,$5,sha256('snapshot'::bytea),'initial',$5)`,
			[]any{snapshotID, f.projectID, f.environmentID, customerID, now}},
		// The event is committed exactly as the projection transaction writes
		// it: immutable, with the payload the delivery will send verbatim.
		{`INSERT INTO webhook_events(id,project_id,environment_id,event_type,billing_customer_id,
			customer_entitlement_snapshot_id,snapshot_version,payload,occurred_at,created_at)
		  VALUES ($1,$2,$3,'customer.entitlements.changed',$4,$5,1,$6::jsonb,$7,$7)`,
			[]any{f.eventID, f.projectID, f.environmentID, customerID, snapshotID, f.payload, now}},
	}
	for _, statement := range statements {
		if _, err := pool.Exec(ctx, statement.query, statement.args...); err != nil {
			t.Fatalf("seed webhook fixture: %v", err)
		}
	}
	t.Cleanup(func() {
		cleanupContext, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		cleanupWebhookFixture(cleanupContext, pool, f, organizationID)
	})
	return f
}

// cleanupWebhookFixture removes the fixture in dependency order. Events,
// attempts, and snapshots carry append-only triggers, so they are cleared with
// a session-level trigger disable rather than by weakening the schema.
func cleanupWebhookFixture(ctx context.Context, pool *pgxpool.Pool, f fixture, organizationID string) {
	for _, statement := range []string{
		`ALTER TABLE webhook_events DISABLE TRIGGER webhook_events_append_only`,
		`ALTER TABLE webhook_delivery_attempts DISABLE TRIGGER webhook_delivery_attempts_append_only`,
		`ALTER TABLE customer_entitlement_snapshots DISABLE TRIGGER customer_entitlement_snapshots_append_only`,
	} {
		_, _ = pool.Exec(ctx, statement)
	}
	for _, statement := range []string{
		`DELETE FROM webhook_delivery_attempts WHERE project_id=$1`,
		`DELETE FROM webhook_event_fanouts WHERE project_id=$1`,
		`DELETE FROM webhook_deliveries WHERE project_id=$1`,
		`DELETE FROM webhook_events WHERE project_id=$1`,
		`DELETE FROM webhook_signing_secrets WHERE project_id=$1`,
		`DELETE FROM webhook_destinations WHERE project_id=$1`,
		`DELETE FROM customer_entitlement_snapshots WHERE project_id=$1`,
		`DELETE FROM billing_customers WHERE project_id=$1`,
		`DELETE FROM audit_events WHERE project_id=$1`,
		`DELETE FROM billing_project_settings WHERE project_id=$1`,
		`DELETE FROM environments WHERE project_id=$1`,
		`DELETE FROM projects WHERE id=$1`,
	} {
		_, _ = pool.Exec(ctx, statement, f.projectID)
	}
	_, _ = pool.Exec(ctx, `DELETE FROM organization_members WHERE organization_id=$1`, organizationID)
	_, _ = pool.Exec(ctx, `DELETE FROM organizations WHERE id=$1`, organizationID)
	for _, statement := range []string{
		`ALTER TABLE webhook_events ENABLE TRIGGER webhook_events_append_only`,
		`ALTER TABLE webhook_delivery_attempts ENABLE TRIGGER webhook_delivery_attempts_append_only`,
		`ALTER TABLE customer_entitlement_snapshots ENABLE TRIGGER customer_entitlement_snapshots_append_only`,
	} {
		_, _ = pool.Exec(ctx, statement)
	}
}

type authorizationSurface struct {
	handler http.Handler
	actorID *string
}

func newAuthorizationSurface(pool *pgxpool.Pool) *authorizationSurface {
	service := billingwebhook.NewService(New(pool), nil, nil)
	actorID := ""
	router := chi.NewRouter()
	router.Use(authn.Middleware(authn.ResolverFunc(func(*http.Request) (authn.Principal, error) {
		if actorID == "" {
			return authn.Principal{}, authn.ErrUnauthenticated
		}
		return authn.Principal{ActorID: actorID, Method: "browser_session"}, nil
	})))
	router.Route("/v1/projects/{projectId}", func(project chi.Router) {
		billingwebhookhttp.RegisterProjectRoutes(project, service)
		project.Route("/environments/{environmentId}/billing", func(environment chi.Router) {
			billingwebhookhttp.RegisterEnvironmentRoutes(environment, service)
		})
	})
	return &authorizationSurface{handler: router, actorID: &actorID}
}

func (s *authorizationSurface) as(actorID string) *authorizationSurface {
	*s.actorID = actorID
	return s
}

func (s *authorizationSurface) do(t *testing.T, method, path, body string) (int, map[string]any) {
	t.Helper()
	request := httptest.NewRequest(method, path, strings.NewReader(body))
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

// Billing webhook destinations and delivery history carry authoritative
// entitlement state. This integration test proves the shipped HTTP surface
// reaches the PostgreSQL membership boundary on every management family: an
// authenticated member cannot read or mutate them, a missing session is 401,
// and owner/admin sessions still reach the data.
func TestManagementSurfaceRequiresOwnerOrAdmin(t *testing.T) {
	pool, ctx := testPool(t)
	f := seedWebhookFixture(t, ctx, pool, "authz")
	repository := New(pool)
	if _, err := repository.FanOut(ctx, time.Now().UTC(), 10); err != nil {
		t.Fatal(err)
	}
	var deliveryID string
	if err := pool.QueryRow(ctx,
		`SELECT id FROM webhook_deliveries WHERE project_id=$1 AND webhook_destination_id=$2`,
		f.projectID, f.destinationID).Scan(&deliveryID); err != nil {
		t.Fatal(err)
	}

	surface := newAuthorizationSurface(pool)
	base := "/v1/projects/" + f.projectID
	environment := base + "/environments/" + f.environmentID + "/billing"
	routes := []struct{ method, path, body string }{
		{http.MethodGet, environment + "/webhook-destinations/", ""},
		{http.MethodPost, environment + "/webhook-destinations/", `{"url":"https://receiver.example.com/second"}`},
		{http.MethodGet, base + "/billing/webhook-destinations/" + f.destinationID + "/", ""},
		{http.MethodPatch, base + "/billing/webhook-destinations/" + f.destinationID + "/", `{"description":"changed"}`},
		{http.MethodPost, base + "/billing/webhook-destinations/" + f.destinationID + "/status", `{"status":"paused"}`},
		{http.MethodDelete, base + "/billing/webhook-destinations/" + f.destinationID + "/", ""},
		{http.MethodGet, base + "/billing/webhook-destinations/" + f.destinationID + "/secrets", ""},
		{http.MethodPost, base + "/billing/webhook-destinations/" + f.destinationID + "/secrets/rotate", ""},
		{http.MethodPost, base + "/billing/webhook-destinations/" + f.destinationID + "/secrets/secret/retire", ""},
		{http.MethodGet, base + "/billing/webhook-deliveries/", ""},
		{http.MethodGet, base + "/billing/webhook-deliveries/" + deliveryID, ""},
		{http.MethodGet, base + "/billing/webhook-deliveries/" + deliveryID + "/attempts", ""},
		{http.MethodPost, base + "/billing/webhook-deliveries/" + deliveryID + "/replay", ""},
	}
	for _, route := range routes {
		status, payload := surface.as(f.memberActor).do(t, route.method, route.path, route.body)
		if status != http.StatusForbidden {
			t.Fatalf("%s %s as member: status %d payload %v, want 403", route.method, route.path, status, payload)
		}
		status, payload = surface.as("").do(t, route.method, route.path, route.body)
		if status != http.StatusUnauthorized {
			t.Fatalf("%s %s unauthenticated: status %d payload %v, want 401", route.method, route.path, status, payload)
		}
	}

	if status, _ := surface.as(f.ownerActor).do(t, http.MethodGet,
		environment+"/webhook-destinations/", ""); status != http.StatusOK {
		t.Fatalf("owner destination list: status %d, want 200", status)
	}
	if status, _ := surface.as(f.adminActor).do(t, http.MethodGet,
		base+"/billing/webhook-deliveries/"+deliveryID, ""); status != http.StatusOK {
		t.Fatalf("admin delivery read: status %d, want 200", status)
	}
}

// Cross-tenant failures are deliberately 404, not 403, and an Environment
// cannot be paired with a different Project. These checks catch both the
// existence-oracle regression and the environment-filter bug where a foreign
// Environment previously produced a misleading successful empty list.
func TestManagementSurfaceDoesNotCrossProjectOrEnvironment(t *testing.T) {
	pool, ctx := testPool(t)
	first := seedWebhookFixture(t, ctx, pool, "scope_a")
	second := seedWebhookFixture(t, ctx, pool, "scope_b")
	repository := New(pool)
	if _, err := repository.FanOut(ctx, time.Now().UTC(), 20); err != nil {
		t.Fatal(err)
	}
	var secondDeliveryID string
	if err := pool.QueryRow(ctx, `SELECT id FROM webhook_deliveries WHERE project_id=$1`, second.projectID).
		Scan(&secondDeliveryID); err != nil {
		t.Fatal(err)
	}

	surface := newAuthorizationSurface(pool).as(first.ownerActor)
	checks := []string{
		"/v1/projects/" + second.projectID + "/billing/webhook-destinations/" + second.destinationID + "/",
		"/v1/projects/" + second.projectID + "/billing/webhook-deliveries/" + secondDeliveryID,
		"/v1/projects/" + first.projectID + "/environments/" + second.environmentID + "/billing/webhook-destinations/",
		"/v1/projects/" + first.projectID + "/billing/webhook-deliveries/?environmentId=" + second.environmentID,
	}
	for _, path := range checks {
		status, payload := surface.do(t, http.MethodGet, path, "")
		if status != http.StatusNotFound {
			t.Fatalf("cross-scope GET %s: status %d payload %v, want 404", path, status, payload)
		}
	}
}

func countRows(t *testing.T, ctx context.Context, pool *pgxpool.Pool, query string, args ...any) int {
	t.Helper()
	var count int
	if err := pool.QueryRow(ctx, query, args...).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

// A worker that dies between claiming a delivery and recording its outcome must
// not produce a second logical delivery.
//
// The window is real: the lease commits (which is what advances attempt_count)
// before the HTTP request begins, and the process can be killed at any point
// afterwards. Recovery runs the same fan-out and the same claim query. If either
// minted a new row, the destination would receive the same entitlement change
// under two delivery identities, and a receiver deduplicating on the delivery
// rather than the event would act on it twice.
func TestCrashedDeliveryRetryDoesNotCreateASecondDelivery(t *testing.T) {
	pool, ctx := testPool(t)
	repository := New(pool)
	f := seedWebhookFixture(t, ctx, pool, "crash")
	now := time.Now().UTC()

	if _, err := repository.FanOut(ctx, now, 10); err != nil {
		t.Fatal(err)
	}
	leased, ok, err := repository.LeaseDelivery(ctx, "worker-a", now, now.Add(billingwebhook.DeliveryLease))
	if err != nil || !ok {
		t.Fatalf("first lease: ok=%t err=%v", ok, err)
	}
	if leased.Delivery.AttemptCount != 1 {
		t.Fatalf("attempt count after the first claim is %d, want 1", leased.Delivery.AttemptCount)
	}

	// worker-a dies here: no CompleteAttempt, the lease is left dangling.

	// Recovery pass one: the fan-out runs again over the same committed event.
	if _, err := repository.FanOut(ctx, now, 10); err != nil {
		t.Fatal(err)
	}
	// Recovery pass two: another worker claims the delivery once the lease has
	// lapsed. The clock is moved past the lease rather than waiting on it.
	afterLease := now.Add(billingwebhook.DeliveryLease + time.Second)
	recovered, ok, err := repository.LeaseDelivery(ctx, "worker-b", afterLease,
		afterLease.Add(billingwebhook.DeliveryLease))
	if err != nil || !ok {
		t.Fatalf("recovery lease: ok=%t err=%v", ok, err)
	}
	if recovered.Delivery.ID != leased.Delivery.ID {
		t.Fatalf("recovery claimed delivery %s, want the abandoned %s — the retry created a "+
			"second logical delivery for one event and destination",
			recovered.Delivery.ID, leased.Delivery.ID)
	}
	if recovered.Delivery.AttemptCount != 2 {
		t.Fatalf("attempt count after recovery is %d, want 2; a crash must still consume an attempt",
			recovered.Delivery.AttemptCount)
	}

	completedAt := afterLease.Add(time.Second)
	if _, err := repository.CompleteAttempt(ctx, billingwebhook.AttemptResult{
		Delivery: recovered.Delivery, AttemptNumber: recovered.Delivery.AttemptCount,
		Outcome: billingwebhook.OutcomeDelivered, Status: billingwebhook.DeliverySucceeded,
		AttemptedAt: afterLease, RespondedAt: &completedAt, CompletedAt: &completedAt,
		ResetDestinationFailures: true,
	}); err != nil {
		t.Fatal(err)
	}

	if deliveries := countRows(t, ctx, pool,
		`SELECT count(*) FROM webhook_deliveries WHERE webhook_event_id=$1 AND webhook_destination_id=$2`,
		f.eventID, f.destinationID); deliveries != 1 {
		t.Fatalf("%d delivery rows for one (event, destination), want exactly 1", deliveries)
	}
	if delivered := countRows(t, ctx, pool,
		`SELECT count(*) FROM webhook_delivery_attempts WHERE webhook_delivery_id=$1 AND outcome='delivered'`,
		leased.Delivery.ID); delivered != 1 {
		t.Fatalf("%d delivered attempts recorded, want exactly 1", delivered)
	}
}

// Two workers polling at the same instant must not both claim one delivery.
//
// The claim is SELECT ... FOR UPDATE SKIP LOCKED inside a transaction that
// commits before any HTTP request. If the skip-locked claim were ever relaxed
// into a plain read, both workers would send the same entitlement change and
// both would try to record attempt number one — and the attempt-number
// uniqueness is what makes the second write a silent no-op rather than a
// visible failure, so a double send would leave no trace in history at all.
func TestConcurrentWorkersClaimOneDeliveryExactlyOnce(t *testing.T) {
	pool, ctx := testPool(t)
	repository := New(pool)
	f := seedWebhookFixture(t, ctx, pool, "race")
	now := time.Now().UTC()

	if _, err := repository.FanOut(ctx, now, 10); err != nil {
		t.Fatal(err)
	}

	const workers = 4
	var start sync.WaitGroup
	var done sync.WaitGroup
	start.Add(1)
	results := make([]billingwebhook.LeasedDelivery, workers)
	claimed := make([]bool, workers)
	errs := make([]error, workers)
	for index := 0; index < workers; index++ {
		done.Add(1)
		go func(index int) {
			defer done.Done()
			start.Wait()
			results[index], claimed[index], errs[index] = repository.LeaseDelivery(ctx,
				"worker-"+string(rune('a'+index)), now, now.Add(billingwebhook.DeliveryLease))
		}(index)
	}
	start.Done()
	done.Wait()

	winners := 0
	winner := billingwebhook.LeasedDelivery{}
	for index := range results {
		if errs[index] != nil {
			t.Fatalf("worker %d failed to poll: %v", index, errs[index])
		}
		if claimed[index] {
			winners++
			winner = results[index]
		}
	}
	if winners != 1 {
		t.Fatalf("%d of %d workers claimed the same delivery, want exactly 1", winners, workers)
	}

	// The losers still record what they would have: the uniqueness on
	// (event, destination, attempt_number) is the last line of defence, and it
	// is worth proving it holds rather than assuming the claim always will.
	completedAt := now.Add(time.Second)
	for attempt := 0; attempt < 2; attempt++ {
		if _, err := repository.CompleteAttempt(ctx, billingwebhook.AttemptResult{
			Delivery: winner.Delivery, AttemptNumber: winner.Delivery.AttemptCount,
			Outcome: billingwebhook.OutcomeDelivered, Status: billingwebhook.DeliverySucceeded,
			AttemptedAt: now, RespondedAt: &completedAt, CompletedAt: &completedAt,
			ResetDestinationFailures: true,
		}); err != nil {
			t.Fatal(err)
		}
	}

	if attempts := countRows(t, ctx, pool,
		`SELECT count(*) FROM webhook_delivery_attempts
		 WHERE webhook_event_id=$1 AND webhook_destination_id=$2 AND attempt_number=1`,
		f.eventID, f.destinationID); attempts != 1 {
		t.Fatalf("%d rows recorded for attempt number 1, want exactly 1", attempts)
	}
	if deliveries := countRows(t, ctx, pool,
		`SELECT count(*) FROM webhook_deliveries WHERE webhook_event_id=$1`, f.eventID); deliveries != 1 {
		t.Fatalf("%d delivery rows for one event, want exactly 1", deliveries)
	}
}

// A replayed delivery must re-send byte-identical signed content.
//
// An operator replays because the receiver did not get, or could not process,
// the original. If the replay sent a re-rendered body, the receiver would
// verify a signature over bytes that differ from what Mosaic first sent, and
// any receiver deduplicating on a content digest would treat the replay as a
// new change. The event id is stable across the replay for the same reason: a
// replay is a new delivery attempt, never a new logical event.
func TestExhaustedDeliveryReplaysByteIdenticalSignedBody(t *testing.T) {
	pool, ctx := testPool(t)
	repository := New(pool)
	f := seedWebhookFixture(t, ctx, pool, "replay")
	now := time.Now().UTC()

	if _, err := repository.FanOut(ctx, now, 10); err != nil {
		t.Fatal(err)
	}
	// One attempt of one, so the delivery exhausts on its first failure rather
	// than looping eight times to reach the state under test.
	if _, err := pool.Exec(ctx,
		`UPDATE webhook_deliveries SET max_attempts=1 WHERE webhook_event_id=$1`, f.eventID); err != nil {
		t.Fatal(err)
	}

	first, ok, err := repository.LeaseDelivery(ctx, "worker-a", now, now.Add(billingwebhook.DeliveryLease))
	if err != nil || !ok {
		t.Fatalf("first lease: ok=%t err=%v", ok, err)
	}
	failedAt := now.Add(time.Second)
	if _, err := repository.CompleteAttempt(ctx, billingwebhook.AttemptResult{
		Delivery: first.Delivery, AttemptNumber: first.Delivery.AttemptCount,
		Outcome: billingwebhook.OutcomeExhausted, Status: billingwebhook.DeliveryExhausted,
		ErrorCode: "destination_error", AttemptedAt: now, RespondedAt: &failedAt, CompletedAt: &failedAt,
		IncrementDestinationFailures: true,
	}); err != nil {
		t.Fatal(err)
	}

	replayed, err := repository.ReplayDelivery(ctx, f.projectID, first.Delivery.ID, "actor_operator", failedAt)
	if err != nil {
		t.Fatal(err)
	}
	if replayed.Status != billingwebhook.DeliveryPending {
		t.Fatalf("replayed delivery is %q, want pending", replayed.Status)
	}

	second, ok, err := repository.LeaseDelivery(ctx, "worker-b", failedAt,
		failedAt.Add(billingwebhook.DeliveryLease))
	if err != nil || !ok {
		t.Fatalf("lease after replay: ok=%t err=%v", ok, err)
	}
	if second.Delivery.EventID != first.Delivery.EventID {
		t.Fatalf("replay changed the event id from %s to %s; a retry must never be a new logical event",
			first.Delivery.EventID, second.Delivery.EventID)
	}
	if second.Delivery.AttemptCount == first.Delivery.AttemptCount {
		t.Fatalf("replay reused attempt number %d; the replayed attempt would be discarded by the "+
			"attempt-number uniqueness and vanish from history", second.Delivery.AttemptCount)
	}
	if !bytes.Equal(first.Body, second.Body) {
		t.Fatalf("replayed body differs from the original:\nfirst:  %s\nsecond: %s",
			first.Body, second.Body)
	}

	// The signature is over the body, so identical bytes under one timestamp and
	// one secret must produce one signature. This is the property a receiver
	// actually checks.
	const secret = "whsec_fixture_secret_value"
	timestamp := failedAt.Unix()
	if a, b := billingwebhook.Sign(secret, timestamp, first.Delivery.EventID, first.Body),
		billingwebhook.Sign(secret, timestamp, second.Delivery.EventID, second.Body); a != b {
		t.Fatalf("replayed signature %s differs from the original %s", b, a)
	}
}
