package analyticspostgres

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Mujhtech/mosaic/apps/api/internal/analytics"
)

var metricDefinitions = map[string]string{
	"placement_requests":                               "Accepted placement_requested events.",
	"placement_paywall_selected":                       "Accepted placement_paywall_selected events.",
	"placement_no_paywall":                             "Accepted placement_no_paywall events.",
	"placement_fallback_used":                          "Accepted placement_fallback_used events.",
	"placement_unavailable":                            "Accepted placement_unavailable events.",
	"paywall_presentations":                            "Accepted paywall_presented events.",
	"product_selections":                               "Accepted product_selected events.",
	"purchase_starts":                                  "Accepted purchase_started events.",
	"client_completed_purchases":                       "Accepted purchased purchase_completed_client events; already-entitled is excluded.",
	"provider_confirmed_purchases":                     "Accepted provider-confirmed purchase completions from a trusted source.",
	"purchase_cancelled":                               "Accepted purchase_cancelled events.",
	"purchase_failed":                                  "Accepted purchase_failed events.",
	"presentation_to_product_selection_rate":           "Presentations with a correlated Product selection divided by presentations.",
	"product_selection_to_purchase_start_rate":         "Product selections with a correlated purchase start divided by Product selections.",
	"presentation_to_purchase_start_rate":              "Presentations with a correlated purchase start divided by presentations.",
	"presentation_to_client_completed_purchase_rate":   "Presentations with a correlated purchased client completion divided by presentations; already-entitled is excluded.",
	"presentation_to_provider_confirmed_purchase_rate": "Presentations with a trusted provider-confirmed completion divided by presentations.",
	"purchase_cancellation_rate":                       "Cancelled purchase attempts divided by purchase starts.",
	"purchase_pending_rate":                            "Pending purchase attempts divided by purchase starts.",
	"purchase_deferred_rate":                           "Deferred purchase attempts divided by purchase starts.",
	"purchase_failure_rate":                            "Failed purchase attempts divided by purchase starts.",
	"product_unavailable_rate":                         "Product-unavailable events divided by completed and failed Product-load attempts.",
	"restore_completed":                                "Accepted restore_completed events.",
	"restore_nothing_found":                            "Accepted restore_nothing_found events.",
	"restore_cancelled":                                "Accepted restore_cancelled events.",
	"restore_failed":                                   "Accepted restore_failed events.",
	"provider_errors":                                  "Accepted Product-load, purchase, and restore failures with a provider attribution.",
}

type rawMetricExpression struct{ numerator, denominator string }

var rawMetricExpressions = map[string]rawMetricExpression{
	"placement_requests":                               {"COUNT(*) FILTER(WHERE event_name='placement_requested')", "NULL::bigint"},
	"placement_paywall_selected":                       {"COUNT(*) FILTER(WHERE event_name='placement_paywall_selected')", "NULL::bigint"},
	"placement_no_paywall":                             {"COUNT(*) FILTER(WHERE event_name='placement_no_paywall')", "NULL::bigint"},
	"placement_fallback_used":                          {"COUNT(*) FILTER(WHERE event_name='placement_fallback_used')", "NULL::bigint"},
	"placement_unavailable":                            {"COUNT(*) FILTER(WHERE event_name='placement_unavailable')", "NULL::bigint"},
	"paywall_presentations":                            {"COUNT(*) FILTER(WHERE event_name='paywall_presented')", "NULL::bigint"},
	"product_selections":                               {"COUNT(*) FILTER(WHERE event_name='product_selected')", "NULL::bigint"},
	"purchase_starts":                                  {"COUNT(*) FILTER(WHERE event_name='purchase_started')", "NULL::bigint"},
	"client_completed_purchases":                       {"COUNT(*) FILTER(WHERE event_name='purchase_completed_client' AND payload->>'outcome'='purchased')", "NULL::bigint"},
	"provider_confirmed_purchases":                     {"COUNT(*) FILTER(WHERE event_name='purchase_completed_provider' AND authority='provider_confirmed')", "NULL::bigint"},
	"purchase_cancelled":                               {"COUNT(*) FILTER(WHERE event_name='purchase_cancelled')", "NULL::bigint"},
	"purchase_failed":                                  {"COUNT(*) FILTER(WHERE event_name='purchase_failed')", "NULL::bigint"},
	"presentation_to_product_selection_rate":           {"COUNT(DISTINCT s.paywall_presentation_id) FILTER(WHERE s.event_name='paywall_presented' AND EXISTS(SELECT 1 FROM window_source d WHERE d.event_name='product_selected' AND d.paywall_presentation_id=s.paywall_presentation_id AND d.occurred_at>=s.occurred_at AND d.occurred_at<=s.occurred_at+interval '24 hours'))", "COUNT(DISTINCT s.paywall_presentation_id) FILTER(WHERE s.event_name='paywall_presented')"},
	"product_selection_to_purchase_start_rate":         {"COUNT(DISTINCT s.paywall_presentation_id) FILTER(WHERE s.event_name='product_selected' AND EXISTS(SELECT 1 FROM window_source d WHERE d.event_name='purchase_started' AND d.paywall_presentation_id=s.paywall_presentation_id AND d.occurred_at>=s.occurred_at AND d.occurred_at<=s.occurred_at+interval '24 hours'))", "COUNT(DISTINCT s.paywall_presentation_id) FILTER(WHERE s.event_name='product_selected')"},
	"presentation_to_purchase_start_rate":              {"COUNT(DISTINCT s.paywall_presentation_id) FILTER(WHERE s.event_name='paywall_presented' AND EXISTS(SELECT 1 FROM window_source d WHERE d.event_name='purchase_started' AND d.paywall_presentation_id=s.paywall_presentation_id AND d.occurred_at>=s.occurred_at AND d.occurred_at<=s.occurred_at+interval '24 hours'))", "COUNT(DISTINCT s.paywall_presentation_id) FILTER(WHERE s.event_name='paywall_presented')"},
	"presentation_to_client_completed_purchase_rate":   {"COUNT(DISTINCT s.paywall_presentation_id) FILTER(WHERE s.event_name='paywall_presented' AND EXISTS(SELECT 1 FROM window_source d WHERE d.event_name='purchase_completed_client' AND d.payload->>'outcome'='purchased' AND d.paywall_presentation_id=s.paywall_presentation_id AND d.occurred_at>=s.occurred_at AND d.occurred_at<=s.occurred_at+interval '24 hours'))", "COUNT(DISTINCT s.paywall_presentation_id) FILTER(WHERE s.event_name='paywall_presented')"},
	"presentation_to_provider_confirmed_purchase_rate": {"COUNT(DISTINCT s.paywall_presentation_id) FILTER(WHERE s.event_name='paywall_presented' AND EXISTS(SELECT 1 FROM window_source d WHERE d.event_name='purchase_completed_provider' AND d.authority='provider_confirmed' AND d.paywall_presentation_id=s.paywall_presentation_id AND d.occurred_at>=s.occurred_at AND d.occurred_at<=s.occurred_at+interval '24 hours'))", "COUNT(DISTINCT s.paywall_presentation_id) FILTER(WHERE s.event_name='paywall_presented')"},
	"purchase_cancellation_rate":                       {"COUNT(DISTINCT s.purchase_attempt_id) FILTER(WHERE s.event_name='purchase_started' AND EXISTS(SELECT 1 FROM window_source d WHERE d.event_name='purchase_cancelled' AND d.purchase_attempt_id=s.purchase_attempt_id AND d.occurred_at>=s.occurred_at AND d.occurred_at<=s.occurred_at+interval '24 hours'))", "COUNT(DISTINCT s.purchase_attempt_id) FILTER(WHERE s.event_name='purchase_started')"},
	"purchase_pending_rate":                            {"COUNT(DISTINCT s.purchase_attempt_id) FILTER(WHERE s.event_name='purchase_started' AND EXISTS(SELECT 1 FROM window_source d WHERE d.event_name='purchase_pending' AND d.purchase_attempt_id=s.purchase_attempt_id AND d.occurred_at>=s.occurred_at AND d.occurred_at<=s.occurred_at+interval '24 hours'))", "COUNT(DISTINCT s.purchase_attempt_id) FILTER(WHERE s.event_name='purchase_started')"},
	"purchase_deferred_rate":                           {"COUNT(DISTINCT s.purchase_attempt_id) FILTER(WHERE s.event_name='purchase_started' AND EXISTS(SELECT 1 FROM window_source d WHERE d.event_name='purchase_deferred' AND d.purchase_attempt_id=s.purchase_attempt_id AND d.occurred_at>=s.occurred_at AND d.occurred_at<=s.occurred_at+interval '24 hours'))", "COUNT(DISTINCT s.purchase_attempt_id) FILTER(WHERE s.event_name='purchase_started')"},
	"purchase_failure_rate":                            {"COUNT(DISTINCT s.purchase_attempt_id) FILTER(WHERE s.event_name='purchase_started' AND EXISTS(SELECT 1 FROM window_source d WHERE d.event_name='purchase_failed' AND d.purchase_attempt_id=s.purchase_attempt_id AND d.occurred_at>=s.occurred_at AND d.occurred_at<=s.occurred_at+interval '24 hours'))", "COUNT(DISTINCT s.purchase_attempt_id) FILTER(WHERE s.event_name='purchase_started')"},
	"product_unavailable_rate":                         {"COUNT(*) FILTER(WHERE event_name='product_unavailable')", "COUNT(*) FILTER(WHERE event_name IN('product_load_completed','product_load_failed'))"},
	"restore_completed":                                {"COUNT(*) FILTER(WHERE event_name='restore_completed')", "NULL::bigint"},
	"restore_nothing_found":                            {"COUNT(*) FILTER(WHERE event_name='restore_nothing_found')", "NULL::bigint"},
	"restore_cancelled":                                {"COUNT(*) FILTER(WHERE event_name='restore_cancelled')", "NULL::bigint"},
	"restore_failed":                                   {"COUNT(*) FILTER(WHERE event_name='restore_failed')", "NULL::bigint"},
	"provider_errors":                                  {"COUNT(*) FILTER(WHERE event_name IN('product_load_failed','purchase_failed','restore_failed') AND provider IS NOT NULL)", "NULL::bigint"},
}

func (r *Repository) Query(ctx context.Context, actor analytics.Actor, query analytics.Query, metricIDs []string) (analytics.AnalyticsResult, error) {
	if err := r.authorizeEnvironmentScope(ctx, actor, query.ProjectID, query.EnvironmentID); err != nil {
		return analytics.AnalyticsResult{}, err
	}
	if len(metricIDs) == 0 {
		for id := range metricDefinitions {
			metricIDs = append(metricIDs, id)
		}
	}
	result := analytics.AnalyticsResult{Metrics: make([]analytics.Metric, 0, len(metricIDs)), Freshness: analytics.Freshness{LateEventPolicy: analytics.LateEventPolicy}}
	_ = r.pool.QueryRow(ctx, `SELECT latest_received_at,latest_aggregated_at FROM analytics_aggregate_watermarks WHERE environment_id=$1`, query.EnvironmentID).Scan(&result.Freshness.LatestReceivedAt, &result.Freshness.LatestAggregatedAt)
	if len(metricIDs) == 1 && len(metricIDs[0]) > 2 && metricIDs[0][:2] == "__" {
		if metricIDs[0] == "__freshness" {
			return result, nil
		}
		metrics, err := r.queryDimensions(ctx, query, metricIDs[0])
		result.Metrics = metrics
		return result, err
	}
	for _, id := range metricIDs {
		definition, ok := metricDefinitions[id]
		if !ok {
			continue
		}
		metric := analytics.Metric{ID: id, Basis: "event_count", Authority: "client_observed", AttributionWindow: "24h", Timezone: query.Timezone, Definition: definition}
		if id == "provider_confirmed_purchases" || id == "presentation_to_provider_confirmed_purchase_rate" {
			metric.Authority = "provider_confirmed"
			metric.Warnings = []string{"provider_confirmed_unavailable"}
			result.Metrics = append(result.Metrics, metric)
			continue
		}
		var numerator int64
		var denominator *int64
		numerator, denominator, err := r.metricCounts(ctx, query, id)
		if err != nil {
			return result, err
		}
		metric.Numerator = numerator
		metric.Denominator = denominator
		value := float64(numerator)
		if denominator != nil {
			if *denominator == 0 {
				value = 0
			} else {
				value = float64(numerator) / float64(*denominator)
			}
		}
		metric.Value = &value
		if id == "paywall_presentations" && numerator < 100 {
			metric.Warnings = append(metric.Warnings, "low_data")
		}
		result.Metrics = append(result.Metrics, metric)
	}
	return result, nil
}

// DailySeries reads the completed daily funnel buckets for several metrics in
// one grouped statement.
//
// One statement, not one per day and not one per metric: this backs a chart
// whose x-axis length is caller-selectable, and a per-day round trip would make
// a 90-day chart ninety times the cost of a 1-day one for the same rows.
//
// analytics_daily_funnel_counts_query_idx(environment_id, bucket_date,
// metric_id) covers the predicate, so the read is an index range scan over the
// requested days rather than a scan of the Environment's aggregate history.
//
// The funnel table declares dimension columns — platform, locale, placement,
// paywall version, product, provider — but RunAggregation never writes them, so
// every row is the undimensioned daily total and the SUM collapses only the
// per-metric rows. That is exactly what the complete-day branch of metricCounts
// does for a scalar window. A filtered request is therefore served from
// analytics_daily_event_counts instead, which is written at full dimension
// grain; see dimensionedDailySeries. A denominator is NULL for count metrics
// and for a day with no rows; it is summed only when at least one row carries
// one, so a rate with no denominator stays distinguishable from a rate of zero.
func (r *Repository) DailySeries(ctx context.Context, actor analytics.Actor, query analytics.Query,
	metricIDs []string) (analytics.DailySeriesResult, error) {

	if err := r.authorizeEnvironmentScope(ctx, actor, query.ProjectID, query.EnvironmentID); err != nil {
		return analytics.DailySeriesResult{}, err
	}
	result := analytics.DailySeriesResult{
		Points:    []analytics.DailyMetricPoint{},
		Freshness: analytics.Freshness{LateEventPolicy: analytics.LateEventPolicy},
	}
	_ = r.pool.QueryRow(ctx, `SELECT latest_received_at,latest_aggregated_at FROM analytics_aggregate_watermarks WHERE environment_id=$1`,
		query.EnvironmentID).Scan(&result.Freshness.LatestReceivedAt, &result.Freshness.LatestAggregatedAt)

	known := make([]string, 0, len(metricIDs))
	for _, id := range metricIDs {
		if _, ok := metricDefinitions[id]; ok {
			known = append(known, id)
		}
	}
	if len(known) == 0 {
		return result, nil
	}
	if analytics.SeriesFiltered(query) {
		points, err := r.dimensionedDailySeries(ctx, query, known)
		if err != nil {
			return analytics.DailySeriesResult{}, err
		}
		result.Points = points
		return result, nil
	}

	rows, err := r.pool.Query(ctx, `SELECT bucket_date,metric_id,COALESCE(SUM(numerator),0),
			CASE WHEN COUNT(denominator)=0 THEN NULL ELSE SUM(denominator) END
		FROM analytics_daily_funnel_counts
		WHERE environment_id=$1 AND bucket_date >= $2::date AND bucket_date < $3::date AND metric_id = ANY($4)
		GROUP BY bucket_date,metric_id
		ORDER BY bucket_date,metric_id`,
		query.EnvironmentID, utcDay(query.From), utcDay(query.To), known)
	if err != nil {
		return analytics.DailySeriesResult{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var point analytics.DailyMetricPoint
		if err = rows.Scan(&point.Date, &point.MetricID, &point.Numerator, &point.Denominator); err != nil {
			return analytics.DailySeriesResult{}, err
		}
		point.Date = utcDay(point.Date)
		result.Points = append(result.Points, point)
	}
	if err = rows.Err(); err != nil {
		return analytics.DailySeriesResult{}, err
	}
	return result, nil
}

// dailyEventExpression is a metric expressed over analytics_daily_event_counts.
//
// events narrows the index seek to the metric's own event names, so a filtered
// series reads the rows for one metric rather than the Environment's whole day.
// numerator and denominator are FILTER predicates over that narrowed set.
type dailyEventExpression struct {
	events                 []string
	numerator, denominator string
}

// dailyEventExpressions is the subset of the metric vocabulary that the
// dimensioned daily aggregate can answer.
//
// Membership is not a choice, it is the write grain:
// analytics_daily_event_counts groups by event name, authority, platform,
// locale, application version, placement, paywall version, product, and
// provider, and by nothing else. A metric whose definition needs a payload
// field — client_completed_purchases reads payload->>'outcome' to exclude
// already-entitled completions — or a correlation between two events cannot be
// recovered from it at any grain. analytics.SeriesMetricSpec.Dimensioned
// mirrors this set, and a test asserts the two agree.
var dailyEventExpressions = map[string]dailyEventExpression{
	"placement_requests":         {[]string{"placement_requested"}, "SUM(event_count)", ""},
	"placement_paywall_selected": {[]string{"placement_paywall_selected"}, "SUM(event_count)", ""},
	"placement_no_paywall":       {[]string{"placement_no_paywall"}, "SUM(event_count)", ""},
	"placement_fallback_used":    {[]string{"placement_fallback_used"}, "SUM(event_count)", ""},
	"placement_unavailable":      {[]string{"placement_unavailable"}, "SUM(event_count)", ""},
	"paywall_presentations":      {[]string{"paywall_presented"}, "SUM(event_count)", ""},
	"product_selections":         {[]string{"product_selected"}, "SUM(event_count)", ""},
	"purchase_starts":            {[]string{"purchase_started"}, "SUM(event_count)", ""},
	"purchase_cancelled":         {[]string{"purchase_cancelled"}, "SUM(event_count)", ""},
	"purchase_failed":            {[]string{"purchase_failed"}, "SUM(event_count)", ""},
	"restore_completed":          {[]string{"restore_completed"}, "SUM(event_count)", ""},
	"restore_nothing_found":      {[]string{"restore_nothing_found"}, "SUM(event_count)", ""},
	"restore_cancelled":          {[]string{"restore_cancelled"}, "SUM(event_count)", ""},
	"restore_failed":             {[]string{"restore_failed"}, "SUM(event_count)", ""},
	"provider_errors": {
		[]string{"product_load_failed", "purchase_failed", "restore_failed"},
		"SUM(event_count) FILTER(WHERE provider IS NOT NULL)", "",
	},
	"product_unavailable_rate": {
		[]string{"product_unavailable", "product_load_completed", "product_load_failed"},
		"SUM(event_count) FILTER(WHERE event_name='product_unavailable')",
		"SUM(event_count) FILTER(WHERE event_name IN('product_load_completed','product_load_failed'))",
	},
}

// dimensionedDailySeries answers a filtered series from the dimensioned daily
// event aggregate.
//
// One grouped statement per metric, never one per day: this backs a chart whose
// x-axis length is caller-selectable, and a per-day round trip would make a
// 90-day chart ninety times the cost of a 1-day one for the same rows.
// analytics_daily_event_counts_query_idx(environment_id, bucket_date,
// event_name) covers the seek; the dimension predicates are residual filters
// over the handful of rows a day holds for one event name.
//
// A metric outside dailyEventExpressions is refused rather than answered from
// the undimensioned funnel table. Serving unfiltered totals under a filtered
// heading would be indistinguishable from a correct answer, and the reader
// would act on it.
func (r *Repository) dimensionedDailySeries(ctx context.Context, query analytics.Query,
	metricIDs []string) ([]analytics.DailyMetricPoint, error) {

	points := []analytics.DailyMetricPoint{}
	for _, id := range metricIDs {
		expression, ok := dailyEventExpressions[id]
		if !ok {
			return nil, &analytics.UnsupportedDimensionError{
				Dimension: "platform, locale, or applicationVersion", MetricIDs: []string{id},
			}
		}
		denominator := "NULL::bigint"
		if expression.denominator != "" {
			denominator = "COALESCE(" + expression.denominator + ",0)"
		}
		rows, err := r.pool.Query(ctx, `SELECT bucket_date,COALESCE(`+expression.numerator+`,0),`+denominator+`
			FROM analytics_daily_event_counts
			WHERE environment_id=$1 AND bucket_date >= $2::date AND bucket_date < $3::date
				AND event_name = ANY($4)
				AND ($5='' OR platform=$5) AND ($6='' OR locale=$6) AND ($7='' OR application_version=$7)
			GROUP BY bucket_date ORDER BY bucket_date`,
			query.EnvironmentID, utcDay(query.From), utcDay(query.To), expression.events,
			query.Platform, query.Locale, query.ApplicationVersion)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			point := analytics.DailyMetricPoint{MetricID: id}
			if err = rows.Scan(&point.Date, &point.Numerator, &point.Denominator); err != nil {
				rows.Close()
				return nil, err
			}
			point.Date = utcDay(point.Date)
			points = append(points, point)
		}
		rows.Close()
		if err = rows.Err(); err != nil {
			return nil, err
		}
	}
	return points, nil
}

// authorizeEnvironmentScope applies the analytics read bar and refuses an
// Environment that belongs to another Project.
//
// The containment half is not optional. Every count below filters on
// environment_id alone, so without it a member of one Project could pair their
// own projectId with another Project's environmentId and read its numbers.
func (r *Repository) authorizeEnvironmentScope(ctx context.Context, actor analytics.Actor,
	projectID, environmentID string) error {

	if _, err := requireRole(ctx, r.pool, actor, projectID, "owner", "admin", "member"); err != nil {
		return err
	}
	var project string
	err := r.pool.QueryRow(ctx, `SELECT project_id FROM environments WHERE id=$1`, environmentID).Scan(&project)
	if errors.Is(err, pgx.ErrNoRows) || err == nil && project != projectID {
		return analytics.ErrNotFound
	}
	return err
}

func utcDay(value time.Time) time.Time {
	value = value.UTC()
	return time.Date(value.Year(), value.Month(), value.Day(), 0, 0, 0, 0, time.UTC)
}

func completeUTCDays(from, to time.Time) (time.Time, time.Time) {
	start := utcDay(from)
	if from.UTC().After(start) {
		start = start.Add(24 * time.Hour)
	}
	return start, utcDay(to)
}

func (r *Repository) metricCounts(ctx context.Context, query analytics.Query, metricID string) (int64, *int64, error) {
	if query.Platform != "" || query.Locale != "" || query.ApplicationVersion != "" {
		return r.rawMetricCounts(ctx, query, metricID, query.From, query.To)
	}
	fullStart, fullEnd := completeUTCDays(query.From, query.To)
	if fullEnd.Before(fullStart) {
		fullEnd = fullStart
	}
	var numerator, denominator int64
	hasDenominator := false
	add := func(partNumerator int64, partDenominator *int64) {
		numerator += partNumerator
		if partDenominator != nil {
			denominator += *partDenominator
			hasDenominator = true
		}
	}
	firstEnd := fullStart
	if firstEnd.After(query.To) {
		firstEnd = query.To
	}
	if query.From.Before(firstEnd) {
		partNumerator, partDenominator, err := r.rawMetricCounts(ctx, query, metricID, query.From, firstEnd)
		if err != nil {
			return 0, nil, err
		}
		add(partNumerator, partDenominator)
	}
	if fullStart.Before(fullEnd) {
		var partNumerator int64
		var partDenominator *int64
		err := r.pool.QueryRow(ctx, `SELECT COALESCE(SUM(numerator),0),CASE WHEN COUNT(denominator)=0 THEN NULL ELSE SUM(denominator) END FROM analytics_daily_funnel_counts WHERE environment_id=$1 AND bucket_date >= $2::date AND bucket_date < $3::date AND metric_id=$4 AND ($5='' OR platform=$5) AND ($6='' OR locale=$6)`, query.EnvironmentID, fullStart, fullEnd, metricID, query.Platform, query.Locale).Scan(&partNumerator, &partDenominator)
		if err != nil {
			return 0, nil, err
		}
		add(partNumerator, partDenominator)
	}
	lastStart := fullEnd
	if lastStart.Before(query.From) {
		lastStart = query.From
	}
	if lastStart.Before(query.To) && !lastStart.Before(firstEnd) {
		partNumerator, partDenominator, err := r.rawMetricCounts(ctx, query, metricID, lastStart, query.To)
		if err != nil {
			return 0, nil, err
		}
		add(partNumerator, partDenominator)
	}
	if !hasDenominator {
		return numerator, nil, nil
	}
	return numerator, &denominator, nil
}

func (r *Repository) rawMetricCounts(ctx context.Context, query analytics.Query, metricID string, from, to time.Time) (int64, *int64, error) {
	expression, ok := rawMetricExpressions[metricID]
	if !ok {
		return 0, nil, analytics.ErrInvalidBatch
	}
	var numerator int64
	var denominator *int64
	err := r.pool.QueryRow(ctx, `WITH source AS (SELECT * FROM analytics_events WHERE environment_id=$1 AND occurred_at >= $2 AND occurred_at < $3 AND ($4='' OR platform=$4) AND ($5='' OR locale=$5) AND ($6='' OR application_version=$6)), window_source AS (SELECT * FROM analytics_events WHERE environment_id=$1 AND occurred_at >= $2 AND occurred_at < $3::timestamptz+interval '24 hours' AND ($4='' OR platform=$4) AND ($5='' OR locale=$5) AND ($6='' OR application_version=$6)) SELECT `+expression.numerator+`,`+expression.denominator+` FROM source s`, query.EnvironmentID, from, to, query.Platform, query.Locale, query.ApplicationVersion).Scan(&numerator, &denominator)
	return numerator, denominator, err
}

func (r *Repository) queryDimensions(ctx context.Context, query analytics.Query, view string) ([]analytics.Metric, error) {
	if view == "__paywall_versions" {
		return r.queryPaywallVersionComparison(ctx, query)
	}
	if view == "__provider_errors" || view == "__product_failures" {
		return r.queryIssues(ctx, query, view)
	}
	dimension, predicate, metricID, definition := "platform", "TRUE", "events", "Accepted analytics events grouped by platform."
	switch view {
	case "__locales":
		dimension, metricID, definition = "locale", "events", "Accepted analytics events grouped by locale."
	case "__platforms":
	default:
		return nil, analytics.ErrInvalidBatch
	}
	counts, err := r.dimensionCounts(ctx, query, dimension, predicate)
	if err != nil {
		return nil, err
	}
	keys := make([]string, 0, len(counts))
	for key := range counts {
		if key != "" {
			keys = append(keys, key)
		}
	}
	sort.Slice(keys, func(i, j int) bool {
		if counts[keys[i]] == counts[keys[j]] {
			return keys[i] < keys[j]
		}
		return counts[keys[i]] > counts[keys[j]]
	})
	metrics := []analytics.Metric{}
	for _, value := range keys {
		count := counts[value]
		numeric := float64(count)
		metrics = append(metrics, analytics.Metric{ID: metricID, Value: &numeric, Numerator: count, Basis: "event_count", Authority: "client_observed", AttributionWindow: "24h", Timezone: query.Timezone, Definition: definition, Dimensions: map[string]string{dimension: value}})
	}
	return metrics, nil
}

func (r *Repository) queryPaywallVersionComparison(ctx context.Context, query analytics.Query) ([]analytics.Metric, error) {
	rows, err := r.pool.Query(ctx, `WITH presentations AS (
		SELECT paywall_version_id,paywall_presentation_id,occurred_at FROM analytics_events
		WHERE environment_id=$1 AND occurred_at >= $2 AND occurred_at < $3
		AND event_name='paywall_presented' AND paywall_version_id IS NOT NULL
		AND ($4='' OR platform=$4) AND ($5='' OR locale=$5) AND ($6='' OR application_version=$6)
	), completions AS (
		SELECT paywall_presentation_id,occurred_at FROM analytics_events
		WHERE environment_id=$1 AND occurred_at >= $2 AND occurred_at < $3::timestamptz+interval '24 hours'
		AND event_name='purchase_completed_client' AND payload->>'outcome'='purchased'
		AND ($4='' OR platform=$4) AND ($5='' OR locale=$5) AND ($6='' OR application_version=$6)
	)
	SELECT paywall_version_id,COUNT(*),
		COUNT(DISTINCT paywall_presentation_id) FILTER(WHERE EXISTS(
			SELECT 1 FROM completions c WHERE c.paywall_presentation_id=presentations.paywall_presentation_id
			AND c.occurred_at>=presentations.occurred_at AND c.occurred_at<=presentations.occurred_at+interval '24 hours'))
	FROM presentations GROUP BY paywall_version_id ORDER BY paywall_version_id`, query.EnvironmentID, query.From, query.To, query.Platform, query.Locale, query.ApplicationVersion)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	metrics := []analytics.Metric{}
	for rows.Next() {
		var versionID string
		var presentations, completions int64
		if err = rows.Scan(&versionID, &presentations, &completions); err != nil {
			return nil, err
		}
		presentationValue := float64(presentations)
		denominator := presentations
		conversionValue := float64(0)
		if presentations > 0 {
			conversionValue = float64(completions) / float64(presentations)
		}
		dimensions := map[string]string{"paywall_version_id": versionID}
		metrics = append(metrics,
			analytics.Metric{ID: "paywall_presentations", Value: &presentationValue, Numerator: presentations, Basis: "event_count", Authority: "client_observed", AttributionWindow: "24h", Timezone: query.Timezone, Definition: metricDefinitions["paywall_presentations"], Dimensions: dimensions},
			analytics.Metric{ID: "presentation_to_client_completed_purchase_rate", Value: &conversionValue, Numerator: completions, Denominator: &denominator, Basis: "event_count", Authority: "client_observed", AttributionWindow: "24h", Timezone: query.Timezone, Definition: metricDefinitions["presentation_to_client_completed_purchase_rate"], Warnings: lowDataWarning(presentations), Dimensions: dimensions},
		)
	}
	return metrics, rows.Err()
}

func lowDataWarning(presentations int64) []string {
	if presentations < 100 {
		return []string{"low_data"}
	}
	return nil
}

func (r *Repository) queryIssues(ctx context.Context, query analytics.Query, view string) ([]analytics.Metric, error) {
	metricID, predicate, primary, detail := "provider_errors", "event_name IN('product_load_failed','purchase_failed','restore_failed') AND provider IS NOT NULL", "provider", "COALESCE(payload->>'diagnosticCode','unspecified')"
	definition := metricDefinitions["provider_errors"]
	if view == "__product_failures" {
		metricID, predicate, primary, detail = "product_unavailable", "event_name='product_unavailable' AND product_id IS NOT NULL", "product_id", "COALESCE(payload->>'reason','unspecified')"
		definition = "Accepted product_unavailable events grouped by Mosaic Product and safe reason."
	}
	rows, err := r.pool.Query(ctx, `SELECT `+primary+`,`+detail+`,platform,COUNT(*) FROM analytics_events
		WHERE environment_id=$1 AND occurred_at >= $2 AND occurred_at < $3 AND `+predicate+`
		AND ($4='' OR platform=$4) AND ($5='' OR locale=$5) AND ($6='' OR application_version=$6)
		GROUP BY `+primary+`,`+detail+`,platform ORDER BY COUNT(*) DESC,`+primary+`,`+detail+`,platform`, query.EnvironmentID, query.From, query.To, query.Platform, query.Locale, query.ApplicationVersion)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	metrics := []analytics.Metric{}
	for rows.Next() {
		var primaryValue, detailValue, platform string
		var count int64
		if err = rows.Scan(&primaryValue, &detailValue, &platform, &count); err != nil {
			return nil, err
		}
		value := float64(count)
		dimensions := map[string]string{"platform": platform}
		if view == "__provider_errors" {
			dimensions["provider"], dimensions["diagnostic_code"] = primaryValue, detailValue
		} else {
			dimensions["product_id"], dimensions["reason"] = primaryValue, detailValue
		}
		metrics = append(metrics, analytics.Metric{ID: metricID, Value: &value, Numerator: count, Basis: "event_count", Authority: "client_observed", AttributionWindow: "24h", Timezone: query.Timezone, Definition: definition, Dimensions: dimensions})
	}
	return metrics, rows.Err()
}

func (r *Repository) dimensionCounts(ctx context.Context, query analytics.Query, dimension, predicate string) (map[string]int64, error) {
	fullStart, fullEnd := completeUTCDays(query.From, query.To)
	if fullEnd.Before(fullStart) {
		fullEnd = fullStart
	}
	counts := map[string]int64{}
	read := func(raw bool, from, to time.Time) error {
		table, countColumn, timePredicate := "analytics_daily_event_counts", "SUM(event_count)", "bucket_date >= $2::date AND bucket_date < $3::date"
		if raw {
			table, countColumn, timePredicate = "analytics_events", "COUNT(*)", "occurred_at >= $2 AND occurred_at < $3"
		}
		rows, err := r.pool.Query(ctx, `SELECT COALESCE(`+dimension+`,''),COALESCE(`+countColumn+`,0) FROM `+table+` WHERE environment_id=$1 AND `+timePredicate+` AND `+predicate+` AND ($4='' OR platform=$4) AND ($5='' OR locale=$5) AND ($6='' OR application_version=$6) GROUP BY `+dimension, query.EnvironmentID, from, to, query.Platform, query.Locale, query.ApplicationVersion)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var key string
			var count int64
			if err = rows.Scan(&key, &count); err != nil {
				return err
			}
			counts[key] += count
		}
		return rows.Err()
	}
	firstEnd := fullStart
	if firstEnd.After(query.To) {
		firstEnd = query.To
	}
	if query.From.Before(firstEnd) {
		if err := read(true, query.From, firstEnd); err != nil {
			return nil, err
		}
	}
	if fullStart.Before(fullEnd) {
		if err := read(false, fullStart, fullEnd); err != nil {
			return nil, err
		}
	}
	lastStart := fullEnd
	if lastStart.Before(query.From) {
		lastStart = query.From
	}
	if lastStart.Before(query.To) && !lastStart.Before(firstEnd) {
		if err := read(true, lastStart, query.To); err != nil {
			return nil, err
		}
	}
	return counts, nil
}

func (r *Repository) PreviewIdentity(ctx context.Context, actor analytics.Actor, projectID, kind, identity string) (analytics.PrivacyPreview, string, error) {
	if _, err := requireRole(ctx, r.pool, actor, projectID, "owner"); err != nil {
		return analytics.PrivacyPreview{}, "", err
	}
	preview := analytics.PrivacyPreview{Kind: kind, RequestDigest: analytics.RequestDigest(projectID, kind, identity)}
	reference := ""
	var rows pgx.Rows
	var err error
	if kind == "application_user" {
		rows, err = r.pool.Query(ctx, `SELECT u.id,COUNT(DISTINCT e.row_id),COUNT(DISTINCT s.id),COALESCE(array_agg(DISTINCT e.environment_id) FILTER (WHERE e.environment_id IS NOT NULL),'{}') FROM analytics_application_users u LEFT JOIN analytics_events e ON e.application_user_id=u.id LEFT JOIN analytics_sessions s ON s.application_user_id=u.id WHERE u.project_id=$1 AND u.external_id=$2 GROUP BY u.id`, projectID, identity)
	} else {
		rows, err = r.pool.Query(ctx, `SELECT i.id,COUNT(DISTINCT e.row_id),COUNT(DISTINCT s.id),COALESCE(array_agg(DISTINCT e.environment_id) FILTER (WHERE e.environment_id IS NOT NULL),'{}') FROM analytics_installations i LEFT JOIN analytics_events e ON e.installation_id=i.id LEFT JOIN analytics_sessions s ON s.installation_id=i.id WHERE i.project_id=$1 AND i.external_id=$2 GROUP BY i.id`, projectID, identity)
	}
	if err != nil {
		return preview, "", err
	}
	defer rows.Close()
	count := 0
	for rows.Next() {
		count++
		if err = rows.Scan(&reference, &preview.AffectedEvents, &preview.AffectedSessions, &preview.AffectedEnvironmentIDs); err != nil {
			return preview, "", err
		}
	}
	if err = rows.Err(); err != nil {
		return preview, "", err
	}
	if count == 0 {
		return preview, "", analytics.ErrNotFound
	}
	if count > 1 {
		return preview, "", analytics.ErrConflict
	}
	return preview, reference, nil
}

func identityHash(reference string) [32]byte { return sha256.Sum256([]byte(reference)) }
func decodeDigest(value string) ([32]byte, error) {
	var result [32]byte
	decoded, err := hex.DecodeString(value)
	if err != nil || len(decoded) != 32 {
		return result, analytics.ErrInvalidBatch
	}
	copy(result[:], decoded)
	return result, nil
}

func (r *Repository) CreateExport(ctx context.Context, actor analytics.Actor, projectID, environmentID, kind, reference, format string, now, expires time.Time) (analytics.Job, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return analytics.Job{}, err
	}
	defer tx.Rollback(ctx)
	allowed := []string{"owner", "admin"}
	if kind != "events" {
		allowed = []string{"owner"}
	}
	includeIdentity := false
	experimentVersionID := ""
	if kind == "experiment" {
		parts := strings.Split(reference, "|")
		if len(parts) != 2 || (parts[1] != "true" && parts[1] != "false") {
			return analytics.Job{}, analytics.ErrInvalidBatch
		}
		includeIdentity = parts[1] == "true"
		allowed = []string{"owner", "admin"}
		if includeIdentity {
			allowed = []string{"owner"}
		}
	}
	org, err := requireRole(ctx, tx, actor, projectID, allowed...)
	if err != nil {
		return analytics.Job{}, err
	}
	if environmentID != "" {
		var found string
		if err = tx.QueryRow(ctx, `SELECT project_id FROM environments WHERE id=$1`, environmentID).Scan(&found); err != nil || found != projectID {
			return analytics.Job{}, analytics.ErrNotFound
		}
	}
	if kind == "experiment" {
		experimentID := strings.Split(reference, "|")[0]
		if err = tx.QueryRow(ctx, `SELECT active_version_id FROM experiments WHERE id=$1 AND project_id=$2 AND environment_id=$3 AND active_version_id IS NOT NULL`, experimentID, projectID, environmentID).Scan(&experimentVersionID); err != nil {
			return analytics.Job{}, analytics.ErrNotFound
		}
	}
	id, err := nextID(ctx, tx, "analytics_export")
	if err != nil {
		return analytics.Job{}, err
	}
	job := analytics.Job{ID: id, ProjectID: projectID, EnvironmentID: environmentID, Kind: kind, Status: "queued", Format: format, IdentityReferenceID: reference, RequestedByActorID: actor.ID, ExperimentVersionID: experimentVersionID, IncludeIdentity: includeIdentity, CreatedAt: now, UpdatedAt: now}
	if kind != "events" && kind != "experiment" {
		job.IdentityDigest = identityHash(reference)
	}
	_, err = tx.Exec(ctx, `INSERT INTO analytics_export_jobs(id,organization_id,project_id,environment_id,kind,identity_digest,identity_reference_id,status,format,available_at,requested_by_actor_id,created_at,updated_at,experiment_version_id,include_identity) VALUES($1,$2,$3,$4,$5,$6,$7,'queued',$8,$9,$10,$9,$9,$11,$12)`, id, org, projectID, nullable(environmentID), kind, digestOrNil(job.IdentityDigest, kind != "events" && kind != "experiment"), reference, format, now, actor.ID, nullable(experimentVersionID), includeIdentity)
	if err != nil {
		return job, err
	}
	if err = audit(ctx, tx, org, projectID, environmentID, actor.ID, "analytics.export_requested", id, nil, nil, nil, now); err != nil {
		return job, err
	}
	return job, tx.Commit(ctx)
}
func digestOrNil(value [32]byte, present bool) any {
	if !present {
		return nil
	}
	return value[:]
}

func (r *Repository) CreateDeletion(ctx context.Context, actor analytics.Actor, projectID, kind, reference, requestDigest string, now time.Time) (analytics.Job, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return analytics.Job{}, err
	}
	defer tx.Rollback(ctx)
	org, err := requireRole(ctx, tx, actor, projectID, "owner")
	if err != nil {
		return analytics.Job{}, err
	}
	requestHash, err := decodeDigest(requestDigest)
	if err != nil {
		return analytics.Job{}, err
	}
	id, err := nextID(ctx, tx, "analytics_delete")
	if err != nil {
		return analytics.Job{}, err
	}
	identityDigest := identityHash(reference)
	job := analytics.Job{ID: id, ProjectID: projectID, Kind: kind, Status: "queued", IdentityReferenceID: reference, IdentityDigest: identityDigest, RequestedByActorID: actor.ID, ConfirmedByActorID: actor.ID, CreatedAt: now, UpdatedAt: now}
	_, err = tx.Exec(ctx, `INSERT INTO analytics_deletion_jobs(id,organization_id,project_id,kind,identity_digest,identity_reference_id,request_digest,status,available_at,requested_by_actor_id,confirmed_by_actor_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,'queued',$8,$9,$9,$8,$8)`, id, org, projectID, kind, identityDigest[:], reference, requestHash[:], now, actor.ID)
	if err != nil {
		return job, err
	}
	if err = audit(ctx, tx, org, projectID, "", actor.ID, "analytics.deletion_requested", id, requestHash[:], nil, nil, now); err != nil {
		return job, err
	}
	return job, tx.Commit(ctx)
}

func audit(ctx context.Context, tx pgx.Tx, org, projectID, environmentID, actorID, action, jobID string, requestDigest []byte, eventCount, sessionCount *int64, now time.Time) error {
	id, err := nextID(ctx, tx, "privacy_audit")
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO analytics_privacy_audit_events(id,organization_id,project_id,environment_id,actor_id,action,job_id,request_digest,affected_event_count,affected_session_count,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, id, org, projectID, nullable(environmentID), actorID, action, nullable(jobID), requestDigest, eventCount, sessionCount, now, now.Add(analytics.AuditRetention))
	return err
}

func (r *Repository) Job(ctx context.Context, actor analytics.Actor, projectID, jobID string) (analytics.Job, error) {
	projectRole, _, err := role(ctx, r.pool, actor.ID, projectID)
	if err != nil {
		return analytics.Job{}, err
	}
	job, err := r.readJob(ctx, r.pool, projectID, jobID)
	if errors.Is(err, pgx.ErrNoRows) {
		return job, analytics.ErrNotFound
	}
	if err != nil {
		return job, err
	}
	if projectRole == "owner" || job.Kind == "events" && projectRole == "admin" {
		return job, nil
	}
	return analytics.Job{}, analytics.ErrForbidden
}

type rowQuerier interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func (r *Repository) readJob(ctx context.Context, q rowQuerier, projectID, jobID string) (analytics.Job, error) {
	var j analytics.Job
	var identity []byte
	err := q.QueryRow(ctx, `SELECT id,project_id,COALESCE(environment_id,''),kind,status,format,COALESCE(identity_reference_id,''),COALESCE(identity_digest,'\\x'::bytea),COALESCE(object_key,''),COALESCE(media_type,''),COALESCE(byte_length,0),COALESCE(row_count,0),requested_by_actor_id,created_at,updated_at,expires_at,NULL::timestamptz FROM analytics_export_jobs WHERE project_id=$1 AND id=$2 UNION ALL SELECT id,project_id,'',kind,status,'',identity_reference_id,identity_digest,'','',0,0,requested_by_actor_id,created_at,updated_at,NULL,completed_at FROM analytics_deletion_jobs WHERE project_id=$1 AND id=$2`, projectID, jobID).Scan(&j.ID, &j.ProjectID, &j.EnvironmentID, &j.Kind, &j.Status, &j.Format, &j.IdentityReferenceID, &identity, &j.ObjectKey, &j.MediaType, &j.ByteLength, &j.RowCount, &j.RequestedByActorID, &j.CreatedAt, &j.UpdatedAt, &j.ExpiresAt, &j.CompletedAt)
	if len(identity) == 32 {
		copy(j.IdentityDigest[:], identity)
	}
	return j, err
}

var _ analytics.Repository = (*Repository)(nil)
