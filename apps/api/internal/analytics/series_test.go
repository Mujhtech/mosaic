package analytics

import (
	"context"
	"errors"
	"testing"
	"time"
)

// seriesRepository records what the daily-series read asked of persistence and
// answers with fixed buckets. The embedded interface leaves every other method
// unimplemented on purpose: reaching one from this path would panic loudly
// rather than quietly succeed.
type seriesRepository struct {
	Repository
	enabled bool

	historyQuery  Query
	historyIDs    []string
	historyPoints []DailyMetricPoint
	historyError  error

	liveQuery   Query
	liveCalls   int
	liveMetrics []Metric
}

func (r *seriesRepository) SettingsForActor(context.Context, Actor, string, string) (Settings, error) {
	return Settings{CollectionEnabled: r.enabled}, nil
}

func (r *seriesRepository) DailySeries(_ context.Context, _ Actor, query Query, ids []string) (DailySeriesResult, error) {
	r.historyQuery, r.historyIDs = query, ids
	if r.historyError != nil {
		return DailySeriesResult{}, r.historyError
	}
	return DailySeriesResult{Points: r.historyPoints, Freshness: Freshness{LateEventPolicy: LateEventPolicy}}, nil
}

func (r *seriesRepository) Query(_ context.Context, _ Actor, query Query, _ []string) (AnalyticsResult, error) {
	r.liveQuery = query
	r.liveCalls++
	return AnalyticsResult{Metrics: r.liveMetrics}, nil
}

const seriesTestNow = "2026-08-05T09:30:00Z"

func seriesTestService(repository *seriesRepository) *Service {
	service := NewService(repository, nil)
	service.now = func() time.Time {
		instant, _ := time.Parse(time.RFC3339, seriesTestNow)
		return instant
	}
	return service
}

func seriesTestQuery() Query {
	return Query{ProjectID: "project_1", EnvironmentID: "environment_1", Timezone: "UTC", Basis: "event_count"}
}

func day(value string) time.Time {
	parsed, _ := time.Parse("2006-01-02", value)
	return parsed
}

func metricValue(t *testing.T, result SeriesResult, metricID, date string) *float64 {
	t.Helper()
	for _, series := range result.Series {
		if series.MetricID != metricID {
			continue
		}
		for _, point := range series.Points {
			if point.Date == date {
				return point.Value
			}
		}
		t.Fatalf("metric %s has no point for %s", metricID, date)
	}
	t.Fatalf("result carries no series for %s", metricID)
	return nil
}

// A filter the caller set must reach persistence on both halves of the series.
// The completed days and the day in progress are read through different
// statements, and a filter applied to only one of them produces a chart whose
// last column measures a different population than the rest of the line —
// which is invisible in the response.
func TestSeriesCarriesTheRequestedFilterIntoBothReads(t *testing.T) {
	repository := &seriesRepository{enabled: true}
	query := seriesTestQuery()
	query.Platform, query.Locale, query.ApplicationVersion = "ios", "en-US", "4.2.0"

	if _, err := seriesTestService(repository).Series(t.Context(), Actor{ID: "actor_1"},
		query, []string{"paywall_presentations"}, 7); err != nil {
		t.Fatalf("Series: %v", err)
	}

	if repository.historyQuery.Platform != "ios" || repository.historyQuery.Locale != "en-US" ||
		repository.historyQuery.ApplicationVersion != "4.2.0" {
		t.Fatalf("completed-day read dropped a filter: %+v", repository.historyQuery)
	}
	if repository.liveQuery.Platform != "ios" || repository.liveQuery.Locale != "en-US" ||
		repository.liveQuery.ApplicationVersion != "4.2.0" {
		t.Fatalf("today's live read dropped a filter: %+v", repository.liveQuery)
	}
	// The two reads must not overlap: today belongs to the live read alone,
	// because its aggregate bucket is half-built.
	if !repository.historyQuery.To.Equal(day("2026-08-05")) {
		t.Fatalf("completed-day read ended at %s, want today's midnight", repository.historyQuery.To)
	}
	if !repository.liveQuery.From.Equal(day("2026-08-05")) {
		t.Fatalf("live read started at %s, want today's midnight", repository.liveQuery.From)
	}
}

// A filter the daily aggregates cannot honour must be refused by name. The
// aggregation writes no dimension columns for the correlated funnel metrics, so
// serving one under a platform filter would answer with every platform's
// numbers under a heading that says otherwise.
func TestSeriesRefusesAFilterTheAggregateCannotHonour(t *testing.T) {
	repository := &seriesRepository{enabled: true}
	query := seriesTestQuery()
	query.Platform = "ios"

	_, err := seriesTestService(repository).Series(t.Context(), Actor{ID: "actor_1"}, query,
		[]string{"paywall_presentations", "presentation_to_purchase_start_rate"}, 7)

	var unsupported *UnsupportedDimensionError
	if !errors.As(err, &unsupported) {
		t.Fatalf("Series error = %v, want an unsupported-dimension error", err)
	}
	if unsupported.Dimension != "platform" {
		t.Fatalf("error names dimension %q, want platform", unsupported.Dimension)
	}
	if len(unsupported.MetricIDs) != 1 || unsupported.MetricIDs[0] != "presentation_to_purchase_start_rate" {
		t.Fatalf("error names metrics %v, want only the correlated rate", unsupported.MetricIDs)
	}
	if repository.liveCalls != 0 {
		t.Fatal("the request was refused but persistence was read anyway")
	}
}

// Today's point comes from the live read, is marked partial, and is the only
// point that is. A chart whose last column silently mixes a few hours with
// completed days reads as a collapse every morning.
func TestSeriesReadsTodayLiveAndMarksItPartial(t *testing.T) {
	presentations := float64(4)
	repository := &seriesRepository{
		enabled: true,
		historyPoints: []DailyMetricPoint{
			{Date: day("2026-08-04"), MetricID: "paywall_presentations", Numerator: 11},
		},
		liveMetrics: []Metric{{ID: "paywall_presentations", Numerator: 4, Value: &presentations}},
	}

	result, err := seriesTestService(repository).Series(t.Context(), Actor{ID: "actor_1"},
		seriesTestQuery(), []string{"paywall_presentations"}, 7)
	if err != nil {
		t.Fatalf("Series: %v", err)
	}

	if result.Days != 7 || len(result.Series) != 1 || len(result.Series[0].Points) != 7 {
		t.Fatalf("unexpected series shape: %+v", result)
	}
	points := result.Series[0].Points
	for _, point := range points[:len(points)-1] {
		if point.Partial {
			t.Fatalf("completed day %s is marked partial", point.Date)
		}
	}
	last := points[len(points)-1]
	if last.Date != "2026-08-05" || !last.Partial {
		t.Fatalf("last point = %+v, want today marked partial", last)
	}
	if last.Value == nil || *last.Value != 4 {
		t.Fatalf("today's value = %v, want the live count", last.Value)
	}
	if value := metricValue(t, result, "paywall_presentations", "2026-08-04"); value == nil || *value != 11 {
		t.Fatalf("yesterday's value = %v, want the aggregate count", value)
	}
}

// The null-versus-zero rule, which is the whole reason numerators and
// denominators travel to this layer instead of a value computed in SQL. A count
// with no rows is a measured zero; a rate with no denominator was not measured
// at all, and reporting 0% there draws a conversion collapse on a day nobody
// opened the app.
func TestSeriesDistinguishesAMeasuredZeroFromAnUnmeasuredRate(t *testing.T) {
	zero := int64(0)
	presentations := int64(20)
	repository := &seriesRepository{
		enabled: true,
		historyPoints: []DailyMetricPoint{
			{Date: day("2026-08-03"), MetricID: "presentation_to_purchase_start_rate", Numerator: 5, Denominator: &presentations},
			{Date: day("2026-08-04"), MetricID: "presentation_to_purchase_start_rate", Numerator: 0, Denominator: &zero},
		},
	}

	result, err := seriesTestService(repository).Series(t.Context(), Actor{ID: "actor_1"}, seriesTestQuery(),
		[]string{"paywall_presentations", "presentation_to_purchase_start_rate"}, 7)
	if err != nil {
		t.Fatalf("Series: %v", err)
	}

	if value := metricValue(t, result, "presentation_to_purchase_start_rate", "2026-08-03"); value == nil || *value != 0.25 {
		t.Fatalf("measured rate = %v, want 0.25", value)
	}
	if value := metricValue(t, result, "presentation_to_purchase_start_rate", "2026-08-04"); value != nil {
		t.Fatalf("rate with a zero denominator = %v, want null", *value)
	}
	if value := metricValue(t, result, "presentation_to_purchase_start_rate", "2026-08-01"); value != nil {
		t.Fatalf("rate with no bucket at all = %v, want null", *value)
	}
	if value := metricValue(t, result, "paywall_presentations", "2026-08-01"); value == nil || *value != 0 {
		t.Fatalf("count with no bucket = %v, want an explicit zero", value)
	}
}

// A metric Mosaic declares but does not compute is served as an unavailable
// series rather than as a flat line of zeros, matching the warning the summed
// query attaches to it, and it is never read from persistence.
func TestSeriesReportsAnUncomputedMetricAsUnavailable(t *testing.T) {
	repository := &seriesRepository{enabled: true}

	result, err := seriesTestService(repository).Series(t.Context(), Actor{ID: "actor_1"}, seriesTestQuery(),
		[]string{"provider_confirmed_purchases"}, 7)
	if err != nil {
		t.Fatalf("Series: %v", err)
	}

	series := result.Series[0]
	if series.Available || series.Reason != ReasonProviderConfirmedUnavailable || len(series.Points) != 0 {
		t.Fatalf("uncomputed metric served as %+v", series)
	}
	if len(repository.historyIDs) != 0 {
		t.Fatalf("uncomputed metric was read from persistence: %v", repository.historyIDs)
	}
}

// A chart of an Environment that is not collecting is a flat line, not a
// measurement. It takes the same code the rest of the analytics surface uses
// for a disabled Environment.
func TestSeriesRefusesADisabledEnvironment(t *testing.T) {
	repository := &seriesRepository{enabled: false}

	_, err := seriesTestService(repository).Series(t.Context(), Actor{ID: "actor_1"}, seriesTestQuery(),
		[]string{"paywall_presentations"}, 7)

	if !errors.Is(err, ErrCollectionDisabled) {
		t.Fatalf("Series error = %v, want ErrCollectionDisabled", err)
	}
}
