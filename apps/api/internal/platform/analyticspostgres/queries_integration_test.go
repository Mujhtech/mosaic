package analyticspostgres

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib"

	"github.com/Mujhtech/mosaic/apps/api/internal/analytics"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/pgtest"
)

func TestSameDayReportRangeUsesExactEventBoundaries(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_TEST_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_TEST_URL is required for PostgreSQL integration tests")
	}
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := pgtest.Migrate(db, 0); err != nil {
		t.Fatal(err)
	}
	// The assertion clock starts after the schema is up: a deadline
	// created before migration is spent by migration.
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	_, err = db.ExecContext(ctx, `
		DELETE FROM analytics_deletion_job_buckets WHERE project_id='report_project';
		DELETE FROM analytics_deletion_jobs WHERE project_id='report_project';
		DELETE FROM analytics_export_jobs WHERE project_id='report_project';
		DELETE FROM analytics_daily_funnel_counts WHERE project_id='report_project';
		DELETE FROM analytics_daily_event_counts WHERE project_id='report_project';
		DELETE FROM analytics_events WHERE project_id='report_project';
		DELETE FROM analytics_ingestion_batches WHERE project_id='report_project';
		DELETE FROM analytics_sessions WHERE project_id='report_project';
		DELETE FROM analytics_installations WHERE project_id='report_project';
		DELETE FROM analytics_subjects WHERE project_id='report_project';
		DELETE FROM api_keys WHERE id IN ('report_key','report_secret_key');
	`)
	if err != nil {
		t.Fatalf("clean report fixture: %v", err)
	}
	_, err = db.ExecContext(ctx, `
		INSERT INTO organizations(id,name,created_at,updated_at) VALUES('report_org','Report',now(),now()) ON CONFLICT(id) DO NOTHING;
		INSERT INTO organization_members(organization_id,actor_id,role,created_at,updated_at) VALUES
			('report_org','report_actor','member',now(),now()),
			('report_org','report_owner','owner',now(),now()),
			('report_org','report_admin','admin',now(),now()) ON CONFLICT(organization_id,actor_id) DO UPDATE SET role=excluded.role,updated_at=excluded.updated_at;
		INSERT INTO projects(id,organization_id,key,name,status,created_at,updated_at) VALUES('report_project','report_org','report','Report','active',now(),now()) ON CONFLICT(id) DO NOTHING;
		INSERT INTO applications(id,project_id,name,platform,identifier,created_at,updated_at) VALUES('report_app','report_project','Report iOS','ios','dev.mosaic.report',now(),now()) ON CONFLICT(id) DO NOTHING;
		INSERT INTO environments(id,project_id,key,name,mode,created_at,updated_at) VALUES('report_env','report_project','development','Development','development',now(),now()) ON CONFLICT(id) DO NOTHING;
		-- This fixture is about report windows, not about the collection switch:
		-- state it as enabled so the seed does not read as a claim that querying
		-- a disabled Environment is what is being exercised. DO UPDATE rather
		-- than DO NOTHING because 00012's trigger already created this row.
		INSERT INTO analytics_environment_settings(environment_id,project_id,collection_enabled,raw_retention_days,updated_at) VALUES('report_env','report_project',true,180,now()) ON CONFLICT(environment_id) DO UPDATE SET collection_enabled=true,raw_retention_days=180;
		INSERT INTO api_keys(id,environment_id,application_id,application_project_id,kind,prefix,secret_digest,created_by_actor_id,created_at) VALUES('report_key','report_env','report_app','report_project','public_sdk','report_prefix',decode(repeat('00',32),'hex'),'report_actor',now());
		INSERT INTO api_keys(id,environment_id,application_id,application_project_id,kind,prefix,secret_digest,created_by_actor_id,created_at) VALUES('report_secret_key','report_env',NULL,NULL,'secret_server','report_secret_prefix',decode(repeat('09',32),'hex'),'report_owner',now());
		INSERT INTO analytics_subjects(id,project_id,kind,created_at) VALUES('report_subject','report_project','installation',now());
		INSERT INTO analytics_installations(id,subject_id,project_id,application_id,external_id,first_seen_at,last_seen_at) VALUES('report_installation','report_subject','report_project','report_app','report-installation','2026-07-26T09:00:00Z','2026-07-26T21:00:00Z');
		INSERT INTO analytics_sessions(id,project_id,environment_id,application_id,client_session_id,installation_id,identity_generation,started_at,last_occurred_at,last_received_at,created_at) VALUES('report_session','report_project','report_env','report_app','report-session','report_installation',0,'2026-07-26T09:00:00Z','2026-07-26T21:00:00Z','2026-07-26T21:00:00Z','2026-07-26T09:00:00Z');
		INSERT INTO analytics_ingestion_batches(id,project_id,environment_id,api_key_id,client_batch_id,event_count,received_at) VALUES('report_batch','report_project','report_env','report_key','report-batch',4,'2026-07-26T21:00:00Z');
		INSERT INTO analytics_events(event_id,project_id,environment_id,application_id,ingestion_batch_id,api_key_id,event_schema_version,event_name,authority,occurred_at,queued_at,sent_at,received_at,expires_at,installation_id,subject_id,session_id,identity_generation,platform,sdk_version,paywall_version_id,provider,payload,canonical_digest) VALUES
		('event_inside','report_project','report_env','report_app','report_batch','report_key','1','paywall_presented','client_observed','2026-07-26T11:00:00Z','2026-07-26T11:00:00Z','2026-07-26T11:00:00Z','2026-07-26T11:00:00Z','2026-08-02T11:00:00Z','report_installation','report_subject','report_session',0,'ios','test','version_inside',NULL,'{}',decode(repeat('01',32),'hex')),
		('event_outside','report_project','report_env','report_app','report_batch','report_key','1','paywall_presented','client_observed','2026-07-26T20:00:00Z','2026-07-26T20:00:00Z','2026-07-26T20:00:00Z','2026-07-26T20:00:00Z','2026-08-02T20:00:00Z','report_installation','report_subject','report_session',0,'ios','test','version_outside',NULL,'{}',decode(repeat('02',32),'hex')),
		('error_inside','report_project','report_env','report_app','report_batch','report_key','1','product_load_failed','client_observed','2026-07-26T11:30:00Z','2026-07-26T11:30:00Z','2026-07-26T11:30:00Z','2026-07-26T11:30:00Z','2026-08-02T11:30:00Z','report_installation','report_subject','report_session',0,'ios','test',NULL,'app_store','{}',decode(repeat('03',32),'hex')),
		('error_outside','report_project','report_env','report_app','report_batch','report_key','1','product_load_failed','client_observed','2026-07-26T20:30:00Z','2026-07-26T20:30:00Z','2026-07-26T20:30:00Z','2026-07-26T20:30:00Z','2026-08-02T20:30:00Z','report_installation','report_subject','report_session',0,'ios','test',NULL,'google_play','{}',decode(repeat('04',32),'hex'));
		INSERT INTO analytics_daily_funnel_counts(project_id,environment_id,bucket_date,metric_id,authority,numerator,latest_received_at) VALUES('report_project','report_env','2026-07-26','paywall_presentations','client_observed',2,'2026-07-26T21:00:00Z');
	`)
	if err != nil {
		t.Fatalf("seed report data: %v", err)
	}
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	repository := New(pool)
	query := analytics.Query{ProjectID: "report_project", EnvironmentID: "report_env", From: time.Date(2026, 7, 26, 10, 0, 0, 0, time.UTC), To: time.Date(2026, 7, 26, 12, 0, 0, 0, time.UTC), Timezone: "UTC", Basis: "event_count"}

	result, err := repository.Query(ctx, analytics.Actor{ID: "report_actor"}, query, []string{"paywall_presentations"})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Metrics) != 1 || result.Metrics[0].Numerator != 1 {
		t.Fatalf("same-day paywall presentations = %#v, want one in-range event", result.Metrics)
	}
	comparison, err := repository.Query(ctx, analytics.Actor{ID: "report_actor"}, query, []string{"__paywall_versions"})
	if err != nil {
		t.Fatal(err)
	}
	if len(comparison.Metrics) != 2 || comparison.Metrics[0].ID != "paywall_presentations" || comparison.Metrics[0].Numerator != 1 || comparison.Metrics[0].Dimensions["paywall_version_id"] != "version_inside" || comparison.Metrics[1].ID != "presentation_to_client_completed_purchase_rate" {
		t.Fatalf("same-day Paywall Version comparison = %#v", comparison.Metrics)
	}
	providerErrors, err := repository.Query(ctx, analytics.Actor{ID: "report_actor"}, query, []string{"__provider_errors"})
	if err != nil {
		t.Fatal(err)
	}
	if len(providerErrors.Metrics) != 1 || providerErrors.Metrics[0].Dimensions["provider"] != "app_store" {
		t.Fatalf("same-day provider errors = %#v", providerErrors.Metrics)
	}
	if providerErrors.Metrics[0].Dimensions["diagnostic_code"] != "unspecified" {
		t.Fatalf("provider error diagnostic dimension = %#v", providerErrors.Metrics[0].Dimensions)
	}

	confirmed, err := repository.Query(ctx, analytics.Actor{ID: "report_actor"}, query, []string{"provider_confirmed_purchases", "presentation_to_provider_confirmed_purchase_rate"})
	if err != nil {
		t.Fatal(err)
	}
	for _, metric := range confirmed.Metrics {
		if metric.Value != nil || metric.Authority != "provider_confirmed" || len(metric.Warnings) != 1 || metric.Warnings[0] != "provider_confirmed_unavailable" {
			t.Fatalf("provider-confirmed metric must be unavailable: %#v", metric)
		}
	}

	if _, err = repository.SettingsForActor(ctx, analytics.Actor{ID: "report_actor"}, "report_project", "report_env"); err != nil {
		t.Fatalf("member read settings: %v", err)
	}
	if _, err = repository.SettingsForActor(ctx, analytics.Actor{ID: "cross_tenant_actor"}, "report_project", "report_env"); !errors.Is(err, analytics.ErrForbidden) {
		t.Fatalf("cross-tenant settings error = %v, want forbidden", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO analytics_export_jobs(id,organization_id,project_id,environment_id,kind,status,format,available_at,requested_by_actor_id,created_at,updated_at)
		VALUES('report_event_export','report_org','report_project','report_env','events','queued','ndjson',now(),'report_owner',now(),now());
		INSERT INTO analytics_export_jobs(id,organization_id,project_id,kind,identity_digest,identity_reference_id,status,format,available_at,requested_by_actor_id,created_at,updated_at)
		VALUES('report_identity_export','report_org','report_project','application_user',decode(repeat('11',32),'hex'),'report_user','queued','ndjson',now(),'report_owner',now(),now());
		INSERT INTO analytics_deletion_jobs(id,organization_id,project_id,kind,identity_digest,identity_reference_id,request_digest,status,available_at,requested_by_actor_id,confirmed_by_actor_id,created_at,updated_at)
		VALUES('report_identity_deletion','report_org','report_project','application_user',decode(repeat('12',32),'hex'),'report_user',decode(repeat('13',32),'hex'),'queued',now(),'report_owner','report_owner',now(),now());
	`)
	if err != nil {
		t.Fatalf("seed authorization jobs: %v", err)
	}
	if _, err = repository.Job(ctx, analytics.Actor{ID: "report_admin"}, "report_project", "report_event_export"); err != nil {
		t.Fatalf("admin event export status: %v", err)
	}
	for _, jobID := range []string{"report_identity_export", "report_identity_deletion"} {
		if _, err = repository.Job(ctx, analytics.Actor{ID: "report_admin"}, "report_project", jobID); !errors.Is(err, analytics.ErrForbidden) {
			t.Fatalf("admin identity job %s error = %v, want forbidden", jobID, err)
		}
		if _, err = repository.Job(ctx, analytics.Actor{ID: "report_owner"}, "report_project", jobID); err != nil {
			t.Fatalf("owner identity job %s: %v", jobID, err)
		}
	}
	if _, err = repository.Job(ctx, analytics.Actor{ID: "report_actor"}, "report_project", "report_event_export"); !errors.Is(err, analytics.ErrForbidden) {
		t.Fatalf("member event job error = %v, want forbidden", err)
	}
	for _, jobID := range []string{"report_event_export", "missing_job"} {
		if _, err = repository.Job(ctx, analytics.Actor{ID: "cross_tenant_actor"}, "report_project", jobID); !errors.Is(err, analytics.ErrForbidden) {
			t.Fatalf("cross-tenant job %s error = %v, want non-enumerating forbidden", jobID, err)
		}
	}
	processed, err := repository.RunDeletion(ctx, analytics.Job{ID: "report_identity_deletion", ProjectID: "report_project", IdentityKind: "application_user", IdentityReferenceID: "missing_internal_user"}, time.Now().UTC())
	if err != nil || processed {
		t.Fatalf("first zero-event deletion pass = (%v,%v), want staged recomputation", processed, err)
	}
	var deletionAppliedAt *time.Time
	if err = pool.QueryRow(ctx, `SELECT deletion_applied_at FROM analytics_deletion_jobs WHERE id='report_identity_deletion'`).Scan(&deletionAppliedAt); err != nil || deletionAppliedAt == nil {
		t.Fatalf("zero-event deletion progress marker = %v, %v", deletionAppliedAt, err)
	}
}
