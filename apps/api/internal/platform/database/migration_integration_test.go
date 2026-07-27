package database_test

import (
	"context"
	"database/sql"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/Mujhtech/mosaic/apps/api/migrations"
)

func openMigrationTestDB(t *testing.T) (*sql.DB, context.Context) {
	t.Helper()
	databaseURL := os.Getenv("DATABASE_TEST_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_TEST_URL is required for PostgreSQL integration tests")
	}
	config, err := pgx.ParseConfig(databaseURL)
	if err != nil {
		t.Fatalf("parse DATABASE_TEST_URL: %v", err)
	}
	db := stdlib.OpenDB(*config)
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = db.Close() })

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	t.Cleanup(cancel)
	if err := db.PingContext(ctx); err != nil {
		t.Fatalf("connect to PostgreSQL: %v", err)
	}
	goose.SetBaseFS(migrations.Files)
	if err := goose.SetDialect("postgres"); err != nil {
		t.Fatal(err)
	}
	// Start from an empty schema. Seeded Configuration Releases cannot be
	// deleted (an immutability trigger correctly refuses), so a refused rollback
	// in a previous run would otherwise block every later run.
	resetSchema(t, ctx, db)
	return db, ctx
}

func resetSchema(t *testing.T, ctx context.Context, db *sql.DB) {
	t.Helper()
	if _, err := db.ExecContext(ctx, `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`); err != nil {
		t.Fatalf("reset the test schema (DATABASE_TEST_URL must point at a throwaway database): %v", err)
	}
}

// Down migrations are not a rollback strategy: migrations 00006, 00010, and
// 00018 would destroy commerce configuration, rewrite immutable Configuration
// Releases, or delete Experiment attribution. A silent, apparently-successful
// rollback is worse than a refusal because the operator believes they recovered.
// This asserts 00018 refuses cleanly when affected data exists, and names the
// restore path.
func TestMigration00018DownRefusesWhenAffectedDataExists(t *testing.T) {
	db, ctx := openMigrationTestDB(t)

	if err := goose.UpContext(ctx, db, "."); err != nil {
		t.Fatalf("apply all migrations: %v", err)
	}

	// A Delivery v3 Release is only representable from 00018 onward. The Phase 6
	// schema cannot describe it, so rolling back would have to destroy it.
	if _, err := db.ExecContext(ctx, `
		INSERT INTO organizations(id,name,created_at,updated_at)
			VALUES('rollback_org','Rollback',now(),now());
		INSERT INTO projects(id,organization_id,key,name,status,created_at,updated_at)
			VALUES('rollback_project','rollback_org','rollback','Rollback','active',now(),now());
		INSERT INTO environments(id,project_id,key,name,mode,created_at,updated_at)
			VALUES('rollback_environment','rollback_project','development','Development','development',now(),now());
		INSERT INTO configuration_releases(
			id,project_id,environment_id,release_number,delivery_contract_version,
			payload,payload_bytes,content_hash,published_by_actor_id,published_at
		) VALUES(
			'rollback_release','rollback_project','rollback_environment',1,'3',
			'{}'::jsonb,'\x7b7d'::bytea,repeat('a',64),'rollback_actor',now()
		);
	`); err != nil {
		t.Fatalf("seed a Delivery v3 Release: %v", err)
	}

	err := goose.DownToContext(ctx, db, ".", 17)
	if err == nil {
		t.Fatal("rolling back 00018 succeeded while a Delivery v3 Release existed; " +
			"the rollback silently destroyed data it cannot represent")
	}
	message := err.Error()
	if !strings.Contains(message, "cannot be rolled back") {
		t.Fatalf("refusal did not identify itself as a refusal: %v", err)
	}
	if !strings.Contains(message, "backup-restore") {
		t.Fatalf("refusal did not name the restore-from-backup path: %v", err)
	}

	// Migrations above 00018 roll back cleanly; 00018 itself must remain applied
	// so the data it represents is still readable.
	version, err := goose.GetDBVersionContext(ctx, db)
	if err != nil {
		t.Fatal(err)
	}
	if version < 18 {
		t.Fatalf("schema version after refused rollback = %d, want 00018 still applied", version)
	}
	var releases int
	if err := db.QueryRowContext(ctx,
		`SELECT count(*) FROM configuration_releases WHERE delivery_contract_version='3'`).Scan(&releases); err != nil {
		t.Fatalf("the refused rollback left the schema unusable: %v", err)
	}
	if releases != 1 {
		t.Fatalf("Delivery v3 Releases after refused rollback = %d, want the seeded row intact", releases)
	}

	// Leave the database at the expected version for any later suite.
	if err := goose.UpContext(ctx, db, "."); err != nil {
		t.Fatalf("reapply migrations after the refused rollback: %v", err)
	}
}

// The full down/up cycle on an empty database is the only thing that proves every
// down migration is syntactically valid and that the refusal guards' own queries
// reference real columns. A guard that raised a SQL error instead of a clean
// refusal would be indistinguishable from a broken migration to an operator.
func TestMigrationDownUpCycleOnAnEmptyDatabase(t *testing.T) {
	db, ctx := openMigrationTestDB(t)

	if err := goose.UpContext(ctx, db, "."); err != nil {
		t.Fatalf("apply all migrations: %v", err)
	}
	if err := goose.DownToContext(ctx, db, ".", 0); err != nil {
		t.Fatalf("roll every migration back on an empty database: %v", err)
	}
	version, err := goose.GetDBVersionContext(ctx, db)
	if err != nil {
		t.Fatal(err)
	}
	if version != 0 {
		t.Fatalf("version after full rollback = %d, want 0", version)
	}

	if err := goose.UpContext(ctx, db, "."); err != nil {
		t.Fatalf("reapply every migration: %v", err)
	}
	version, err = goose.GetDBVersionContext(ctx, db)
	if err != nil {
		t.Fatal(err)
	}
	expected, err := migrations.ExpectedVersion()
	if err != nil {
		t.Fatal(err)
	}
	if version != expected {
		t.Fatalf("version after reapply = %d, want %d", version, expected)
	}
}
