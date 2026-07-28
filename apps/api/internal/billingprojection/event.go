package billingprojection

import (
	"sort"
	"time"
)

// Event is the committed-change announcement one projection plans.
//
// It is planned by the pure engine rather than assembled by the writer for one
// reason: the writer runs inside the projection transaction, and anything it
// decides there is a branch over provider semantics that cannot be tested
// without a database. Planning it here means the wire shape of an entitlement
// change is decided by the same deterministic function that decided the change.
//
// Only `customer.entitlements.changed` is emitted in Phase 9B (OD-1(b)). The
// other nine event types the contract declares are reserved names; emitting one
// before it is specified would be a defect.
type Event struct {
	// SubscriptionInstanceID names the subscription the change came from, when
	// one can be identified. It is empty for a change driven only by one-time
	// purchases, by a grant-version publication, or by an identity movement.
	SubscriptionInstanceID string

	AccessState       string
	LifecycleState    string
	RenewalIntent     string
	BillingState      string
	UncertaintyReason string

	// SourceReason is the contract's changeReason vocabulary: why the committed
	// state moved.
	SourceReason string
	// OccurredAt is when the change became effective. It is provider-derived
	// wherever a provider timestamp explains the change and may be well before
	// the event is created; it is never allowed past the evaluation instant,
	// because an event dated in the future is unusable for ordering or replay
	// windows.
	OccurredAt   time.Time
	IsTestSource bool
}

// Webhook event types. Phase 9B emits exactly one.
const EventTypeEntitlementsChanged = "customer.entitlements.changed"

// Change reasons, matching the closed vocabulary shared by the Authoritative
// Entitlement and Billing State Webhook contracts.
const (
	ReasonInitialProjection        = "initial_projection"
	ReasonSubscriptionStateChanged = "subscription_state_changed"
	ReasonSourceAdded              = "source_added"
	ReasonSourceEnded              = "source_ended"
)

// planEvent builds the announcement for a projection that changed committed
// state. It returns nil when nothing changed, so the no-change path cannot
// accidentally announce anything.
func planEvent(prior *CustomerSnapshot, candidate CustomerSnapshot, changes ChangeSet,
	subscriptions []SubscriptionSource, asOf time.Time) *Event {

	if len(changes.Entries) == 0 {
		return nil
	}
	event := &Event{
		SourceReason: eventReason(prior, changes),
		OccurredAt:   eventOccurredAt(changes, candidate, asOf),
	}

	changedIDs := make(map[string]struct{}, len(changes.Entries))
	for _, change := range changes.Entries {
		changedIDs[change.EntitlementID] = struct{}{}
	}
	if source, ok := driverSubscription(subscriptions, changedIDs); ok {
		event.SubscriptionInstanceID = source.InstanceID
		event.AccessState = source.Snapshot.AccessState
		event.LifecycleState = source.Snapshot.LifecycleState
		event.RenewalIntent = source.Snapshot.RenewalIntent
		event.BillingState = source.Snapshot.BillingState
		event.UncertaintyReason = source.Snapshot.UncertaintyReason
		event.IsTestSource = source.Snapshot.IsTestSource
		return event
	}

	// No subscription drove the change: the summary is derived from the
	// customer aggregate instead. The four axes still have to be answered
	// because the contract requires them, and answering them from the aggregate
	// is honest — a one-time purchase has no renewal to describe, which is
	// exactly what `provider_managed` and `unknown` say.
	summarizeAggregate(event, candidate, changedIDs)
	return event
}

// driverSubscription picks the subscription whose state best explains the
// change. Preference order is deterministic so the same projection always
// summarizes itself the same way: a subscription contributing an active source
// to a changed Entitlement, then any subscription contributing to one, then
// none.
func driverSubscription(subscriptions []SubscriptionSource, changed map[string]struct{}) (SubscriptionSource, bool) {
	candidates := make([]SubscriptionSource, 0, len(subscriptions))
	for _, source := range subscriptions {
		for _, grant := range source.Grants {
			if _, ok := changed[grant.EntitlementID]; ok {
				candidates = append(candidates, source)
				break
			}
		}
	}
	if len(candidates) == 0 {
		return SubscriptionSource{}, false
	}
	sort.SliceStable(candidates, func(i, j int) bool {
		left, right := candidates[i], candidates[j]
		if (left.Snapshot.AccessState == AccessActive) != (right.Snapshot.AccessState == AccessActive) {
			return left.Snapshot.AccessState == AccessActive
		}
		return left.InstanceID < right.InstanceID
	})
	return candidates[0], true
}

func summarizeAggregate(event *Event, candidate CustomerSnapshot, changed map[string]struct{}) {
	state := AccessInactive
	testSource := false
	uncertainty := UncertaintyNone
	for _, entry := range candidate.Entries {
		if _, ok := changed[entry.EntitlementID]; !ok {
			continue
		}
		if entry.IsTestSource {
			testSource = true
		}
		switch entry.State {
		case AccessActive:
			state = AccessActive
		case AccessUnknown:
			if state != AccessActive {
				state = AccessUnknown
				uncertainty = entry.UncertaintyReason
			}
		}
	}
	event.AccessState, event.IsTestSource = state, testSource
	switch state {
	case AccessActive:
		event.LifecycleState, event.BillingState = LifecycleActive, BillingCurrent
		event.RenewalIntent, event.UncertaintyReason = RenewalProviderManaged, UncertaintyNone
	case AccessUnknown:
		event.LifecycleState, event.BillingState = LifecycleUnknown, BillingUnknown
		event.RenewalIntent = RenewalUnknown
		event.UncertaintyReason = uncertainty
		if event.UncertaintyReason == UncertaintyNone {
			// `unknown` is never allowed to be unexplained: the schema encodes
			// it as an invariant and a reader that sees one has no recovery.
			event.UncertaintyReason = UncertaintyMissingFact
		}
	default:
		event.LifecycleState, event.BillingState = LifecycleExpired, BillingUnknown
		event.RenewalIntent, event.UncertaintyReason = RenewalProviderManaged, UncertaintyNone
	}
}

func eventReason(prior *CustomerSnapshot, changes ChangeSet) string {
	if prior == nil {
		return ReasonInitialProjection
	}
	added, ended := false, false
	for _, change := range changes.Entries {
		if change.PreviousState == EntitlementAbsent {
			added = true
		}
		if change.PreviousState == AccessActive && change.CurrentState != AccessActive {
			ended = true
		}
	}
	switch {
	case added:
		return ReasonSourceAdded
	case ended:
		return ReasonSourceEnded
	default:
		return ReasonSubscriptionStateChanged
	}
}

// eventOccurredAt recovers the provider-derived instant the change became
// effective, falling back to the evaluation instant when no entry carries one.
// A future-dated provider timestamp is clamped: a scheduled expiry is not an
// event that has already happened.
func eventOccurredAt(changes ChangeSet, candidate CustomerSnapshot, asOf time.Time) time.Time {
	entries := map[string]EntitlementEntry{}
	for _, entry := range candidate.Entries {
		entries[entry.EntitlementID] = entry
	}
	occurred := time.Time{}
	for _, change := range changes.Entries {
		entry, ok := entries[change.EntitlementID]
		if !ok {
			continue
		}
		candidateTime := (*time.Time)(nil)
		if change.CurrentState == AccessActive {
			candidateTime = entry.EffectiveStart
		} else if entry.EndKnown {
			candidateTime = entry.EffectiveEnd
		}
		if candidateTime == nil || candidateTime.After(asOf) {
			continue
		}
		if occurred.IsZero() || candidateTime.After(occurred) {
			occurred = candidateTime.UTC()
		}
	}
	if occurred.IsZero() {
		return asOf.UTC()
	}
	return occurred
}
