// Package billinggrant owns the management of Product-to-Entitlement Grant
// Versions: listing a pair's history, previewing the impact of a change, and
// publishing a new immutable version (Phase 9B WP9, plan §5/§7, OD-8).
//
// Selection of the grant version in force at a purchase's effective time is not
// here — it belongs to `billingprojection`, which is what the projection engine
// reads. This package decides what may be written; that one decides what a
// written version means. Keeping the two apart is what stops the management
// surface from acquiring a second, subtly different notion of "the current
// grant".
package billinggrant

import (
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingprojection"
)

// Actor is the authenticated operator. Authorization is decided server-side
// against organization membership; no handler makes the decision.
type Actor struct{ ID string }

// Organization roles that may publish. Reading a pair's history is permitted to
// any member of the owning organization; publishing is not.
const (
	RoleOwner = "owner"
	RoleAdmin = "admin"
)

// GrantPolicyVersion is the access-policy vocabulary these versions are written
// under (plan §7, policy version 1). It is recorded on every version so a later
// policy vocabulary does not silently reinterpret what an operator approved.
const GrantPolicyVersion = 1

// Purchase types a grant version may support. The set is closed because a grant
// that supports a purchase type Mosaic never projects is a grant that is
// configured and permanently inert.
const (
	PurchaseTypeAutoRenewable = "auto_renewable_subscription"
	PurchaseTypeNonConsumable = "non_consumable"
)

// DefaultPurchaseTypes matches the column default in migration 00033.
func DefaultPurchaseTypes() []string {
	return []string{PurchaseTypeAutoRenewable, PurchaseTypeNonConsumable}
}

// Version is one immutable Product-to-Entitlement grant interval as the
// management surface reports it. Intervals are half-open: [start, end).
type Version struct {
	ID             string
	ProjectID      string
	ProductID      string
	ProductKey     string
	EntitlementID  string
	EntitlementKey string

	Version            int
	GrantPolicyVersion int
	EffectiveStart     time.Time
	// EffectiveEnd is nil for the current, open-ended version.
	EffectiveEnd *time.Time

	SupportedPurchaseTypes []string
	Policy                 billingprojection.Policy

	CreatedAt        time.Time
	CreatedByActorID string
	Reason           string
	// Retroactive records that this version was published with a start in the
	// past under the additive-superset rule. It is derived from the audit trail
	// at publish time and carried on the response so the dashboard can label the
	// row without re-deriving the comparison.
	Retroactive bool
}

// Current reports whether this version is the open-ended one.
func (v Version) Current() bool { return v.EffectiveEnd == nil }

// PublishInput is one proposed grant version.
//
// There is deliberately no version number and no identifier: both are assigned
// by the publish transaction under the pair's advisory lock, so a caller cannot
// choose where in the history its change lands.
type PublishInput struct {
	ProductID     string
	EntitlementID string
	// EffectiveStart is the instant the new meaning takes effect. Prospective
	// publishing requires it to be now or later; a retroactive correction may
	// name a past instant and is then held to the additive-superset rule.
	EffectiveStart time.Time
	Retroactive    bool

	SupportedPurchaseTypes []string
	Policy                 billingprojection.Policy
	// GrantsInPaused is accepted only so it can be refused with a sentence. The
	// projection Policy has no such field because paused access is not a policy
	// question — Google's pause never grants — and the schema CHECK says the
	// same. Dropping the member instead would let a caller believe Mosaic had
	// read a setting it silently ignored.
	GrantsInPaused bool
	Reason         string
}

// Plan is what a validated publish will do. It exists so the decision and the
// write are separable: the decision is pure and testable, the write is a
// transaction that applies a decision it did not make.
type Plan struct {
	// NextVersion is the version number the new row takes.
	NextVersion int
	// SupersededVersionID is the open version to close, or empty when the pair
	// has no open version (it currently grants nothing).
	SupersededVersionID string
	// SupersededAt is the instant the superseded version closes: exactly the new
	// version's effective start, so the two intervals abut with no gap and no
	// overlap.
	SupersededAt time.Time
}

// Impact is the read-only preview of what a change would touch.
//
// Every number is counted from committed state at the moment of the call and
// nothing is written, so an operator can ask the question as often as they like
// before deciding. The counts are deliberately of *current* state: a preview
// that included historical snapshots would report a number no operator action
// can change.
type Impact struct {
	ProductID     string
	EntitlementID string
	// ImpactedProducts is 1 for a grant version — the pair names one Product —
	// but is reported explicitly rather than assumed, because a Product with
	// replacement predecessors reaches more catalog rows than its own id.
	ImpactedProducts int
	// ImpactedEntitlements is the number of Entitlements whose current meaning
	// for this Product would change.
	ImpactedEntitlements int
	// ImpactedCustomers is the number of Billing Customers whose current
	// entitlement snapshot cites this Product as a source. These are the
	// customers a reprojection would recompute.
	ImpactedCustomers int
	// ImpactedActiveSources is how many of those citations are currently
	// granting access. It is the number that answers "how many people could
	// lose access if I get this wrong?", which the customer count alone does
	// not.
	ImpactedActiveSources int
	// ImpactedLineages is the number of purchase lineages resolved to this
	// Product, including ones with no customer resolved yet — purchases that
	// would be affected but are invisible in the customer count.
	ImpactedLineages int
	// CurrentVersion describes the version being superseded, or nil when the
	// pair currently grants nothing.
	CurrentVersion *Version
	// Retroactive echoes whether the previewed change was marked retroactive.
	Retroactive bool
	// AdditiveSuperset is meaningful only for a retroactive preview: it reports
	// whether the proposed policy passes the widen-only rule. A preview never
	// refuses; it reports, and the publish refuses.
	AdditiveSuperset bool
	// NarrowingCode names the first narrowing found when AdditiveSuperset is
	// false, using the engine's own vocabulary.
	NarrowingCode string
	ObservedAt    time.Time
}

// ListFilter bounds a history read.
type ListFilter struct {
	ProductID     string
	EntitlementID string
	// VersionID reads exactly one recorded version by id, ignoring the pair
	// filters. It is how the immutability answer identifies what the caller
	// tried to edit.
	VersionID string
	// IncludeHistory returns closed versions as well as the current one. The
	// default is the whole history, because "what does this Product grant?" and
	// "what did it grant when that purchase was made?" are the same question
	// asked at two instants, and only the second is ever in dispute.
	CurrentOnly bool
	Limit       int
}

// MaxListLimit bounds one history page.
const MaxListLimit = 200

// Bounded clamps a filter to what the surface will serve.
func (f ListFilter) Bounded() ListFilter {
	if f.Limit <= 0 || f.Limit > MaxListLimit {
		f.Limit = MaxListLimit
	}
	return f
}
