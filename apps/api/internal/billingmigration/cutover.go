package billingmigration

import (
	"crypto/sha256"
	"sort"
	"strings"
	"time"
)

const (
	CapabilityProposeCutover  = "propose-cutover"
	CapabilityApproveCutover  = "approve-cutover"
	CapabilityExecuteCutover  = "execute-cutover"
	CapabilityExecuteRollback = "execute-rollback"
)

type PreApprovalDigests struct {
	Scope, Manifest, Mapping, Policy, Evidence, Readiness, FinalWatermark, ApplicationVersion string
}

func (d PreApprovalDigests) Parse() (ParsedDigests, error) {
	values := []*[]byte{}
	parsed := ParsedDigests{}
	values = append(values, &parsed.Scope, &parsed.Manifest, &parsed.Mapping, &parsed.Policy,
		&parsed.Evidence, &parsed.Readiness, &parsed.FinalWatermark, &parsed.ApplicationVersion)
	input := []string{d.Scope, d.Manifest, d.Mapping, d.Policy, d.Evidence, d.Readiness, d.FinalWatermark, d.ApplicationVersion}
	for index, value := range input {
		raw, err := ParseDigest(value)
		if err != nil {
			return ParsedDigests{}, ErrInvalid
		}
		*values[index] = raw
	}
	return parsed, nil
}

type ParsedDigests struct {
	Scope, Manifest, Mapping, Policy, Evidence, Readiness, FinalWatermark, ApplicationVersion []byte
}

type AuthoritativeReadiness struct {
	Assessment               ReadinessAssessment
	SourceCapabilitiesFresh  bool
	WarningThreshold         int64
	ApplicationVersionDigest string
	CohortDigest             string
}

func FinalDeltaCohortDigest(programID, finalDeltaID string, customers []string) (string, error) {
	if programID == "" || finalDeltaID == "" || len(customers) == 0 {
		return "", ErrInvalid
	}
	copyIDs := append([]string(nil), customers...)
	sort.Strings(copyIDs)
	for index, id := range copyIDs {
		if id == "" || (index > 0 && id == copyIDs[index-1]) {
			return "", ErrInvalid
		}
	}
	return FormatDigest(digest(struct {
		ProgramID, FinalDeltaID string
		Customers               []string
	}{programID, finalDeltaID, copyIDs})), nil
}

func AssessAuthoritativeReadiness(programID string, stateVersion int64, base ReadinessAssessment, sourceCapabilitiesFresh bool, warningThreshold int64, applicationVersionDigest string) (AuthoritativeReadiness, error) {
	if _, err := ParseDigest(applicationVersionDigest); err != nil || warningThreshold < 0 {
		return AuthoritativeReadiness{}, ErrInvalid
	}
	base.Ready = base.Ready && sourceCapabilitiesFresh && base.Unresolved.Warning <= warningThreshold
	base.ReadinessDigest = ""
	base.ReadinessDigest = FormatDigest(digest(struct {
		ProgramID                string
		StateVersion             int64
		Assessment               ReadinessAssessment
		SourceCapabilitiesFresh  bool
		WarningThreshold         int64
		ApplicationVersionDigest string
	}{programID, stateVersion, base, sourceCapabilitiesFresh, warningThreshold, applicationVersionDigest}))
	return AuthoritativeReadiness{Assessment: base, SourceCapabilitiesFresh: sourceCapabilitiesFresh, WarningThreshold: warningThreshold, ApplicationVersionDigest: applicationVersionDigest}, nil
}

type PromoteReadyInput struct {
	ProjectID, ProgramID string
	ExpectedStateVersion int64
}

type ProposeCutoverInput struct {
	ProjectID, ProgramID, IdempotencyKey, Command string
	ExpectedStateVersion                          int64
	ExpectedDigests                               PreApprovalDigests
	Reason                                        string
	ExpiresAt                                     time.Time
}

type ProposeRollbackInput struct {
	ProjectID, ProgramID, IdempotencyKey, CheckpointID string
	ExpectedStateVersion                               int64
	ExpectedCheckpointDigest                           string
	ExpectedAuthorityDigest                            string
	ExpectedRollbackPrerequisitesDigest                string
	Reason                                             string
	ExpiresAt                                          time.Time
}

type RollbackExpectedBinding struct {
	CheckpointID, CheckpointDigest, AuthorityDigest, RollbackPrerequisitesDigest string
}

type RollbackProposalBinding struct {
	CheckpointID, CheckpointDigest, AuthorityDigest, RollbackPrerequisitesDigest, ScopeDigest string
	CutoverTransitionID, CutoverTransitionDigest                                              string
	CutoverEpoch                                                                              int64
	CutoverTransitionedAt, RollbackDeadline                                                   time.Time
	CredentialID, CredentialStatus                                                            string
	CredentialRemoved                                                                         bool
	CredentialRemovedAt                                                                       *time.Time
	CapabilityAssessmentID, CapabilityAssessmentDigest                                        string
	CapabilityAssessedAt                                                                      time.Time
	SourceValidationID, SourceValidationDigest                                                string
	SourceValidatedAt                                                                         time.Time
	ProviderValidationID, ProviderValidationDigest                                            string
	ProviderValidatedAt                                                                       time.Time
}

func (b RollbackProposalBinding) Parse() (checkpoint, authority, prerequisites, scope []byte, err error) {
	checkpoint, err = ParseDigest(b.CheckpointDigest)
	if err != nil {
		return
	}
	authority, err = ParseDigest(b.AuthorityDigest)
	if err != nil {
		return
	}
	prerequisites, err = ParseDigest(b.RollbackPrerequisitesDigest)
	if err != nil {
		return
	}
	scope, err = ParseDigest(b.ScopeDigest)
	return
}

func RollbackPrerequisitesDigest(programID string, stateVersion int64, binding RollbackProposalBinding) (string, error) {
	if programID == "" || stateVersion < 1 {
		return "", ErrInvalid
	}
	for _, value := range []string{binding.CheckpointDigest, binding.AuthorityDigest, binding.ScopeDigest, binding.CutoverTransitionDigest, binding.CapabilityAssessmentDigest, binding.SourceValidationDigest, binding.ProviderValidationDigest} {
		if _, err := ParseDigest(value); err != nil {
			return "", ErrInvalid
		}
	}
	if binding.CheckpointID == "" || binding.CutoverTransitionID == "" || binding.CutoverEpoch < 1 || binding.CutoverTransitionedAt.IsZero() || !binding.RollbackDeadline.After(binding.CutoverTransitionedAt) || binding.CredentialID == "" || binding.CredentialStatus == "" || binding.CapabilityAssessmentID == "" || binding.CapabilityAssessedAt.IsZero() || binding.SourceValidationID == "" || binding.SourceValidatedAt.IsZero() || binding.ProviderValidationID == "" || binding.ProviderValidatedAt.IsZero() {
		return "", ErrInvalid
	}
	binding.CutoverTransitionedAt = binding.CutoverTransitionedAt.UTC()
	binding.RollbackDeadline = binding.RollbackDeadline.UTC()
	binding.CapabilityAssessedAt = binding.CapabilityAssessedAt.UTC()
	binding.SourceValidatedAt = binding.SourceValidatedAt.UTC()
	binding.ProviderValidatedAt = binding.ProviderValidatedAt.UTC()
	if binding.CredentialRemovedAt != nil {
		removedAt := binding.CredentialRemovedAt.UTC()
		binding.CredentialRemovedAt = &removedAt
	}
	binding.RollbackPrerequisitesDigest = ""
	return FormatDigest(digest(struct {
		ProgramID    string
		StateVersion int64
		Binding      RollbackProposalBinding
	}{programID, stateVersion, binding})), nil
}

func AuthoritySetDigest(programID, scopeDigest string, authorityDigests []string) (string, error) {
	if programID == "" || len(authorityDigests) == 0 {
		return "", ErrInvalid
	}
	if _, err := ParseDigest(scopeDigest); err != nil {
		return "", ErrInvalid
	}
	values := append([]string(nil), authorityDigests...)
	sort.Strings(values)
	for _, value := range values {
		if _, err := ParseDigest(value); err != nil {
			return "", ErrInvalid
		}
	}
	return FormatDigest(digest(struct {
		ProgramID, ScopeDigest string
		AuthorityDigests       []string
	}{programID, scopeDigest, values})), nil
}

func ServingRequirementsDigest(programID, applicationID, platform, minimumSDKVersion string, requiredCapabilities []string) (string, error) {
	if programID == "" || applicationID == "" || (platform != "ios" && platform != "android") || len(requiredCapabilities) == 0 {
		return "", ErrInvalid
	}
	if ok, err := SemanticVersionInRange(minimumSDKVersion, minimumSDKVersion, minimumSDKVersion); err != nil || !ok {
		return "", ErrInvalid
	}
	allowed := map[string]bool{"authority_epoch": true, "authority_scope": true, "urgent_authority_sync": true, "mosaic_authoritative_targeting": true}
	capabilities := append([]string(nil), requiredCapabilities...)
	sort.Strings(capabilities)
	for index, capability := range capabilities {
		if !allowed[capability] || (index > 0 && capability == capabilities[index-1]) {
			return "", ErrInvalid
		}
	}
	sum := sha256.Sum256([]byte(strings.Join([]string{programID, applicationID, platform, minimumSDKVersion, strings.Join(capabilities, "\x1e")}, "\x1f")))
	return FormatDigest(sum[:]), nil
}

type CutoverProposal struct {
	ProgramID       string                   `json:"programId"`
	StateVersion    int64                    `json:"stateVersion"`
	ProposalID      string                   `json:"proposalId"`
	Command         string                   `json:"command"`
	ProposerActorID string                   `json:"proposerActorId"`
	Reason          string                   `json:"reason"`
	Digests         PreApprovalDigests       `json:"-"`
	RollbackBinding *RollbackProposalBinding `json:"-"`
	ProposalDigest  string                   `json:"proposalDigest"`
	Status          string                   `json:"status"`
	ProposedAt      time.Time                `json:"proposedAt"`
	ExpiresAt       time.Time                `json:"expiresAt"`
}

type ApproveCutoverInput struct {
	ProjectID, ProgramID, ProposalID, IdempotencyKey string
	ExpectedStateVersion                             int64
}

type MigrationApproval struct {
	ProgramID       string    `json:"programId"`
	StateVersion    int64     `json:"stateVersion"`
	ApprovalID      string    `json:"approvalId"`
	Command         string    `json:"command"`
	ProposerActorID string    `json:"proposerActorId"`
	ApproverActorID string    `json:"approverActorId"`
	ApprovalDigest  string    `json:"approvalDigest"`
	ApprovedAt      time.Time `json:"approvedAt"`
	ExpiresAt       time.Time `json:"expiresAt"`
}

type CreateCheckpointInput struct {
	ProjectID, ProgramID, ApprovalID, IdempotencyKey string
	ExpectedStateVersion                             int64
	ExpectedDigests                                  PreApprovalDigests
	ApprovalDigest                                   string
	CohortDigest                                     string
}

type MigrationCheckpoint struct {
	ProgramID         string    `json:"programId"`
	StateVersion      int64     `json:"stateVersion"`
	CheckpointID      string    `json:"checkpointId"`
	Scope             Scope     `json:"scope"`
	AuthorityEpoch    int64     `json:"authorityEpoch"`
	SourceWatermark   time.Time `json:"sourceWatermark"`
	ProviderWatermark time.Time `json:"providerWatermark"`
	ShadowWatermark   time.Time `json:"shadowWatermark"`
	ManifestDigest    string    `json:"manifestDigest"`
	MappingDigest     string    `json:"mappingDigest"`
	PolicyDigest      string    `json:"policyDigest"`
	ReadinessDigest   string    `json:"readinessDigest"`
	CheckpointDigest  string    `json:"checkpointDigest"`
	CohortDigest      string    `json:"cohortDigest"`
	CreatedAt         time.Time `json:"createdAt"`
}

type ProposalWrite struct {
	Proposal                  CutoverProposal
	ProjectID, IdempotencyKey string
	RequestDigest             []byte
	Digests                   ParsedDigests
	ProposalDigest            []byte
	ExpectedRollback          *RollbackExpectedBinding
}
type ApprovalWrite struct {
	Approval                              MigrationApproval
	ProjectID, ProposalID, IdempotencyKey string
	RequestDigest, ApprovalDigest         []byte
}
type CheckpointWrite struct {
	Checkpoint                                     MigrationCheckpoint
	ProjectID, ApprovalID, IdempotencyKey          string
	RequestDigest                                  []byte
	Digests                                        ParsedDigests
	ApprovalDigest, CheckpointDigest, CohortDigest []byte
}

func ValidateCompletionTiming(completedAt, stabilizationEndedAt, rollbackWindowEndedAt, credentialRemovedAt time.Time, legalHold bool, sourceObjectsDeleteAt *time.Time) error {
	if completedAt.IsZero() || stabilizationEndedAt.IsZero() || rollbackWindowEndedAt.IsZero() ||
		completedAt.Before(stabilizationEndedAt) || completedAt.Before(rollbackWindowEndedAt) || credentialRemovedAt.Before(rollbackWindowEndedAt) {
		return ErrInvalid
	}
	if legalHold {
		if sourceObjectsDeleteAt != nil {
			return ErrInvalid
		}
		return nil
	}
	if sourceObjectsDeleteAt == nil || !sourceObjectsDeleteAt.Equal(completedAt.Add(30*24*time.Hour)) {
		return ErrInvalid
	}
	return nil
}
