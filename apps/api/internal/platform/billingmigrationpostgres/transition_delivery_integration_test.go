package billingmigrationpostgres_test

import (
	"bytes"
	"crypto/sha256"
	"errors"
	"testing"
	"time"

	"github.com/pressly/goose/v3"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingmigration"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingwebhook"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingmigrationpostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingwebhookpostgres"
)

// This regression protects the production gate from accepting proof produced
// for another receiver configuration or another contract. Only a fresh,
// delivered v2 authority event subscribed by the current destination counts.
func TestDestinationReadinessRequiresCurrentV2AuthorityProof(t *testing.T) {
	ctx, pool, db := executionDatabase(t)
	now := time.Date(2026, 7, 30, 10, 0, 0, 0, time.UTC)
	seedExecutionCheckpoint(t, ctx, db, now)
	repository := billingwebhookpostgres.New(pool)

	_, err := pool.Exec(ctx, `INSERT INTO webhook_destinations(id,project_id,environment_id,url,status,event_types,
		description,contract_version,last_successful_test_at,created_at,updated_at) VALUES
		('destination_readiness','project_one','environment_one','https://receiver.example.test','active',
		 ARRAY['customer.entitlements.changed'],'readiness regression',1,$1,$1,$1)`, now)
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `INSERT INTO webhook_signing_secrets(id,project_id,webhook_destination_id,status,envelope_version,algorithm,key_id,
		 nonce,ciphertext,fingerprint,created_at) VALUES('secret_readiness','project_one','destination_readiness','active',1,
		 'AES-256-GCM','test',decode(repeat('01',12),'hex'),decode(repeat('02',32),'hex'),decode(repeat('03',32),'hex'),$1)`, now)
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `INSERT INTO webhook_events(id,project_id,environment_id,event_type,billing_customer_id,
		 customer_entitlement_snapshot_id,snapshot_version,payload,contract_version,occurred_at,created_at)
		 VALUES('event_readiness_v1','project_one','environment_one','customer.entitlements.changed','customer_one',
		 'snapshot_activation',2,'{}'::jsonb,1,$1,$1)`, now)
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `INSERT INTO webhook_delivery_attempts(id,project_id,webhook_event_id,webhook_destination_id,attempt_number,outcome,attempted_at)
		 VALUES('attempt_readiness_v1','project_one','event_readiness_v1','destination_readiness',1,'delivered',$1)`, now)
	if err != nil {
		t.Fatal(err)
	}
	assertReadiness := func(want int, label string, recentAfter time.Time) {
		t.Helper()
		readiness, readErr := repository.DestinationReadiness(ctx, "project_one", "environment_one", recentAfter)
		if readErr != nil || readiness.HealthyV2Count != want {
			t.Fatalf("%s readiness=%#v err=%v", label, readiness, readErr)
		}
	}
	assertReadiness(0, "v1 delivery", now.Add(-time.Hour))

	v2 := 2
	authorityEvents := []string{billingwebhook.EventTypeAuthorityRollbackCompleted}
	if _, err = repository.UpdateDestination(ctx, "project_one", "destination_readiness", billingwebhook.DestinationUpdate{
		EventTypes: authorityEvents, ContractVersion: &v2,
	}, "owner_one", now.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	assertReadiness(0, "v1 proof after contract flip", now.Add(-time.Hour))

	var scopeID string
	if err = pool.QueryRow(ctx, `SELECT id FROM billing_migration_authority_scopes
		WHERE project_id='project_one' AND application_id='app_one' AND platform='ios'`).Scan(&scopeID); err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `INSERT INTO webhook_events(id,project_id,environment_id,event_type,billing_customer_id,
		 customer_entitlement_snapshot_id,snapshot_version,payload,contract_version,authority_scope_id,authority_epoch,
		 authority_kind,transition_state,correlation_id,snapshot_authority_digest,occurred_at,created_at)
		 VALUES('event_readiness_v2','project_one','environment_one','authority.rollback.completed','customer_one',
		 'snapshot_activation',2,'{}'::jsonb,2,$2,2,'source_rollback','rolled_back','correlation-readiness',
		 decode(repeat('aa',32),'hex'),$1,$1)`, now, scopeID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `INSERT INTO webhook_delivery_attempts(id,project_id,webhook_event_id,webhook_destination_id,attempt_number,outcome,attempted_at)
		 VALUES('attempt_readiness_v2','project_one','event_readiness_v2','destination_readiness',1,'delivered',$1)`, now.Add(2*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	assertReadiness(1, "fresh v2 authority proof", now.Add(-time.Hour))

	changedURL := "https://changed.example.test"
	if _, err = repository.UpdateDestination(ctx, "project_one", "destination_readiness", billingwebhook.DestinationUpdate{URL: &changedURL}, "owner_one", now.Add(3*time.Second)); err != nil {
		t.Fatal(err)
	}
	assertReadiness(0, "URL change", now.Add(-time.Hour))
	var lastTest *time.Time
	if err = pool.QueryRow(ctx, `SELECT last_successful_test_at FROM webhook_destinations WHERE id='destination_readiness'`).Scan(&lastTest); err != nil || lastTest != nil {
		t.Fatalf("URL change retained successful-test evidence=%v err=%v", lastTest, err)
	}

	_, err = pool.Exec(ctx, `INSERT INTO webhook_delivery_attempts(id,project_id,webhook_event_id,webhook_destination_id,attempt_number,outcome,attempted_at)
		VALUES('attempt_readiness_v2_after_url','project_one','event_readiness_v2','destination_readiness',2,'delivered',$1)`, now.Add(4*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `UPDATE webhook_destinations SET last_successful_test_at=$1 WHERE id='destination_readiness'`, now.Add(4*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	assertReadiness(1, "proof after URL change", now.Add(-time.Hour))

	changedEvents := []string{billingwebhook.EventTypeAuthorityStabilizationCompleted}
	if _, err = repository.UpdateDestination(ctx, "project_one", "destination_readiness", billingwebhook.DestinationUpdate{EventTypes: changedEvents}, "owner_one", now.Add(5*time.Second)); err != nil {
		t.Fatal(err)
	}
	assertReadiness(0, "event subscription change", now.Add(-time.Hour))
	if err = pool.QueryRow(ctx, `SELECT last_successful_test_at FROM webhook_destinations WHERE id='destination_readiness'`).Scan(&lastTest); err != nil || lastTest != nil {
		t.Fatalf("event change retained successful-test evidence=%v err=%v", lastTest, err)
	}

	_, err = pool.Exec(ctx, `UPDATE webhook_destinations SET last_successful_test_at=$1 WHERE id='destination_readiness'`, now.Add(6*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	v1 := 1
	if _, err = repository.UpdateDestination(ctx, "project_one", "destination_readiness", billingwebhook.DestinationUpdate{ContractVersion: &v1,
		EventTypes: []string{billingwebhook.EventTypeEntitlementsChanged}}, "owner_one", now.Add(7*time.Second)); err != nil {
		t.Fatal(err)
	}
	assertReadiness(0, "contract change", now.Add(-time.Hour))
	if err = pool.QueryRow(ctx, `SELECT last_successful_test_at FROM webhook_destinations WHERE id='destination_readiness'`).Scan(&lastTest); err != nil || lastTest != nil {
		t.Fatalf("contract change retained successful-test evidence=%v err=%v", lastTest, err)
	}
}

func TestSuccessfulV2AuthorityAttemptAtomicallyPromotesDestinationFreshness(t *testing.T) {
	ctx, pool, db := executionDatabase(t)
	now := time.Date(2026, 7, 30, 11, 0, 0, 0, time.UTC)
	seedExecutionCheckpoint(t, ctx, db, now)
	repository := billingwebhookpostgres.New(pool)

	var scopeID string
	if err := pool.QueryRow(ctx, `SELECT id FROM billing_migration_authority_scopes WHERE project_id='project_one' ORDER BY id LIMIT 1`).Scan(&scopeID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO webhook_events(id,project_id,environment_id,event_type,billing_customer_id,
		customer_entitlement_snapshot_id,snapshot_version,payload,contract_version,authority_scope_id,authority_epoch,
		authority_kind,transition_state,correlation_id,snapshot_authority_digest,occurred_at,created_at)
		VALUES('event_freshness_v2','project_one','environment_one','authority.rollback.completed','customer_one',
		'snapshot_activation',2,'{}'::jsonb,2,$2,2,'source_rollback','rolled_back','freshness-proof',
		decode(repeat('aa',32),'hex'),$1,$1)`, now, scopeID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO webhook_events(id,project_id,environment_id,event_type,billing_customer_id,
		customer_entitlement_snapshot_id,snapshot_version,payload,contract_version,authority_scope_id,authority_epoch,
		authority_kind,transition_state,correlation_id,snapshot_authority_digest,occurred_at,created_at)
		VALUES('event_freshness_non_authority','project_one','environment_one','customer.entitlements.changed','customer_one',
		NULL,0,'{}'::jsonb,2,$2,2,'mosaic','stable','freshness-non-authority',
		decode(repeat('ab',32),'hex'),$1,$1)`, now, scopeID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO webhook_destinations(id,project_id,environment_id,url,status,event_types,description,contract_version,created_at,updated_at) VALUES
		('fresh_success','project_one','environment_one','https://success.example.test','active',ARRAY['authority.rollback.completed'],'success',2,$1,$1),
		('fresh_failed','project_one','environment_one','https://failed.example.test','active',ARRAY['authority.rollback.completed'],'failed',2,$1,$1),
		('fresh_v1','project_one','environment_one','https://v1.example.test','active',ARRAY['customer.entitlements.changed'],'v1',1,$1,$1),
		('fresh_non_authority','project_one','environment_one','https://non-authority.example.test','active',ARRAY['customer.entitlements.changed'],'non-authority',2,$1,$1),
		('fresh_stale','project_one','environment_one','https://stale.example.test','active',ARRAY['authority.rollback.completed'],'stale',2,$1,$1)`, now); err != nil {
		t.Fatal(err)
	}
	for _, destinationID := range []string{"fresh_success", "fresh_failed", "fresh_v1", "fresh_non_authority", "fresh_stale"} {
		if _, err := pool.Exec(ctx, `INSERT INTO webhook_signing_secrets(id,project_id,webhook_destination_id,status,envelope_version,algorithm,key_id,nonce,ciphertext,fingerprint,created_at)
			VALUES('secret_'||$1,'project_one',$1,'active',1,'AES-256-GCM','test',decode(repeat('01',12),'hex'),decode(repeat('02',32),'hex'),sha256(convert_to($1,'UTF8')),$2)`, destinationID, now); err != nil {
			t.Fatal(err)
		}
		eventID := "event_freshness_v2"
		if destinationID == "fresh_non_authority" {
			eventID = "event_freshness_non_authority"
		}
		if _, err := pool.Exec(ctx, `INSERT INTO webhook_deliveries(id,project_id,environment_id,webhook_event_id,webhook_destination_id,status,attempt_count,max_attempts,next_attempt_at,created_at,updated_at)
			VALUES('delivery_'||$1,'project_one','environment_one',$2,$1,'pending',1,8,$3,$3,$3)`, destinationID, eventID, now); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := pool.Exec(ctx, `UPDATE webhook_deliveries SET leased_destination_config_digest=webhook_destination_config_digest(webhook_destination_id,project_id) WHERE id LIKE 'delivery_fresh_%'`); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE webhook_destinations SET url='https://changed-after-lease.example.test',updated_at=$1 WHERE id='fresh_stale'`, now.Add(2*time.Minute)); err != nil {
		t.Fatal(err)
	}
	complete := func(destinationID, outcome, status string, attemptedAt time.Time) {
		t.Helper()
		completedAt := attemptedAt.Add(time.Second)
		eventID := "event_freshness_v2"
		if destinationID == "fresh_non_authority" {
			eventID = "event_freshness_non_authority"
		}
		_, err := repository.CompleteAttempt(ctx, billingwebhook.AttemptResult{
			Delivery:      billingwebhook.Delivery{ID: "delivery_" + destinationID, ProjectID: "project_one", EnvironmentID: "environment_one", EventID: eventID, DestinationID: destinationID, MaxAttempts: 8},
			AttemptNumber: 1, Outcome: outcome, Status: status, ErrorCode: map[bool]string{true: "destination_error"}[outcome != billingwebhook.OutcomeDelivered],
			AttemptedAt: attemptedAt, RespondedAt: &completedAt, CompletedAt: &completedAt,
		})
		if err != nil {
			t.Fatalf("complete %s: %v", destinationID, err)
		}
	}
	var serverBefore time.Time
	if err := pool.QueryRow(ctx, `SELECT clock_timestamp()`).Scan(&serverBefore); err != nil {
		t.Fatal(err)
	}
	forgedFuture := now.Add(365 * 24 * time.Hour)
	complete("fresh_success", billingwebhook.OutcomeDelivered, billingwebhook.DeliverySucceeded, forgedFuture)
	var serverAfter time.Time
	if err := pool.QueryRow(ctx, `SELECT clock_timestamp()`).Scan(&serverAfter); err != nil {
		t.Fatal(err)
	}
	complete("fresh_failed", billingwebhook.OutcomePermanentFailure, billingwebhook.DeliveryFailed, now.Add(time.Minute))
	complete("fresh_v1", billingwebhook.OutcomeDelivered, billingwebhook.DeliverySucceeded, now.Add(time.Minute))
	complete("fresh_non_authority", billingwebhook.OutcomeDelivered, billingwebhook.DeliverySucceeded, now.Add(time.Minute))
	complete("fresh_stale", billingwebhook.OutcomeDelivered, billingwebhook.DeliverySucceeded, now.Add(time.Minute))

	rows, err := pool.Query(ctx, `SELECT id,last_successful_test_at FROM webhook_destinations WHERE id LIKE 'fresh_%' ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	proofs := map[string]*time.Time{}
	for rows.Next() {
		var id string
		var proof *time.Time
		if err := rows.Scan(&id, &proof); err != nil {
			t.Fatal(err)
		}
		proofs[id] = proof
	}
	if proofs["fresh_success"] == nil || proofs["fresh_success"].Before(serverBefore) || proofs["fresh_success"].After(serverAfter) || proofs["fresh_success"].Equal(forgedFuture) {
		t.Fatalf("successful v2 proof=%v, server bounds=[%v,%v], forged=%v", proofs["fresh_success"], serverBefore, serverAfter, forgedFuture)
	}
	for _, id := range []string{"fresh_failed", "fresh_v1", "fresh_non_authority", "fresh_stale"} {
		if proofs[id] != nil {
			t.Fatalf("%s incorrectly promoted freshness=%v", id, proofs[id])
		}
	}
}

// This PostgreSQL test protects the Package B transaction boundary: the exact
// checkpoint cohort is expanded once per scope, an absent rollback baseline is
// represented as version zero, only v2 destinations receive transition
// events, and stable-event redelivery requeues the same immutable body.
func TestTransitionDeliveryAndStableEventRedelivery(t *testing.T) {
	ctx, pool, db := executionDatabase(t)
	now := time.Date(2026, 7, 30, 10, 0, 0, 0, time.UTC)
	seedExecutionCheckpoint(t, ctx, db, now)
	_, err := pool.Exec(ctx, `INSERT INTO organization_members(organization_id,actor_id,role,created_at,updated_at) VALUES('org_one','member_redelivery','member',$1,$1)`, now)
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `INSERT INTO webhook_destinations(id,project_id,environment_id,url,status,event_types,
		description,contract_version,created_at,updated_at) VALUES
		('destination_v1','project_one','environment_one','https://v1.example.test','active',ARRAY['customer.entitlements.changed'],'v1',1,$1,$1),
		('destination_v2','project_one','environment_one','https://v2.example.test','active',ARRAY['authority.rollback.completed'],'v2',2,$1,$1)`, now)
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `INSERT INTO webhook_signing_secrets(id,project_id,webhook_destination_id,status,envelope_version,algorithm,key_id,
		nonce,ciphertext,fingerprint,created_at) VALUES('secret_v2','project_one','destination_v2','active',1,'AES-256-GCM','test',
		decode(repeat('01',12),'hex'),decode(repeat('02',32),'hex'),decode(repeat('03',32),'hex'),$1)`, now)
	if err != nil {
		t.Fatal(err)
	}
	readiness, err := billingwebhookpostgres.New(pool).DestinationReadiness(ctx, "project_one", "environment_one", now.Add(-time.Hour))
	if err != nil || readiness.Ready() {
		t.Fatalf("unproven destination readiness=%#v err=%v", readiness, err)
	}
	_, err = pool.Exec(ctx, `UPDATE webhook_destinations SET last_successful_test_at=$2 WHERE id=$1`, `destination_v2`, now)
	if err != nil {
		t.Fatal(err)
	}
	readiness, err = billingwebhookpostgres.New(pool).DestinationReadiness(ctx, "project_one", "environment_one", now.Add(-time.Hour))
	if err != nil || readiness.Ready() {
		t.Fatalf("test timestamp incorrectly counted as authority proof readiness=%#v err=%v", readiness, err)
	}
	_, err = pool.Exec(ctx, `UPDATE webhook_destinations SET last_successful_test_at=NULL WHERE id=$1`, `destination_v2`)
	if err != nil {
		t.Fatal(err)
	}
	rows, err := pool.Query(ctx, `SELECT id FROM billing_migration_authority_scopes WHERE active_program_id='program_ready' ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	var scopes []string
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		scopes = append(scopes, id)
	}
	rows.Close()
	for index, scopeID := range scopes {
		transitionID := "transition_rollback_" + string(rune('a'+index))
		_, err = pool.Exec(ctx, `INSERT INTO billing_migration_authority_transitions(id,program_id,project_id,authority_scope_id,
			from_authority,to_authority,from_epoch,to_epoch,transition_kind,transition_digest,transitioned_at)
			VALUES($1,'program_ready','project_one',$2,'mosaic','source_rollback',1,2,'rollback',decode(repeat('ab',32),'hex'),$3)`,
			transitionID, scopeID, now)
		if err != nil {
			t.Fatal(err)
		}
		_, err = pool.Exec(ctx, `INSERT INTO billing_migration_transition_outbox(id,program_id,project_id,authority_scope_id,transition_id,event_kind,
			authority_epoch,status,created_at,updated_at) VALUES($4,'program_ready','project_one',$2,$1,'rollback_changed',2,'pending',$3,$3)`,
			transitionID, scopeID, now, "outbox_rollback_"+string(rune('a'+index)))
		if err != nil {
			t.Fatal(err)
		}
	}
	repository := billingmigrationpostgres.New(pool)
	service := billingmigration.NewTransitionDeliveryService(repository, func() time.Time { return now.Add(time.Second) })
	for range scopes {
		processed, processErr := service.ProcessOne(ctx, "transition-worker")
		if processErr != nil || !processed {
			t.Fatalf("process transition=%v err=%v", processed, processErr)
		}
	}
	// Force the event insert to fail after leasing. The outbox must return to a
	// due retry without creating a partial event or touching authority state.
	_, _, err = service.Append(ctx, billingmigration.AppendTransition{ID: "outbox_forced_failure", ProgramID: "program_ready",
		ProjectID: "project_one", AuthorityScopeID: scopes[0], CheckpointID: "checkpoint_execute",
		EventKind: billingmigration.TransitionCutoverPending, CorrelationID: "checkpoint_execute_failure",
		AuthorityEpoch: 0, CreatedAt: now.Add(500 * time.Millisecond), DueAt: now})
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `CREATE FUNCTION fail_test_transition_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced transition event failure'; END $$`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `CREATE TRIGGER fail_test_transition_event BEFORE INSERT ON webhook_events FOR EACH ROW WHEN (NEW.transition_outbox_id='outbox_forced_failure') EXECUTE FUNCTION fail_test_transition_event()`)
	if err != nil {
		t.Fatal(err)
	}
	var authorityBefore []byte
	if err = pool.QueryRow(ctx, `SELECT authority_digest FROM billing_migration_authority_scopes WHERE id=$1`, scopes[0]).Scan(&authorityBefore); err != nil {
		t.Fatal(err)
	}
	processed, forcedErr := service.ProcessOne(ctx, "failure-worker")
	if !processed || forcedErr == nil {
		t.Fatalf("forced failure processed=%v err=%v", processed, forcedErr)
	}
	var retryStatus string
	var partialEvents int
	var authorityAfter []byte
	if err = pool.QueryRow(ctx, `SELECT status FROM billing_migration_transition_outbox WHERE id='outbox_forced_failure'`).Scan(&retryStatus); err != nil {
		t.Fatal(err)
	}
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM webhook_events WHERE transition_outbox_id='outbox_forced_failure'`).Scan(&partialEvents); err != nil {
		t.Fatal(err)
	}
	if err = pool.QueryRow(ctx, `SELECT authority_digest FROM billing_migration_authority_scopes WHERE id=$1`, scopes[0]).Scan(&authorityAfter); err != nil {
		t.Fatal(err)
	}
	if retryStatus != "pending" || partialEvents != 0 || !bytes.Equal(authorityBefore, authorityAfter) {
		t.Fatalf("forced failure status=%s events=%d authorityChanged=%v", retryStatus, partialEvents, !bytes.Equal(authorityBefore, authorityAfter))
	}
	_, _ = pool.Exec(ctx, `DROP TRIGGER fail_test_transition_event ON webhook_events`)
	_, _ = pool.Exec(ctx, `DROP FUNCTION fail_test_transition_event()`)
	var events, absent, v1Deliveries, v2Deliveries int
	err = pool.QueryRow(ctx, `SELECT
		(SELECT count(*) FROM webhook_events WHERE project_id='project_one' AND contract_version=2 AND event_type='authority.rollback.completed'),
		(SELECT count(*) FROM webhook_events WHERE project_id='project_one' AND contract_version=2 AND snapshot_version=0 AND customer_entitlement_snapshot_id IS NULL),
		(SELECT count(*) FROM webhook_deliveries WHERE webhook_destination_id='destination_v1'),
		(SELECT count(*) FROM webhook_deliveries WHERE webhook_destination_id='destination_v2')`).Scan(&events, &absent, &v1Deliveries, &v2Deliveries)
	if err != nil || events != 2 || absent != 1 || v1Deliveries != 0 || v2Deliveries != 2 {
		t.Fatalf("events=%d absent=%d v1=%d v2=%d err=%v", events, absent, v1Deliveries, v2Deliveries, err)
	}
	var eventID, deliveryID string
	var body, digest []byte
	err = pool.QueryRow(ctx, `SELECT event.id,event.payload_bytes,event.payload_digest,delivery.id FROM webhook_events event
		JOIN webhook_deliveries delivery ON delivery.webhook_event_id=event.id WHERE event.contract_version=2 ORDER BY event.id LIMIT 1`).Scan(&eventID, &body, &digest, &deliveryID)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(body)
	if !bytes.Equal(digest, sum[:]) {
		t.Fatal("stored event digest does not cover exact bytes")
	}
	_, err = pool.Exec(ctx, `UPDATE webhook_deliveries SET status='succeeded',next_attempt_at=NULL,completed_at=$2,updated_at=$2 WHERE id=$1`, deliveryID, now)
	if err != nil {
		t.Fatal(err)
	}
	redeliveryService := billingmigration.NewRedeliveryService(repository, func() time.Time { return now.Add(2 * time.Second) })
	input := billingmigration.RedeliveryInput{ProjectID: "project_one", ProgramID: "program_ready", EventID: eventID,
		DestinationID: "destination_v2", IdempotencyKey: "redelivery-1", ExpectedStateVersion: 6,
		ExpectedEventDigest: billingmigration.FormatDigest(digest), Reason: "Replay the exact stored transition event after receiver recovery"}
	if _, _, deniedErr := redeliveryService.Redeliver(ctx, billingmigration.Actor{ID: "member_redelivery"}, input); !errors.Is(deniedErr, billingmigration.ErrForbidden) {
		t.Fatalf("capability error=%v", deniedErr)
	}
	staleState := input
	staleState.IdempotencyKey = "redelivery-stale-state"
	staleState.ExpectedStateVersion = 5
	if _, _, staleErr := redeliveryService.Redeliver(ctx, billingmigration.Actor{ID: "owner_one"}, staleState); !errors.Is(staleErr, billingmigration.ErrStaleState) {
		t.Fatalf("stale state error=%v", staleErr)
	}
	staleDigest := input
	staleDigest.IdempotencyKey = "redelivery-stale-digest"
	staleDigest.ExpectedEventDigest = "sha256:" + string(bytes.Repeat([]byte{'a'}, 64))
	if _, _, staleErr := redeliveryService.Redeliver(ctx, billingmigration.Actor{ID: "owner_one"}, staleDigest); !errors.Is(staleErr, billingmigration.ErrStaleDigest) {
		t.Fatalf("stale digest error=%v", staleErr)
	}
	wrongDestination := input
	wrongDestination.IdempotencyKey = "redelivery-v1-destination"
	wrongDestination.DestinationID = "destination_v1"
	if _, _, tenantErr := redeliveryService.Redeliver(ctx, billingmigration.Actor{ID: "owner_one"}, wrongDestination); !errors.Is(tenantErr, billingmigration.ErrNotFound) {
		t.Fatalf("destination contract isolation error=%v", tenantErr)
	}
	redelivery, replay, err := redeliveryService.Redeliver(ctx, billingmigration.Actor{ID: "owner_one"}, input)
	if err != nil || replay || redelivery.DeliveryID != deliveryID {
		t.Fatalf("redelivery=%#v replay=%v err=%v", redelivery, replay, err)
	}
	replayed, replay, err := redeliveryService.Redeliver(ctx, billingmigration.Actor{ID: "owner_one"}, input)
	if err != nil || !replay || replayed.ID != redelivery.ID {
		t.Fatalf("redelivery replay=%#v replay=%v err=%v", replayed, replay, err)
	}
	different := input
	different.Reason = "A different command using the same key"
	if _, _, err = redeliveryService.Redeliver(ctx, billingmigration.Actor{ID: "owner_one"}, different); !errors.Is(err, billingmigration.ErrIdempotencyConflict) {
		t.Fatalf("different redelivery error=%v", err)
	}
	var leasedBody []byte
	found := false
	for attempt := 0; attempt < len(scopes); attempt++ {
		leased, ok, leaseErr := billingwebhookpostgres.New(pool).LeaseDelivery(ctx, "delivery-worker", now.Add(3*time.Second), now.Add(time.Minute))
		if leaseErr != nil || !ok {
			t.Fatalf("lease %d ok=%v err=%v", attempt, ok, leaseErr)
		}
		if leased.Delivery.ID == deliveryID {
			leasedBody, found = leased.Body, true
			break
		}
	}
	if !found || !bytes.Equal(leasedBody, body) {
		t.Fatal("redelivery did not lease the exact stored event bytes")
	}
	_, err = pool.Exec(ctx, `INSERT INTO webhook_delivery_attempts(id,project_id,webhook_event_id,webhook_destination_id,
		webhook_delivery_id,attempt_number,max_attempts,outcome,attempted_at) VALUES('attempt_ready','project_one',$1,
		'destination_v2',$2,1,8,'delivered',$3)`, eventID, deliveryID, now)
	if err != nil {
		t.Fatal(err)
	}
	readiness, err = billingwebhookpostgres.New(pool).DestinationReadiness(ctx, "project_one", "environment_one", now.Add(-time.Hour))
	if err != nil || !readiness.Ready() || readiness.HealthyV2Count != 1 {
		t.Fatalf("proven readiness=%#v err=%v", readiness, err)
	}

	// Stale generations cannot settle another worker's lease; an exhausted row
	// becomes terminal without being leased again.
	_, err = pool.Exec(ctx, `UPDATE billing_migration_transition_outbox SET status='running',lease_owner='live-worker',
		lease_expires_at=$2,lease_generation=9,attempt_count=1,max_attempts=8,due_at=$1 WHERE id='outbox_forced_failure'`, now, now.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if staleErr := repository.FailTransition(ctx, billingmigration.TransitionFailure{OutboxID: "outbox_forced_failure", LeaseOwner: "live-worker", LeaseGeneration: 8, ErrorCode: "stale", RetryAt: now, FailedAt: now}); !errors.Is(staleErr, billingmigration.ErrConflict) {
		t.Fatalf("stale lease error=%v", staleErr)
	}
	_, err = pool.Exec(ctx, `UPDATE billing_migration_transition_outbox SET status='pending',lease_owner=NULL,lease_expires_at=NULL,
		attempt_count=max_attempts,due_at=$1 WHERE id='outbox_forced_failure'`, now)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok, leaseErr := repository.LeaseTransition(ctx, "exhaustion-worker", now, now.Add(time.Minute)); leaseErr != nil || ok {
		t.Fatalf("exhausted lease ok=%v err=%v", ok, leaseErr)
	}
	if err = pool.QueryRow(ctx, `SELECT status FROM billing_migration_transition_outbox WHERE id='outbox_forced_failure'`).Scan(&retryStatus); err != nil || retryStatus != "failed" {
		t.Fatalf("exhausted status=%s err=%v", retryStatus, err)
	}
}

// This migration test catches both destructive downgrade and accidental v1
// incompatibility: a v1-only database can redo 00056, while persisted v2
// destination evidence prevents the down migration before any columns drop.
func TestMigration56V1RedoAndGuardedDown(t *testing.T) {
	ctx, pool, db := executionDatabase(t)
	now := time.Date(2026, 7, 30, 10, 0, 0, 0, time.UTC)
	seedExecutionCheckpoint(t, ctx, db, now)
	_, err := pool.Exec(ctx, `INSERT INTO webhook_destinations(id,project_id,environment_id,url,status,event_types,description,
		created_at,updated_at) VALUES('destination_legacy','project_one','environment_one','https://legacy.example.test','active',
		ARRAY['customer.entitlements.changed'],'legacy',$1,$1)`, now)
	if err != nil {
		t.Fatal(err)
	}
	if err = goose.DownToContext(ctx, db, ".", 55); err != nil {
		t.Fatalf("v1 down: %v", err)
	}
	if err = goose.UpContext(ctx, db, "."); err != nil {
		t.Fatalf("v1 redo: %v", err)
	}
	_, err = pool.Exec(ctx, `UPDATE webhook_destinations SET contract_version=2 WHERE id='destination_legacy'`)
	if err != nil {
		t.Fatal(err)
	}
	err = goose.DownToContext(ctx, db, ".", 55)
	if err == nil {
		t.Fatal("v2 evidence allowed destructive down")
	}
	version, versionErr := goose.GetDBVersionContext(ctx, db)
	if versionErr != nil || version != 56 {
		t.Fatalf("guard left version=%d err=%v down=%v", version, versionErr, err)
	}
}
