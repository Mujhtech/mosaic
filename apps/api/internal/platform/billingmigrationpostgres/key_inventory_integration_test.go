package billingmigrationpostgres_test

import (
	"context"
	"os"
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

func TestSourceObjectEnvelopeCountsIncludeOnlyRetainedObjects(t *testing.T) {
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
	now := time.Now().UTC()
	statements := []struct {
		query string
		args  []any
	}{
		{`INSERT INTO billing_migration_credentials(id,project_id,provider,external_project_id,status,envelope_version,algorithm,key_id,nonce,ciphertext,fingerprint,created_by_actor_id,created_at)
		  VALUES('credential_inventory','project_one','revenuecat','rc_project','active',1,'AES-256-GCM','credential_key',decode(repeat('01',12),'hex'),decode(repeat('02',32),'hex'),decode(repeat('03',32),'hex'),'owner_one',$1)`, []any{now}},
		{`INSERT INTO billing_migration_programs(id,project_id,environment_id,source_adapter,source_adapter_version,credential_id,state,state_version,authority_epoch_before,stabilization_days,rollback_window_days,scope_digest,policy_digest,idempotency_key,request_digest,created_by_actor_id,created_at,updated_at)
		  VALUES('program_inventory','project_one','environment_one','revenuecat',$1,'credential_inventory','mapping',1,0,7,7,decode(repeat('11',32),'hex'),decode(repeat('12',32),'hex'),'program-inventory',decode(repeat('13',32),'hex'),'owner_one',$2,$2)`, []any{billingmigration.AdapterVersion, now}},
		{`INSERT INTO billing_migration_program_scopes(program_id,project_id,environment_id,application_id,platform,created_at)
		  VALUES('program_inventory','project_one','environment_one','app_one','ios',$1)`, []any{now}},
	}
	for _, statement := range statements {
		if _, err = db.ExecContext(ctx, statement.query, statement.args...); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = db.ExecContext(ctx, `INSERT INTO billing_migration_source_objects(
		id,program_id,project_id,reservation_key,reservation_digest,reservation_generation,
		write_token_digest,object_key,source_channel,adapter_version,schema_version,state,
		envelope_version,algorithm,key_id,nonce,chunk_size,chunk_count,aad_digest,plaintext_digest,
		plaintext_size_bytes,ciphertext_digest,ciphertext_size_bytes,reserved_at,verified_at)
		VALUES('inventory-retained','program_inventory','project_one','inventory-retained',decode(repeat('11',32),'hex'),1,
		decode(repeat('12',32),'hex'),'billing-migrations/project_one/program_source/inventory-retained.bin',
		'revenuecat_api_v2','1','1','verified',1,'AES-256-GCM-CHUNKED','retained-key',decode(repeat('13',12),'hex'),
		16384,1,decode(repeat('14',32),'hex'),decode(repeat('15',32),'hex'),1,decode(repeat('16',32),'hex'),64,$1,$1)`, now); err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(ctx, `INSERT INTO billing_migration_source_objects(
		id,program_id,project_id,reservation_key,reservation_digest,reservation_generation,
		write_token_digest,object_key,source_channel,adapter_version,schema_version,state,
		envelope_version,algorithm,key_id,nonce,chunk_size,chunk_count,aad_digest,plaintext_digest,
		plaintext_size_bytes,ciphertext_digest,ciphertext_size_bytes,reserved_at,verified_at,
		deleted_at,deletion_actor_id,deletion_digest)
		VALUES('inventory-deleted','program_inventory','project_one','inventory-deleted',decode(repeat('21',32),'hex'),1,
		decode(repeat('22',32),'hex'),'billing-migrations/project_one/program_source/inventory-deleted.bin',
		'revenuecat_api_v2','1','1','deleted',1,'AES-256-GCM-CHUNKED','deleted-key',decode(repeat('23',12),'hex'),
		16384,1,decode(repeat('24',32),'hex'),decode(repeat('25',32),'hex'),1,decode(repeat('26',32),'hex'),64,$1,$1,
		$1,'retention:test',decode(repeat('27',32),'hex'))`, now); err != nil {
		t.Fatal(err)
	}
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	counts, err := billingmigrationpostgres.New(pool).SourceObjectEnvelopeCountsByKeyID(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if counts["retained-key"] != 1 {
		t.Fatalf("retained-key count = %d, want 1", counts["retained-key"])
	}
	if _, included := counts["deleted-key"]; included {
		t.Fatal("deleted source-object metadata still requires an encryption key")
	}
}
