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

// A filtered daily series is served from analytics_daily_event_counts, which is
// the only aggregate written at dimension grain. This exercises the properties
// that make such a chart trustworthy and that no unit test can reach, because
// they are all properties of the SQL: the filter is applied, the dimensions the
// caller did not filter on are collapsed rather than split or double counted,
// the day in progress is excluded, and a day with no matching rows is absent
// rather than fabricated.
func TestDimensionedDailySeriesFiltersAndBucketsByUTCDay(t *testing.T) {
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
		DELETE FROM analytics_daily_funnel_counts WHERE project_id='series_project';
		DELETE FROM analytics_daily_event_counts WHERE project_id='series_project';
	`)
	if err != nil {
		t.Fatalf("clean series fixture: %v", err)
	}
	_, err = db.ExecContext(ctx, `
		INSERT INTO organizations(id,name,created_at,updated_at) VALUES('series_org','Series',now(),now()) ON CONFLICT(id) DO NOTHING;
		INSERT INTO organization_members(organization_id,actor_id,role,created_at,updated_at) VALUES('series_org','series_actor','member',now(),now()) ON CONFLICT(organization_id,actor_id) DO UPDATE SET role=excluded.role,updated_at=excluded.updated_at;
		INSERT INTO projects(id,organization_id,key,name,status,created_at,updated_at) VALUES('series_project','series_org','series','Series','active',now(),now()) ON CONFLICT(id) DO NOTHING;
		INSERT INTO environments(id,project_id,key,name,mode,created_at,updated_at) VALUES('series_env','series_project','development','Development','development',now(),now()) ON CONFLICT(id) DO NOTHING;
		INSERT INTO analytics_environment_settings(environment_id,project_id,collection_enabled,raw_retention_days,updated_at) VALUES('series_env','series_project',true,180,now()) ON CONFLICT(environment_id) DO UPDATE SET collection_enabled=true;

		-- Two Paywall Versions on the same day, platform, and locale. The caller
		-- did not filter on Paywall Version, so the day must report their sum:
		-- a series that reported one of them, or reported the day twice, would
		-- be wrong in a way the response shape cannot show.
		INSERT INTO analytics_daily_event_counts(project_id,environment_id,bucket_date,event_name,authority,platform,locale,application_version,paywall_version_id,event_count,latest_received_at) VALUES
			('series_project','series_env','2026-07-20','paywall_presented','client_observed','ios','en-US','4.2.0','version_a',5,'2026-07-20T23:00:00Z'),
			('series_project','series_env','2026-07-20','paywall_presented','client_observed','ios','en-US','4.2.0','version_b',3,'2026-07-20T23:00:00Z'),
			-- Another platform's rows must never reach an ios series.
			('series_project','series_env','2026-07-20','paywall_presented','client_observed','android','en-US','4.2.0','version_a',7,'2026-07-20T23:00:00Z'),
			('series_project','series_env','2026-07-21','paywall_presented','client_observed','ios','en-US','4.2.0','version_a',2,'2026-07-21T23:00:00Z'),
			-- 2026-07-22 holds ios rows for a different event only, so the
			-- presentations series must report no bucket for that day at all.
			('series_project','series_env','2026-07-22','product_selected','client_observed','ios','en-US','4.2.0',NULL,9,'2026-07-22T23:00:00Z'),
			-- The day in progress. Its bucket is half-built and the series must
			-- not read it; this row is deliberately absurd so a leak is obvious.
			('series_project','series_env','2026-07-23','paywall_presented','client_observed','ios','en-US','4.2.0','version_a',999,'2026-07-23T01:00:00Z'),
			-- Product availability, whose rate has both halves in this grain.
			('series_project','series_env','2026-07-21','product_unavailable','client_observed','ios','en-US','4.2.0',NULL,2,'2026-07-21T23:00:00Z'),
			('series_project','series_env','2026-07-21','product_load_completed','client_observed','ios','en-US','4.2.0',NULL,6,'2026-07-21T23:00:00Z'),
			('series_project','series_env','2026-07-21','product_load_failed','client_observed','ios','en-US','4.2.0',NULL,2,'2026-07-21T23:00:00Z');

		-- The undimensioned funnel aggregate backing the unfiltered path.
		INSERT INTO analytics_daily_funnel_counts(project_id,environment_id,bucket_date,metric_id,authority,numerator,latest_received_at) VALUES
			('series_project','series_env','2026-07-20','paywall_presentations','client_observed',15,'2026-07-20T23:00:00Z'),
			('series_project','series_env','2026-07-23','paywall_presentations','client_observed',999,'2026-07-23T01:00:00Z');
	`)
	if err != nil {
		t.Fatalf("seed series data: %v", err)
	}
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	repository := New(pool)
	actor := analytics.Actor{ID: "series_actor"}
	query := analytics.Query{
		ProjectID: "series_project", EnvironmentID: "series_env",
		From:     time.Date(2026, 7, 20, 0, 0, 0, 0, time.UTC),
		To:       time.Date(2026, 7, 23, 0, 0, 0, 0, time.UTC),
		Timezone: "UTC", Basis: "event_count",
	}

	filtered := query
	filtered.Platform, filtered.Locale = "ios", "en-US"
	result, err := repository.DailySeries(ctx, actor, filtered,
		[]string{"paywall_presentations", "product_unavailable_rate"})
	if err != nil {
		t.Fatalf("filtered DailySeries: %v", err)
	}

	presentations := map[string]int64{}
	for _, point := range result.Points {
		if point.MetricID != "paywall_presentations" {
			continue
		}
		presentations[point.Date.Format("2006-01-02")] = point.Numerator
	}
	if presentations["2026-07-20"] != 8 {
		t.Errorf("2026-07-20 ios presentations = %d, want the two Paywall Versions summed to 8", presentations["2026-07-20"])
	}
	if presentations["2026-07-21"] != 2 {
		t.Errorf("2026-07-21 ios presentations = %d, want 2", presentations["2026-07-21"])
	}
	if _, present := presentations["2026-07-22"]; present {
		t.Error("a day with no matching rows produced a bucket; the caller must decide what absence means")
	}
	if _, leaked := presentations["2026-07-23"]; leaked {
		t.Error("the day in progress leaked into a completed-day series")
	}

	for _, point := range result.Points {
		if point.MetricID != "product_unavailable_rate" {
			continue
		}
		if point.Date.Format("2006-01-02") != "2026-07-21" {
			t.Errorf("unexpected product availability bucket %s", point.Date)
			continue
		}
		if point.Numerator != 2 || point.Denominator == nil || *point.Denominator != 8 {
			t.Errorf("product_unavailable_rate = %d/%v, want 2 over 8 load attempts", point.Numerator, point.Denominator)
		}
	}

	// The other platform's series must be its own rows and nothing else.
	android := filtered
	android.Platform = "android"
	androidResult, err := repository.DailySeries(ctx, actor, android, []string{"paywall_presentations"})
	if err != nil {
		t.Fatalf("android DailySeries: %v", err)
	}
	if len(androidResult.Points) != 1 || androidResult.Points[0].Numerator != 7 {
		t.Fatalf("android presentations = %#v, want only its own 7", androidResult.Points)
	}

	// The unfiltered path still reads the funnel aggregate, unchanged.
	unfiltered, err := repository.DailySeries(ctx, actor, query, []string{"paywall_presentations"})
	if err != nil {
		t.Fatalf("unfiltered DailySeries: %v", err)
	}
	if len(unfiltered.Points) != 1 || unfiltered.Points[0].Numerator != 15 {
		t.Fatalf("unfiltered presentations = %#v, want the funnel aggregate's 15", unfiltered.Points)
	}

	// A metric the dimensioned aggregate cannot express is refused rather than
	// answered from the undimensioned table under a filtered heading.
	_, err = repository.DailySeries(ctx, actor, filtered, []string{"presentation_to_purchase_start_rate"})
	var unsupported *analytics.UnsupportedDimensionError
	if !errors.As(err, &unsupported) {
		t.Fatalf("filtered correlated rate error = %v, want an unsupported-dimension error", err)
	}
}
