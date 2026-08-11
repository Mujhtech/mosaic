package projectoverview_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/analytics"
	"github.com/Mujhtech/mosaic/apps/api/internal/projectoverview"
)

// These tests protect the properties that make the overview chart readable
// rather than merely populated. Every failure they catch draws a plausible
// picture of the product that is not true:
//
//   - a source that could not be read, or a configuration that produces no
//     numbers, becoming a flat line at zero rather than an absent series;
//   - a rate with no denominator drawn as a conversion collapse to 0%;
//   - a day with no purchases becoming a hole in a bar chart instead of a zero;
//   - today's column drawn as a completed day, so the chart appears to fall off
//     a cliff every morning;
//   - a caller-supplied length reaching the database unclamped.
//
// The SQL behind the ports is covered once, against PostgreSQL, in
// platform/projectoverviewpostgres.

func readSeries(t *testing.T, service *projectoverview.Service, days int) projectoverview.OverviewSeries {
	t.Helper()
	result, err := service.OverviewSeries(context.Background(), testActor, testProject, testEnvironment, days)
	if err != nil {
		t.Fatalf("overview series: %v", err)
	}
	return result
}

func requireUnavailableSeries(t *testing.T, name string, series projectoverview.Series, reason string) {
	t.Helper()
	if series.Available {
		t.Fatalf("%s is available; want unavailable", name)
	}
	if len(series.Points) != 0 {
		t.Fatalf("%s carries %d points; an unavailable series must carry none", name, len(series.Points))
	}
	if series.Reason != reason {
		t.Fatalf("%s reason %q, want %q", name, series.Reason, reason)
	}
}

func pointValue(t *testing.T, name string, series projectoverview.Series, date string) *float64 {
	t.Helper()
	for _, point := range series.Points {
		if point.Date == date {
			return point.Value
		}
	}
	t.Fatalf("%s has no point for %s", name, date)
	return nil
}

func requirePoint(t *testing.T, name string, series projectoverview.Series, date string, want float64) {
	t.Helper()
	value := pointValue(t, name, series, date)
	if value == nil {
		t.Fatalf("%s point %s is null, want %v", name, date, want)
	}
	if *value != want {
		t.Fatalf("%s point %s is %v, want %v", name, date, *value, want)
	}
}

func requireNullPoint(t *testing.T, name string, series projectoverview.Series, date string) {
	t.Helper()
	if value := pointValue(t, name, series, date); value != nil {
		t.Fatalf("%s point %s is %v, want null", name, date, *value)
	}
}

func day(year int, month time.Month, dayOfMonth int) time.Time {
	return time.Date(year, month, dayOfMonth, 0, 0, 0, 0, time.UTC)
}

// Risk: a caller-chosen length reaches the database unclamped, or an omitted one
// is read as zero days and returns an empty chart. The clamped length must also
// be the one the response reports, so the dashboard can label its own axis.
func TestSeriesLengthIsClampedServerSideAndEchoed(t *testing.T) {
	now := time.Date(2026, 8, 4, 9, 0, 0, 0, time.UTC)
	for _, testCase := range []struct{ requested, want int }{
		{requested: 0, want: 30},
		{requested: -5, want: 30},
		{requested: 1, want: 7},
		{requested: 45, want: 45},
		{requested: 5000, want: 90},
	} {
		repository := &stubRepository{enabled: true}
		analyticsReader := &stubAnalytics{collectionEnabled: true, values: map[string]float64{}}
		result := readSeries(t, newService(t, repository, analyticsReader, now), testCase.requested)

		if result.Days != testCase.want {
			t.Fatalf("days for request %d is %d, want %d", testCase.requested, result.Days, testCase.want)
		}
		if got := len(result.Metrics.NewCustomers.Points); got != testCase.want {
			t.Fatalf("newCustomers points for request %d is %d, want %d", testCase.requested, got, testCase.want)
		}
		// The window the response declares is also the window the billing sources
		// were asked for; asserting only the response would let the two drift.
		wantFrom := day(2026, 8, 4).Add(-time.Duration(testCase.want-1) * 24 * time.Hour)
		if !result.Window.From.Equal(wantFrom) || !result.Window.To.Equal(now) || result.Window.Timezone != "UTC" {
			t.Fatalf("window %v..%v (%s), want %v..%v UTC",
				result.Window.From, result.Window.To, result.Window.Timezone, wantFrom, now)
		}
		for _, window := range repository.dailyWindows {
			if window != result.Window {
				t.Fatalf("a billing source was asked for %v..%v, not the declared window",
					window.From, window.To)
			}
		}
	}
}

// Risk: today's column is drawn from the daily aggregate bucket the aggregation
// job has not finished, so the chart appears to collapse every morning and
// recover overnight. Today must be read live and be the only point flagged
// partial.
func TestTodayIsReadLiveAndIsTheOnlyPartialPoint(t *testing.T) {
	now := time.Date(2026, 8, 4, 9, 0, 0, 0, time.UTC)
	repository := &stubRepository{enabled: true}
	analyticsReader := &stubAnalytics{
		collectionEnabled: true,
		values:            map[string]float64{"paywall_presentations": 11},
		dailyPoints: []analytics.DailyMetricPoint{
			{Date: day(2026, 8, 3), MetricID: "paywall_presentations", Numerator: 40},
			// A half-built bucket for today. Reading it would be the bug.
			{Date: day(2026, 8, 4), MetricID: "paywall_presentations", Numerator: 999},
		},
	}
	result := readSeries(t, newService(t, repository, analyticsReader, now), 7)

	requirePoint(t, "paywallViews", result.Metrics.PaywallViews, "2026-08-03", 40)
	requirePoint(t, "paywallViews", result.Metrics.PaywallViews, "2026-08-04", 11)

	// The aggregate read must stop at today's midnight, and the live read must
	// cover only the day so far.
	if len(analyticsReader.seriesQueries) != 1 {
		t.Fatalf("aggregate reads %d, want exactly one grouped read", len(analyticsReader.seriesQueries))
	}
	if !analyticsReader.seriesQueries[0].To.Equal(day(2026, 8, 4)) {
		t.Fatalf("aggregate read ends at %v, want today's midnight", analyticsReader.seriesQueries[0].To)
	}
	if len(analyticsReader.queries) != 1 || !analyticsReader.queries[0].From.Equal(day(2026, 8, 4)) ||
		!analyticsReader.queries[0].To.Equal(now) {
		t.Fatalf("live reads %v, want one covering today so far", analyticsReader.queries)
	}

	for _, series := range map[string]projectoverview.Series{
		"paywallViews":  result.Metrics.PaywallViews,
		"newCustomers":  result.Metrics.NewCustomers,
		"trialsStarted": result.Metrics.TrialsStarted,
	} {
		for _, point := range series.Points {
			if point.Partial != (point.Date == "2026-08-04") {
				t.Fatalf("point %s partial=%v; only today may be partial", point.Date, point.Partial)
			}
		}
	}
}

// Risk: a day nobody opened the app is drawn as a 0% conversion rate, which
// reads as a paywall that stopped working. A rate with no denominator has no
// value; a count with no rows is a real zero. The two must not be conflated.
func TestConversionRateIsNullWithoutADenominatorWhileCountsAreZero(t *testing.T) {
	now := time.Date(2026, 8, 4, 9, 0, 0, 0, time.UTC)
	denominator := int64(20)
	zeroDenominator := int64(0)
	repository := &stubRepository{enabled: true}
	analyticsReader := &stubAnalytics{
		collectionEnabled: true,
		// Today saw no presentations at all: the live read returns a zero
		// denominator, which is not a measured rate.
		values:       map[string]float64{},
		denominators: map[string]int64{"presentation_to_client_completed_purchase_rate": 0},
		dailyPoints: []analytics.DailyMetricPoint{
			{Date: day(2026, 8, 3), MetricID: "presentation_to_client_completed_purchase_rate",
				Numerator: 5, Denominator: &denominator},
			{Date: day(2026, 8, 2), MetricID: "presentation_to_client_completed_purchase_rate",
				Numerator: 0, Denominator: &zeroDenominator},
			{Date: day(2026, 8, 3), MetricID: "client_completed_purchases", Numerator: 5},
		},
	}
	result := readSeries(t, newService(t, repository, analyticsReader, now), 7)

	requirePoint(t, "conversionRate", result.Metrics.ConversionRate, "2026-08-03", 0.25)
	// A day with a zero denominator, a day with no aggregate row at all, and
	// today's zero-denominator live read are all "not measured".
	requireNullPoint(t, "conversionRate", result.Metrics.ConversionRate, "2026-08-02")
	requireNullPoint(t, "conversionRate", result.Metrics.ConversionRate, "2026-08-01")
	requireNullPoint(t, "conversionRate", result.Metrics.ConversionRate, "2026-08-04")

	// Counts over the same days are explicit zeros: nobody bought anything is a
	// measurement, and a hole in a bar chart is not.
	requirePoint(t, "purchases", result.Metrics.Purchases, "2026-08-03", 5)
	requirePoint(t, "purchases", result.Metrics.Purchases, "2026-08-01", 0)
	requirePoint(t, "purchases", result.Metrics.Purchases, "2026-08-04", 0)
}

// Risk: the tri-state is applied per point rather than per series, so a disabled
// integration or an unreadable source draws a flat line at zero. Each half must
// fail independently, and with the codes the dashboard already maps.
func TestSeriesTriStateIsPerSeriesAndPerSource(t *testing.T) {
	now := time.Date(2026, 8, 4, 9, 0, 0, 0, time.UTC)

	t.Run("billing disabled", func(t *testing.T) {
		repository := &stubRepository{enabled: false}
		analyticsReader := &stubAnalytics{collectionEnabled: true, values: map[string]float64{}}
		result := readSeries(t, newService(t, repository, analyticsReader, now), 7)

		for name, series := range map[string]projectoverview.Series{
			"newCustomers":     result.Metrics.NewCustomers,
			"newSubscriptions": result.Metrics.NewSubscriptions,
			"trialsStarted":    result.Metrics.TrialsStarted,
		} {
			requireUnavailableSeries(t, name, series, projectoverview.ReasonBillingDisabled)
		}
		if !result.Metrics.PaywallViews.Available {
			t.Fatal("the analytics series stopped answering because billing is off")
		}
	})

	t.Run("analytics collection disabled", func(t *testing.T) {
		repository := &stubRepository{
			enabled:        true,
			dailyCustomers: []projectoverview.DailyCount{{Day: day(2026, 8, 3), Count: 4}},
		}
		analyticsReader := &stubAnalytics{collectionEnabled: false}
		result := readSeries(t, newService(t, repository, analyticsReader, now), 7)

		for name, series := range map[string]projectoverview.Series{
			"paywallViews":   result.Metrics.PaywallViews,
			"purchaseStarts": result.Metrics.PurchaseStarts,
			"purchases":      result.Metrics.Purchases,
			"conversionRate": result.Metrics.ConversionRate,
		} {
			requireUnavailableSeries(t, name, series, projectoverview.ReasonAnalyticsCollectionDisabled)
		}
		requirePoint(t, "newCustomers", result.Metrics.NewCustomers, "2026-08-03", 4)
		if result.AnalyticsFreshness != nil {
			t.Fatal("freshness is present while every analytics series is unavailable")
		}
	})

	t.Run("one billing source fails", func(t *testing.T) {
		repository := &stubRepository{
			enabled:        true,
			dailyCustomers: []projectoverview.DailyCount{{Day: day(2026, 8, 3), Count: 4}},
			dailyFactsErr:  errors.New("statement timeout"),
		}
		analyticsReader := &stubAnalytics{collectionEnabled: true, values: map[string]float64{}}
		result := readSeries(t, newService(t, repository, analyticsReader, now), 7)

		requireUnavailableSeries(t, "newSubscriptions", result.Metrics.NewSubscriptions,
			projectoverview.ReasonMetricUnavailable)
		requireUnavailableSeries(t, "trialsStarted", result.Metrics.TrialsStarted,
			projectoverview.ReasonMetricUnavailable)
		requirePoint(t, "newCustomers", result.Metrics.NewCustomers, "2026-08-03", 4)
		if !result.Metrics.PaywallViews.Available {
			t.Fatal("the analytics series stopped answering because a billing source failed")
		}
	})

	t.Run("the aggregate read fails", func(t *testing.T) {
		repository := &stubRepository{enabled: true}
		analyticsReader := &stubAnalytics{
			collectionEnabled: true,
			values:            map[string]float64{"paywall_presentations": 11},
			dailySeriesErr:    errors.New("statement timeout"),
		}
		result := readSeries(t, newService(t, repository, analyticsReader, now), 7)

		// A chart missing its interior days reads as a collapse, not as a gap, so
		// the whole line is withdrawn rather than drawn from today alone.
		for name, series := range map[string]projectoverview.Series{
			"paywallViews":   result.Metrics.PaywallViews,
			"conversionRate": result.Metrics.ConversionRate,
		} {
			requireUnavailableSeries(t, name, series, projectoverview.ReasonMetricUnavailable)
		}
		if result.AnalyticsFreshness != nil {
			t.Fatal("a watermark is published beside unavailable series; it reads as merely stale data")
		}
		if !result.Metrics.NewCustomers.Available {
			t.Fatal("the billing series stopped answering because the analytics read failed")
		}
	})
}

// Risk: an authorization failure is absorbed into the per-series tri-state and
// the chart endpoint answers 200 to a caller who may not read the scope.
func TestSeriesAuthorizationFailureStopsTheResponse(t *testing.T) {
	repository := &stubRepository{authorizeErr: projectoverview.ErrForbidden, enabled: true}
	service := newService(t, repository, &stubAnalytics{collectionEnabled: true},
		time.Date(2026, 8, 4, 9, 0, 0, 0, time.UTC))

	if _, err := service.OverviewSeries(context.Background(), testActor, testProject, testEnvironment, 30); !errors.Is(err, projectoverview.ErrForbidden) {
		t.Fatalf("error %v, want ErrForbidden", err)
	}
}
