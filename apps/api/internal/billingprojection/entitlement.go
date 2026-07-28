package billingprojection

import (
	"sort"
	"time"
)

// EntitlementSource is one reason a customer has (or may have) an Entitlement.
// Its identity is (lineage, product, grant version) — never a fact id — so two
// facts describing one purchase (mapping drift, a validator bump, a duplicate
// delivery) cannot produce two grants.
type EntitlementSource struct {
	EntitlementID     string
	EntitlementKey    string
	PurchaseLineageID string
	ProductID         string
	GrantVersionID    string

	SubscriptionInstanceID     string
	OneTimePurchaseInstanceID  string
	SourceSubscriptionSnapshot string

	SourceType  string
	SourceState string
	SourceStart *time.Time
	SourceEnd   *time.Time
	// EndKnown distinguishes "this source ends at time T" from "this source
	// has no end". A valid lifetime purchase is the second, and reporting it
	// as the first would promise an expiry that will never arrive.
	EndKnown bool

	UncertaintyReason string
	IsTestSource      bool
	ExplanationCode   string
}

func (s EntitlementSource) sortKey() string {
	return s.EntitlementID + "|" + s.PurchaseLineageID + "|" + s.GrantVersionID
}

// EntitlementEntry is the aggregated authoritative state of one Entitlement.
type EntitlementEntry struct {
	EntitlementID     string
	EntitlementKey    string
	State             string
	EffectiveStart    *time.Time
	EffectiveEnd      *time.Time
	EndKnown          bool
	SourceCount       int
	UncertaintyReason string
	IsTestSource      bool
	ExplanationCode   string
}

// SubscriptionSource is one projected subscription offered to the entitlement
// engine, paired with the grant versions in force for its period.
type SubscriptionSource struct {
	InstanceID        string
	SnapshotID        string
	PurchaseLineageID string
	Snapshot          SubscriptionSnapshot
	Grants            []GrantVersion
}

// OneTimeSource is one projected non-consumable and its grant versions.
type OneTimeSource struct {
	InstanceID        string
	PurchaseLineageID string
	Snapshot          OneTimeSnapshot
	Grants            []GrantVersion
}

// CustomerProjection is the entitlement engine's input for one customer in one
// Environment.
type CustomerProjection struct {
	Subscriptions []SubscriptionSource
	OneTimes      []OneTimeSource
	// UnresolvedLineages counts purchase lineages that carry validated facts
	// but no accepted customer association or resolved Product. They never
	// grant access; they are the reason an Entitlement may be `unknown`
	// instead of `inactive`.
	UnresolvedLineages int
	// FrozenLineages counts lineages held by an open identity conflict
	// (OD-10). Neither candidate customer is granted anything automatically.
	FrozenLineages int
}

// CustomerSnapshot is the entitlement engine's output candidate.
type CustomerSnapshot struct {
	Entries  []EntitlementEntry
	Sources  []EntitlementSource
	Checksum []byte
	AsOf     time.Time
}

// ChangeSet names the Entitlements whose meaning changed relative to the prior
// committed snapshot. It is what a webhook announces and what makes a
// no-change projection observable as such.
type ChangeSet struct {
	Changed  []string
	NoChange bool
}

// ProjectEntitlements aggregates every accepted source into per-Entitlement
// state (plan §5 "Authoritative Entitlement Computation").
//
// Aggregation rules that matter:
//   - an Entitlement with at least one active source is active, regardless of
//     how many other sources ended; revoking one source never removes an
//     unrelated valid source
//   - a permanent active source means no finite expiry is reported, even when
//     a finite subscription source is also active
//   - no active source plus unresolved critical evidence is `unknown`, not
//     `inactive`
func ProjectEntitlements(projection CustomerProjection, asOf time.Time) CustomerSnapshot {
	asOf = asOf.UTC()
	sources := make([]EntitlementSource, 0, 8)

	for _, subscription := range projection.Subscriptions {
		for _, grant := range subscription.Grants {
			sources = append(sources, subscriptionSource(subscription, grant))
		}
	}
	for _, oneTime := range projection.OneTimes {
		for _, grant := range oneTime.Grants {
			sources = append(sources, oneTimeSource(oneTime, grant))
		}
	}
	sort.Slice(sources, func(i, j int) bool { return sources[i].sortKey() < sources[j].sortKey() })

	grouped := map[string][]EntitlementSource{}
	order := make([]string, 0, len(sources))
	for _, source := range sources {
		if _, seen := grouped[source.EntitlementID]; !seen {
			order = append(order, source.EntitlementID)
		}
		grouped[source.EntitlementID] = append(grouped[source.EntitlementID], source)
	}

	entries := make([]EntitlementEntry, 0, len(order))
	for _, entitlementID := range order {
		entries = append(entries, aggregate(grouped[entitlementID], projection))
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].EntitlementID < entries[j].EntitlementID })

	return CustomerSnapshot{
		Entries:  entries,
		Sources:  sources,
		AsOf:     asOf,
		Checksum: customerChecksum(entries, sources),
	}
}

func subscriptionSource(subscription SubscriptionSource, grant GrantVersion) EntitlementSource {
	snapshot := subscription.Snapshot
	source := EntitlementSource{
		EntitlementID:              grant.EntitlementID,
		EntitlementKey:             grant.EntitlementKey,
		PurchaseLineageID:          subscription.PurchaseLineageID,
		ProductID:                  grant.ProductID,
		GrantVersionID:             grant.ID,
		SubscriptionInstanceID:     subscription.InstanceID,
		SourceSubscriptionSnapshot: subscription.SnapshotID,
		SourceStart:                snapshot.PeriodStartAt,
		SourceEnd:                  snapshot.PeriodEndAt,
		EndKnown:                   true,
		UncertaintyReason:          snapshot.UncertaintyReason,
		IsTestSource:               snapshot.IsTestSource,
	}

	switch snapshot.LifecycleState {
	case LifecycleTrialing:
		source.SourceType, source.ExplanationCode = SourceTrial, "trial_active"
	case LifecycleGracePeriod:
		source.SourceType, source.ExplanationCode = SourceVerifiedGrace, "verified_grace_period"
		source.SourceEnd = snapshot.GracePeriodEndAt
	case LifecycleBillingRetry:
		source.SourceType, source.ExplanationCode = SourceBillingRetry, "billing_retry"
	default:
		source.SourceType, source.ExplanationCode = SourceActiveSubscription, "subscription_"+snapshot.LifecycleState
	}
	if snapshot.OwnershipType == OwnershipFamilyShared {
		// OD-9(b): a family-shared transaction is an independent source for
		// the family member's own customer, labelled honestly so an operator
		// explanation can say why access exists.
		source.SourceType = SourceFamilyShared
	}

	// Access is decided per grant version, from the provider lifecycle plus
	// *this* grant's policy. Reading it off the snapshot's single access column
	// collapsed every Entitlement onto one policy, so a grant version that opted
	// out of grace still granted access whenever some other grant on the same
	// Product opted in — the §7 per-grant opt-out existed only on paper.
	//
	// Lifecycles that are not policy-dependent (revoked, refunded, expired,
	// superseded, paused, unknown) are never negotiable and fall through to the
	// snapshot's own answer.
	switch {
	case snapshot.AccessState == AccessUnknown:
		source.SourceState = AccessUnknown
	default:
		if granted, policyDependent := grant.Policy.GrantsAccess(snapshot.LifecycleState); policyDependent {
			if granted {
				source.SourceState = AccessActive
			} else {
				source.SourceState = AccessInactive
			}
		} else if snapshot.AccessState == AccessActive {
			source.SourceState = AccessActive
		} else {
			source.SourceState = AccessInactive
		}
	}
	return source
}

func oneTimeSource(oneTime OneTimeSource, grant GrantVersion) EntitlementSource {
	snapshot := oneTime.Snapshot
	acquired := snapshot.AcquiredAt
	source := EntitlementSource{
		EntitlementID:             grant.EntitlementID,
		EntitlementKey:            grant.EntitlementKey,
		PurchaseLineageID:         oneTime.PurchaseLineageID,
		ProductID:                 grant.ProductID,
		GrantVersionID:            grant.ID,
		OneTimePurchaseInstanceID: oneTime.InstanceID,
		SourceType:                SourceOneTime,
		SourceStart:               &acquired,
		// A valid non-consumable has no end. This is the flag the aggregation
		// reads to refuse a misleading finite expiry.
		EndKnown:          false,
		UncertaintyReason: snapshot.UncertaintyReason,
		IsTestSource:      snapshot.IsTestSource,
		ExplanationCode:   "one_time_purchase_" + snapshot.ValidityState,
	}
	switch snapshot.ValidityState {
	case OwnershipOwned:
		if grant.Policy.GrantsInOneTime {
			source.SourceState = AccessActive
		} else {
			source.SourceState = AccessInactive
		}
	case OwnershipRefunded:
		source.SourceState, source.EndKnown, source.SourceEnd = AccessInactive, true, snapshot.RefundEffectiveAt
	case OwnershipRevoked:
		source.SourceState, source.EndKnown, source.SourceEnd = AccessInactive, true, snapshot.RevocationEffectiveAt
	default:
		source.SourceState = AccessUnknown
	}
	return source
}

func aggregate(sources []EntitlementSource, projection CustomerProjection) EntitlementEntry {
	entry := EntitlementEntry{
		EntitlementID:     sources[0].EntitlementID,
		EntitlementKey:    sources[0].EntitlementKey,
		SourceCount:       len(sources),
		State:             AccessInactive,
		EndKnown:          true,
		UncertaintyReason: UncertaintyNone,
		ExplanationCode:   "no_active_source",
	}

	anyActive, anyUnknown, anyPermanent := false, false, false
	var latestEnd *time.Time
	var earliestStart *time.Time
	unknownReason := UncertaintyNone

	for _, source := range sources {
		switch source.SourceState {
		case AccessActive:
			anyActive = true
			if source.IsTestSource {
				entry.IsTestSource = true
			}
			if !source.EndKnown {
				anyPermanent = true
			} else if source.SourceEnd != nil && (latestEnd == nil || source.SourceEnd.After(*latestEnd)) {
				latestEnd = source.SourceEnd
			} else if source.SourceEnd == nil {
				// An active source with a known-but-absent end is an uncertain
				// end, not an infinite one.
				anyPermanent = false
				entry.EndKnown = false
			}
			if source.SourceStart != nil && (earliestStart == nil || source.SourceStart.Before(*earliestStart)) {
				earliestStart = source.SourceStart
			}
			if entry.ExplanationCode == "no_active_source" {
				entry.ExplanationCode = source.ExplanationCode
			}
		case AccessUnknown:
			anyUnknown = true
			if unknownReason == UncertaintyNone && source.UncertaintyReason != UncertaintyNone {
				unknownReason = source.UncertaintyReason
			}
		}
	}

	switch {
	case anyActive:
		entry.State = AccessActive
		entry.EffectiveStart = earliestStart
		if anyPermanent {
			// A permanent source means no finite expiry, even alongside a
			// finite subscription that ends sooner.
			entry.EffectiveEnd, entry.EndKnown = nil, false
			entry.ExplanationCode = "permanent_source_active"
		} else if entry.EndKnown {
			entry.EffectiveEnd = latestEnd
		}
	case anyUnknown || projection.UnresolvedLineages > 0 || projection.FrozenLineages > 0:
		// No source actively grants it, but critical evidence is missing or
		// disputed. `unknown` preserves the truth; `inactive` would assert one.
		entry.State = AccessUnknown
		entry.UncertaintyReason = unknownReason
		if entry.UncertaintyReason == UncertaintyNone {
			entry.UncertaintyReason = UncertaintyIdentityUnresolved
		}
		// The explanation follows the reason rather than restating "something
		// is unresolved". A Product mapping gap and an identity conflict need
		// different operator actions, and reporting both as one code sent every
		// investigation to the wrong queue.
		switch entry.UncertaintyReason {
		case UncertaintyProductUnresolved:
			entry.ExplanationCode = "product_unresolved"
		case UncertaintyConflictingFacts:
			entry.ExplanationCode = "conflicting_facts"
		case UncertaintyProjectionFailed:
			entry.ExplanationCode = "projection_failed"
		case UncertaintyStaleValidation:
			entry.ExplanationCode = "provider_evidence_stale"
		default:
			entry.ExplanationCode = "identity_unresolved"
		}
	}
	return entry
}

// Diff reports which Entitlements changed between the prior committed snapshot
// and a candidate. A checksum-equal candidate is a no-change projection: no
// snapshot is written, no webhook is emitted, and the checkpoint still
// advances.
func Diff(prior *CustomerSnapshot, candidate CustomerSnapshot) ChangeSet {
	if prior != nil && string(prior.Checksum) == string(candidate.Checksum) {
		return ChangeSet{NoChange: true}
	}
	priorEntries := map[string]EntitlementEntry{}
	if prior != nil {
		for _, entry := range prior.Entries {
			priorEntries[entry.EntitlementID] = entry
		}
	}
	changed := make([]string, 0, len(candidate.Entries))
	for _, entry := range candidate.Entries {
		before, existed := priorEntries[entry.EntitlementID]
		if !existed || before.State != entry.State || !sameInstant(before.EffectiveEnd, entry.EffectiveEnd) ||
			before.EndKnown != entry.EndKnown || before.UncertaintyReason != entry.UncertaintyReason {
			changed = append(changed, entry.EntitlementID)
		}
		delete(priorEntries, entry.EntitlementID)
	}
	// An Entitlement that disappeared from the candidate changed too.
	for entitlementID := range priorEntries {
		changed = append(changed, entitlementID)
	}
	sort.Strings(changed)
	return ChangeSet{Changed: changed, NoChange: len(changed) == 0}
}

func sameInstant(a, b *time.Time) bool {
	if a == nil || b == nil {
		return a == b
	}
	return a.Equal(*b)
}
