package billingmigrationpostgres_test

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingmigration"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingmigrationpostgres"
	"github.com/Mujhtech/mosaic/apps/api/migrations"
)

func TestMain(m *testing.M) {
	code := m.Run()
	if databaseURL := os.Getenv("DATABASE_TEST_URL"); databaseURL != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		pool, err := pgxpool.New(ctx, databaseURL)
		if err == nil {
			_, err = pool.Exec(ctx, `DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public`)
			pool.Close()
		}
		cancel()
		if err != nil && code == 0 {
			code = 1
		}
	}
	os.Exit(code)
}

func TestAuthorityExecutionIsAtomicAndRollbackRestoresCheckpointPointers(t *testing.T) {
	ctx, pool, db := executionDatabase(t)
	now := time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)
	checkpointID, approvalDigest, checkpointDigest := seedExecutionCheckpoint(t, ctx, db, now)
	service := billingmigration.NewService(billingmigrationpostgres.New(pool), nil, nil, billingmigration.WithClock(func() time.Time { return now }))
	scope := billingmigration.Scope{ProjectID: "project_one", EnvironmentID: "environment_one", Applications: []billingmigration.ScopeItem{{ApplicationID: "app_two", Platform: "android"}, {ApplicationID: "app_one", Platform: "ios"}}}
	cutover := billingmigration.ExecuteCutoverInput{ProjectID: "project_one", ProgramID: "program_ready", IdempotencyKey: "execute-cutover", ExpectedStateVersion: 6, Reason: "Production cutover after final owner review", Scope: scope, CheckpointID: checkpointID, ApprovalID: "approval_execute", ExpectedAuthorityEpoch: 0, ExpectedDigests: billingmigration.CutoverCommandDigests{Scope: digestByte(0x61), Manifest: digestByte(0x65), Mapping: digestByte(0x66), Policy: digestByte(0x71), Evidence: digestByte(0x67), Readiness: digestByte(0x88), FinalWatermark: digestByte(0x68), ApplicationVersion: digestByte(0x70), Approval: approvalDigest}}
	staleState := cutover
	staleState.IdempotencyKey = "stale-state"
	staleState.ExpectedStateVersion = 5
	if _, _, staleErr := service.ExecuteCutover(ctx, billingmigration.Actor{ID: "owner_one"}, staleState); !errors.Is(staleErr, billingmigration.ErrStaleState) {
		t.Fatalf("stale state error=%v", staleErr)
	}
	staleDigest := cutover
	staleDigest.IdempotencyKey = "stale-digest"
	staleDigest.ExpectedDigests.Manifest = digestByte(0xff)
	if _, _, staleErr := service.ExecuteCutover(ctx, billingmigration.Actor{ID: "owner_one"}, staleDigest); !errors.Is(staleErr, billingmigration.ErrStaleDigest) {
		t.Fatalf("stale digest error=%v", staleErr)
	}
	staleEpoch := cutover
	staleEpoch.IdempotencyKey = "stale-epoch"
	staleEpoch.ExpectedAuthorityEpoch = 1
	if _, _, staleErr := service.ExecuteCutover(ctx, billingmigration.Actor{ID: "owner_one"}, staleEpoch); !errors.Is(staleErr, billingmigration.ErrAuthorityEpoch) {
		t.Fatalf("authority epoch error=%v", staleErr)
	}
	expiredService := billingmigration.NewService(billingmigrationpostgres.New(pool), nil, nil, billingmigration.WithClock(func() time.Time { return now.Add(2 * time.Hour) }))
	expired := cutover
	expired.IdempotencyKey = "expired-approval"
	if _, _, staleErr := expiredService.ExecuteCutover(ctx, billingmigration.Actor{ID: "owner_one"}, expired); !errors.Is(staleErr, billingmigration.ErrExpiredApproval) {
		t.Fatalf("expired approval error=%v", staleErr)
	}
	result, replay, err := service.ExecuteCutover(ctx, billingmigration.Actor{ID: "owner_one"}, cutover)
	if err != nil || replay || result.State != billingmigration.StateStabilizing || result.AuthorityEpoch != 1 || len(result.TransitionIDs) != 2 {
		t.Fatalf("cutover result=%#v replay=%v err=%v", result, replay, err)
	}
	replayed, replay, err := service.ExecuteCutover(ctx, billingmigration.Actor{ID: "owner_one"}, cutover)
	if err != nil || !replay || replayed.ExecutionID != result.ExecutionID || len(replayed.TransitionIDs) != 2 {
		t.Fatalf("cutover replay=%#v replay=%v err=%v", replayed, replay, err)
	}
	different := cutover
	different.Reason = "different reviewed reason"
	if _, _, err = service.ExecuteCutover(ctx, billingmigration.Actor{ID: "owner_one"}, different); !errors.Is(err, billingmigration.ErrIdempotencyConflict) {
		t.Fatalf("different request same key error=%v", err)
	}
	var state string
	var version int64
	var mosaicAuthorities, outbox, audits int
	if err = pool.QueryRow(ctx, `SELECT state,state_version FROM billing_migration_programs WHERE id='program_ready'`).Scan(&state, &version); err != nil || state != "stabilizing" || version != 7 {
		t.Fatalf("program state=%s version=%d err=%v", state, version, err)
	}
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM billing_migration_authority_scopes WHERE active_program_id='program_ready' AND current_authority='mosaic' AND current_epoch=1`).Scan(&mosaicAuthorities); err != nil || mosaicAuthorities != 2 {
		t.Fatalf("mosaic authority count=%d err=%v", mosaicAuthorities, err)
	}
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM billing_migration_transition_outbox WHERE program_id='program_ready' AND event_kind='authority_changed'`).Scan(&outbox); err != nil || outbox != 2 {
		t.Fatalf("cutover outbox=%d err=%v", outbox, err)
	}
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE resource_id='program_ready' AND action='billing.migration.execute_cutover'`).Scan(&audits); err != nil || audits != 1 {
		t.Fatalf("cutover audit=%d err=%v", audits, err)
	}
	var iosPointer, androidPointer string
	if err = pool.QueryRow(ctx, `SELECT current_snapshot_id FROM billing_migration_scope_current_pointers WHERE application_id='app_one' AND platform='ios' AND billing_customer_id='customer_one'`).Scan(&iosPointer); err != nil || iosPointer != "snapshot_activation" {
		t.Fatalf("ios activation pointer=%q err=%v", iosPointer, err)
	}
	if err = pool.QueryRow(ctx, `SELECT current_snapshot_id FROM billing_migration_scope_current_pointers WHERE application_id='app_two' AND platform='android' AND billing_customer_id='customer_one'`).Scan(&androidPointer); err != nil || androidPointer != "snapshot_activation" {
		t.Fatalf("android activation pointer=%q err=%v", androidPointer, err)
	}

	if _, err = pool.Exec(ctx, `INSERT INTO billing_migration_validation_attempts(id,program_id,project_id,attempt_kind,status,record_count,result_digest,attempted_at) VALUES('validation_source_execute','program_ready','project_one','source_validation','succeeded',1,decode(repeat('93',32),'hex'),$1),('validation_provider_execute','program_ready','project_one','provider_validation','succeeded',1,decode(repeat('94',32),'hex'),$1)`, now); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO billing_migration_scope_current_pointers(project_id,environment_id,application_id,platform,billing_customer_id,current_snapshot_id,authority_epoch,updated_at) VALUES('project_one','environment_one','app_one','ios','customer_two','snapshot_mosaic_only',1,$1)`, now); err != nil {
		t.Fatal(err)
	}
	var authorityDigests []string
	rows, err := pool.Query(ctx, `SELECT authority_digest FROM billing_migration_authority_scopes WHERE active_program_id='program_ready' ORDER BY application_id,platform`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var raw []byte
		if err = rows.Scan(&raw); err != nil {
			t.Fatal(err)
		}
		authorityDigests = append(authorityDigests, billingmigration.FormatDigest(raw))
	}
	rows.Close()
	authoritySet, err := billingmigration.AuthoritySetDigest("program_ready", digestByte(0x61), authorityDigests)
	if err != nil {
		t.Fatal(err)
	}
	var rollbackTransitionID string
	if err = pool.QueryRow(ctx, `SELECT id FROM billing_migration_authority_transitions WHERE program_id='program_ready' AND transition_kind='cutover' ORDER BY id DESC LIMIT 1`).Scan(&rollbackTransitionID); err != nil {
		t.Fatal(err)
	}
	binding := billingmigration.RollbackProposalBinding{CheckpointID: checkpointID, CheckpointDigest: checkpointDigest, AuthorityDigest: authoritySet, ScopeDigest: digestByte(0x61), CutoverTransitionID: rollbackTransitionID, CutoverTransitionDigest: "", CutoverEpoch: 1, CutoverTransitionedAt: now, RollbackDeadline: now.Add(7 * 24 * time.Hour), CredentialID: "credential_ready", CredentialStatus: "active", CapabilityAssessmentID: "capability_ready", CapabilityAssessmentDigest: digestByte(0x72), CapabilityAssessedAt: now.Add(-time.Minute), SourceValidationID: "validation_source_execute", SourceValidationDigest: digestByte(0x93), SourceValidatedAt: now, ProviderValidationID: "validation_provider_execute", ProviderValidationDigest: digestByte(0x94), ProviderValidatedAt: now}
	var transitionRaw []byte
	if err = pool.QueryRow(ctx, `SELECT transition_digest FROM billing_migration_authority_transitions WHERE id=$1`, binding.CutoverTransitionID).Scan(&transitionRaw); err != nil {
		t.Fatal(err)
	}
	binding.CutoverTransitionDigest = billingmigration.FormatDigest(transitionRaw)
	prerequisites, err := billingmigration.RollbackPrerequisitesDigest("program_ready", 7, binding)
	if err != nil {
		t.Fatal(err)
	}
	proposal, _, err := service.ProposeRollback(ctx, billingmigration.Actor{ID: "owner_one"}, billingmigration.ProposeRollbackInput{ProjectID: "project_one", ProgramID: "program_ready", IdempotencyKey: "propose-rollback-execute", CheckpointID: checkpointID, ExpectedStateVersion: 7, ExpectedCheckpointDigest: checkpointDigest, ExpectedAuthorityDigest: authoritySet, ExpectedRollbackPrerequisitesDigest: prerequisites, Reason: "Verified rollback prerequisites and source health", ExpiresAt: now.Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	approval, _, err := service.ApproveCutover(ctx, billingmigration.Actor{ID: "owner_two"}, billingmigration.ApproveCutoverInput{ProjectID: "project_one", ProgramID: "program_ready", ProposalID: proposal.ProposalID, IdempotencyKey: "approve-rollback-execute", ExpectedStateVersion: 7})
	if err != nil {
		t.Fatal(err)
	}
	rollback := billingmigration.ExecuteRollbackInput{ProjectID: "project_one", ProgramID: "program_ready", IdempotencyKey: "execute-rollback", ExpectedStateVersion: 7, ExpectedDigests: billingmigration.RollbackCommandDigests{Checkpoint: checkpointDigest, Authority: authoritySet, RollbackPrerequisites: prerequisites, Approval: approval.ApprovalDigest}, Reason: "Rollback within approved window after source health verification", Scope: scope, CheckpointID: checkpointID, ApprovalID: approval.ApprovalID, ExpectedAuthorityEpoch: 1}
	rolledBack, replay, err := service.ExecuteRollback(ctx, billingmigration.Actor{ID: "owner_one"}, rollback)
	if err != nil || replay || rolledBack.State != "rolled_back" || rolledBack.AuthorityEpoch != 2 || len(rolledBack.TransitionIDs) != 2 {
		t.Fatalf("rollback=%#v replay=%v err=%v", rolledBack, replay, err)
	}
	if err = pool.QueryRow(ctx, `SELECT current_snapshot_id FROM billing_migration_scope_current_pointers WHERE application_id='app_one' AND platform='ios' AND billing_customer_id='customer_one'`).Scan(&iosPointer); err != nil || iosPointer != "snapshot_baseline" {
		t.Fatalf("restored ios baseline=%q err=%v", iosPointer, err)
	}
	var removed int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM billing_migration_scope_current_pointers WHERE (application_id='app_two' AND billing_customer_id='customer_one') OR billing_customer_id='customer_two'`).Scan(&removed); err != nil || removed != 0 {
		t.Fatalf("absent/mosaic-only pointers remaining=%d err=%v", removed, err)
	}
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM billing_migration_transition_outbox WHERE program_id='program_ready' AND event_kind='rollback_changed'`).Scan(&outbox); err != nil || outbox != 2 {
		t.Fatalf("rollback outbox=%d err=%v", outbox, err)
	}
}

func TestCutoverAuditFailureRollsBackEveryWrite(t *testing.T) {
	ctx, pool, db := executionDatabase(t)
	now := time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)
	checkpointID, approvalDigest, _ := seedExecutionCheckpoint(t, ctx, db, now)
	if _, err := pool.Exec(ctx, `CREATE FUNCTION reject_execution_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='billing.migration.execute_cutover' THEN RAISE EXCEPTION 'forced audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_execution_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_execution_audit()`); err != nil {
		t.Fatal(err)
	}
	service := billingmigration.NewService(billingmigrationpostgres.New(pool), nil, nil, billingmigration.WithClock(func() time.Time { return now }))
	input := executionCutoverInput(checkpointID, approvalDigest, "atomic-failure")
	if _, _, err := service.ExecuteCutover(ctx, billingmigration.Actor{ID: "owner_one"}, input); err == nil {
		t.Fatal("forced audit failure accepted")
	}
	var state, pointer string
	var version, epoch, transitions, outbox, idempotency int64
	if err := pool.QueryRow(ctx, `SELECT state,state_version FROM billing_migration_programs WHERE id='program_ready'`).Scan(&state, &version); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT current_authority,current_epoch FROM billing_migration_authority_scopes WHERE id='authority_ready_ios'`).Scan(&pointer, &epoch); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM billing_migration_authority_transitions WHERE program_id='program_ready'`).Scan(&transitions); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM billing_migration_transition_outbox WHERE program_id='program_ready'`).Scan(&outbox); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM billing_migration_command_idempotency WHERE program_id='program_ready' AND command_kind='execute_cutover'`).Scan(&idempotency); err != nil {
		t.Fatal(err)
	}
	if state != "cutover_pending" || version != 6 || pointer != "source" || epoch != 0 || transitions != 0 || outbox != 0 || idempotency != 0 {
		t.Fatalf("partial failure state=%s/%d authority=%s/%d transitions=%d outbox=%d idempotency=%d", state, version, pointer, epoch, transitions, outbox, idempotency)
	}
}

func TestCutoverRejectsSameCardinalityCorruptedCheckpointMap(t *testing.T) {
	ctx, pool, db := executionDatabase(t)
	now := time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)
	checkpointID, approvalDigest, _ := seedExecutionCheckpoint(t, ctx, db, now)
	if _, err := pool.Exec(ctx, `ALTER TABLE billing_migration_checkpoint_pointer_maps DISABLE TRIGGER billing_migration_checkpoint_maps_immutable; DELETE FROM billing_migration_checkpoint_pointer_maps WHERE id='map_android_baseline'; INSERT INTO billing_migration_checkpoint_pointer_maps(id,checkpoint_id,program_id,project_id,environment_id,application_id,platform,billing_customer_id,pointer_role,snapshot_id,absent_current,pointer_digest) VALUES('map_noncohort_baseline','checkpoint_execute','program_ready','project_one','environment_one','app_two','android','customer_two','rollback_baseline','snapshot_mosaic_only',false,decode(repeat('77',32),'hex')); ALTER TABLE billing_migration_checkpoint_pointer_maps ENABLE TRIGGER billing_migration_checkpoint_maps_immutable`); err != nil {
		t.Fatal(err)
	}
	service := billingmigration.NewService(billingmigrationpostgres.New(pool), nil, nil, billingmigration.WithClock(func() time.Time { return now }))
	if _, _, err := service.ExecuteCutover(ctx, billingmigration.Actor{ID: "owner_one"}, executionCutoverInput(checkpointID, approvalDigest, "corrupted-map")); !errors.Is(err, billingmigration.ErrPointerCoverage) {
		t.Fatalf("same-cardinality corrupted map error=%v", err)
	}
	var state string
	var transitions int
	if err := pool.QueryRow(ctx, `SELECT state FROM billing_migration_programs WHERE id='program_ready'`).Scan(&state); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM billing_migration_authority_transitions WHERE program_id='program_ready'`).Scan(&transitions); err != nil {
		t.Fatal(err)
	}
	if state != "cutover_pending" || transitions != 0 {
		t.Fatalf("corrupt map changed state=%s transitions=%d", state, transitions)
	}
}

func TestCutoverRejectsExecuteTimeReadinessDrift(t *testing.T) {
	tests := []struct{ name, mutation string }{{"final watermark drift", `INSERT INTO billing_migration_final_deltas(id,program_id,project_id,state_version,manifest_digest,mapping_digest,evidence_digest,final_watermark_digest,source_watermark,provider_watermark,shadow_watermark,delta_digest,completed_at) VALUES('delta_drift','program_ready','project_one',6,decode(repeat('65',32),'hex'),decode(repeat('66',32),'hex'),decode(repeat('67',32),'hex'),decode(repeat('aa',32),'hex'),$1,$1,$1,decode(repeat('ab',32),'hex'),$1+interval '1 second')`}, {"stale watermarks", `INSERT INTO billing_migration_final_deltas(id,program_id,project_id,state_version,manifest_digest,mapping_digest,evidence_digest,final_watermark_digest,source_watermark,provider_watermark,shadow_watermark,delta_digest,completed_at) VALUES('delta_stale','program_ready','project_one',6,decode(repeat('65',32),'hex'),decode(repeat('66',32),'hex'),decode(repeat('67',32),'hex'),decode(repeat('68',32),'hex'),$1-interval '2 hours',$1-interval '2 hours',$1-interval '2 hours',decode(repeat('ac',32),'hex'),$1+interval '1 second')`}, {"unresolved blocking case", `INSERT INTO billing_migration_cases(id,program_id,project_id,state_version,classification,status,reason,case_digest,opened_at) VALUES('case_execute_drift','program_ready','project_one',6,'blocking','open','new blocking divergence',decode(repeat('ad',32),'hex'),$1)`}, {"expired exception", `INSERT INTO billing_migration_cases(id,program_id,project_id,state_version,classification,status,reason,case_digest,opened_at) VALUES('case_expired_execute','program_ready','project_one',6,'blocking','open','exception expired',decode(repeat('ae',32),'hex'),$1-interval '2 hours'); INSERT INTO billing_migration_source_access_exceptions(id,case_id,program_id,project_id,application_id,platform,reason,affected_customer_count,rollback_treatment,identity_ambiguity_count,proposer_actor_id,approver_actor_id,approved_at,expires_at,exception_digest) VALUES('exception_expired_execute','case_expired_execute','program_ready','project_one','app_one','ios','temporarily approved',1,'restore source',0,'owner_one','owner_two',$1-interval '2 hours',$1-interval '1 second',decode(repeat('af',32),'hex'))`}}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			ctx, pool, db := executionDatabase(t)
			now := time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)
			checkpointID, approvalDigest, _ := seedExecutionCheckpoint(t, ctx, db, now)
			statement := strings.ReplaceAll(test.mutation, "$1", "TIMESTAMPTZ '"+now.Format(time.RFC3339)+"'")
			if _, err := db.ExecContext(ctx, statement); err != nil {
				t.Fatal(err)
			}
			service := billingmigration.NewService(billingmigrationpostgres.New(pool), nil, nil, billingmigration.WithClock(func() time.Time { return now }))
			if _, _, err := service.ExecuteCutover(ctx, billingmigration.Actor{ID: "owner_one"}, executionCutoverInput(checkpointID, approvalDigest, "drift-"+test.name)); !errors.Is(err, billingmigration.ErrStaleDigest) {
				t.Fatalf("execute-time drift error=%v", err)
			}
		})
	}
}

func TestRollbackAuditFailureRollsBackEveryWrite(t *testing.T) {
	ctx, pool, _, service, input := prepareRollbackExecution(t)
	if _, err := pool.Exec(ctx, `CREATE FUNCTION reject_rollback_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='billing.migration.execute_rollback' THEN RAISE EXCEPTION 'forced rollback audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_rollback_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_rollback_audit()`); err != nil {
		t.Fatal(err)
	}
	if _, _, err := service.ExecuteRollback(ctx, billingmigration.Actor{ID: "owner_one"}, input); err == nil {
		t.Fatal("forced rollback audit failure accepted")
	}
	var state, ios, android, mosaicOnly string
	var version, authorities, transitions, outbox, idempotency int
	if err := pool.QueryRow(ctx, `SELECT state,state_version FROM billing_migration_programs WHERE id='program_ready'`).Scan(&state, &version); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT current_snapshot_id FROM billing_migration_scope_current_pointers WHERE application_id='app_one' AND billing_customer_id='customer_one'`).Scan(&ios); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT current_snapshot_id FROM billing_migration_scope_current_pointers WHERE application_id='app_two' AND billing_customer_id='customer_one'`).Scan(&android); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT current_snapshot_id FROM billing_migration_scope_current_pointers WHERE application_id='app_one' AND billing_customer_id='customer_two'`).Scan(&mosaicOnly); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM billing_migration_authority_scopes WHERE active_program_id='program_ready' AND current_authority='mosaic' AND current_epoch=1),(SELECT count(*) FROM billing_migration_authority_transitions WHERE program_id='program_ready' AND transition_kind='rollback'),(SELECT count(*) FROM billing_migration_transition_outbox WHERE program_id='program_ready' AND event_kind='rollback_changed'),(SELECT count(*) FROM billing_migration_command_idempotency WHERE program_id='program_ready' AND command_kind='execute_rollback')`).Scan(&authorities, &transitions, &outbox, &idempotency); err != nil {
		t.Fatal(err)
	}
	if state != "stabilizing" || version != 7 || ios != "snapshot_activation" || android != "snapshot_activation" || mosaicOnly != "snapshot_mosaic_only" || authorities != 2 || transitions != 0 || outbox != 0 || idempotency != 0 {
		t.Fatalf("partial rollback state=%s/%d pointers=%s,%s,%s authorities=%d transitions=%d outbox=%d idempotency=%d", state, version, ios, android, mosaicOnly, authorities, transitions, outbox, idempotency)
	}
}

func TestRollbackRejectsExecuteTimePrerequisiteDrift(t *testing.T) {
	tests := []struct{ name, mutation string }{{"credential", `UPDATE billing_migration_credentials SET status='revoked',revoked_at=$1 WHERE id='credential_ready'`}, {"capability", `INSERT INTO billing_migration_capability_assessments(id,program_id,project_id,state_version,provider_api_version,capabilities,assessment_digest,assessed_at) VALUES('capability_drift','program_ready','project_one',7,'v2',ARRAY['read_customers'],decode(repeat('b1',32),'hex'),$1+interval '1 second')`}, {"source health", `INSERT INTO billing_migration_validation_attempts(id,program_id,project_id,attempt_kind,status,record_count,result_digest,attempted_at) VALUES('source_drift','program_ready','project_one','source_validation','succeeded',1,decode(repeat('b2',32),'hex'),$1+interval '1 second')`}, {"provider health", `INSERT INTO billing_migration_validation_attempts(id,program_id,project_id,attempt_kind,status,record_count,result_digest,attempted_at) VALUES('provider_drift','program_ready','project_one','provider_validation','succeeded',1,decode(repeat('b3',32),'hex'),$1+interval '1 second')`}}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			ctx, pool, db, service, input := prepareRollbackExecution(t)
			statement := strings.ReplaceAll(test.mutation, "$1", "TIMESTAMPTZ '2026-07-29T12:00:00Z'")
			if _, err := db.ExecContext(ctx, statement); err != nil {
				t.Fatal(err)
			}
			if _, _, err := service.ExecuteRollback(ctx, billingmigration.Actor{ID: "owner_one"}, input); !errors.Is(err, billingmigration.ErrRollbackPrerequisite) {
				t.Fatalf("rollback prerequisite drift error=%v", err)
			}
			var state string
			if err := pool.QueryRow(ctx, `SELECT state FROM billing_migration_programs WHERE id='program_ready'`).Scan(&state); err != nil || state != "stabilizing" {
				t.Fatalf("drift changed state=%s err=%v", state, err)
			}
		})
	}
}

func TestConcurrentSameCutoverCommandCommitsOnceAndReplays(t *testing.T) {
	ctx, pool, db := executionDatabase(t)
	now := time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)
	checkpointID, approvalDigest, _ := seedExecutionCheckpoint(t, ctx, db, now)
	service := billingmigration.NewService(billingmigrationpostgres.New(pool), nil, nil, billingmigration.WithClock(func() time.Time { return now }))
	input := executionCutoverInput(checkpointID, approvalDigest, "concurrent-key")
	type outcome struct {
		replay bool
		err    error
	}
	results := make(chan outcome, 2)
	var start sync.WaitGroup
	start.Add(1)
	for i := 0; i < 2; i++ {
		go func() {
			start.Wait()
			_, replay, err := service.ExecuteCutover(ctx, billingmigration.Actor{ID: "owner_one"}, input)
			results <- outcome{replay, err}
		}()
	}
	start.Done()
	first, second := <-results, <-results
	if first.err != nil || second.err != nil || first.replay == second.replay {
		t.Fatalf("concurrent outcomes first=%#v second=%#v", first, second)
	}
	var transitions, outbox int
	if err := pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM billing_migration_authority_transitions WHERE program_id='program_ready'),(SELECT count(*) FROM billing_migration_transition_outbox WHERE program_id='program_ready')`).Scan(&transitions, &outbox); err != nil || transitions != 2 || outbox != 2 {
		t.Fatalf("concurrent cardinality transitions=%d outbox=%d err=%v", transitions, outbox, err)
	}
}

func executionCutoverInput(checkpointID, approvalDigest, key string) billingmigration.ExecuteCutoverInput {
	return billingmigration.ExecuteCutoverInput{ProjectID: "project_one", ProgramID: "program_ready", IdempotencyKey: key, ExpectedStateVersion: 6, Reason: "Production cutover after final owner review", Scope: billingmigration.Scope{ProjectID: "project_one", EnvironmentID: "environment_one", Applications: []billingmigration.ScopeItem{{ApplicationID: "app_two", Platform: "android"}, {ApplicationID: "app_one", Platform: "ios"}}}, CheckpointID: checkpointID, ApprovalID: "approval_execute", ExpectedAuthorityEpoch: 0, ExpectedDigests: billingmigration.CutoverCommandDigests{Scope: digestByte(0x61), Manifest: digestByte(0x65), Mapping: digestByte(0x66), Policy: digestByte(0x71), Evidence: digestByte(0x67), Readiness: digestByte(0x88), FinalWatermark: digestByte(0x68), ApplicationVersion: digestByte(0x70), Approval: approvalDigest}}
}

func prepareRollbackExecution(t *testing.T) (context.Context, *pgxpool.Pool, *sql.DB, *billingmigration.Service, billingmigration.ExecuteRollbackInput) {
	t.Helper()
	ctx, pool, db := executionDatabase(t)
	now := time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)
	checkpointID, approvalDigest, checkpointDigest := seedExecutionCheckpoint(t, ctx, db, now)
	service := billingmigration.NewService(billingmigrationpostgres.New(pool), nil, nil, billingmigration.WithClock(func() time.Time { return now }))
	cutoverResult, _, err := service.ExecuteCutover(ctx, billingmigration.Actor{ID: "owner_one"}, executionCutoverInput(checkpointID, approvalDigest, "prepare-rollback"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO billing_migration_validation_attempts(id,program_id,project_id,attempt_kind,status,record_count,result_digest,attempted_at) VALUES('validation_source_execute','program_ready','project_one','source_validation','succeeded',1,decode(repeat('93',32),'hex'),$1),('validation_provider_execute','program_ready','project_one','provider_validation','succeeded',1,decode(repeat('94',32),'hex'),$1)`, now); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO billing_migration_scope_current_pointers(project_id,environment_id,application_id,platform,billing_customer_id,current_snapshot_id,authority_epoch,updated_at) VALUES('project_one','environment_one','app_one','ios','customer_two','snapshot_mosaic_only',1,$1)`, now); err != nil {
		t.Fatal(err)
	}
	var authorityDigests []string
	rows, err := pool.Query(ctx, `SELECT authority_digest FROM billing_migration_authority_scopes WHERE active_program_id='program_ready' ORDER BY application_id,platform`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var raw []byte
		if err = rows.Scan(&raw); err != nil {
			t.Fatal(err)
		}
		authorityDigests = append(authorityDigests, billingmigration.FormatDigest(raw))
	}
	rows.Close()
	authoritySet, err := billingmigration.AuthoritySetDigest("program_ready", digestByte(0x61), authorityDigests)
	if err != nil {
		t.Fatal(err)
	}
	var transitionID string
	var transitionRaw []byte
	if err = pool.QueryRow(ctx, `SELECT id,transition_digest FROM billing_migration_authority_transitions WHERE program_id='program_ready' AND transition_kind='cutover' ORDER BY id DESC LIMIT 1`).Scan(&transitionID, &transitionRaw); err != nil {
		t.Fatal(err)
	}
	binding := billingmigration.RollbackProposalBinding{CheckpointID: checkpointID, CheckpointDigest: checkpointDigest, AuthorityDigest: authoritySet, ScopeDigest: digestByte(0x61), CutoverTransitionID: transitionID, CutoverTransitionDigest: billingmigration.FormatDigest(transitionRaw), CutoverEpoch: 1, CutoverTransitionedAt: cutoverResult.ExecutedAt, RollbackDeadline: now.Add(7 * 24 * time.Hour), CredentialID: "credential_ready", CredentialStatus: "active", CapabilityAssessmentID: "capability_ready", CapabilityAssessmentDigest: digestByte(0x72), CapabilityAssessedAt: now.Add(-time.Minute), SourceValidationID: "validation_source_execute", SourceValidationDigest: digestByte(0x93), SourceValidatedAt: now, ProviderValidationID: "validation_provider_execute", ProviderValidationDigest: digestByte(0x94), ProviderValidatedAt: now}
	prerequisites, err := billingmigration.RollbackPrerequisitesDigest("program_ready", 7, binding)
	if err != nil {
		t.Fatal(err)
	}
	proposal, _, err := service.ProposeRollback(ctx, billingmigration.Actor{ID: "owner_one"}, billingmigration.ProposeRollbackInput{ProjectID: "project_one", ProgramID: "program_ready", IdempotencyKey: "prepare-rollback-proposal", CheckpointID: checkpointID, ExpectedStateVersion: 7, ExpectedCheckpointDigest: checkpointDigest, ExpectedAuthorityDigest: authoritySet, ExpectedRollbackPrerequisitesDigest: prerequisites, Reason: "Verified rollback prerequisites and source health", ExpiresAt: now.Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	approval, _, err := service.ApproveCutover(ctx, billingmigration.Actor{ID: "owner_two"}, billingmigration.ApproveCutoverInput{ProjectID: "project_one", ProgramID: "program_ready", ProposalID: proposal.ProposalID, IdempotencyKey: "prepare-rollback-approval", ExpectedStateVersion: 7})
	if err != nil {
		t.Fatal(err)
	}
	input := billingmigration.ExecuteRollbackInput{ProjectID: "project_one", ProgramID: "program_ready", IdempotencyKey: "execute-rollback-under-test", ExpectedStateVersion: 7, ExpectedDigests: billingmigration.RollbackCommandDigests{Checkpoint: checkpointDigest, Authority: authoritySet, RollbackPrerequisites: prerequisites, Approval: approval.ApprovalDigest}, Reason: "Rollback within approved window after source health verification", Scope: billingmigration.Scope{ProjectID: "project_one", EnvironmentID: "environment_one", Applications: []billingmigration.ScopeItem{{ApplicationID: "app_two", Platform: "android"}, {ApplicationID: "app_one", Platform: "ios"}}}, CheckpointID: checkpointID, ApprovalID: approval.ApprovalID, ExpectedAuthorityEpoch: 1}
	return ctx, pool, db, service, input
}

func executionDatabase(t *testing.T) (context.Context, *pgxpool.Pool, *sql.DB) {
	t.Helper()
	url := os.Getenv("DATABASE_TEST_URL")
	if url == "" {
		t.Skip("DATABASE_TEST_URL is required for PostgreSQL integration tests")
	}
	configuration, err := pgx.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	db := stdlib.OpenDB(*configuration)
	t.Cleanup(func() { _ = db.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	t.Cleanup(cancel)
	if _, err = db.ExecContext(ctx, `DROP SCHEMA public CASCADE; CREATE SCHEMA public`); err != nil {
		t.Fatal(err)
	}
	goose.SetBaseFS(migrations.Files)
	if err = goose.SetDialect("postgres"); err != nil {
		t.Fatal(err)
	}
	if err = goose.UpContext(ctx, db, "."); err != nil {
		t.Fatal(err)
	}
	seedMigrationTenant(t, ctx, db)
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return ctx, pool, db
}

func seedExecutionCheckpoint(t *testing.T, ctx context.Context, db *sql.DB, now time.Time) (string, string, string) {
	t.Helper()
	seedReadyProgram(t, ctx, db, now)
	statement := `INSERT INTO organization_members(organization_id,actor_id,role,created_at,updated_at) VALUES('org_one','owner_two','owner',$1,$1); UPDATE billing_migration_programs SET state='cutover_pending',state_version=6 WHERE id='program_ready'; INSERT INTO customer_entitlement_snapshots(id,project_id,environment_id,billing_customer_id,snapshot_version,rule_version,computed_at,as_of,checksum,change_reason,created_at) VALUES('snapshot_mosaic_only','project_one','environment_one','customer_two',1,1,$1,$1,decode(repeat('97',32),'hex'),'migration_postcutover',$1); INSERT INTO billing_migration_readiness_assessments(id,program_id,project_id,state_version,ready,current_access_mapping_percent,current_access_evidence_percent,critical_count,blocking_count,warning_count,informational_count,final_delta_completed,watermarks_fresh,supported_versions_authority_aware,readiness_digest,assessed_at,authoritative,source_capabilities_fresh,warning_threshold,application_version_digest) VALUES('readiness_execute','program_ready','project_one',5,true,100,100,0,0,0,0,true,true,true,decode(repeat('88',32),'hex'),$1,true,true,0,decode(repeat('70',32),'hex')); INSERT INTO billing_migration_final_delta_cohort_sets(id,final_delta_id,program_id,project_id,customer_count,cohort_digest,frozen_at) VALUES('cohort_execute','delta_ready','program_ready','project_one',1,decode(repeat('98',32),'hex'),$1); INSERT INTO billing_migration_final_delta_cohort_customers(cohort_set_id,program_id,project_id,billing_customer_id,customer_digest) VALUES('cohort_execute','program_ready','project_one','customer_one',decode(repeat('99',32),'hex')); INSERT INTO billing_migration_cutover_proposals(id,program_id,project_id,state_version,command,proposer_actor_id,reason,scope_digest,manifest_digest,mapping_digest,policy_digest,evidence_digest,readiness_digest,final_watermark_digest,application_version_digest,proposal_digest,status,proposed_at,expires_at) VALUES('proposal_execute','program_ready','project_one',5,'cutover','owner_one','reviewed',decode(repeat('61',32),'hex'),decode(repeat('65',32),'hex'),decode(repeat('66',32),'hex'),decode(repeat('71',32),'hex'),decode(repeat('67',32),'hex'),decode(repeat('88',32),'hex'),decode(repeat('68',32),'hex'),decode(repeat('70',32),'hex'),decode(repeat('86',32),'hex'),'approved',$1,$1+interval '1 hour'); INSERT INTO billing_migration_approvals(id,program_id,project_id,proposal_id,state_version,command,proposer_actor_id,approver_actor_id,approval_digest,approved_at,expires_at) VALUES('approval_execute','program_ready','project_one','proposal_execute',5,'cutover','owner_one','owner_two',decode(repeat('89',32),'hex'),$1,$1+interval '1 hour'); INSERT INTO billing_migration_checkpoints(id,program_id,project_id,state_version,authority_epoch,source_watermark,provider_watermark,shadow_watermark,scope_digest,manifest_digest,mapping_digest,policy_digest,evidence_digest,readiness_digest,final_watermark_digest,application_version_digest,approval_digest,checkpoint_digest,created_at,cohort_digest) VALUES('checkpoint_execute','program_ready','project_one',6,0,$1-interval '1 minute',$1-interval '1 minute',$1-interval '1 minute',decode(repeat('61',32),'hex'),decode(repeat('65',32),'hex'),decode(repeat('66',32),'hex'),decode(repeat('71',32),'hex'),decode(repeat('67',32),'hex'),decode(repeat('88',32),'hex'),decode(repeat('68',32),'hex'),decode(repeat('70',32),'hex'),decode(repeat('89',32),'hex'),decode(repeat('8a',32),'hex'),$1,decode(repeat('98',32),'hex')); INSERT INTO billing_migration_checkpoint_pointer_maps(id,checkpoint_id,program_id,project_id,environment_id,application_id,platform,billing_customer_id,pointer_role,snapshot_id,absent_current,pointer_digest) VALUES('map_ios_activate','checkpoint_execute','program_ready','project_one','environment_one','app_one','ios','customer_one','prepared_activation','snapshot_activation',false,decode(repeat('79',32),'hex')),('map_ios_baseline','checkpoint_execute','program_ready','project_one','environment_one','app_one','ios','customer_one','rollback_baseline','snapshot_baseline',false,decode(repeat('78',32),'hex')),('map_android_activate','checkpoint_execute','program_ready','project_one','environment_one','app_two','android','customer_one','prepared_activation','snapshot_activation',false,decode(repeat('79',32),'hex')),('map_android_baseline','checkpoint_execute','program_ready','project_one','environment_one','app_two','android','customer_one','rollback_baseline',NULL,true,decode(repeat('77',32),'hex'));`
	statement = strings.ReplaceAll(statement, "$1", "TIMESTAMPTZ '"+now.Format(time.RFC3339)+"'")
	_, err := db.ExecContext(ctx, statement)
	if err != nil {
		t.Fatal(err)
	}
	return "checkpoint_execute", digestByte(0x89), digestByte(0x8a)
}
func digestByte(value byte) string { return billingmigration.FormatDigest(bytesOf(value)) }
