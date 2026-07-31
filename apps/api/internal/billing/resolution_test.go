package billing

import (
	"testing"
	"time"
)

// Product resolution is the highest-risk correctness surface in Phase 9A:
// attributing a transaction to the wrong Mosaic Product writes a wrong
// statement into an append-only ledger that has no update path. These tests
// pin the two properties that matter — resolution is evaluated as of the
// transaction's own time, and it never guesses — at the layer where the rules
// actually live.

func at(value string) time.Time {
	parsed, _ := time.Parse(time.RFC3339, value)
	return parsed.UTC()
}

func timePtr(value string) *time.Time {
	parsed := at(value)
	return &parsed
}

func subscriptionInput(occurredAt time.Time, candidates []MappingCandidate, successors map[string]MappingCandidate) ResolutionInput {
	return ResolutionInput{
		Provider:                  ProviderAppStore,
		ProviderProductIdentifier: "fixture.pro.monthly",
		OccurredAt:                occurredAt,
		TransactionType:           TypeAutoRenewableSubscription,
		Candidates:                candidates,
		Successors:                successors,
	}
}

func TestResolveUsesActiveMapping(t *testing.T) {
	result := Resolve(subscriptionInput(at("2026-06-01T00:00:00Z"), []MappingCandidate{
		{ID: "map_active", MosaicProductID: "prod_pro", MosaicProductType: "subscription", Status: "active", Version: 7},
	}, nil))

	if result.Outcome != ResolutionResolved || result.State != StateActiveMapping {
		t.Fatalf("got outcome %q state %q, want resolved/active_mapping", result.Outcome, result.State)
	}
	if result.MosaicProductID != "prod_pro" || result.MappingID != "map_active" {
		t.Fatalf("resolved to %q via %q", result.MosaicProductID, result.MappingID)
	}
	// The Resolution Snapshot must record the exact version used, otherwise a
	// replay cannot prove it reproduced the same decision.
	if result.MappingVersion != 7 {
		t.Fatalf("mapping version %d, want 7", result.MappingVersion)
	}
}

// A transaction that happened while a mapping was still live must resolve
// through that mapping even though it has since been archived. Evaluating
// against "now" instead would silently reattribute historical transactions
// every time an operator reorganizes their catalog.
func TestResolveUsesMappingLiveAtTransactionTime(t *testing.T) {
	result := Resolve(subscriptionInput(at("2026-01-15T00:00:00Z"), []MappingCandidate{
		{
			ID: "map_old", MosaicProductID: "prod_legacy", MosaicProductType: "subscription",
			Status: "archived", ArchivedAt: timePtr("2026-03-01T00:00:00Z"), Version: 3,
		},
	}, nil))

	if result.Outcome != ResolutionResolved || result.State != StateArchivedMapping {
		t.Fatalf("got outcome %q state %q, want resolved/archived_mapping", result.Outcome, result.State)
	}
	if result.MosaicProductID != "prod_legacy" {
		t.Fatalf("resolved to %q, want prod_legacy", result.MosaicProductID)
	}
}

// A mapping archived before the transaction happened was not in force and must
// not match. Without this a transaction could resolve through a mapping that
// had already been retired.
func TestResolveIgnoresMappingArchivedBeforeTransaction(t *testing.T) {
	result := Resolve(subscriptionInput(at("2026-06-01T00:00:00Z"), []MappingCandidate{
		{
			ID: "map_retired", MosaicProductID: "prod_legacy", MosaicProductType: "subscription",
			Status: "archived", ArchivedAt: timePtr("2026-03-01T00:00:00Z"),
		},
	}, nil))

	if result.Outcome != ResolutionUnknown {
		t.Fatalf("got outcome %q, want unknown", result.Outcome)
	}
}

// When the operator replaced a mapping, the replacement declares the intended
// continuity, so the successor's Product is adopted — but provenance records
// the mapping that actually matched, so the history stays exact.
func TestResolveFollowsReplacementChain(t *testing.T) {
	matched := MappingCandidate{
		ID: "map_v1", MosaicProductID: "prod_v1", MosaicProductType: "subscription",
		Status: "archived", ArchivedAt: timePtr("2026-03-01T00:00:00Z"), Version: 1,
	}
	successors := map[string]MappingCandidate{
		"map_v1": {ID: "map_v2", MosaicProductID: "prod_v2", MosaicProductType: "subscription", Status: "active", Version: 2},
	}

	result := Resolve(subscriptionInput(at("2026-01-15T00:00:00Z"), []MappingCandidate{matched}, successors))

	if result.Outcome != ResolutionResolved || result.State != StateReplacementChain {
		t.Fatalf("got outcome %q state %q, want resolved/replacement_chain", result.Outcome, result.State)
	}
	if result.MosaicProductID != "prod_v2" {
		t.Fatalf("adopted Product %q, want prod_v2", result.MosaicProductID)
	}
	if result.MatchedMappingID != "map_v1" || result.MappingID != "map_v2" {
		t.Fatalf("provenance lost: matched %q adopted %q", result.MatchedMappingID, result.MappingID)
	}
}

// A cycle would make the walk non-terminating. The schema forbids one, so
// reaching this branch means the data is already broken and the safe answer is
// ambiguity rather than a guess or a hang.
func TestResolveRejectsCyclicReplacementChain(t *testing.T) {
	matched := MappingCandidate{
		ID: "map_a", MosaicProductID: "prod_a", MosaicProductType: "subscription",
		Status: "archived", ArchivedAt: timePtr("2026-03-01T00:00:00Z"),
	}
	successors := map[string]MappingCandidate{
		"map_a": {ID: "map_b", MosaicProductID: "prod_b", MosaicProductType: "subscription", Status: "archived"},
		"map_b": {ID: "map_a", MosaicProductID: "prod_a", MosaicProductType: "subscription", Status: "archived"},
	}

	result := Resolve(subscriptionInput(at("2026-01-15T00:00:00Z"), []MappingCandidate{matched}, successors))
	if result.Outcome != ResolutionAmbiguous {
		t.Fatalf("got outcome %q, want ambiguous", result.Outcome)
	}
}

// Two live mappings for the same provider Product cannot be ordered by intent.
// Picking either would be a guess, and Mosaic never guesses.
func TestResolveRejectsAmbiguousCandidates(t *testing.T) {
	result := Resolve(subscriptionInput(at("2026-06-01T00:00:00Z"), []MappingCandidate{
		{ID: "map_one", MosaicProductID: "prod_one", MosaicProductType: "subscription", Status: "active"},
		{ID: "map_two", MosaicProductID: "prod_two", MosaicProductType: "subscription", Status: "active"},
	}, nil))

	if result.Outcome != ResolutionAmbiguous {
		t.Fatalf("got outcome %q, want ambiguous", result.Outcome)
	}
	if result.MosaicProductID != "" {
		t.Fatalf("ambiguous resolution still produced Product %q", result.MosaicProductID)
	}
}

// A subscription transaction resolving to a one-time Product is a
// configuration contradiction. Recording it would put a self-inconsistent fact
// into a ledger with no update path.
func TestResolveRejectsProductTypeMismatch(t *testing.T) {
	result := Resolve(subscriptionInput(at("2026-06-01T00:00:00Z"), []MappingCandidate{
		{ID: "map_one_time", MosaicProductID: "prod_lifetime", MosaicProductType: "one_time_non_consumable", Status: "active"},
	}, nil))

	if result.Outcome != ResolutionUnsupportedProductType {
		t.Fatalf("got outcome %q, want unsupported_product_type", result.Outcome)
	}
}

// A Google mapping that declares a base plan covers only that plan. Matching a
// transaction on a different plan would attribute revenue for one plan to
// another.
func TestResolveHonoursGoogleBasePlanScope(t *testing.T) {
	input := ResolutionInput{
		Provider:                   ProviderGooglePlay,
		ProviderProductIdentifier:  "fixture.pro",
		ProviderBasePlanIdentifier: "annual",
		OccurredAt:                 at("2026-06-01T00:00:00Z"),
		TransactionType:            TypeAutoRenewableSubscription,
		Candidates: []MappingCandidate{
			{ID: "map_monthly", MosaicProductID: "prod_monthly", MosaicProductType: "subscription",
				Status: "active", ProviderBasePlanIdentifier: "monthly"},
			{ID: "map_annual", MosaicProductID: "prod_annual", MosaicProductType: "subscription",
				Status: "active", ProviderBasePlanIdentifier: "annual"},
		},
	}

	result := Resolve(input)
	if result.Outcome != ResolutionResolved || result.MosaicProductID != "prod_annual" {
		t.Fatalf("got outcome %q Product %q, want resolved/prod_annual", result.Outcome, result.MosaicProductID)
	}
}

// Every non-resolved outcome must quarantine. A resolution failure that
// silently produced nothing would leave a confirmed purchase invisible.
func TestUnresolvedOutcomesQuarantine(t *testing.T) {
	for _, outcome := range []string{
		ResolutionUnknown, ResolutionAmbiguous,
		ResolutionCrossEnvironmentMismatch, ResolutionUnsupportedProductType,
	} {
		if _, quarantines := QuarantineReasonFor(outcome); !quarantines {
			t.Fatalf("outcome %q does not quarantine", outcome)
		}
	}
	if _, quarantines := QuarantineReasonFor(ResolutionResolved); quarantines {
		t.Fatal("a resolved outcome must not quarantine")
	}
}

// Resolution must be reproducible: the same inputs replayed later produce the
// same snapshot, which is what makes replay a no-op rather than a rewrite.
func TestResolveIsDeterministic(t *testing.T) {
	candidates := []MappingCandidate{
		{ID: "map_b", MosaicProductID: "prod_b", MosaicProductType: "subscription",
			Status: "archived", ArchivedAt: timePtr("2026-04-01T00:00:00Z"), Version: 2},
		{ID: "map_a", MosaicProductID: "prod_a", MosaicProductType: "subscription",
			Status: "archived", ArchivedAt: timePtr("2026-03-01T00:00:00Z"), Version: 1},
	}
	first := Resolve(subscriptionInput(at("2026-01-15T00:00:00Z"), candidates, nil))
	second := Resolve(subscriptionInput(at("2026-01-15T00:00:00Z"), candidates, nil))

	if first != second {
		t.Fatalf("resolution is not deterministic: %+v vs %+v", first, second)
	}
	// The mapping archived soonest after the transaction is the one that was in
	// force when it happened.
	if first.MappingID != "map_a" {
		t.Fatalf("resolved via %q, want map_a", first.MappingID)
	}
}
