package billingmigrationpostgres_test

import (
	"context"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
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
	"github.com/Mujhtech/mosaic/apps/api/internal/providercredential"
	"github.com/Mujhtech/mosaic/apps/api/migrations"
)

type assessor struct{}

func (assessor) AssessMigration(context.Context, string, []byte) (billingmigration.CapabilityResult, error) {
	return billingmigration.CapabilityResult{ProviderAPIVersion: "v2", Capabilities: []string{"read_customers"}, AssessedAt: time.Now().UTC()}, nil
}

func TestMigration53DownRefusesCryptographicallyRemovedCredential(t *testing.T) {
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
		t.Fatal(err)
	}
	seedMigrationTenant(t, ctx, db)
	if _, err := db.ExecContext(ctx, `INSERT INTO billing_migration_credentials(id,project_id,provider,external_project_id,status,envelope_version,algorithm,key_id,nonce,ciphertext,fingerprint,created_by_actor_id,created_at,removed_at,removed_by_actor_id,removal_digest) VALUES('credential_removed_guard','project_one','revenuecat','removed','active',1,'AES-256-GCM','retired',NULL,NULL,decode(repeat('a1',32),'hex'),'owner_one',now(),now(),'owner_one',decode(repeat('a2',32),'hex'))`); err != nil {
		t.Fatal(err)
	}
	err = goose.DownToContext(ctx, db, ".", 52)
	if err == nil || !strings.Contains(err.Error(), "cannot rollback migration 00053: cryptographically removed billing migration credentials cannot restore ciphertext") {
		t.Fatalf("rollback guard error = %v", err)
	}
	version, versionErr := goose.GetDBVersionContext(ctx, db)
	if versionErr != nil || version != 53 {
		t.Fatalf("guard left migration version=%d err=%v", version, versionErr)
	}
}

func TestProgramTransactionEnforcesTenantScopeAndEncryptedCredential(t *testing.T) {
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
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	key := base64.RawURLEncoding.EncodeToString(make([]byte, 32))
	cipher, err := providercredential.NewAESGCMCipher(
		fmt.Sprintf(`{"version":1,"activeKeyId":"key_one","keys":{"key_one":"%s"}}`, key), zeroReader{})
	if err != nil {
		t.Fatal(err)
	}
	repository := billingmigrationpostgres.New(pool)
	service := billingmigration.NewService(repository, cipher, assessor{})
	created, replayed, err := service.CreateProgram(ctx, billingmigration.Actor{ID: "owner_one"}, billingmigration.CreateProgramInput{
		ProjectID: "project_one", EnvironmentID: "environment_one", ExternalProjectID: "rc_project",
		Credential: []byte("migration-secret"), IdempotencyKey: "program-create-1",
		Applications: []billingmigration.ScopeItem{{ApplicationID: "app_one", Platform: "ios"}},
	})
	if err != nil || replayed {
		t.Fatalf("create program: replayed=%v err=%v", replayed, err)
	}
	if created.Program.StateVersion != 1 || len(created.Program.Scope.Applications) != 1 {
		t.Fatalf("program = %#v", created.Program)
	}
	if created.Program.State != billingmigration.StateMapping {
		t.Fatalf("new program state = %q", created.Program.State)
	}
	if _, _, err := service.CreateProgram(ctx, billingmigration.Actor{ID: "owner_one"}, billingmigration.CreateProgramInput{ProjectID: "project_one", EnvironmentID: "environment_one", ExternalProjectID: "rc_overlap", Credential: []byte("overlap-secret"), IdempotencyKey: "program-overlap", Applications: []billingmigration.ScopeItem{{ApplicationID: "app_one", Platform: "ios"}}}); !errors.Is(err, billingmigration.ErrConflict) {
		t.Fatalf("overlapping active migration scope error = %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO applications(id,project_id,name,platform,identifier,created_at,updated_at) VALUES('app_unowned','project_one','Unowned Android','android','com.example.unowned',now(),now()); INSERT INTO billing_migration_authority_scopes(id,project_id,environment_id,application_id,platform,current_authority,current_epoch,active_program_id,authority_digest,updated_at) VALUES('authority_unowned','project_one','environment_one','app_unowned','android','source',0,NULL,decode(repeat('44',32),'hex'),now())`); err != nil {
		t.Fatalf("seed unowned authority scope: %v", err)
	}
	claimed, _, err := service.CreateProgram(ctx, billingmigration.Actor{ID: "owner_one"}, billingmigration.CreateProgramInput{ProjectID: "project_one", EnvironmentID: "environment_one", ExternalProjectID: "rc_unowned", Credential: []byte("unowned-secret"), IdempotencyKey: "program-unowned", Applications: []billingmigration.ScopeItem{{ApplicationID: "app_unowned", Platform: "android"}}})
	if err != nil {
		t.Fatalf("claim unowned authority scope: %v", err)
	}
	var claimedProgramID *string
	if err := pool.QueryRow(ctx, `SELECT active_program_id FROM billing_migration_authority_scopes WHERE id='authority_unowned'`).Scan(&claimedProgramID); err != nil || claimedProgramID == nil || *claimedProgramID != claimed.Program.ProgramID {
		t.Fatalf("unowned authority claimant=%v err=%v", claimedProgramID, err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO applications(id,project_id,name,platform,identifier,created_at,updated_at) VALUES('app_epoch_ios','project_one','Epoch iOS','ios','com.example.epoch.ios',now(),now()),('app_epoch_android','project_one','Epoch Android','android','com.example.epoch.android',now(),now()),('app_mixed_ios','project_one','Mixed iOS','ios','com.example.mixed.ios',now(),now()),('app_mixed_android','project_one','Mixed Android','android','com.example.mixed.android',now(),now()),('app_nonsource','project_one','Non-source','ios','com.example.nonsource',now(),now()); INSERT INTO billing_migration_authority_scopes(id,project_id,environment_id,application_id,platform,current_authority,current_epoch,active_program_id,authority_digest,updated_at) VALUES('authority_epoch_ios','project_one','environment_one','app_epoch_ios','ios','source',5,NULL,decode(repeat('51',32),'hex'),now()),('authority_epoch_android','project_one','environment_one','app_epoch_android','android','source',5,NULL,decode(repeat('52',32),'hex'),now()),('authority_mixed_ios','project_one','environment_one','app_mixed_ios','ios','source',2,NULL,decode(repeat('53',32),'hex'),now()),('authority_mixed_android','project_one','environment_one','app_mixed_android','android','source',3,NULL,decode(repeat('54',32),'hex'),now()),('authority_nonsource','project_one','environment_one','app_nonsource','ios','mosaic',4,NULL,decode(repeat('55',32),'hex'),now())`); err != nil {
		t.Fatalf("seed reusable authority scopes: %v", err)
	}
	epochProgram, _, err := service.CreateProgram(ctx, billingmigration.Actor{ID: "owner_one"}, billingmigration.CreateProgramInput{ProjectID: "project_one", EnvironmentID: "environment_one", ExternalProjectID: "rc_epoch", Credential: []byte("epoch-secret"), IdempotencyKey: "program-epoch", Applications: []billingmigration.ScopeItem{{ApplicationID: "app_epoch_ios", Platform: "ios"}, {ApplicationID: "app_epoch_android", Platform: "android"}}})
	if err != nil || epochProgram.Program.AuthorityEpochBefore != 5 {
		t.Fatalf("reuse source epoch program=%#v err=%v", epochProgram.Program, err)
	}
	if _, _, err := service.CreateProgram(ctx, billingmigration.Actor{ID: "owner_one"}, billingmigration.CreateProgramInput{ProjectID: "project_one", EnvironmentID: "environment_one", ExternalProjectID: "rc_mixed", Credential: []byte("mixed-secret"), IdempotencyKey: "program-mixed", Applications: []billingmigration.ScopeItem{{ApplicationID: "app_mixed_ios", Platform: "ios"}, {ApplicationID: "app_mixed_android", Platform: "android"}}}); !errors.Is(err, billingmigration.ErrConflict) {
		t.Fatalf("mixed authority epochs error=%v", err)
	}
	if _, _, err := service.CreateProgram(ctx, billingmigration.Actor{ID: "owner_one"}, billingmigration.CreateProgramInput{ProjectID: "project_one", EnvironmentID: "environment_one", ExternalProjectID: "rc_nonsource", Credential: []byte("nonsource-secret"), IdempotencyKey: "program-nonsource", Applications: []billingmigration.ScopeItem{{ApplicationID: "app_nonsource", Platform: "ios"}}}); !errors.Is(err, billingmigration.ErrConflict) {
		t.Fatalf("non-source authority error=%v", err)
	}
	var authorityKind string
	var authorityEpoch int64
	if err := pool.QueryRow(ctx, `SELECT current_authority,current_epoch FROM billing_migration_authority_scopes WHERE project_id='project_one' AND environment_id='environment_one' AND application_id='app_one' AND platform='ios'`).Scan(&authorityKind, &authorityEpoch); err != nil {
		t.Fatalf("read initialized authority scope: %v", err)
	}
	if authorityKind != "source" || authorityEpoch != created.Program.AuthorityEpochBefore {
		t.Fatalf("initialized authority = %s/%d", authorityKind, authorityEpoch)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO billing_migration_v2_sync_observations(id,program_id,project_id,application_id,platform,app_version,sdk_version,supported_contract_versions,authority_capabilities,traffic_count,authority_epoch,sync_result,observation_digest,observed_at)
		VALUES('sync_valid',$1,'project_one','app_one','ios','2.0.0','2.0.0',ARRAY['2','3'],ARRAY['authority_epoch','authority_scope','urgent_authority_sync','mosaic_authoritative_targeting'],1,$2,'accepted',decode(repeat('41',32),'hex'),now())`, created.Program.ProgramID, authorityEpoch); err != nil {
		t.Fatalf("insert valid v2 sync observation: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO billing_migration_v2_sync_observations(id,program_id,project_id,application_id,platform,app_version,sdk_version,supported_contract_versions,authority_capabilities,traffic_count,authority_epoch,sync_result,observation_digest,observed_at)
		VALUES('sync_duplicate',$1,'project_one','app_one','ios','2.0.0','2.0.0',ARRAY['2','2'],ARRAY['authority_epoch'],1,$2,'accepted',decode(repeat('42',32),'hex'),now())`, created.Program.ProgramID, authorityEpoch); err == nil {
		t.Fatal("v2 sync observation accepted duplicate contract versions")
	}
	if _, err := pool.Exec(ctx, `INSERT INTO billing_migration_v2_sync_observations(id,program_id,project_id,application_id,platform,app_version,sdk_version,supported_contract_versions,authority_capabilities,traffic_count,authority_epoch,sync_result,observation_digest,observed_at)
		VALUES('sync_unknown_capability',$1,'project_one','app_one','ios','2.0.0','2.0.0',ARRAY['2'],ARRAY['urgent_sync'],1,$2,'accepted',decode(repeat('43',32),'hex'),now())`, created.Program.ProgramID, authorityEpoch); err == nil {
		t.Fatal("v2 sync observation accepted a non-contract authority capability")
	}

	programs, err := service.ListPrograms(ctx, billingmigration.Actor{ID: "member_one"}, "project_one", 10)
	if err != nil || len(programs) != 3 {
		t.Fatalf("member list: programs=%d err=%v", len(programs), err)
	}
	if _, _, err := service.CreateProgram(ctx, billingmigration.Actor{ID: "member_one"}, billingmigration.CreateProgramInput{
		ProjectID: "project_one", EnvironmentID: "environment_one", ExternalProjectID: "rc_project",
		Credential: []byte("other-secret"), IdempotencyKey: "member-create",
		Applications: []billingmigration.ScopeItem{{ApplicationID: "app_one", Platform: "ios"}},
	}); err != billingmigration.ErrForbidden {
		t.Fatalf("member create error = %v", err)
	}
	if _, err := service.AssessCurrentReadiness(ctx, billingmigration.Actor{ID: "member_one"}, "project_one", created.Program.ProgramID, 1); err != billingmigration.ErrForbidden {
		t.Fatalf("member readiness assessment error = %v", err)
	}
	if _, err := repository.Authorize(ctx, billingmigration.Actor{ID: "admin_one"}, "project_one", billingmigration.CapabilityManageSource); err != billingmigration.ErrForbidden {
		t.Fatalf("admin manage-source error = %v", err)
	}
	if _, err := repository.Authorize(ctx, billingmigration.Actor{ID: "admin_one"}, "project_one", billingmigration.CapabilityManageMappings); err != nil {
		t.Fatalf("admin manage-mappings error = %v", err)
	}
	if _, err := repository.Authorize(ctx, billingmigration.Actor{ID: "admin_one"}, "project_one", billingmigration.CapabilityRunImport); err != nil {
		t.Fatalf("admin run-import error = %v", err)
	}
	if _, err := repository.Authorize(ctx, billingmigration.Actor{ID: "admin_one"}, "project_one", billingmigration.CapabilityAssessReadiness); err != billingmigration.ErrForbidden {
		t.Fatalf("admin assess-readiness error = %v", err)
	}
	if _, err := repository.Authorize(ctx, billingmigration.Actor{ID: "admin_one"}, "project_one", billingmigration.CapabilityResolveCases); err != nil {
		t.Fatalf("admin resolve-cases error = %v", err)
	}
	for _, capability := range []string{billingmigration.CapabilityExecuteRepair, billingmigration.CapabilityDeleteSource, billingmigration.CapabilityRemoveCredential, billingmigration.CapabilityManageLegalHold, billingmigration.CapabilityCompleteMigration} {
		if _, err := repository.Authorize(ctx, billingmigration.Actor{ID: "admin_one"}, "project_one", capability); err != billingmigration.ErrForbidden {
			t.Fatalf("admin capability %s error = %v", capability, err)
		}
		if _, err := repository.Authorize(ctx, billingmigration.Actor{ID: "owner_one"}, "project_one", capability); err != nil {
			t.Fatalf("owner capability %s error = %v", capability, err)
		}
	}

	var plaintextColumns int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM information_schema.columns
		WHERE table_name='billing_migration_credentials' AND column_name IN ('secret','api_key','credential')`).Scan(&plaintextColumns); err != nil {
		t.Fatal(err)
	}
	if plaintextColumns != 0 {
		t.Fatal("migration credential schema contains a plaintext credential column")
	}
	var ciphertext []byte
	if err := pool.QueryRow(ctx, `SELECT ciphertext FROM billing_migration_credentials WHERE id=$1`, created.Program.Source.CredentialReference).Scan(&ciphertext); err != nil {
		t.Fatal(err)
	}
	if string(ciphertext) == "migration-secret" {
		t.Fatal("migration credential was stored in plaintext")
	}
	var unsafeSourceColumns int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM information_schema.columns
		WHERE table_name='billing_migration_source_records'
		  AND column_name IN ('normalized_record','raw_payload','purchase_token','credential')`).Scan(&unsafeSourceColumns); err != nil {
		t.Fatal(err)
	}
	if unsafeSourceColumns != 0 {
		t.Fatal("normalized source rows can persist provider payload or credential-shaped material")
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO environments(id,project_id,key,name,mode,created_at,updated_at)
		VALUES('environment_two','project_one','staging','Staging','staging',now(),now());
		INSERT INTO billing_migration_program_scopes(program_id,project_id,environment_id,application_id,platform,created_at)
		VALUES($1,'project_one','environment_two','app_one','ios',now())`, created.Program.ProgramID); err == nil {
		t.Fatal("program scope accepted an Environment different from the program Environment")
	}

	if _, err := pool.Exec(ctx, `INSERT INTO billing_migration_source_manifests(
		id,program_id,project_id,state_version,adapter_version,provider_api_version,schema_version,
		record_count,current_access_record_count,object_key,object_checksum,object_size_bytes,
		object_encryption,manifest_digest,captured_at) VALUES(
		'manifest_one',$1,'project_one',1,'adapter-v1','v2','schema-v1',5,5,'private/object',
		decode(repeat('00',32),'hex'),0,'AES-256-GCM',decode(repeat('11',32),'hex'),now())`, created.Program.ProgramID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE billing_migration_source_manifests SET record_count=1 WHERE id='manifest_one'`); err == nil {
		t.Fatal("immutable migration manifest accepted an update")
	}
	if _, err := pool.Exec(ctx, `INSERT INTO billing_migration_source_records(
		id,program_id,project_id,manifest_id,source_kind,source_identifier,source_revision,record_digest,
		current_access,normalization_schema_version,evidence_kind,observed_at,created_at) VALUES
		('record_export',$1,'project_one','manifest_one','customer','customer-export','1',decode(repeat('30',32),'hex'),true,'v1','trusted_source_export',now(),now()),
		('record_wrong_kind',$1,'project_one','manifest_one','alias','customer-export','1',decode(repeat('35',32),'hex'),true,'v1','provider_validated',now(),now()),
		('record_api',$1,'project_one','manifest_one','customer','customer-api','1',decode(repeat('31',32),'hex'),true,'v1','trusted_provider_api',now(),now()),
		('record_signed',$1,'project_one','manifest_one','customer','customer-signed','1',decode(repeat('32',32),'hex'),true,'v1','provider_signed',now(),now()),
		('record_validated',$1,'project_one','manifest_one','customer','customer-validated','1',decode(repeat('33',32),'hex'),true,'v1','provider_validated',now(),now())`, created.Program.ProgramID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO billing_migration_source_records(
		id,program_id,project_id,manifest_id,source_kind,source_identifier,source_revision,record_digest,
		current_access,normalization_schema_version,evidence_kind,observed_at,created_at)
		VALUES('record_control',$1,'project_one','manifest_one','customer',E'bad\nidentifier','1',decode(repeat('34',32),'hex'),false,'v1','provider_validated',now(),now())`, created.Program.ProgramID); err == nil {
		t.Fatal("source record accepted a control character in source_identifier")
	}
	now := time.Now().UTC()
	if err := repository.CreateMappingSet(ctx, 1, billingmigration.MappingSetWrite{
		ProjectID: "project_one", MappingDigest: bytesOf(0x22), ActorID: "owner_one", CreatedAt: now,
		MappingSet: billingmigration.MappingSet{ProgramID: created.Program.ProgramID, StateVersion: 1,
			MappingSetID: "mapping_one", Version: 1, Status: "draft", Entries: []billingmigration.MappingEntry{{SourceKind: "customer_id", SourceIdentifier: "customer-export", TargetID: "customer_one", MatchKind: "exact"}}},
	}); err != nil {
		t.Fatalf("create mapping set: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO billing_migration_mapping_entries(
		id,mapping_set_id,program_id,project_id,source_kind,source_identifier,target_id,match_kind,created_at)
		VALUES('mapping_control','mapping_one',$1,'project_one','customer_id',E'bad\tidentifier','customer_one','exact',now())`, created.Program.ProgramID); err == nil {
		t.Fatal("mapping entry accepted a control character in source_identifier")
	}
	if _, err := repository.CreateImportBatch(ctx, 1, billingmigration.ImportBatchWrite{ProjectID: "project_one", ManifestID: "manifest_one", MappingSetID: "mapping_one", RequestDigest: bytesOf(0x30), CreatedAt: now, Batch: billingmigration.ImportBatch{ProgramID: created.Program.ProgramID, StateVersion: 1, BatchID: "batch_too_early", IdempotencyKey: "batch-too-early", RecordCount: 1}}); err != billingmigration.ErrConflict {
		t.Fatalf("import before mapping freeze error = %v", err)
	}
	if err := repository.FreezeMappingSet(ctx, "project_one", created.Program.ProgramID, "mapping_one", 1, now); err != nil {
		t.Fatalf("freeze mapping set: %v", err)
	}
	if err := repository.CreateMappingSet(ctx, 2, billingmigration.MappingSetWrite{ProjectID: "project_one", MappingDigest: bytesOf(0x24), ActorID: "owner_one", CreatedAt: now, MappingSet: billingmigration.MappingSet{ProgramID: created.Program.ProgramID, StateVersion: 2, MappingSetID: "mapping_too_late", Version: 2, Status: "draft"}}); err != billingmigration.ErrConflict {
		t.Fatalf("mapping after freeze error = %v", err)
	}
	replayedBatch, err := repository.CreateImportBatch(ctx, 2, billingmigration.ImportBatchWrite{
		ProjectID: "project_one", ManifestID: "manifest_one", MappingSetID: "mapping_one",
		RequestDigest: bytesOf(0x33), CreatedAt: now,
		Batch: billingmigration.ImportBatch{ProgramID: created.Program.ProgramID, StateVersion: 2,
			BatchID: "batch_one", IdempotencyKey: "batch-key", RecordCount: 10},
	})
	if err != nil || replayedBatch {
		t.Fatalf("create import batch: replay=%v err=%v", replayedBatch, err)
	}
	batch, leased, err := repository.LeaseImportBatch(ctx, "worker_one", now, now.Add(time.Minute))
	if err != nil || !leased {
		t.Fatalf("lease import batch: leased=%v err=%v", leased, err)
	}
	if err := repository.CompleteImportBatch(ctx, "project_one", created.Program.ProgramID, batch.BatchID,
		"worker_one", batch.LeaseGeneration-1, "cursor-10", 9, 1, now.Add(time.Second)); err != billingmigration.ErrConflict {
		t.Fatalf("stale lease completion error = %v", err)
	}
	if err := repository.CompleteImportBatch(ctx, "project_one", created.Program.ProgramID, batch.BatchID,
		"worker_one", batch.LeaseGeneration, "cursor-10", 9, 1, now.Add(time.Second)); err != nil {
		t.Fatalf("complete import batch: %v", err)
	}
	if _, _, err := service.QueueRun(ctx, billingmigration.Actor{ID: "owner_one"}, billingmigration.QueueRunInput{ProjectID: "project_one", ProgramID: created.Program.ProgramID, RunKind: "shadow", IdempotencyKey: "shadow-too-early", ExpectedStateVersion: 2, ManifestDigest: billingmigration.FormatDigest(bytesOf(0x11)), MappingDigest: billingmigration.FormatDigest(bytesOf(0x22))}); err != billingmigration.ErrConflict {
		t.Fatalf("shadow before dry run error = %v", err)
	}
	runInput := billingmigration.QueueRunInput{ProjectID: "project_one", ProgramID: created.Program.ProgramID,
		RunKind: "dry_run", IdempotencyKey: "dry-run-one", ExpectedStateVersion: 2,
		ManifestDigest: billingmigration.FormatDigest(bytesOf(0x11)), MappingDigest: billingmigration.FormatDigest(bytesOf(0x22))}
	runJob, replayedRun, err := service.QueueRun(ctx, billingmigration.Actor{ID: "owner_one"}, runInput)
	if err != nil || replayedRun {
		t.Fatalf("queue dry run: replay=%v err=%v", replayedRun, err)
	}
	replayedJob, replayedRun, err := service.QueueRun(ctx, billingmigration.Actor{ID: "owner_one"}, runInput)
	if err != nil || !replayedRun || replayedJob.RunJobID != runJob.RunJobID {
		t.Fatalf("replay dry run: first=%s replay=%#v replayed=%v err=%v", runJob.RunJobID, replayedJob, replayedRun, err)
	}
	if _, err := service.AssessCurrentReadiness(ctx, billingmigration.Actor{ID: "owner_one"}, "project_one", created.Program.ProgramID, 3); err != billingmigration.ErrConflict {
		t.Fatalf("readiness before shadow error = %v", err)
	}
	if _, _, err := service.QueueRun(ctx, billingmigration.Actor{ID: "owner_one"}, billingmigration.QueueRunInput{ProjectID: "project_one", ProgramID: created.Program.ProgramID, RunKind: "shadow", IdempotencyKey: "shadow-one", ExpectedStateVersion: 3, ManifestDigest: billingmigration.FormatDigest(bytesOf(0x11)), MappingDigest: billingmigration.FormatDigest(bytesOf(0x22))}); err != nil {
		t.Fatalf("queue shadow run: %v", err)
	}
	readiness, err := service.AssessCurrentReadiness(ctx, billingmigration.Actor{ID: "owner_one"}, "project_one", created.Program.ProgramID, 4)
	if err != nil || readiness.Ready {
		t.Fatalf("stage 2B readiness = %#v err=%v", readiness, err)
	}
	if readiness.CurrentAccessEvidencePercent != 60 {
		t.Fatalf("provider evidence percentage = %v, want signed+validated only", readiness.CurrentAccessEvidencePercent)
	}
	if readiness.CurrentAccessMappingPercent != 20 {
		t.Fatalf("mapping percentage = %v, wrong-kind identifier collision counted as coverage", readiness.CurrentAccessMappingPercent)
	}
	if _, err := billingmigration.ParseDigest(readiness.ReadinessDigest); err != nil {
		t.Fatalf("readiness digest is not frozen sha256 form: %q", readiness.ReadinessDigest)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO billing_migration_cutover_proposals(id,program_id,project_id,state_version,command,proposer_actor_id,reason,scope_digest,manifest_digest,mapping_digest,policy_digest,evidence_digest,readiness_digest,final_watermark_digest,application_version_digest,proposal_digest,status,proposed_at,expires_at)
		VALUES('proposal_two_person',$1,'project_one',4,'cutover','owner_one','reviewed',decode(repeat('50',32),'hex'),decode(repeat('51',32),'hex'),decode(repeat('52',32),'hex'),decode(repeat('53',32),'hex'),decode(repeat('54',32),'hex'),decode(repeat('55',32),'hex'),decode(repeat('56',32),'hex'),decode(repeat('57',32),'hex'),decode(repeat('58',32),'hex'),'pending',now(),now()+interval '1 hour')`, created.Program.ProgramID); err != nil {
		t.Fatalf("insert approval fixture: %v", err)
	}
	approvalSQL := `INSERT INTO billing_migration_approvals(id,program_id,project_id,proposal_id,state_version,command,proposer_actor_id,approver_actor_id,approval_digest,approved_at,expires_at)
		VALUES($1,$2,'project_one','proposal_two_person',4,'cutover','owner_one','owner_one',decode(repeat('59',32),'hex'),now(),now()+interval '1 hour')`
	if _, err := pool.Exec(ctx, approvalSQL, "approval_same_actor_production", created.Program.ProgramID); err == nil {
		t.Fatal("production approval accepted the proposer as approver")
	}
	if _, err := pool.Exec(ctx, `UPDATE environments SET mode='staging' WHERE id='environment_one' AND project_id='project_one'`); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, approvalSQL, "approval_same_actor_staging", created.Program.ProgramID); err != nil {
		t.Fatalf("nonproduction approval rejected self-approval: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO billing_migration_cases(id,program_id,project_id,state_version,classification,status,reason,case_digest,opened_at) VALUES('case_distinct_exception',$1,'project_one',4,'blocking','in_progress','reviewed',decode(repeat('92',32),'hex'),now())`, created.Program.ProgramID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO billing_migration_source_access_exceptions(id,case_id,program_id,project_id,application_id,platform,reason,affected_customer_count,rollback_treatment,identity_ambiguity_count,proposer_actor_id,approver_actor_id,approved_at,expires_at,exception_digest) VALUES('exception_same_actor','case_distinct_exception',$1,'project_one','app_one','ios','reviewed',1,'restore source',0,'owner_one','owner_one',now(),now()+interval '1 hour',decode(repeat('93',32),'hex'))`, created.Program.ProgramID); err == nil {
		t.Fatal("nonproduction source-access exception accepted identical proposer and approver")
	}
	if _, err := pool.Exec(ctx, `INSERT INTO billing_migration_completion_reports(id,program_id,project_id,state_version,completed_at,stabilization_ended_at,rollback_window_ended_at,credential_removed,credential_removed_at,legal_hold,source_objects_delete_at,completion_digest) VALUES('completion_bad',$1,'project_one',4,now(),now(),now()+interval '1 day',true,now(),false,now()+interval '30 days',decode(repeat('94',32),'hex'))`, created.Program.ProgramID); err == nil {
		t.Fatal("completion accepted completion/credential removal before rollback window ended")
	}
	if _, err := pool.Exec(ctx, `INSERT INTO billing_migration_completion_reports(id,program_id,project_id,state_version,completed_at,stabilization_ended_at,rollback_window_ended_at,credential_removed,credential_removed_at,legal_hold,source_objects_delete_at,completion_digest) VALUES('completion_bad_stabilization',$1,'project_one',4,now(),now()+interval '1 second',now(),true,now(),false,now()+interval '30 days',decode(repeat('99',32),'hex'))`, created.Program.ProgramID); err == nil {
		t.Fatal("completion accepted completed_at before stabilization ended")
	}
	if _, err := pool.Exec(ctx, `INSERT INTO billing_migration_completion_reports(id,program_id,project_id,state_version,completed_at,stabilization_ended_at,rollback_window_ended_at,credential_removed,credential_removed_at,legal_hold,source_objects_delete_at,completion_digest) VALUES('completion_bad_delete',$1,'project_one',4,now(),now(),now(),true,now(),false,now()+interval '31 days',decode(repeat('95',32),'hex'))`, created.Program.ProgramID); err == nil {
		t.Fatal("completion accepted a non-deterministic source-object deletion time")
	}
	if _, err := pool.Exec(ctx, `INSERT INTO billing_migration_completion_reports(id,program_id,project_id,state_version,completed_at,stabilization_ended_at,rollback_window_ended_at,credential_removed,credential_removed_at,legal_hold,source_objects_delete_at,completion_digest) VALUES('completion_valid',$1,'project_one',4,now(),now()-interval '1 day',now(),true,now(),false,now()+interval '30 days',decode(repeat('96',32),'hex'))`, created.Program.ProgramID); err != nil {
		t.Fatalf("valid completion timing rejected: %v", err)
	}
}

func seedMigrationTenant(t *testing.T, ctx context.Context, db *sql.DB) {
	t.Helper()
	_, err := db.ExecContext(ctx, `
		INSERT INTO organizations(id,name,created_at,updated_at) VALUES('org_one','One',now(),now());
		INSERT INTO organization_members(organization_id,actor_id,role,created_at,updated_at) VALUES
			('org_one','owner_one','owner',now(),now()),('org_one','admin_one','admin',now(),now()),
			('org_one','member_one','member',now(),now());
		INSERT INTO projects(id,organization_id,key,name,status,created_at,updated_at)
			VALUES('project_one','org_one','one','One','active',now(),now());
		INSERT INTO environments(id,project_id,key,name,mode,created_at,updated_at)
			VALUES('environment_one','project_one','production','Production','production',now(),now());
		INSERT INTO applications(id,project_id,name,platform,identifier,created_at,updated_at)
			VALUES('app_one','project_one','App','ios','com.example.app',now(),now());
		INSERT INTO billing_customers(id,project_id,status,created_at,updated_at)
			VALUES('customer_one','project_one','active',now(),now());
	`)
	if err != nil {
		t.Fatal(err)
	}
}

type zeroReader struct{}

func (zeroReader) Read(buffer []byte) (int, error) {
	for index := range buffer {
		buffer[index] = 0
	}
	return len(buffer), nil
}

func bytesOf(value byte) []byte {
	result := make([]byte, 32)
	for index := range result {
		result[index] = value
	}
	return result
}
