package experimentpostgres_test

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/Mujhtech/mosaic/apps/api/internal/experiment"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/experimentpostgres"
	"github.com/Mujhtech/mosaic/apps/api/migrations"
)

// seedSQL builds the minimum valid tenant chain an Experiment version needs.
// Every identifier is prefixed so the fixture is obvious in a shared database.
const seedSQL = `
INSERT INTO organizations(id,name,created_at,updated_at)
	VALUES('xp_org','Experiment',now(),now());
INSERT INTO projects(id,organization_id,key,name,status,created_at,updated_at)
	VALUES('xp_project','xp_org','experiment','Experiment','active',now(),now());
INSERT INTO environments(id,project_id,key,name,mode,created_at,updated_at)
	VALUES('xp_env','xp_project','development','Development','development',now(),now());
INSERT INTO environments(id,project_id,key,name,mode,created_at,updated_at)
	VALUES('xp_other_env','xp_project','staging','Staging','development',now(),now());
INSERT INTO placements(id,project_id,key,name,status,created_by_actor_id,created_at,updated_at)
	VALUES('xp_placement','xp_project','checkout','Checkout','active','xp_actor',now(),now());

INSERT INTO paywalls(id,project_id,key,name,status,created_by_actor_id,created_at,updated_at)
	VALUES('xp_paywall','xp_project','control','Control','active','xp_actor',now(),now());
INSERT INTO paywall_drafts(
	id,project_id,paywall_id,environment_id,status,current_revision,current_protocol_version,
	validation_status,created_by_actor_id,updated_by_actor_id,created_at,updated_at
) VALUES(
	'xp_paywall_draft','xp_project','xp_paywall','xp_env','published',1,'0.2',
	'valid','xp_actor','xp_actor',now(),now()
);
INSERT INTO paywall_draft_revisions(
	draft_id,revision,project_id,protocol_version,document,document_hash,
	validation_status,mutation_key_hash,request_hash,actor_id,created_at
) VALUES(
	'xp_paywall_draft',1,'xp_project','0.2','{}'::jsonb,repeat('a',64),
	'valid',repeat('b',64),repeat('c',64),'xp_actor',now()
);
INSERT INTO paywall_versions(
	id,project_id,paywall_id,environment_id,version_number,source_draft_id,source_revision,
	protocol_version,document,document_hash,created_by_actor_id,created_at
) VALUES(
	'xp_paywall_version','xp_project','xp_paywall','xp_env',1,'xp_paywall_draft',1,
	'0.2','{}'::jsonb,repeat('a',64),'xp_actor',now()
);

INSERT INTO experiment_metric_definitions(
	id,version,name,numerator_event,denominator_event,assignment_unit,authority,availability,
	attribution_window_seconds,freshness_seconds,definition,primary_eligible,guardrail_eligible
) VALUES(
	'xp_metric',1,'Purchase rate','purchase_completed_client','paywall_presented','assignment_key',
	'client_observed','available',86400,3600,'Purchases per exposure',true,true
);

INSERT INTO experiments(
	id,project_id,environment_id,placement_id,name,state,
	created_by_actor_id,updated_by_actor_id,created_at,updated_at
) VALUES(
	'xp_experiment','xp_project','xp_env','xp_placement','Checkout test','draft',
	'xp_actor','xp_actor',now(),now()
);
INSERT INTO experiment_drafts(
	id,experiment_id,project_id,environment_id,current_revision,status,
	created_by_actor_id,updated_by_actor_id,created_at,updated_at
) VALUES(
	'xp_draft','xp_experiment','xp_project','xp_env',1,'published','xp_actor','xp_actor',now(),now()
);
INSERT INTO experiment_draft_revisions(
	draft_id,revision,experiment_id,project_id,document,canonical_digest,validation,
	mutation_key_digest,request_digest,actor_id,created_at
) VALUES(
	'xp_draft',1,'xp_experiment','xp_project','{}'::jsonb,sha256('doc'::bytea),'{}'::jsonb,
	sha256('mutation'::bytea),sha256('request'::bytea),'xp_actor',now()
);
INSERT INTO experiment_versions(
	id,experiment_id,project_id,environment_id,placement_id,version_number,source_draft_id,
	source_revision,canonical_digest,assignment_key_policy,bucketing_algorithm,allocation_version,
	primary_metric_id,primary_metric_version,fallback,compatibility,published_by_actor_id,published_at
) VALUES(
	'xp_version','xp_experiment','xp_project','xp_env','xp_placement',1,'xp_draft',
	1,sha256('doc'::bytea),'installation','experiment_sha256_length_prefixed_v1','allocation_1',
	'xp_metric',1,'normal_placement','{}'::jsonb,'xp_actor',now()
);
INSERT INTO experiment_variants(
	id,experiment_version_id,project_id,role,name,paywall_id,paywall_version_id,
	allocation_start,allocation_end,compatibility
) VALUES(
	'xp_control','xp_version','xp_project','control','Control','xp_paywall','xp_paywall_version',
	0,5000,'{}'::jsonb
),(
	'xp_treatment','xp_version','xp_project','treatment','Treatment','xp_paywall','xp_paywall_version',
	5000,10000,'{}'::jsonb
);
`

func setup(t *testing.T) (*pgxpool.Pool, context.Context) {
	t.Helper()
	databaseURL := os.Getenv("DATABASE_TEST_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_TEST_URL is required for PostgreSQL integration tests")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	t.Cleanup(cancel)

	config, err := pgx.ParseConfig(databaseURL)
	if err != nil {
		t.Fatalf("parse DATABASE_TEST_URL: %v", err)
	}
	db := stdlib.OpenDB(*config)
	db.SetMaxOpenConns(1)
	defer db.Close()
	if err := db.PingContext(ctx); err != nil {
		t.Fatalf("connect to PostgreSQL: %v", err)
	}
	// Immutability triggers correctly refuse to delete published Experiment
	// versions, so the fixture cannot be torn down row by row. Resetting the
	// schema is the only reliable isolation, and DATABASE_TEST_URL is documented
	// as a throwaway database.
	if _, err := db.ExecContext(ctx, `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`); err != nil {
		t.Fatalf("reset the test schema (DATABASE_TEST_URL must be a throwaway database): %v", err)
	}
	goose.SetBaseFS(migrations.Files)
	if err := goose.SetDialect("postgres"); err != nil {
		t.Fatal(err)
	}
	if err := goose.UpContext(ctx, db, "."); err != nil {
		t.Fatalf("apply migrations: %v", err)
	}
	if _, err := db.ExecContext(ctx, seedSQL); err != nil {
		t.Fatalf("seed Experiment fixture: %v", err)
	}

	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool, ctx
}

func execute(t *testing.T, ctx context.Context, pool *pgxpool.Pool, statement string, arguments ...any) error {
	t.Helper()
	_, err := pool.Exec(ctx, statement, arguments...)
	return err
}

// The Experiment schema carries the tenant-scoping and immutability invariants
// that make Experiment results trustworthy, and none of that SQL had an
// integration test. Each assertion below covers one invariant the application
// cannot enforce alone.
func TestExperimentSchemaInvariants(t *testing.T) {
	pool, ctx := setup(t)

	t.Run("composite tenant keys reject a cross-environment Experiment version", func(t *testing.T) {
		// The version's (id, project, environment) tuple must agree with its
		// Experiment's. Without the composite foreign key, an Experiment in one
		// Environment could publish a version attributed to another, which is a
		// cross-tenant boundary violation.
		err := execute(t, ctx, pool, `
			INSERT INTO experiment_versions(
				id,experiment_id,project_id,environment_id,placement_id,version_number,source_draft_id,
				source_revision,canonical_digest,assignment_key_policy,bucketing_algorithm,allocation_version,
				primary_metric_id,primary_metric_version,fallback,compatibility,published_by_actor_id,published_at
			) VALUES(
				'xp_version_cross','xp_experiment','xp_project','xp_other_env','xp_placement',2,'xp_draft',
				1,sha256('doc'::bytea),'installation','experiment_sha256_length_prefixed_v1','allocation_2',
				'xp_metric',1,'normal_placement','{}'::jsonb,'xp_actor',now()
			)`)
		if err == nil {
			t.Fatal("an Experiment version was published into an Environment its Experiment does not belong to")
		}
	})

	t.Run("composite tenant keys reject a cross-project variant", func(t *testing.T) {
		if err := execute(t, ctx, pool, `
			INSERT INTO organizations(id,name,created_at,updated_at)
				VALUES('xp_other_org','Other',now(),now());
			INSERT INTO projects(id,organization_id,key,name,status,created_at,updated_at)
				VALUES('xp_other_project','xp_other_org','other','Other','active',now(),now())`); err != nil {
			t.Fatal(err)
		}
		err := execute(t, ctx, pool, `
			INSERT INTO experiment_variants(
				id,experiment_version_id,project_id,role,name,paywall_id,paywall_version_id,
				allocation_start,allocation_end,compatibility
			) VALUES(
				'xp_cross_variant','xp_version','xp_other_project','treatment','Cross','xp_paywall',
				'xp_paywall_version',0,10000,'{}'::jsonb
			)`)
		if err == nil {
			t.Fatal("a variant was attached to an Experiment version in a different Project")
		}
	})

	t.Run("published Experiment versions are immutable", func(t *testing.T) {
		// A published version is the allocation contract every assignment is
		// attributed to. Mutating it retroactively rewrites history for exposures
		// already recorded.
		if err := execute(t, ctx, pool,
			`UPDATE experiment_versions SET allocation_version='rewritten' WHERE id='xp_version'`); err == nil {
			t.Fatal("a published Experiment version was mutated in place")
		} else if !strings.Contains(err.Error(), "immutable") {
			t.Fatalf("mutation was rejected for the wrong reason: %v", err)
		}
		if err := execute(t, ctx, pool,
			`DELETE FROM experiment_versions WHERE id='xp_version'`); err == nil {
			t.Fatal("a published Experiment version was deleted")
		}
	})

	t.Run("published variants are immutable", func(t *testing.T) {
		if err := execute(t, ctx, pool,
			`UPDATE experiment_variants SET allocation_end=10000 WHERE id='xp_control'`); err == nil {
			t.Fatal("a published variant's allocation was rewritten in place")
		}
	})

	t.Run("allocation invariants are enforced", func(t *testing.T) {
		for name, statement := range map[string]string{
			"allocation above the bucket space": `
				INSERT INTO experiment_variants(
					id,experiment_version_id,project_id,role,name,paywall_id,paywall_version_id,
					allocation_start,allocation_end,compatibility
				) VALUES('xp_over','xp_version','xp_project','treatment','Over','xp_paywall','xp_paywall_version',
					0,10001,'{}'::jsonb)`,
			"inverted allocation range": `
				INSERT INTO experiment_variants(
					id,experiment_version_id,project_id,role,name,paywall_id,paywall_version_id,
					allocation_start,allocation_end,compatibility
				) VALUES('xp_inverted','xp_version','xp_project','treatment','Inverted','xp_paywall','xp_paywall_version',
					8000,8000,'{}'::jsonb)`,
			"negative allocation start": `
				INSERT INTO experiment_variants(
					id,experiment_version_id,project_id,role,name,paywall_id,paywall_version_id,
					allocation_start,allocation_end,compatibility
				) VALUES('xp_negative','xp_version','xp_project','treatment','Negative','xp_paywall','xp_paywall_version',
					-1,5000,'{}'::jsonb)`,
			"unknown bucketing algorithm": `
				INSERT INTO experiment_versions(
					id,experiment_id,project_id,environment_id,placement_id,version_number,source_draft_id,
					source_revision,canonical_digest,assignment_key_policy,bucketing_algorithm,allocation_version,
					primary_metric_id,primary_metric_version,fallback,compatibility,published_by_actor_id,published_at
				) VALUES('xp_bad_algorithm','xp_experiment','xp_project','xp_env','xp_placement',3,'xp_draft',
					1,sha256('doc'::bytea),'installation','md5','allocation_3','xp_metric',1,'normal_placement',
					'{}'::jsonb,'xp_actor',now())`,
		} {
			t.Run(name, func(t *testing.T) {
				if err := execute(t, ctx, pool, statement); err == nil {
					t.Fatal("the database accepted a row violating an allocation invariant")
				}
			})
		}
	})
}

// An Experiment start or completion that never runs silently invalidates the
// Experiment. Before Phase 8 an expired lease stranded the job in 'leased'
// forever and a single transient failure marked it permanently failed, so both
// failures were silent. This exercises reclaim, requeue with backoff, and the
// terminal dead-letter through the real repository.
func TestScheduleLeaseReclaimAndRequeue(t *testing.T) {
	pool, ctx := setup(t)
	repository := experimentpostgres.New(pool)
	now := time.Now().UTC()

	if _, err := pool.Exec(ctx, `
		INSERT INTO experiment_scheduling_jobs(
			id,experiment_id,project_id,environment_id,action,scheduled_at,status,actor_id,
			attempt_count,max_attempts,available_at,created_at,updated_at
		) VALUES('xp_job','xp_experiment','xp_project','xp_env','start',$1,'queued','xp_actor',
			0,3,$1,$1,$1)`, now.Add(-time.Hour)); err != nil {
		t.Fatalf("seed scheduling job: %v", err)
	}

	job, leased, err := repository.LeaseSchedule(ctx, "worker_a", now, now.Add(2*time.Minute))
	if err != nil || !leased {
		t.Fatalf("lease a due job: leased=%v err=%v", leased, err)
	}
	if job.ID != "xp_job" || job.AttemptCount != 1 || job.MaxAttempts != 3 {
		t.Fatalf("leased job = %+v, want xp_job attempt 1 of 3", job)
	}

	// A second worker must not steal a live lease.
	if _, leased, err := repository.LeaseSchedule(ctx, "worker_b", now, now.Add(2*time.Minute)); err != nil || leased {
		t.Fatalf("a live lease was stolen: leased=%v err=%v", leased, err)
	}

	// After the lease expires the job must be reclaimable; otherwise a worker
	// that died mid-job strands the scheduled transition forever.
	afterExpiry := now.Add(5 * time.Minute)
	reclaimed, leased, err := repository.LeaseSchedule(ctx, "worker_b", afterExpiry, afterExpiry.Add(2*time.Minute))
	if err != nil || !leased {
		t.Fatalf("an expired lease was not reclaimed: leased=%v err=%v", leased, err)
	}
	if reclaimed.AttemptCount != 2 {
		t.Fatalf("reclaimed attempt count = %d, want 2", reclaimed.AttemptCount)
	}

	// A transient failure with budget remaining requeues with backoff.
	if err := repository.FinishSchedule(ctx, reclaimed, false, "schedule_transition_failed", afterExpiry); err != nil {
		t.Fatalf("finish with a transient failure: %v", err)
	}
	var status, code string
	var availableAt time.Time
	if err := pool.QueryRow(ctx,
		`SELECT status,last_error_code,available_at FROM experiment_scheduling_jobs WHERE id='xp_job'`).
		Scan(&status, &code, &availableAt); err != nil {
		t.Fatal(err)
	}
	if status != "queued" {
		t.Fatalf("status after a transient failure = %q, want queued for retry", status)
	}
	if code != "schedule_transition_failed" {
		t.Fatalf("diagnostic code = %q, want the failure recorded", code)
	}
	if !availableAt.After(afterExpiry) {
		t.Fatalf("available_at = %s, want backoff past %s", availableAt, afterExpiry)
	}
	// Backoff must actually hold the job back.
	if _, leased, err := repository.LeaseSchedule(ctx, "worker_c", afterExpiry, afterExpiry.Add(time.Minute)); err != nil || leased {
		t.Fatalf("backoff did not hold the job back: leased=%v err=%v", leased, err)
	}

	// Exhausting the budget must dead-letter the job rather than retry forever.
	afterBackoff := availableAt.Add(time.Minute)
	final, leased, err := repository.LeaseSchedule(ctx, "worker_c", afterBackoff, afterBackoff.Add(2*time.Minute))
	if err != nil || !leased {
		t.Fatalf("lease after backoff: leased=%v err=%v", leased, err)
	}
	if final.AttemptCount != 3 {
		t.Fatalf("final attempt count = %d, want 3", final.AttemptCount)
	}
	if err := repository.FinishSchedule(ctx, final, false, "experiment_state_conflict", afterBackoff); err != nil {
		t.Fatalf("finish with the budget exhausted: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT status,last_error_code FROM experiment_scheduling_jobs WHERE id='xp_job'`).
		Scan(&status, &code); err != nil {
		t.Fatal(err)
	}
	if status != "failed" {
		t.Fatalf("status after exhausting the retry budget = %q, want failed", status)
	}
	if code != "experiment_state_conflict" {
		t.Fatalf("terminal diagnostic code = %q, want the last failure recorded", code)
	}
	// A dead-lettered job must not be leased again.
	if _, leased, err := repository.LeaseSchedule(ctx, "worker_d", afterBackoff.Add(time.Hour), afterBackoff.Add(2*time.Hour)); err != nil || leased {
		t.Fatalf("a dead-lettered job was leased again: leased=%v err=%v", leased, err)
	}
}

// A successful run must close the job out cleanly so it is never replayed.
func TestScheduleSuccessCompletesTheJob(t *testing.T) {
	pool, ctx := setup(t)
	repository := experimentpostgres.New(pool)
	now := time.Now().UTC()

	if _, err := pool.Exec(ctx, `
		INSERT INTO experiment_scheduling_jobs(
			id,experiment_id,project_id,environment_id,action,scheduled_at,status,actor_id,
			attempt_count,max_attempts,available_at,created_at,updated_at
		) VALUES('xp_job_ok','xp_experiment','xp_project','xp_env','complete',$1,'queued','xp_actor',
			0,3,$1,$1,$1)`, now.Add(-time.Hour)); err != nil {
		t.Fatalf("seed scheduling job: %v", err)
	}
	job, leased, err := repository.LeaseSchedule(ctx, "worker_a", now, now.Add(2*time.Minute))
	if err != nil || !leased {
		t.Fatalf("lease: leased=%v err=%v", leased, err)
	}
	if err := repository.FinishSchedule(ctx, job, true, "", now); err != nil {
		t.Fatalf("finish successfully: %v", err)
	}
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM experiment_scheduling_jobs WHERE id='xp_job_ok'`).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "completed" {
		t.Fatalf("status = %q, want completed", status)
	}
	if _, leased, err := repository.LeaseSchedule(ctx, "worker_b", now.Add(time.Hour), now.Add(2*time.Hour)); err != nil || leased {
		t.Fatalf("a completed job was leased again: leased=%v err=%v", leased, err)
	}
	// Finishing an unleased job is a conflict, not a silent no-op.
	if err := repository.FinishSchedule(ctx, job, true, "", now); err == nil {
		t.Fatal("finishing an already-completed job succeeded")
	}
}

var _ experiment.Repository = (*experimentpostgres.Repository)(nil)

// TestReleaseClosureStatementsMatchTheSchema guards the Experiment publish
// release SQL against the real schema and against pgx's extended protocol. This
// path had no test and carried two defects that made every Experiment publish
// return 500, so no Experiment could ever reach a published Version: one
// statement selected `assets.url`, a column that does not exist (it is
// `public_url`), and two others were semicolon-joined parameterized statements,
// which PostgreSQL rejects with SQLSTATE 42601. Both are only reported when the
// statement is prepared, which is exactly what this test does.
func TestReleaseClosureStatementsMatchTheSchema(t *testing.T) {
	pool, ctx := setup(t)

	connection, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatalf("acquire connection: %v", err)
	}
	defer connection.Release()

	for index, statement := range experimentpostgres.ReleaseClosureStatements {
		if _, err := connection.Conn().Prepare(ctx, fmt.Sprintf("closure_%d", index), statement); err != nil {
			t.Errorf("release-closure statement %d does not match the schema: %v\n  %s", index, err, statement)
		}
	}
}

// Preparing a statement proves its columns exist; it does not prove the row it
// writes satisfies the table's constraints. Migration 00020 added a NOT NULL
// available_at to experiment_scheduling_jobs and the publish writer was never
// updated, so every Experiment published with a schedule failed with a 500 and
// no Experiment could be scheduled at all. The lease-recovery test above missed
// it because that test seeds its own row and supplies the column the production
// writer omitted. This executes the production statements themselves.
func TestScheduleJobInsertsSatisfyTheSchema(t *testing.T) {
	pool, ctx := setup(t)
	now := time.Now().UTC()

	for index, statement := range experimentpostgres.ScheduleJobInsertStatements {
		transaction, err := pool.Begin(ctx)
		if err != nil {
			t.Fatalf("begin: %v", err)
		}
		_, err = transaction.Exec(ctx, statement,
			fmt.Sprintf("xp_insert_job_%d", index), "xp_experiment", "xp_project", "xp_env",
			now.Add(time.Hour), "xp_actor", now)
		if err != nil {
			t.Errorf("scheduling-job statement %d was rejected by the schema: %v\n  %s", index, err, statement)
		}
		// The row must be immediately leasable once due, which is what
		// available_at exists to express.
		if err == nil {
			var due bool
			if err := transaction.QueryRow(ctx,
				`SELECT available_at = scheduled_at FROM experiment_scheduling_jobs WHERE id=$1`,
				fmt.Sprintf("xp_insert_job_%d", index)).Scan(&due); err != nil {
				t.Errorf("read back statement %d: %v", index, err)
			} else if !due {
				t.Errorf("statement %d wrote available_at out of step with scheduled_at", index)
			}
		}
		_ = transaction.Rollback(ctx)
	}
}
