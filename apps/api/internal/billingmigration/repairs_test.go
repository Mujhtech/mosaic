package billingmigration

import "testing"

func TestRepairAllowlistAndScopePairing(t *testing.T) {
	allowed := map[string]string{
		RepairRevalidateProviderReference: "provider_reference",
		RepairReplayFactRange:             "fact_range",
		RepairAttachProvenAlias:           "audited_alias",
		RepairReplaceMappingSet:           "mapping_set",
		RepairRetryQuarantinedRecord:      "source_record",
	}
	for kind, scope := range allowed {
		if !repairKind(kind) || !repairScope(kind, scope) {
			t.Fatalf("allowlisted repair %q/%q rejected", kind, scope)
		}
		if repairScope(kind, "arbitrary_row") {
			t.Fatalf("repair %q accepted arbitrary scope", kind)
		}
	}
	for _, kind := range []string{"arbitrary_sql", "grant_forever", "mutate_fact", "mutate_snapshot", "mutate_live_pointer"} {
		if repairKind(kind) {
			t.Fatalf("unsafe repair %q accepted", kind)
		}
	}
}

func TestRepairKindsMatchBillingMigrationOperationsV1(t *testing.T) {
	got := []string{
		RepairRevalidateProviderReference,
		RepairReplayFactRange,
		RepairAttachProvenAlias,
		RepairReplaceMappingSet,
		RepairRetryQuarantinedRecord,
	}
	want := []string{
		"provider_revalidate",
		"projection_replay",
		"attach_proven_alias",
		"replace_mapping_set",
		"retry_quarantined_record",
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("repair kind %d = %q, want protocol value %q", i, got[i], want[i])
		}
	}
}
