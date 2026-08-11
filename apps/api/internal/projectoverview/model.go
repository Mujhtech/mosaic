package projectoverview

import (
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/analytics"
)

// Reason codes explaining why a metric carries no value. The set is closed and
// stable: the dashboard maps each one to a different piece of copy, and
// `metric_unavailable` is deliberately the only one that means "something
// broke" — the others are states nobody needs to act on.
const (
	// ReasonBillingDisabled is reported for every billing-derived metric when
	// the Project has billing turned off. It is never reported as a zero: a
	// disabled integration says nothing about how many customers exist.
	ReasonBillingDisabled = "billing_disabled"
	// ReasonAnalyticsCollectionDisabled is reported for every analytics-derived
	// metric when the Environment has collection turned off. It is the same code
	// the analytics endpoints already return, so the dashboard maps it once.
	ReasonAnalyticsCollectionDisabled = "analytics_collection_disabled"
	// ReasonMetricUnavailable is reported when the source of one metric could
	// not be read. The endpoint still answers, the other metrics still carry
	// values, and the failure is logged at error level.
	ReasonMetricUnavailable = "metric_unavailable"
	// ReasonNotMeasured is reported for a rate whose denominator is zero or
	// absent — nobody was shown a paywall in the window, so there is no
	// conversion to state. It is emphatically not a failure: a new or
	// low-traffic Environment hits it every day, and reporting it as
	// `metric_unavailable` would render an error state on a healthy Project
	// while reporting it as 0 would claim a measured collapse in something that
	// was never measured. The daily series takes the same position by returning
	// null for the identical condition, so the tile and the chart agree.
	ReasonNotMeasured = "not_measured"
)

// Authorities describe where a value came from, so a reader can tell a
// provider-validated count from something a client reported.
const (
	// AuthorityProviderValidated marks a count derived from validated Billing
	// Transaction Facts.
	AuthorityProviderValidated = "provider_validated"
	// AuthorityProjected marks a count derived from committed projection state
	// (snapshots and pointers) rather than from raw facts.
	AuthorityProjected = "projected"
	// AuthorityClientObserved marks a count derived from SDK-reported analytics
	// events. Mosaic cannot confirm these against a provider.
	AuthorityClientObserved = "client_observed"
)

// Scopes record what a metric actually counts over. Not every metric can be
// Environment-scoped: a Billing Customer is Project-scoped identity, and only
// its projected state is per Environment.
const (
	ScopeEnvironment = "environment"
)

// Metric is the tri-state every number on this surface is reported as.
//
// A metric is never silently zero. Either it has a value and Available is true,
// or it has no value, Available is false, and Reason says why. The distinction
// matters most for the case the dashboard would otherwise render identically:
// "nobody subscribed today" and "we could not read the subscription table"
// are different answers, and only one of them should make a founder worry.
type Metric struct {
	// Value is nil exactly when Available is false.
	Value     *float64 `json:"value"`
	Available bool     `json:"available"`
	Reason    string   `json:"reason,omitempty"`
	Authority string   `json:"authority"`
	Scope     string   `json:"scope"`
}

func available(value float64, authority string) Metric {
	return Metric{Value: &value, Available: true, Authority: authority, Scope: ScopeEnvironment}
}

func unavailable(reason, authority string) Metric {
	return Metric{Available: false, Reason: reason, Authority: authority, Scope: ScopeEnvironment}
}

// Window is a half-open instant range [From, To). Timezone is always "UTC":
// "today" on this surface is the UTC calendar day and never the viewer's local
// day, and the field exists so the dashboard can say so rather than guess.
type Window struct {
	From     time.Time `json:"from"`
	To       time.Time `json:"to"`
	Timezone string    `json:"timezone"`
}

// Empty reports a zero-length window. It is true only in the one instant per
// day when the request arrives exactly at midnight UTC, and it exists so no
// source is asked to aggregate over an empty range.
func (w Window) Empty() bool { return !w.To.After(w.From) }

// Windows are the two ranges every metric on this surface is measured over.
//
// Today deliberately ends at the request instant rather than at tomorrow's
// midnight. Reporting a full-day window would be a lie about what was counted,
// and it would also push the analytics read onto the daily aggregate table for
// a bucket the aggregation job has not finished, which reads as a silent zero.
type Windows struct {
	Today     Window `json:"today"`
	Yesterday Window `json:"yesterday"`
}

// NewWindows derives both windows from an instant. The caller passes the
// service clock so the boundary behaviour is testable without waiting for
// midnight.
func NewWindows(now time.Time) Windows {
	now = now.UTC()
	midnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	return Windows{
		Today:     Window{From: midnight, To: now, Timezone: "UTC"},
		Yesterday: Window{From: midnight.Add(-24 * time.Hour), To: midnight, Timezone: "UTC"},
	}
}

// CustomerCounts is the customer read, answered by one grouped query.
type CustomerCounts struct {
	Total, NewToday, NewYesterday int64
}

// SubscriptionStateCounts is the current-projection read, answered by one
// grouped query over the Environment's Subscription Instances joined to the
// snapshot each one currently points at.
type SubscriptionStateCounts struct {
	Active, Trialing, GracePeriod, BillingRetry int64
}

// SubscriptionFactCounts is the fact read, answered by one grouped query over
// the two windows.
type SubscriptionFactCounts struct {
	InitialPurchasesToday, InitialPurchasesYesterday int64
	TrialStartsToday, TrialStartsYesterday           int64
}

// DailyCount is one UTC day's count. Only days holding rows are returned; the
// service fills the rest with explicit zeros.
type DailyCount struct {
	// Day is the UTC midnight the count belongs to.
	Day   time.Time
	Count int64
}

// DailyFactCounts is one UTC day's fact-derived counts, both taken from the
// same grouped read so the two series cannot disagree about which day a
// provider statement fell on.
type DailyFactCounts struct {
	Day                           time.Time
	InitialPurchases, TrialStarts int64
}

// Metrics is a closed object, not a bag.
//
// Every group is a named field with a fixed set of tri-state members, so a
// reader can tell "this deployment cannot compute revenue" from "this response
// happened not to include revenue". Adding monetary groups later — `revenue`,
// `mrr` — is a purely additive change to this struct and to the schema, and
// breaks no existing consumer. Mosaic cannot compute them today because
// Transaction Facts carry no price or currency at all (see
// apps/api/migrations/00024_billing_facts_and_ledger.sql), so no placeholder is
// offered here: an always-unavailable money field would be indistinguishable
// from a broken one.
type Metrics struct {
	Customers      CustomerMetrics     `json:"customers"`
	Subscriptions  SubscriptionMetrics `json:"subscriptions"`
	Trials         TrialMetrics        `json:"trials"`
	BillingRetry   LifecycleMetrics    `json:"billingRetry"`
	GracePeriod    LifecycleMetrics    `json:"gracePeriod"`
	PaywallViews   WindowedMetrics     `json:"paywallViews"`
	PurchaseStarts WindowedMetrics     `json:"purchaseStarts"`
	Purchases      WindowedMetrics     `json:"purchases"`
	ConversionRate WindowedMetrics     `json:"conversionRate"`
}

// CustomerMetrics counts Billing Customers that hold committed entitlement
// state in this Environment.
//
// A Billing Customer row is Project-scoped — sandbox and production share one
// identity — so the Environment-scoped population is the set with a current
// entitlement pointer here. A customer created by a trusted identify call that
// has never had a purchase projected is therefore not counted, which is the
// honest answer for a per-Environment overview.
type CustomerMetrics struct {
	Total        Metric `json:"total"`
	NewToday     Metric `json:"newToday"`
	NewYesterday Metric `json:"newYesterday"`
}

// SubscriptionMetrics counts Subscription Instances whose current snapshot
// grants access, and the initial-purchase Facts observed in each window.
type SubscriptionMetrics struct {
	Active       Metric `json:"active"`
	NewToday     Metric `json:"newToday"`
	NewYesterday Metric `json:"newYesterday"`
}

// TrialMetrics counts Subscription Instances currently in the trialing
// lifecycle, and the offer-redemption Facts observed in each window. Mosaic
// records a trial start as an `offer_redeemed` Fact and the projector treats
// exactly that Fact kind as entering the trialing lifecycle, so the two halves
// of this group agree with each other by construction.
type TrialMetrics struct {
	Active           Metric `json:"active"`
	StartedToday     Metric `json:"startedToday"`
	StartedYesterday Metric `json:"startedYesterday"`
}

// LifecycleMetrics reports one current-lifecycle population.
type LifecycleMetrics struct {
	Active Metric `json:"active"`
}

// WindowedMetrics reports one measure over both windows.
type WindowedMetrics struct {
	Today     Metric `json:"today"`
	Yesterday Metric `json:"yesterday"`
}

// Overview is the endpoint payload.
type Overview struct {
	ProjectID     string  `json:"projectId"`
	EnvironmentID string  `json:"environmentId"`
	Windows       Windows `json:"windows"`
	Metrics       Metrics `json:"metrics"`
	// AnalyticsFreshness is the same watermark surface the analytics endpoints
	// publish. It is absent when the analytics read did not happen, because a
	// stale watermark rendered next to unavailable metrics reads as if the
	// numbers were merely old rather than missing.
	AnalyticsFreshness *analytics.Freshness `json:"analyticsFreshness,omitempty"`
}
