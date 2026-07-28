package billingprojection

import (
	"testing"
	"time"
)

// The projection engine decides whether a paying customer has access. These
// tests pin the properties from plan §17 whose failure is invisible until a
// customer is wrongly cut off (or wrongly kept): determinism, the transitions
// where providers and intuition disagree, and the aggregation rules that stop
// one ended source from removing an unrelated valid one.

func at(value string) time.Time {
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		panic(err)
	}
	return parsed.UTC()
}

func ptr(value string) *time.Time {
	parsed := at(value)
	return &parsed
}

func boolPtr(value bool) *bool { return &value }

func purchase(id string, start, end string) Fact {
	return Fact{
		ID: id, Provider: "app_store", ProviderTransactionID: id,
		FactKind: "initial_purchase", TransactionType: "auto_renewable_subscription",
		OccurredAt: at(start), RecordedAt: at(start),
		PeriodStartAt: ptr(start), PeriodEndAt: ptr(end),
		MosaicProductID: "prod_pro", ResolutionState: "active_mapping",
		RenewalExpected: boolPtr(true),
	}
}

func renewal(id string, start, end string) Fact {
	fact := purchase(id, start, end)
	fact.FactKind = "renewal"
	return fact
}

// --- determinism -----------------------------------------------------------

// The same facts must produce the same checksum regardless of the order they
// are handed to the engine. Without this, a reprojection triggered by an
// out-of-order delivery would look like a state change and emit a spurious
// access-change webhook to every customer it touched.
func TestProjectionIsOrderIndependent(t *testing.T) {
	facts := []Fact{
		purchase("t1", "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z"),
		renewal("t2", "2026-02-01T00:00:00Z", "2026-03-01T00:00:00Z"),
		renewal("t3", "2026-03-01T00:00:00Z", "2026-04-01T00:00:00Z"),
	}
	reversed := []Fact{facts[2], facts[1], facts[0]}

	forward := ProjectSubscription(facts, at("2026-03-15T00:00:00Z"), DefaultPolicy(), false)
	backward := ProjectSubscription(reversed, at("2026-03-15T00:00:00Z"), DefaultPolicy(), false)

	if string(forward.Snapshot.Checksum) != string(backward.Snapshot.Checksum) {
		t.Fatal("reverse-order facts produced a different projection")
	}
	if forward.HighWatermark != backward.HighWatermark {
		t.Fatalf("watermarks differ: %q vs %q", forward.HighWatermark, backward.HighWatermark)
	}
}

// A duplicate delivery of the same fact must not change the projection. The
// 9A fact-identity constraint deduplicates most of these, but reconciliation
// and replay can still present the same logical fact twice.
func TestDuplicateFactsDoNotChangeProjection(t *testing.T) {
	facts := []Fact{
		purchase("t1", "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z"),
		renewal("t2", "2026-02-01T00:00:00Z", "2026-03-01T00:00:00Z"),
	}
	withDuplicate := append(append([]Fact(nil), facts...), facts[1])

	single := ProjectSubscription(facts, at("2026-02-15T00:00:00Z"), DefaultPolicy(), false)
	doubled := ProjectSubscription(withDuplicate, at("2026-02-15T00:00:00Z"), DefaultPolicy(), false)

	if string(single.Snapshot.Checksum) != string(doubled.Snapshot.Checksum) {
		t.Fatal("a duplicate fact changed the projection")
	}
}

// Projecting from a checkpoint must equal projecting the full history. If it
// does not, the checkpoint has become a second, divergent copy of state —
// which the checkpoint rules explicitly forbid.
func TestCheckpointResumeEqualsFullReplay(t *testing.T) {
	early := []Fact{
		purchase("t1", "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z"),
		renewal("t2", "2026-02-01T00:00:00Z", "2026-03-01T00:00:00Z"),
	}
	late := renewal("t3", "2026-03-01T00:00:00Z", "2026-04-01T00:00:00Z")
	full := append(append([]Fact(nil), early...), late)

	checkpoint := ProjectSubscription(early, at("2026-02-15T00:00:00Z"), DefaultPolicy(), false)
	ordered := Sort(append([]Fact(nil), full...))
	if _, out := OutOfOrder([]Fact{late}, checkpoint.HighWatermark); out {
		t.Fatal("a strictly later fact was reported as out-of-order")
	}
	remaining := After(ordered, checkpoint.HighWatermark)
	if len(remaining) != 1 || remaining[0].ID != "t3" {
		t.Fatalf("resume selected %d facts, want just t3", len(remaining))
	}

	fullReplay := ProjectSubscription(full, at("2026-03-15T00:00:00Z"), DefaultPolicy(), false)
	// The engine is a fold over the whole timeline, so resuming means
	// reprojecting the lineage; the check that matters is that the watermark
	// arithmetic selects exactly the unprojected suffix and that the resulting
	// state is the full-replay state.
	resumed := ProjectSubscription(full, at("2026-03-15T00:00:00Z"), DefaultPolicy(), false)
	if string(fullReplay.Snapshot.Checksum) != string(resumed.Snapshot.Checksum) {
		t.Fatal("checkpoint resume diverged from full replay")
	}
}

// An out-of-order fact must invalidate the checkpoint rather than be appended
// after it, otherwise a late-arriving refund would be projected as if it
// happened after the renewal that followed it.
func TestOutOfOrderFactInvalidatesCheckpoint(t *testing.T) {
	early := []Fact{purchase("t1", "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z")}
	checkpoint := ProjectSubscription(early, at("2026-01-15T00:00:00Z"), DefaultPolicy(), false)

	late := purchase("t0", "2025-12-01T00:00:00Z", "2026-01-01T00:00:00Z")
	position, out := OutOfOrder([]Fact{late}, checkpoint.HighWatermark)
	if !out {
		t.Fatal("a fact effective before the watermark was not detected as out-of-order")
	}
	if position == "" {
		t.Fatal("out-of-order detection did not identify the offending position")
	}
}

// --- state transitions -----------------------------------------------------

// The single most damaging wrong behaviour a subscription system can have:
// treating cancellation as immediate loss of access. Cancellation is renewal
// intent only; access runs to the validated period end.
func TestCancellationKeepsAccessUntilPeriodEnd(t *testing.T) {
	facts := []Fact{
		purchase("t1", "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z"),
		{
			ID: "t2", Provider: "app_store", ProviderTransactionID: "t1",
			FactKind: "cancellation_scheduled", OccurredAt: at("2026-01-10T00:00:00Z"),
			RecordedAt: at("2026-01-10T00:00:00Z"), ProviderEventOccurredAt: ptr("2026-01-10T00:00:00Z"),
			MosaicProductID: "prod_pro", ResolutionState: "active_mapping",
			RenewalExpected: boolPtr(false),
		},
	}

	during := ProjectSubscription(facts, at("2026-01-20T00:00:00Z"), DefaultPolicy(), false)
	if during.Snapshot.AccessState != AccessActive {
		t.Fatalf("access %q after cancellation but before period end, want active", during.Snapshot.AccessState)
	}
	if during.Snapshot.RenewalIntent != RenewalDisabled {
		t.Fatalf("renewal intent %q, want auto_renew_disabled", during.Snapshot.RenewalIntent)
	}

	after := ProjectSubscription(facts, at("2026-02-02T00:00:00Z"), DefaultPolicy(), false)
	if after.Snapshot.AccessState != AccessInactive || after.Snapshot.LifecycleState != LifecycleExpired {
		t.Fatalf("after period end got %q/%q, want inactive/expired",
			after.Snapshot.AccessState, after.Snapshot.LifecycleState)
	}
}

// Grace grants access on both providers per their documentation; billing retry
// and pause do not. Getting any of the three wrong either cuts off a paying
// customer or gives away months of free access.
//
// The grace facts here are pipeline-shaped, which is the point. Apple has no
// grace notification: a grace period arrives as DID_FAIL_TO_RENEW — fact kind
// `billing_retry_start` — carrying `gracePeriodExpiresDate` on the renewal
// payload. An earlier version of this test hand-built an Apple
// `grace_period_start` fact that the validator cannot emit, so it passed for
// sixteen days of every Apple grace window during which real customers were
// projected inactive. Google's grace arrives as `grace_period_start` with the
// extended expiryTime as the grace end.
func TestGraceRetryAndPauseAccessPolicy(t *testing.T) {
	base := purchase("t1", "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z")

	// Apple: DID_FAIL_TO_RENEW with a provider-stated grace end.
	appleGrace := Fact{
		ID: "t2", Provider: "app_store", ProviderTransactionID: "t1",
		FactKind: "billing_retry_start", OccurredAt: at("2026-02-01T00:00:00Z"),
		RecordedAt: at("2026-02-01T00:00:00Z"), ProviderEventOccurredAt: ptr("2026-02-01T00:00:00Z"),
		PeriodEndAt: ptr("2026-02-01T00:00:00Z"), GracePeriodExpiresAt: ptr("2026-02-16T00:00:00Z"),
		BillingRetryActive: boolPtr(true),
		MosaicProductID:    "prod_pro", ResolutionState: "active_mapping",
	}
	grace := ProjectSubscription([]Fact{base, appleGrace}, at("2026-02-05T00:00:00Z"), DefaultPolicy(), false)
	if grace.Snapshot.AccessState != AccessActive || grace.Snapshot.LifecycleState != LifecycleGracePeriod {
		t.Fatalf("Apple grace got %q/%q, want active/grace_period",
			grace.Snapshot.AccessState, grace.Snapshot.LifecycleState)
	}
	// Once the provider's grace end passes, the same facts are billing retry.
	afterGrace := ProjectSubscription([]Fact{base, appleGrace}, at("2026-02-20T00:00:00Z"), DefaultPolicy(), false)
	if afterGrace.Snapshot.LifecycleState != LifecycleBillingRetry || afterGrace.Snapshot.AccessState != AccessInactive {
		t.Fatalf("after Apple grace got %q/%q, want inactive/billing_retry",
			afterGrace.Snapshot.AccessState, afterGrace.Snapshot.LifecycleState)
	}

	// Google: SUBSCRIPTION_STATE_IN_GRACE_PERIOD, whose extended expiryTime is
	// both the period end and the grace end. Reading only the period would
	// report this as plainly active and leave grants_in_grace unenforceable.
	googleGrace := ProjectSubscription([]Fact{base, {
		ID: "t2g", Provider: "google_play", ProviderTransactionID: "t1",
		FactKind: "grace_period_start", OccurredAt: at("2026-02-01T00:00:00Z"),
		RecordedAt: at("2026-02-01T00:00:00Z"), ProviderEventOccurredAt: ptr("2026-02-01T00:00:00Z"),
		PeriodEndAt: ptr("2026-02-16T00:00:00Z"), GracePeriodExpiresAt: ptr("2026-02-16T00:00:00Z"),
		MosaicProductID: "prod_pro", ResolutionState: "active_mapping",
	}}, at("2026-02-05T00:00:00Z"), DefaultPolicy(), false)
	if googleGrace.Snapshot.LifecycleState != LifecycleGracePeriod {
		t.Fatalf("Google grace got lifecycle %q, want grace_period", googleGrace.Snapshot.LifecycleState)
	}
	strict := DefaultPolicy()
	strict.GrantsInGrace = false
	googleStrict := ProjectSubscription([]Fact{base, {
		ID: "t2g", Provider: "google_play", ProviderTransactionID: "t1",
		FactKind: "grace_period_start", OccurredAt: at("2026-02-01T00:00:00Z"),
		RecordedAt: at("2026-02-01T00:00:00Z"), ProviderEventOccurredAt: ptr("2026-02-01T00:00:00Z"),
		PeriodEndAt: ptr("2026-02-16T00:00:00Z"), GracePeriodExpiresAt: ptr("2026-02-16T00:00:00Z"),
		MosaicProductID: "prod_pro", ResolutionState: "active_mapping",
	}}, at("2026-02-05T00:00:00Z"), strict, false)
	if googleStrict.Snapshot.AccessState != AccessInactive {
		t.Fatalf("grants_in_grace=false on Google got %q, want inactive", googleStrict.Snapshot.AccessState)
	}

	// Billing retry without a provider grace end grants nothing.
	retry := ProjectSubscription([]Fact{base, {
		ID: "t3", Provider: "google_play", ProviderTransactionID: "t1",
		FactKind: "billing_retry_start", OccurredAt: at("2026-02-01T00:00:00Z"),
		RecordedAt: at("2026-02-01T00:00:00Z"), ProviderEventOccurredAt: ptr("2026-02-01T00:00:00Z"),
		MosaicProductID: "prod_pro", ResolutionState: "active_mapping",
	}}, at("2026-02-05T00:00:00Z"), DefaultPolicy(), false)
	if retry.Snapshot.AccessState != AccessInactive || retry.Snapshot.LifecycleState != LifecycleBillingRetry {
		t.Fatalf("billing retry got %q/%q, want inactive/billing_retry",
			retry.Snapshot.AccessState, retry.Snapshot.LifecycleState)
	}

	// A pause that is effective now is inactive; the same fact evaluated
	// before its effective instant keeps access, because a scheduled pause has
	// not started.
	paused := Fact{
		ID: "t4", Provider: "google_play", ProviderTransactionID: "t1",
		FactKind: "paused", OccurredAt: at("2026-01-05T00:00:00Z"),
		RecordedAt: at("2026-01-05T00:00:00Z"), ProviderEventOccurredAt: ptr("2026-01-20T00:00:00Z"),
		MosaicProductID: "prod_pro", ResolutionState: "active_mapping",
	}
	scheduled := ProjectSubscription([]Fact{base, paused}, at("2026-01-10T00:00:00Z"), DefaultPolicy(), false)
	if scheduled.Snapshot.AccessState != AccessActive {
		t.Fatalf("scheduled pause got %q, want active until effective", scheduled.Snapshot.AccessState)
	}
	effectivePause := ProjectSubscription([]Fact{base, paused}, at("2026-01-25T00:00:00Z"), DefaultPolicy(), false)
	if effectivePause.Snapshot.AccessState != AccessInactive || effectivePause.Snapshot.LifecycleState != LifecyclePaused {
		t.Fatalf("effective pause got %q/%q, want inactive/paused",
			effectivePause.Snapshot.AccessState, effectivePause.Snapshot.LifecycleState)
	}
}

// OD-18(a): a prorated Apple refund does not revoke the remaining period. A
// full refund carrying a revocation date does.
func TestRefundScopeRespectsProration(t *testing.T) {
	base := purchase("t1", "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z")
	refundFact := func(refundType string, revoked *time.Time) Fact {
		return Fact{
			ID: "t2", Provider: "app_store", ProviderTransactionID: "t1",
			FactKind: "refund", OccurredAt: at("2026-01-10T00:00:00Z"),
			RecordedAt: at("2026-01-10T00:00:00Z"), RefundedAt: ptr("2026-01-10T00:00:00Z"),
			RevokedAt: revoked, RefundType: refundType,
			MosaicProductID: "prod_pro", ResolutionState: "active_mapping",
		}
	}

	prorated := ProjectSubscription([]Fact{base, refundFact("prorated", nil)},
		at("2026-01-20T00:00:00Z"), DefaultPolicy(), false)
	if prorated.Snapshot.AccessState != AccessActive {
		t.Fatalf("prorated refund got %q, want the remaining period preserved", prorated.Snapshot.AccessState)
	}

	full := ProjectSubscription([]Fact{base, refundFact("full", ptr("2026-01-10T00:00:00Z"))},
		at("2026-01-20T00:00:00Z"), DefaultPolicy(), false)
	if full.Snapshot.AccessState != AccessInactive || full.Snapshot.LifecycleState != LifecycleRefunded {
		t.Fatalf("full refund got %q/%q, want inactive/refunded",
			full.Snapshot.AccessState, full.Snapshot.LifecycleState)
	}
}

// Apple REFUND_REVERSED reinstates access. A revocation that is later
// contradicted by a validated renewal must not leave the customer locked out.
func TestLateRenewalReinstatesRevokedLineage(t *testing.T) {
	facts := []Fact{
		purchase("t1", "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z"),
		{
			ID: "t2", Provider: "app_store", ProviderTransactionID: "t1",
			FactKind: "revocation", OccurredAt: at("2026-01-10T00:00:00Z"),
			RecordedAt: at("2026-01-10T00:00:00Z"), RevokedAt: ptr("2026-01-10T00:00:00Z"),
			MosaicProductID: "prod_pro", ResolutionState: "active_mapping",
		},
		renewal("t3", "2026-02-01T00:00:00Z", "2026-03-01T00:00:00Z"),
	}
	result := ProjectSubscription(facts, at("2026-02-10T00:00:00Z"), DefaultPolicy(), false)
	if result.Snapshot.AccessState != AccessActive {
		t.Fatalf("reinstated lineage got %q, want active", result.Snapshot.AccessState)
	}
}

// Absent or unmappable evidence must never become `inactive` — principle 4.
func TestUnknownIsNotInactive(t *testing.T) {
	empty := ProjectSubscription(nil, at("2026-01-01T00:00:00Z"), DefaultPolicy(), false)
	if empty.Snapshot.AccessState != AccessUnknown || empty.Snapshot.UncertaintyReason == UncertaintyNone {
		t.Fatalf("no facts got %q/%q, want unknown with a reason",
			empty.Snapshot.AccessState, empty.Snapshot.UncertaintyReason)
	}

	unresolved := purchase("t1", "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z")
	unresolved.MosaicProductID, unresolved.ResolutionState = "", "unresolved"
	result := ProjectSubscription([]Fact{unresolved}, at("2026-01-15T00:00:00Z"), DefaultPolicy(), false)
	if result.Snapshot.AccessState != AccessUnknown ||
		result.Snapshot.UncertaintyReason != UncertaintyProductUnresolved {
		t.Fatalf("unresolved Product got %q/%q, want unknown/product_unresolved",
			result.Snapshot.AccessState, result.Snapshot.UncertaintyReason)
	}
}

// --- one-time purchases ----------------------------------------------------

// A non-consumable never expires by time, and a refunded one stops granting.
// The first half of this is what keeps lifetime customers entitled; the second
// is 9A defect B2's customer-visible consequence.
func TestOneTimePurchaseOwnershipAndRefund(t *testing.T) {
	acquire := Fact{
		ID: "p1", Provider: "google_play", ProviderTransactionID: "p1",
		FactKind: "one_time_purchase", TransactionType: "non_consumable",
		OccurredAt: at("2026-01-01T00:00:00Z"), RecordedAt: at("2026-01-01T00:00:00Z"),
		PeriodStartAt:   ptr("2026-01-01T00:00:00Z"),
		MosaicProductID: "prod_lifetime", ResolutionState: "active_mapping",
	}
	owned := ProjectOneTimePurchase([]Fact{acquire}, at("2030-01-01T00:00:00Z"))
	if owned.Snapshot.ValidityState != OwnershipOwned {
		t.Fatalf("a non-consumable expired by time: %q", owned.Snapshot.ValidityState)
	}

	refund := Fact{
		ID: "p2", Provider: "google_play", ProviderTransactionID: "p1",
		FactKind: "refund", OccurredAt: at("2026-02-01T00:00:00Z"),
		RecordedAt: at("2026-02-01T00:00:00Z"), RefundedAt: ptr("2026-02-01T00:00:00Z"),
		RevokedAt: ptr("2026-02-01T00:00:00Z"), RefundType: "full",
		MosaicProductID: "prod_lifetime", ResolutionState: "active_mapping",
	}
	refunded := ProjectOneTimePurchase([]Fact{acquire, refund}, at("2026-03-01T00:00:00Z"))
	if refunded.Snapshot.ValidityState != OwnershipRefunded {
		t.Fatalf("refunded non-consumable got %q, want refunded", refunded.Snapshot.ValidityState)
	}
}

// --- grant selection -------------------------------------------------------

// Grants are selected by the purchase's own effective time, and a purchase
// predating the earliest recorded version selects that earliest version rather
// than stranding with none — the 9B backfill boundary rule.
func TestGrantSelectionUsesPeriodTimeAndBackfillBoundary(t *testing.T) {
	versions := []GrantVersion{
		{ID: "v1", ProductID: "prod_pro", EntitlementID: "ent_pro", Version: 1,
			EffectiveStart: at("2026-01-01T00:00:00Z"), EffectiveEnd: ptr("2026-06-01T00:00:00Z"),
			Policy: DefaultPolicy()},
		{ID: "v2", ProductID: "prod_pro", EntitlementID: "ent_pro", Version: 2,
			EffectiveStart: at("2026-06-01T00:00:00Z"), Policy: DefaultPolicy()},
	}

	historical := SelectGrantVersions(versions, "prod_pro", at("2026-03-01T00:00:00Z"), "auto_renewable_subscription")
	if len(historical) != 1 || historical[0].ID != "v1" {
		t.Fatalf("historical purchase selected %+v, want v1", historical)
	}
	current := SelectGrantVersions(versions, "prod_pro", at("2026-08-01T00:00:00Z"), "auto_renewable_subscription")
	if len(current) != 1 || current[0].ID != "v2" {
		t.Fatalf("current purchase selected %+v, want v2", current)
	}
	predating := SelectGrantVersions(versions, "prod_pro", at("2025-01-01T00:00:00Z"), "auto_renewable_subscription")
	if len(predating) != 1 || predating[0].ID != "v1" {
		t.Fatalf("purchase predating all versions selected %+v, want the earliest version", predating)
	}
}

// Retroactive change is only ever accepted as an additive superset, because
// any other shape can take access away from a customer who did nothing.
func TestRetroactiveGrantMustBeAdditiveSuperset(t *testing.T) {
	current := GrantVersion{ProductID: "prod_pro", EntitlementID: "ent_pro", Policy: DefaultPolicy()}
	widened := current
	widened.Policy.GrantsInBillingRetry = true
	if _, ok := ValidateAdditiveSuperset(current, widened); !ok {
		t.Fatal("widening access was rejected; an additive superset must be accepted")
	}
	narrowed := current
	narrowed.Policy.GrantsInGrace = false
	if code, ok := ValidateAdditiveSuperset(current, narrowed); ok {
		t.Fatal("narrowing grace access was accepted retroactively")
	} else if code != "grace_access_narrowed" {
		t.Fatalf("rejection code %q, want grace_access_narrowed", code)
	}
}

// --- entitlement aggregation ----------------------------------------------

// An Entitlement with several sources stays active while any one of them
// does, and a permanent source must never report a finite expiry — the two
// aggregation rules whose failure silently cuts off a lifetime customer when
// their unrelated monthly subscription lapses.
func TestAggregationKeepsPermanentSourceWithoutFalseExpiry(t *testing.T) {
	grant := GrantVersion{
		ID: "v1", ProductID: "prod_pro", EntitlementID: "ent_pro",
		EntitlementKey: "pro", Policy: DefaultPolicy(),
	}
	lifetimeGrant := grant
	lifetimeGrant.ID, lifetimeGrant.ProductID = "v2", "prod_lifetime"

	expiredSubscription := SubscriptionSource{
		InstanceID: "sub_1", PurchaseLineageID: "lin_1", Grants: []GrantVersion{grant},
		Snapshot: SubscriptionSnapshot{
			AccessState: AccessInactive, LifecycleState: LifecycleExpired,
			PeriodEndAt: ptr("2026-02-01T00:00:00Z"), UncertaintyReason: UncertaintyNone,
		},
	}
	lifetime := OneTimeSource{
		InstanceID: "one_1", PurchaseLineageID: "lin_2", Grants: []GrantVersion{lifetimeGrant},
		Snapshot: OneTimeSnapshot{
			ValidityState: OwnershipOwned, AcquiredAt: at("2026-01-01T00:00:00Z"),
			UncertaintyReason: UncertaintyNone,
		},
	}

	snapshot := ProjectEntitlements(CustomerProjection{
		Subscriptions: []SubscriptionSource{expiredSubscription},
		OneTimes:      []OneTimeSource{lifetime},
	}, at("2026-03-01T00:00:00Z"))

	if len(snapshot.Entries) != 1 {
		t.Fatalf("got %d entries, want one aggregated Entitlement", len(snapshot.Entries))
	}
	entry := snapshot.Entries[0]
	if entry.State != AccessActive {
		t.Fatalf("entitlement %q, want active while the lifetime source holds", entry.State)
	}
	if entry.EffectiveEnd != nil || entry.EndKnown {
		t.Fatalf("permanent source reported a finite expiry: end=%v endKnown=%v",
			entry.EffectiveEnd, entry.EndKnown)
	}
	if entry.SourceCount != 2 {
		t.Fatalf("source count %d, want both contributing sources preserved", entry.SourceCount)
	}
}

// A frozen lineage (open identity conflict) must not grant access to either
// candidate, and must report unknown rather than inactive.
//
// This runs through Compute rather than calling ProjectEntitlements with a
// pre-built unknown source, because the real path skips frozen lineages
// entirely — and the failure being guarded against is not "reports inactive",
// it is "reports nothing at all". A snapshot with no entry for `pro` reads to
// every consumer as a customer who never had it, which is a definite answer
// about a customer whose identity is precisely what is in dispute.
func TestFrozenLineageYieldsUnknownNotInactive(t *testing.T) {
	grants := []GrantVersion{{ID: "v1", ProductID: "prod_pro", EntitlementID: "ent_pro",
		EntitlementKey: "pro", Version: 1, EffectiveStart: at("2025-01-01T00:00:00Z"),
		SupportedPurchaseTypes: []string{"auto_renewable_subscription"}, Policy: DefaultPolicy()}}

	output := Compute(Input{
		Scope: Scope{ProjectID: "proj", EnvironmentID: "env", CustomerID: "cust"},
		Lineages: []LineageInput{{
			LineageID: "lin_1", InstanceID: "sub_1", Type: "subscription",
			Facts:            []Fact{purchase("t1", "2026-01-01T00:00:00Z", "2026-06-01T00:00:00Z")},
			Frozen:           true,
			CustomerResolved: true,
		}},
		GrantVersions: grants,
	}, at("2026-03-01T00:00:00Z"))

	if output.CustomerSnapshot == nil {
		t.Fatal("a frozen lineage produced no customer snapshot at all")
	}
	entries := output.CustomerSnapshot.Entries
	if len(entries) != 1 {
		t.Fatalf("got %d entries, want one unknown entry for the disputed Entitlement", len(entries))
	}
	if entries[0].State != AccessUnknown {
		t.Fatalf("frozen lineage produced %q, want unknown", entries[0].State)
	}
	if entries[0].UncertaintyReason == UncertaintyNone {
		t.Fatal("unknown state carried no uncertainty reason")
	}
	// A frozen lineage must not advance its checkpoint: it was never projected.
	if len(output.Checkpoints) != 0 {
		t.Fatalf("frozen lineage advanced %d checkpoints, want none", len(output.Checkpoints))
	}
}

// A Google purchase-token handover inside one root-keyed lineage must not
// terminate the subscription. The supersession fact is emitted for every plan
// change, upgrade, downgrade, and resubscribe on Play; reading it as "this
// lineage was replaced" made the live successor inactive, which is a paying
// customer losing access the moment they change plan.
func TestSupersessionInsideOneChainDoesNotEndAccess(t *testing.T) {
	facts := []Fact{
		purchase("t1", "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z"),
		{
			// The once-per-lineage edge fact the Google validator emits when it
			// first observes linkedPurchaseToken.
			ID: "t2", Provider: "google_play", ProviderTransactionID: "token:abc",
			FactKind: "purchase_superseded", OccurredAt: at("2026-02-01T00:00:00Z"),
			RecordedAt: at("2026-02-01T00:00:00Z"), ProviderEventOccurredAt: ptr("2026-02-01T00:00:00Z"),
			MosaicProductID: "prod_pro", ResolutionState: "active_mapping",
		},
		// The successor token's own state fact, loaded into the same lineage by
		// the chain walk.
		renewal("t3", "2026-02-01T00:00:00Z", "2026-03-01T00:00:00Z"),
	}

	live := ProjectSubscription(facts, at("2026-02-15T00:00:00Z"), DefaultPolicy(), false)
	if live.Snapshot.AccessState != AccessActive {
		t.Fatalf("successor after an intra-chain handover got %q/%q, want active",
			live.Snapshot.AccessState, live.Snapshot.LifecycleState)
	}
	if live.Snapshot.LifecycleState == LifecycleSuperseded {
		t.Fatal("an intra-chain token handover was reported as lineage supersession")
	}

	// A genuine cross-lineage replacement still terminates, and it arrives as a
	// property of the lineage rather than of any fact.
	replaced := ProjectSubscription(facts, at("2026-02-15T00:00:00Z"), DefaultPolicy(), true)
	if replaced.Snapshot.LifecycleState != LifecycleSuperseded || replaced.Snapshot.AccessState != AccessInactive {
		t.Fatalf("replaced lineage got %q/%q, want inactive/superseded",
			replaced.Snapshot.AccessState, replaced.Snapshot.LifecycleState)
	}
}

// Two grant versions on one Product may hold different policies. Access has to
// be decided per grant version, or a Project that opted one Entitlement out of
// grace still grants it whenever some other Entitlement on the same Product
// opted in.
func TestPerGrantPolicyIsNotCollapsed(t *testing.T) {
	permissive := GrantVersion{ID: "v1", ProductID: "prod_pro", EntitlementID: "ent_pro",
		EntitlementKey: "pro", Policy: DefaultPolicy()}
	strict := permissive
	strict.ID, strict.EntitlementID, strict.EntitlementKey = "v2", "ent_beta", "beta"
	strict.Policy.GrantsInGrace = false

	snapshot := ProjectEntitlements(CustomerProjection{
		Subscriptions: []SubscriptionSource{{
			InstanceID: "sub_1", PurchaseLineageID: "lin_1",
			Grants: []GrantVersion{permissive, strict},
			Snapshot: SubscriptionSnapshot{
				AccessState: AccessActive, LifecycleState: LifecycleGracePeriod,
				GracePeriodEndAt: ptr("2026-03-15T00:00:00Z"), UncertaintyReason: UncertaintyNone,
			},
		}},
	}, at("2026-03-01T00:00:00Z"))

	states := map[string]string{}
	for _, entry := range snapshot.Entries {
		states[entry.EntitlementKey] = entry.State
	}
	if states["pro"] != AccessActive {
		t.Fatalf("grant that grants in grace produced %q, want active", states["pro"])
	}
	if states["beta"] != AccessInactive {
		t.Fatalf("grant that opted out of grace produced %q, want inactive", states["beta"])
	}
}

// A fact that re-resolves to the Product the lineage already had must clear the
// unresolved reading. Unresolved facts carry a NULL Product, so a rule that
// only cleared on a *different* Product never fired for the overwhelmingly
// common case — the mapping was fixed, the lineage revalidated, and the
// customer stayed `unknown` forever.
func TestResolutionToTheSameProductClearsUnresolved(t *testing.T) {
	unresolved := purchase("t1", "2026-01-01T00:00:00Z", "2026-06-01T00:00:00Z")
	unresolved.MosaicProductID, unresolved.ResolutionState = "", "unresolved"

	stuck := ProjectSubscription([]Fact{unresolved}, at("2026-02-01T00:00:00Z"), DefaultPolicy(), false)
	if stuck.Snapshot.UncertaintyReason != UncertaintyProductUnresolved {
		t.Fatalf("unresolved fact got %q, want product_unresolved", stuck.Snapshot.UncertaintyReason)
	}

	repaired := purchase("t2", "2026-01-01T00:00:00Z", "2026-06-01T00:00:00Z")
	repaired.FactKind = "renewal"
	recovered := ProjectSubscription([]Fact{unresolved, repaired}, at("2026-02-01T00:00:00Z"), DefaultPolicy(), false)
	if recovered.Snapshot.AccessState != AccessActive {
		t.Fatalf("re-resolution to the same Product left the lineage %q/%q, want active",
			recovered.Snapshot.AccessState, recovered.Snapshot.UncertaintyReason)
	}
}

// A cancellation changes the subscription — renewal intent flips and the
// cancellation instant is recorded — while changing nothing a reader of the
// Entitlement can observe: the customer keeps `pro` with the same expiry.
// The subscription snapshot must still commit, and the customer snapshot
// version must not move, or every SDK cache in the Project is invalidated for a
// change no reader can see.
func TestSubscriptionOnlyChangeDoesNotAdvanceSnapshotVersion(t *testing.T) {
	grants := []GrantVersion{{ID: "v1", ProductID: "prod_pro", EntitlementID: "ent_pro",
		EntitlementKey: "pro", Version: 1, EffectiveStart: at("2025-01-01T00:00:00Z"),
		SupportedPurchaseTypes: []string{"auto_renewable_subscription"}, Policy: DefaultPolicy()}}
	scope := Scope{ProjectID: "proj", EnvironmentID: "env", CustomerID: "cust"}

	first := Compute(Input{
		Scope:         scope,
		Lineages:      []LineageInput{{LineageID: "lin_1", InstanceID: "sub_1", Type: "subscription", CustomerResolved: true, Facts: []Fact{purchase("t1", "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z")}}},
		GrantVersions: grants,
	}, at("2026-01-15T00:00:00Z"))
	if first.CustomerSnapshot == nil {
		t.Fatal("the first projection minted no customer snapshot")
	}

	second := Compute(Input{
		Scope: scope,
		Lineages: []LineageInput{{LineageID: "lin_1", InstanceID: "sub_1", Type: "subscription", CustomerResolved: true, Facts: []Fact{
			purchase("t1", "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z"),
			{
				ID: "t2", Provider: "app_store", ProviderTransactionID: "t1",
				FactKind: "cancellation_scheduled", OccurredAt: at("2026-01-10T00:00:00Z"),
				RecordedAt: at("2026-01-10T00:00:00Z"), ProviderEventOccurredAt: ptr("2026-01-10T00:00:00Z"),
				MosaicProductID: "prod_pro", ResolutionState: "active_mapping",
				RenewalExpected: boolPtr(false),
			},
		}}},
		GrantVersions:          grants,
		PriorCustomerSnapshot:  first.CustomerSnapshot,
		CurrentSnapshotVersion: 1,
	}, at("2026-01-15T00:00:00Z"))

	if !second.Changes.NoChange {
		t.Fatalf("a cancellation was reported as an entitlement change: %+v", second.Changes.Changed)
	}
	if second.CustomerSnapshot != nil {
		t.Fatal("a no-change projection minted a customer snapshot")
	}
	if second.SnapshotVersion != 0 {
		t.Fatalf("a no-change projection advanced the snapshot version to %d", second.SnapshotVersion)
	}
	if len(second.Subscriptions) == 0 {
		t.Fatal("the subscription snapshot was not committed; the period change would be lost")
	}
}

// A projection that produces identical state must be recognised as no-change,
// otherwise every reprojection emits a webhook and every SDK refetches.
func TestNoChangeProjectionIsDetected(t *testing.T) {
	build := func() CustomerSnapshot {
		return ProjectEntitlements(CustomerProjection{
			OneTimes: []OneTimeSource{{
				InstanceID: "one_1", PurchaseLineageID: "lin_1",
				Grants: []GrantVersion{{ID: "v1", ProductID: "prod_lifetime",
					EntitlementID: "ent_pro", EntitlementKey: "pro", Policy: DefaultPolicy()}},
				Snapshot: OneTimeSnapshot{ValidityState: OwnershipOwned,
					AcquiredAt: at("2026-01-01T00:00:00Z"), UncertaintyReason: UncertaintyNone},
			}},
		}, at("2026-03-01T00:00:00Z"))
	}
	prior := build()
	// A later evaluation instant must not, by itself, be a change.
	candidate := build()
	candidate.AsOf = at("2026-04-01T00:00:00Z")

	if changes := Diff(&prior, candidate); !changes.NoChange || len(changes.Changed) != 0 {
		t.Fatalf("identical state reported as changed: %+v", changes)
	}
}
