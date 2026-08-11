package projectoverviewpostgres_test

import (
	"testing"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/analytics"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/analyticspostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/projectoverviewpostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/projectoverview"
)

// The series surface repeats the scalar surface's grouping rules across a
// caller-selectable range, and every one of them can break silently once the
// grouping moves into SQL. These tests cover what only PostgreSQL can prove:
//
//   - each row lands in the UTC day its timestamp belongs to, not the day the
//     range happens to start on. A chart shifted by one day is invisible;
//   - a validator restatement is still one provider statement after grouping.
//     GROUP BY with COUNT(*) instead of COUNT(DISTINCT ...) would draw a
//     revalidation backlog as a purchase spike on a single day;
//   - every count is Environment-scoped. A Billing Customer is Project-scoped
//     identity, so a missing predicate charts the sandbox on the production
//     page;
//   - today's analytics point comes from live events and not from the aggregate
//     bucket the aggregation job has not finished. That bucket exists and holds
//     a fraction of the day, so serving it draws a collapse every morning.

// windowOf is the series range the service would derive for a given length.
func windowOf(now time.Time, days int) projectoverview.Window {
	midnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	return projectoverview.Window{
		From:     midnight.Add(-time.Duration(days-1) * 24 * time.Hour),
		To:       now,
		Timezone: "UTC",
	}
}

func dayString(value time.Time) string { return value.UTC().Format("2006-01-02") }

// Customers are grouped into the UTC day Mosaic first learned of them, counted
// only where they hold committed Environment state.
func TestCustomerDailyCountsGroupByUTCDayAndScopeToEnvironment(t *testing.T) {
	f := newFixture(t, "seriescust")
	midnight := time.Date(f.now.Year(), f.now.Month(), f.now.Day(), 0, 0, 0, 0, time.UTC)

	f.customer(t, "bcu_ser_today", midnight.Add(3*time.Hour), f.environment)
	f.customer(t, "bcu_ser_yest_a", midnight.Add(-20*time.Hour), f.environment)
	f.customer(t, "bcu_ser_yest_b", midnight.Add(-time.Second), f.environment)
	f.customer(t, "bcu_ser_three", midnight.Add(-3*24*time.Hour), f.environment)
	// Holds state only in the other Environment, and one that holds none at all.
	f.customer(t, "bcu_ser_other", midnight.Add(2*time.Hour), f.otherEnv)
	f.customer(t, "bcu_ser_nowhere", midnight.Add(2*time.Hour), "")
	// Older than the window.
	f.customer(t, "bcu_ser_ancient", midnight.Add(-30*24*time.Hour), f.environment)

	counts, err := projectoverviewpostgres.New(f.pool).
		CustomerDailyCounts(f.ctx, f.environment, windowOf(f.now, 7))
	if err != nil {
		t.Fatalf("customer daily counts: %v", err)
	}

	byDay := map[string]int64{}
	for _, count := range counts {
		byDay[dayString(count.Day)] = count.Count
	}
	want := map[string]int64{
		dayString(midnight):                      1,
		dayString(midnight.Add(-24 * time.Hour)): 2,
		dayString(midnight.Add(-72 * time.Hour)): 1,
	}
	if len(byDay) != len(want) {
		t.Fatalf("days returned %v, want only the days holding rows %v", byDay, want)
	}
	for date, count := range want {
		if byDay[date] != count {
			t.Fatalf("%s counted %d, want %d (all days: %v)", date, byDay[date], count, byDay)
		}
	}
}

// New subscriptions and trial starts are grouped by UTC day, deduplicated by
// provider transaction identifier within the day, and scoped to the
// Environment.
func TestSubscriptionFactDailyCountsDeduplicateWithinTheDay(t *testing.T) {
	f := newFixture(t, "seriesfact")
	midnight := time.Date(f.now.Year(), f.now.Month(), f.now.Day(), 0, 0, 0, 0, time.UTC)
	today := midnight.Add(2 * time.Hour)
	yesterday := midnight.Add(-22 * time.Hour)
	older := midnight.Add(-4*24*time.Hour + time.Hour)

	f.fact(t, "btf_ser_today", "txn-ser-today", "auto_renewable_subscription", "initial_purchase", today)
	// The same provider statement restated under a second validator: two
	// immutable rows in one day, one purchase.
	f.fact(t, "btf_ser_today_v2", "txn-ser-today", "auto_renewable_subscription", "initial_purchase", today)
	f.fact(t, "btf_ser_yest_a", "txn-ser-yest-a", "auto_renewable_subscription", "initial_purchase", yesterday)
	f.fact(t, "btf_ser_yest_b", "txn-ser-yest-b", "auto_renewable_subscription", "initial_purchase", yesterday)
	f.fact(t, "btf_ser_trial_yest", "txn-ser-trial-yest", "auto_renewable_subscription", "offer_redeemed", yesterday)
	f.fact(t, "btf_ser_older", "txn-ser-older", "auto_renewable_subscription", "initial_purchase", older)
	// Neither a new subscription nor a trial start.
	f.fact(t, "btf_ser_renewal", "txn-ser-renewal", "auto_renewable_subscription", "renewal", today)
	f.fact(t, "btf_ser_lifetime", "txn-ser-lifetime", "non_consumable", "one_time_purchase", today)
	// Another Environment's purchase, which must not appear on this chart.
	f.factIn(t, f.otherEnv, "btf_ser_staging", "txn-ser-staging",
		"auto_renewable_subscription", "initial_purchase", today)

	counts, err := projectoverviewpostgres.New(f.pool).
		SubscriptionFactDailyCounts(f.ctx, f.environment, windowOf(f.now, 7))
	if err != nil {
		t.Fatalf("subscription fact daily counts: %v", err)
	}

	byDay := map[string]projectoverview.DailyFactCounts{}
	for _, count := range counts {
		byDay[dayString(count.Day)] = count
	}
	if len(byDay) != 3 {
		t.Fatalf("days returned %v, want only the three days holding rows", byDay)
	}
	if got := byDay[dayString(midnight)]; got.InitialPurchases != 1 || got.TrialStarts != 0 {
		t.Fatalf("today %+v, want 1 purchase and 0 trials (the restatement is the same purchase)", got)
	}
	if got := byDay[dayString(midnight.Add(-24*time.Hour))]; got.InitialPurchases != 2 || got.TrialStarts != 1 {
		t.Fatalf("yesterday %+v, want 2 purchases and 1 trial", got)
	}
	if got := byDay[dayString(midnight.Add(-96*time.Hour))]; got.InitialPurchases != 1 {
		t.Fatalf("four days ago %+v, want 1 purchase", got)
	}
}

// The composed series reads completed days from the daily aggregates and today
// from raw events, and reports a day with no denominator as no rate rather than
// as zero.
//
// This is the assertion that needs the real analytics repository: the range
// arithmetic that decides which storage a day is served from lives there, and
// the failure it protects against — serving today's half-built bucket as a
// completed day — looks like a working chart.
func TestOverviewSeriesReadsHistoryFromAggregatesAndTodayLive(t *testing.T) {
	f := newFixture(t, "seriesfunnel")
	f.exec(t, `UPDATE analytics_environment_settings SET collection_enabled=true WHERE environment_id=$1`,
		f.environment)
	midnight := time.Date(f.now.Year(), f.now.Month(), f.now.Day(), 0, 0, 0, 0, time.UTC)
	yesterday := midnight.Add(-24 * time.Hour)
	twoDaysAgo := midnight.Add(-48 * time.Hour)

	f.funnelBucket(t, f.environment, yesterday, "paywall_presentations", 20, nil)
	f.funnelBucket(t, f.environment, yesterday, "client_completed_purchases", 4, nil)
	f.funnelBucket(t, f.environment, yesterday, "presentation_to_client_completed_purchase_rate", 5, int64(20))
	f.funnelBucket(t, f.environment, twoDaysAgo, "paywall_presentations", 9, nil)
	// A poisoned, half-built bucket for the day in progress. No analytics event
	// rows exist, so the only way today can report anything but zero is by
	// reading this bucket — which is what must not happen.
	f.funnelBucket(t, f.environment, midnight, "paywall_presentations", 999, nil)
	f.funnelBucket(t, f.environment, midnight, "presentation_to_client_completed_purchase_rate", 500, int64(999))
	// Another Environment's completed day, which must not leak in.
	f.funnelBucket(t, f.otherEnv, yesterday, "paywall_presentations", 777, nil)

	f.customer(t, "bcu_serfun_yest", yesterday.Add(4*time.Hour), f.environment)

	service := projectoverview.NewService(
		projectoverviewpostgres.New(f.pool),
		analytics.NewService(analyticspostgres.New(f.pool), nil),
	).WithClock(func() time.Time { return f.now })

	result, err := service.OverviewSeries(f.ctx, projectoverview.Actor{ID: f.ownerActor},
		f.project, f.environment, 7)
	if err != nil {
		t.Fatalf("overview series: %v", err)
	}
	if result.Days != 7 || len(result.Metrics.PaywallViews.Points) != 7 {
		t.Fatalf("days %d with %d points, want 7 of each",
			result.Days, len(result.Metrics.PaywallViews.Points))
	}

	points := map[string]projectoverview.SeriesPoint{}
	for _, point := range result.Metrics.PaywallViews.Points {
		points[point.Date] = point
	}
	if got := points[dayString(yesterday)]; got.Value == nil || *got.Value != 20 || got.Partial {
		t.Fatalf("yesterday's paywall views %+v, want a complete 20", got)
	}
	if got := points[dayString(twoDaysAgo)]; got.Value == nil || *got.Value != 9 {
		t.Fatalf("two days ago paywall views %+v, want 9", got)
	}
	today := points[dayString(midnight)]
	if today.Value == nil || *today.Value != 0 {
		t.Fatalf("today's paywall views %+v, want the live zero rather than the half-built bucket", today)
	}
	if !today.Partial {
		t.Fatal("today's point is not marked partial")
	}
	// A day inside the window with no rows at all is an explicit zero.
	if got := points[dayString(midnight.Add(-120*time.Hour))]; got.Value == nil || *got.Value != 0 {
		t.Fatalf("a day with no data is %+v, want an explicit zero", got)
	}

	rates := map[string]*float64{}
	for _, point := range result.Metrics.ConversionRate.Points {
		rates[point.Date] = point.Value
	}
	if rate := rates[dayString(yesterday)]; rate == nil || *rate != 0.25 {
		t.Fatalf("yesterday's conversion rate %v, want 0.25", rate)
	}
	if rate, ok := rates[dayString(twoDaysAgo)]; !ok || rate != nil {
		t.Fatalf("a day with no denominator has rate %v, want null rather than 0%%", rate)
	}
	if rate, ok := rates[dayString(midnight)]; !ok || rate != nil {
		t.Fatalf("today's rate is %v with no presentations recorded, want null", rate)
	}

	// Billing series come from live facts and pointers, so the same window is
	// answered whether or not the aggregation job has run.
	customers := map[string]*float64{}
	for _, point := range result.Metrics.NewCustomers.Points {
		customers[point.Date] = point.Value
	}
	if value := customers[dayString(yesterday)]; value == nil || *value != 1 {
		t.Fatalf("yesterday's new customers %v, want 1", value)
	}
	if value := customers[dayString(midnight)]; value == nil || *value != 0 {
		t.Fatalf("today's new customers %v, want an explicit zero", value)
	}
	if result.AnalyticsFreshness == nil {
		t.Fatal("analytics freshness is absent from a successful read")
	}
}
