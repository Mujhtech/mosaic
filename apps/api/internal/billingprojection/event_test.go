package billingprojection

import "testing"

// The webhook event is created inside the projection transaction, so whatever
// Compute plans is what a consumer eventually receives. Two things can go wrong
// there and neither is visible from the snapshot: a projection that changed
// nothing can still announce a change, and an announcement can carry a state
// summary the contract will not accept. These pin both.

// A no-change projection must plan no event at all. This is the property that
// makes a replay safe to run: a Project-wide replay that re-derived identical
// state would otherwise deliver one webhook per customer for nothing, which is
// exactly the noise that teaches receivers to ignore the channel.
func TestNoChangeProjectionPlansNoEvent(t *testing.T) {
	input := Input{
		Scope:                  Scope{ProjectID: "proj_1", EnvironmentID: "env_1", CustomerID: "bcu_1"},
		Lineages:               []LineageInput{activeLineage("lin_1")},
		GrantVersions:          []GrantVersion{proGrant()},
		CurrentSnapshotVersion: 4,
	}
	first := Compute(input, at("2026-02-15T00:00:00Z"))
	if first.Event == nil {
		t.Fatal("the first projection planned no event for a first grant")
	}

	input.Lineages[0].CheckpointChecksum = first.Checkpoints[0].Checksum
	input.PriorCustomerSnapshot = first.CustomerSnapshot
	second := Compute(input, at("2026-02-16T00:00:00Z"))

	if second.Outcome != OutcomeNoChange {
		t.Fatalf("re-projection outcome %q, want no_change", second.Outcome)
	}
	if second.Event != nil {
		t.Fatalf("a no-change projection planned an event: %+v", second.Event)
	}
}

// The first grant must be reported as `absent` -> `active`, never as
// `inactive` -> `active`. The distinction is the whole reason the contract
// declares a fourth previous-state member: claiming the customer was previously
// inactive asserts a fact Mosaic never established.
func TestFirstGrantReportsAbsentRatherThanInactive(t *testing.T) {
	output := Compute(Input{
		Scope:         Scope{ProjectID: "proj_1", EnvironmentID: "env_1", CustomerID: "bcu_1"},
		Lineages:      []LineageInput{activeLineage("lin_1")},
		GrantVersions: []GrantVersion{proGrant()},
	}, at("2026-02-15T00:00:00Z"))

	if output.Event == nil {
		t.Fatal("no event planned for a first grant")
	}
	if len(output.Changes.Entries) != 1 {
		t.Fatalf("changed entitlements %d, want 1", len(output.Changes.Entries))
	}
	change := output.Changes.Entries[0]
	if change.EntitlementKey != "pro" {
		t.Fatalf("entitlement key %q, want the grant's key", change.EntitlementKey)
	}
	if change.PreviousState != EntitlementAbsent || change.CurrentState != AccessActive {
		t.Fatalf("change %s -> %s, want absent -> active", change.PreviousState, change.CurrentState)
	}
	if output.Event.SourceReason != ReasonInitialProjection {
		t.Fatalf("source reason %q, want initial_projection", output.Event.SourceReason)
	}
	if output.Event.SubscriptionInstanceID != "sub_lin_1" {
		t.Fatalf("subscription instance %q, want the lineage's instance", output.Event.SubscriptionInstanceID)
	}
	// The schema's invariant: an unknown or unavailable summary must name a
	// reason, and a definite one must not invent one.
	if output.Event.AccessState == AccessUnknown && output.Event.UncertaintyReason == UncertaintyNone {
		t.Fatal("an unknown state summary carried no uncertainty reason")
	}
	if output.Event.OccurredAt.After(at("2026-02-15T00:00:00Z")) {
		t.Fatalf("occurredAt %s is in the future relative to the evaluation instant", output.Event.OccurredAt)
	}
}

// A customer whose only decidable state is `unknown` must still produce an
// explainable summary. The contract encodes "unknown implies a reason" as a
// schema invariant, so an unexplained one is a delivery the receiver rejects
// rather than a field it ignores.
func TestUnknownEventSummaryIsAlwaysExplained(t *testing.T) {
	frozen := activeLineage("lin_frozen")
	frozen.Frozen = true
	output := Compute(Input{
		Scope:         Scope{ProjectID: "proj_1", EnvironmentID: "env_1", CustomerID: "bcu_1"},
		Lineages:      []LineageInput{frozen},
		GrantVersions: []GrantVersion{proGrant()},
	}, at("2026-02-15T00:00:00Z"))

	if output.Event == nil {
		t.Fatal("a frozen lineage produced no announcement of its unknown state")
	}
	if output.Event.AccessState != AccessUnknown {
		t.Fatalf("access state %q, want unknown for a frozen lineage", output.Event.AccessState)
	}
	if output.Event.UncertaintyReason == UncertaintyNone {
		t.Fatal("an unknown summary carried uncertainty reason none")
	}
}
