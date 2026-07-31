package billingmigration

import (
	"bytes"
	"testing"
)

func TestSourcePullCapabilityAssessmentIsStableAndClosed(t *testing.T) {
	evidence := bytes.Repeat([]byte{0x41}, 32)
	assessment, err := SourcePullCapabilityAssessment("project", "program", 3, ProviderAPIV2, []string{
		SourceCapabilityReadSubscriptions,
		SourceCapabilityReadCustomers,
		SourceCapabilityReadCustomers,
		SourceCapabilityReadAliases,
	}, evidence)
	if err != nil {
		t.Fatal(err)
	}
	if assessment.AssessmentID == "" || len(assessment.AssessmentDigest) != 32 {
		t.Fatalf("assessment identity = %#v digest=%d", assessment.AssessmentID, len(assessment.AssessmentDigest))
	}
	want := []string{SourceCapabilityReadAliases, SourceCapabilityReadCustomers, SourceCapabilityReadSubscriptions}
	if len(assessment.Capabilities) != len(want) {
		t.Fatalf("capabilities = %#v", assessment.Capabilities)
	}
	for i := range want {
		if assessment.Capabilities[i] != want[i] {
			t.Fatalf("capabilities = %#v", assessment.Capabilities)
		}
	}
	again, err := SourcePullCapabilityAssessment("project", "program", 3, ProviderAPIV2, assessment.Capabilities, evidence)
	if err != nil {
		t.Fatal(err)
	}
	if assessment.AssessmentID != again.AssessmentID || !bytes.Equal(assessment.AssessmentDigest, again.AssessmentDigest) {
		t.Fatalf("unstable assessment first=%#v second=%#v", assessment, again)
	}
	if _, err = SourcePullCapabilityAssessment("project", "program", 3, ProviderAPIV2, []string{"read_transfers"}, evidence); err != ErrInvalid {
		t.Fatalf("unsupported capability error=%v", err)
	}
}
