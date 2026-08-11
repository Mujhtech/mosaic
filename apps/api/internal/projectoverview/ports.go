package projectoverview

import (
	"context"

	"github.com/Mujhtech/mosaic/apps/api/internal/analytics"
)

// Actor is the dashboard principal reading the overview.
type Actor struct{ ID string }

// Repository is the billing read model behind this surface.
//
// Every method is a SELECT and every count is grouped: there is one query per
// source, not one per metric, because this endpoint renders on every visit to
// the overview page and a per-metric round trip would make the page's cost a
// function of how many tiles it shows.
type Repository interface {
	// Authorize checks the actor's organization role for the Project and that
	// the Environment belongs to it. Absent membership is reported as
	// ErrNotFound, matching every other Mosaic surface.
	//
	// It is deliberately not a billing check: the overview answers for Projects
	// with billing turned off, reporting the billing metrics as unavailable
	// rather than refusing the whole page.
	Authorize(ctx context.Context, actor Actor, projectID, environmentID string) error

	// BillingEnabled reports the Project's billing setting. Callers treat a
	// read failure as disabled, matching every other billing surface.
	BillingEnabled(ctx context.Context, projectID string) (bool, error)

	CustomerCounts(ctx context.Context, environmentID string, windows Windows) (CustomerCounts, error)
	SubscriptionStateCounts(ctx context.Context, environmentID string) (SubscriptionStateCounts, error)
	SubscriptionFactCounts(ctx context.Context, environmentID string, windows Windows) (SubscriptionFactCounts, error)

	// CustomerDailyCounts and SubscriptionFactDailyCounts answer the series
	// surface. Each is one grouped query over the whole requested range — a
	// per-day round trip would make a 90-day chart ninety times the cost of a
	// 7-day one — and each returns only the days that hold rows. The service
	// fills the gaps with explicit zeros, because a day with no purchases is a
	// day with zero purchases and must not become a hole in the chart.
	CustomerDailyCounts(ctx context.Context, environmentID string, window Window) ([]DailyCount, error)
	SubscriptionFactDailyCounts(ctx context.Context, environmentID string, window Window) ([]DailyFactCounts, error)
}

// AnalyticsReader is the port onto the analytics module, satisfied by
// *analytics.Service.
//
// The overview reads through the existing query machinery rather than through
// SQL of its own. A second aggregation path over the same daily buckets would
// eventually disagree with the analytics pages, and both would look
// authoritative.
type AnalyticsReader interface {
	Settings(ctx context.Context, actor analytics.Actor, projectID, environmentID string) (analytics.Settings, error)
	Query(ctx context.Context, actor analytics.Actor, query analytics.Query, metricIDs []string) (analytics.AnalyticsResult, error)
	// DailySeries reads completed daily buckets for a range of whole UTC days.
	// The day in progress is never requested through it: its bucket is
	// half-built, and the series reads that day live through Query instead.
	DailySeries(ctx context.Context, actor analytics.Actor, query analytics.Query, metricIDs []string) (analytics.DailySeriesResult, error)
}
