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
	for _, fact := range ordered {
		snapshot.SourceFactIDs = append(snapshot.SourceFactIDs, fact.ID)
		if fact.IsTestSource {
			snapshot.IsTestSource = true
		}
		if fact.MosaicProductID != "" {
			snapshot.MosaicProductID = fact.MosaicProductID
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
		if fact.ResolutionState == "unresolved" && snapshot.MosaicProductID == "" {
			snapshot.UncertaintyReason = UncertaintyProductUnresolved
			snapshot.ValidityState = OwnershipUnknown
		}
	}

	// An effective time in the future has not happened yet. Ownership survives
	// until the provider's own effective instant, not until Mosaic hears about
	// it.
	if snapshot.ValidityState == OwnershipRefunded && !effective(snapshot.RefundEffectiveAt, asOf) {
		snapshot.ValidityState = OwnershipOwned
	}
	if snapshot.ValidityState == OwnershipRevoked && !effective(snapshot.RevocationEffectiveAt, asOf) {
		snapshot.ValidityState = OwnershipOwned
	}

	snapshot.Checksum = oneTimeChecksum(snapshot)
	result.Snapshot = snapshot
	result.Timeline = timelineFor(ordered)
	return result
}
