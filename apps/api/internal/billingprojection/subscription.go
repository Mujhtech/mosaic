package billingprojection

import "time"

// ProjectSubscription derives the authoritative state of one subscription
// lineage from its canonically ordered validated facts.
//
// The function is pure. `asOf` is the evaluation instant and the only input
// that is not a provider statement; it is passed rather than read from a clock
// so a replay at any later date reproduces the same snapshot exactly.
//
// Derivation order (plan §6), applied to the state accumulated from the whole
// ordered timeline:
//
//	effective revocation
//	→ effective invalidating refund (prorated does not revoke, OD-18(a))
//	→ supersession
//	→ verified current period
//	→ verified grace (access active per provider docs and grant policy)
//	→ billing retry (inactive by default)
//	→ pause (Google only; a scheduled pause keeps access until effective)
//	→ period ended
//	→ unknown
//
// Cancellation flips renewal intent only. Access ends at the validated period
// end, never at the cancellation notice — the single most common way a
// subscription system wrongly takes access away.
// supersededByLineage is a property of the *lineage*, not of any fact. A
// Google purchase-token chain is keyed on its root (plan §5), so the
// `purchase_superseded` facts inside a chain describe a token handover within
// one lineage and must never terminate it — the successor token's facts are the
// same subscription continuing. Only an explicit
// `purchase_lineages.superseded_by_lineage_id` edge means this lineage was
// replaced by a different one, and that is what this parameter carries.
func ProjectSubscription(facts []Fact, asOf time.Time, policy Policy, supersededByLineage bool) SubscriptionResult {
	ordered := Sort(append([]Fact(nil), facts...))
	asOf = asOf.UTC()

	result := SubscriptionResult{
		HighWatermark: HighWatermark(ordered),
		FactsConsumed: len(ordered),
	}
	state := accumulate(ordered)
	state.superseded = supersededByLineage
	snapshot := SubscriptionSnapshot{
		AsOf:                        asOf,
		PeriodStartAt:               state.periodStart,
		PeriodEndAt:                 state.periodEnd,
		GracePeriodEndAt:            state.graceEnd,
		BillingRetryStartAt:         state.retryStart,
		PauseStartAt:                state.pauseStart,
		PauseResumeAt:               state.pauseResume,
		CancellationEffectiveAt:     state.cancelledAt,
		ExpirationEffectiveAt:       state.expiredAt,
		RevocationEffectiveAt:       state.revokedAt,
		RefundEffectiveAt:           state.refundedAt,
		CurrentProductID:            state.productID,
		PriorProductID:              state.priorProductID,
		ScheduledProductIdentifier:  state.scheduledProduct,
		SubscriptionGroupIdentifier: state.subscriptionGroup,
		OwnershipType:               state.ownershipType,
		IsTestSource:                state.isTestSource,
		SourceFactIDs:               state.factIDs,
	}

	switch {
	case len(ordered) == 0:
		// Nothing to project. `unknown` rather than `inactive`: absence of
		// evidence is not evidence of absence (principle 4).
		snapshot.AccessState = AccessUnknown
		snapshot.LifecycleState = LifecycleUnknown
		snapshot.RenewalIntent = RenewalUnknown
		snapshot.BillingState = BillingUnknown
		snapshot.UncertaintyReason = UncertaintyMissingFact

	case state.productUnresolved:
		// A validated purchase of something Mosaic cannot map is real revenue
		// with unknown meaning. Guessing an Entitlement would be worse than
		// admitting the gap.
		snapshot.AccessState = AccessUnknown
		snapshot.LifecycleState = LifecycleUnknown
		snapshot.RenewalIntent = renewalIntent(state)
		snapshot.BillingState = BillingUnknown
		snapshot.UncertaintyReason = UncertaintyProductUnresolved

	case effective(state.revokedAt, asOf):
		snapshot.AccessState = AccessInactive
		snapshot.LifecycleState = LifecycleRevoked
		snapshot.RenewalIntent = renewalIntent(state)
		snapshot.BillingState = BillingRevoked
		snapshot.UncertaintyReason = UncertaintyNone
		snapshot.Terminal = true

	case state.refundInvalidates && effective(state.refundedAt, asOf):
		// OD-18(a): a prorated Apple refund does not revoke the remaining
		// period unless the provider also reports revocation, so it never sets
		// refundInvalidates.
		snapshot.AccessState = AccessInactive
		snapshot.LifecycleState = LifecycleRefunded
		snapshot.RenewalIntent = renewalIntent(state)
		snapshot.BillingState = BillingRefunded
		snapshot.UncertaintyReason = UncertaintyNone
		snapshot.Terminal = true

	case state.superseded:
		// The lineage was replaced by another. It stops granting access while
		// remaining fully visible in history; nothing is deleted.
		snapshot.AccessState = AccessInactive
		snapshot.LifecycleState = LifecycleSuperseded
		snapshot.RenewalIntent = renewalIntent(state)
		snapshot.BillingState = BillingCurrent
		snapshot.UncertaintyReason = UncertaintyNone
		snapshot.Terminal = true

	case state.pauseStart != nil && effective(state.pauseStart, asOf) && !resumed(state, asOf):
		// Google pause. A pause that is only scheduled has not started, so it
		// falls through to the period branch and keeps access.
		snapshot.AccessState = AccessInactive
		snapshot.LifecycleState = LifecyclePaused
		snapshot.RenewalIntent = RenewalPaused
		snapshot.BillingState = BillingCurrent
		snapshot.UncertaintyReason = UncertaintyNone

	case graceActive(state, asOf):
		// Verified grace grants access on both providers per their own
		// documentation; a grant version may opt out.
		//
		// Grace is evaluated *before* the current period on purpose. Google
		// extends `expiryTime` through the grace window, so a period check
		// first would report a customer in grace as plainly active — which
		// looks harmless until a Project sets grants_in_grace to false and
		// discovers the opt-out was structurally unreachable on Android.
		snapshot.LifecycleState = LifecycleGracePeriod
		snapshot.BillingState = BillingGrace
		snapshot.RenewalIntent = renewalIntent(state)
		snapshot.UncertaintyReason = UncertaintyNone
		if policy.GrantsInGrace {
			snapshot.AccessState = AccessActive
		} else {
			snapshot.AccessState = AccessInactive
		}

	case periodActive(state, asOf):
		snapshot.AccessState = AccessActive
		snapshot.LifecycleState = LifecycleActive
		if state.trialing {
			snapshot.LifecycleState = LifecycleTrialing
		}
		snapshot.RenewalIntent = renewalIntent(state)
		snapshot.BillingState = BillingCurrent
		snapshot.UncertaintyReason = UncertaintyNone

	case retryActive(state, asOf):
		// Billing retry / account hold does not grant access on either
		// provider. Enabling it contradicts provider documentation and needs
		// explicit owner approval, which is why the default is closed.
		snapshot.LifecycleState = LifecycleBillingRetry
		snapshot.BillingState = BillingRetrying
		snapshot.RenewalIntent = renewalIntent(state)
		snapshot.UncertaintyReason = UncertaintyNone
		if policy.GrantsInBillingRetry {
			snapshot.AccessState = AccessActive
		} else {
			snapshot.AccessState = AccessInactive
		}

	case state.periodEnd != nil && !state.periodEnd.After(asOf):
		snapshot.AccessState = AccessInactive
		snapshot.LifecycleState = LifecycleExpired
		snapshot.RenewalIntent = renewalIntent(state)
		snapshot.BillingState = BillingFailed
		if state.renewalExpected != nil && !*state.renewalExpected {
			// An expiry after a deliberate cancellation is not a billing
			// failure; the customer asked for it.
			snapshot.BillingState = BillingCurrent
		}
		snapshot.UncertaintyReason = UncertaintyNone
		snapshot.Terminal = true

	default:
		// Facts exist but do not describe a period. Unknown, explained.
		snapshot.AccessState = AccessUnknown
		snapshot.LifecycleState = LifecycleUnknown
		snapshot.RenewalIntent = renewalIntent(state)
		snapshot.BillingState = BillingUnknown
		snapshot.UncertaintyReason = UncertaintyMissingFact
	}

	if state.expiredAt == nil && snapshot.LifecycleState == LifecycleExpired {
		snapshot.ExpirationEffectiveAt = state.periodEnd
	}
	snapshot.Checksum = subscriptionChecksum(snapshot)
	result.Snapshot = snapshot
	result.Timeline = timelineFor(ordered)
	result.Warnings = state.warnings
	return result
}

// Policy is the versioned access policy applied to one projection. It is
// supplied by the effective grant version rather than hardcoded, so no handler
// can decide access behaviour on its own (WP8).
type Policy struct {
	GrantsInActive       bool
	GrantsInTrial        bool
	GrantsInGrace        bool
	GrantsInBillingRetry bool
	GrantsInOneTime      bool
}

// GrantsAccess reports whether this policy grants access for a lifecycle
// state, and whether the lifecycle is policy-dependent at all.
//
// The second return value is what keeps a grant version from being able to
// grant access during a revocation or a refund: those states are not
// negotiable, so no policy is consulted for them.
func (p Policy) GrantsAccess(lifecycle string) (grants bool, policyDependent bool) {
	switch lifecycle {
	case LifecycleTrialing:
		return p.GrantsInTrial, true
	case LifecycleActive:
		return p.GrantsInActive, true
	case LifecycleGracePeriod:
		return p.GrantsInGrace, true
	case LifecycleBillingRetry:
		return p.GrantsInBillingRetry, true
	default:
		return false, false
	}
}

// AnyGrantsAccess reports whether any of the grant versions in force grants
// access for a lifecycle state. It is the subscription snapshot's headline
// access answer: the snapshot has one access column but a Product may carry
// several Entitlement grants with different policies, so the honest single
// value is "at least one grant version says yes".
//
// Per-Entitlement access is decided per grant version in the entitlement
// engine, not from this value.
func AnyGrantsAccess(lifecycle string, grants []GrantVersion) (bool, bool) {
	dependent := false
	for _, grant := range grants {
		granted, policyDependent := grant.Policy.GrantsAccess(lifecycle)
		if !policyDependent {
			return false, false
		}
		dependent = true
		if granted {
			return true, true
		}
	}
	return false, dependent
}

// DefaultPolicy is policy version 1 (plan §7): grace grants access, billing
// retry does not, pause never does.
func DefaultPolicy() Policy {
	return Policy{
		GrantsInActive: true, GrantsInTrial: true, GrantsInGrace: true,
		GrantsInBillingRetry: false, GrantsInOneTime: true,
	}
}

// lineageState is the accumulated reading of an ordered fact timeline. It is
// deliberately a fold rather than a state machine with transitions: the
// provider is the state machine, and Mosaic's job is to read its statements in
// order, not to invent transitions between them.
type lineageState struct {
	periodStart *time.Time
	periodEnd   *time.Time
	graceEnd    *time.Time
	retryStart  *time.Time
	pauseStart  *time.Time
	pauseResume *time.Time
	cancelledAt *time.Time
	expiredAt   *time.Time
	revokedAt   *time.Time
	refundedAt  *time.Time

	refundInvalidates bool
	superseded        bool
	trialing          bool
	renewalExpected   *bool
	productUnresolved bool
	isTestSource      bool

	productID         string
	priorProductID    string
	scheduledProduct  string
	subscriptionGroup string
	ownershipType     string

	factIDs  []string
	warnings []string
}

func accumulate(ordered []Fact) lineageState {
	state := lineageState{factIDs: make([]string, 0, len(ordered))}
	for _, fact := range ordered {
		state.factIDs = append(state.factIDs, fact.ID)
		if fact.IsTestSource {
			state.isTestSource = true
		}
		if fact.SubscriptionGroupIdentifier != "" {
			state.subscriptionGroup = fact.SubscriptionGroupIdentifier
		}
		if fact.InAppOwnershipType != "" {
			state.ownershipType = fact.InAppOwnershipType
		}
		if fact.ResolutionState == "unresolved" {
			state.productUnresolved = true
		}
		if fact.MosaicProductID != "" {
			if fact.MosaicProductID != state.productID {
				if state.productID != "" {
					state.priorProductID = state.productID
				}
				state.productID = fact.MosaicProductID
			}
			// Any fact that resolved to a Product clears the unresolved
			// reading, including one that resolved to the *same* Product.
			// Clearing only on a change made the flag permanent: an unresolved
			// fact carries a NULL product, so re-resolution to the product the
			// lineage already had never satisfied the inequality, and the
			// lineage stayed `unknown` for the rest of its life.
			state.productUnresolved = false
		}
		if fact.RenewalExpected != nil {
			expected := *fact.RenewalExpected
			state.renewalExpected = &expected
		}
		if fact.AutoRenewProductIdentifier != "" {
			state.scheduledProduct = fact.AutoRenewProductIdentifier
		}

		switch fact.FactKind {
		case "initial_purchase", "offer_redeemed":
			state.periodStart, state.periodEnd = fact.PeriodStartAt, fact.PeriodEndAt
			state.trialing = fact.FactKind == "offer_redeemed"
			state.clearTerminal()
		case "renewal", "plan_change":
			// A renewal extends the period. It also reinstates a lineage whose
			// expiry has been superseded by a late-arriving renewal fact —
			// which is exactly the out-of-order case the failure model
			// requires to reactivate rather than stay expired.
			if fact.PeriodStartAt != nil {
				state.periodStart = fact.PeriodStartAt
			}
			if fact.PeriodEndAt != nil {
				state.periodEnd = fact.PeriodEndAt
			}
			state.trialing = false
			state.clearTerminal()
		case "grace_period_start":
			state.graceEnd = fact.GracePeriodExpiresAt
			if state.graceEnd == nil {
				// A grace fact with no provider grace end cannot be trusted to
				// bound access. It is recorded and reported rather than turned
				// into an open-ended grant.
				state.warnings = append(state.warnings, "grace_period_without_provider_end")
			}
		case "billing_retry_start":
			retryAt := EffectiveAt(fact)
			state.retryStart = &retryAt
			// Apple has no separate grace notification. Grace is expressed as
			// `gracePeriodExpiresDate` on the renewal payload that accompanies
			// DID_FAIL_TO_RENEW, so a retry fact carrying one *is* the grace
			// statement. Reading only `grace_period_start` meant an Apple
			// customer spent a sixteen-day grace window projected as
			// billing_retry and therefore inactive — access removed while Apple
			// was still granting it.
			state.graceEnd = fact.GracePeriodExpiresAt
		case "paused":
			pausedAt := EffectiveAt(fact)
			state.pauseStart = &pausedAt
		case "resumed":
			resumedAt := EffectiveAt(fact)
			state.pauseResume = &resumedAt
		case "cancellation_scheduled", "auto_renew_disabled":
			cancelledAt := EffectiveAt(fact)
			state.cancelledAt = &cancelledAt
			disabled := false
			state.renewalExpected = &disabled
		case "auto_renew_enabled":
			enabled := true
			state.renewalExpected = &enabled
			state.cancelledAt = nil
		case "expiration":
			expiredAt := EffectiveAt(fact)
			state.expiredAt = &expiredAt
			if fact.PeriodEndAt != nil {
				state.periodEnd = fact.PeriodEndAt
			} else {
				state.periodEnd = &expiredAt
			}
			state.graceEnd, state.retryStart = nil, nil
		case "refund":
			refundedAt := effectiveRefund(fact)
			state.refundedAt = refundedAt
			// A refund invalidates the remaining period only when the provider
			// says ownership ended: a full/unspecified refund with a
			// revocation date, or a Google void. A prorated Apple refund does
			// not (OD-18(a)).
			state.refundInvalidates = fact.RefundType != "prorated" && fact.RevokedAt != nil
			if fact.RefundType == "prorated" {
				state.warnings = append(state.warnings, "prorated_refund_preserves_period")
			}
		case "revocation":
			if fact.RevokedAt != nil {
				state.revokedAt = fact.RevokedAt
			} else {
				revokedAt := EffectiveAt(fact)
				state.revokedAt = &revokedAt
			}
			if fact.RefundedAt != nil {
				state.refundedAt = fact.RefundedAt
			}
		case "purchase_superseded":
			// Deliberately no state change. Under root lineage keying this fact
			// records a token handover inside one Google chain: the successor
			// token's own facts continue the same subscription. Treating it as
			// terminal is how a live successor was projected inactive.
			// Cross-lineage supersession arrives as the lineage-level parameter.
		}
	}
	return state
}

// clearTerminal is what makes Apple's REFUND_REVERSED and a late renewal
// reinstating: a later purchase or renewal fact for the same lineage overrides
// an earlier terminal statement, because the provider has said the lineage is
// live again.
func (s *lineageState) clearTerminal() {
	s.revokedAt, s.refundedAt = nil, nil
	s.refundInvalidates = false
	s.expiredAt = nil
	// A successful purchase or renewal also ends grace and billing retry: the
	// provider took the money. Leaving either set would keep reporting a
	// recovery state after the recovery happened.
	s.graceEnd, s.retryStart = nil, nil
}

func effectiveRefund(fact Fact) *time.Time {
	if fact.RefundedAt != nil {
		return fact.RefundedAt
	}
	if fact.RevokedAt != nil {
		return fact.RevokedAt
	}
	when := EffectiveAt(fact)
	return &when
}

func effective(at *time.Time, asOf time.Time) bool {
	return at != nil && !at.After(asOf)
}

func resumed(state lineageState, asOf time.Time) bool {
	if state.pauseResume == nil || state.pauseStart == nil {
		return false
	}
	return state.pauseResume.After(*state.pauseStart) && !state.pauseResume.After(asOf)
}

func periodActive(state lineageState, asOf time.Time) bool {
	if state.periodEnd == nil {
		return false
	}
	if state.expiredAt != nil && !state.expiredAt.After(asOf) {
		return false
	}
	// Half-open interval [start, end): the instant the period ends, it is over.
	if state.periodStart != nil && state.periodStart.After(asOf) {
		return false
	}
	return state.periodEnd.After(asOf)
}

func graceActive(state lineageState, asOf time.Time) bool {
	return state.graceEnd != nil && state.graceEnd.After(asOf)
}

func retryActive(state lineageState, asOf time.Time) bool {
	if state.retryStart == nil || state.retryStart.After(asOf) {
		return false
	}
	return state.expiredAt == nil || state.expiredAt.After(asOf)
}

func renewalIntent(state lineageState) string {
	if state.pauseStart != nil && state.pauseResume == nil {
		return RenewalPaused
	}
	if state.renewalExpected == nil {
		return RenewalUnknown
	}
	if *state.renewalExpected {
		return RenewalEnabled
	}
	return RenewalDisabled
}

// timelineFor emits one entry per fact that changes the story. Facts that
// restate the current position (a duplicate renewal, a repeated status query)
// produce no entry, which is what keeps a timeline readable.
func timelineFor(ordered []Fact) []TimelineEntry {
	entries := make([]TimelineEntry, 0, len(ordered))
	for _, fact := range ordered {
		entryType, explanation := timelineTypeFor(fact)
		if entryType == "" {
			continue
		}
		entries = append(entries, TimelineEntry{
			EntryType:       entryType,
			EffectiveAt:     EffectiveAt(fact),
			ObservedAt:      fact.RecordedAt,
			ProductID:       fact.MosaicProductID,
			SourceFactIDs:   []string{fact.ID},
			ExplanationCode: explanation,
		})
	}
	return entries
}

func timelineTypeFor(fact Fact) (string, string) {
	switch fact.FactKind {
	case "initial_purchase":
		return TimelinePurchaseValidated, "initial_purchase_validated"
	case "offer_redeemed":
		return TimelineTrialStarted, "offer_redeemed"
	case "renewal":
		return TimelineRenewalValidated, "renewal_validated"
	case "plan_change":
		if fact.IsUpgraded != nil && *fact.IsUpgraded {
			return TimelineProductUpgraded, "provider_reported_upgrade"
		}
		return TimelineProductDowngraded, "provider_reported_plan_change"
	case "auto_renew_enabled":
		return TimelineAutoRenewEnabled, "auto_renew_enabled"
	case "auto_renew_disabled":
		return TimelineAutoRenewDisabled, "auto_renew_disabled"
	case "cancellation_scheduled":
		return TimelineCancellation, "cancellation_scheduled"
	case "grace_period_start":
		return TimelineGraceStarted, "grace_period_started"
	case "billing_retry_start":
		return TimelineBillingRetry, "billing_retry_started"
	case "paused":
		return TimelinePauseStarted, "subscription_paused"
	case "resumed":
		return TimelinePauseEnded, "subscription_resumed"
	case "expiration":
		return TimelineExpiration, "period_ended"
	case "refund":
		return TimelineRefund, "refund_validated"
	case "revocation":
		return TimelineRevocation, "revocation_validated"
	case "purchase_superseded":
		return TimelinePurchaseSuperseded, "lineage_superseded"
	default:
		return "", ""
	}
}
