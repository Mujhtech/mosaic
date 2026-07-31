package billingmigration

import "testing"

func TestStabilizationBreachesCoversEveryFrozenThreshold(t *testing.T) {
	thresholds := StabilizationThresholds{SourceDeltaLagMaxSeconds: 60, WebhookFreshnessMaxSeconds: 60}
	metrics := StabilizationMetrics{AuthorityMismatches: 1, AccessAPIErrors: 1, SDKSyncFailures: 1, Divergences: 1, ValidationBacklog: 1, SourceDeltaLagSeconds: 61, WebhookFailures: 1, WebhookAgeSeconds: 61, QuarantinedRecords: 1, SupportCases: 1, OldAppVersions: 1, UnhealthyWorkers: 1}
	got := StabilizationBreaches(thresholds, metrics)
	if len(got) != 12 {
		t.Fatalf("breaches=%v", got)
	}
}

func TestStabilizationThresholdsRejectMissingFreshnessBounds(t *testing.T) {
	if (StabilizationThresholds{}).Valid() {
		t.Fatal("zero freshness bounds were accepted")
	}
}
