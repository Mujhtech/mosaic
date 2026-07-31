package billingmigrationpostgres_test

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"strings"
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

func TestCutoverPreparationRequiresAuthoritativeEvidenceAndDistinctProductionApproval(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_TEST_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_TEST_URL is required for PostgreSQL integration tests")
	}
	configuration, err := pgx.ParseConfig(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	db := stdlib.OpenDB(*configuration)
	t.Cleanup(func() { _ = db.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	t.Cleanup(cancel)
	if _, err := db.ExecContext(ctx, `DROP SCHEMA public CASCADE; CREATE SCHEMA public`); err != nil {
		t.Fatal(err)
	}
	goose.SetBaseFS(migrations.Files)
	if err := goose.SetDialect("postgres"); err != nil {
		t.Fatal(err)
	}
	if err := goose.UpContext(ctx, db, "."); err != nil {
		t.Fatalf("apply migrations: %v", err)
	}
	seedMigrationTenant(t, ctx, db)
	if _, err := db.ExecContext(ctx, `INSERT INTO organization_members(organization_id,actor_id,role,created_at,updated_at) VALUES('org_one','owner_two','owner',now(),now())`); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)
	seedReadyProgram(t, ctx, db, now)
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	service := billingmigration.NewService(billingmigrationpostgres.New(pool), nil, nil, billingmigration.WithClock(func() time.Time { return now }))

	if _, err := service.PromoteReady(ctx, billingmigration.Actor{ID: "owner_one"}, billingmigration.PromoteReadyInput{ProjectID: "project_one", ProgramID: "program_ready", ExpectedStateVersion: 3}); !errors.Is(err, billingmigration.ErrConflict) {
		t.Fatalf("stale readiness CAS error = %v", err)
	}
	if _, err := service.PromoteReady(ctx, billingmigration.Actor{ID: "owner_one"}, billingmigration.PromoteReadyInput{ProjectID: "project_one", ProgramID: "program_ready", ExpectedStateVersion: 4}); !errors.Is(err, billingmigration.ErrConflict) {
		t.Fatalf("unsigned current-access evidence error = %v", err)
	}
	insertExceptionFixture(t, ctx, pool, "expired", "app_one", "ios", 1, now.Add(-2*time.Hour), now.Add(-time.Hour))
	if _, err := service.PromoteReady(ctx, billingmigration.Actor{ID: "owner_one"}, billingmigration.PromoteReadyInput{ProjectID: "project_one", ProgramID: "program_ready", ExpectedStateVersion: 4}); !errors.Is(err, billingmigration.ErrConflict) {
		t.Fatalf("expired source-access exception error = %v", err)
	}
	insertExceptionFixture(t, ctx, pool, "wrong_scope", "app_two", "android", 1, now.Add(-time.Minute), now.Add(time.Hour))
	if _, err := service.PromoteReady(ctx, billingmigration.Actor{ID: "owner_one"}, billingmigration.PromoteReadyInput{ProjectID: "project_one", ProgramID: "program_ready", ExpectedStateVersion: 4}); !errors.Is(err, billingmigration.ErrConflict) {
		t.Fatalf("scope-mismatched source-access exception error = %v", err)
	}
	insertExceptionFixture(t, ctx, pool, "overcount", "app_one", "ios", 2, now.Add(-time.Minute), now.Add(time.Hour))
	if _, err := service.PromoteReady(ctx, billingmigration.Actor{ID: "owner_one"}, billingmigration.PromoteReadyInput{ProjectID: "project_one", ProgramID: "program_ready", ExpectedStateVersion: 4}); !errors.Is(err, billingmigration.ErrConflict) {
		t.Fatalf("aggregate-only source-access exception error = %v", err)
	}
	insertExceptionFixture(t, ctx, pool, "valid", "app_one", "ios", 1, now.Add(-time.Minute), now.Add(time.Hour))
	if _, err := service.PromoteReady(ctx, billingmigration.Actor{ID: "owner_one"}, billingmigration.PromoteReadyInput{ProjectID: "project_one", ProgramID: "program_ready", ExpectedStateVersion: 4}); !errors.Is(err, billingmigration.ErrConflict) {
		t.Fatalf("measured app version without v2 observation error = %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO billing_migration_v2_sync_observations(id,program_id,project_id,application_id,platform,app_version,sdk_version,supported_contract_versions,authority_capabilities,traffic_count,authority_epoch,sync_result,observation_digest,observed_at) VALUES('sync_rejected_android','program_ready','project_one','app_two','android','2.10.0+android.1','2.1.0-rc.1',ARRAY['2'],ARRAY['authority_epoch','authority_scope','urgent_authority_sync','mosaic_authoritative_targeting'],10,0,'rejected',decode(repeat('83',32),'hex'),$1)`, now); err != nil {
		t.Fatal(err)
	}
	if _, err := service.PromoteReady(ctx, billingmigration.Actor{ID: "owner_one"}, billingmigration.PromoteReadyInput{ProjectID: "project_one", ProgramID: "program_ready", ExpectedStateVersion: 4}); !errors.Is(err, billingmigration.ErrConflict) {
		t.Fatalf("rejected in-window v2 observation error = %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO billing_migration_v2_sync_observations(id,program_id,project_id,application_id,platform,app_version,sdk_version,supported_contract_versions,authority_capabilities,traffic_count,authority_epoch,sync_result,observation_digest,observed_at) VALUES('sync_ready_android','program_ready','project_one','app_two','android','2.10.0+android.1','2.1.0',ARRAY['2'],ARRAY['authority_epoch','authority_scope','urgent_authority_sync','mosaic_authoritative_targeting'],10,0,'accepted',decode(repeat('77',32),'hex'),$1)`, now); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO billing_migration_runs(id,program_id,project_id,run_kind,state_version,manifest_digest,mapping_digest,policy_digest,source_watermark,provider_watermark,shadow_watermark,critical_count,blocking_count,warning_count,informational_count,run_digest,completed_at) VALUES('run_old','program_ready','project_one','shadow',4,decode(repeat('65',32),'hex'),decode(repeat('66',32),'hex'),decode(repeat('71',32),'hex'),'s','p','m',0,1,0,0,decode(repeat('84',32),'hex'),$1::timestamptz-interval '2 minutes'),('run_new','program_ready','project_one','shadow',4,decode(repeat('65',32),'hex'),decode(repeat('66',32),'hex'),decode(repeat('71',32),'hex'),'s','p','m',0,0,0,0,decode(repeat('85',32),'hex'),$1::timestamptz-interval '1 minute')`, now); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO billing_migration_divergences(id,program_id,project_id,run_id,state_version,classification,reason,evidence_digest,classification_rule_version,observed_at) VALUES('divergence_old','program_ready','project_one','run_old',4,'blocking','mapping_missing',decode(repeat('86',32),'hex'),'v1',$1::timestamptz-interval '2 minutes')`, now); err != nil {
		t.Fatal(err)
	}
	if _, err := service.PromoteReady(ctx, billingmigration.Actor{ID: "owner_one"}, billingmigration.PromoteReadyInput{ProjectID: "project_one", ProgramID: "program_ready", ExpectedStateVersion: 4}); !errors.Is(err, billingmigration.ErrConflict) {
		t.Fatalf("older unresolved divergence disappeared behind latest run: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO billing_migration_divergence_resolutions(id,divergence_id,program_id,project_id,resolution,actor_id,reason,resolution_digest,resolved_at) VALUES('resolution_old','divergence_old','program_ready','project_one','revalidated','owner_one','verified exact state',decode(repeat('87',32),'hex'),$1)`, now); err != nil {
		t.Fatal(err)
	}
	readiness, err := service.PromoteReady(ctx, billingmigration.Actor{ID: "owner_one"}, billingmigration.PromoteReadyInput{ProjectID: "project_one", ProgramID: "program_ready", ExpectedStateVersion: 4})
	if err != nil || !readiness.Assessment.Ready || !readiness.SourceCapabilitiesFresh {
		t.Fatalf("promote ready = %#v err=%v", readiness, err)
	}
	var cohortCount, collisionCount int
	if err := pool.QueryRow(ctx, `SELECT count(*),count(*) FILTER(WHERE billing_customer_id='customer_two') FROM billing_migration_final_delta_cohort_customers WHERE program_id='program_ready'`).Scan(&cohortCount, &collisionCount); err != nil || cohortCount != 1 || collisionCount != 0 {
		t.Fatalf("identity-only final cohort count=%d collision=%d err=%v", cohortCount, collisionCount, err)
	}
	digests := billingmigration.PreApprovalDigests{
		Scope: billingmigration.FormatDigest(bytesOf(0x61)), Manifest: billingmigration.FormatDigest(bytesOf(0x65)),
		Mapping: billingmigration.FormatDigest(bytesOf(0x66)), Policy: billingmigration.FormatDigest(bytesOf(0x71)),
		Evidence: billingmigration.FormatDigest(bytesOf(0x67)), Readiness: readiness.Assessment.ReadinessDigest,
		FinalWatermark: billingmigration.FormatDigest(bytesOf(0x68)), ApplicationVersion: billingmigration.FormatDigest(bytesOf(0x70)),
	}
	stale := digests
	stale.Manifest = billingmigration.FormatDigest(bytesOf(0x7f))
	if _, _, err := service.ProposeCutover(ctx, billingmigration.Actor{ID: "owner_one"}, billingmigration.ProposeCutoverInput{ProjectID: "project_one", ProgramID: "program_ready", IdempotencyKey: "proposal-stale", Command: "cutover", ExpectedStateVersion: 5, ExpectedDigests: stale, Reason: "operator reviewed", ExpiresAt: now.Add(time.Hour)}); !errors.Is(err, billingmigration.ErrConflict) {
		t.Fatalf("stale proposal digest error = %v", err)
	}
	proposalInput := billingmigration.ProposeCutoverInput{ProjectID: "project_one", ProgramID: "program_ready", IdempotencyKey: "proposal-valid", Command: "cutover", ExpectedStateVersion: 5, ExpectedDigests: digests, Reason: "operator reviewed", ExpiresAt: now.Add(time.Hour)}
	proposal, replay, err := service.ProposeCutover(ctx, billingmigration.Actor{ID: "owner_one"}, proposalInput)
	if err != nil || replay {
		t.Fatalf("proposal = %#v replay=%v err=%v", proposal, replay, err)
	}
	replayedProposal, replay, err := service.ProposeCutover(ctx, billingmigration.Actor{ID: "owner_one"}, proposalInput)
	if err != nil || !replay || replayedProposal.Reason != proposalInput.Reason || replayedProposal.ProposalID != proposal.ProposalID {
		t.Fatalf("proposal replay = %#v replay=%v err=%v", replayedProposal, replay, err)
	}
	var auditReason string
	if err := pool.QueryRow(ctx, `SELECT metadata->>'reason' FROM audit_events WHERE resource_id=$1 AND action='billing.migration.cutover.proposed'`, proposal.ProposalID).Scan(&auditReason); err != nil || auditReason != proposalInput.Reason {
		t.Fatalf("proposal audit reason=%q err=%v", auditReason, err)
	}
	if _, _, err := service.ApproveCutover(ctx, billingmigration.Actor{ID: "owner_one"}, billingmigration.ApproveCutoverInput{ProjectID: "project_one", ProgramID: "program_ready", ProposalID: proposal.ProposalID, IdempotencyKey: "approval-self", ExpectedStateVersion: 5}); !errors.Is(err, billingmigration.ErrForbidden) {
		t.Fatalf("production self-approval error = %v", err)
	}
	approval, replay, err := service.ApproveCutover(ctx, billingmigration.Actor{ID: "owner_two"}, billingmigration.ApproveCutoverInput{ProjectID: "project_one", ProgramID: "program_ready", ProposalID: proposal.ProposalID, IdempotencyKey: "approval-valid", ExpectedStateVersion: 5})
	if err != nil || replay {
		t.Fatalf("approval = %#v replay=%v err=%v", approval, replay, err)
	}
	// A stale prepared row from an earlier run gives the legacy table the right
	// cardinality but must not satisfy the latest final-delta binding.
	if _, err := pool.Exec(ctx, `INSERT INTO billing_migration_scope_prepared_pointers(program_id,project_id,environment_id,application_id,platform,billing_customer_id,prepared_snapshot_id,prepared_digest,prepared_at) VALUES('program_ready','project_one','environment_one','app_two','android','customer_one','snapshot_activation',decode(repeat('79',32),'hex'),$1)`, now.Add(-time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, _, err := service.CreateCheckpoint(ctx, billingmigration.Actor{ID: "owner_two"}, billingmigration.CreateCheckpointInput{ProjectID: "project_one", ProgramID: "program_ready", ApprovalID: approval.ApprovalID, IdempotencyKey: "checkpoint-partial", ExpectedStateVersion: 5, ExpectedDigests: digests, ApprovalDigest: approval.ApprovalDigest, CohortDigest: readiness.CohortDigest}); !errors.Is(err, billingmigration.ErrConflict) {
		t.Fatalf("partial prepared-pointer coverage error = %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO billing_migration_final_delta_prepared_pointers(final_delta_job_id,lease_generation,program_id,project_id,environment_id,application_id,platform,billing_customer_id,prepared_snapshot_id,prepared_digest,prepared_at) VALUES('delta_job_ready',1,'program_ready','project_one','environment_one','app_two','android','customer_one','snapshot_activation',decode(repeat('79',32),'hex'),$1)`, now); err != nil {
		t.Fatalf("complete prepared-pointer coverage: %v", err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM billing_migration_scope_current_pointers WHERE project_id='project_one' AND environment_id='environment_one' AND application_id='app_two' AND platform='android' AND billing_customer_id='customer_one'`); err != nil {
		t.Fatal(err)
	}
	checkpointInput := billingmigration.CreateCheckpointInput{ProjectID: "project_one", ProgramID: "program_ready", ApprovalID: approval.ApprovalID, IdempotencyKey: "checkpoint-valid", ExpectedStateVersion: 5, ExpectedDigests: digests, ApprovalDigest: approval.ApprovalDigest, CohortDigest: readiness.CohortDigest}
	checkpoint, replay, err := service.CreateCheckpoint(ctx, billingmigration.Actor{ID: "owner_two"}, checkpointInput)
	if err != nil || replay || checkpoint.AuthorityEpoch != 0 {
		t.Fatalf("checkpoint = %#v replay=%v err=%v", checkpoint, replay, err)
	}
	replayedCheckpoint, replay, err := service.CreateCheckpoint(ctx, billingmigration.Actor{ID: "owner_two"}, checkpointInput)
	if err != nil || !replay || replayedCheckpoint.CheckpointID != checkpoint.CheckpointID || replayedCheckpoint.StateVersion != 6 {
		t.Fatalf("checkpoint replay = %#v replay=%v err=%v", replayedCheckpoint, replay, err)
	}
	var programState string
	var programVersion int64
	if err := pool.QueryRow(ctx, `SELECT state,state_version FROM billing_migration_programs WHERE id='program_ready'`).Scan(&programState, &programVersion); err != nil || programState != billingmigration.StateCutoverPending || programVersion != 6 {
		t.Fatalf("checkpoint CAS state=%q version=%d err=%v", programState, programVersion, err)
	}
	if _, err := pool.Exec(ctx, `UPDATE billing_migration_authority_scopes SET current_authority='mosaic',current_epoch=1,authority_digest=decode(repeat('90',32),'hex'),updated_at=$1 WHERE active_program_id='program_ready'`, now); err != nil {
		t.Fatalf("seed stabilizing rollback prerequisites: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO billing_migration_authority_transitions(id,program_id,project_id,authority_scope_id,from_authority,to_authority,from_epoch,to_epoch,transition_kind,transition_digest,transitioned_at) VALUES('transition_android','program_ready','project_one','authority_ready_android','source','mosaic',0,1,'cutover',decode(repeat('92',32),'hex'),$1),('transition_ios','program_ready','project_one','authority_ready_ios','source','mosaic',0,1,'cutover',decode(repeat('91',32),'hex'),$1)`, now); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO billing_migration_validation_attempts(id,program_id,project_id,attempt_kind,status,record_count,result_digest,attempted_at) VALUES('validation_source','program_ready','project_one','source_validation','succeeded',1,decode(repeat('93',32),'hex'),$1),('validation_provider','program_ready','project_one','provider_validation','succeeded',1,decode(repeat('94',32),'hex'),$1)`, now); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE billing_migration_programs SET state='stabilizing',state_version=7,updated_at=$1 WHERE id='program_ready'`, now); err != nil {
		t.Fatal(err)
	}
	scopeDigest := billingmigration.FormatDigest(bytesOf(0x61))
	authorityDigest, err := billingmigration.AuthoritySetDigest("program_ready", scopeDigest, []string{billingmigration.FormatDigest(bytesOf(0x90)), billingmigration.FormatDigest(bytesOf(0x90))})
	if err != nil {
		t.Fatal(err)
	}
	rollbackBinding := billingmigration.RollbackProposalBinding{CheckpointID: checkpoint.CheckpointID, CheckpointDigest: checkpoint.CheckpointDigest, AuthorityDigest: authorityDigest, ScopeDigest: scopeDigest, CutoverTransitionID: "transition_ios", CutoverTransitionDigest: billingmigration.FormatDigest(bytesOf(0x91)), CutoverEpoch: 1, CutoverTransitionedAt: now, RollbackDeadline: now.Add(7 * 24 * time.Hour), CredentialID: "credential_ready", CredentialStatus: "active", CapabilityAssessmentID: "capability_ready", CapabilityAssessmentDigest: billingmigration.FormatDigest(bytesOf(0x72)), CapabilityAssessedAt: now.Add(-time.Minute), SourceValidationID: "validation_source", SourceValidationDigest: billingmigration.FormatDigest(bytesOf(0x93)), SourceValidatedAt: now, ProviderValidationID: "validation_provider", ProviderValidationDigest: billingmigration.FormatDigest(bytesOf(0x94)), ProviderValidatedAt: now}
	rollbackPrerequisites, err := billingmigration.RollbackPrerequisitesDigest("program_ready", 7, rollbackBinding)
	if err != nil {
		t.Fatal(err)
	}
	rollbackInput := func(key, checkpointDigest, authority, prerequisites string) billingmigration.ProposeRollbackInput {
		return billingmigration.ProposeRollbackInput{ProjectID: "project_one", ProgramID: "program_ready", IdempotencyKey: key, CheckpointID: checkpoint.CheckpointID, ExpectedStateVersion: 7, ExpectedCheckpointDigest: checkpointDigest, ExpectedAuthorityDigest: authority, ExpectedRollbackPrerequisitesDigest: prerequisites, Reason: "verified rollback baseline", ExpiresAt: now.Add(time.Hour)}
	}
	deadlineService := billingmigration.NewService(billingmigrationpostgres.New(pool), nil, nil, billingmigration.WithClock(func() time.Time { return rollbackBinding.RollbackDeadline }))
	boundaryInput := rollbackInput("rollback-at-deadline", checkpoint.CheckpointDigest, authorityDigest, rollbackPrerequisites)
	boundaryInput.ExpiresAt = rollbackBinding.RollbackDeadline.Add(time.Hour)
	boundaryProposal, _, err := deadlineService.ProposeRollback(ctx, billingmigration.Actor{ID: "owner_one"}, boundaryInput)
	if err != nil {
		t.Fatalf("rollback proposal at exact deadline: %v", err)
	}
	if _, _, err := deadlineService.ApproveCutover(ctx, billingmigration.Actor{ID: "owner_two"}, billingmigration.ApproveCutoverInput{ProjectID: "project_one", ProgramID: "program_ready", ProposalID: boundaryProposal.ProposalID, IdempotencyKey: "rollback-approval-at-deadline", ExpectedStateVersion: 7}); err != nil {
		t.Fatalf("rollback approval at exact deadline: %v", err)
	}
	afterDeadlineService := billingmigration.NewService(billingmigrationpostgres.New(pool), nil, nil, billingmigration.WithClock(func() time.Time { return rollbackBinding.RollbackDeadline.Add(time.Nanosecond) }))
	afterDeadlineInput := boundaryInput
	afterDeadlineInput.IdempotencyKey = "rollback-after-deadline"
	if _, _, err := afterDeadlineService.ProposeRollback(ctx, billingmigration.Actor{ID: "owner_one"}, afterDeadlineInput); !errors.Is(err, billingmigration.ErrStaleRollbackPrerequisites) {
		t.Fatalf("rollback proposal after deadline error=%v", err)
	}
	nearDeadlineService := billingmigration.NewService(billingmigrationpostgres.New(pool), nil, nil, billingmigration.WithClock(func() time.Time { return rollbackBinding.RollbackDeadline.Add(-time.Hour) }))
	lateApprovalInput := rollbackInput("rollback-late-approval", checkpoint.CheckpointDigest, authorityDigest, rollbackPrerequisites)
	lateApprovalInput.ExpiresAt = rollbackBinding.RollbackDeadline.Add(time.Hour)
	lateApprovalProposal, _, err := nearDeadlineService.ProposeRollback(ctx, billingmigration.Actor{ID: "owner_one"}, lateApprovalInput)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := afterDeadlineService.ApproveCutover(ctx, billingmigration.Actor{ID: "owner_two"}, billingmigration.ApproveCutoverInput{ProjectID: "project_one", ProgramID: "program_ready", ProposalID: lateApprovalProposal.ProposalID, IdempotencyKey: "rollback-after-deadline-approval", ExpectedStateVersion: 7}); !errors.Is(err, billingmigration.ErrStaleRollbackPrerequisites) {
		t.Fatalf("rollback approval after deadline error=%v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE billing_migration_credentials SET status='revoked',revoked_at=$2 WHERE id=$1`, "credential_ready", now); err != nil {
		t.Fatal(err)
	}
	if _, _, err := service.ProposeRollback(ctx, billingmigration.Actor{ID: "owner_one"}, rollbackInput("rollback-revoked-before-proposal", checkpoint.CheckpointDigest, authorityDigest, rollbackPrerequisites)); !errors.Is(err, billingmigration.ErrStaleRollbackPrerequisites) {
		t.Fatalf("revoked credential before proposal error=%v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE billing_migration_credentials SET status='active',revoked_at=NULL WHERE id=$1`, "credential_ready"); err != nil {
		t.Fatal(err)
	}
	rollbackProposal, replay, err := service.ProposeRollback(ctx, billingmigration.Actor{ID: "owner_one"}, rollbackInput("rollback-proposal", checkpoint.CheckpointDigest, authorityDigest, rollbackPrerequisites))
	if err != nil || replay || rollbackProposal.RollbackBinding == nil {
		t.Fatalf("rollback proposal = %#v replay=%v err=%v", rollbackProposal, replay, err)
	}
	rollbackApproval, replay, err := service.ApproveCutover(ctx, billingmigration.Actor{ID: "owner_two"}, billingmigration.ApproveCutoverInput{ProjectID: "project_one", ProgramID: "program_ready", ProposalID: rollbackProposal.ProposalID, IdempotencyKey: "rollback-approval", ExpectedStateVersion: 7})
	if err != nil || replay || rollbackApproval.Command != "rollback" {
		t.Fatalf("rollback approval = %#v replay=%v err=%v", rollbackApproval, replay, err)
	}
	var boundPrerequisites []byte
	if err := pool.QueryRow(ctx, `SELECT rollback_prerequisites_digest FROM billing_migration_rollback_proposal_bindings WHERE proposal_id=$1`, rollbackProposal.ProposalID).Scan(&boundPrerequisites); err != nil || billingmigration.FormatDigest(boundPrerequisites) != rollbackPrerequisites {
		t.Fatalf("rollback binding digest=%q err=%v", billingmigration.FormatDigest(boundPrerequisites), err)
	}
	staleCheckpoint := billingmigration.FormatDigest(bytesOf(0x99))
	if _, _, err := service.ProposeRollback(ctx, billingmigration.Actor{ID: "owner_one"}, rollbackInput("rollback-stale-checkpoint", staleCheckpoint, authorityDigest, rollbackPrerequisites)); !errors.Is(err, billingmigration.ErrStaleCheckpoint) {
		t.Fatalf("stale rollback checkpoint error=%v", err)
	}
	staleAuthority := billingmigration.FormatDigest(bytesOf(0x9a))
	if _, _, err := service.ProposeRollback(ctx, billingmigration.Actor{ID: "owner_one"}, rollbackInput("rollback-stale-authority", checkpoint.CheckpointDigest, staleAuthority, rollbackPrerequisites)); !errors.Is(err, billingmigration.ErrStaleAuthority) {
		t.Fatalf("stale rollback authority error=%v", err)
	}
	revokedDriftProposal, _, err := service.ProposeRollback(ctx, billingmigration.Actor{ID: "owner_one"}, rollbackInput("rollback-revoked-drift", checkpoint.CheckpointDigest, authorityDigest, rollbackPrerequisites))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE billing_migration_credentials SET status='revoked',revoked_at=$2 WHERE id=$1`, "credential_ready", now); err != nil {
		t.Fatal(err)
	}
	if _, _, err := service.ApproveCutover(ctx, billingmigration.Actor{ID: "owner_two"}, billingmigration.ApproveCutoverInput{ProjectID: "project_one", ProgramID: "program_ready", ProposalID: revokedDriftProposal.ProposalID, IdempotencyKey: "rollback-revoked-drift-approval", ExpectedStateVersion: 7}); !errors.Is(err, billingmigration.ErrStaleRollbackPrerequisites) {
		t.Fatalf("credential revoked before approval error=%v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE billing_migration_credentials SET status='active',revoked_at=NULL WHERE id=$1`, "credential_ready"); err != nil {
		t.Fatal(err)
	}
	driftingProposal, _, err := service.ProposeRollback(ctx, billingmigration.Actor{ID: "owner_one"}, rollbackInput("rollback-drifting", checkpoint.CheckpointDigest, authorityDigest, rollbackPrerequisites))
	if err != nil {
		t.Fatalf("create drifting rollback proposal: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO billing_migration_validation_attempts(id,program_id,project_id,attempt_kind,status,record_count,result_digest,attempted_at) VALUES('validation_source_new','program_ready','project_one','source_validation','succeeded',1,decode(repeat('95',32),'hex'),$1)`, now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if _, _, err := service.ApproveCutover(ctx, billingmigration.Actor{ID: "owner_two"}, billingmigration.ApproveCutoverInput{ProjectID: "project_one", ProgramID: "program_ready", ProposalID: driftingProposal.ProposalID, IdempotencyKey: "rollback-source-drift-approval", ExpectedStateVersion: 7}); !errors.Is(err, billingmigration.ErrStaleRollbackPrerequisites) {
		t.Fatalf("advanced source validation error=%v", err)
	}
	rollbackBinding.SourceValidationID, rollbackBinding.SourceValidationDigest, rollbackBinding.SourceValidatedAt = "validation_source_new", billingmigration.FormatDigest(bytesOf(0x95)), now.Add(time.Minute)
	rollbackPrerequisites, err = billingmigration.RollbackPrerequisitesDigest("program_ready", 7, rollbackBinding)
	if err != nil {
		t.Fatal(err)
	}
	capabilityProposal, _, err := service.ProposeRollback(ctx, billingmigration.Actor{ID: "owner_one"}, rollbackInput("rollback-capability-drift", checkpoint.CheckpointDigest, authorityDigest, rollbackPrerequisites))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO billing_migration_capability_assessments(id,program_id,project_id,state_version,provider_api_version,capabilities,assessment_digest,assessed_at) VALUES('capability_new','program_ready','project_one',7,'v2',ARRAY['read_customers'],decode(repeat('96',32),'hex'),$1)`, now.Add(2*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if _, _, err := service.ApproveCutover(ctx, billingmigration.Actor{ID: "owner_two"}, billingmigration.ApproveCutoverInput{ProjectID: "project_one", ProgramID: "program_ready", ProposalID: capabilityProposal.ProposalID, IdempotencyKey: "rollback-capability-drift-approval", ExpectedStateVersion: 7}); !errors.Is(err, billingmigration.ErrStaleRollbackPrerequisites) {
		t.Fatalf("advanced capability assessment error=%v", err)
	}
	rollbackBinding.CapabilityAssessmentID, rollbackBinding.CapabilityAssessmentDigest, rollbackBinding.CapabilityAssessedAt = "capability_new", billingmigration.FormatDigest(bytesOf(0x96)), now.Add(2*time.Minute)
	rollbackPrerequisites, err = billingmigration.RollbackPrerequisitesDigest("program_ready", 7, rollbackBinding)
	if err != nil {
		t.Fatal(err)
	}
	providerProposal, _, err := service.ProposeRollback(ctx, billingmigration.Actor{ID: "owner_one"}, rollbackInput("rollback-provider-drift", checkpoint.CheckpointDigest, authorityDigest, rollbackPrerequisites))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO billing_migration_validation_attempts(id,program_id,project_id,attempt_kind,status,record_count,result_digest,attempted_at) VALUES('validation_provider_new','program_ready','project_one','provider_validation','succeeded',1,decode(repeat('97',32),'hex'),$1)`, now.Add(3*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if _, _, err := service.ApproveCutover(ctx, billingmigration.Actor{ID: "owner_two"}, billingmigration.ApproveCutoverInput{ProjectID: "project_one", ProgramID: "program_ready", ProposalID: providerProposal.ProposalID, IdempotencyKey: "rollback-provider-drift-approval", ExpectedStateVersion: 7}); !errors.Is(err, billingmigration.ErrStaleRollbackPrerequisites) {
		t.Fatalf("advanced provider validation error=%v", err)
	}
	rollbackBinding.ProviderValidationID, rollbackBinding.ProviderValidationDigest, rollbackBinding.ProviderValidatedAt = "validation_provider_new", billingmigration.FormatDigest(bytesOf(0x97)), now.Add(3*time.Minute)
	rollbackPrerequisites, err = billingmigration.RollbackPrerequisitesDigest("program_ready", 7, rollbackBinding)
	if err != nil {
		t.Fatal(err)
	}
	credentialProposal, _, err := service.ProposeRollback(ctx, billingmigration.Actor{ID: "owner_one"}, rollbackInput("rollback-credential-drift", checkpoint.CheckpointDigest, authorityDigest, rollbackPrerequisites))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE billing_migration_credentials SET nonce=NULL,ciphertext=NULL,removed_at=$2,removed_by_actor_id='owner_one',removal_digest=decode(repeat('98',32),'hex') WHERE id=$1`, "credential_ready", now.Add(4*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if _, _, err := service.ApproveCutover(ctx, billingmigration.Actor{ID: "owner_two"}, billingmigration.ApproveCutoverInput{ProjectID: "project_one", ProgramID: "program_ready", ProposalID: credentialProposal.ProposalID, IdempotencyKey: "rollback-credential-drift-approval", ExpectedStateVersion: 7}); !errors.Is(err, billingmigration.ErrStaleRollbackPrerequisites) {
		t.Fatalf("removed migration credential error=%v", err)
	}
	if _, _, err := service.ProposeRollback(ctx, billingmigration.Actor{ID: "owner_one"}, rollbackInput("rollback-removed-before-proposal", checkpoint.CheckpointDigest, authorityDigest, rollbackPrerequisites)); !errors.Is(err, billingmigration.ErrStaleRollbackPrerequisites) {
		t.Fatalf("removed credential before proposal error=%v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE billing_migration_checkpoints SET authority_epoch=1 WHERE id=$1`, checkpoint.CheckpointID); err == nil {
		t.Fatal("immutable checkpoint accepted an update")
	}
	var rollbackBaseline, activation string
	var absentBaselines int
	if err := pool.QueryRow(ctx, `SELECT max(snapshot_id) FILTER(WHERE pointer_role='rollback_baseline'),max(snapshot_id) FILTER(WHERE pointer_role='prepared_activation'),count(*) FILTER(WHERE pointer_role='rollback_baseline' AND absent_current) FROM billing_migration_checkpoint_pointer_maps WHERE checkpoint_id=$1`, checkpoint.CheckpointID).Scan(&rollbackBaseline, &activation, &absentBaselines); err != nil {
		t.Fatal(err)
	}
	if rollbackBaseline != "snapshot_baseline" || activation != "snapshot_activation" || absentBaselines != 1 {
		t.Fatalf("checkpoint pointers rollback=%q activation=%q absent=%d", rollbackBaseline, activation, absentBaselines)
	}
	if _, err := pool.Exec(ctx, `UPDATE billing_migration_programs SET state='shadowing',state_version=8 WHERE id='program_ready'`); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO billing_migration_final_deltas(id,program_id,project_id,state_version,manifest_digest,mapping_digest,evidence_digest,final_watermark_digest,source_watermark,provider_watermark,shadow_watermark,delta_digest,completed_at) VALUES('delta_unsupported','program_ready','project_one',6,decode(repeat('65',32),'hex'),decode(repeat('66',32),'hex'),decode(repeat('67',32),'hex'),decode(repeat('96',32),'hex'),$1,$1,$1,decode(repeat('97',32),'hex'),$1)`, now); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO billing_migration_supported_app_versions(id,program_id,project_id,application_id,platform,application_version,supported,authority_aware,observation_digest,observed_at) VALUES('version_unsupported','program_ready','project_one','app_one','ios','2.10.0',false,false,decode(repeat('98',32),'hex'),$1)`, now); err != nil {
		t.Fatal(err)
	}
	if _, err := service.PromoteReady(ctx, billingmigration.Actor{ID: "owner_one"}, billingmigration.PromoteReadyInput{ProjectID: "project_one", ProgramID: "program_ready", ExpectedStateVersion: 6}); !errors.Is(err, billingmigration.ErrConflict) {
		t.Fatalf("unsupported in-window version bypassed by outside-window flag: %v", err)
	}
	if err := goose.DownContext(ctx, db, "."); err == nil || !strings.Contains(err.Error(), "immutable cohort or rollback proposal evidence exists") {
		t.Fatalf("migration 54 evidence guard error=%v", err)
	}
	version, err := goose.GetDBVersionContext(ctx, db)
	if err != nil || version != 54 {
		t.Fatalf("guarded rollback version=%d err=%v", version, err)
	}
}

func seedReadyProgram(t *testing.T, ctx context.Context, db *sql.DB, now time.Time) {
	t.Helper()
	statement := `
		INSERT INTO applications(id,project_id,name,platform,identifier,created_at,updated_at) VALUES('app_two','project_one','Android App','android','com.example.android',$1,$1);
		INSERT INTO billing_customers(id,project_id,status,created_at,updated_at) VALUES('customer_two','project_one','active',$1,$1);
		INSERT INTO products(id,project_id,key,internal_name,type,status,metadata_source,readiness_ready,created_at,updated_at) VALUES('customer_two','project_one','collision_product','Collision Product','subscription','connected','provider',true,$1,$1);
		INSERT INTO billing_migration_credentials(id,project_id,provider,external_project_id,status,envelope_version,algorithm,key_id,nonce,ciphertext,fingerprint,created_by_actor_id,created_at)
		VALUES('credential_ready','project_one','revenuecat','rc','active',1,'AES-256-GCM','key',decode(repeat('01',12),'hex'),decode(repeat('02',16),'hex'),decode(repeat('03',32),'hex'),'owner_one',$1);
		INSERT INTO billing_migration_programs(id,project_id,environment_id,source_adapter,source_adapter_version,credential_id,state,state_version,authority_epoch_before,stabilization_days,rollback_window_days,scope_digest,policy_digest,idempotency_key,request_digest,created_by_actor_id,created_at,updated_at)
		VALUES('program_ready','project_one','environment_one','revenuecat','v2','credential_ready','shadowing',4,0,7,7,decode(repeat('61',32),'hex'),decode(repeat('62',32),'hex'),'ready-program',decode(repeat('63',32),'hex'),'owner_one',$1,$1);
		INSERT INTO billing_migration_program_scopes(program_id,project_id,environment_id,application_id,platform,created_at) VALUES('program_ready','project_one','environment_one','app_one','ios',$1),('program_ready','project_one','environment_one','app_two','android',$1);
		INSERT INTO billing_migration_authority_scopes(id,project_id,environment_id,application_id,platform,current_authority,current_epoch,active_program_id,authority_digest,updated_at) VALUES('authority_ready_ios','project_one','environment_one','app_one','ios','source',0,'program_ready',decode(repeat('64',32),'hex'),$1),('authority_ready_android','project_one','environment_one','app_two','android','source',0,'program_ready',decode(repeat('64',32),'hex'),$1);
		INSERT INTO billing_migration_capability_assessments(id,program_id,project_id,state_version,provider_api_version,capabilities,assessment_digest,assessed_at) VALUES('capability_ready','program_ready','project_one',4,'v2',ARRAY['read_customers','read_subscriptions'],decode(repeat('72',32),'hex'),$1-interval '1 minute');
		INSERT INTO billing_migration_source_manifests(id,program_id,project_id,state_version,adapter_version,provider_api_version,schema_version,record_count,current_access_record_count,object_key,object_checksum,object_size_bytes,object_encryption,manifest_digest,captured_at) VALUES('manifest_ready','program_ready','project_one',4,'v2','v2','v1',1,1,'private/key',decode(repeat('73',32),'hex'),1,'AES-256-GCM',decode(repeat('65',32),'hex'),$1);
		INSERT INTO billing_migration_source_records(id,program_id,project_id,manifest_id,source_kind,source_identifier,source_revision,record_digest,current_access,normalization_schema_version,evidence_kind,observed_at,created_at) VALUES('record_ready','program_ready','project_one','manifest_ready','customer','customer-ready','1',decode(repeat('74',32),'hex'),true,'v1','trusted_source_export',$1,$1);
		INSERT INTO billing_migration_mapping_sets(id,program_id,project_id,version,status,mapping_digest,expected_program_state_version,created_by_actor_id,created_at,frozen_at) VALUES('mapping_ready','program_ready','project_one',1,'frozen',decode(repeat('66',32),'hex'),4,'owner_one',$1,$1);
		INSERT INTO billing_migration_mapping_entries(id,mapping_set_id,program_id,project_id,source_kind,source_identifier,target_id,match_kind,application_id,platform,created_at) VALUES('mapping_entry_ready','mapping_ready','program_ready','project_one','customer_id','customer-ready','customer_one','exact','app_one','ios',$1),('mapping_entry_collision','mapping_ready','program_ready','project_one','product','customer-ready','customer_two','exact','app_one','ios',$1);
		INSERT INTO billing_migration_readiness_policies(id,program_id,project_id,state_version,warning_threshold,watermark_max_age_seconds,supported_version_window_start,application_version_digest,policy_digest,frozen_at) VALUES('policy_ready','program_ready','project_one',4,0,3600,$1-interval '1 hour',decode(repeat('70',32),'hex'),decode(repeat('71',32),'hex'),$1-interval '10 minutes');
		INSERT INTO billing_migration_readiness_policy_scopes(id,policy_id,program_id,project_id,application_id,platform,minimum_app_version,maximum_app_version,traffic_window_started_at,traffic_window_ended_at,outside_window_accepted,outside_window_reason,minimum_sdk_version,required_capabilities,serving_requirements_digest) VALUES('policy_scope_ready_ios','policy_ready','program_ready','project_one','app_one','ios','2.9.9','2.10.0',$1-interval '1 hour',$1+interval '1 hour',true,'reviewed outside-range traffic','2.1.0-rc.1',ARRAY['authority_epoch','authority_scope','urgent_authority_sync','mosaic_authoritative_targeting'],sha256(convert_to(concat_ws(chr(31),'program_ready','app_one','ios','2.1.0-rc.1','authority_epoch'||chr(30)||'authority_scope'||chr(30)||'mosaic_authoritative_targeting'||chr(30)||'urgent_authority_sync'),'UTF8'))),('policy_scope_ready_android','policy_ready','program_ready','project_one','app_two','android','2.9.9','2.10.0',$1-interval '1 hour',$1+interval '1 hour',true,'reviewed outside-range traffic','2.1.0-rc.1',ARRAY['authority_epoch','authority_scope','urgent_authority_sync','mosaic_authoritative_targeting'],sha256(convert_to(concat_ws(chr(31),'program_ready','app_two','android','2.1.0-rc.1','authority_epoch'||chr(30)||'authority_scope'||chr(30)||'mosaic_authoritative_targeting'||chr(30)||'urgent_authority_sync'),'UTF8')));
		INSERT INTO billing_migration_supported_app_versions(id,program_id,project_id,application_id,platform,application_version,supported,authority_aware,observation_digest,observed_at) VALUES('version_ready_ios','program_ready','project_one','app_one','ios','2.10.0+ios.1',true,true,decode(repeat('75',32),'hex'),$1),('version_ready_android','program_ready','project_one','app_two','android','2.10.0+android.1',true,true,decode(repeat('75',32),'hex'),$1);
		INSERT INTO billing_migration_v2_sync_observations(id,program_id,project_id,application_id,platform,app_version,sdk_version,supported_contract_versions,authority_capabilities,traffic_count,authority_epoch,sync_result,observation_digest,observed_at) VALUES('sync_ready_ios','program_ready','project_one','app_one','ios','2.10.0+ios.1','2.1.0+build.7',ARRAY['2'],ARRAY['authority_epoch','authority_scope','urgent_authority_sync','mosaic_authoritative_targeting'],10,0,'accepted',decode(repeat('76',32),'hex'),$1);
		INSERT INTO customer_entitlement_snapshots(id,project_id,environment_id,billing_customer_id,snapshot_version,rule_version,computed_at,as_of,checksum,change_reason,created_at) VALUES('snapshot_baseline','project_one','environment_one','customer_one',1,1,$1,$1,decode(repeat('78',32),'hex'),'migration_baseline',$1),('snapshot_activation','project_one','environment_one','customer_one',2,1,$1,$1,decode(repeat('79',32),'hex'),'migration_prepared',$1);
		INSERT INTO billing_migration_scope_current_pointers(project_id,environment_id,application_id,platform,billing_customer_id,current_snapshot_id,authority_epoch,updated_at) VALUES('project_one','environment_one','app_one','ios','customer_one','snapshot_baseline',0,$1),('project_one','environment_one','app_two','android','customer_one','snapshot_baseline',0,$1);
		INSERT INTO billing_migration_scope_prepared_pointers(program_id,project_id,environment_id,application_id,platform,billing_customer_id,prepared_snapshot_id,prepared_digest,prepared_at) VALUES('program_ready','project_one','environment_one','app_one','ios','customer_one','snapshot_activation',decode(repeat('79',32),'hex'),$1);
		INSERT INTO billing_migration_final_deltas(id,program_id,project_id,state_version,manifest_digest,mapping_digest,evidence_digest,final_watermark_digest,source_watermark,provider_watermark,shadow_watermark,delta_digest,completed_at) VALUES('delta_ready','program_ready','project_one',4,decode(repeat('65',32),'hex'),decode(repeat('66',32),'hex'),decode(repeat('67',32),'hex'),decode(repeat('68',32),'hex'),$1-interval '1 minute',$1-interval '1 minute',$1-interval '1 minute',decode(repeat('69',32),'hex'),$1-interval '30 seconds');
		INSERT INTO billing_migration_final_delta_jobs(id,program_id,project_id,idempotency_key,request_digest,expected_program_state_version,manifest_digest,mapping_digest,evidence_digest,status,result_final_delta_id,due_at,lease_generation,attempt_count,max_attempts,created_at,updated_at) VALUES('delta_job_ready','program_ready','project_one','delta-ready',decode(repeat('80',32),'hex'),4,decode(repeat('65',32),'hex'),decode(repeat('66',32),'hex'),decode(repeat('67',32),'hex'),'completed','delta_ready',$1,1,1,3,$1,$1);
		INSERT INTO billing_migration_final_delta_prepared_pointers(final_delta_job_id,lease_generation,program_id,project_id,environment_id,application_id,platform,billing_customer_id,prepared_snapshot_id,prepared_digest,prepared_at) VALUES('delta_job_ready',1,'program_ready','project_one','environment_one','app_one','ios','customer_one','snapshot_activation',decode(repeat('79',32),'hex'),$1);`
	statement = strings.ReplaceAll(statement, "$1", "TIMESTAMPTZ '"+now.Format(time.RFC3339)+"'")
	_, err := db.ExecContext(ctx, statement)
	if err != nil {
		t.Fatal(err)
	}
}

func insertExceptionFixture(t *testing.T, ctx context.Context, pool *pgxpool.Pool, suffix, applicationID, platform string, affected int, approvedAt, expiresAt time.Time) {
	t.Helper()
	caseID, exceptionID := "case_"+suffix, "exception_"+suffix
	_, err := pool.Exec(ctx, `INSERT INTO billing_migration_cases(id,program_id,project_id,state_version,classification,status,reason,case_digest,opened_at) VALUES($1,'program_ready','project_one',4,'blocking','in_progress','reviewed source evidence',decode(repeat('80',32),'hex'),$2)`, caseID, approvedAt)
	if err == nil {
		_, err = pool.Exec(ctx, `INSERT INTO billing_migration_source_access_exceptions(id,case_id,program_id,project_id,application_id,platform,reason,affected_customer_count,rollback_treatment,identity_ambiguity_count,proposer_actor_id,approver_actor_id,approved_at,expires_at,exception_digest) VALUES($1,$2,'program_ready','project_one',$3,$4,'reviewed exact evidence',$5,'restore source authority',0,'owner_one','owner_two',$6,$7,decode(repeat('81',32),'hex'))`, exceptionID, caseID, applicationID, platform, affected, approvedAt, expiresAt)
	}
	if err == nil {
		_, err = pool.Exec(ctx, `INSERT INTO billing_migration_source_access_exception_subjects(id,exception_id,program_id,project_id,source_record_id,billing_customer_id,subject_digest,created_at) VALUES($1,$2,'program_ready','project_one','record_ready','customer_one',decode(repeat('82',32),'hex'),$3)`, "subject_"+suffix, exceptionID, approvedAt)
	}
	if err != nil {
		t.Fatal(err)
	}
}
