// Package billingmigration owns Phase 9C migration evidence and operator
// workflow state. Source records in this package are evidence only; this
// package has no port capable of inserting a billing Transaction Fact.
package billingmigration

import "time"

const (
	ContractVersion   = "1"
	AdapterRevenueCat = "revenuecat"
	AdapterVersion    = "revenuecat-v2-2026-07-29"
	ProviderAPIV2     = "v2"

	CapabilityView            = "view"
	CapabilityManageSource    = "manage-source"
	CapabilityManageMappings  = "manage-mappings"
	CapabilityRunImport       = "run-import"
	CapabilityAssessReadiness = "assess-readiness"

	StateDraft          = "draft"
	StateMapping        = "mapping"
	StateImporting      = "importing"
	StateDryRun         = "dry_run"
	StateShadowing      = "shadowing"
	StateReady          = "ready"
	StateCutoverPending = "cutover_pending"
	StateStabilizing    = "stabilizing"
)

type Actor struct {
	ID string
}

type Authorization struct {
	OrganizationID string
	Role           string
}

type ScopeItem struct {
	ApplicationID string `json:"applicationId"`
	Platform      string `json:"platform"`
}

type Scope struct {
	ProjectID     string      `json:"projectId"`
	EnvironmentID string      `json:"environmentId"`
	Applications  []ScopeItem `json:"applications"`
}

type Source struct {
	Adapter             string `json:"adapter"`
	AdapterVersion      string `json:"adapterVersion"`
	CredentialReference string `json:"credentialReference"`
}

type Program struct {
	ProgramID            string `json:"programId"`
	StateVersion         int64  `json:"stateVersion"`
	State                string `json:"state"`
	Scope                Scope  `json:"scope"`
	Source               Source `json:"source"`
	AuthorityEpochBefore int64  `json:"authorityEpochBefore"`
	StabilizationDays    int    `json:"stabilizationDays"`
	RollbackWindowDays   int    `json:"rollbackWindowDays"`

	ScopeDigest  string    `json:"-"`
	PolicyDigest string    `json:"-"`
	CreatedAt    time.Time `json:"-"`
	UpdatedAt    time.Time `json:"-"`
}

type CapabilityAssessment struct {
	ProgramID          string    `json:"programId"`
	StateVersion       int64     `json:"stateVersion"`
	Adapter            string    `json:"adapter"`
	ProviderAPIVersion string    `json:"providerApiVersion"`
	Capabilities       []string  `json:"capabilities"`
	AssessedAt         time.Time `json:"assessedAt"`
}

type ProgramDetail struct {
	Program                    Program               `json:"program"`
	SourceCapabilityAssessment *CapabilityAssessment `json:"sourceCapabilityAssessment,omitempty"`
	OperatorCapabilities       []string              `json:"operatorCapabilities"`
}

type ContractRecord[T any] struct {
	BillingMigrationOperationsContractVersion string `json:"billingMigrationOperationsContractVersion"`
	RecordType                                string `json:"recordType"`
	Payload                                   T      `json:"payload"`
}

type CreateProgramInput struct {
	ProjectID          string
	EnvironmentID      string
	Applications       []ScopeItem
	ExternalProjectID  string
	Credential         []byte
	IdempotencyKey     string
	StabilizationDays  int
	RollbackWindowDays int
}

type CapabilityResult struct {
	ProviderAPIVersion string
	Capabilities       []string
	AssessedAt         time.Time
}

type SealedCredential struct {
	ID                string
	ProjectID         string
	ExternalProjectID string
	EnvelopeVersion   int
	Algorithm         string
	KeyID             string
	Nonce             []byte
	Ciphertext        []byte
	Fingerprint       []byte
	CreatedByActorID  string
	CreatedAt         time.Time
}

type CreateProgramCommand struct {
	OrganizationID   string
	Program          Program
	Credential       SealedCredential
	AssessmentID     string
	Assessment       CapabilityAssessment
	AssessmentDigest []byte
	RequestDigest    []byte
	ScopeDigest      []byte
	PolicyDigest     []byte
	ActorID          string
	IdempotencyKey   string
	Now              time.Time
}

type StoredIdempotency struct {
	ProgramID     string
	RequestDigest []byte
}
