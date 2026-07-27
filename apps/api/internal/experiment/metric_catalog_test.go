package experiment

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"testing"
	"time"
)

func repositoryFile(t *testing.T, relative string) string {
	t.Helper()
	_, current, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve test source path")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(current), "../../../..", relative))
}

func TestSeededMetricsUseCanonicalV2EventsAndAssignmentKeyUnit(t *testing.T) {
	schemaBytes, err := os.ReadFile(repositoryFile(t, "protocol/schema/analytics-event/v2/event.schema.json"))
	if err != nil {
		t.Fatal(err)
	}
	var schema struct {
		Definitions map[string]struct {
			Enum []string `json:"enum"`
		} `json:"$defs"`
	}
	if err = json.Unmarshal(schemaBytes, &schema); err != nil {
		t.Fatal(err)
	}
	vocabulary := map[string]bool{}
	for _, name := range schema.Definitions["eventName"].Enum {
		vocabulary[name] = true
	}
	if len(vocabulary) == 0 {
		t.Fatal("canonical Analytics Event v2 vocabulary is empty")
	}
	migration, err := os.ReadFile(repositoryFile(t, "apps/api/migrations/00017_phase_7_experiments.sql"))
	if err != nil {
		t.Fatal(err)
	}
	rowPattern := regexp.MustCompile(`\('([^']+)',1,'[^']*','([^']+)','([^']+)','([^']+)','([^']+)','([^']+)','([^']*)',`)
	rows := rowPattern.FindAllStringSubmatch(string(migration), -1)
	if len(rows) == 0 {
		t.Fatal("no immutable metric seeds found")
	}
	foundProviderPrimary, foundProviderGuardrail := false, false
	for _, row := range rows {
		id, numerator, denominator, unit, authority, availability, filter := row[1], row[2], row[3], row[4], row[5], row[6], row[7]
		if !vocabulary[numerator] || !vocabulary[denominator] {
			t.Errorf("metric %s uses noncanonical events numerator=%s denominator=%s", id, numerator, denominator)
		}
		if unit != "assignment_key" {
			t.Errorf("metric %s analysis unit=%s", id, unit)
		}
		if id == "presentation_provider_purchase" {
			foundProviderPrimary = numerator == "purchase_completed_provider" && authority == "provider_confirmed" && availability == "trusted_source_unavailable"
		}
		if id == "provider_unavailable" {
			foundProviderGuardrail = numerator == "product_unavailable" && filter == `{"payload.reason":"provider_unavailable"}`
		}
	}
	if !foundProviderPrimary {
		t.Error("provider-confirmed primary must use the canonical event and remain unavailable without a trusted source")
	}
	if !foundProviderGuardrail {
		t.Error("provider-unavailable guardrail must use a typed canonical event filter")
	}
}

func TestCompileScheduleAllowsOpenEndedAndPinsImmediateStart(t *testing.T) {
	now := time.Date(2026, 7, 26, 12, 0, 0, 0, time.UTC)
	past := now.Add(-time.Hour)
	compiled, err := CompileSchedule(Schedule{StartsAt: &past}, now)
	if err != nil {
		t.Fatal(err)
	}
	if !compiled.StartsAt.Equal(now) || compiled.EndsAt != nil {
		t.Fatalf("compiled immediate schedule=%+v", compiled)
	}
	expired := now.Add(-time.Minute)
	if _, err = CompileSchedule(Schedule{StartsAt: &past, EndsAt: &expired}, now); err == nil {
		t.Fatal("schedule ending before the authoritative publication time accepted")
	}
}
