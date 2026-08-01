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

func TestSourcePullLeaseAndFrozenApplicationBinding(t *testing.T) {
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
	if err = goose.DownToContext(ctx, db, ".", 57); err != nil {
		t.Fatalf("empty 00058 down: %v", err)
	}
	if err = goose.UpContext(ctx, db, "."); err != nil {
		t.Fatalf("00058 re-up: %v", err)
	}
	seedMigrationTenant(t, ctx, db)
	if _, err = db.ExecContext(ctx, `INSERT INTO billing_migration_credentials(id,project_id,provider,external_project_id,status,envelope_version,algorithm,key_id,nonce,ciphertext,fingerprint,created_by_actor_id,created_at) VALUES('credential_source','project_one','revenuecat','rc_project','active',1,'AES-256-GCM','credential_key',decode(repeat('01',12),'hex'),decode(repeat('02',32),'hex'),decode(repeat('03',32),'hex'),'owner_one',now())`); err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(ctx, `INSERT INTO billing_migration_programs(id,project_id,environment_id,source_adapter,source_adapter_version,credential_id,state,state_version,authority_epoch_before,stabilization_days,rollback_window_days,scope_digest,policy_digest,idempotency_key,request_digest,created_by_actor_id,created_at,updated_at) VALUES('program_source','project_one','environment_one','revenuecat',$1,'credential_source','mapping',1,0,7,7,decode(repeat('11',32),'hex'),decode(repeat('12',32),'hex'),'program-source',decode(repeat('13',32),'hex'),'owner_one',now(),now())`, billingmigration.AdapterVersion); err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(ctx, `INSERT INTO billing_migration_program_scopes(program_id,project_id,environment_id,application_id,platform,created_at) VALUES('program_source','project_one','environment_one','app_one','ios',now())`); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Truncate(time.Microsecond)
	initialCapability, err := billingmigration.SourcePullCapabilityAssessment("project_one", "program_source", 1, billingmigration.ProviderAPIV2, []string{billingmigration.SourceCapabilityReadCustomers}, bytesOf(0x49))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(ctx, `INSERT INTO billing_migration_capability_assessments(id,program_id,project_id,state_version,provider_api_version,capabilities,assessment_digest,assessed_at) VALUES($1,'program_source','project_one',1,'v2',ARRAY['read_customers'],$2,$3)`, initialCapability.AssessmentID, initialCapability.AssessmentDigest, now.Add(-time.Minute)); err != nil {
		t.Fatal(err)
	}
	for _, statement := range []string{
		`INSERT INTO applications(id,project_id,name,platform,identifier,created_at,updated_at) VALUES('app_two','project_one','App Two','ios','com.example.two',$1,$1)`,
		`INSERT INTO billing_migration_program_scopes(program_id,project_id,environment_id,application_id,platform,created_at) VALUES('program_source','project_one','environment_one','app_two','ios',$1)`,
		`INSERT INTO products(id,project_id,key,internal_name,description,type,status,metadata_source,readiness_ready,readiness_reasons,created_at,updated_at) VALUES('product_one','project_one','one','One','','subscription','draft','mock',false,'[]',$1,$1)`,
		`INSERT INTO products(id,project_id,key,internal_name,description,type,status,metadata_source,readiness_ready,readiness_reasons,created_at,updated_at) VALUES('product_two','project_one','two','Two','','subscription','draft','mock',false,'[]',$1,$1)`,
		`INSERT INTO billing_migration_mapping_sets(id,program_id,project_id,version,status,mapping_digest,expected_program_state_version,created_by_actor_id,created_at,frozen_at) VALUES('mapping_pull','program_source','project_one',1,'frozen',decode(repeat('51',32),'hex'),1,'owner_one',$1,$1)`,
		`INSERT INTO billing_migration_mapping_entries(id,mapping_set_id,program_id,project_id,source_kind,source_identifier,target_id,match_kind,application_id,platform,created_at) VALUES('map_pull_one','mapping_pull','program_source','project_one','product','rc_product','product_one','exact','app_one','ios',$1),('map_pull_two','mapping_pull','program_source','project_one','product','rc_product','product_one','exact','app_two','ios',$1)`,
		`INSERT INTO billing_migration_mapping_entries(id,mapping_set_id,program_id,project_id,source_kind,source_identifier,target_id,match_kind,application_id,platform,created_at) VALUES('map_pull_exact','mapping_pull','program_source','project_one','product','rc_product_exact','product_two','exact','app_one','ios',$1)`,
	} {
		if _, err = db.ExecContext(ctx, statement, now); err != nil {
			t.Fatal(err)
		}
	}
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	repository := billingmigrationpostgres.New(pool)
	service := billingmigration.NewSourcePullService(repository, func() time.Time { return now })
	seedCompletedSourcePullCheckpoint(t, ctx, db, "old", "old-cursor", "old-watermark", bytesOf(0x53), now.Add(-2*time.Minute))
	seedCompletedSourcePullCheckpoint(t, ctx, db, "latest", "opaque", "watermark", bytesOf(0x50), now.Add(-time.Minute))
	_, _, err = service.Queue(ctx, billingmigration.SourcePullCommand{Actor: billingmigration.Actor{ID: "owner_one"}, ProjectID: "project_one", ProgramID: "program_source", Intent: billingmigration.SourcePullDelta, StartingCursor: "caller-cursor", StartingWatermark: "watermark", StartingWatermarkDigest: bytesOf(0x50), IdempotencyKey: "arbitrary-position", ExpectedStateVersion: 1})
	if !errors.Is(err, billingmigration.ErrStaleCheckpoint) {
		t.Fatalf("arbitrary caller position err=%v", err)
	}
	_, _, err = service.Queue(ctx, billingmigration.SourcePullCommand{Actor: billingmigration.Actor{ID: "owner_one"}, ProjectID: "project_one", ProgramID: "program_source", Intent: billingmigration.SourcePullFinalDelta, StartingCursor: "old-cursor", StartingWatermark: "old-watermark", StartingWatermarkDigest: bytesOf(0x53), IdempotencyKey: "stale-final", ExpectedStateVersion: 1})
	if !errors.Is(err, billingmigration.ErrStaleCheckpoint) {
		t.Fatalf("non-head final delta err=%v", err)
	}
	job, replay, err := service.Queue(ctx, billingmigration.SourcePullCommand{Actor: billingmigration.Actor{ID: "owner_one"}, ProjectID: "project_one", ProgramID: "program_source", Intent: billingmigration.SourcePullFinalDelta, StartingCursor: "opaque", StartingWatermark: "watermark", StartingWatermarkDigest: bytesOf(0x50), IdempotencyKey: "final-one", ExpectedStateVersion: 1})
	if err != nil || replay || job.Status != "pending" {
		t.Fatalf("queue job=%#v replay=%v err=%v", job, replay, err)
	}
	if job.PredecessorPullJobID != "pull_latest" {
		t.Fatalf("predecessor=%q", job.PredecessorPullJobID)
	}
	lease, leased, err := repository.LeaseSourcePull(ctx, "worker_one", now, now.Add(time.Minute))
	if err != nil || !leased {
		t.Fatalf("lease=%v err=%v", leased, err)
	}
	if _, leased, err = repository.LeaseSourcePull(ctx, "worker_two", now, now.Add(time.Minute)); err != nil || leased {
		t.Fatalf("concurrent lease=%v err=%v", leased, err)
	}
	records, err := repository.BindSourcePullRecords(ctx, lease, []billingmigration.SourcePullRecord{{Kind: "subscription", SourceIdentifier: "sub", SourceRevision: "1", Digest: bytesOf(0x52), CurrentAccess: true, ObservedAt: now, ProductID: "rc_product", Store: "app_store", Environment: "production", Provider: "app_store", Platform: "ios", ReferenceKind: "app_store_transaction_id", ProviderReference: "transaction"}})
	if err != nil || len(records) != 1 || records[0].QuarantineReason != "ambiguous_application" || records[0].ProviderReference != nil {
		t.Fatalf("ambiguous binding records=%#v err=%v", records, err)
	}
	stale := lease
	stale.LeaseGeneration--
	err = repository.SettleSourcePull(ctx, billingmigration.SourcePullSettlement{Lease: stale, Status: "failed", ErrorCode: "test_failure", RetryAt: now.Add(time.Minute), SettledAt: now.Add(time.Second)})
	if !errors.Is(err, billingmigration.ErrLeaseLost) {
		t.Fatalf("stale settlement err=%v", err)
	}
	environmentRecords, err := repository.BindSourcePullRecords(ctx, lease, []billingmigration.SourcePullRecord{
		{Kind: "product", SourceIdentifier: "rc_product_exact", SourceRevision: "1", Digest: bytesOf(0x54), ObservedAt: now, ExternalAppID: "rc_app", Store: "app_store", Provider: "app_store", Platform: "ios", StoreIdentifier: "sku.exact"},
		{Kind: "subscription", SourceIdentifier: "sub_valid", SourceRevision: "1", Digest: bytesOf(0x55), CurrentAccess: true, ObservedAt: now, ProductID: "rc_product_exact", Store: "app_store", Environment: "production", Provider: "app_store", Platform: "ios", ReferenceKind: "app_store_transaction_id", ProviderReference: "transaction_valid"},
		{Kind: "subscription", SourceIdentifier: "sub_mismatch", SourceRevision: "1", Digest: bytesOf(0x56), CurrentAccess: true, ObservedAt: now, ProductID: "rc_product_exact", Store: "app_store", Environment: "sandbox", Provider: "app_store", Platform: "ios", ReferenceKind: "app_store_transaction_id", ProviderReference: "transaction_mismatch"},
		{Kind: "subscription", SourceIdentifier: "sub_unsupported", SourceRevision: "1", Digest: bytesOf(0x57), CurrentAccess: true, ObservedAt: now, ProductID: "rc_product_exact", Store: "app_store", Environment: "staging", Provider: "app_store", Platform: "ios", ReferenceKind: "app_store_transaction_id", ProviderReference: "transaction_unsupported"},
	})
	if err != nil {
		t.Fatal(err)
	}
	byID := make(map[string]billingmigration.NormalizedSourceRecord)
	for _, record := range environmentRecords {
		byID[record.SourceIdentifier] = record
	}
	if ref := byID["sub_valid"].ProviderReference; ref == nil || ref.ExpectedStoreEnvironment != "production" {
		t.Fatalf("valid environment binding=%#v", ref)
	}
	if byID["sub_mismatch"].QuarantineReason != "environment_mismatch" || byID["sub_unsupported"].QuarantineReason != "unsupported_environment" {
		t.Fatalf("environment quarantines mismatch=%q unsupported=%q", byID["sub_mismatch"].QuarantineReason, byID["sub_unsupported"].QuarantineReason)
	}
	reservation := billingmigration.ReserveSourceObject{SourceObject: billingmigration.SourceObject{SourceObjectScope: billingmigration.SourceObjectScope{ProjectID: "project_one", ProgramID: "program_source", ObjectID: "object_capability", AdapterVersion: billingmigration.AdapterVersion, SchemaVersion: "revenuecat-migration-source-v2"}, ReservationKey: "source-pull-capability", ReservationDigest: bytesOf(0x5a), ReservationGeneration: 1, WriteTokenDigest: bytesOf(0x5b), ObjectKey: billingmigration.DeterministicSourceObjectKey("project_one", "program_source", "object_capability"), SourceChannel: billingmigration.SourceChannelRevenueCat}, Now: now}
	object, replay, err := repository.ReserveSourceObject(ctx, reservation)
	if err != nil || replay {
		t.Fatalf("reserve capability object replay=%v err=%v", replay, err)
	}
	envelope := billingmigration.SourceObjectEnvelope{Version: 1, Algorithm: "AES-256-GCM-CHUNKED", KeyID: "source_key", Nonce: make([]byte, 12), ChunkSize: 16384, ChunkCount: 1, AADDigest: bytesOf(0x5c), PlaintextDigest: bytesOf(0x5d), PlaintextSize: 10, CiphertextDigest: bytesOf(0x5e), CiphertextSize: 128}
	if err = repository.VerifySourceObject(ctx, billingmigration.VerifySourceObject{ProjectID: "project_one", ProgramID: "program_source", ObjectID: object.ObjectID, ReservationGeneration: 1, WriteTokenDigest: bytesOf(0x5b), Envelope: envelope, Now: now}); err != nil {
		t.Fatal(err)
	}
	write := billingmigration.SourceObjectManifestWrite{
		ExpectedStateVersion: 1, SourceObjectID: object.ObjectID, SourcePullJobID: lease.ID, SourcePullOwner: lease.Owner, SourcePullGeneration: lease.LeaseGeneration, SourcePullEvidenceDigest: bytesOf(0x5f), SourcePullResumeCursor: "next-capability-cursor", SourcePullFinalWatermark: "capability-watermark", SourcePullProvenCapabilities: []string{billingmigration.SourceCapabilityReadCustomers, billingmigration.SourceCapabilityReadSubscriptions, billingmigration.SourceCapabilityReadAliases, billingmigration.SourceCapabilityIncrementalDelta}, Records: environmentRecords, BindingDigest: bytesOf(0x60), Now: now.Add(2 * time.Second),
	}
	write.Manifest = billingmigration.ManifestWrite{Manifest: billingmigration.SourceManifest{ManifestID: "manifest_capability", ProgramID: "program_source", StateVersion: 1, AdapterVersion: billingmigration.AdapterVersion, ProviderAPIVersion: billingmigration.ProviderAPIV2, SchemaVersion: "revenuecat-migration-source-v2", RecordCount: int64(len(environmentRecords)), CurrentAccessRecordCount: 3, CapturedAt: write.Now}, ProjectID: "project_one", ObjectKey: object.ObjectKey, ObjectChecksum: envelope.PlaintextDigest, ObjectSizeBytes: envelope.PlaintextSize, ManifestDigest: bytesOf(0x61), SourceWatermark: write.SourcePullFinalWatermark}
	write.ImportWork = &billingmigration.ImportBatchWrite{Batch: billingmigration.ImportBatch{BatchID: "batch_capability", ProgramID: "program_source", StateVersion: 1, IdempotencyKey: "source-pull:" + lease.ID, RecordCount: 1}, ProjectID: "project_one", ManifestID: "manifest_capability", MappingSetID: lease.MappingSetID, RequestDigest: bytesOf(0x62), CursorBefore: lease.StartingCursor, CreatedAt: write.Now}
	if err = repository.AppendVerifiedSource(ctx, write); err != nil {
		t.Fatalf("append verified source with capability assessment: %v", err)
	}
	var capabilityCount int
	var latestCapabilities []string
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM billing_migration_capability_assessments WHERE program_id='program_source'`).Scan(&capabilityCount); err != nil {
		t.Fatal(err)
	}
	if err = pool.QueryRow(ctx, `SELECT capabilities FROM billing_migration_capability_assessments WHERE program_id='program_source' ORDER BY assessed_at DESC,id DESC LIMIT 1`).Scan(&latestCapabilities); err != nil {
		t.Fatal(err)
	}
	if capabilityCount != 2 || strings.Join(latestCapabilities, ",") != "incremental_delta,read_aliases,read_customers,read_subscriptions" {
		t.Fatalf("capability promotion count=%d latest=%#v", capabilityCount, latestCapabilities)
	}
	replayCapability, err := billingmigration.SourcePullCapabilityAssessment("project_one", "program_source", 1, billingmigration.ProviderAPIV2, write.SourcePullProvenCapabilities, write.SourcePullEvidenceDigest)
	if err != nil {
		t.Fatal(err)
	}
	if _, appended, err := repository.AppendCapabilityAssessment(ctx, replayCapability); err != nil || appended {
		t.Fatalf("capability replay appended=%v err=%v", appended, err)
	}
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM billing_migration_capability_assessments WHERE program_id='program_source'`).Scan(&capabilityCount); err != nil || capabilityCount != 2 {
		t.Fatalf("capability replay count=%d err=%v", capabilityCount, err)
	}
}

func TestSourcePullRollbackGuardRetainsDurableEvidence(t *testing.T) {
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
	now := time.Now().UTC().Truncate(time.Microsecond)
	for _, statement := range []string{
		`INSERT INTO billing_migration_credentials(id,project_id,provider,external_project_id,status,envelope_version,algorithm,key_id,nonce,ciphertext,fingerprint,created_by_actor_id,created_at) VALUES('credential_source','project_one','revenuecat','rc_project','active',1,'AES-256-GCM','credential_key',decode(repeat('01',12),'hex'),decode(repeat('02',32),'hex'),decode(repeat('03',32),'hex'),'owner_one',$1)`,
		`INSERT INTO billing_migration_programs(id,project_id,environment_id,source_adapter,source_adapter_version,credential_id,state,state_version,authority_epoch_before,stabilization_days,rollback_window_days,scope_digest,policy_digest,idempotency_key,request_digest,created_by_actor_id,created_at,updated_at) VALUES('program_source','project_one','environment_one','revenuecat','` + billingmigration.AdapterVersion + `','credential_source','mapping',1,0,7,7,decode(repeat('11',32),'hex'),decode(repeat('12',32),'hex'),'program-source',decode(repeat('13',32),'hex'),'owner_one',$1,$1)`,
		`INSERT INTO billing_migration_mapping_sets(id,program_id,project_id,version,status,mapping_digest,expected_program_state_version,created_by_actor_id,created_at,frozen_at) VALUES('mapping_pull','program_source','project_one',1,'frozen',decode(repeat('51',32),'hex'),1,'owner_one',$1,$1)`,
	} {
		if _, err = db.ExecContext(ctx, statement, now); err != nil {
			t.Fatal(err)
		}
	}
	// A completed checkpoint is 00058 evidence and nothing later: it writes a
	// source-pull job but no import batch *record*. That distinction is what
	// makes 58 reachable at all — 00059 guards the record table too, so a
	// fixture that imports records can never roll back far enough to observe
	// 00058's own guard.
	seedCompletedSourcePullCheckpoint(t, ctx, db, "guard", "cursor", "watermark", bytesOf(0x53), now)
	if err = goose.DownToContext(ctx, db, ".", 58); err != nil {
		t.Fatalf("down to 58: %v", err)
	}
	err = goose.DownToContext(ctx, db, ".", 57)
	if err == nil || !strings.Contains(err.Error(), "durable source-pull evidence exists") {
		t.Fatalf("populated 00058 down err=%v", err)
	}
	version, versionErr := goose.GetDBVersionContext(ctx, db)
	if versionErr != nil || version != 58 {
		t.Fatalf("guard version=%d err=%v", version, versionErr)
	}
	var pullCount int
	if err = db.QueryRowContext(ctx, `SELECT count(*) FROM billing_migration_source_pull_jobs`).Scan(&pullCount); err != nil || pullCount == 0 {
		t.Fatalf("guard lost pulls count=%d err=%v", pullCount, err)
	}
}

func seedCompletedSourcePullCheckpoint(t *testing.T, ctx context.Context, db *sql.DB, suffix, cursor, watermark string, digest []byte, completedAt time.Time) {
	t.Helper()
	objectID, manifestID, batchID, pullID := "object_"+suffix, "manifest_"+suffix, "batch_"+suffix, "pull_"+suffix
	statements := []struct {
		query string
		args  []any
	}{
		{`INSERT INTO billing_migration_source_objects(id,program_id,project_id,reservation_key,reservation_digest,reservation_generation,write_token_digest,object_key,source_channel,adapter_version,schema_version,state,envelope_version,algorithm,key_id,nonce,chunk_size,chunk_count,aad_digest,plaintext_digest,plaintext_size_bytes,ciphertext_digest,ciphertext_size_bytes,reserved_at,verified_at) VALUES($1,'program_source','project_one',$2,$3,1,$3,$4,'revenuecat_api_v2',$5,'revenuecat-migration-source-v2','verified',1,'AES-256-GCM-CHUNKED','source_key',decode(repeat('01',12),'hex'),16384,1,$3,$3,1,$3,32,$6,$6)`, []any{objectID, "reservation_" + suffix, digest, "object/" + suffix, billingmigration.AdapterVersion, completedAt}},
		{`INSERT INTO billing_migration_source_manifests(id,program_id,project_id,state_version,adapter_version,provider_api_version,schema_version,record_count,current_access_record_count,object_key,object_checksum,object_size_bytes,object_encryption,manifest_digest,source_watermark,captured_at) VALUES($1,'program_source','project_one',1,$2,'v2','revenuecat-migration-source-v2',0,0,$3,$4,1,'AES-256-GCM',$4,$5,$6)`, []any{manifestID, billingmigration.AdapterVersion, "object/" + suffix, digest, watermark, completedAt}},
		{`INSERT INTO billing_migration_import_batches(id,program_id,project_id,manifest_id,mapping_set_id,idempotency_key,request_digest,expected_program_state_version,status,record_count,validated_count,quarantined_count,cursor_before,cursor_after,attempt_count,lease_generation,created_at,updated_at,due_at,max_attempts) VALUES($1,'program_source','project_one',$2,'mapping_pull',$3,$4,1,'completed',0,0,0,'',$5,0,0,$6,$6,$6,8)`, []any{batchID, manifestID, "batch-" + suffix, digest, cursor, completedAt}},
		{`INSERT INTO billing_migration_source_pull_jobs(id,program_id,project_id,intent,idempotency_key,request_digest,expected_program_state_version,starting_cursor,starting_watermark,starting_watermark_digest,predecessor_pull_job_id,mapping_set_id,status,result_source_object_id,result_manifest_id,result_import_batch_id,resume_cursor,final_watermark,evidence_digest,record_count,current_access_count,import_record_count,due_at,lease_generation,attempt_count,max_attempts,created_by_actor_id,started_at,completed_at,created_at,updated_at) VALUES($1,'program_source','project_one','snapshot',$2,$3,1,'','',NULL,NULL,'mapping_pull','completed',$4,$5,$6,$7,$8,$3,0,0,0,$9,1,1,8,'owner_one',$9,$9,$9,$9)`, []any{pullID, "pull-" + suffix, digest, objectID, manifestID, batchID, cursor, watermark, completedAt}},
	}
	for _, statement := range statements {
		if _, err := db.ExecContext(ctx, statement.query, statement.args...); err != nil {
			t.Fatal(err)
		}
	}
}
