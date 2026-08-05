package analytics

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
)

// LateEventPolicy is the freshness note every analytics read publishes.
const LateEventPolicy = "Events are accepted for seven days and rebuild their occurred-at UTC bucket."

// Series length bounds, deliberately the same numbers the Project overview
// series clamps to. A chart of fewer than a week cannot show a weekly cycle and
// reads as noise; the ceiling bounds the read cost of a surface that renders on
// every visit to an analytics page. Nothing in storage forces the ceiling — the
// daily aggregates outlive raw events by design — so raising it later is a
// one-constant change.
//
// A caller asking outside the range is clamped rather than refused: the length
// of a chart is a presentation choice, not a correctness one.
const (
	MinSeriesDays     = 7
	MaxSeriesDays     = 90
	DefaultSeriesDays = 30

	// MaxSeriesMetrics bounds one request's fan-out. Each metric is one grouped
	// read, so an unbounded metric list would turn a chart request into a scan
	// of the whole aggregate vocabulary.
	MaxSeriesMetrics = 12

	// ScopeEnvironment is the only scope these series are measured over.
	ScopeEnvironment = "environment"

	// SeriesMetricCount is a metric that counts events. Its missing days are
	// explicit zeros: a day with no purchases had zero purchases.
	SeriesMetricCount = "count"
	// SeriesMetricRate is a ratio between 0 and 1. Its missing days are null,
	// because a day with no denominator has no rate at all and drawing 0% there
	// would show a collapse in something that was never measured.
	SeriesMetricRate = "rate"

	// ReasonProviderConfirmedUnavailable marks a metric Mosaic declares but does
	// not yet compute, matching the warning the summed query attaches.
	ReasonProviderConfirmedUnavailable = "provider_confirmed_unavailable"
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

// SeriesMetricSpec is what the daily series layer needs to know about a metric
// that the SQL adapter's expression tables do not express.
type SeriesMetricSpec struct {
	// Kind decides what a day with no underlying row means.
	Kind string
	// Authority mirrors the authority the summed query reports.
	Authority string
	// Computed is false for a metric Mosaic defines but does not yet produce. A
	// series for one is served as unavailable rather than as zeros.
	Computed bool
	// Dimensioned reports whether the daily aggregates can serve this metric
	// under a platform, locale, or applicationVersion filter.
	//
	// This is a property of the aggregation, not of the metric: only
	// analytics_daily_event_counts carries the dimension columns at write time.
	// analytics_daily_funnel_counts has the columns but the aggregation job
	// leaves them NULL, so every funnel metric — every correlated rate, and
	// every count whose definition needs a payload field the event grain does
	// not carry — can only be read undimensioned.
	Dimensioned bool
}

// seriesMetricSpecs is the daily-series vocabulary. Its keys must match the SQL
// adapter's metric definitions exactly; an adapter test asserts that.
var seriesMetricSpecs = map[string]SeriesMetricSpec{
	"placement_requests":         {SeriesMetricCount, "client_observed", true, true},
	"placement_paywall_selected": {SeriesMetricCount, "client_observed", true, true},
	"placement_no_paywall":       {SeriesMetricCount, "client_observed", true, true},
	"placement_fallback_used":    {SeriesMetricCount, "client_observed", true, true},
	"placement_unavailable":      {SeriesMetricCount, "client_observed", true, true},
	"paywall_presentations":      {SeriesMetricCount, "client_observed", true, true},
	"product_selections":         {SeriesMetricCount, "client_observed", true, true},
	"purchase_starts":            {SeriesMetricCount, "client_observed", true, true},
	"purchase_cancelled":         {SeriesMetricCount, "client_observed", true, true},
	"purchase_failed":            {SeriesMetricCount, "client_observed", true, true},
	"restore_completed":          {SeriesMetricCount, "client_observed", true, true},
	"restore_nothing_found":      {SeriesMetricCount, "client_observed", true, true},
	"restore_cancelled":          {SeriesMetricCount, "client_observed", true, true},
	"restore_failed":             {SeriesMetricCount, "client_observed", true, true},
	"provider_errors":            {SeriesMetricCount, "client_observed", true, true},
	"product_unavailable_rate":   {SeriesMetricRate, "client_observed", true, true},

	// Counted from a payload field the daily event grain does not carry:
	// purchase_completed_client covers already-entitled completions too, so the
	// event count would overstate purchases under a filter.
	"client_completed_purchases": {SeriesMetricCount, "client_observed", true, false},

	// Correlated rates. Their numerators join a later event back to the
	// presentation or purchase attempt that produced it, which no daily grain
	// preserves, so they exist only in the undimensioned funnel aggregate.
	"presentation_to_product_selection_rate":         {SeriesMetricRate, "client_observed", true, false},
	"product_selection_to_purchase_start_rate":       {SeriesMetricRate, "client_observed", true, false},
	"presentation_to_purchase_start_rate":            {SeriesMetricRate, "client_observed", true, false},
	"presentation_to_client_completed_purchase_rate": {SeriesMetricRate, "client_observed", true, false},
	"purchase_cancellation_rate":                     {SeriesMetricRate, "client_observed", true, false},
	"purchase_pending_rate":                          {SeriesMetricRate, "client_observed", true, false},
	"purchase_deferred_rate":                         {SeriesMetricRate, "client_observed", true, false},
	"purchase_failure_rate":                          {SeriesMetricRate, "client_observed", true, false},

	// Declared but not computed, exactly as the summed query reports them.
	"provider_confirmed_purchases":                     {SeriesMetricCount, "provider_confirmed", false, false},
	"presentation_to_provider_confirmed_purchase_rate": {SeriesMetricRate, "provider_confirmed", false, false},
}

// SeriesMetricSpecFor looks up a metric's series behaviour.
func SeriesMetricSpecFor(id string) (SeriesMetricSpec, bool) {
	spec, ok := seriesMetricSpecs[id]
	return spec, ok
}

// SeriesMetricIDs lists the vocabulary, sorted, for documentation and tests.
func SeriesMetricIDs() []string {
	ids := make([]string, 0, len(seriesMetricSpecs))
	for id := range seriesMetricSpecs {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

// UnsupportedDimensionError reports a filter the daily aggregates cannot honour
// for the requested metrics.
//
// It is an error rather than a silently dropped predicate. A chart drawn from
// unfiltered totals under a filtered heading is indistinguishable from a
// correct one, and the reader would act on it.
type UnsupportedDimensionError struct {
	Dimension string
	MetricIDs []string
}

func (e *UnsupportedDimensionError) Error() string {
	return fmt.Sprintf("the %s filter cannot be applied to %s in a daily series",
		e.Dimension, strings.Join(e.MetricIDs, ", "))
}

// seriesFilters lists the request fields the daily series can be filtered by,
// in the order they are validated. They are exactly the filters the summed
// query accepts, so a chart and the tile above it describe one population.
func seriesFilters(query Query) []struct{ name, value string } {
	return []struct{ name, value string }{
		{"platform", query.Platform},
		{"locale", query.Locale},
		{"applicationVersion", query.ApplicationVersion},
	}
}

// SeriesFiltered reports whether any dimension filter is set.
func SeriesFiltered(query Query) bool {
	for _, filter := range seriesFilters(query) {
		if filter.value != "" {
			return true
		}
	}
	return false
}

// SeriesPoint is one UTC day of one metric.
type SeriesPoint struct {
	// Date is the UTC calendar day as YYYY-MM-DD.
	Date  string   `json:"date"`
	Value *float64 `json:"value"`
	// Partial marks the day still in progress. It is set on today's point and on
	// no other, so the dashboard can draw the last segment differently instead of
	// showing a daily total that collapses at every page load.
	Partial bool `json:"partial,omitempty"`
}

// MetricSeries is one metric's line, tri-state per series rather than per point.
//
// A hole inside a drawn line reads as a collapse; an unavailable series is a
// statement that the line cannot be drawn at all, and why. Points are therefore
// either all present or entirely absent.
type MetricSeries struct {
	MetricID  string        `json:"metricId"`
	Kind      string        `json:"kind"`
	Authority string        `json:"authority"`
	Scope     string        `json:"scope"`
	Available bool          `json:"available"`
	Reason    string        `json:"reason,omitempty"`
	Points    []SeriesPoint `json:"points,omitempty"`
}

// SeriesWindow is the half-open instant range the points cover.
type SeriesWindow struct {
	From time.Time `json:"from"`
	To   time.Time `json:"to"`
	// Timezone is always UTC. Day boundaries are UTC midnights regardless of the
	// request's timezone, which the daily aggregates are bucketed by; the
	// requested timezone is echoed on the summed metrics, not applied here.
	Timezone string `json:"timezone"`
}

// SeriesResult is the daily-series endpoint payload.
type SeriesResult struct {
	ProjectID     string `json:"projectId"`
	EnvironmentID string `json:"environmentId"`
	// Days is the clamped length actually served, which may differ from the
	// requested one.
	Days   int            `json:"days"`
	Window SeriesWindow   `json:"window"`
	Series []MetricSeries `json:"series"`
	// Freshness is the same watermark surface the summed endpoints publish.
	Freshness Freshness `json:"freshness"`
}

const seriesDayFormat = "2006-01-02"

// seriesAxis is the run of UTC midnights a series covers, oldest first, ending
// with today.
type seriesAxis struct {
	days   []time.Time
	today  time.Time
	window SeriesWindow
}

func newSeriesAxis(now time.Time, days int) seriesAxis {
	now = now.UTC()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	first := today.Add(-time.Duration(days-1) * 24 * time.Hour)
	list := make([]time.Time, 0, days)
	for day := first; !day.After(today); day = day.Add(24 * time.Hour) {
		list = append(list, day)
	}
	return seriesAxis{days: list, today: today, window: SeriesWindow{From: first, To: now, Timezone: "UTC"}}
}

// seriesCounts is one metric's numerator and denominator for one day.
//
// Both halves are carried rather than a computed value: a rate whose
// denominator is zero has no value at all, and only a holder of both halves can
// tell that apart from a rate of zero.
type seriesCounts struct {
	numerator   int64
	denominator *int64
}

// Series answers the daily-series read behind the analytics trend charts.
//
// It is the same vocabulary, the same filters, and the same authorization as
// the summed query, resolved per UTC day instead of over the whole window.
// Completed days come from the daily aggregates; today is read live through the
// summed path, because the aggregation job has not finished today's bucket and
// serving it would report a fraction of the day as the whole of it.
func (s *Service) Series(ctx context.Context, actor Actor, query Query, metricIDs []string,
	days int) (SeriesResult, error) {

	ctx, span := otel.Tracer("mosaic/analytics").Start(ctx, "analytics.series")
	defer span.End()

	if actor.ID == "" {
		return SeriesResult{}, ErrUnauthenticated
	}
	requested, err := validSeriesMetricIDs(metricIDs)
	if err != nil {
		return SeriesResult{}, err
	}
	if query.Basis != "event_count" {
		return SeriesResult{}, ErrInvalidBatch
	}
	if _, err = time.LoadLocation(query.Timezone); err != nil {
		return SeriesResult{}, ErrInvalidBatch
	}
	if err = checkSeriesDimensions(query, requested); err != nil {
		return SeriesResult{}, err
	}

	// A chart of an Environment that is not collecting is a flat line, not a
	// measurement. Refuse it with the same code the ingestion path uses, which
	// is what the dashboard already renders as "analytics is off here".
	settings, err := s.repository.SettingsForActor(ctx, actor, query.ProjectID, query.EnvironmentID)
	if err != nil {
		return SeriesResult{}, err
	}
	if !settings.CollectionEnabled {
		return SeriesResult{}, ErrCollectionDisabled
	}

	days = ClampSeriesDays(days)
	axis := newSeriesAxis(s.now(), days)
	span.SetAttributes(
		attribute.Int("analytics.series.days", days),
		attribute.Int("analytics.series.metrics", len(requested)),
		attribute.Bool("analytics.series.filtered", SeriesFiltered(query)),
	)

	counts := make(map[string]map[time.Time]seriesCounts, len(requested))
	for _, id := range requested {
		counts[id] = map[time.Time]seriesCounts{}
	}

	computed := computedSeriesMetricIDs(requested)
	result := SeriesResult{
		ProjectID: query.ProjectID, EnvironmentID: query.EnvironmentID,
		Days: days, Window: axis.window,
		Freshness: Freshness{LateEventPolicy: LateEventPolicy},
	}

	if len(computed) > 0 {
		history := query
		history.From, history.To = axis.window.From, axis.today
		series, err := s.repository.DailySeries(ctx, actor, history, computed)
		if err != nil {
			span.RecordError(err)
			return SeriesResult{}, err
		}
		result.Freshness = series.Freshness
		for _, point := range series.Points {
			metric, ok := counts[point.MetricID]
			if !ok {
				continue
			}
			metric[point.Date.UTC()] = seriesCounts{numerator: point.Numerator, denominator: point.Denominator}
		}

		today := query
		today.From, today.To = axis.today, axis.window.To
		// The window is empty in the one instant per day when a request arrives
		// exactly at midnight. Nothing has happened yet in a range of zero
		// duration, so the day's points stay at their missing-day reading rather
		// than being asked of a query that rejects an empty range.
		if today.To.After(today.From) {
			live, err := s.repository.Query(ctx, actor, today, computed)
			if err != nil {
				span.RecordError(err)
				return SeriesResult{}, err
			}
			for _, metric := range live.Metrics {
				if metric.Value == nil {
					continue
				}
				if _, ok := counts[metric.ID]; !ok {
					continue
				}
				counts[metric.ID][axis.today] = seriesCounts{
					numerator: metric.Numerator, denominator: metric.Denominator,
				}
			}
		}
	}

	result.Series = make([]MetricSeries, 0, len(requested))
	for _, id := range requested {
		spec, _ := SeriesMetricSpecFor(id)
		series := MetricSeries{
			MetricID: id, Kind: spec.Kind, Authority: spec.Authority, Scope: ScopeEnvironment,
			Available: spec.Computed,
		}
		if !spec.Computed {
			series.Reason = ReasonProviderConfirmedUnavailable
			result.Series = append(result.Series, series)
			continue
		}
		series.Points = axis.points(spec, counts[id])
		result.Series = append(result.Series, series)
	}
	return result, nil
}

// points renders one metric's line over the axis.
//
// A count's missing day is an explicit zero and a rate's is null, which is the
// whole reason the numerator and denominator travel this far rather than a
// value computed at the SQL boundary: the summed query reports a rate with a
// zero denominator as 0, which is right for a tile carrying its own denominator
// beside it and wrong for a chart point, where 0% draws as a collapse on a day
// nobody opened the app.
func (a seriesAxis) points(spec SeriesMetricSpec, byDay map[time.Time]seriesCounts) []SeriesPoint {
	points := make([]SeriesPoint, 0, len(a.days))
	for _, day := range a.days {
		point := SeriesPoint{Date: day.Format(seriesDayFormat), Partial: day.Equal(a.today)}
		if spec.Kind == SeriesMetricCount {
			zero := float64(0)
			point.Value = &zero
		}
		if counts, ok := byDay[day]; ok {
			switch {
			case spec.Kind == SeriesMetricCount:
				value := float64(counts.numerator)
				point.Value = &value
			case counts.denominator != nil && *counts.denominator > 0:
				value := float64(counts.numerator) / float64(*counts.denominator)
				point.Value = &value
			}
		}
		points = append(points, point)
	}
	return points
}

// validSeriesMetricIDs de-duplicates the requested identifiers, preserving
// request order, and refuses anything outside the vocabulary. An unbounded
// series over every metric Mosaic defines is not a chart, it is a table scan.
func validSeriesMetricIDs(metricIDs []string) ([]string, error) {
	if len(metricIDs) == 0 || len(metricIDs) > MaxSeriesMetrics {
		return nil, ErrInvalidBatch
	}
	seen := make(map[string]struct{}, len(metricIDs))
	ordered := make([]string, 0, len(metricIDs))
	for _, id := range metricIDs {
		if _, ok := SeriesMetricSpecFor(id); !ok {
			return nil, ErrInvalidBatch
		}
		if _, duplicate := seen[id]; duplicate {
			continue
		}
		seen[id] = struct{}{}
		ordered = append(ordered, id)
	}
	return ordered, nil
}

func computedSeriesMetricIDs(metricIDs []string) []string {
	computed := make([]string, 0, len(metricIDs))
	for _, id := range metricIDs {
		if spec, ok := SeriesMetricSpecFor(id); ok && spec.Computed {
			computed = append(computed, id)
		}
	}
	return computed
}

// checkSeriesDimensions refuses a filter the daily aggregates cannot honour for
// one of the requested metrics, naming both.
func checkSeriesDimensions(query Query, metricIDs []string) error {
	for _, filter := range seriesFilters(query) {
		if filter.value == "" {
			continue
		}
		var blocked []string
		for _, id := range metricIDs {
			// A metric that is not computed at all carries no points, so a filter
			// it cannot honour cannot mislead anyone. Only a metric that would
			// otherwise answer with unfiltered numbers is refused.
			if spec, ok := SeriesMetricSpecFor(id); ok && spec.Computed && !spec.Dimensioned {
				blocked = append(blocked, id)
			}
		}
		if len(blocked) > 0 {
			return &UnsupportedDimensionError{Dimension: filter.name, MetricIDs: blocked}
		}
	}
	return nil
}
