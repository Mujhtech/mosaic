package billingmigration

import (
	"context"
	"time"
)

const (
	CapabilityResolveCases      = "resolve-cases"
	CapabilityExecuteRepair     = "execute-repair"
	CapabilityDeleteSource      = "delete-source"
	CapabilityRemoveCredential  = "remove-credential"
	CapabilityManageLegalHold   = "manage-legal-hold"
	CapabilityCompleteMigration = "complete-migration"
)

type OperationsRepository interface {
	CreateCase(context.Context, CaseWrite) (MigrationCase, bool, error)
	TransitionCase(context.Context, CaseTransitionWrite) (MigrationCase, error)
	CreateRepairPreview(context.Context, RepairPreviewWrite) (RepairPreview, bool, error)
	PrepareRepair(context.Context, RepairExecutionWrite) (PreparedRepair, error)
	SettleRepair(context.Context, RepairSettlement) (RepairExecution, error)
	RemoveCredential(context.Context, CredentialRemovalWrite) (CredentialRemoval, bool, error)
	ProposeLegalHold(context.Context, LegalHoldProposalWrite) (LegalHoldProposal, bool, error)
	ApproveLegalHold(context.Context, LegalHoldApprovalWrite) (LegalHold, bool, error)
	CompletionPrerequisites(context.Context, string, string, time.Time) (CompletionPrerequisites, error)
	CompleteMigration(context.Context, CompletionWrite) (CompletionReport, bool, error)
	ClaimRetention(context.Context, RetentionClaim) (RetentionLease, error)
	SettleRetentionObject(context.Context, RetentionObjectSettlement) error
	FinishRetention(context.Context, RetentionFinish) error
}

type CaseWrite struct {
	Case             MigrationCase
	ActorID          string
	IdempotencyKey   string
	RequestDigest    []byte
	ExpectedState    int64
	LinkedDivergence string
	LinkedRecord     string
}

type CaseTransitionWrite struct {
	ProjectID, ProgramID, CaseID, ActorID, Status, Reason string
	ExpectedStateVersion                                  int64
	ExpectedCaseDigest, NewCaseDigest                     []byte
	At                                                    time.Time
}

type RepairPreviewWrite struct {
	Preview        RepairPreview
	ActorID        string
	IdempotencyKey string
	RequestDigest  []byte
	CaseDigest     []byte
	PolicyDigest   []byte
	ScopeDigest    []byte
}

type RepairExecutionWrite struct {
	ProjectID, ProgramID, PreviewID, ActorID, IdempotencyKey string
	ExpectedStateVersion                                     int64
	ExpectedPreviewDigest, ExpectedCaseDigest                []byte
	ExpectedPolicyDigest, ExpectedScopeDigest                []byte
	RequestDigest                                            []byte
	At                                                       time.Time
}

type PreparedRepair struct {
	ExecutionID, RepairKind, CaseID string
	ScopeReferences                 []string
	AttemptNumber                   int
	PreviewBeforeDigest             []byte
	State                           string
	SettledExecution                *RepairExecution
}

const (
	RepairPreparationNew       = "new"
	RepairPreparationUnsettled = "unsettled"
	RepairPreparationSettled   = "settled"
)

type RepairSettlement struct {
	ExecutionID, ProgramID, ProjectID, Result, ErrorCode string
	AttemptNumber                                        int
	ActualBeforeDigest, ActualAfterDigest, ResultDigest  []byte
	Invalidations                                        []RepairInvalidation
	At                                                   time.Time
}

type RepairInvalidation struct {
	Kind, ReferenceID string
	Digest            []byte
}

type CredentialRemovalWrite struct {
	Removal         CredentialRemoval
	ExpectedState   int64
	RequestDigest   []byte
	IrreversibleAck bool
	IdempotencyKey  string
}

type LegalHoldProposalWrite struct {
	Proposal                              LegalHoldProposal
	IdempotencyKey                        string
	RequestDigest, ExpectedPreviousDigest []byte
}
type LegalHoldApprovalWrite struct {
	ProjectID, ProgramID, ProposalID, ApproverActorID, IdempotencyKey string
	ExpectedProposalDigest, RequestDigest                             []byte
	At                                                                time.Time
}

type CompletionWrite struct {
	Report               CompletionReport
	ExpectedStateVersion int64
	ExpectedPolicyDigest []byte
	AuthorityDigest      []byte
	StabilityDigest      []byte
	CompletionDigest     []byte
	RequestDigest        []byte
	RetentionJobID       string
	DeletionIdentity     []byte
	ActorID              string
	IdempotencyKey       string
}

type RetentionClaim struct {
	WorkerID string
	Now      time.Time
	LeaseFor time.Duration
}

type RetentionLease struct {
	JobID, ProgramID, ProjectID string
	Generation                  int64
	AttemptNumber, MaxAttempts  int
	ObjectKeys                  []string
	LegalHold                   bool
}

type RetentionObjectSettlement struct {
	JobID, ProgramID, ProjectID, ObjectKey, Result string
	Generation                                     int64
	AttemptNumber                                  int
	ObjectKeyDigest, DeletionDigest                []byte
	At                                             time.Time
}

type RetentionFinish struct {
	JobID, ErrorCode string
	Generation       int64
	RetryAt          time.Time
	At               time.Time
}
