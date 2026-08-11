package billingpostgres

import (
	"context"
	"database/sql"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib"

	"github.com/Mujhtech/mosaic/apps/api/internal/billing"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/pgtest"
)

// These integration tests cover the guarantees that live in the schema rather
// than in Go: the append-only triggers, the idempotency constraints, and the
// sandbox/production separation. A unit test with a fake repository would pass
// while every one of them was broken, because the thing under test is the
// database itself.

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
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	t.Cleanup(cancel)
	_ = db.Close()

	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool, ctx
}

// seed builds the minimum tenant a billing input needs: an organization, a
// Project, a production Environment, and an iOS Application.
func seed(t *testing.T, ctx context.Context, pool *pgxpool.Pool, suffix string) (projectID, environmentID, applicationID string) {
	t.Helper()
	now := time.Now().UTC()
	organizationID := "org_billing_" + suffix
	projectID = "proj_billing_" + suffix
	environmentID = "env_billing_" + suffix
	applicationID = "app_billing_" + suffix

	cleanup(t, ctx, pool, projectID)
	statements := []struct {
		query string
		args  []any
	}{
		{`INSERT INTO organizations(id,name,created_at,updated_at) VALUES ($1,$2,$3,$3)
		  ON CONFLICT (id) DO NOTHING`, []any{organizationID, "Billing Test", now}},
		{`INSERT INTO projects(id,organization_id,key,name,status,created_at,updated_at)
		  VALUES ($1,$2,$3,'Billing','active',$4,$4) ON CONFLICT (id) DO NOTHING`,
			[]any{projectID, organizationID, "billing-" + suffix, now}},
		{`INSERT INTO environments(id,project_id,key,name,mode,created_at,updated_at)
		  VALUES ($1,$2,'production','Production','production',$3,$3) ON CONFLICT (id) DO NOTHING`,
			[]any{environmentID, projectID, now}},
		{`INSERT INTO applications(id,project_id,name,platform,identifier,created_at,updated_at)
		  VALUES ($1,$2,'iOS','ios',$3,$4,$4) ON CONFLICT (id) DO NOTHING`,
			[]any{applicationID, projectID, "com.fixture.app." + suffix, now}},
		// Mosaic Billing is opt-in and genuinely gates intake and every worker,
		// so a seeded tenant that is exercising the pipeline must have opted in.
		// Tests that care about the off state turn it off explicitly.
		{`INSERT INTO billing_project_settings(project_id,billing_enabled,updated_by_actor_id,created_at,updated_at)
		  VALUES ($1,true,'seed',$2,$2) ON CONFLICT (project_id) DO UPDATE SET billing_enabled=true`,
			[]any{projectID, now}},
	}
	for _, statement := range statements {
		if _, err := pool.Exec(ctx, statement.query, statement.args...); err != nil {
			t.Fatalf("seed tenant: %v", err)
		}
	}
	t.Cleanup(func() {
		cleanupContext, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		cleanup(t, cleanupContext, pool, projectID)
	})
	return projectID, environmentID, applicationID
}

// cleanup removes billing rows in dependency order. The append-only triggers
// permit DELETE only where retention needs it, so the ledger tables are cleared
// with a session-level trigger disable rather than by weakening the schema.
func cleanup(t *testing.T, ctx context.Context, pool *pgxpool.Pool, projectID string) {
	t.Helper()
	statements := []string{
		`ALTER TABLE billing_ledger_entries DISABLE TRIGGER billing_ledger_entries_append_only`,
		`ALTER TABLE billing_transaction_facts DISABLE TRIGGER billing_transaction_facts_append_only`,
		`ALTER TABLE billing_product_resolutions DISABLE TRIGGER billing_product_resolutions_append_only`,
		`ALTER TABLE billing_validation_attempts DISABLE TRIGGER billing_validation_attempts_append_only`,
		`ALTER TABLE billing_quarantine_actions DISABLE TRIGGER billing_quarantine_actions_append_only`,
		`DELETE FROM billing_ledger_entries WHERE project_id=$1`,
		`DELETE FROM billing_replay_jobs WHERE project_id=$1`,
		`DELETE FROM billing_reconciliation_runs WHERE project_id=$1`,
		`DELETE FROM billing_quarantine_actions WHERE project_id=$1`,
		`DELETE FROM billing_quarantine_records WHERE project_id=$1`,
		`DELETE FROM billing_transaction_facts WHERE project_id=$1`,
		`DELETE FROM billing_product_resolutions WHERE project_id=$1`,
		`DELETE FROM billing_identity_binding_jobs WHERE project_id=$1`,
		`DELETE FROM billing_validation_jobs WHERE project_id=$1`,
		`DELETE FROM billing_validation_attempts WHERE project_id=$1`,
		`DELETE FROM billing_raw_inputs WHERE project_id=$1`,
		`DELETE FROM store_server_credential_applications WHERE project_id=$1`,
		`DELETE FROM store_server_credentials WHERE project_id=$1`,
		`DELETE FROM billing_project_settings WHERE project_id=$1`,
		`ALTER TABLE billing_ledger_entries ENABLE TRIGGER billing_ledger_entries_append_only`,
		`ALTER TABLE billing_transaction_facts ENABLE TRIGGER billing_transaction_facts_append_only`,
		`ALTER TABLE billing_product_resolutions ENABLE TRIGGER billing_product_resolutions_append_only`,
		`ALTER TABLE billing_validation_attempts ENABLE TRIGGER billing_validation_attempts_append_only`,
		`ALTER TABLE billing_quarantine_actions ENABLE TRIGGER billing_quarantine_actions_append_only`,
	}
	for _, statement := range statements {
		if strings.HasPrefix(statement, "DELETE") {
			_, _ = pool.Exec(ctx, statement, projectID)
			continue
		}
		_, _ = pool.Exec(ctx, statement)
	}
}

func sampleInput(projectID, environmentID, applicationID, key string) billing.RawInput {
	now := time.Now().UTC()
	return billing.RawInput{
		ProjectID:            projectID,
		EnvironmentID:        environmentID,
		EnvironmentMode:      "production",
		ApplicationID:        applicationID,
		Provider:             billing.ProviderAppStore,
		Source:               billing.SourceAppleNotification,
		SourceAuthority:      billing.AuthorityStoreNotification,
		ProviderEventID:      key,
		IdempotencyKey:       billing.AppleNotificationKey(key),
		ContentDigest:        billing.ContentDigest([]byte(`{"signedPayload":"fixture"}`)),
		BodyState:            "not_retained",
		AuthenticationResult: billing.AuthVerifiedSignature,
		StoreEnvironment:     billing.StoreProduction,
		NotificationKind:     "SUBSCRIBED",
		IngestionStatus:      billing.IngestAccepted,
		CorrelationID:        "test-" + key,
		ReceivedAt:           now,
		ExpiresAt:            now.Add(90 * 24 * time.Hour),
	}
}

// A store retrying a delivery must never produce a second input or a second
// queued job. Apple redelivers on any non-2xx and Pub/Sub redelivers
// aggressively, so duplicate delivery is the normal case rather than an edge.
func TestDuplicateNotificationProducesOneInputAndOneJob(t *testing.T) {
	pool, ctx := testPool(t)
	repository := New(pool)
	projectID, environmentID, applicationID := seed(t, ctx, pool, "dup")
	now := time.Now().UTC()

	input := sampleInput(projectID, environmentID, applicationID, "fixture-uuid-duplicate")
	first, err := repository.PersistRawInput(ctx, input, true, now)
	if err != nil {
		t.Fatalf("first delivery: %v", err)
	}
	if first.Status != billing.IngestAccepted {
		t.Fatalf("first delivery status %q, want accepted", first.Status)
	}

	// Identical redelivery: same key, same content.
	redelivery := sampleInput(projectID, environmentID, applicationID, "fixture-uuid-duplicate")
	second, err := repository.PersistRawInput(ctx, redelivery, true, now)
	if err != nil {
		t.Fatalf("redelivery: %v", err)
	}
	if second.Status != billing.IngestDuplicate {
		t.Fatalf("redelivery status %q, want duplicate", second.Status)
	}
	if second.RawInputID != first.RawInputID {
		t.Fatal("redelivery created a second raw input")
	}

	var inputs, jobs int
	if err := pool.QueryRow(ctx, `SELECT
		(SELECT count(*) FROM billing_raw_inputs WHERE project_id=$1),
		(SELECT count(*) FROM billing_validation_jobs WHERE project_id=$1)`, projectID).
		Scan(&inputs, &jobs); err != nil {
		t.Fatal(err)
	}
	if inputs != 1 || jobs != 1 {
		t.Fatalf("after redelivery: %d inputs and %d jobs, want 1 and 1", inputs, jobs)
	}
}

// The same provider event id arriving with different content is either a
// provider defect or a forgery attempt. It must never overwrite the original,
// and it must surface as a security-severity quarantine rather than being
// absorbed as a duplicate.
func TestConflictingContentUnderSameKeyQuarantines(t *testing.T) {
	pool, ctx := testPool(t)
	repository := New(pool)
	projectID, environmentID, applicationID := seed(t, ctx, pool, "conflict")
	now := time.Now().UTC()

	original := sampleInput(projectID, environmentID, applicationID, "fixture-uuid-conflict")
	if _, err := repository.PersistRawInput(ctx, original, true, now); err != nil {
		t.Fatal(err)
	}

	forged := sampleInput(projectID, environmentID, applicationID, "fixture-uuid-conflict")
	forged.ContentDigest = billing.ContentDigest([]byte(`{"signedPayload":"different"}`))
	result, err := repository.PersistRawInput(ctx, forged, true, now)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Conflicted || result.Status != billing.IngestConflicted {
		t.Fatalf("conflicting content reported as %q (conflicted=%v)", result.Status, result.Conflicted)
	}

	var storedDigest []byte
	if err := pool.QueryRow(ctx, `SELECT content_digest FROM billing_raw_inputs WHERE id=$1`,
		result.RawInputID).Scan(&storedDigest); err != nil {
		t.Fatal(err)
	}
	if string(storedDigest) != string(original.ContentDigest) {
		t.Fatal("the original content digest was overwritten by the conflicting delivery")
	}

	var reason, severity string
	if err := pool.QueryRow(ctx,
		`SELECT reason_code, severity FROM billing_quarantine_records WHERE raw_input_id=$1`,
		result.RawInputID).Scan(&reason, &severity); err != nil {
		t.Fatalf("no quarantine record for a content conflict: %v", err)
	}
	if reason != billing.QuarantineInputContentConflict || severity != "security" {
		t.Fatalf("quarantined as %q/%q, want input_content_conflict/security", reason, severity)
	}
}

// The append-only guarantee is a database trigger, so only a database test can
// prove it. Without it, application code could silently rewrite the ledger and
// replay would stop being reproducible.
func TestLedgerTablesRejectMutation(t *testing.T) {
	pool, ctx := testPool(t)
	repository := New(pool)
	projectID, environmentID, applicationID := seed(t, ctx, pool, "append")
	now := time.Now().UTC()

	input := sampleInput(projectID, environmentID, applicationID, "fixture-uuid-append")
	result, err := repository.PersistRawInput(ctx, input, false, now)
	if err != nil {
		t.Fatal(err)
	}

	attemptID := "bva_fixture_append"
	if _, err := pool.Exec(ctx,
		`INSERT INTO billing_validation_attempts(
			id, project_id, environment_id, raw_input_id, attempt_number, validator_version,
			started_at, completed_at, outcome, retryable, store_environment, latency_ms, correlation_id)
		 VALUES ($1,$2,$3,$4,1,1,$5,$5,'validated',false,'production',12,'test')`,
		attemptID, projectID, environmentID, result.RawInputID, now); err != nil {
		t.Fatal(err)
	}

	// A validation attempt is evidence of what the pipeline did; editing or
	// deleting one would let a failed attempt be erased after the fact.
	for name, statement := range map[string]string{
		"update attempt": `UPDATE billing_validation_attempts SET outcome='quarantined' WHERE id=$1`,
		"delete attempt": `DELETE FROM billing_validation_attempts WHERE id=$1`,
	} {
		if _, err := pool.Exec(ctx, statement, attemptID); err == nil {
			t.Fatalf("%s succeeded on an append-only table", name)
		} else if !strings.Contains(err.Error(), "55000") {
			t.Fatalf("%s failed with %v, want SQLSTATE 55000", name, err)
		}
	}

	// A raw input's meaning is immutable, but the encryption envelope must stay
	// rewritable so `keyring rotate` can reseal a retained body.
	if _, err := pool.Exec(ctx,
		`UPDATE billing_raw_inputs SET notification_kind='REFUND' WHERE id=$1`, result.RawInputID); err == nil {
		t.Fatal("a raw billing input was edited outside key rotation")
	} else if !strings.Contains(err.Error(), "55000") {
		t.Fatalf("raw input edit failed with %v, want SQLSTATE 55000", err)
	}
	if _, err := pool.Exec(ctx,
		`UPDATE billing_raw_inputs SET key_id='rotated-key', envelope_rotated_at=$2 WHERE id=$1`,
		result.RawInputID, now); err != nil {
		t.Fatalf("key rotation was blocked by the append-only trigger: %v", err)
	}
}

// Sandbox and production must not mix. Enforcing it in the schema means an
// application defect produces a constraint violation rather than a sandbox
// purchase quietly counted as production revenue.
func TestSandboxFactCannotLandInProductionEnvironment(t *testing.T) {
	pool, ctx := testPool(t)
	repository := New(pool)
	projectID, environmentID, applicationID := seed(t, ctx, pool, "mixing")
	now := time.Now().UTC()

	input := sampleInput(projectID, environmentID, applicationID, "fixture-uuid-mixing")
	result, err := repository.PersistRawInput(ctx, input, false, now)
	if err != nil {
		t.Fatal(err)
	}
	attemptID := "bva_fixture_mixing"
	if _, err := pool.Exec(ctx,
		`INSERT INTO billing_validation_attempts(
			id, project_id, environment_id, raw_input_id, attempt_number, validator_version,
			started_at, completed_at, outcome, retryable, store_environment, latency_ms, correlation_id)
		 VALUES ($1,$2,$3,$4,1,1,$5,$5,'validated',false,'production',12,'test')`,
		attemptID, projectID, environmentID, result.RawInputID, now); err != nil {
		t.Fatal(err)
	}

	_, err = pool.Exec(ctx,
		`INSERT INTO billing_transaction_facts(
			id, project_id, environment_id, environment_mode, application_id, provider, store_environment,
			provider_transaction_id, transaction_type, fact_kind, occurred_at,
			provider_product_identifier, resolution_state, validator_version, fact_version,
			source_raw_input_id, validation_attempt_id, fact_digest, recorded_at)
		 VALUES ($1,$2,$3,'production',$4,'app_store','sandbox','2000000000000001',
			'auto_renewable_subscription','initial_purchase',$5,'fixture.pro','unresolved',1,1,$6,$7,$8,$5)`,
		"btf_fixture_mixing", projectID, environmentID, applicationID, now,
		result.RawInputID, attemptID, make([]byte, 32))
	if err == nil {
		t.Fatal("a sandbox fact was accepted into a production Environment")
	}
	if !strings.Contains(err.Error(), "environment_alignment") {
		t.Fatalf("rejected by %v, want the store-environment alignment check", err)
	}
}

// Fact identity is UNIQUE (environment_id, fact_digest). This is what makes
// replay a structural no-op: the second write of an identical fact must be
// absorbed rather than duplicating the ledger.
func TestIdenticalFactIsDeduplicatedByDigest(t *testing.T) {
	pool, ctx := testPool(t)
	repository := New(pool)
	projectID, environmentID, applicationID := seed(t, ctx, pool, "factdedup")
	now := time.Now().UTC()

	input := sampleInput(projectID, environmentID, applicationID, "fixture-uuid-factdedup")
	result, err := repository.PersistRawInput(ctx, input, false, now)
	if err != nil {
		t.Fatal(err)
	}
	digest := make([]byte, 32)
	for index := range digest {
		digest[index] = byte(index)
	}

	insertFact := func(factID, attemptID string) error {
		if _, err := pool.Exec(ctx,
			`INSERT INTO billing_validation_attempts(
				id, project_id, environment_id, raw_input_id, attempt_number, validator_version,
				started_at, completed_at, outcome, retryable, store_environment, latency_ms, correlation_id)
			 VALUES ($1,$2,$3,$4,$5,1,$6,$6,'validated',false,'production',12,'test')`,
			attemptID, projectID, environmentID, result.RawInputID, len(attemptID), now); err != nil {
			return err
		}
		tag, err := pool.Exec(ctx,
			`INSERT INTO billing_transaction_facts(
				id, project_id, environment_id, environment_mode, application_id, provider, store_environment,
				provider_transaction_id, transaction_type, fact_kind, occurred_at,
				provider_product_identifier, resolution_state, validator_version, fact_version,
				source_raw_input_id, validation_attempt_id, fact_digest, recorded_at)
			 VALUES ($1,$2,$3,'production',$4,'app_store','production','2000000000000002',
				'auto_renewable_subscription','renewal',$5,'fixture.pro','unresolved',1,1,$6,$7,$8,$5)
			 ON CONFLICT (environment_id, fact_digest) DO NOTHING`,
			factID, projectID, environmentID, applicationID, now, result.RawInputID, attemptID, digest)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return nil
		}
		return nil
	}

	if err := insertFact("btf_first", "bva_a"); err != nil {
		t.Fatal(err)
	}
	// A replay recomputes the same digest and must write nothing new.
	if err := insertFact("btf_second", "bva_bb"); err != nil {
		t.Fatal(err)
	}

	var facts int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM billing_transaction_facts WHERE project_id=$1`, projectID).Scan(&facts); err != nil {
		t.Fatal(err)
	}
	if facts != 1 {
		t.Fatalf("%d facts recorded, want 1 — replay duplicated the ledger", facts)
	}
	// Both attempts survive: replay preserves history rather than replacing it.
	var attempts int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM billing_validation_attempts WHERE raw_input_id=$1`, result.RawInputID).Scan(&attempts); err != nil {
		t.Fatal(err)
	}
	if attempts != 2 {
		t.Fatalf("%d attempts preserved, want 2", attempts)
	}
}

// Reading another tenant's billing data must fail on membership, not on a
// filter an application defect could omit. Member-level access is refused too:
// the ledger carries store evidence and the credential lifecycle controls
// production notification delivery.
func TestBillingReadsRequireOwnerOrAdminMembership(t *testing.T) {
	pool, ctx := testPool(t)
	repository := New(pool)
	projectID, environmentID, _ := seed(t, ctx, pool, "authz")
	now := time.Now().UTC()

	var organizationID string
	if err := pool.QueryRow(ctx, `SELECT organization_id FROM projects WHERE id=$1`, projectID).
		Scan(&organizationID); err != nil {
		t.Fatal(err)
	}
	for actorID, role := range map[string]string{
		"actor_owner_authz":  "owner",
		"actor_member_authz": "member",
	} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO organization_members(organization_id,actor_id,role,created_at,updated_at)
			 VALUES ($1,$2,$3,$4,$4) ON CONFLICT (organization_id,actor_id) DO UPDATE SET role=EXCLUDED.role`,
			organizationID, actorID, role, now); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() {
		cleanupContext, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		_, _ = pool.Exec(cleanupContext,
			`DELETE FROM organization_members WHERE organization_id=$1 AND actor_id LIKE 'actor_%_authz'`, organizationID)
	})

	if _, err := repository.ListFacts(ctx, billing.Actor{ID: "actor_owner_authz"}, projectID, environmentID, billing.ListOptions{}); err != nil {
		t.Fatalf("an owner was refused: %v", err)
	}
	if _, err := repository.ListFacts(ctx, billing.Actor{ID: "actor_member_authz"}, projectID, environmentID, billing.ListOptions{}); err != billing.ErrForbidden {
		t.Fatalf("a member read the billing ledger: %v", err)
	}
	// A non-member must not learn whether the Project exists.
	if _, err := repository.ListFacts(ctx, billing.Actor{ID: "actor_stranger"}, projectID, environmentID, billing.ListOptions{}); err != billing.ErrNotFound {
		t.Fatalf("a non-member got %v, want not found", err)
	}
	if _, err := repository.ListFacts(ctx, billing.Actor{}, projectID, environmentID, billing.ListOptions{}); err != billing.ErrUnauthenticated {
		t.Fatal("an unauthenticated caller was not refused")
	}
}

// The quarantine surface must keep sandbox and production visibly apart, and it
// must never present an unknown environment as an absent one: a missing value
// on an operator screen reads as production to a careless eye. The record does
// not carry its own copy of the column — it is always about exactly one input,
// and duplicating it would create a second place for the two to disagree — so
// this pins that the join actually happens and that the fallback is explicit.
func TestQuarantineRecordsCarryStoreEnvironment(t *testing.T) {
	pool, ctx := testPool(t)
	repository := New(pool)
	projectID, environmentID, applicationID := seed(t, ctx, pool, "quarenv")
	now := time.Now().UTC()

	var organizationID string
	if err := pool.QueryRow(ctx, `SELECT organization_id FROM projects WHERE id=$1`, projectID).
		Scan(&organizationID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO organization_members(organization_id,actor_id,role,created_at,updated_at)
		 VALUES ($1,'actor_owner_quarenv','owner',$2,$2)
		 ON CONFLICT (organization_id,actor_id) DO UPDATE SET role=EXCLUDED.role`,
		organizationID, now); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupContext, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		_, _ = pool.Exec(cleanupContext,
			`DELETE FROM organization_members WHERE organization_id=$1 AND actor_id='actor_owner_quarenv'`, organizationID)
	})

	// A production-classified input, quarantined at intake.
	input := sampleInput(projectID, environmentID, applicationID, "fixture-uuid-quarenv")
	input.IngestionStatus = billing.IngestQuarantined
	if _, err := repository.PersistRawInput(ctx, input, false, now); err != nil {
		t.Fatal(err)
	}

	// An input whose environment could not be classified before it quarantined.
	unclassified := sampleInput(projectID, environmentID, applicationID, "fixture-uuid-quarenv-unclassified")
	unclassified.StoreEnvironment = billing.StoreUnclassified
	unclassified.AuthenticationResult = billing.AuthFailed
	unclassified.IngestionStatus = billing.IngestQuarantined
	if _, err := repository.PersistRawInput(ctx, unclassified, false, now); err != nil {
		t.Fatal(err)
	}

	actor := billing.Actor{ID: "actor_owner_quarenv"}
	page, err := repository.ListQuarantine(ctx, actor, projectID, environmentID, billing.ListOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 2 {
		t.Fatalf("%d quarantine records, want 2", len(page.Items))
	}
	seen := map[string]string{}
	for _, record := range page.Items {
		if record.StoreEnvironment == "" {
			t.Fatalf("quarantine record %s reports an empty store environment", record.ID)
		}
		seen[record.RawInputID] = record.StoreEnvironment

		// The detail read must agree with the list read.
		detail, err := repository.Quarantine(ctx, actor, projectID, record.ID)
		if err != nil {
			t.Fatal(err)
		}
		if detail.StoreEnvironment != record.StoreEnvironment {
			t.Fatalf("detail reports %q but the list reports %q",
				detail.StoreEnvironment, record.StoreEnvironment)
		}
	}
	for rawInputID, environment := range seen {
		if environment != billing.StoreProduction && environment != billing.StoreUnclassified {
			t.Fatalf("raw input %s reported store environment %q", rawInputID, environment)
		}
	}
	if len(seen) != 2 {
		t.Fatalf("expected two distinct inputs, got %d", len(seen))
	}
}
