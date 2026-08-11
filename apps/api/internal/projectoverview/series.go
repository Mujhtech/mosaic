package projectoverview

import (
	"context"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/analytics"
)

// Series length bounds. The floor exists because a chart of fewer than a week
// cannot show a weekly cycle and reads as noise; the ceiling bounds the read
// cost of a surface that renders on every visit to the overview page. Nothing
// in storage forces the ceiling — the daily aggregates are never pruned, only
// raw events are — so raising it later is a one-constant change.
//
// A caller asking outside the range is clamped rather than refused: the length
// of a chart is a presentation choice, not a correctness one, and failing a
// landing page over it would be a worse answer than drawing 90 days.
const (
	MinSeriesDays     = 7
	MaxSeriesDays     = 90
	DefaultSeriesDays = 30
)

// ClampSeriesDays applies the server-side bounds. Zero and negative values mean
// "unspecified" and take the default.
func ClampSeriesDays(days int) int {
	switch {
	case days <= 0:
		return DefaultSeriesDays
	case days < MinSeriesDays:
		return MinSeriesDays
	case days > MaxSeriesDays:
		return MaxSeriesDays
	default:
		return days
	}
}

// SeriesPoint is one UTC day of one measure.
//
// Value is null only where "no value" is the truthful reading. For a count that
// never happens: a day with no purchases had zero purchases, and the point says
// 0. For a rate it happens whenever the denominator is zero — a day nobody saw
// the paywall has no conversion rate at all, and reporting 0% there would show
// a crash in a metric that was never measured.
type SeriesPoint struct {
	// Date is the UTC calendar day, formatted as YYYY-MM-DD.
	Date  string   `json:"date"`
	Value *float64 `json:"value"`
	// Partial marks a day that is still in progress. It is set on today's point
	// and on no other, so the dashboard can draw the last segment differently
	// instead of showing a daily total collapsing at every page load.
	Partial bool `json:"partial,omitempty"`
}

// Series is the tri-state of the chart surface, held per series rather than per
// point.
//
// The distinction matters: a missing point inside an available series would be
// a gap the reader interprets, while an unavailable series is a statement that
// this line cannot be drawn at all and why. Points are therefore either all
// present or entirely absent.
type Series struct {
	Points    []SeriesPoint `json:"points,omitempty"`
	Available bool          `json:"available"`
	Reason    string        `json:"reason,omitempty"`
	Authority string        `json:"authority"`
	Scope     string        `json:"scope"`
}

func unavailableSeries(reason, authority string) Series {
	return Series{Available: false, Reason: reason, Authority: authority, Scope: ScopeEnvironment}
}

// SeriesMetrics is a closed object for the same reason Metrics is: a reader can
// tell "this deployment cannot chart revenue" from "this response happened not
// to include it". Mosaic's Transaction Facts carry no price or currency, so no
// monetary series is offered; adding one later is additive.
type SeriesMetrics struct {
	PaywallViews   Series `json:"paywallViews"`
	PurchaseStarts Series `json:"purchaseStarts"`
	Purchases      Series `json:"purchases"`
	ConversionRate Series `json:"conversionRate"`

	NewCustomers     Series `json:"newCustomers"`
	NewSubscriptions Series `json:"newSubscriptions"`
	TrialsStarted    Series `json:"trialsStarted"`
}

// OverviewSeries is the series endpoint payload.
type OverviewSeries struct {
	ProjectID     string `json:"projectId"`
	EnvironmentID string `json:"environmentId"`
	// Days is the clamped length actually served, which may differ from what the
	// caller asked for.
	Days int `json:"days"`
	// Window is the half-open instant range the points cover. It ends at the
	// request instant rather than tomorrow's midnight, because the last day is
	// still in progress and saying otherwise would misdescribe what was counted.
	Window  Window        `json:"window"`
	Metrics SeriesMetrics `json:"metrics"`
	// AnalyticsFreshness is the same watermark surface the scalar endpoint
	// publishes, absent when the analytics read did not happen.
	AnalyticsFreshness *analytics.Freshness `json:"analyticsFreshness,omitempty"`
}

// seriesDays is the UTC midnights the series covers, oldest first, ending with
// today.
type seriesDays struct {
	days   []time.Time
	today  time.Time
	window Window
}

func newSeriesDays(now time.Time, days int) seriesDays {
	now = now.UTC()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	first := today.Add(-time.Duration(days-1) * 24 * time.Hour)
	list := make([]time.Time, 0, days)
	for day := first; !day.After(today); day = day.Add(24 * time.Hour) {
		list = append(list, day)
	}
	return seriesDays{
		days:   list,
		today:  today,
		window: Window{From: first, To: now, Timezone: "UTC"},
	}
}

// history is the completed-day range, which excludes today.
func (s seriesDays) history() Window {
	return Window{From: s.window.From, To: s.today, Timezone: "UTC"}
}

// todayWindow is the partial day so far, ending at the request instant. It is
// empty in the one instant per day when a request arrives exactly at midnight.
func (s seriesDays) todayWindow() Window {
	return Window{From: s.today, To: s.window.To, Timezone: "UTC"}
}

const dayFormat = "2006-01-02"

// build renders one series from a per-day lookup. missing decides what a day
// with no underlying row means for this measure — an explicit zero for a count,
// a null for a rate with no denominator.
func (s seriesDays) build(authority string, missing *float64, value func(day time.Time) (*float64, bool)) Series {
	points := make([]SeriesPoint, 0, len(s.days))
	for _, day := range s.days {
		point := SeriesPoint{Date: day.Format(dayFormat), Partial: day.Equal(s.today)}
		if missing != nil {
			absent := *missing
			point.Value = &absent
		}
		if found, ok := value(day); ok {
			point.Value = found
		}
		points = append(points, point)
	}
	return Series{Points: points, Available: true, Authority: authority, Scope: ScopeEnvironment}
}

func floatOf(value int64) *float64 {
	converted := float64(value)
	return &converted
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

// OverviewSeries composes the daily series for one Project Environment.
//
// Like the scalar summary it returns an error only when the caller may not read
// the scope. Past that it always answers, with each series carrying either a
// full set of points or a reason it carries none.
func (s *Service) OverviewSeries(ctx context.Context, actor Actor, projectID, environmentID string,
	days int) (OverviewSeries, error) {

	ctx, span := s.tracer.Start(ctx, "project.overview.series.read")
	defer span.End()

	if err := s.repository.Authorize(ctx, actor, projectID, environmentID); err != nil {
		return OverviewSeries{}, classifyAuthorization(err)
	}

	days = ClampSeriesDays(days)
	axis := newSeriesDays(s.now(), days)
	result := OverviewSeries{
		ProjectID: projectID, EnvironmentID: environmentID,
		Days: days, Window: axis.window,
	}
	result.Metrics = s.billingSeries(ctx, projectID, environmentID, axis)
	s.applyAnalyticsSeries(ctx, actor, projectID, environmentID, axis, &result)
	return result, nil
}

// billingSeries fills the three billing series from two grouped queries.
//
// The counts come from live facts and pointers rather than from an aggregate
// table, so today's values are as complete as any other day's. Today's point is
// still marked partial, because a chart whose last column is labelled partial
// for one line and not for another invites the reader to compare a full day
// against a few hours.
func (s *Service) billingSeries(ctx context.Context, projectID, environmentID string, axis seriesDays) SeriesMetrics {
	if reason := s.billingReason(ctx, projectID); reason != "" {
		return allBillingSeriesUnavailable(reason)
	}

	metrics := allBillingSeriesUnavailable(ReasonMetricUnavailable)
	zero := float64(0)

	if counts, err := s.repository.CustomerDailyCounts(ctx, environmentID, axis.window); err != nil {
		s.logSourceFailure(ctx, projectID, environmentID, "customer_daily_counts", err)
	} else {
		byDay := make(map[time.Time]int64, len(counts))
		for _, count := range counts {
			byDay[count.Day.UTC()] = count.Count
		}
		metrics.NewCustomers = axis.build(AuthorityProjected, &zero, func(day time.Time) (*float64, bool) {
			count, ok := byDay[day]
			return floatOf(count), ok
		})
	}

	if counts, err := s.repository.SubscriptionFactDailyCounts(ctx, environmentID, axis.window); err != nil {
		s.logSourceFailure(ctx, projectID, environmentID, "subscription_fact_daily_counts", err)
	} else {
		byDay := make(map[time.Time]DailyFactCounts, len(counts))
		for _, count := range counts {
			byDay[count.Day.UTC()] = count
		}
		metrics.NewSubscriptions = axis.build(AuthorityProviderValidated, &zero, func(day time.Time) (*float64, bool) {
			count, ok := byDay[day]
			return floatOf(count.InitialPurchases), ok
		})
		metrics.TrialsStarted = axis.build(AuthorityProviderValidated, &zero, func(day time.Time) (*float64, bool) {
			count, ok := byDay[day]
			return floatOf(count.TrialStarts), ok
		})
	}

	return metrics
}

func allBillingSeriesUnavailable(reason string) SeriesMetrics {
	return SeriesMetrics{
		NewCustomers:     unavailableSeries(reason, AuthorityProjected),
		NewSubscriptions: unavailableSeries(reason, AuthorityProviderValidated),
		TrialsStarted:    unavailableSeries(reason, AuthorityProviderValidated),
	}
}

// dailyCounts is one metric's per-day numerator and denominator.
type dailyCounts struct {
	numerator   int64
	denominator *int64
}

// applyAnalyticsSeries fills the four funnel series and the freshness surface.
//
// Completed days come from the daily aggregates; today comes from the same live
// read the scalar endpoint uses, because the aggregation job has not finished
// today's bucket and serving it would report a fraction of the day as the whole
// of it. Both reads must succeed: a chart missing its most recent day, or
// missing an interior week, is read as a collapse rather than as a gap, so a
// failure in either takes all four series to unavailable rather than drawing a
// partial line.
func (s *Service) applyAnalyticsSeries(ctx context.Context, actor Actor, projectID, environmentID string,
	axis seriesDays, result *OverviewSeries) {

	reason := s.analyticsReason(ctx, actor, projectID, environmentID)
	if reason != "" {
		setAnalyticsSeriesUnavailable(&result.Metrics, reason)
		return
	}

	byDay := make(map[string]map[time.Time]dailyCounts, len(analyticsMetricIDs))
	for _, id := range analyticsMetricIDs {
		byDay[id] = map[time.Time]dailyCounts{}
	}

	history := axis.history()
	if !history.Empty() {
		series, err := s.analytics.DailySeries(ctx, analytics.Actor{ID: actor.ID}, analytics.Query{
			ProjectID:     projectID,
			EnvironmentID: environmentID,
			From:          history.From,
			To:            history.To,
			Timezone:      "UTC",
			Basis:         "event_count",
		}, analyticsMetricIDs)
		if err != nil {
			s.logSourceFailure(ctx, projectID, environmentID, "analytics_daily_series", err)
			setAnalyticsSeriesUnavailable(&result.Metrics, ReasonMetricUnavailable)
			return
		}
		for _, point := range series.Points {
			metric, ok := byDay[point.MetricID]
			if !ok {
				continue
			}
			metric[point.Date.UTC()] = dailyCounts{numerator: point.Numerator, denominator: point.Denominator}
		}
		result.AnalyticsFreshness = &series.Freshness
	}

	today, freshness, err := s.analyticsTodayCounts(ctx, actor, projectID, environmentID, axis.todayWindow())
	if err != nil {
		setAnalyticsSeriesUnavailable(&result.Metrics, ReasonMetricUnavailable)
		result.AnalyticsFreshness = nil
		return
	}
	for id, counts := range today {
		byDay[id][axis.today] = counts
	}
	if result.AnalyticsFreshness == nil && freshness != nil {
		result.AnalyticsFreshness = freshness
	}

	count := func(id string) Series {
		zero := float64(0)
		return axis.build(AuthorityClientObserved, &zero, func(day time.Time) (*float64, bool) {
			counts, ok := byDay[id][day]
			return floatOf(counts.numerator), ok
		})
	}
	result.Metrics.PaywallViews = count(metricPaywallViews)
	result.Metrics.PurchaseStarts = count(metricPurchaseStarts)
	result.Metrics.Purchases = count(metricPurchases)

	// A rate is null wherever nothing was measured, both for a day with no
	// aggregate row and for a day whose denominator came back zero.
	result.Metrics.ConversionRate = axis.build(AuthorityClientObserved, nil, func(day time.Time) (*float64, bool) {
		counts, ok := byDay[metricConversionRate][day]
		if !ok || counts.denominator == nil || *counts.denominator == 0 {
			return nil, false
		}
		rate := float64(counts.numerator) / float64(*counts.denominator)
		return &rate, true
	})
}

// analyticsTodayCounts reads the day in progress live, keeping the numerator
// and denominator rather than the module's computed value.
//
// The computed value is not usable here: the analytics module reports a rate
// with a zero denominator as 0, which is the right answer only for a caller
// that reads the denominator beside it, and the wrong one for a chart point,
// where 0% draws as a conversion collapse on a day nobody opened the app. The
// scalar overview keeps the denominator for the same reason — its Metric does
// not carry one either — so the tile and the chart agree about what "not
// measured" means.
func (s *Service) analyticsTodayCounts(ctx context.Context, actor Actor, projectID, environmentID string,
	window Window) (map[string]dailyCounts, *analytics.Freshness, error) {

	counts := make(map[string]dailyCounts, len(analyticsMetricIDs))
	if window.Empty() {
		for _, id := range analyticsMetricIDs {
			counts[id] = dailyCounts{}
		}
		return counts, nil, nil
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
		s.logSourceFailure(ctx, projectID, environmentID, "analytics_today_query", err)
		return nil, nil, err
	}
	for _, metric := range result.Metrics {
		if metric.Value == nil {
			continue
		}
		counts[metric.ID] = dailyCounts{numerator: metric.Numerator, denominator: metric.Denominator}
	}
	// A metric the module declined to value must not become a zero column.
	for _, id := range analyticsMetricIDs {
		if _, ok := counts[id]; !ok {
			return nil, nil, ErrUnavailable
		}
	}
	freshness := result.Freshness
	return counts, &freshness, nil
}

func setAnalyticsSeriesUnavailable(metrics *SeriesMetrics, reason string) {
	series := unavailableSeries(reason, AuthorityClientObserved)
	metrics.PaywallViews = series
	metrics.PurchaseStarts = series
	metrics.Purchases = series
	metrics.ConversionRate = series
}
