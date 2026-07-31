package billingmigrationpostgres_test

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingmigration"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingmigrationpostgres"
)

func TestPackageCEnforcesRepairAllowlistAndIrreversibleCredentialRemoval(t *testing.T) {
	ctx, pool, db := executionDatabase(t)
	now := time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)
	seedReadyProgram(t, ctx, db, now)
	if _, err := db.ExecContext(ctx, `INSERT INTO billing_migration_cases(id,program_id,project_id,state_version,classification,status,reason,case_digest,opened_at) VALUES('case_ops','program_ready','project_one',4,'blocking','open','quarantined provider reference',decode(repeat('31',32),'hex'),$1)`, now); err != nil {
		t.Fatalf("case insert with backward-compatible updated_at default: %v", err)
	}
	previewSQL := `INSERT INTO billing_migration_repair_previews(id,case_id,program_id,project_id,repair_kind,scope_kind,scope_references,affected_count,before_digest,after_digest,preview_digest,created_by_actor_id,created_at,expected_program_state_version,expected_case_digest,expected_policy_digest,expected_scope_digest,reason,expires_at) VALUES($1,'case_ops','program_ready','project_one',$2,'provider_reference',ARRAY['reference_one'],1,decode(repeat('32',32),'hex'),decode(repeat('33',32),'hex'),decode(repeat('34',32),'hex'),'owner_one',$3::timestamptz,4,decode(repeat('31',32),'hex'),decode(repeat('71',32),'hex'),decode(repeat('61',32),'hex'),'Revalidate quarantined provider reference',$3::timestamptz+interval '1 hour')`
	if _, err := db.ExecContext(ctx, previewSQL, "preview_allowed", billingmigration.RepairRevalidateProviderReference, now); err != nil {
		t.Fatalf("allowlisted repair preview: %v", err)
	}
	if _, err := db.ExecContext(ctx, previewSQL, "preview_unsafe", "arbitrary_sql", now); err == nil {
		t.Fatal("database accepted non-allowlisted repair kind")
	}
	if _, err := db.ExecContext(ctx, `UPDATE billing_migration_programs SET state='ready',state_version=5,updated_at=$1 WHERE id='program_ready'`, now); err != nil {
		t.Fatal(err)
	}

	repository := billingmigrationpostgres.New(pool)
	removal := billingmigration.CredentialRemoval{RemovalID: "removal_ops", ProgramID: "program_ready", ProjectID: "project_one", Reason: "Final import complete; acknowledge irreversible source access removal", ActorID: "owner_one", RemovalDigest: digestByte(0x35), RemovedAt: now}
	write := billingmigration.CredentialRemovalWrite{Removal: removal, ExpectedState: 5, IdempotencyKey: "remove-ops", RequestDigest: bytesOf(0x36), IrreversibleAck: true}
	removed, replay, err := repository.RemoveCredential(ctx, write)
	if err != nil || replay || removed.CredentialID != "credential_ready" {
		t.Fatalf("remove credential result=%#v replay=%v err=%v", removed, replay, err)
	}
	replayed, replay, err := repository.RemoveCredential(ctx, write)
	if err != nil || !replay || replayed.RemovalID != removed.RemovalID {
		t.Fatalf("credential removal replay=%#v replay=%v err=%v", replayed, replay, err)
	}
	write.RequestDigest = bytesOf(0x37)
	if _, _, err = repository.RemoveCredential(ctx, write); !errors.Is(err, billingmigration.ErrIdempotencyConflict) {
		t.Fatalf("changed credential-removal request error=%v", err)
	}
	var envelopePresent bool
	if err = pool.QueryRow(ctx, `SELECT nonce IS NOT NULL OR ciphertext IS NOT NULL FROM billing_migration_credentials WHERE id='credential_ready'`).Scan(&envelopePresent); err != nil || envelopePresent {
		t.Fatalf("credential envelope present=%v err=%v", envelopePresent, err)
	}
}

func TestPackageCMappingRepairInvalidationRollbackIsAtomic(t *testing.T) {
	ctx, pool, db := executionDatabase(t)
	now := time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)
	seedReadyProgram(t, ctx, db, now)
	statement := `
		INSERT INTO billing_migration_mapping_sets(id,program_id,project_id,version,status,mapping_digest,expected_program_state_version,created_by_actor_id,created_at,frozen_at)
		VALUES('mapping_repair','program_ready','project_one',2,'frozen',decode(repeat('67',32),'hex'),4,'owner_one',$1,$1);
		INSERT INTO billing_migration_cases(id,program_id,project_id,state_version,classification,status,reason,case_digest,opened_at)
		VALUES('case_mapping_repair','program_ready','project_one',4,'blocking','open','Mapping repair requires invalidating stale operation outputs',decode(repeat('31',32),'hex'),$1);
		INSERT INTO billing_migration_repair_previews(id,case_id,program_id,project_id,repair_kind,scope_kind,scope_references,affected_count,before_digest,after_digest,preview_digest,created_by_actor_id,created_at,expected_program_state_version,expected_case_digest,expected_policy_digest,expected_scope_digest,reason,expires_at)
		VALUES('preview_mapping_repair','case_mapping_repair','program_ready','project_one','replace_mapping_set','mapping_set',ARRAY['mapping_repair'],1,decode(repeat('66',32),'hex'),decode(repeat('67',32),'hex'),decode(repeat('68',32),'hex'),'owner_one',$1,4,decode(repeat('31',32),'hex'),decode(repeat('62',32),'hex'),decode(repeat('61',32),'hex'),'Replace frozen mapping and invalidate derived artifacts',$1+interval '1 hour');
		INSERT INTO billing_migration_run_jobs(id,program_id,project_id,run_kind,idempotency_key,request_digest,expected_program_state_version,manifest_digest,mapping_digest,policy_digest,status,created_at,updated_at,due_at,max_attempts)
		VALUES('run_job_mapping_repair','program_ready','project_one','shadow','shadow-mapping-repair',decode(repeat('81',32),'hex'),4,decode(repeat('65',32),'hex'),decode(repeat('66',32),'hex'),decode(repeat('62',32),'hex'),'pending',$1,$1,$1,3);
		INSERT INTO billing_migration_cutover_proposals(id,program_id,project_id,state_version,command,proposer_actor_id,reason,scope_digest,manifest_digest,mapping_digest,policy_digest,evidence_digest,readiness_digest,final_watermark_digest,application_version_digest,proposal_digest,status,proposed_at,expires_at)
		VALUES('proposal_mapping_repair','program_ready','project_one',4,'cutover','owner_one','pending proposal uses old mapping',decode(repeat('61',32),'hex'),decode(repeat('65',32),'hex'),decode(repeat('66',32),'hex'),decode(repeat('62',32),'hex'),decode(repeat('82',32),'hex'),decode(repeat('83',32),'hex'),decode(repeat('68',32),'hex'),decode(repeat('70',32),'hex'),decode(repeat('84',32),'hex'),'pending',$1,$1+interval '1 hour');`
	statement = strings.ReplaceAll(statement, "$1", "TIMESTAMPTZ '"+now.Format(time.RFC3339)+"'")
	if _, err := db.ExecContext(ctx, statement); err != nil {
		t.Fatal(err)
	}
	repository := billingmigrationpostgres.New(pool)
	prepared, err := repository.PrepareRepair(ctx, billingmigration.RepairExecutionWrite{
		ProjectID: "project_one", ProgramID: "program_ready", PreviewID: "preview_mapping_repair", ActorID: "owner_one",
		IdempotencyKey: "execute-mapping-repair", ExpectedStateVersion: 4, ExpectedPreviewDigest: bytesOf(0x68),
		ExpectedCaseDigest: bytesOf(0x31), ExpectedPolicyDigest: bytesOf(0x62), ExpectedScopeDigest: bytesOf(0x61),
		RequestDigest: bytesOf(0x85), At: now.Add(time.Minute),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `CREATE FUNCTION reject_mapping_repair_invalidation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced repair invalidation failure'; END $$; CREATE TRIGGER reject_mapping_repair_invalidation BEFORE INSERT ON billing_migration_repair_invalidations FOR EACH ROW EXECUTE FUNCTION reject_mapping_repair_invalidation()`); err != nil {
		t.Fatal(err)
	}
	_, err = repository.SettleRepair(ctx, billingmigration.RepairSettlement{
		ExecutionID: prepared.ExecutionID, ProgramID: "program_ready", ProjectID: "project_one", Result: "succeeded",
		AttemptNumber: prepared.AttemptNumber, ActualBeforeDigest: bytesOf(0x66), ActualAfterDigest: bytesOf(0x67),
		ResultDigest: bytesOf(0x86), At: now.Add(2 * time.Minute),
	})
	if err == nil {
		t.Fatal("forced invalidation failure accepted")
	}
	var state, proposalStatus string
	var version, executions int
	var settledAt *time.Time
	if err = pool.QueryRow(ctx, `SELECT state,state_version FROM billing_migration_programs WHERE id='program_ready'`).Scan(&state, &version); err != nil {
		t.Fatal(err)
	}
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM billing_migration_repair_executions WHERE id=$1`, prepared.ExecutionID).Scan(&executions); err != nil {
		t.Fatal(err)
	}
	if err = pool.QueryRow(ctx, `SELECT settled_at FROM billing_migration_repair_reservations WHERE id=$1`, prepared.ExecutionID).Scan(&settledAt); err != nil {
		t.Fatal(err)
	}
	if err = pool.QueryRow(ctx, `SELECT status FROM billing_migration_cutover_proposals WHERE id='proposal_mapping_repair'`).Scan(&proposalStatus); err != nil {
		t.Fatal(err)
	}
	if state != "shadowing" || version != 4 || executions != 0 || settledAt != nil || proposalStatus != "pending" {
		t.Fatalf("partial mapping repair writes state=%s version=%d executions=%d settledAt=%v proposal=%s", state, version, executions, settledAt, proposalStatus)
	}
}

func TestPackageCLegalHoldRequiresTwoProductionOwnersAndExactChain(t *testing.T) {
	ctx, pool, db := executionDatabase(t)
	now := time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)
	seedReadyProgram(t, ctx, db, now)
	if _, err := db.ExecContext(ctx, `INSERT INTO organization_members(organization_id,actor_id,role,created_at,updated_at) VALUES('org_one','owner_two','owner',$1,$1)`, now); err != nil {
		t.Fatal(err)
	}
	repository := billingmigrationpostgres.New(pool)
	proposal := billingmigration.LegalHoldProposal{ProposalID: "proposal_set", ProgramID: "program_ready", ProjectID: "project_one", Command: "set", Reason: "Regulatory preservation request", ExternalComplianceReference: "LEGAL-2026-1", ProposerActorID: "owner_one", ProposalDigest: digestByte(0x41), Status: "pending", ProposedAt: now, ExpiresAt: now.Add(time.Hour)}
	proposed, replay, err := repository.ProposeLegalHold(ctx, billingmigration.LegalHoldProposalWrite{Proposal: proposal, IdempotencyKey: "proposal-set", RequestDigest: bytesOf(0x42)})
	if err != nil || replay || proposed.ProposerActorID != "owner_one" {
		t.Fatalf("proposal=%#v replay=%v err=%v", proposed, replay, err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO billing_migration_legal_hold_commands(id,program_id,project_id,proposal_id,command,reason,external_compliance_reference,proposer_actor_id,approver_actor_id,production,command_digest,commanded_at) VALUES('hold_forged_environment','program_ready','project_one','proposal_set','set','Regulatory preservation request','LEGAL-2026-1','owner_one','owner_one',false,decode(repeat('40',32),'hex'),$1)`, now.Add(30*time.Second)); err == nil {
		t.Fatal("database accepted forged nonproduction self-approval for production environment")
	}
	self := billingmigration.LegalHoldApprovalWrite{ProjectID: "project_one", ProgramID: "program_ready", ProposalID: proposal.ProposalID, ApproverActorID: "owner_one", IdempotencyKey: "approve-self", ExpectedProposalDigest: bytesOf(0x41), RequestDigest: bytesOf(0x43), At: now.Add(time.Minute)}
	if _, _, err := repository.ApproveLegalHold(ctx, self); !errors.Is(err, billingmigration.ErrForbidden) {
		t.Fatalf("production self-approval error=%v", err)
	}
	staleProposal := self
	staleProposal.ApproverActorID = "owner_two"
	staleProposal.IdempotencyKey = "approve-stale-proposal"
	staleProposal.ExpectedProposalDigest = bytesOf(0xfe)
	staleProposal.RequestDigest = bytesOf(0xfd)
	if _, _, err := repository.ApproveLegalHold(ctx, staleProposal); !errors.Is(err, billingmigration.ErrStaleDigest) {
		t.Fatalf("stale proposal digest error=%v", err)
	}
	expired := proposal
	expired.ProposalID = "proposal_expired"
	expired.ProposalDigest = digestByte(0x49)
	expired.ProposedAt = now
	expired.ExpiresAt = now.Add(time.Minute)
	if _, _, err := repository.ProposeLegalHold(ctx, billingmigration.LegalHoldProposalWrite{Proposal: expired, IdempotencyKey: "proposal-expired", RequestDigest: bytesOf(0x4a)}); err != nil {
		t.Fatalf("persist expiring proposal: %v", err)
	}
	if _, _, err := repository.ApproveLegalHold(ctx, billingmigration.LegalHoldApprovalWrite{ProjectID: "project_one", ProgramID: "program_ready", ProposalID: expired.ProposalID, ApproverActorID: "owner_two", IdempotencyKey: "approve-expired", ExpectedProposalDigest: bytesOf(0x49), RequestDigest: bytesOf(0x4b), At: now.Add(2 * time.Minute)}); !errors.Is(err, billingmigration.ErrExpiredApproval) {
		t.Fatalf("expired proposal error=%v", err)
	}
	approve := self
	approve.ApproverActorID = "owner_two"
	approve.IdempotencyKey = "approve-set"
	approve.RequestDigest = bytesOf(0x44)
	hold, replay, err := repository.ApproveLegalHold(ctx, approve)
	if err != nil || replay || !hold.Production {
		t.Fatalf("set legal hold=%#v replay=%v err=%v", hold, replay, err)
	}
	releaseProposal := billingmigration.LegalHoldProposal{ProposalID: "proposal_release", ProgramID: "program_ready", ProjectID: "project_one", Command: "release", Reason: "Compliance released preservation request", ExternalComplianceReference: "LEGAL-2026-1-RELEASE", ProposerActorID: "owner_one", ExpectedPreviousCommandDigest: digestByte(0xff), ProposalDigest: digestByte(0x45), Status: "pending", ProposedAt: now.Add(2 * time.Minute), ExpiresAt: now.Add(time.Hour)}
	if _, _, err := repository.ProposeLegalHold(ctx, billingmigration.LegalHoldProposalWrite{Proposal: releaseProposal, IdempotencyKey: "release-stale", RequestDigest: bytesOf(0x46), ExpectedPreviousDigest: bytesOf(0xff)}); !errors.Is(err, billingmigration.ErrStaleDigest) {
		t.Fatalf("stale legal-hold chain error=%v", err)
	}
	previousRaw, _ := billingmigration.ParseDigest(hold.CommandDigest)
	releaseProposal.ExpectedPreviousCommandDigest = hold.CommandDigest
	_, _, err = repository.ProposeLegalHold(ctx, billingmigration.LegalHoldProposalWrite{Proposal: releaseProposal, IdempotencyKey: "release-proposal", RequestDigest: bytesOf(0x47), ExpectedPreviousDigest: previousRaw})
	if err != nil {
		t.Fatalf("release proposal: %v", err)
	}
	release := billingmigration.LegalHoldApprovalWrite{ProjectID: "project_one", ProgramID: "program_ready", ProposalID: releaseProposal.ProposalID, ApproverActorID: "owner_two", IdempotencyKey: "release-approve", ExpectedProposalDigest: bytesOf(0x45), RequestDigest: bytesOf(0x48), At: now.Add(3 * time.Minute)}
	if released, replay, err := repository.ApproveLegalHold(ctx, release); err != nil || replay || released.PreviousCommandID != hold.HoldID {
		t.Fatalf("release legal hold=%#v replay=%v err=%v", released, replay, err)
	}
}

func TestPackageCNonproductionLegalHoldAllowsAuthenticatedSelfApproval(t *testing.T) {
	ctx, pool, db := executionDatabase(t)
	now := time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)
	seedReadyProgram(t, ctx, db, now)
	if _, err := db.ExecContext(ctx, `UPDATE environments SET mode='development' WHERE id='environment_one'`); err != nil {
		t.Fatal(err)
	}
	repository := billingmigrationpostgres.New(pool)
	proposal := billingmigration.LegalHoldProposal{ProposalID: "proposal_dev", ProgramID: "program_ready", ProjectID: "project_one", Command: "set", Reason: "Development retention drill", ExternalComplianceReference: "DEV-HOLD-1", ProposerActorID: "owner_one", ProposalDigest: digestByte(0x51), Status: "pending", ProposedAt: now, ExpiresAt: now.Add(time.Hour)}
	if _, _, err := repository.ProposeLegalHold(ctx, billingmigration.LegalHoldProposalWrite{Proposal: proposal, IdempotencyKey: "proposal-dev", RequestDigest: bytesOf(0x52)}); err != nil {
		t.Fatal(err)
	}
	hold, replay, err := repository.ApproveLegalHold(ctx, billingmigration.LegalHoldApprovalWrite{ProjectID: "project_one", ProgramID: "program_ready", ProposalID: proposal.ProposalID, ApproverActorID: "owner_one", IdempotencyKey: "approve-dev", ExpectedProposalDigest: bytesOf(0x51), RequestDigest: bytesOf(0x53), At: now.Add(time.Minute)})
	if err != nil || replay || hold.Production || hold.ProposerActorID != "owner_one" || hold.ApproverActorID != "owner_one" {
		t.Fatalf("hold=%#v replay=%v err=%v", hold, replay, err)
	}
}

func TestPackageCCompletionRequiresFreshCurrentEpochEvidenceForEveryExactScope(t *testing.T) {
	ctx, pool, db := executionDatabase(t)
	cutoverAt := time.Date(2026, 7, 20, 12, 0, 0, 0, time.UTC)
	completedAt := cutoverAt.Add(8 * 24 * time.Hour)
	seedReadyProgram(t, ctx, db, cutoverAt)
	if _, err := db.ExecContext(ctx, `UPDATE billing_migration_programs SET state='stabilizing',state_version=7,policy_digest=decode(repeat('71',32),'hex'),updated_at=$1 WHERE id='program_ready'`, cutoverAt); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `UPDATE billing_migration_credentials SET nonce=NULL,ciphertext=NULL,removed_at=$1,removed_by_actor_id='owner_one',removal_digest=decode(repeat('91',32),'hex') WHERE id='credential_ready'`, cutoverAt); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `UPDATE billing_migration_authority_scopes SET current_authority='mosaic',current_epoch=1,authority_digest=decode(repeat('92',32),'hex'),updated_at=$1 WHERE active_program_id='program_ready'`, cutoverAt); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO billing_migration_authority_transitions(id,program_id,project_id,authority_scope_id,from_authority,to_authority,from_epoch,to_epoch,transition_kind,transition_digest,transitioned_at)
		VALUES('completion_transition_ios','program_ready','project_one','authority_ready_ios','source','mosaic',0,1,'cutover',decode(repeat('93',32),'hex'),$1),
		('completion_transition_android','program_ready','project_one','authority_ready_android','source','mosaic',0,1,'cutover',decode(repeat('94',32),'hex'),$1)`, cutoverAt); err != nil {
		t.Fatal(err)
	}
	repository := billingmigrationpostgres.New(pool)
	assertStable := func(want bool, label string) {
		t.Helper()
		prerequisites, err := repository.CompletionPrerequisites(ctx, "project_one", "program_ready", completedAt)
		if err != nil || prerequisites.AuthorityStable != want {
			t.Fatalf("%s prerequisites=%#v err=%v", label, prerequisites, err)
		}
	}
	assertStable(false, "stale and wrong-epoch observations")
	if _, err := pool.Exec(ctx, `INSERT INTO billing_migration_v2_sync_observations(id,program_id,project_id,application_id,platform,app_version,sdk_version,supported_contract_versions,authority_capabilities,traffic_count,authority_epoch,sync_result,observation_digest,observed_at)
		VALUES('completion_sync_ios','program_ready','project_one','app_one','ios','2.10.0','2.1.0',ARRAY['2'],ARRAY['authority_epoch','authority_scope','urgent_authority_sync','mosaic_authoritative_targeting'],1,1,'accepted',decode(repeat('95',32),'hex'),$1)`, completedAt.Add(-30*time.Minute)); err != nil {
		t.Fatal(err)
	}
	assertStable(false, "missing exact android scope")
	if _, err := pool.Exec(ctx, `INSERT INTO billing_migration_v2_sync_observations(id,program_id,project_id,application_id,platform,app_version,sdk_version,supported_contract_versions,authority_capabilities,traffic_count,authority_epoch,sync_result,observation_digest,observed_at)
		VALUES('completion_sync_android_wrong_epoch','program_ready','project_one','app_two','android','2.10.0','2.1.0',ARRAY['2'],ARRAY['authority_epoch','authority_scope','urgent_authority_sync','mosaic_authoritative_targeting'],1,0,'accepted',decode(repeat('96',32),'hex'),$1)`, completedAt.Add(-20*time.Minute)); err != nil {
		t.Fatal(err)
	}
	assertStable(false, "wrong android authority epoch")
	if _, err := pool.Exec(ctx, `INSERT INTO billing_migration_v2_sync_observations(id,program_id,project_id,application_id,platform,app_version,sdk_version,supported_contract_versions,authority_capabilities,traffic_count,authority_epoch,sync_result,observation_digest,observed_at)
		VALUES('completion_sync_android','program_ready','project_one','app_two','android','2.10.0','2.1.0',ARRAY['2'],ARRAY['authority_epoch','authority_scope','urgent_authority_sync','mosaic_authoritative_targeting'],1,1,'accepted',decode(repeat('97',32),'hex'),$1)`, completedAt.Add(-10*time.Minute)); err != nil {
		t.Fatal(err)
	}
	assertStable(true, "fresh current-epoch evidence for every scope")
	if _, err := pool.Exec(ctx, `INSERT INTO webhook_destinations(id,project_id,environment_id,url,status,event_types,description,contract_version,last_successful_test_at,created_at,updated_at) VALUES
		('completion_webhook_fresh','project_one','environment_one','https://fresh.example.test','active',ARRAY['authority.rollback.completed'],'fresh',2,$1,$2,$2),
		('completion_webhook_stale','project_one','environment_one','https://stale.example.test','active',ARRAY['authority.rollback.completed'],'stale',2,$3,$2,$2)`, completedAt.Add(-time.Minute), cutoverAt, completedAt.Add(-2*time.Hour)); err != nil {
		t.Fatal(err)
	}
	prerequisites, err := repository.CompletionPrerequisites(ctx, "project_one", "program_ready", completedAt)
	if err != nil || prerequisites.WebhookReady {
		t.Fatalf("one fresh destination masked stale active destination: prerequisites=%#v err=%v", prerequisites, err)
	}
	policyDigest, _ := billingmigration.ParseDigest(prerequisites.PolicyDigest)
	authorityDigest, _ := billingmigration.ParseDigest(prerequisites.AuthorityDigest)
	stabilityDigest, _ := billingmigration.ParseDigest(prerequisites.StabilityEvidenceDigest)
	if _, _, err := repository.CompleteMigration(ctx, billingmigration.CompletionWrite{
		Report:               billingmigration.CompletionReport{ReportID: "completion_stale_webhook", ProgramID: "program_ready", ProjectID: "project_one", StateVersion: 8, CompletedAt: completedAt},
		ExpectedStateVersion: 7, ExpectedPolicyDigest: policyDigest, AuthorityDigest: authorityDigest, StabilityDigest: stabilityDigest,
		CompletionDigest: bytesOf(0xb1), RequestDigest: bytesOf(0xb2), DeletionIdentity: bytesOf(0xb3), RetentionJobID: "retention_stale_webhook", ActorID: "owner_one", IdempotencyKey: "completion-stale-webhook",
	}); !errors.Is(err, billingmigration.ErrConflict) {
		t.Fatalf("transactional completion accepted stale active destination: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE webhook_destinations SET last_successful_test_at=$1 WHERE id='completion_webhook_stale'`, completedAt.Add(-time.Minute)); err != nil {
		t.Fatal(err)
	}
	prerequisites, err = repository.CompletionPrerequisites(ctx, "project_one", "program_ready", completedAt)
	if err != nil || !prerequisites.WebhookReady {
		t.Fatalf("all active v2 destinations fresh: prerequisites=%#v err=%v", prerequisites, err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO webhook_destinations(id,project_id,environment_id,url,status,event_types,description,contract_version,last_successful_test_at,created_at,updated_at)
		VALUES('completion_webhook_v1','project_one','environment_one','https://v1.example.test','active',ARRAY['customer.entitlements.changed'],'v1',1,$1,$2,$2)`, completedAt.Add(-time.Minute), cutoverAt); err != nil {
		t.Fatal(err)
	}
	prerequisites, err = repository.CompletionPrerequisites(ctx, "project_one", "program_ready", completedAt)
	if err != nil || prerequisites.WebhookReady {
		t.Fatalf("active v1 destination incorrectly accepted: prerequisites=%#v err=%v", prerequisites, err)
	}
}

func TestPackageCRetentionSkipsHeldJobsAndExhaustsRetryBudget(t *testing.T) {
	ctx, pool, db := executionDatabase(t)
	now := time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)
	seedReadyProgram(t, ctx, db, now)
	if _, err := db.ExecContext(ctx, `INSERT INTO billing_migration_completion_reports(id,program_id,project_id,state_version,completed_at,stabilization_ended_at,rollback_window_ended_at,credential_removed,credential_removed_at,legal_hold,source_objects_delete_at,completion_digest,authority_digest,stability_evidence_digest,completion_policy_digest)
		VALUES('completion_retention','program_ready','project_one',5,$1::timestamptz,$1::timestamptz-interval '1 day',$1::timestamptz-interval '1 day',true,$1::timestamptz-interval '2 days',false,$1::timestamptz+interval '30 days',decode(repeat('a1',32),'hex'),decode(repeat('a2',32),'hex'),decode(repeat('a3',32),'hex'),decode(repeat('a4',32),'hex'))`, now); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO billing_migration_retention_jobs(id,program_id,project_id,status,legal_hold,due_at,lease_generation,created_at,updated_at,completion_report_id,attempt_count,max_attempts,deletion_identity,original_due_at)
		VALUES('retention_ops','program_ready','project_one','pending',true,$1,0,$1,$1,'completion_retention',0,2,decode(repeat('a5',32),'hex'),$1)`, now); err != nil {
		t.Fatal(err)
	}
	repository := billingmigrationpostgres.New(pool)
	if _, err := repository.ClaimRetention(ctx, billingmigration.RetentionClaim{WorkerID: "worker", Now: now, LeaseFor: time.Minute}); !errors.Is(err, billingmigration.ErrNotFound) {
		t.Fatalf("held retention claim error=%v", err)
	}
	var attempts int
	if err := pool.QueryRow(ctx, `SELECT attempt_count FROM billing_migration_retention_jobs WHERE id='retention_ops'`).Scan(&attempts); err != nil || attempts != 0 {
		t.Fatalf("held job attempts=%d err=%v", attempts, err)
	}
	if _, err := pool.Exec(ctx, `UPDATE billing_migration_retention_jobs SET legal_hold=false WHERE id='retention_ops'`); err != nil {
		t.Fatal(err)
	}
	lease, err := repository.ClaimRetention(ctx, billingmigration.RetentionClaim{WorkerID: "worker", Now: now, LeaseFor: time.Minute})
	if err != nil || lease.AttemptNumber != 1 {
		t.Fatalf("first lease=%#v err=%v", lease, err)
	}
	retryAt := now.Add(time.Hour)
	if err := repository.FinishRetention(ctx, billingmigration.RetentionFinish{JobID: lease.JobID, Generation: lease.Generation, ErrorCode: "object_delete_retryable", RetryAt: retryAt, At: now.Add(time.Minute)}); err != nil {
		t.Fatal(err)
	}
	second, err := repository.ClaimRetention(ctx, billingmigration.RetentionClaim{WorkerID: "worker", Now: retryAt, LeaseFor: time.Minute})
	if err != nil || second.AttemptNumber != 2 {
		t.Fatalf("second lease=%#v err=%v", second, err)
	}
	if err := repository.FinishRetention(ctx, billingmigration.RetentionFinish{JobID: second.JobID, Generation: second.Generation, ErrorCode: "object_delete_retryable", RetryAt: retryAt.Add(time.Hour), At: retryAt.Add(time.Minute)}); err != nil {
		t.Fatal(err)
	}
	var status, errorCode string
	if err := pool.QueryRow(ctx, `SELECT status,last_error_code FROM billing_migration_retention_jobs WHERE id='retention_ops'`).Scan(&status, &errorCode); err != nil || status != "failed" || errorCode != "object_delete_retryable" {
		t.Fatalf("terminal retention status=%q error=%q queryErr=%v", status, errorCode, err)
	}
}
