package billingmigrationevaluation

import (
	"bytes"
	"crypto/sha256"
	"testing"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/billing"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingmigration"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingprojection"
)

func TestMigrationReferenceDigestUsesPhase9AIdentityContracts(t *testing.T) {
	t.Parallel()
	if got, want := migrationReferenceDigest(billing.ProviderAppStore, "app_store_transaction_id", "transaction"), billing.AppleTransactionKey(billing.StoreUnclassified, "transaction"); !bytes.Equal(got, want) {
		t.Fatal("Apple migration reference did not use the Phase 9A transaction identity")
	}
	if got, want := migrationReferenceDigest(billing.ProviderGooglePlay, "google_play_purchase_token", "token"), billing.TokenDigest("token"); !bytes.Equal(got, want) {
		t.Fatal("Google token migration reference did not use the Phase 9A token identity")
	}
	h := sha256.New()
	h.Write([]byte("mosaic-billing-google-order-v1"))
	h.Write([]byte{0})
	h.Write([]byte("order"))
	if got := migrationReferenceDigest(billing.ProviderGooglePlay, "google_play_order_id", "order"); !bytes.Equal(got, h.Sum(nil)) {
		t.Fatal("Google order migration reference did not use the Phase 9A order identity")
	}
}

func TestCohortGroupingDoesNotFanRecordsAcrossApplications(t *testing.T) {
	t.Parallel()
	lease := billingmigration.ExecutionLease{ProgramID: "program", JobID: "job", ExpectedStateVersion: 3}
	records := []cohortRecord{
		{scope: evaluationScope{applicationID: "app_ios", platform: "ios"}, recordID: "ios_record", sourceID: "source_ios", digest: bytes.Repeat([]byte{1}, 32), targets: []string{"ios_customer"}, currentAccess: true, providerEnvironment: "production", expectedStoreEnvironment: "production"},
		{scope: evaluationScope{applicationID: "app_android", platform: "android"}, recordID: "android_record", sourceID: "source_android", digest: bytes.Repeat([]byte{2}, 32), targets: []string{"android_customer"}, providerEnvironment: "production", expectedStoreEnvironment: "production"},
	}
	cohort, divergences := groupCohortRecords(lease, records, time.Unix(1, 0))
	if len(divergences) != 0 {
		t.Fatalf("unexpected divergences: %+v", divergences)
	}
	if len(cohort) != 2 {
		t.Fatalf("got %d cohort rows, want exact two", len(cohort))
	}
	for _, item := range cohort {
		if item.scope.applicationID == "app_ios" && item.customerID != "ios_customer" {
			t.Fatal("iOS source contaminated by Android customer")
		}
		if item.scope.applicationID == "app_android" && item.customerID != "android_customer" {
			t.Fatal("Android source contaminated by iOS customer")
		}
	}
}

func TestMissingFactDivergenceIsCustomerScopedWithinApplication(t *testing.T) {
	t.Parallel()
	lease := billingmigration.ExecutionLease{ProgramID: "program", JobID: "job", ExpectedStateVersion: 3}
	scope := evaluationScope{applicationID: "shared_app", platform: "ios"}
	at := time.Unix(1, 0)
	withFact := billingprojection.Input{Lineages: []billingprojection.LineageInput{{Facts: []billingprojection.Fact{{ID: "validated"}}}}}
	withoutFact := billingprojection.Input{}
	if got := missingCustomerFactDivergence(lease, cohortItem{scope: scope, customerID: "customer_a", sourceCurrentAccess: true}, withFact, at); got != nil {
		t.Fatal("customer with its own validated fact was marked missing")
	}
	got := missingCustomerFactDivergence(lease, cohortItem{scope: scope, customerID: "customer_b", sourceCurrentAccess: true}, withoutFact, at)
	if got == nil || got.Divergence.Reason != "provider_validation_missing" {
		t.Fatalf("second customer borrowed first customer's fact: %+v", got)
	}
}

func TestFinalCohortExpandsEveryCustomerAcrossExactScopes(t *testing.T) {
	t.Parallel()
	ios := evaluationScope{applicationID: "app_ios", platform: "ios"}
	android := evaluationScope{applicationID: "app_android", platform: "android"}
	sourceDigest := bytes.Repeat([]byte{0x41}, 32)
	got := expandFinalCohort([]cohortItem{{scope: ios, customerID: "customer", sourceDigests: [][]byte{sourceDigest}, sourceCurrentAccess: true}}, []evaluationScope{ios, android})
	if len(got) != 2 {
		t.Fatalf("expanded cohort rows=%d want=2", len(got))
	}
	for _, item := range got {
		if item.scope == ios && (!item.sourceCurrentAccess || len(item.sourceDigests) != 1) {
			t.Fatal("originating scope lost its source evidence")
		}
		if item.scope == android && (item.sourceCurrentAccess || len(item.sourceDigests) != 0) {
			t.Fatal("source evidence contaminated the synthetic Android scope")
		}
	}
}

func TestAccessComparisonDetectsBothDivergenceDirections(t *testing.T) {
	t.Parallel()
	lease := billingmigration.ExecutionLease{ProgramID: "program", JobID: "job", ExpectedStateVersion: 3}
	evidence := bytes.Repeat([]byte{3}, 32)
	at := time.Unix(1, 0)
	if got := accessComparisonDivergence(lease, true, false, evidence, at); got == nil || got.Divergence.Reason != "source_grants_mosaic_denies" {
		t.Fatalf("source grant divergence=%+v", got)
	}
	if got := accessComparisonDivergence(lease, false, true, evidence, at); got == nil || got.Divergence.Reason != "mosaic_grants_source_denies" {
		t.Fatalf("Mosaic grant divergence=%+v", got)
	}
	if got := accessComparisonDivergence(lease, true, true, evidence, at); got != nil {
		t.Fatal("matching active access diverged")
	}
}

func TestCohortQuarantinesStoreEnvironmentMismatch(t *testing.T) {
	t.Parallel()
	lease := billingmigration.ExecutionLease{ProgramID: "program", JobID: "job", ExpectedStateVersion: 3}
	records := []cohortRecord{{scope: evaluationScope{applicationID: "app", platform: "ios"}, recordID: "record", sourceID: "customer", digest: bytes.Repeat([]byte{1}, 32), targets: []string{"customer"}, currentAccess: true, providerEnvironment: "sandbox", expectedStoreEnvironment: "production"}}
	cohort, divergences := groupCohortRecords(lease, records, time.Unix(1, 0))
	if len(cohort) != 0 {
		t.Fatal("environment-mismatched record entered candidate cohort")
	}
	if len(divergences) != 1 || divergences[0].Divergence.Reason != "normalization_difference" {
		t.Fatalf("environment mismatch divergence=%+v", divergences)
	}
}

func TestPrepareProjectionInputAdmitsOnlyExactValidatedFacts(t *testing.T) {
	t.Parallel()
	prior := &billingprojection.CustomerSnapshot{Checksum: bytes.Repeat([]byte{0x44}, 32)}
	input := billingprojection.Input{PriorCustomerSnapshot: prior, RuleVersion: 99, Lineages: []billingprojection.LineageInput{
		{LineageID: "accepted", SnapshotID: "live_snapshot", Checkpoint: "watermark", CheckpointChecksum: []byte{1}, CheckpointFacts: 2, Facts: []billingprojection.Fact{{ID: "fact_accepted"}, {ID: "fact_other_program"}}},
		{LineageID: "foreign", Facts: []billingprojection.Fact{{ID: "fact_wrong_scope"}}},
	}}
	got := prepareProjectionInput(input, map[string]bool{"fact_accepted": true})
	if len(got.Lineages) != 1 || got.Lineages[0].LineageID != "accepted" || len(got.Lineages[0].Facts) != 1 || got.Lineages[0].Facts[0].ID != "fact_accepted" {
		t.Fatalf("unexpected filtered input: %+v", got.Lineages)
	}
	if got.PriorCustomerSnapshot != nil || got.RuleVersion != billingprojection.ActiveRuleVersion {
		t.Fatal("candidate reused live comparison state or non-accepted rules")
	}
	lineage := got.Lineages[0]
	if lineage.SnapshotID != "" || lineage.Checkpoint != "" || lineage.CheckpointChecksum != nil || lineage.CheckpointFacts != 0 {
		t.Fatal("candidate reused a live snapshot/checkpoint")
	}
}

func TestEvaluationDigestsAreOrderIndependentAndDomainSeparated(t *testing.T) {
	t.Parallel()
	a := bytes.Repeat([]byte{0x11}, 32)
	b := bytes.Repeat([]byte{0x22}, 32)
	first := hashSorted("candidate-source", [][]byte{append([]byte(nil), b...), append([]byte(nil), a...)})
	second := hashSorted("candidate-source", [][]byte{append([]byte(nil), a...), append([]byte(nil), b...)})
	if !bytes.Equal(first, second) {
		t.Fatal("replaying the same immutable evidence in a different read order changed the digest")
	}
	if bytes.Equal(first, hashSorted("candidate-comparison", [][]byte{a, b})) {
		t.Fatal("source and comparison evidence domains collided")
	}
}

func TestStableCandidateIdentifiersExcludeLeaseAttempt(t *testing.T) {
	t.Parallel()
	first := stableID("cesm", "evaluation", "app", "ios", "customer")
	second := stableID("cesm", "evaluation", "app", "ios", "customer")
	if first != second {
		t.Fatal("deterministic replay changed the immutable candidate identifier")
	}
	if first == stableID("cesm", "evaluation", "app", "android", "customer") {
		t.Fatal("platform scope was omitted from the immutable candidate identifier")
	}
}

func TestProgramBindingAllowsOnlyQueueTransitionVersion(t *testing.T) {
	t.Parallel()
	dry := billingmigration.ExecutionLease{JobKind: "dry_run", ExpectedStateVersion: 3}
	if !validProgramBinding(dry, "dry_run", 3) || !validProgramBinding(dry, "dry_run", 4) {
		t.Fatal("dry-run queue's atomic state transition was rejected")
	}
	if validProgramBinding(dry, "dry_run", 5) || validProgramBinding(dry, "shadowing", 4) {
		t.Fatal("stale or wrong-state dry run was accepted")
	}
	shadow := billingmigration.ExecutionLease{JobKind: "shadow", ExpectedStateVersion: 4}
	if !validProgramBinding(shadow, "shadowing", 5) || validProgramBinding(shadow, "dry_run", 5) {
		t.Fatal("shadow state binding is not exact")
	}
	final := billingmigration.ExecutionLease{JobKind: "final_delta", ExpectedStateVersion: 5}
	if !validProgramBinding(final, "shadowing", 5) || !validProgramBinding(final, "ready", 5) || validProgramBinding(final, "ready", 6) {
		t.Fatal("final-delta state/version binding is not exact")
	}
}
