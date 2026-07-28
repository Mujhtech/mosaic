package billingprojection

import "time"

// ProjectOneTimePurchase derives the ownership state of one non-consumable
// lineage. Consumables are excluded from Phase 9B entirely: modelling them
// needs quantity and consumption semantics this phase does not have, and
// coercing them into ownership would put a wrong statement into an immutable
// snapshot.
//
// A valid non-consumable has no recurring period and therefore no expiry. It
// becomes inactive only through a validated refund, a revocation, an
// invalidated association, or an accepted grant rule change — never through
// the passage of time. That is the property the entitlement engine relies on
// when it refuses to report a finite expiry for a lifetime purchase.
func ProjectOneTimePurchase(facts []Fact, asOf time.Time) OneTimeResult {
	ordered := Sort(append([]Fact(nil), facts...))
	asOf = asOf.UTC()

	result := OneTimeResult{
		HighWatermark: HighWatermark(ordered),
		FactsConsumed: len(ordered),
	}
	snapshot := OneTimeSnapshot{
		ValidityState:     OwnershipUnknown,
		UncertaintyReason: UncertaintyMissingFact,
		SourceFactIDs:     make([]string, 0, len(ordered)),
	}

	acquired := false
	productUnresolved := false
	for _, fact := range ordered {
		snapshot.SourceFactIDs = append(snapshot.SourceFactIDs, fact.ID)
		if fact.IsTestSource {
			snapshot.IsTestSource = true
		}
		// Resolution is a per-fact provider statement and the latest one wins,
		// exactly as it does for subscriptions. Review finding I-4: the previous
		// rule only reported `unresolved` while the lineage had never resolved a
		// Product at all, so a refund fact that Mosaic could not map — the Google
		// void whose SKU cannot be recovered — left the lineage reading `owned`
		// from its original purchase fact and kept granting a refunded purchase.
		if fact.ResolutionState == "unresolved" {
			productUnresolved = true
		}
		if fact.MosaicProductID != "" {
			snapshot.MosaicProductID = fact.MosaicProductID
			productUnresolved = false
		}
		switch fact.FactKind {
		case "one_time_purchase", "initial_purchase":
			// A duplicate acquisition fact is not a second purchase: ownership
			// is a boolean, and the earliest validated acquisition is the one
			// that dates it.
			if !acquired {
				snapshot.AcquiredAt = EffectiveAt(fact)
				acquired = true
			}
			snapshot.ValidityState = OwnershipOwned
			snapshot.UncertaintyReason = UncertaintyNone
			// A re-purchase after a refund restores ownership; the history of
			// the refund stays in the timeline.
			snapshot.RefundEffectiveAt, snapshot.RevocationEffectiveAt = nil, nil
		case "refund":
			when := effectiveRefund(fact)
			snapshot.RefundEffectiveAt = when
			if fact.RefundType != "prorated" {
				snapshot.ValidityState = OwnershipRefunded
				snapshot.UncertaintyReason = UncertaintyNone
			}
		case "revocation":
			when := fact.RevokedAt
			if when == nil {
				at := EffectiveAt(fact)
				when = &at
			}
			snapshot.RevocationEffectiveAt = when
			snapshot.ValidityState = OwnershipRevoked
			snapshot.UncertaintyReason = UncertaintyNone
		}
	}

	// An effective time in the future has not happened yet. Ownership survives
	// until the provider's own effective instant, not until Mosaic hears about
	// it.
	if snapshot.ValidityState == OwnershipRefunded && !effective(snapshot.RefundEffectiveAt, asOf) {
		snapshot.ValidityState = OwnershipOwned
	}
	if snapshot.ValidityState == OwnershipRevoked && !effective(snapshot.RevocationEffectiveAt, asOf) {
		// A revocation scheduled for the future must not resurrect a refund
		// that has already taken effect: the purchase is still refunded, it is
		// simply not yet revoked.
		if effective(snapshot.RefundEffectiveAt, asOf) {
			snapshot.ValidityState = OwnershipRefunded
		} else {
			snapshot.ValidityState = OwnershipOwned
		}
	}

	// An unresolved Product outranks every ownership reading, and it is applied
	// after the future-effective adjustments above so a refund Mosaic cannot map
	// cannot be quietly restored to `owned`. Real revenue with unknown meaning is
	// reported as unknown; guessing an Entitlement would be worse.
	if productUnresolved {
		snapshot.ValidityState = OwnershipUnknown
		snapshot.UncertaintyReason = UncertaintyProductUnresolved
	}

	snapshot.Checksum = oneTimeChecksum(snapshot)
	result.Snapshot = snapshot
	result.Timeline = timelineFor(ordered)
	return result
}
