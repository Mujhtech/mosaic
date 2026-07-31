package billingmigrationpostgres_test

import (
	"bytes"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/pressly/goose/v3"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingmigration"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingmigrationpostgres"
	"github.com/Mujhtech/mosaic/apps/api/migrations"
)

func TestStabilizationAndRollbackReadinessUsePersistedEvidence(t *testing.T) {
	ctx, pool, db := executionDatabase(t)
	now := time.Now().UTC().Truncate(time.Microsecond)
	seedReadyProgram(t, ctx, db, now)
	_, err := pool.Exec(ctx, `UPDATE billing_migration_programs SET state='stabilizing',state_version=7,updated_at=$1 WHERE id='program_ready'; UPDATE billing_migration_authority_scopes SET current_authority='mosaic',current_epoch=1,authority_digest=decode(repeat('a1',32),'hex'),updated_at=$1 WHERE active_program_id='program_ready'; INSERT INTO billing_migration_capability_assessments(id,program_id,project_id,state_version,provider_api_version,capabilities,assessment_digest,assessed_at) VALUES('capability_rollback','program_ready','project_one',7,'v2',ARRAY['read_customers','read_subscriptions','read_aliases','incremental_delta'],decode(repeat('af',32),'hex'),$1-interval '1 minute'); INSERT INTO billing_migration_v2_sync_observations(id,program_id,project_id,application_id,platform,app_version,sdk_version,supported_contract_versions,authority_capabilities,traffic_count,authority_epoch,sync_result,observation_digest,observed_at) VALUES('stable_ios','program_ready','project_one','app_one','ios','2.10.0+ios.1','2.1.0',ARRAY['2'],ARRAY['authority_epoch','authority_scope','urgent_authority_sync','mosaic_authoritative_targeting'],1,1,'accepted',decode(repeat('a2',32),'hex'),$1),('stable_android_incomplete','program_ready','project_one','app_two','android','2.10.0+android.1','2.1.0',ARRAY['2'],ARRAY['authority_epoch','authority_scope','mosaic_authoritative_targeting'],1,1,'accepted',decode(repeat('a3',32),'hex'),$1)`, now)
	if err != nil {
		t.Fatal(err)
	}
	repo := billingmigrationpostgres.New(pool)
	thresholds := billingmigration.StabilizationThresholds{AuthorityMismatchMax: 0, AccessAPIErrorMax: 1, SDKSyncFailureMax: 0, DivergenceMax: 0, ValidationBacklogMax: 0, SourceDeltaLagMaxSeconds: 3600, WebhookFailureMax: 0, WebhookFreshnessMaxSeconds: 3600, QuarantineMax: 0, SupportCaseMax: 0, OldAppVersionMax: 0, WorkerUnhealthyMax: 0}
	policy, _, err := repo.FreezeStabilizationPolicy(ctx, billingmigration.FreezeStabilizationPolicyCommand{Input: billingmigration.FreezeStabilizationPolicyInput{ProjectID: "project_one", ProgramID: "program_ready", IdempotencyKey: "policy", ExpectedStateVersion: 7, Thresholds: thresholds}, ActorID: "owner_one", RequestDigest: bytes.Repeat([]byte{0xb1}, 32)})
	if err != nil {
		t.Fatal(err)
	}
	// Simulate two API instances completing adjacent windows. The later success
	// must not hide the earlier error: stabilization sums all fresh immutable
	// windows instead of selecting whichever instance wrote last.
	if err = repo.RecordTrustedAccessAPIResult(ctx, "project_one", "environment_one", 20*time.Millisecond, true); err != nil {
		t.Fatal(err)
	}
	if err = repo.RecordTrustedAccessAPIResult(ctx, "project_one", "environment_one", 10*time.Millisecond, false); err != nil {
		t.Fatal(err)
	}
	policyRaw, _ := billingmigration.ParseDigest(policy.PolicyDigest)
	observe := billingmigration.RecordStabilizationCommand{Input: billingmigration.RecordStabilizationInput{ProjectID: "project_one", ProgramID: "program_ready", IdempotencyKey: "observe", ExpectedStateVersion: 7, ExpectedAuthorityEpoch: 1, ExpectedPolicyDigest: policy.PolicyDigest}, ActorID: "owner_one", RequestDigest: bytes.Repeat([]byte{0xb3}, 32), ExpectedPolicyDigest: policyRaw}
	observation, replay, err := repo.RecordStabilization(ctx, observe)
	if err != nil || replay {
		t.Fatalf("observation=%#v replay=%v err=%v", observation, replay, err)
	}
	// No successful webhook evidence exists. It is unknown/blocking rather than
	// being silently treated as zero failures and healthy.
	if observation.Healthy || !containsString(observation.BreachCodes, "webhook_unknown") {
		t.Fatalf("untrusted missing telemetry became healthy: %+v", observation)
	}
	if observation.Metrics.AccessAPIErrors != 1 || containsString(observation.BreachCodes, "access_api_unknown") {
		t.Fatalf("multi-instance access evidence was masked or treated as unknown: %+v", observation)
	}
	if replayed, replayedFlag, err := repo.RecordStabilization(ctx, observe); err != nil || !replayedFlag || replayed.ID != observation.ID {
		t.Fatalf("observation replay=%#v replay=%v err=%v", replayed, replayedFlag, err)
	}
	stale := observe
	stale.RequestDigest = bytes.Repeat([]byte{0xb4}, 32)
	if _, _, err = repo.RecordStabilization(ctx, stale); !errors.Is(err, billingmigration.ErrIdempotencyConflict) {
		t.Fatalf("changed observation request error=%v", err)
	}
	observationRaw, _ := billingmigration.ParseDigest(observation.EvidenceDigest)
	assessment, checkpoint, _, err := repo.AssessRollbackReadiness(ctx, billingmigration.AssessRollbackReadinessCommand{Input: billingmigration.AssessRollbackReadinessInput{ProjectID: "project_one", ProgramID: "program_ready", ObservationID: observation.ID, IdempotencyKey: "readiness", ExpectedStateVersion: 7, ExpectedAuthorityEpoch: 1, ExpectedObservationDigest: observation.EvidenceDigest}, ActorID: "owner_one", RequestDigest: bytes.Repeat([]byte{0xb5}, 32), ExpectedObservationDigest: observationRaw})
	if err != nil {
		t.Fatal(err)
	}
	if assessment.Ready || assessment.SourceSupportAvailable || checkpoint.ID != "" {
		t.Fatalf("missing latest final source pull minted checkpoint: assessment=%#v checkpoint=%#v", assessment, checkpoint)
	}
	_, err = pool.Exec(ctx, `INSERT INTO billing_migration_source_objects(id,program_id,project_id,reservation_key,reservation_digest,reservation_generation,write_token_digest,object_key,source_channel,adapter_version,schema_version,state,envelope_version,algorithm,key_id,nonce,chunk_size,chunk_count,aad_digest,plaintext_digest,plaintext_size_bytes,ciphertext_digest,ciphertext_size_bytes,reserved_at,verified_at) VALUES('object_stable','program_ready','project_one','stable',decode(repeat('c1',32),'hex'),1,decode(repeat('c2',32),'hex'),'private/stable','revenuecat_api_v2','v2','v1','verified',1,'AES-256-GCM-CHUNKED','key',decode(repeat('01',12),'hex'),16384,1,decode(repeat('c3',32),'hex'),decode(repeat('c4',32),'hex'),1,decode(repeat('c5',32),'hex'),17,$1,$1);
	INSERT INTO billing_migration_source_objects(id,program_id,project_id,reservation_key,reservation_digest,reservation_generation,write_token_digest,object_key,source_channel,adapter_version,schema_version,state,envelope_version,algorithm,key_id,nonce,chunk_size,chunk_count,aad_digest,plaintext_digest,plaintext_size_bytes,ciphertext_digest,ciphertext_size_bytes,reserved_at,verified_at) VALUES('object_predecessor','program_ready','project_one','predecessor',decode(repeat('d1',32),'hex'),1,decode(repeat('d2',32),'hex'),'private/predecessor','revenuecat_api_v2','v2','v1','verified',1,'AES-256-GCM-CHUNKED','key',decode(repeat('02',12),'hex'),16384,1,decode(repeat('d3',32),'hex'),decode(repeat('d4',32),'hex'),0,decode(repeat('d5',32),'hex'),16,$1,$1);
	INSERT INTO billing_migration_source_manifests(id,program_id,project_id,state_version,adapter_version,provider_api_version,schema_version,record_count,current_access_record_count,object_key,object_checksum,object_size_bytes,object_encryption,manifest_digest,source_watermark,captured_at) VALUES('manifest_predecessor','program_ready','project_one',7,'v2','v2','v1',0,0,'private/predecessor',decode(repeat('d5',32),'hex'),16,'AES-256-GCM',decode(repeat('d6',32),'hex'),'predecessor-watermark',$1);
	INSERT INTO billing_migration_import_batches(id,program_id,project_id,manifest_id,mapping_set_id,idempotency_key,request_digest,expected_program_state_version,status,record_count,validated_count,quarantined_count,cursor_before,cursor_after,attempt_count,lease_generation,created_at,updated_at,due_at,max_attempts) VALUES('batch_predecessor','program_ready','project_one','manifest_predecessor','mapping_ready','predecessor-batch',decode(repeat('d7',32),'hex'),7,'completed',0,0,0,'','',1,1,$1,$1,$1,8);
	INSERT INTO billing_migration_import_batches(id,program_id,project_id,manifest_id,mapping_set_id,idempotency_key,request_digest,expected_program_state_version,status,record_count,validated_count,quarantined_count,cursor_before,cursor_after,attempt_count,lease_generation,created_at,updated_at,due_at,max_attempts) VALUES('batch_stable','program_ready','project_one','manifest_ready','mapping_ready','stable-batch',decode(repeat('c6',32),'hex'),7,'completed',2,1,0,'','',1,1,$1,$1,$1,8);
	INSERT INTO billing_migration_source_records(id,program_id,project_id,manifest_id,source_kind,source_identifier,source_revision,record_digest,current_access,normalization_schema_version,evidence_kind,observed_at,created_at) VALUES('record_unvalidated','program_ready','project_one','manifest_ready','subscription','subscription-unvalidated','1',decode(repeat('de',32),'hex'),true,'v1','trusted_source_export',$1,$1);
	INSERT INTO billing_migration_import_batch_records(import_batch_id,program_id,project_id,source_record_id,ordinal,provider,environment_id,application_id,provider_reference,reference_kind,expected_store_environment) VALUES('batch_stable','program_ready','project_one','record_ready',0,'app_store','environment_one','app_one','transaction-stable','app_store_transaction_id','production');
	INSERT INTO billing_migration_import_batch_records(import_batch_id,program_id,project_id,source_record_id,ordinal,provider,environment_id,application_id,provider_reference,reference_kind,expected_store_environment) VALUES('batch_stable','program_ready','project_one','record_unvalidated',1,'app_store','environment_one','app_one','transaction-unvalidated','app_store_transaction_id','production');
	INSERT INTO billing_raw_inputs(id,project_id,organization_id,environment_id,environment_mode,application_id,provider,source,source_authority,idempotency_key,content_digest,transaction_reference_digest,body_state,authentication_result,store_environment,ingestion_status,correlation_id,received_at,expires_at) VALUES('raw_stable','project_one','org_one','environment_one','production','app_one','app_store','migration_known_reference','store_reconciliation',decode(repeat('da',32),'hex'),decode(repeat('db',32),'hex'),sha256(convert_to('mosaic-billing-apple-transaction-v1'||chr(0)||'unclassified'||chr(0)||'transaction-stable','UTF8')),'not_retained','verified_transport','unclassified','accepted','stable',$1,$1+interval '1 hour');
	INSERT INTO billing_validation_attempts(id,project_id,environment_id,raw_input_id,attempt_number,validator_version,started_at,completed_at,outcome,retryable,store_environment,latency_ms,correlation_id) VALUES('attempt_stable','project_one','environment_one','raw_stable',1,2,$1,$1,'validated',false,'production',1,'stable');
	INSERT INTO billing_migration_validation_bindings(id,program_id,project_id,environment_id,raw_input_id,provider,reference_kind,reference_digest,expected_application_id,expected_store_product_identifier,expected_store_environment,expected_mosaic_product_id,status,validation_attempt_id,evidence_digest,provider_watermark,accepted_at,completed_at) VALUES('binding_stable','program_ready','project_one','environment_one','raw_stable','app_store','app_store_transaction_id',sha256(convert_to('mosaic-billing-apple-transaction-v1'||chr(0)||'unclassified'||chr(0)||'transaction-stable','UTF8')),'app_one','store.product','production','customer_two','validated','attempt_stable',decode(repeat('dd',32),'hex'),$1,$1,$1);
	INSERT INTO billing_migration_source_pull_jobs(id,program_id,project_id,intent,idempotency_key,request_digest,expected_program_state_version,starting_cursor,starting_watermark,starting_watermark_digest,mapping_set_id,status,result_source_object_id,result_manifest_id,result_import_batch_id,resume_cursor,final_watermark,evidence_digest,record_count,current_access_count,import_record_count,due_at,lease_generation,attempt_count,max_attempts,created_by_actor_id,started_at,completed_at,created_at,updated_at) VALUES('pull_completed_predecessor','program_ready','project_one','snapshot','completed-predecessor',decode(repeat('c7',32),'hex'),7,'','',NULL,'mapping_ready','completed','object_predecessor','manifest_predecessor','batch_predecessor','cursor','watermark',decode(repeat('c9',32),'hex'),0,0,0,$1,1,1,8,'owner_one',$1,$1,$1,$1);
	INSERT INTO billing_migration_source_pull_jobs(id,program_id,project_id,intent,idempotency_key,request_digest,expected_program_state_version,starting_cursor,starting_watermark,starting_watermark_digest,predecessor_pull_job_id,mapping_set_id,status,result_source_object_id,result_manifest_id,result_import_batch_id,result_final_delta_job_id,resume_cursor,final_watermark,evidence_digest,record_count,current_access_count,import_record_count,due_at,lease_generation,attempt_count,max_attempts,created_by_actor_id,started_at,completed_at,created_at,updated_at) VALUES('pull_final_stable','program_ready','project_one','final_delta','final-stable',decode(repeat('c8',32),'hex'),7,'cursor','watermark',decode(repeat('c9',32),'hex'),'pull_completed_predecessor','mapping_ready','completed','object_stable','manifest_ready','batch_stable','delta_job_ready','','final-watermark',decode(repeat('ca',32),'hex'),2,2,1,$1,1,1,8,'owner_one',$1,$1,$1,$1);
	INSERT INTO webhook_destinations(id,project_id,environment_id,url,status,event_types,description,contract_version,last_successful_test_at,created_at,updated_at) VALUES('stable_webhook','project_one','environment_one','https://stable.example.test','active',ARRAY['authority.cutover.completed'],'stable',2,$1,$1,$1),('stable_webhook_missing','project_one','environment_one','https://missing.example.test','active',ARRAY['authority.cutover.completed'],'missing coverage',2,$1,$1,$1);
	INSERT INTO webhook_events(id,project_id,environment_id,event_type,billing_customer_id,snapshot_version,payload,occurred_at,created_at,contract_version,authority_scope_id,authority_epoch,authority_kind,transition_state,correlation_id,snapshot_authority_digest) VALUES('stable_event','project_one','environment_one','authority.cutover.completed','customer_one',0,'{}',$1,$1,2,'authority_ready_ios',1,'mosaic','stabilizing','stable-correlation',decode(repeat('a1',32),'hex'));
	INSERT INTO webhook_events(id,project_id,environment_id,event_type,billing_customer_id,snapshot_version,payload,occurred_at,created_at,contract_version,authority_scope_id,authority_epoch,authority_kind,transition_state,correlation_id,snapshot_authority_digest) VALUES('stable_event_android','project_one','environment_one','authority.cutover.completed','customer_one',0,'{}',$1,$1,2,'authority_ready_android',1,'mosaic','stabilizing','stable-correlation-android',decode(repeat('a1',32),'hex'));
	INSERT INTO webhook_deliveries(id,project_id,environment_id,webhook_event_id,webhook_destination_id,status,attempt_count,max_attempts,created_at,updated_at,completed_at) VALUES('stable_delivery','project_one','environment_one','stable_event','stable_webhook','succeeded',1,8,$1,$1,$1),('stable_delivery_android','project_one','environment_one','stable_event_android','stable_webhook','succeeded',1,8,$1,$1,$1)`, now)
	if err != nil {
		t.Fatal(err)
	}
	observe2 := observe
	observe2.Input.IdempotencyKey = "observe-negative-evidence"
	observe2.RequestDigest = bytes.Repeat([]byte{0xcb}, 32)
	negativeObservation, _, err := repo.RecordStabilization(ctx, observe2)
	if err != nil {
		t.Fatal(err)
	}
	if negativeObservation.Metrics.ValidationBacklog != 1 || !containsString(negativeObservation.BreachCodes, "webhook_unknown") {
		t.Fatalf("exact-reference backlog or destination coverage was lost: %+v", negativeObservation)
	}
	negativeRaw, _ := billingmigration.ParseDigest(negativeObservation.EvidenceDigest)
	negativeAssessment, negativeCheckpoint, _, err := repo.AssessRollbackReadiness(ctx, billingmigration.AssessRollbackReadinessCommand{Input: billingmigration.AssessRollbackReadinessInput{ProjectID: "project_one", ProgramID: "program_ready", ObservationID: negativeObservation.ID, IdempotencyKey: "readiness-negative-evidence", ExpectedStateVersion: 7, ExpectedAuthorityEpoch: 1, ExpectedObservationDigest: negativeObservation.EvidenceDigest}, ActorID: "owner_one", RequestDigest: bytes.Repeat([]byte{0xcf}, 32), ExpectedObservationDigest: negativeRaw})
	if err != nil {
		t.Fatal(err)
	}
	if negativeAssessment.Ready || !negativeAssessment.SourceSupportAvailable || negativeAssessment.ApplicationCompatible || negativeCheckpoint.ID != "" {
		t.Fatalf("weak SDK policy or incomplete destination/backlog evidence minted checkpoint: assessment=%#v checkpoint=%#v", negativeAssessment, negativeCheckpoint)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO billing_migration_rollback_readiness_checkpoints(id,program_id,project_id,assessment_id,assessment_ready,state_version,authority_epoch,authority_digest,policy_digest,evidence_digest,readiness_digest,checkpoint_digest,created_by_actor_id,created_at) VALUES('forged_not_ready','program_ready','project_one',$1,true,7,1,decode(repeat('f1',32),'hex'),decode(repeat('f2',32),'hex'),decode(repeat('f3',32),'hex'),decode(repeat('f4',32),'hex'),decode(repeat('f5',32),'hex'),'owner_one',$2)`, negativeAssessment.ID, now); err == nil {
		t.Fatal("database accepted checkpoint referencing a not-ready assessment")
	}
	_, err = pool.Exec(ctx, `INSERT INTO billing_raw_inputs(id,project_id,organization_id,environment_id,environment_mode,application_id,provider,source,source_authority,idempotency_key,content_digest,transaction_reference_digest,body_state,authentication_result,store_environment,ingestion_status,correlation_id,received_at,expires_at) VALUES('raw_unvalidated','project_one','org_one','environment_one','production','app_one','app_store','migration_known_reference','store_reconciliation',decode(repeat('e1',32),'hex'),decode(repeat('e2',32),'hex'),sha256(convert_to('mosaic-billing-apple-transaction-v1'||chr(0)||'unclassified'||chr(0)||'transaction-unvalidated','UTF8')),'not_retained','verified_transport','unclassified','accepted','unvalidated',$1,$1+interval '1 hour');
	INSERT INTO billing_validation_attempts(id,project_id,environment_id,raw_input_id,attempt_number,validator_version,started_at,completed_at,outcome,retryable,store_environment,latency_ms,correlation_id) VALUES('attempt_unvalidated','project_one','environment_one','raw_unvalidated',1,2,$1,$1,'validated',false,'production',1,'unvalidated');
	INSERT INTO billing_migration_validation_bindings(id,program_id,project_id,environment_id,raw_input_id,provider,reference_kind,reference_digest,expected_application_id,expected_store_product_identifier,expected_store_environment,expected_mosaic_product_id,status,validation_attempt_id,evidence_digest,provider_watermark,accepted_at,completed_at) VALUES('binding_unvalidated','program_ready','project_one','environment_one','raw_unvalidated','app_store','app_store_transaction_id',sha256(convert_to('mosaic-billing-apple-transaction-v1'||chr(0)||'unclassified'||chr(0)||'transaction-unvalidated','UTF8')),'app_one','store.product','production','customer_two','validated','attempt_unvalidated',decode(repeat('e4',32),'hex'),$1,$1,$1);
	INSERT INTO billing_migration_v2_sync_observations(id,program_id,project_id,application_id,platform,app_version,sdk_version,supported_contract_versions,authority_capabilities,traffic_count,authority_epoch,sync_result,observation_digest,observed_at) VALUES('stable_android_complete','program_ready','project_one','app_two','android','2.10.0+android.1','2.1.0',ARRAY['2'],ARRAY['authority_epoch','authority_scope','urgent_authority_sync','mosaic_authoritative_targeting'],1,1,'accepted',decode(repeat('e5',32),'hex'),$1);
	INSERT INTO webhook_deliveries(id,project_id,environment_id,webhook_event_id,webhook_destination_id,status,attempt_count,max_attempts,created_at,updated_at,completed_at) VALUES('stable_delivery_missing_ios','project_one','environment_one','stable_event','stable_webhook_missing','succeeded',1,8,$1,$1,$1),('stable_delivery_missing_android','project_one','environment_one','stable_event_android','stable_webhook_missing','succeeded',1,8,$1,$1,$1)`, now)
	if err != nil {
		t.Fatal(err)
	}
	observeReady := observe
	observeReady.Input.IdempotencyKey = "observe-ready"
	observeReady.RequestDigest = bytes.Repeat([]byte{0xd0}, 32)
	readyObservation, _, err := repo.RecordStabilization(ctx, observeReady)
	if err != nil {
		t.Fatal(err)
	}
	if !readyObservation.Healthy || readyObservation.Metrics.ValidationBacklog != 0 {
		t.Fatalf("terminal exact bindings or full destination coverage remained unhealthy: %+v", readyObservation)
	}
	readyRaw, _ := billingmigration.ParseDigest(readyObservation.EvidenceDigest)
	readyAssessment, readyCheckpoint, _, err := repo.AssessRollbackReadiness(ctx, billingmigration.AssessRollbackReadinessCommand{Input: billingmigration.AssessRollbackReadinessInput{ProjectID: "project_one", ProgramID: "program_ready", ObservationID: readyObservation.ID, IdempotencyKey: "readiness-ready", ExpectedStateVersion: 7, ExpectedAuthorityEpoch: 1, ExpectedObservationDigest: readyObservation.EvidenceDigest}, ActorID: "owner_one", RequestDigest: bytes.Repeat([]byte{0xcc}, 32), ExpectedObservationDigest: readyRaw})
	if err != nil {
		t.Fatal(err)
	}
	if !readyAssessment.Ready || !readyAssessment.SourceSupportAvailable || readyCheckpoint.ID == "" {
		t.Fatalf("persisted prerequisites did not mint checkpoint: assessment=%#v checkpoint=%#v", readyAssessment, readyCheckpoint)
	}
	_, err = pool.Exec(ctx, `UPDATE billing_migration_source_pull_jobs SET status='failed',result_source_object_id=NULL,result_manifest_id=NULL,result_import_batch_id=NULL,evidence_digest=NULL,completed_at=NULL,failed_at=$1,last_error_code='broken_chain' WHERE id='pull_completed_predecessor'`, now.Add(time.Second))
	if err != nil {
		t.Fatal(err)
	}
	observe3 := observe
	observe3.Input.IdempotencyKey = "observe-broken-chain"
	observe3.RequestDigest = bytes.Repeat([]byte{0xcd}, 32)
	brokenObservation, _, err := repo.RecordStabilization(ctx, observe3)
	if err != nil {
		t.Fatal(err)
	}
	brokenRaw, _ := billingmigration.ParseDigest(brokenObservation.EvidenceDigest)
	brokenAssessment, brokenCheckpoint, _, err := repo.AssessRollbackReadiness(ctx, billingmigration.AssessRollbackReadinessCommand{Input: billingmigration.AssessRollbackReadinessInput{ProjectID: "project_one", ProgramID: "program_ready", ObservationID: brokenObservation.ID, IdempotencyKey: "readiness-broken-chain", ExpectedStateVersion: 7, ExpectedAuthorityEpoch: 1, ExpectedObservationDigest: brokenObservation.EvidenceDigest}, ActorID: "owner_one", RequestDigest: bytes.Repeat([]byte{0xce}, 32), ExpectedObservationDigest: brokenRaw})
	if err != nil {
		t.Fatal(err)
	}
	if brokenAssessment.Ready || brokenAssessment.SourceSupportAvailable || brokenCheckpoint.ID != "" {
		t.Fatalf("broken predecessor chain minted checkpoint: assessment=%#v checkpoint=%#v", brokenAssessment, brokenCheckpoint)
	}
	var checkpoints int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM billing_migration_rollback_readiness_checkpoints WHERE program_id='program_ready'`).Scan(&checkpoints); err != nil || checkpoints != 1 {
		t.Fatalf("checkpoint count=%d err=%v", checkpoints, err)
	}
	goose.SetBaseFS(migrations.Files)
	if err = goose.SetDialect("postgres"); err != nil {
		t.Fatal(err)
	}
	if err = goose.DownContext(ctx, db, "."); err == nil || !strings.Contains(err.Error(), "immutable stabilization or rollback-readiness evidence exists") {
		t.Fatalf("migration61 down guard error=%v", err)
	}
}

func containsString(values []string, want string) bool {
	for _, v := range values {
		if v == want {
			return true
		}
	}
	return false
}
