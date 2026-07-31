package billingmigration

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sort"
	"time"
)

const (
	SourceCapabilityReadCustomers     = "read_customers"
	SourceCapabilityReadSubscriptions = "read_subscriptions"
	SourceCapabilityReadAliases       = "read_aliases"
	SourceCapabilityIncrementalDelta  = "incremental_delta"
)

type CapabilityAssessmentAppend struct {
	ProgramID, ProjectID string
	StateVersion         int64
	ProviderAPIVersion   string
	Capabilities         []string
	SourceEvidenceDigest []byte
	AssessmentID         string
	AssessmentDigest     []byte
	AssessedAt           time.Time
}

func SourcePullCapabilityAssessment(projectID, programID string, stateVersion int64, providerAPIVersion string, capabilities []string, sourceEvidenceDigest []byte) (CapabilityAssessmentAppend, error) {
	normalized, err := NormalizeSourceCapabilities(capabilities)
	if err != nil || projectID == "" || programID == "" || stateVersion < 1 || providerAPIVersion == "" || len(sourceEvidenceDigest) != sha256.Size {
		return CapabilityAssessmentAppend{}, ErrInvalid
	}
	digest := SourceCapabilityAssessmentDigest(programID, projectID, stateVersion, providerAPIVersion, normalized, sourceEvidenceDigest)
	idDigest := sha256.Sum256(append([]byte("mosaic-source-capability-assessment-id-v1\x1f"), digest...))
	return CapabilityAssessmentAppend{ProgramID: programID, ProjectID: projectID, StateVersion: stateVersion, ProviderAPIVersion: providerAPIVersion, Capabilities: normalized, SourceEvidenceDigest: append([]byte(nil), sourceEvidenceDigest...), AssessmentID: "mga_pull_" + hex.EncodeToString(idDigest[:12]), AssessmentDigest: digest}, nil
}

func SourceCapabilityAssessmentDigest(programID, projectID string, stateVersion int64, providerAPIVersion string, capabilities []string, sourceEvidenceDigest []byte) []byte {
	payload, _ := json.Marshal(struct {
		Domain                                   string
		ProgramID, ProjectID, ProviderAPIVersion string
		StateVersion                             int64
		Capabilities                             []string
		SourceEvidenceDigest                     []byte
	}{"mosaic-source-pull-capability-assessment-v1", programID, projectID, providerAPIVersion, stateVersion, capabilities, sourceEvidenceDigest})
	sum := sha256.Sum256(payload)
	return sum[:]
}

func NormalizeSourceCapabilities(capabilities []string) ([]string, error) {
	if len(capabilities) == 0 {
		return nil, ErrInvalid
	}
	allowed := map[string]bool{
		SourceCapabilityReadCustomers:     true,
		SourceCapabilityReadSubscriptions: true,
		SourceCapabilityReadAliases:       true,
		SourceCapabilityIncrementalDelta:  true,
	}
	result := append([]string(nil), capabilities...)
	sort.Strings(result)
	out := result[:0]
	for _, capability := range result {
		if !allowed[capability] {
			return nil, ErrInvalid
		}
		if len(out) > 0 && capability == out[len(out)-1] {
			continue
		}
		out = append(out, capability)
	}
	return out, nil
}
