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

// Analytics collection became enabled by default in 00066. The default alone is
// only half of that decision: an Environment that already existed keeps whatever
// row it has, so an upgrade that changed only the column default would leave
// every existing install collecting nothing while the API and the dashboard
// reported collection as on for anything created afterwards. The backfill is
// also the guard behind the repository's absent-row ErrNotFound — a settings row
// that is missing must stay a real error, not a silent "disabled".
//
// The backfill must also stop where consent starts. A row that reads `false`
// because 00012's default made it so is a decision nobody took; a row that reads
// `false` with an actor on it is an owner who deliberately turned collection
// off, and flipping that would start collecting events for an Environment whose
// operator asked Mosaic not to. `updated_by_actor_id` is the only thing that
// tells the two apart, so the guard is tested rather than assumed.
//
// This drives the migration across a database that has the three shapes an
// upgrade actually meets: a row disabled by the old default, a row deliberately
// disabled by an operator, and no row at all.
func TestMigration00066EnablesCollectionForExistingEnvironments(t *testing.T) {
	db, ctx := openMigrationTestDB(t)

	if err := goose.UpToContext(ctx, db, ".", 65); err != nil {
		t.Fatalf("apply migrations through 00065: %v", err)
	}
	// 00012's trigger gives each Environment a settings row, disabled under the
	// pre-00066 default. `orphan_environment` then loses its row outright, which
	// is the state the backfill exists for.
	if _, err := db.ExecContext(ctx, `
		INSERT INTO organizations(id,name,created_at,updated_at)
			VALUES('default_org','Default',now(),now());
		INSERT INTO projects(id,organization_id,key,name,status,created_at,updated_at)
			VALUES('default_project','default_org','default','Default','active',now(),now());
		INSERT INTO environments(id,project_id,key,name,mode,created_at,updated_at) VALUES
			('disabled_environment','default_project','development','Development','development',now(),now()),
			('opted_out_environment','default_project','staging','Staging','staging',now(),now()),
			('orphan_environment','default_project','production','Production','production',now(),now());
		DELETE FROM analytics_environment_settings WHERE environment_id='orphan_environment';
		UPDATE analytics_environment_settings SET updated_by_actor_id='actor_owner',updated_at=now()
			WHERE environment_id='opted_out_environment';
	`); err != nil {
		t.Fatalf("seed pre-00066 Environments: %v", err)
	}
	var enabledBefore bool
	if err := db.QueryRowContext(ctx,
		`SELECT collection_enabled FROM analytics_environment_settings WHERE environment_id='disabled_environment'`,
	).Scan(&enabledBefore); err != nil {
		t.Fatalf("read the pre-upgrade setting: %v", err)
	}
	if enabledBefore {
		t.Fatal("the seeded Environment was already collecting before 00066; the test proves nothing")
	}

	if err := goose.UpContext(ctx, db, "."); err != nil {
		t.Fatalf("apply 00066: %v", err)
	}

	rows, err := db.QueryContext(ctx,
		`SELECT environment_id,collection_enabled,raw_retention_days,updated_by_actor_id
		 FROM analytics_environment_settings WHERE project_id='default_project' ORDER BY environment_id`)
	if err != nil {
		t.Fatalf("read settings after 00066: %v", err)
	}
	defer rows.Close()
	found := map[string]bool{}
	for rows.Next() {
		var id string
		var enabled bool
		var retention int
		var actor *string
		if err := rows.Scan(&id, &enabled, &retention, &actor); err != nil {
			t.Fatal(err)
		}
		if retention != 180 {
			t.Fatalf("%s raw retention = %d, want the 180-day default", id, retention)
		}
		if id == "opted_out_environment" {
			// An operator turned this one off. The migration must leave both the
			// decision and the record of who made it exactly as it found them.
			if enabled {
				t.Fatal("00066 re-enabled collection for an Environment an operator deliberately opted out")
			}
			if actor == nil || *actor != "actor_owner" {
				t.Fatalf("opted_out_environment actor = %v, want the operator who made the decision preserved", actor)
			}
			found[id] = true
			continue
		}
		if !enabled {
			t.Fatalf("%s is still not collecting after 00066", id)
		}
		// Nobody decided this per Environment, so the row must not name an actor.
		if actor != nil {
			t.Fatalf("%s attributes the platform default to actor %q", id, *actor)
		}
		found[id] = true
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if !found["disabled_environment"] || !found["orphan_environment"] || !found["opted_out_environment"] {
		t.Fatalf("settings rows after 00066 = %v, want every Environment present", found)
	}

	if got := collectionEnabledDefault(t, ctx, db); got != "true" {
		t.Fatalf("collection_enabled default after 00066 = %q, want true", got)
	}

	// Down restores the default and deliberately leaves the rows enabled: after
	// the upgrade nothing distinguishes a row this migration flipped from one an
	// owner enabled themselves, and re-disabling would silently discard their
	// decision and the events that follow it.
	if err := goose.DownToContext(ctx, db, ".", 65); err != nil {
		t.Fatalf("roll 00066 back: %v", err)
	}
	if got := collectionEnabledDefault(t, ctx, db); got != "false" {
		t.Fatalf("collection_enabled default after rolling 00066 back = %q, want false", got)
	}
	var stillEnabled int
	if err := db.QueryRowContext(ctx,
		`SELECT count(*) FROM analytics_environment_settings
		 WHERE project_id='default_project' AND collection_enabled`).Scan(&stillEnabled); err != nil {
		t.Fatal(err)
	}
	if stillEnabled != 2 {
		t.Fatalf("Environments still collecting after the rollback = %d, want the two the migration enabled left as the operator found them", stillEnabled)
	}

	if err := goose.UpContext(ctx, db, "."); err != nil {
		t.Fatalf("reapply 00066 after the rollback: %v", err)
	}
	if got := collectionEnabledDefault(t, ctx, db); got != "true" {
		t.Fatalf("collection_enabled default after reapplying 00066 = %q, want true", got)
	}
}

func collectionEnabledDefault(t *testing.T, ctx context.Context, db *sql.DB) string {
	t.Helper()
	var value *string
	if err := db.QueryRowContext(ctx, `
		SELECT column_default FROM information_schema.columns
		WHERE table_schema='public' AND table_name='analytics_environment_settings'
		  AND column_name='collection_enabled'`).Scan(&value); err != nil {
		t.Fatalf("read the collection_enabled default: %v", err)
	}
	if value == nil {
		t.Fatal("collection_enabled has no default; the column must state one")
	}
	return *value
}
