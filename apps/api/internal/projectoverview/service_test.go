package projectoverview_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/analytics"
	"github.com/Mujhtech/mosaic/apps/api/internal/projectoverview"
)

// These tests protect the one property this surface exists to hold: a number
// the dashboard shows is either measured or is explicitly marked as not
// measured, and never silently zero.
//
// The realistic failures are all the same shape and all invisible at a glance —
// billing turned off, analytics collection turned off, and one source erroring
// while the others answer would each render as "0 customers, 0 subscriptions,
// 0 purchases" if the composition were wrong, which reads as a working page
// reporting a dead product. The window arithmetic is tested alongside them
// because a wrong "today" is the other way this surface lies while looking fine.
//
// The composition is a pure function of its ports, so these are unit tests with
// stub ports; the SQL behind the ports is covered once, against PostgreSQL, in
// platform/projectoverviewpostgres.

type stubRepository struct {
	authorizeErr error
	enabled      bool
	enabledErr   error

	customers    projectoverview.CustomerCounts
	customersErr error
	states       projectoverview.SubscriptionStateCounts
	statesErr    error
	facts        projectoverview.SubscriptionFactCounts
	factsErr     error

	customerWindows projectoverview.Windows
	factWindows     projectoverview.Windows

	dailyCustomers    []projectoverview.DailyCount
	dailyCustomersErr error
	dailyFacts        []projectoverview.DailyFactCounts
	dailyFactsErr     error
	dailyWindows      []projectoverview.Window
}

func (s *stubRepository) Authorize(context.Context, projectoverview.Actor, string, string) error {
	return s.authorizeErr
}

func (s *stubRepository) BillingEnabled(context.Context, string) (bool, error) {
	return s.enabled, s.enabledErr
}

func (s *stubRepository) CustomerCounts(_ context.Context, _ string, windows projectoverview.Windows) (
	projectoverview.CustomerCounts, error) {
	s.customerWindows = windows
	return s.customers, s.customersErr
}

func (s *stubRepository) SubscriptionStateCounts(context.Context, string) (
	projectoverview.SubscriptionStateCounts, error) {
	return s.states, s.statesErr
}

func (s *stubRepository) SubscriptionFactCounts(_ context.Context, _ string, windows projectoverview.Windows) (
	projectoverview.SubscriptionFactCounts, error) {
	s.factWindows = windows
	return s.facts, s.factsErr
}

func (s *stubRepository) CustomerDailyCounts(_ context.Context, _ string, window projectoverview.Window) (
	[]projectoverview.DailyCount, error) {
	s.dailyWindows = append(s.dailyWindows, window)
	return s.dailyCustomers, s.dailyCustomersErr
}

func (s *stubRepository) SubscriptionFactDailyCounts(_ context.Context, _ string, window projectoverview.Window) (
	[]projectoverview.DailyFactCounts, error) {
	s.dailyWindows = append(s.dailyWindows, window)
	return s.dailyFacts, s.dailyFactsErr
}

type stubAnalytics struct {
	collectionEnabled bool
	settingsErr       error
	queryErr          error
	values            map[string]float64
	// omit names a metric the analytics module answers without a value, which
	// is what its provider-confirmed metrics do today.
	omit      string
	queries   []analytics.Query
	watermark time.Time

	// denominators lets a series test give a live metric a denominator, which is
	// what decides whether a rate has a value at all.
	denominators   map[string]int64
	dailyPoints    []analytics.DailyMetricPoint
	dailySeriesErr error
	seriesQueries  []analytics.Query
}

func (s *stubAnalytics) Settings(context.Context, analytics.Actor, string, string) (analytics.Settings, error) {
	if s.settingsErr != nil {
		return analytics.Settings{}, s.settingsErr
	}
	return analytics.Settings{CollectionEnabled: s.collectionEnabled}, nil
}

func (s *stubAnalytics) Query(_ context.Context, _ analytics.Actor, query analytics.Query, metricIDs []string) (
	analytics.AnalyticsResult, error) {
	s.queries = append(s.queries, query)
	if s.queryErr != nil {
		return analytics.AnalyticsResult{}, s.queryErr
	}
	result := analytics.AnalyticsResult{
		Freshness: analytics.Freshness{LatestAggregatedAt: &s.watermark},
	}
	for _, id := range metricIDs {
		metric := analytics.Metric{ID: id}
		if id != s.omit {
			value := s.values[id]
			metric.Value = &value
			metric.Numerator = int64(value)
			if denominator, ok := s.denominators[id]; ok {
				metric.Denominator = &denominator
				metric.Numerator = int64(value * float64(denominator))
			}
		}
		result.Metrics = append(result.Metrics, metric)
	}
	return result, nil
}

func (s *stubAnalytics) DailySeries(_ context.Context, _ analytics.Actor, query analytics.Query,
	_ []string) (analytics.DailySeriesResult, error) {
	s.seriesQueries = append(s.seriesQueries, query)
	if s.dailySeriesErr != nil {
		return analytics.DailySeriesResult{}, s.dailySeriesErr
	}
	return analytics.DailySeriesResult{
		Points:    s.dailyPoints,
		Freshness: analytics.Freshness{LatestAggregatedAt: &s.watermark},
	}, nil
}

const (
	testProject     = "proj_overview"
	testEnvironment = "env_overview"
)

var testActor = projectoverview.Actor{ID: "actor_overview"}

func newService(t *testing.T, repository *stubRepository, analyticsReader *stubAnalytics,
	now time.Time) *projectoverview.Service {
	t.Helper()
	return projectoverview.NewService(repository, analyticsReader).
		WithClock(func() time.Time { return now })
}

func read(t *testing.T, service *projectoverview.Service) projectoverview.Overview {
	t.Helper()
	result, err := service.Overview(context.Background(), testActor, testProject, testEnvironment)
	if err != nil {
		t.Fatalf("overview: %v", err)
	}
	return result
}

func requireUnavailable(t *testing.T, name string, metric projectoverview.Metric, reason string) {
	t.Helper()
	if metric.Available {
		t.Fatalf("%s is available; want unavailable", name)
	}
	if metric.Value != nil {
		t.Fatalf("%s carries value %v; an unavailable metric must never carry one", name, *metric.Value)
	}
	if metric.Reason != reason {
		t.Fatalf("%s reason %q, want %q", name, metric.Reason, reason)
	}
}

func requireValue(t *testing.T, name string, metric projectoverview.Metric, want float64) {
	t.Helper()
	if !metric.Available {
		t.Fatalf("%s is unavailable (reason %q); want value %v", name, metric.Reason, want)
	}
	if metric.Value == nil || *metric.Value != want {
		t.Fatalf("%s value %v, want %v", name, metric.Value, want)
	}
}

// Risk: a Project with billing turned off renders as a product with zero
// customers and zero subscriptions. The analytics half must keep answering,
// because the funnel does not depend on billing at all.
func TestBillingDisabledReportsUnavailableNotZero(t *testing.T) {
	repository := &stubRepository{enabled: false}
	analyticsReader := &stubAnalytics{collectionEnabled: true, values: map[string]float64{
		"paywall_presentations": 12, "purchase_starts": 5,
		"client_completed_purchases": 3, "presentation_to_client_completed_purchase_rate": 0.25,
	}}
	result := read(t, newService(t, repository, analyticsReader, time.Date(2026, 8, 4, 9, 0, 0, 0, time.UTC)))

	for name, metric := range map[string]projectoverview.Metric{
		"customers.total":        result.Metrics.Customers.Total,
		"customers.newToday":     result.Metrics.Customers.NewToday,
		"subscriptions.active":   result.Metrics.Subscriptions.Active,
		"subscriptions.newToday": result.Metrics.Subscriptions.NewToday,
		"trials.active":          result.Metrics.Trials.Active,
		"trials.startedToday":    result.Metrics.Trials.StartedToday,
		"billingRetry.active":    result.Metrics.BillingRetry.Active,
		"gracePeriod.active":     result.Metrics.GracePeriod.Active,
	} {
		requireUnavailable(t, name, metric, projectoverview.ReasonBillingDisabled)
	}
	requireValue(t, "paywallViews.today", result.Metrics.PaywallViews.Today, 12)
	requireValue(t, "conversionRate.today", result.Metrics.ConversionRate.Today, 0.25)
}

// Risk: an unreadable billing setting quietly re-enables a Project that asked
// Mosaic to hold no billing state, or — worse for this surface — reports its
// counts as zero. The fail-closed rule every other billing surface follows must
// hold here too.
func TestUnreadableBillingSettingFailsClosed(t *testing.T) {
	repository := &stubRepository{enabled: true, enabledErr: errors.New("connection reset")}
	analyticsReader := &stubAnalytics{collectionEnabled: true, values: map[string]float64{}}
	result := read(t, newService(t, repository, analyticsReader, time.Date(2026, 8, 4, 9, 0, 0, 0, time.UTC)))

	requireUnavailable(t, "customers.total", result.Metrics.Customers.Total,
		projectoverview.ReasonBillingDisabled)
}

// Risk: an Environment that turned analytics collection off shows a funnel of
// zeros, which is indistinguishable from a paywall nobody sees. The code must
// be the one the dashboard already maps from the analytics endpoints.
func TestAnalyticsCollectionDisabledReportsUnavailableNotZero(t *testing.T) {
	repository := &stubRepository{
		enabled:   true,
		customers: projectoverview.CustomerCounts{Total: 40, NewToday: 2, NewYesterday: 7},
	}
	analyticsReader := &stubAnalytics{collectionEnabled: false}
	result := read(t, newService(t, repository, analyticsReader, time.Date(2026, 8, 4, 9, 0, 0, 0, time.UTC)))

	for name, metric := range map[string]projectoverview.Metric{
		"paywallViews.today":       result.Metrics.PaywallViews.Today,
		"paywallViews.yesterday":   result.Metrics.PaywallViews.Yesterday,
		"purchaseStarts.today":     result.Metrics.PurchaseStarts.Today,
		"purchases.today":          result.Metrics.Purchases.Today,
		"conversionRate.today":     result.Metrics.ConversionRate.Today,
		"conversionRate.yesterday": result.Metrics.ConversionRate.Yesterday,
	} {
		requireUnavailable(t, name, metric, projectoverview.ReasonAnalyticsCollectionDisabled)
	}
	requireValue(t, "customers.total", result.Metrics.Customers.Total, 40)
	if result.AnalyticsFreshness != nil {
		t.Fatal("freshness is present while every analytics metric is unavailable; a watermark there reads as merely stale data")
	}
}

// Risk: one failing source takes the whole page down, or — the failure this
// surface is built to prevent — is absorbed into a zero next to sources that
// did answer. Only the failing group may lose its values.
func TestOneFailingSourceDoesNotZeroTheOthers(t *testing.T) {
	repository := &stubRepository{
		enabled:   true,
		customers: projectoverview.CustomerCounts{Total: 40, NewToday: 2, NewYesterday: 7},
		statesErr: errors.New("statement timeout"),
		facts: projectoverview.SubscriptionFactCounts{
			InitialPurchasesToday: 4, InitialPurchasesYesterday: 9,
			TrialStartsToday: 1, TrialStartsYesterday: 3,
		},
	}
	analyticsReader := &stubAnalytics{collectionEnabled: true, values: map[string]float64{
		"paywall_presentations": 12, "purchase_starts": 5,
		"client_completed_purchases": 3, "presentation_to_client_completed_purchase_rate": 0.25,
	}}
	result := read(t, newService(t, repository, analyticsReader, time.Date(2026, 8, 4, 9, 0, 0, 0, time.UTC)))

	// Only the projection-state read failed.
	requireUnavailable(t, "subscriptions.active", result.Metrics.Subscriptions.Active,
		projectoverview.ReasonMetricUnavailable)
	requireUnavailable(t, "trials.active", result.Metrics.Trials.Active,
		projectoverview.ReasonMetricUnavailable)
	requireUnavailable(t, "gracePeriod.active", result.Metrics.GracePeriod.Active,
		projectoverview.ReasonMetricUnavailable)
	requireUnavailable(t, "billingRetry.active", result.Metrics.BillingRetry.Active,
		projectoverview.ReasonMetricUnavailable)

	// Everything else still answers, including the fact counts that share the
	// same billing enablement gate.
	requireValue(t, "customers.total", result.Metrics.Customers.Total, 40)
	requireValue(t, "customers.newYesterday", result.Metrics.Customers.NewYesterday, 7)
	requireValue(t, "subscriptions.newToday", result.Metrics.Subscriptions.NewToday, 4)
	requireValue(t, "trials.startedYesterday", result.Metrics.Trials.StartedYesterday, 3)
	requireValue(t, "purchases.today", result.Metrics.Purchases.Today, 3)
}

// Risk: an analytics metric the module declined to value becomes a zero. The
// provider-confirmed metrics do exactly this today, so the guard is live code
// rather than a hypothetical.
func TestAnalyticsMetricWithoutValueIsUnavailable(t *testing.T) {
	repository := &stubRepository{enabled: true}
	analyticsReader := &stubAnalytics{
		collectionEnabled: true,
		omit:              "client_completed_purchases",
		values:            map[string]float64{"paywall_presentations": 12},
	}
	result := read(t, newService(t, repository, analyticsReader, time.Date(2026, 8, 4, 9, 0, 0, 0, time.UTC)))

	requireUnavailable(t, "purchases.today", result.Metrics.Purchases.Today,
		projectoverview.ReasonMetricUnavailable)
	requireValue(t, "paywallViews.today", result.Metrics.PaywallViews.Today, 12)
}

// Risk: "today" silently means the server's local day, or ends at tomorrow's
// midnight and so reports a partial day as complete. Both make every count on
// the page wrong in a way no reader can see. The declared window is also the
// window the sources are actually asked for — asserting only the response would
// let the two drift.
func TestWindowsAreUTCCalendarDaysAndReachTheSources(t *testing.T) {
	now := time.Date(2026, 8, 4, 9, 30, 0, 0, time.UTC)
	repository := &stubRepository{enabled: true}
	analyticsReader := &stubAnalytics{collectionEnabled: true, values: map[string]float64{}}
	result := read(t, newService(t, repository, analyticsReader, now))

	midnight := time.Date(2026, 8, 4, 0, 0, 0, 0, time.UTC)
	if !result.Windows.Today.From.Equal(midnight) || !result.Windows.Today.To.Equal(now) {
		t.Fatalf("today window %v..%v, want %v..%v",
			result.Windows.Today.From, result.Windows.Today.To, midnight, now)
	}
	if !result.Windows.Yesterday.From.Equal(midnight.Add(-24*time.Hour)) ||
		!result.Windows.Yesterday.To.Equal(midnight) {
		t.Fatalf("yesterday window %v..%v", result.Windows.Yesterday.From, result.Windows.Yesterday.To)
	}
	if result.Windows.Today.Timezone != "UTC" || result.Windows.Yesterday.Timezone != "UTC" {
		t.Fatal("declared window timezone is not UTC")
	}
	if repository.factWindows != result.Windows || repository.customerWindows != result.Windows {
		t.Fatal("the billing sources were asked for a window other than the one the response declares")
	}
	if len(analyticsReader.queries) != 2 {
		t.Fatalf("analytics queries %d, want one per window", len(analyticsReader.queries))
	}
	if !analyticsReader.queries[0].From.Equal(midnight) || !analyticsReader.queries[0].To.Equal(now) {
		t.Fatal("the analytics today read used a window other than the one the response declares")
	}
	if analyticsReader.queries[0].Timezone != "UTC" {
		t.Fatalf("analytics timezone %q, want UTC", analyticsReader.queries[0].Timezone)
	}
}

// Risk: a request arriving exactly at midnight UTC produces a zero-length
// today window. The analytics query machinery rejects an empty range as an
// invalid request, so an unguarded composition turns the one instant per day
// when the page is most likely to be watched into an unavailable funnel.
// Zero is the true count over zero duration, and yesterday must be the full
// day that just ended rather than the day before it.
func TestMidnightBoundaryReportsZeroTodayAndAFullYesterday(t *testing.T) {
	midnight := time.Date(2026, 8, 4, 0, 0, 0, 0, time.UTC)
	repository := &stubRepository{enabled: true}
	analyticsReader := &stubAnalytics{
		collectionEnabled: true,
		queryErr:          errors.New("empty range rejected"),
		values:            map[string]float64{},
	}
	result := read(t, newService(t, repository, analyticsReader, midnight))

	if !result.Windows.Today.From.Equal(midnight) || !result.Windows.Today.To.Equal(midnight) {
		t.Fatalf("today window %v..%v, want a zero-length window at midnight",
			result.Windows.Today.From, result.Windows.Today.To)
	}
	if !result.Windows.Yesterday.From.Equal(midnight.Add(-24*time.Hour)) ||
		!result.Windows.Yesterday.To.Equal(midnight) {
		t.Fatalf("yesterday window %v..%v, want the full day that just ended",
			result.Windows.Yesterday.From, result.Windows.Yesterday.To)
	}
	// The stub fails every query it is asked to run, so an available today value
	// proves the empty window was never sent to the analytics module.
	requireValue(t, "paywallViews.today", result.Metrics.PaywallViews.Today, 0)
	requireUnavailable(t, "paywallViews.yesterday", result.Metrics.PaywallViews.Yesterday,
		projectoverview.ReasonMetricUnavailable)
	if len(analyticsReader.queries) != 1 {
		t.Fatalf("analytics queries %d, want only the yesterday window", len(analyticsReader.queries))
	}
}

// Risk: an authorization failure is absorbed into the per-metric tri-state and
// the endpoint answers 200 to a caller who may not read the scope. Failing to
// authorize is the one condition that must stop the whole response.
func TestAuthorizationFailureStopsTheResponse(t *testing.T) {
	repository := &stubRepository{authorizeErr: projectoverview.ErrNotFound, enabled: true}
	service := newService(t, repository, &stubAnalytics{collectionEnabled: true},
		time.Date(2026, 8, 4, 9, 0, 0, 0, time.UTC))

	if _, err := service.Overview(context.Background(), testActor, testProject, testEnvironment); !errors.Is(err, projectoverview.ErrNotFound) {
		t.Fatalf("error %v, want ErrNotFound", err)
	}
}
