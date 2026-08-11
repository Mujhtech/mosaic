// Package projectoverview serves the "today at a glance" summary the dashboard
// renders on entering a Project Environment.
//
// It owns no state. Every number is read through a port onto the module that
// owns it — billing projection state and Transaction Facts through this
// package's repository, funnel counts through the analytics query machinery —
// and its whole job is to compose those reads honestly:
//
//   - one failing source never fails the page, and never renders as a zero;
//   - a configuration that cannot produce a number says so with a stable code
//     rather than reporting nothing happened;
//   - the window every count was taken over is stated in the response.
//
// There are no monetary metrics. Mosaic's Transaction Facts carry no price and
// no currency, so revenue and MRR are not "not yet wired" — they are not
// derivable from anything Mosaic stores. The response shape is closed so they
// can be added additively if that ever changes.
package projectoverview

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/rs/zerolog"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/trace"

	"github.com/Mujhtech/mosaic/apps/api/internal/analytics"
)

// Analytics metric identifiers this surface composes. They are the same
// identifiers the analytics funnel endpoints publish, so the overview tile and
// the funnel page cannot disagree about what a "paywall view" is.
const (
	metricPaywallViews   = "paywall_presentations"
	metricPurchaseStarts = "purchase_starts"
	// Mosaic's provider-confirmed purchase metrics are declared but not
	// computed: analyticspostgres returns them with a
	// `provider_confirmed_unavailable` warning and no value at all. Reporting
	// the overview's purchase tile from them would make it permanently
	// unavailable, so it is read from the client-observed completion instead
	// and carries AuthorityClientObserved to say so.
	metricPurchases      = "client_completed_purchases"
	metricConversionRate = "presentation_to_client_completed_purchase_rate"
)

var analyticsMetricIDs = []string{
	metricPaywallViews, metricPurchaseStarts, metricPurchases, metricConversionRate,
}

type Service struct {
	repository Repository
	analytics  AnalyticsReader
	now        func() time.Time
	tracer     trace.Tracer
}

func NewService(repository Repository, analyticsReader AnalyticsReader) *Service {
	return &Service{
		repository: repository,
		analytics:  analyticsReader,
		now:        time.Now,
		tracer:     otel.Tracer("github.com/Mujhtech/mosaic/apps/api/projectoverview"),
	}
}

// WithClock overrides the service clock. It exists for the window-boundary
// tests, which must be able to place a request exactly at midnight UTC.
func (s *Service) WithClock(now func() time.Time) *Service {
	s.now = now
	return s
}

// Overview composes the summary for one Project Environment.
//
// It returns an error only when the caller may not read the scope. Once
// authorization passes the endpoint always answers 200, with each metric
// carrying either a value or a reason it has none.
func (s *Service) Overview(ctx context.Context, actor Actor, projectID, environmentID string) (Overview, error) {
	ctx, span := s.tracer.Start(ctx, "project.overview.read")
	defer span.End()

	if err := s.repository.Authorize(ctx, actor, projectID, environmentID); err != nil {
		return Overview{}, classifyAuthorization(err)
	}

	windows := NewWindows(s.now())
	result := Overview{ProjectID: projectID, EnvironmentID: environmentID, Windows: windows}
	result.Metrics = s.billingMetrics(ctx, projectID, environmentID, windows)
	s.applyAnalyticsMetrics(ctx, actor, projectID, environmentID, windows, &result)
	return result, nil
}

func classifyAuthorization(err error) error {
	switch {
	case errors.Is(err, ErrUnauthenticated), errors.Is(err, ErrForbidden), errors.Is(err, ErrNotFound):
		return err
	default:
		return ErrUnavailable
	}
}

// ---------------------------------------------------------------------------
// Billing-derived metrics
// ---------------------------------------------------------------------------

// billingMetrics fills the five billing groups from three grouped queries.
//
// Each query stands alone: a failure in the fact read leaves the projection
// counts intact, and vice versa. That is the whole reason the reads are not
// combined into one statement.
func (s *Service) billingMetrics(ctx context.Context, projectID, environmentID string, windows Windows) Metrics {
	if reason := s.billingReason(ctx, projectID); reason != "" {
		return allBillingUnavailable(reason)
	}

	metrics := allBillingUnavailable(ReasonMetricUnavailable)

	if counts, err := s.repository.CustomerCounts(ctx, environmentID, windows); err != nil {
		s.logSourceFailure(ctx, projectID, environmentID, "customer_counts", err)
	} else {
		metrics.Customers = CustomerMetrics{
			Total:        available(float64(counts.Total), AuthorityProjected),
			NewToday:     available(float64(counts.NewToday), AuthorityProjected),
			NewYesterday: available(float64(counts.NewYesterday), AuthorityProjected),
		}
	}

	if counts, err := s.repository.SubscriptionStateCounts(ctx, environmentID); err != nil {
		s.logSourceFailure(ctx, projectID, environmentID, "subscription_state_counts", err)
	} else {
		metrics.Subscriptions.Active = available(float64(counts.Active), AuthorityProjected)
		metrics.Trials.Active = available(float64(counts.Trialing), AuthorityProjected)
		metrics.GracePeriod.Active = available(float64(counts.GracePeriod), AuthorityProjected)
		metrics.BillingRetry.Active = available(float64(counts.BillingRetry), AuthorityProjected)
	}

	if counts, err := s.repository.SubscriptionFactCounts(ctx, environmentID, windows); err != nil {
		s.logSourceFailure(ctx, projectID, environmentID, "subscription_fact_counts", err)
	} else {
		metrics.Subscriptions.NewToday = available(float64(counts.InitialPurchasesToday), AuthorityProviderValidated)
		metrics.Subscriptions.NewYesterday = available(float64(counts.InitialPurchasesYesterday), AuthorityProviderValidated)
		metrics.Trials.StartedToday = available(float64(counts.TrialStartsToday), AuthorityProviderValidated)
		metrics.Trials.StartedYesterday = available(float64(counts.TrialStartsYesterday), AuthorityProviderValidated)
	}

	return metrics
}

// billingReason returns the reason every billing metric is unavailable, or the
// empty string when billing may be read.
//
// It fails closed on access, matching every other billing surface: an unreadable
// setting withholds every billing metric, so a transient database error cannot
// make a Project that asked Mosaic to hold no billing state look as though it
// holds some.
//
// The reported reason is not the same thing as the access decision. A failed
// read is `metric_unavailable`, because telling an operator their billing is
// disabled when the database errored is a statement about their configuration
// that Mosaic has no evidence for. `billing_disabled` is reserved for a
// successful read that returned false.
func (s *Service) billingReason(ctx context.Context, projectID string) string {
	enabled, err := s.repository.BillingEnabled(ctx, projectID)
	if err != nil {
		zerolog.Ctx(ctx).Error().
			Str("project_id", projectID).
			Str("overview_error_kind", fmt.Sprintf("%T", err)).
			Msg("billing enablement could not be read; every billing metric is withheld")
		return ReasonMetricUnavailable
	}
	if !enabled {
		return ReasonBillingDisabled
	}
	return ""
}

func allBillingUnavailable(reason string) Metrics {
	projected := unavailable(reason, AuthorityProjected)
	validated := unavailable(reason, AuthorityProviderValidated)
	return Metrics{
		Customers:     CustomerMetrics{Total: projected, NewToday: projected, NewYesterday: projected},
		Subscriptions: SubscriptionMetrics{Active: projected, NewToday: validated, NewYesterday: validated},
		Trials:        TrialMetrics{Active: projected, StartedToday: validated, StartedYesterday: validated},
		BillingRetry:  LifecycleMetrics{Active: projected},
		GracePeriod:   LifecycleMetrics{Active: projected},
	}
}

// ---------------------------------------------------------------------------
// Analytics-derived metrics
// ---------------------------------------------------------------------------

// applyAnalyticsMetrics fills the four funnel groups and the freshness surface.
//
// Windows are read independently. Today's window falls on raw events because it
// is a partial day; yesterday's falls entirely inside one completed daily
// bucket and is served from the aggregate table. Failing one leaves the other
// answering.
func (s *Service) applyAnalyticsMetrics(ctx context.Context, actor Actor, projectID, environmentID string,
	windows Windows, result *Overview) {

	reason := s.analyticsReason(ctx, actor, projectID, environmentID)
	if reason != "" {
		setAnalyticsUnavailable(&result.Metrics, reason, reason)
		return
	}

	todayValues, todayFreshness, todayErr := s.analyticsWindow(ctx, actor, projectID, environmentID, windows.Today)
	yesterdayValues, yesterdayFreshness, yesterdayErr := s.analyticsWindow(ctx, actor, projectID, environmentID, windows.Yesterday)

	// A metric the analytics module declined to value must not become a zero
	// here: absence from the map is reported as unavailable, exactly as a failed
	// query is. The provider-confirmed metrics do precisely this today.
	//
	// A rate needs a second guard. The analytics module reports a rate with a
	// zero denominator as the value 0, which is the right answer for a caller
	// that also reads the denominator; this surface's Metric carries no
	// denominator, so a bare 0 here would claim a measured 0% conversion on
	// every Environment where nobody has seen a paywall yet. The rate metrics
	// are identified through the analytics vocabulary rather than by name, so
	// the two cannot drift apart when a rate is added.
	pick := func(values map[string]analyticsValue, err error, metricID string) Metric {
		if err != nil {
			return unavailable(ReasonMetricUnavailable, AuthorityClientObserved)
		}
		value, ok := values[metricID]
		if !ok {
			return unavailable(ReasonMetricUnavailable, AuthorityClientObserved)
		}
		if spec, known := analytics.SeriesMetricSpecFor(metricID); known && spec.Kind == analytics.SeriesMetricRate {
			if value.denominator == nil || *value.denominator == 0 {
				return unavailable(ReasonNotMeasured, AuthorityClientObserved)
			}
		}
		return available(value.value, AuthorityClientObserved)
	}
	assign := func(target *WindowedMetrics, metricID string) {
		target.Today = pick(todayValues, todayErr, metricID)
		target.Yesterday = pick(yesterdayValues, yesterdayErr, metricID)
	}
	assign(&result.Metrics.PaywallViews, metricPaywallViews)
	assign(&result.Metrics.PurchaseStarts, metricPurchaseStarts)
	assign(&result.Metrics.Purchases, metricPurchases)
	assign(&result.Metrics.ConversionRate, metricConversionRate)

	// The freshness surface describes the aggregate pipeline, not one window, so
	// whichever read reached the watermark is equally valid. It is omitted only
	// when neither did.
	if todayFreshness != nil {
		result.AnalyticsFreshness = todayFreshness
	} else if yesterdayFreshness != nil {
		result.AnalyticsFreshness = yesterdayFreshness
	}
}

// analyticsReason returns the reason every analytics metric is unavailable, or
// the empty string when analytics may be read.
func (s *Service) analyticsReason(ctx context.Context, actor Actor, projectID, environmentID string) string {
	if s.analytics == nil {
		return ReasonMetricUnavailable
	}
	settings, err := s.analytics.Settings(ctx, analytics.Actor{ID: actor.ID}, projectID, environmentID)
	if err != nil {
		s.logSourceFailure(ctx, projectID, environmentID, "analytics_settings", err)
		return ReasonMetricUnavailable
	}
	if !settings.CollectionEnabled {
		return ReasonAnalyticsCollectionDisabled
	}
	return ""
}

// analyticsValue is one metric as the analytics module answered it, keeping the
// denominator the module used rather than only its computed value. The
// denominator is what decides whether a rate was measured at all, and it is
// dropped before the value reaches the response, so it is deliberately internal.
type analyticsValue struct {
	value float64
	// denominator is nil for a count metric and for a rate the module answered
	// without one.
	denominator *int64
}

// analyticsWindow runs one query for all four metrics over one window.
//
// A zero-length window — the single instant per day when a request arrives
// exactly at midnight UTC — is answered without a query. Nothing has happened
// yet in a range of zero duration, so zero is the true count rather than a
// stand-in for one, and the analytics query machinery rejects an empty range as
// an invalid request. The counts are therefore honest zeros and the rate has no
// denominator, which is exactly what the daily series does for the day in
// progress.
func (s *Service) analyticsWindow(ctx context.Context, actor Actor, projectID, environmentID string,
	window Window) (map[string]analyticsValue, *analytics.Freshness, error) {

	if window.Empty() {
		values := make(map[string]analyticsValue, len(analyticsMetricIDs))
		for _, id := range analyticsMetricIDs {
			values[id] = analyticsValue{}
		}
		return values, nil, nil
	}

	result, err := s.analytics.Query(ctx, analytics.Actor{ID: actor.ID}, analytics.Query{
		ProjectID:     projectID,
		EnvironmentID: environmentID,
		From:          window.From,
		To:            window.To,
		Timezone:      "UTC",
		Basis:         "event_count",
	}, analyticsMetricIDs)
	if err != nil {
		s.logSourceFailure(ctx, projectID, environmentID, "analytics_query", err)
		return nil, nil, err
	}

	values := make(map[string]analyticsValue, len(result.Metrics))
	for _, metric := range result.Metrics {
		if metric.Value == nil {
			continue
		}
		values[metric.ID] = analyticsValue{value: *metric.Value, denominator: metric.Denominator}
	}
	freshness := result.Freshness
	return values, &freshness, nil
}

func setAnalyticsUnavailable(metrics *Metrics, todayReason, yesterdayReason string) {
	today := unavailable(todayReason, AuthorityClientObserved)
	yesterday := unavailable(yesterdayReason, AuthorityClientObserved)
	windowed := WindowedMetrics{Today: today, Yesterday: yesterday}
	metrics.PaywallViews = windowed
	metrics.PurchaseStarts = windowed
	metrics.Purchases = windowed
	metrics.ConversionRate = windowed
}

// logSourceFailure records a source that could not answer.
//
// It logs at error level rather than warn: the request succeeded, so nothing
// else in the stack will report this, and a metric quietly going missing on the
// dashboard's landing page is exactly the kind of failure that otherwise
// survives for weeks. Identifiers only — the cause's type, never its message,
// which on these paths can quote a query.
func (s *Service) logSourceFailure(ctx context.Context, projectID, environmentID, source string, err error) {
	zerolog.Ctx(ctx).Error().
		Str("project_id", projectID).
		Str("environment_id", environmentID).
		Str("overview_source", source).
		Str("overview_error_kind", fmt.Sprintf("%T", err)).
		Msg("project overview source could not be read; the metric is reported unavailable")
}
