package billingmigrationevaluation

import (
	"bytes"
	"context"
	"database/sql"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/Mujhtech/mosaic/apps/api/internal/billing"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingmigration"
	"github.com/Mujhtech/mosaic/apps/api/migrations"
)

// This test needs its own throwaway database because both the migration being
// tested and the append-only evidence it creates intentionally refuse cleanup.
// candidateEvaluationVersion is migration 00060, whose down guard refuses to
// drop candidate-evaluation evidence. The rollback targets below are stated as
// versions so that adding a migration above 00060 cannot quietly change which
// migration this test exercises.
const (
	candidateEvaluationVersion = 60
	belowCandidateEvaluation   = 59
)

func TestCandidateEvaluationMigrationDownRefusesImmutableEvidence(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_TEST_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_TEST_URL is required for PostgreSQL integration tests")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err = db.ExecContext(ctx, `DROP SCHEMA public CASCADE; CREATE SCHEMA public`); err != nil {
		t.Fatalf("reset dedicated schema: %v", err)
	}
	goose.SetBaseFS(migrations.Files)
	if err = goose.SetDialect("postgres"); err != nil {
		t.Fatal(err)
	}
	if err = goose.UpContext(ctx, db, "."); err != nil {
		t.Fatalf("apply migrations: %v", err)
	}
	// Stepped to explicit versions rather than "one down from the top". The
	// test is about what 00060's down does with evidence present, and a bare
	// Down peels whatever migration happens to be newest, so every migration
	// added afterwards silently retargeted this test at unrelated schema.
	if err = goose.DownToContext(ctx, db, ".", belowCandidateEvaluation); err != nil {
		t.Fatalf("empty rollback below 00060: %v", err)
	}
	if err = goose.UpContext(ctx, db, "."); err != nil {
		t.Fatalf("re-up after empty rollback: %v", err)
	}
	_, err = db.ExecContext(ctx, `INSERT INTO organizations(id,name,created_at,updated_at) VALUES('org_eval','Evaluation',now(),now());
		INSERT INTO projects(id,organization_id,key,name,status,created_at,updated_at) VALUES('project_eval','org_eval','evaluation','Evaluation','active',now(),now());
		INSERT INTO environments(id,project_id,key,name,mode,created_at,updated_at) VALUES('environment_eval','project_eval','production','Production','production',now(),now());
		INSERT INTO billing_migration_credentials(id,project_id,provider,external_project_id,status,envelope_version,algorithm,key_id,nonce,ciphertext,fingerprint,created_by_actor_id,created_at) VALUES('credential_eval','project_eval','revenuecat','rc_eval','active',1,'AES-256-GCM','key',decode(repeat('01',12),'hex'),decode(repeat('02',32),'hex'),decode(repeat('03',32),'hex'),'owner',now());
		INSERT INTO billing_migration_programs(id,project_id,environment_id,source_adapter,source_adapter_version,credential_id,state,state_version,authority_epoch_before,stabilization_days,rollback_window_days,scope_digest,policy_digest,idempotency_key,request_digest,created_by_actor_id,created_at,updated_at) VALUES('program_eval','project_eval','environment_eval','revenuecat','revenuecat-v2-readonly-v1','credential_eval','shadowing',3,0,7,7,decode(repeat('11',32),'hex'),decode(repeat('12',32),'hex'),'eval',decode(repeat('13',32),'hex'),'owner',now(),now());
		INSERT INTO billing_migration_candidate_evaluations(id,program_id,project_id,job_id,job_kind,state_version,authority_epoch,manifest_digest,mapping_digest,policy_digest,evidence_digest,source_watermark,provider_watermark,shadow_watermark,cohort_digest,evaluation_digest,evaluated_at) VALUES('evaluation_one','program_eval','project_eval','job_eval','shadow',3,0,decode(repeat('21',32),'hex'),decode(repeat('22',32),'hex'),decode(repeat('12',32),'hex'),decode(repeat('23',32),'hex'),now(),now(),now(),decode(repeat('24',32),'hex'),decode(repeat('25',32),'hex'),now())`)
	if err != nil {
		t.Fatalf("seed immutable evaluation: %v", err)
	}
	// Everything above 00060 must still roll back with evidence present: the
	// guard belongs to 00060 alone.
	if err = goose.DownToContext(ctx, db, ".", candidateEvaluationVersion); err != nil {
		t.Fatalf("rollback down to 00060 before the guard: %v", err)
	}
	err = goose.DownToContext(ctx, db, ".", belowCandidateEvaluation)
	if err == nil || !strings.Contains(err.Error(), "immutable candidate evaluation evidence exists") {
		t.Fatalf("populated migration down error=%v", err)
	}
	var count int
	if err = db.QueryRowContext(ctx, `SELECT count(*) FROM billing_migration_candidate_evaluations`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("down guard lost evidence count=%d err=%v", count, err)
	}
}

func TestBuilderPersistsCandidateWithoutLiveMutationAndReplaysDeterministically(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_TEST_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_TEST_URL is required for PostgreSQL integration tests")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	config, err := pgx.ParseConfig(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	config.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	db := stdlib.OpenDB(*config)
	defer db.Close()
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
	now := time.Now().UTC().Truncate(time.Microsecond)
	manifest, mapping, policy, evidence := bytes.Repeat([]byte{0x21}, 32), bytes.Repeat([]byte{0x22}, 32), bytes.Repeat([]byte{0x23}, 32), bytes.Repeat([]byte{0x24}, 32)
	referenceDigest := billing.AppleTransactionKey(billing.StoreUnclassified, "transaction_one")
	aggregateEvidence := hashSorted("mosaic-billing-migration-validation-result-v1", [][]byte{evidence})
	_, err = db.ExecContext(ctx, `INSERT INTO organizations(id,name,created_at,updated_at) VALUES('org_eval','Evaluation',$1,$1);
		INSERT INTO projects(id,organization_id,key,name,status,created_at,updated_at) VALUES('project_eval','org_eval','evaluation','Evaluation','active',$1,$1);
		INSERT INTO environments(id,project_id,key,name,mode,created_at,updated_at) VALUES('environment_eval','project_eval','production','Production','production',$1,$1);
		INSERT INTO applications(id,project_id,name,platform,identifier,created_at,updated_at) VALUES
		('app_eval','project_eval','App','ios','com.example.eval',$1,$1),
		('app_eval_android','project_eval','App Android','android','com.example.eval.android',$1,$1);
		INSERT INTO products(id,project_id,key,internal_name,description,type,status,metadata_source,readiness_ready,created_at,updated_at) VALUES('product_eval','project_eval','pro','Pro','','subscription','connected','mock',true,$1,$1);
		INSERT INTO entitlements(id,project_id,key,name,description,created_at,updated_at) VALUES('entitlement_eval','project_eval','pro','Pro','',$1,$1);
		INSERT INTO provider_product_mappings(id,project_id,product_id,application_id,provider,provider_product_identifier,platform,status,created_at,updated_at) VALUES('ppm_eval','project_eval','product_eval','app_eval','app_store','store.product','ios','placeholder',$1,$1);
		INSERT INTO product_entitlement_grant_versions(id,project_id,product_id,entitlement_id,version,effective_start,created_at,supported_purchase_types,grants_in_active,grants_in_trial,grants_in_grace,grants_in_one_time_ownership) VALUES('grant_eval','project_eval','product_eval','entitlement_eval',1,$1::timestamptz-interval '1 day',$1,ARRAY['auto_renewable_subscription','non_consumable']::text[],true,true,true,true);
		INSERT INTO billing_customers(id,project_id,status,diagnostics_status,created_at,updated_at) VALUES('customer_eval','project_eval','active','none',$1,$1);
		INSERT INTO billing_migration_credentials(id,project_id,provider,external_project_id,status,envelope_version,algorithm,key_id,nonce,ciphertext,fingerprint,created_by_actor_id,created_at) VALUES('credential_eval','project_eval','revenuecat','rc_eval','active',1,'AES-256-GCM','key',decode(repeat('01',12),'hex'),decode(repeat('02',32),'hex'),decode(repeat('03',32),'hex'),'owner',$1);
		INSERT INTO billing_migration_programs(id,project_id,environment_id,source_adapter,source_adapter_version,credential_id,state,state_version,authority_epoch_before,stabilization_days,rollback_window_days,scope_digest,policy_digest,idempotency_key,request_digest,created_by_actor_id,created_at,updated_at) VALUES('program_eval','project_eval','environment_eval','revenuecat','revenuecat-v2-readonly-v1','credential_eval','shadowing',3,0,7,7,decode(repeat('11',32),'hex'),$4,'eval',decode(repeat('13',32),'hex'),'owner',$1,$1);
		INSERT INTO billing_migration_program_scopes(program_id,project_id,environment_id,application_id,platform,created_at) VALUES
		('program_eval','project_eval','environment_eval','app_eval','ios',$1),
		('program_eval','project_eval','environment_eval','app_eval_android','android',$1);
		INSERT INTO billing_migration_authority_scopes(id,project_id,environment_id,application_id,platform,current_authority,current_epoch,active_program_id,authority_digest,updated_at) VALUES
		('authority_eval','project_eval','environment_eval','app_eval','ios','source',0,'program_eval',decode(repeat('14',32),'hex'),$1),
		('authority_eval_android','project_eval','environment_eval','app_eval_android','android','source',0,'program_eval',decode(repeat('19',32),'hex'),$1);
		INSERT INTO billing_migration_mapping_sets(id,program_id,project_id,version,status,mapping_digest,expected_program_state_version,created_by_actor_id,created_at) VALUES('mapping_eval','program_eval','project_eval',1,'draft',$3,3,'owner',$1);
		INSERT INTO billing_migration_mapping_entries(id,mapping_set_id,program_id,project_id,source_kind,source_identifier,target_id,match_kind,application_id,platform,created_at) VALUES('customer_map','mapping_eval','program_eval','project_eval','customer_id','source_customer','customer_eval','exact','app_eval','ios',$1),('product_map','mapping_eval','program_eval','project_eval','product','source_product','product_eval','exact','app_eval','ios',$1);
		UPDATE billing_migration_mapping_sets SET status='frozen',frozen_at=$1 WHERE id='mapping_eval';
		INSERT INTO billing_migration_source_manifests(id,program_id,project_id,state_version,adapter_version,provider_api_version,schema_version,record_count,current_access_record_count,object_key,object_checksum,object_size_bytes,object_encryption,manifest_digest,source_watermark,captured_at) VALUES('manifest_eval','program_eval','project_eval',3,'adapter','v2','schema',1,1,'object',decode(repeat('15',32),'hex'),1,'AES-256-GCM',$2,$5,$1);
		INSERT INTO billing_migration_source_records(id,program_id,project_id,manifest_id,source_kind,source_identifier,source_revision,record_digest,current_access,normalization_schema_version,evidence_kind,observed_at,created_at) VALUES('record_eval','program_eval','project_eval','manifest_eval','subscription','subscription_one','1',decode(repeat('16',32),'hex'),true,'schema','trusted_provider_api',$1,$1);
		INSERT INTO billing_migration_source_record_relationships(source_record_id,program_id,project_id,customer_source_identifier,product_source_identifier,external_application_id,store,provider_environment,store_identifier,mosaic_product_id,relationship_digest,created_at) VALUES('record_eval','program_eval','project_eval','source_customer','source_product','external','app_store','production','store.product','product_eval',decode(repeat('17',32),'hex'),$1);
		INSERT INTO billing_migration_source_records(id,program_id,project_id,manifest_id,source_kind,source_identifier,source_revision,record_digest,current_access,normalization_schema_version,evidence_kind,observed_at,created_at) VALUES('record_quarantined','program_eval','project_eval','manifest_eval','subscription','subscription_quarantined','1',decode(repeat('1a',32),'hex'),true,'schema','trusted_provider_api',$1,$1);
		INSERT INTO billing_migration_source_record_relationships(source_record_id,program_id,project_id,customer_source_identifier,product_source_identifier,external_application_id,store,provider_environment,store_identifier,mosaic_product_id,quarantine_reason,relationship_digest,created_at) VALUES('record_quarantined','program_eval','project_eval','source_quarantined','source_product',NULL,'app_store','production','store.product','product_eval','missing_application_binding',decode(repeat('1b',32),'hex'),$1);
		INSERT INTO billing_migration_import_batches(id,program_id,project_id,manifest_id,mapping_set_id,idempotency_key,request_digest,expected_program_state_version,status,record_count,validated_count,quarantined_count,cursor_before,cursor_after,attempt_count,lease_generation,created_at,updated_at,due_at,max_attempts) VALUES('batch_eval','program_eval','project_eval','manifest_eval','mapping_eval','batch',decode(repeat('18',32),'hex'),3,'completed',1,1,0,'','',1,1,$1,$1,$1,8);
		INSERT INTO billing_migration_import_batch_records(import_batch_id,program_id,project_id,source_record_id,ordinal,provider,environment_id,application_id,provider_reference,reference_kind,source_product_identifier,mosaic_product_id,expected_store_product_identifier,expected_store_environment) VALUES('batch_eval','program_eval','project_eval','record_eval',0,'app_store','environment_eval','app_eval','transaction_one','app_store_transaction_id','source_product','product_eval','store.product','production');
		INSERT INTO billing_raw_inputs(id,project_id,organization_id,environment_id,environment_mode,application_id,provider,source,source_authority,idempotency_key,content_digest,transaction_reference_digest,body_state,authentication_result,store_environment,ingestion_status,correlation_id,received_at,expires_at) VALUES('raw_eval','project_eval','org_eval','environment_eval','production','app_eval','app_store','migration_known_reference','store_reconciliation',decode(repeat('31',32),'hex'),decode(repeat('32',32),'hex'),$6,'not_retained','verified_transport','unclassified','accepted','eval',$1,$1::timestamptz+interval '1 hour');
		INSERT INTO billing_validation_attempts(id,project_id,environment_id,raw_input_id,attempt_number,validator_version,started_at,completed_at,outcome,retryable,store_environment,latency_ms,correlation_id) VALUES('attempt_eval','project_eval','environment_eval','raw_eval',1,2,$1,$1,'validated',false,'production',1,'eval');
		INSERT INTO billing_migration_validation_bindings(id,program_id,project_id,environment_id,raw_input_id,provider,reference_kind,reference_digest,expected_application_id,expected_store_product_identifier,expected_store_environment,expected_mosaic_product_id,status,validation_attempt_id,evidence_digest,provider_watermark,accepted_at,completed_at) VALUES('binding_eval','program_eval','project_eval','environment_eval','raw_eval','app_store','app_store_transaction_id',$6,'app_eval','store.product','production','product_eval','validated','attempt_eval',$7,$1,$1,$1);
		INSERT INTO purchase_lineages(id,project_id,environment_id,environment_mode,application_id,provider,store_environment,lineage_key_digest,lineage_type,billing_customer_id,created_at,updated_at) VALUES('lineage_eval','project_eval','environment_eval','production','app_eval','app_store','production',decode(repeat('33',32),'hex'),'subscription','customer_eval',$1,$1);
		INSERT INTO subscription_instances(id,project_id,environment_id,application_id,purchase_lineage_id,billing_customer_id,provider,created_at,updated_at) VALUES('subscription_eval','project_eval','environment_eval','app_eval','lineage_eval','customer_eval','app_store',$1,$1);
		INSERT INTO billing_transaction_facts(id,project_id,environment_id,environment_mode,application_id,provider,store_environment,provider_transaction_id,purchase_chain_digest,transaction_type,fact_kind,occurred_at,period_start_at,period_end_at,provider_product_identifier,resolution_state,mosaic_product_id,provider_product_mapping_id,resolved_mapping_version,validator_version,source_raw_input_id,validation_attempt_id,fact_digest,recorded_at) VALUES('fact_eval','project_eval','environment_eval','production','app_eval','app_store','production','transaction_one',decode(repeat('33',32),'hex'),'auto_renewable_subscription','initial_purchase',$1,$1,$1::timestamptz+interval '1 day','store.product','active_mapping','product_eval','ppm_eval',1,2,'raw_eval','attempt_eval',decode(repeat('34',32),'hex'),$1);
		INSERT INTO billing_validation_attempts(id,project_id,environment_id,raw_input_id,attempt_number,validator_version,started_at,completed_at,outcome,retryable,store_environment,latency_ms,correlation_id) VALUES('attempt_later','project_eval','environment_eval','raw_eval',2,2,$1,$1,'validated',false,'production',1,'eval-later');
		INSERT INTO billing_transaction_facts(id,project_id,environment_id,environment_mode,application_id,provider,store_environment,provider_transaction_id,purchase_chain_digest,transaction_type,fact_kind,occurred_at,period_start_at,period_end_at,provider_product_identifier,resolution_state,mosaic_product_id,provider_product_mapping_id,resolved_mapping_version,validator_version,source_raw_input_id,validation_attempt_id,fact_digest,recorded_at) VALUES('fact_later_attempt','project_eval','environment_eval','production','app_eval','app_store','production','transaction_later',decode(repeat('33',32),'hex'),'auto_renewable_subscription','renewal',$1,$1,$1::timestamptz+interval '2 days','store.product','active_mapping','product_eval','ppm_eval',1,2,'raw_eval','attempt_later',decode(repeat('35',32),'hex'),$1);
		INSERT INTO billing_migration_run_jobs(id,program_id,project_id,run_kind,idempotency_key,request_digest,expected_program_state_version,manifest_digest,mapping_digest,policy_digest,status,lease_owner,lease_expires_at,lease_generation,attempt_count,due_at,max_attempts,created_at,updated_at) VALUES('run_eval','program_eval','project_eval','shadow','run',decode(repeat('41',32),'hex'),3,$2,$3,$4,'running','worker',$1::timestamptz+interval '1 hour',1,1,$1,8,$1,$1)`, now, manifest, mapping, policy, now.Format(time.RFC3339Nano), referenceDigest, evidence)
	if err != nil {
		t.Fatalf("seed evaluation: %v", err)
	}
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	lease := billingmigration.ExecutionLease{JobID: "run_eval", JobKind: "shadow", ProjectID: "project_eval", ProgramID: "program_eval", Owner: "worker", Generation: 1, ExpectedStateVersion: 3, ManifestDigest: manifest, MappingDigest: mapping, PolicyDigest: policy, ExpiresAt: now.Add(time.Hour)}
	builder := New(pool)
	frozen, err := builder.loadFrozen(ctx, lease)
	if err != nil {
		t.Fatalf("load frozen evaluation: %v", err)
	}
	_, evidenceDivergences, _, _, allowedFacts, err := builder.loadEvidence(ctx, lease, frozen)
	if err != nil {
		t.Fatalf("load evaluation evidence: %v", err)
	}
	if !allowedFacts["app_eval"]["fact_eval"] || allowedFacts["app_eval"]["fact_later_attempt"] {
		t.Fatalf("facts were not bound to exact terminal attempt: %+v", allowedFacts["app_eval"])
	}
	quarantineBlocked := false
	for _, divergence := range evidenceDivergences {
		quarantineBlocked = quarantineBlocked || (divergence.Divergence.Classification == "blocking" && divergence.Divergence.Reason == "provider_validation_missing")
	}
	if !quarantineBlocked {
		t.Fatalf("pre-import quarantined current-access record was invisible: %+v", evidenceDivergences)
	}
	run, pointers, digest, err := builder.Evaluate(ctx, lease)
	if err != nil {
		t.Fatalf("evaluate: %v", err)
	}
	if len(pointers) != 1 || len(run.ShadowSnapshots) != 1 || len(digest) != 32 {
		t.Fatalf("candidate coverage pointers=%d shadows=%d digest=%d", len(pointers), len(run.ShadowSnapshots), len(digest))
	}
	var live int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM customer_entitlement_pointers WHERE project_id='project_eval'`).Scan(&live); err != nil || live != 0 {
		t.Fatalf("candidate mutated live pointer count=%d err=%v", live, err)
	}
	_, pointers2, digest2, err := builder.Evaluate(ctx, lease)
	if err != nil || len(pointers2) != 1 || !bytes.Equal(digest, digest2) || pointers2[0].SnapshotID != pointers[0].SnapshotID {
		t.Fatalf("deterministic replay pointers=%+v digest=%x err=%v", pointers2, digest2, err)
	}
	var candidates int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM billing_migration_candidate_snapshots WHERE program_id='program_eval'`).Scan(&candidates); err != nil || candidates != 1 {
		t.Fatalf("replay duplicated candidate count=%d err=%v", candidates, err)
	}
	stale := lease
	stale.Generation = 2
	if _, _, _, err = builder.Evaluate(ctx, stale); err == nil {
		t.Fatal("stale lease generation was accepted")
	}
	if _, err = pool.Exec(ctx, `INSERT INTO billing_migration_final_delta_jobs(id,program_id,project_id,idempotency_key,request_digest,expected_program_state_version,manifest_digest,mapping_digest,evidence_digest,status,due_at,lease_owner,lease_expires_at,lease_generation,attempt_count,max_attempts,created_at,updated_at) VALUES('final_eval','program_eval','project_eval','final',decode(repeat('51',32),'hex'),3,$1,$2,$3,'running',$4,'final_worker',$4::timestamptz+interval '1 hour',1,1,8,$4,$4)`, manifest, mapping, aggregateEvidence, now); err != nil {
		t.Fatal(err)
	}
	finalLease := billingmigration.ExecutionLease{JobID: "final_eval", JobKind: "final_delta", ProjectID: "project_eval", ProgramID: "program_eval", Owner: "final_worker", Generation: 1, ExpectedStateVersion: 3, ManifestDigest: manifest, MappingDigest: mapping, EvidenceDigest: aggregateEvidence, ExpiresAt: now.Add(time.Hour)}
	delta, finalPointers, finalDigest, err := builder.BuildFinalDelta(ctx, finalLease)
	if err != nil {
		t.Fatalf("build final delta: %v", err)
	}
	if len(finalPointers) != 2 || len(delta.Cohort) != 1 || delta.Cohort[0].BillingCustomerID != "customer_eval" || len(finalDigest) != 32 {
		t.Fatalf("final coverage pointers=%d cohort=%+v digest=%d", len(finalPointers), delta.Cohort, len(finalDigest))
	}
	seenScopes := map[string]bool{}
	for _, pointer := range finalPointers {
		seenScopes[pointer.ApplicationID+":"+pointer.Platform] = true
	}
	if !seenScopes["app_eval:ios"] || !seenScopes["app_eval_android:android"] {
		t.Fatalf("final cohort did not cover every exact program scope: %+v", finalPointers)
	}
	if !delta.SourceWatermark.Equal(now) || !delta.ProviderWatermark.Equal(now) || !delta.ShadowWatermark.Equal(now) {
		t.Fatalf("unstable final watermarks source=%s provider=%s shadow=%s want=%s", delta.SourceWatermark, delta.ProviderWatermark, delta.ShadowWatermark, now)
	}
	wrongEvidence := finalLease
	wrongEvidence.EvidenceDigest = bytes.Repeat([]byte{0x99}, 32)
	if _, _, _, err = builder.BuildFinalDelta(ctx, wrongEvidence); err == nil {
		t.Fatal("wrong final evidence digest was accepted")
	}
}
