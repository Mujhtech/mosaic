package experiment

import (
	"testing"
	"time"
)

func TestCompileGuardrailReportsRealCountsMaturityAndWarning(t *testing.T) {
	now := time.Date(2026, 7, 27, 12, 0, 0, 0, time.UTC)
	fresh := now.Add(-time.Minute)
	result := compileGuardrail(Experiment{State: "completed", UpdatedAt: now.Add(-2 * time.Hour)}, GuardrailAggregate{
		Definition: MetricDefinition{ID: "purchase_failure_rate", Version: 1, Name: "Purchase failure", AttributionWindowSeconds: 3600, FreshnessSeconds: 900},
		Variants: []VariantAggregate{
			{VariantID: "control", Role: "control", UniqueExposures: 120, UniqueConversions: 3, LatestReceivedAt: &fresh},
			{VariantID: "treatment", Role: "treatment", UniqueExposures: 130, UniqueConversions: 13, LatestReceivedAt: &fresh},
		},
	}, now)
	if result.Status != "warning" || result.Maturity.Status != "mature" || !result.Maturity.AttributionWindowClosed {
		t.Fatalf("guardrail status/maturity = %#v", result)
	}
	if result.DenominatorCount != 250 || result.NumeratorCount != 16 || len(result.Variants) != 2 {
		t.Fatalf("guardrail counts = %#v", result)
	}
}

func TestCompileGuardrailKeepsImmatureAndStaleDataVisible(t *testing.T) {
	now := time.Date(2026, 7, 27, 12, 0, 0, 0, time.UTC)
	stale := now.Add(-20 * time.Minute)
	result := compileGuardrail(Experiment{State: "running", UpdatedAt: now.Add(-24 * time.Hour)}, GuardrailAggregate{
		Definition: MetricDefinition{ID: "fallback_rate", Version: 1, Name: "Fallback", AttributionWindowSeconds: 3600, FreshnessSeconds: 900},
		Variants:   []VariantAggregate{{VariantID: "control", Role: "control", UniqueExposures: 12, UniqueConversions: 1, LatestReceivedAt: &stale}},
	}, now)
	if result.Status != "stale" || result.Maturity.Status != "interim" || result.DenominatorCount != 12 || result.NumeratorCount != 1 {
		t.Fatalf("stale immature guardrail = %#v", result)
	}
}
