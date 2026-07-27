package experiment

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

func TestWilsonNewcombeAndSRMApprovedVectors(t *testing.T) {
	wilson := Wilson(50, 100)
	if math.Abs(wilson.Lower-0.4038315) > 0.00001 || math.Abs(wilson.Upper-0.5961685) > 0.00001 {
		t.Fatalf("Wilson interval=%+v", wilson)
	}
	newcombe := Newcombe(50, 100, 60, 100)
	if newcombe.Lower >= 0 || newcombe.Upper <= 0.10 {
		t.Fatalf("Newcombe interval=%+v", newcombe)
	}
	ok := SampleRatioMismatch([]VariantAggregate{{VariantID: "control", AllocationBasisPoints: 5000, UniqueExposures: 500}, {VariantID: "treatment", AllocationBasisPoints: 5000, UniqueExposures: 500}})
	if ok.Status != "ok" || ok.Severity != "none" {
		t.Fatalf("balanced SRM=%+v", ok)
	}
	bad := SampleRatioMismatch([]VariantAggregate{{VariantID: "control", AllocationBasisPoints: 5000, UniqueExposures: 900}, {VariantID: "treatment", AllocationBasisPoints: 5000, UniqueExposures: 100}})
	if bad.Status != "mismatch" || bad.Severity != "critical" {
		t.Fatalf("imbalanced SRM=%+v", bad)
	}
	insufficient := SampleRatioMismatch([]VariantAggregate{{VariantID: "control", AllocationBasisPoints: 5000, UniqueExposures: 49}, {VariantID: "treatment", AllocationBasisPoints: 5000, UniqueExposures: 50}})
	if insufficient.Status != "insufficient_sample" {
		t.Fatalf("small SRM=%+v", insufficient)
	}
}

func TestGroupInputUsesStableExperimentRootsAndProtectsAllocation(t *testing.T) {
	input := CreateGroupInput{
		Name:                "Checkout surface",
		AssignmentKeyPolicy: "installation",
		Members: []GroupMemberInput{
			{ExperimentID: "experiment_a", AllocationBasisPoints: 4500},
			{ExperimentID: "experiment_b", AllocationBasisPoints: 4500},
		},
		HoldoutBasisPoints: 1000,
	}
	if err := validateGroupInput(input, true); err != nil {
		t.Fatalf("valid stable-root group rejected: %v", err)
	}
	wire, err := json.Marshal(input.Members[0])
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(wire), `"experimentId":"experiment_a"`) || strings.Contains(string(wire), "experimentVersionId") {
		t.Fatalf("group member wire contract=%s", wire)
	}
	input.Members[1].ExperimentID = "experiment_a"
	if err := validateGroupInput(input, true); err == nil {
		t.Fatal("duplicate Experiment root membership accepted")
	}
}
