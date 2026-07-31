package billingmigration

import "time"

// The operational read models deliberately exclude request digests,
// idempotency keys, encrypted credential material, provider references, and
// customer data. They retain the actors and immutable evidence bindings an
// operator needs to audit a migration.
type RepairPreviewRecord struct {
	RepairPreview
	CreatedByActorID string `json:"createdByActorId"`
}

type RepairExecutionRecord struct {
	ExecutionID       string     `json:"executionId"`
	PreviewID         string     `json:"previewId"`
	ProgramID         string     `json:"programId"`
	ExecutionStatus   string     `json:"executionStatus"`
	Result            string     `json:"result,omitempty"`
	ErrorCode         string     `json:"errorCode,omitempty"`
	BeforeDigest      string     `json:"beforeDigest"`
	AfterDigest       string     `json:"afterDigest,omitempty"`
	ResultDigest      string     `json:"resultDigest,omitempty"`
	AttemptNumber     int        `json:"attemptNumber"`
	ExecutedByActorID string     `json:"executedByActorId"`
	ReservedAt        time.Time  `json:"reservedAt"`
	ExecutedAt        *time.Time `json:"executedAt,omitempty"`
}

type RedeliveryRecord struct {
	RedeliveryID         string    `json:"redeliveryId"`
	ProgramID            string    `json:"programId"`
	EventID              string    `json:"eventId"`
	DestinationID        string    `json:"destinationId"`
	DeliveryID           string    `json:"deliveryId"`
	Reason               string    `json:"reason"`
	ActorID              string    `json:"actorId"`
	ExpectedStateVersion int64     `json:"stateVersion"`
	ExpectedEventDigest  string    `json:"expectedEventDigest"`
	CreatedAt            time.Time `json:"createdAt"`
}

type CredentialRemovalRecord struct {
	RemovalID     string    `json:"removalId"`
	ProgramID     string    `json:"programId"`
	CredentialID  string    `json:"credentialId"`
	Reason        string    `json:"reason"`
	ActorID       string    `json:"actorId"`
	RemovalDigest string    `json:"removalDigest"`
	StateVersion  int64     `json:"stateVersion"`
	Early         bool      `json:"early"`
	RemovedAt     time.Time `json:"removedAt"`
}

type LegalHoldProposalRecord struct {
	ProposalID                    string    `json:"proposalId"`
	ProgramID                     string    `json:"programId"`
	Command                       string    `json:"command"`
	Reason                        string    `json:"reason"`
	ExternalComplianceReference   string    `json:"externalComplianceReference"`
	ProposerActorID               string    `json:"proposerActorId"`
	ExpectedPreviousCommandDigest string    `json:"expectedPreviousCommandDigest,omitempty"`
	ProposalDigest                string    `json:"proposalDigest"`
	Status                        string    `json:"status"`
	ProposedAt                    time.Time `json:"proposedAt"`
	ExpiresAt                     time.Time `json:"expiresAt"`
}

type LegalHoldRecord struct {
	HoldID                      string    `json:"holdId"`
	ProposalID                  string    `json:"proposalId"`
	ProgramID                   string    `json:"programId"`
	Command                     string    `json:"command"`
	Reason                      string    `json:"reason"`
	ExternalComplianceReference string    `json:"externalComplianceReference"`
	ProposerActorID             string    `json:"proposerActorId"`
	ApproverActorID             string    `json:"approverActorId"`
	PreviousCommandID           string    `json:"previousCommandId,omitempty"`
	CommandDigest               string    `json:"commandDigest"`
	Production                  bool      `json:"production"`
	CommandedAt                 time.Time `json:"commandedAt"`
}

type CompletionReportRecord struct {
	CompletionReport
	CompletedByActorID string `json:"completedByActorId"`
}

type StabilizationPolicyRecord struct {
	StabilizationPolicy
	FrozenByActorID string `json:"frozenByActorId"`
}

type StabilizationObservationRecord struct {
	StabilizationObservation
}

type RollbackReadinessAssessmentRecord struct {
	RollbackReadinessAssessment
	SourceHealthDigest             string    `json:"sourceHealthDigest"`
	SourceCurrentAccessDigest      string    `json:"sourceCurrentAccessDigest"`
	LatestDeltaDigest              string    `json:"latestDeltaDigest"`
	CustomerImpactDigest           string    `json:"customerImpactDigest"`
	ApplicationCompatibilityDigest string    `json:"applicationCompatibilityDigest"`
	LimitationReportDigest         string    `json:"limitationReportDigest"`
	AuditDigest                    string    `json:"auditDigest"`
	StabilizationHealthy           bool      `json:"stabilizationHealthy"`
	AssessedByActorID              string    `json:"assessedByActorId"`
	SourceCurrentAccessAt          time.Time `json:"sourceCurrentAccessAt"`
}

type RollbackReadinessCheckpointRecord struct {
	RollbackReadinessCheckpoint
	CreatedByActorID string `json:"createdByActorId"`
}
