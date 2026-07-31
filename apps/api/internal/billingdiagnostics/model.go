// Package billingdiagnostics owns the Phase 9B projection health surface.
//
// It is a sibling of the Phase 9A billing health surface rather than an
// extension of it, because the two answer different questions. Billing health
// asks "is Mosaic still able to turn store notifications into facts?" —
// credentials, validation backlog, quarantine. Projection health asks "is the
// authoritative answer Mosaic gives about a customer's access still current?" —
// projection backlog, stale customers, unresolved identity, unknown
// entitlements, restore backlog, webhook backlog. An operator paged about one
// almost never wants the other's numbers mixed into the same object.
//
// Everything here is a count or a timestamp. Nothing on this surface can carry
// a customer value, an alias digest, a provider token, or a secret.
package billingdiagnostics

import "time"

// ProjectionHealth is the Environment-scoped projection health summary.
type ProjectionHealth struct {
	EnvironmentID  string `json:"environmentId"`
	BillingEnabled bool   `json:"billingEnabled"`

	// ActiveRuleVersion is the projection rule version new projections are
	// computed under; RuleVersionCount is how many exist. A count above one
	// with no replay in flight means a promotion was prepared and never run.
	ActiveRuleVersion int `json:"activeProjectionRuleVersion"`
	RuleVersionCount  int `json:"projectionRuleVersionCount"`

	// Projection backlog. Depth alone cannot distinguish a busy queue from a
	// stuck one, which is why the oldest age is the alerting signal.
	ProjectionQueueDepth    int64   `json:"projectionQueueDepth"`
	ProjectionOldestAgeSecs float64 `json:"projectionOldestQueuedAgeSeconds"`
	ProjectionFailedJobs    int64   `json:"projectionFailedJobs"`
	// ProjectionFailuresLastHour counts attempts that ended in failure, which
	// is a rate signal the queue depth cannot give: a scope that fails and
	// requeues forever keeps the depth at one.
	ProjectionFailuresLastHour int64 `json:"projectionFailuresLastHour"`

	// StaleCustomers have committed state older than the staleness threshold.
	StaleCustomers int64 `json:"staleCustomers"`
	// NeverProjectedCustomers exist but have no committed projection at all.
	NeverProjectedCustomers int64 `json:"neverProjectedCustomers"`

	// Identity. A conflict spike is a security-relevant signal, not a backlog.
	OpenIdentityConflicts int64 `json:"openIdentityConflicts"`
	FrozenLineages        int64 `json:"frozenLineages"`
	UnresolvedLineages    int64 `json:"unresolvedLineages"`

	// UnknownEntitlementEntries counts entries on current snapshots that state
	// `unknown`. It is the number that says how often Mosaic is declining to
	// answer, which no queue metric reports.
	UnknownEntitlementEntries int64 `json:"unknownEntitlementEntries"`

	RestoreBacklog      int64 `json:"restoreBacklog"`
	RestoreFailedJobs   int64 `json:"restoreFailedJobs"`
	WebhookBacklog      int64 `json:"webhookDeliveryBacklog"`
	WebhookExhausted    int64 `json:"webhookDeliveriesExhausted"`
	WebhookDestinations int64 `json:"activeWebhookDestinations"`

	LastProjectionCommittedAt *time.Time `json:"lastProjectionCommittedAt,omitempty"`
	ObservedAt                time.Time  `json:"observedAt"`
}

// StaleAfter is when a committed projection stops being treated as current for
// health purposes. It is deliberately the same threshold the read surfaces use
// to report a `stale` projection status, so an operator reading the dashboard
// and an SDK reading a snapshot disagree about nothing.
const StaleAfter = time.Hour
