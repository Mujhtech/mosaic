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
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingmigration"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingmigrationpostgres"
	"github.com/Mujhtech/mosaic/apps/api/migrations"
)

func TestSourceExecutionMigrationAndRepositoryInvariants(t *testing.T) {
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
	// Empty down/up proves reversibility before Package A evidence exists.
	if err = goose.DownToContext(ctx, db, ".", 54); err != nil {
		t.Fatalf("empty 00055 down: %v", err)
	}
	if err = goose.UpContext(ctx, db, "."); err != nil {
		t.Fatalf("00055 re-up: %v", err)
	}
	seedMigrationTenant(t, ctx, db)
	seedSourceExecutionProgram(t, ctx, db)
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	repository := billingmigrationpostgres.New(pool)
	now := time.Now().UTC().Truncate(time.Microsecond)
	reservation := billingmigration.ReserveSourceObject{SourceObject: billingmigration.SourceObject{SourceObjectScope: billingmigration.SourceObjectScope{ProjectID: "project_one", ProgramID: "program_source", ObjectID: "object_one", AdapterVersion: billingmigration.AdapterVersion, SchemaVersion: "v1"}, ReservationKey: "source-pull-one", ReservationDigest: bytesOf(0x21), ReservationGeneration: 1, WriteTokenDigest: bytesOf(0x20), ObjectKey: billingmigration.DeterministicSourceObjectKey("project_one", "program_source", "object_one"), SourceChannel: billingmigration.SourceChannelRevenueCat}, Now: now}
	object, replay, err := repository.ReserveSourceObject(ctx, reservation)
	if err != nil || replay {
		t.Fatalf("reserve replay=%v err=%v", replay, err)
	}
	loser := reservation
	loser.WriteTokenDigest = bytesOf(0x29)
	reservedAgain, replay, err := repository.ReserveSourceObject(ctx, loser)
	if err != nil || !replay {
		t.Fatalf("idempotent reserve replay=%v err=%v", replay, err)
	}
	if string(reservedAgain.WriteTokenDigest) != string(bytesOf(0x20)) {
		t.Fatal("losing reservation overwrote winning write identity")
	}
	envelope := billingmigration.SourceObjectEnvelope{Version: 1, Algorithm: "AES-256-GCM-CHUNKED", KeyID: "source_key", Nonce: make([]byte, 12), ChunkSize: 16384, ChunkCount: 1, AADDigest: bytesOf(0x22), PlaintextDigest: bytesOf(0x23), PlaintextSize: 7, CiphertextDigest: bytesOf(0x24), CiphertextSize: 128}
	if err = repository.VerifySourceObject(ctx, billingmigration.VerifySourceObject{ProjectID: "project_one", ProgramID: "program_source", ObjectID: object.ObjectID, ReservationGeneration: 1, WriteTokenDigest: bytesOf(0x29), Envelope: envelope, Now: now}); !errors.Is(err, billingmigration.ErrConflict) {
		t.Fatalf("losing writer verified reservation err=%v", err)
	}
	if err = repository.VerifySourceObject(ctx, billingmigration.VerifySourceObject{ProjectID: "project_one", ProgramID: "program_source", ObjectID: object.ObjectID, ReservationGeneration: 1, WriteTokenDigest: bytesOf(0x20), Envelope: envelope, Now: now}); err != nil {
		t.Fatal(err)
	}
	manifest := billingmigration.ManifestWrite{Manifest: billingmigration.SourceManifest{ProgramID: "program_source", StateVersion: 1, ManifestID: "manifest_one", AdapterVersion: billingmigration.AdapterVersion, ProviderAPIVersion: "v2", SchemaVersion: "v1", CapturedAt: now}, ProjectID: "project_one", ObjectKey: object.ObjectKey, ObjectChecksum: bytesOf(0xff), ObjectSizeBytes: 7, ManifestDigest: bytesOf(0x25), SourceWatermark: "opaque"}
	write := billingmigration.SourceObjectManifestWrite{ExpectedStateVersion: 1, SourceObjectID: "object_one", Manifest: manifest, BindingDigest: bytesOf(0x26), Now: now}
	if err = repository.AppendVerifiedSource(ctx, write); !errors.Is(err, billingmigration.ErrStaleDigest) {
		t.Fatalf("checksum mismatch error = %v", err)
	}
	var manifestCount int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM billing_migration_source_manifests WHERE id='manifest_one'`).Scan(&manifestCount); err != nil || manifestCount != 0 {
		t.Fatalf("manifest appended before checksum verification count=%d err=%v", manifestCount, err)
	}
	write.Manifest.ObjectChecksum = envelope.PlaintextDigest
	if err = repository.AppendVerifiedSource(ctx, write); err != nil {
		t.Fatalf("append verified source: %v", err)
	}

	// One active lease wins. A stale owner/generation cannot settle it.
	// Package D requires every delta/final-delta pull to bind its exact
	// predecessor. Seed a completed zero-record snapshot before the legacy
	// compound fixture below using the same frozen mapping.
	for _, statement := range []string{
		`INSERT INTO billing_migration_mapping_sets(id,program_id,project_id,version,status,mapping_digest,expected_program_state_version,created_by_actor_id,created_at,frozen_at) VALUES('mapping_one','program_source','project_one',1,'frozen',decode(repeat('31',32),'hex'),1,'owner_one',$1,$1)`,
		`INSERT INTO billing_migration_import_batches(id,program_id,project_id,manifest_id,mapping_set_id,idempotency_key,request_digest,expected_program_state_version,status,record_count,validated_count,quarantined_count,cursor_before,cursor_after,attempt_count,lease_generation,created_at,updated_at,due_at,max_attempts) VALUES('batch_predecessor','program_source','project_one','manifest_one','mapping_one','batch-predecessor',decode(repeat('38',32),'hex'),1,'completed',0,0,0,'','cursor',0,0,$1,$1,$1,3)`,
		`INSERT INTO billing_migration_source_pull_jobs(id,program_id,project_id,intent,idempotency_key,request_digest,expected_program_state_version,starting_cursor,starting_watermark,starting_watermark_digest,predecessor_pull_job_id,mapping_set_id,status,result_source_object_id,result_manifest_id,result_import_batch_id,resume_cursor,final_watermark,evidence_digest,record_count,current_access_count,import_record_count,due_at,lease_generation,attempt_count,max_attempts,created_by_actor_id,started_at,completed_at,created_at,updated_at) VALUES('pull_predecessor','program_source','project_one','snapshot','pull-predecessor',decode(repeat('38',32),'hex'),1,'','',NULL,NULL,'mapping_one','completed','object_one','manifest_one','batch_predecessor','cursor','watermark',decode(repeat('38',32),'hex'),0,0,0,$1,1,1,3,'owner_one',$1,$1,$1,$1)`,
	} {
		if _, err = pool.Exec(ctx, statement, now); err != nil {
			t.Fatal(err)
		}
	}
	for _, statement := range []string{
		`INSERT INTO billing_migration_source_records(id,program_id,project_id,manifest_id,source_kind,source_identifier,source_revision,source_cursor,record_digest,current_access,normalization_schema_version,evidence_kind,observed_at,created_at) VALUES('record_import','program_source','project_one','manifest_one','transaction','known_store_ref','1','opaque',decode(repeat('35',32),'hex'),true,'v1','trusted_provider_api',$1,$1)`,
		`INSERT INTO billing_migration_import_batches(id,program_id,project_id,manifest_id,mapping_set_id,idempotency_key,request_digest,expected_program_state_version,status,record_count,cursor_before,cursor_after,attempt_count,lease_generation,created_at,updated_at,due_at,max_attempts) VALUES('batch_one','program_source','project_one','manifest_one','mapping_one','batch-one',decode(repeat('32',32),'hex'),1,'pending',1,'','',0,0,$1,$1,$1,3)`,
		`INSERT INTO billing_migration_import_batch_records(import_batch_id,program_id,project_id,source_record_id,ordinal,provider,environment_id,application_id,provider_reference,reference_kind,expected_store_environment) VALUES('batch_one','program_source','project_one','record_import',0,'app_store','environment_one','app_one','known_store_ref','app_store_transaction_id','production') RETURNING $1`,
		`INSERT INTO billing_migration_source_pull_jobs(id,program_id,project_id,intent,idempotency_key,request_digest,expected_program_state_version,starting_cursor,starting_watermark,starting_watermark_digest,predecessor_pull_job_id,mapping_set_id,status,result_source_object_id,result_manifest_id,result_import_batch_id,resume_cursor,final_watermark,evidence_digest,record_count,current_access_count,import_record_count,due_at,lease_generation,attempt_count,max_attempts,created_by_actor_id,started_at,completed_at,created_at,updated_at) VALUES('pull_auto','program_source','project_one','final_delta','pull-auto',decode(repeat('36',32),'hex'),1,'cursor','watermark',decode(repeat('38',32),'hex'),'pull_predecessor','mapping_one','completed','object_one','manifest_one','batch_one','','final',decode(repeat('37',32),'hex'),1,1,1,$1,1,1,3,'owner_one',$1,$1,$1,$1)`,
	} {
		if _, err = pool.Exec(ctx, statement, now); err != nil {
			t.Fatal(err)
		}
	}
	// The plaintext import queue admits only official non-secret join handles.
	// Both typed variants work, while neither a generic handle nor a bearer-grade
	// Google purchase token can be represented even through direct SQL.
	if _, err = pool.Exec(ctx, `INSERT INTO billing_migration_source_records(id,program_id,project_id,manifest_id,source_kind,source_identifier,source_revision,source_cursor,record_digest,current_access,normalization_schema_version,evidence_kind,observed_at,created_at) VALUES
			('record_google_order','program_source','project_one','manifest_one','transaction','google_order','1','opaque',decode(repeat('81',32),'hex'),true,'v1','trusted_provider_api',$1,$1),
			('record_generic_ref','program_source','project_one','manifest_one','transaction','generic_ref','1','opaque',decode(repeat('82',32),'hex'),true,'v1','trusted_provider_api',$1,$1),
			('record_purchase_token','program_source','project_one','manifest_one','transaction','purchase_token','1','opaque',decode(repeat('83',32),'hex'),true,'v1','trusted_provider_api',$1,$1)`, now); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO billing_migration_import_batches(id,program_id,project_id,manifest_id,mapping_set_id,idempotency_key,request_digest,expected_program_state_version,status,record_count,validated_count,cursor_before,cursor_after,attempt_count,lease_generation,created_at,updated_at,due_at,max_attempts) VALUES
			('batch_google_order','program_source','project_one','manifest_one','mapping_one','batch-google-order',decode(repeat('84',32),'hex'),1,'completed',1,1,'','',0,0,$1,$1,$1,3),
			('batch_generic_ref','program_source','project_one','manifest_one','mapping_one','batch-generic-ref',decode(repeat('85',32),'hex'),1,'completed',1,1,'','',0,0,$1,$1,$1,3),
			('batch_purchase_token','program_source','project_one','manifest_one','mapping_one','batch-purchase-token',decode(repeat('86',32),'hex'),1,'completed',1,1,'','',0,0,$1,$1,$1,3)`, now); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO billing_migration_import_batch_records(import_batch_id,program_id,project_id,source_record_id,ordinal,provider,environment_id,application_id,provider_reference,reference_kind,expected_store_environment) VALUES('batch_google_order','program_source','project_one','record_google_order',0,'google_play','environment_one','app_one','GPA.1234-5678','google_play_order_id','production')`); err != nil {
		t.Fatalf("official Google order reference was rejected: %v", err)
	}
	for _, unsafe := range []struct{ batch, record, kind string }{
		{"batch_generic_ref", "record_generic_ref", "provider_reference"},
		{"batch_purchase_token", "record_purchase_token", "google_play_purchase_token"},
	} {
		_, insertErr := pool.Exec(ctx, `INSERT INTO billing_migration_import_batch_records(import_batch_id,program_id,project_id,source_record_id,ordinal,provider,environment_id,application_id,provider_reference,reference_kind,expected_store_environment) VALUES($1,'program_source','project_one',$2,0,'google_play','environment_one','app_one','plaintext-secret',$3,'production')`, unsafe.batch, unsafe.record, unsafe.kind)
		var pgErr *pgconn.PgError
		if !errors.As(insertErr, &pgErr) || pgErr.Code != "23514" {
			t.Fatalf("unsafe reference kind %q schema error=%v", unsafe.kind, insertErr)
		}
	}
	lease, leased, err := repository.LeaseImport(ctx, "worker_one", now, now.Add(time.Minute))
	if err != nil || !leased {
		t.Fatalf("lease=%v err=%v", leased, err)
	}
	if _, leased, err = repository.LeaseImport(ctx, "worker_two", now, now.Add(time.Minute)); err != nil || leased {
		t.Fatalf("concurrent lease=%v err=%v", leased, err)
	}
	stale := billingmigration.ExecutionSettlement{ExecutionLease: lease, Status: "completed", ResultDigest: bytesOf(0x33), SettledAt: now.Add(time.Second)}
	stale.Generation--
	if err = repository.SettleImport(ctx, stale); !errors.Is(err, billingmigration.ErrLeaseLost) {
		t.Fatalf("stale settlement error=%v", err)
	}
	partial := billingmigration.ExecutionSettlement{ExecutionLease: lease, Status: "completed", ResultDigest: bytesOf(0x33), SettledAt: now.Add(time.Second)}
	if err = repository.SettleImport(ctx, partial); !errors.Is(err, billingmigration.ErrInvalid) {
		t.Fatalf("partial import coverage error=%v", err)
	}
	arbitrary := billingmigration.ExecutionSettlement{ExecutionLease: lease, Status: "completed", ValidatedCount: 1, ResultDigest: bytesOf(0x33), SettledAt: now.Add(time.Second)}
	arbitrary.References = append([]billingmigration.KnownProviderReference(nil), lease.References...)
	arbitrary.References[0].Reference = "caller_substitute"
	if err = repository.SettleImport(ctx, arbitrary); !errors.Is(err, billingmigration.ErrInvalid) {
		t.Fatalf("arbitrary import reference error=%v", err)
	}
	valid := billingmigration.ExecutionSettlement{ExecutionLease: lease, Status: "completed", ValidatedCount: 1, ResultDigest: bytesOf(0x34), SettledAt: now.Add(time.Second)}
	if err = repository.SettleImport(ctx, valid); err != nil {
		t.Fatalf("settle valid lease: %v", err)
	}
	var autoDeltaCount int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM billing_migration_final_delta_jobs WHERE id='mfd_pull_pull_auto' AND evidence_digest=decode(repeat('34',32),'hex') AND status='pending'`).Scan(&autoDeltaCount); err != nil || autoDeltaCount != 1 {
		t.Fatalf("final-delta pull did not auto-enqueue evaluation count=%d err=%v", autoDeltaCount, err)
	}

	// Final delta settlement rechecks current digests and exact cohort×scope
	// prepared coverage without touching the live current-pointer table.
	for _, statement := range []string{
		`UPDATE billing_migration_programs SET state='shadowing',state_version=2,updated_at=$1 WHERE id='program_source'`,
		`INSERT INTO customer_entitlement_snapshots(id,project_id,environment_id,billing_customer_id,snapshot_version,rule_version,computed_at,as_of,checksum,change_reason,created_at) VALUES('snapshot_prepared','project_one','environment_one','customer_one',1,1,$1,$1,decode(repeat('41',32),'hex'),'migration_prepared',$1)`,
		`INSERT INTO billing_migration_final_delta_jobs(id,program_id,project_id,idempotency_key,request_digest,expected_program_state_version,manifest_digest,mapping_digest,evidence_digest,status,due_at,lease_generation,attempt_count,max_attempts,created_at,updated_at) VALUES('delta_job_one','program_source','project_one','delta-job-one',decode(repeat('42',32),'hex'),2,decode(repeat('25',32),'hex'),decode(repeat('31',32),'hex'),decode(repeat('43',32),'hex'),'pending',$1,0,0,3,$1,$1)`,
	} {
		if _, err = pool.Exec(ctx, statement, now); err != nil {
			t.Fatal(err)
		}
	}
	deltaLease, leased, err := repository.LeaseFinalDelta(ctx, "worker_delta", now, now.Add(time.Minute))
	if err != nil || !leased {
		t.Fatalf("final delta lease=%v err=%v", leased, err)
	}
	delta := &billingmigration.FinalDeltaResult{ID: "delta_one", StateVersion: 2, ManifestDigest: bytesOf(0x99), MappingDigest: bytesOf(0x31), EvidenceDigest: bytesOf(0x43), FinalWatermarkDigest: bytesOf(0x44), DeltaDigest: bytesOf(0x45), CohortDigest: bytesOf(0x46), SourceWatermark: now, ProviderWatermark: now, ShadowWatermark: now, Cohort: []billingmigration.CohortCustomer{{BillingCustomerID: "customer_one", CustomerDigest: bytesOf(0x47)}}}
	deltaSettlement := billingmigration.ExecutionSettlement{ExecutionLease: deltaLease, Status: "completed", ResultDigest: bytesOf(0x45), FinalDelta: delta, SettledAt: now.Add(2 * time.Second)}
	if err = repository.SettleFinalDelta(ctx, deltaSettlement); !errors.Is(err, billingmigration.ErrStaleDigest) {
		t.Fatalf("final delta digest drift error=%v", err)
	}
	delta.ManifestDigest = bytesOf(0x25)
	if err = repository.SettleFinalDelta(ctx, deltaSettlement); !errors.Is(err, billingmigration.ErrPointerCoverage) {
		t.Fatalf("final delta incomplete coverage error=%v", err)
	}
	deltaSettlement.PreparedPointers = []billingmigration.PreparedPointer{{EnvironmentID: "environment_one", ApplicationID: "app_one", Platform: "ios", BillingCustomerID: "customer_one", SnapshotID: "snapshot_prepared", PreparedDigest: bytesOf(0x41)}}
	if err = repository.SettleFinalDelta(ctx, deltaSettlement); err != nil {
		t.Fatalf("settle exact final delta cohort×scope: %v", err)
	}
	var livePointers int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM billing_migration_scope_current_pointers WHERE project_id='project_one'`).Scan(&livePointers); err != nil || livePointers != 0 {
		t.Fatalf("final delta mutated live pointers count=%d err=%v", livePointers, err)
	}

	// Populated Down refuses before removing any Package A structure.
	err = goose.DownToContext(ctx, db, ".", 54)
	if err == nil || !strings.Contains(err.Error(), "immutable migration validation evidence exists") {
		t.Fatalf("populated down guard error=%v", err)
	}
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM billing_migration_source_objects`).Scan(&manifestCount); err != nil || manifestCount != 1 {
		t.Fatalf("guard caused partial loss count=%d err=%v", manifestCount, err)
	}
}

func seedSourceExecutionProgram(t *testing.T, ctx context.Context, db *sql.DB) {
	t.Helper()
	if _, err := db.ExecContext(ctx, `INSERT INTO billing_migration_credentials(id,project_id,provider,external_project_id,status,envelope_version,algorithm,key_id,nonce,ciphertext,fingerprint,created_by_actor_id,created_at) VALUES('credential_source','project_one','revenuecat','rc_project','active',1,'AES-256-GCM','credential_key',decode(repeat('01',12),'hex'),decode(repeat('02',32),'hex'),decode(repeat('03',32),'hex'),'owner_one',now())`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO billing_migration_programs(id,project_id,environment_id,source_adapter,source_adapter_version,credential_id,state,state_version,authority_epoch_before,stabilization_days,rollback_window_days,scope_digest,policy_digest,idempotency_key,request_digest,created_by_actor_id,created_at,updated_at) VALUES('program_source','project_one','environment_one','revenuecat',$1,'credential_source','mapping',1,0,7,7,decode(repeat('11',32),'hex'),decode(repeat('12',32),'hex'),'program-source',decode(repeat('13',32),'hex'),'owner_one',now(),now())`, billingmigration.AdapterVersion); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO billing_migration_program_scopes(program_id,project_id,environment_id,application_id,platform,created_at) VALUES('program_source','project_one','environment_one','app_one','ios',now())`); err != nil {
		t.Fatal(err)
	}
}
