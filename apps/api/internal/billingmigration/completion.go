package billingmigration

import (
	"context"
	"time"
)

type CredentialRemoval struct {
	RemovalID     string    `json:"removalId"`
	ProgramID     string    `json:"programId"`
	ProjectID     string    `json:"-"`
	CredentialID  string    `json:"credentialId"`
	Reason        string    `json:"reason"`
	ActorID       string    `json:"actorId"`
	RemovalDigest string    `json:"removalDigest"`
	Early         bool      `json:"early"`
	RemovedAt     time.Time `json:"removedAt"`
}
type RemoveCredentialInput struct {
	ProjectID, ProgramID, IdempotencyKey, Reason string
	ExpectedStateVersion                         int64
	IrreversibleAcknowledged                     bool
}

func (s *OperationsService) RemoveMigrationCredential(ctx context.Context, actor Actor, input RemoveCredentialInput) (CredentialRemoval, bool, error) {
	if input.ProjectID == "" || input.ProgramID == "" || input.IdempotencyKey == "" || input.ExpectedStateVersion < 1 || !input.IrreversibleAcknowledged || !validText(input.Reason, 500) {
		return CredentialRemoval{}, false, ErrInvalid
	}
	if _, err := s.auth.Authorize(ctx, actor, input.ProjectID, CapabilityRemoveCredential); err != nil {
		return CredentialRemoval{}, false, err
	}
	id, err := s.newID("mcr")
	if err != nil {
		return CredentialRemoval{}, false, ErrUnavailable
	}
	at := s.now()
	removal := CredentialRemoval{RemovalID: id, ProgramID: input.ProgramID, ProjectID: input.ProjectID, Reason: input.Reason, ActorID: actor.ID, RemovedAt: at}
	removal.RemovalDigest = FormatDigest(digest(struct {
		Input     RemoveCredentialInput
		Actor, ID string
		At        time.Time
	}{input, actor.ID, id, at}))
	return s.repo.RemoveCredential(ctx, CredentialRemovalWrite{Removal: removal, ExpectedState: input.ExpectedStateVersion, RequestDigest: digest(input), IrreversibleAck: true, IdempotencyKey: input.IdempotencyKey})
}

type LegalHold struct {
	HoldID                      string    `json:"holdId"`
	ProposalID                  string    `json:"proposalId"`
	ProgramID                   string    `json:"programId"`
	ProjectID                   string    `json:"-"`
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
type LegalHoldProposal struct {
	ProposalID                    string    `json:"proposalId"`
	ProgramID                     string    `json:"programId"`
	ProjectID                     string    `json:"-"`
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
type ProposeLegalHoldInput struct {
	ProjectID, ProgramID, IdempotencyKey, Command, Reason, ExternalComplianceReference, ExpectedPreviousCommandDigest string
	ExpiresAt                                                                                                         time.Time
}
type ApproveLegalHoldInput struct{ ProjectID, ProgramID, ProposalID, IdempotencyKey, ExpectedProposalDigest string }

func (s *OperationsService) ProposeLegalHold(ctx context.Context, actor Actor, input ProposeLegalHoldInput) (LegalHoldProposal, bool, error) {
	if input.ProjectID == "" || input.ProgramID == "" || input.IdempotencyKey == "" || (input.Command != "set" && input.Command != "release") || !validText(input.Reason, 500) || !validText(input.ExternalComplianceReference, 256) {
		return LegalHoldProposal{}, false, ErrInvalid
	}
	if _, err := s.auth.Authorize(ctx, actor, input.ProjectID, CapabilityManageLegalHold); err != nil {
		return LegalHoldProposal{}, false, err
	}
	var expectedPrevious []byte
	if input.ExpectedPreviousCommandDigest != "" {
		var err error
		expectedPrevious, err = ParseDigest(input.ExpectedPreviousCommandDigest)
		if err != nil {
			return LegalHoldProposal{}, false, ErrInvalid
		}
	}
	now := s.now()
	if !input.ExpiresAt.After(now) || input.ExpiresAt.After(now.Add(24*time.Hour)) {
		return LegalHoldProposal{}, false, ErrInvalid
	}
	id, err := s.newID("mlp")
	if err != nil {
		return LegalHoldProposal{}, false, ErrUnavailable
	}
	p := LegalHoldProposal{ProposalID: id, ProgramID: input.ProgramID, ProjectID: input.ProjectID, Command: input.Command, Reason: input.Reason, ExternalComplianceReference: input.ExternalComplianceReference, ProposerActorID: actor.ID, ExpectedPreviousCommandDigest: input.ExpectedPreviousCommandDigest, Status: "pending", ProposedAt: now, ExpiresAt: input.ExpiresAt.UTC()}
	p.ProposalDigest = FormatDigest(digest(p))
	return s.repo.ProposeLegalHold(ctx, LegalHoldProposalWrite{Proposal: p, IdempotencyKey: input.IdempotencyKey, RequestDigest: digest(input), ExpectedPreviousDigest: expectedPrevious})
}
func (s *OperationsService) ApproveLegalHold(ctx context.Context, actor Actor, input ApproveLegalHoldInput) (LegalHold, bool, error) {
	if input.ProjectID == "" || input.ProgramID == "" || input.ProposalID == "" || input.IdempotencyKey == "" {
		return LegalHold{}, false, ErrInvalid
	}
	expected, err := ParseDigest(input.ExpectedProposalDigest)
	if err != nil {
		return LegalHold{}, false, ErrInvalid
	}
	if _, err = s.auth.Authorize(ctx, actor, input.ProjectID, CapabilityManageLegalHold); err != nil {
		return LegalHold{}, false, err
	}
	return s.repo.ApproveLegalHold(ctx, LegalHoldApprovalWrite{ProjectID: input.ProjectID, ProgramID: input.ProgramID, ProposalID: input.ProposalID, ApproverActorID: actor.ID, IdempotencyKey: input.IdempotencyKey, ExpectedProposalDigest: expected, RequestDigest: digest(input), At: s.now()})
}

type CompletionReport struct {
	ReportID                string     `json:"reportId"`
	ProgramID               string     `json:"programId"`
	ProjectID               string     `json:"-"`
	CompletionDigest        string     `json:"completionDigest"`
	AuthorityDigest         string     `json:"authorityDigest"`
	StabilityEvidenceDigest string     `json:"stabilityEvidenceDigest"`
	PolicyDigest            string     `json:"policyDigest"`
	StateVersion            int64      `json:"stateVersion"`
	CompletedAt             time.Time  `json:"completedAt"`
	StabilizationEndedAt    time.Time  `json:"stabilizationEndedAt"`
	RollbackWindowEndedAt   time.Time  `json:"rollbackWindowEndedAt"`
	CredentialRemovedAt     time.Time  `json:"credentialRemovedAt"`
	LegalHold               bool       `json:"legalHold"`
	SourceObjectsDeleteAt   *time.Time `json:"sourceObjectsDeleteAt,omitempty"`
}
type CompletionPrerequisites struct {
	ProgramID                  string    `json:"programId"`
	ProjectID                  string    `json:"-"`
	State                      string    `json:"state"`
	PolicyDigest               string    `json:"policyDigest"`
	AuthorityDigest            string    `json:"authorityDigest"`
	StabilityEvidenceDigest    string    `json:"stabilityEvidenceDigest"`
	StateVersion               int64     `json:"stateVersion"`
	StabilizationEndsAt        time.Time `json:"stabilizationEndsAt"`
	RollbackWindowEndsAt       time.Time `json:"rollbackWindowEndsAt"`
	CredentialRemoved          bool      `json:"credentialRemoved"`
	UnresolvedCriticalBlocking int64     `json:"unresolvedCriticalBlocking"`
	AuthorityStable            bool      `json:"authorityStable"`
	WebhookReady               bool      `json:"webhookReady"`
	Eligible                   bool      `json:"eligible"`
}

func SyncObservationFresh(observedAt, completedAt time.Time, maxAgeSeconds int) bool {
	return maxAgeSeconds > 0 && !observedAt.After(completedAt) && !observedAt.Before(completedAt.Add(-time.Duration(maxAgeSeconds)*time.Second))
}

func (s *OperationsService) InspectCompletion(ctx context.Context, actor Actor, projectID, programID string) (CompletionPrerequisites, error) {
	if projectID == "" || programID == "" {
		return CompletionPrerequisites{}, ErrInvalid
	}
	if _, err := s.auth.Authorize(ctx, actor, projectID, CapabilityCompleteMigration); err != nil {
		return CompletionPrerequisites{}, err
	}
	return s.repo.CompletionPrerequisites(ctx, projectID, programID, s.now())
}

type CompleteMigrationInput struct {
	ProjectID, ProgramID, IdempotencyKey                                           string
	ExpectedStateVersion                                                           int64
	ExpectedPolicyDigest, ExpectedAuthorityDigest, ExpectedStabilityEvidenceDigest string
}

func (s *OperationsService) CompleteMigration(ctx context.Context, actor Actor, input CompleteMigrationInput) (CompletionReport, bool, error) {
	if input.ProjectID == "" || input.ProgramID == "" || input.IdempotencyKey == "" || input.ExpectedStateVersion < 1 {
		return CompletionReport{}, false, ErrInvalid
	}
	policy, err := ParseDigest(input.ExpectedPolicyDigest)
	if err != nil {
		return CompletionReport{}, false, ErrInvalid
	}
	authority, err := ParseDigest(input.ExpectedAuthorityDigest)
	if err != nil {
		return CompletionReport{}, false, ErrInvalid
	}
	stability, err := ParseDigest(input.ExpectedStabilityEvidenceDigest)
	if err != nil {
		return CompletionReport{}, false, ErrInvalid
	}
	if _, err = s.auth.Authorize(ctx, actor, input.ProjectID, CapabilityCompleteMigration); err != nil {
		return CompletionReport{}, false, err
	}
	reportID, err := s.newID("mco")
	if err != nil {
		return CompletionReport{}, false, ErrUnavailable
	}
	jobID, err := s.newID("mrt")
	if err != nil {
		return CompletionReport{}, false, ErrUnavailable
	}
	at := s.now()
	report := CompletionReport{ReportID: reportID, ProgramID: input.ProgramID, ProjectID: input.ProjectID, StateVersion: input.ExpectedStateVersion + 1, CompletedAt: at, AuthorityDigest: input.ExpectedAuthorityDigest, StabilityEvidenceDigest: input.ExpectedStabilityEvidenceDigest, PolicyDigest: input.ExpectedPolicyDigest}
	completion := digest(struct {
		Input     CompleteMigrationInput
		Actor, ID string
		At        time.Time
	}{input, actor.ID, reportID, at})
	report.CompletionDigest = FormatDigest(completion)
	return s.repo.CompleteMigration(ctx, CompletionWrite{Report: report, ExpectedStateVersion: input.ExpectedStateVersion, ExpectedPolicyDigest: policy, AuthorityDigest: authority, StabilityDigest: stability, CompletionDigest: completion, RequestDigest: digest(input), RetentionJobID: jobID, DeletionIdentity: digest(struct{ Program, Report string }{input.ProgramID, reportID}), ActorID: actor.ID, IdempotencyKey: input.IdempotencyKey})
}

type RawSourceObjectDeleter interface {
	DeleteRawSourceObject(context.Context, string) (string, error)
}

func (s *OperationsService) RunRetention(ctx context.Context, workerID string, leaseFor time.Duration, deleter RawSourceObjectDeleter) error {
	if workerID == "" || leaseFor < time.Second || leaseFor > 15*time.Minute || deleter == nil {
		return ErrInvalid
	}
	lease, err := s.repo.ClaimRetention(ctx, RetentionClaim{WorkerID: workerID, Now: s.now(), LeaseFor: leaseFor})
	if err != nil {
		return err
	}
	if lease.LegalHold {
		for _, key := range lease.ObjectKeys {
			keyDigest := digest(key)
			if err = s.repo.SettleRetentionObject(ctx, RetentionObjectSettlement{JobID: lease.JobID, ProgramID: lease.ProgramID, ProjectID: lease.ProjectID, ObjectKey: key, Result: "legal_hold", Generation: lease.Generation, AttemptNumber: lease.AttemptNumber, ObjectKeyDigest: keyDigest, DeletionDigest: digest(struct {
				Job, Result string
				Key         []byte
				Attempt     int
			}{lease.JobID, "legal_hold", keyDigest, lease.AttemptNumber}), At: s.now()}); err != nil {
				return err
			}
		}
		return s.repo.FinishRetention(ctx, RetentionFinish{JobID: lease.JobID, Generation: lease.Generation, ErrorCode: "legal_hold", At: s.now()})
	}
	for _, key := range lease.ObjectKeys {
		result, deleteErr := deleter.DeleteRawSourceObject(ctx, key)
		if deleteErr != nil {
			result = "retryable_failure"
		}
		if result != "deleted" && result != "not_found" && result != "retryable_failure" {
			return ErrInvalid
		}
		keyDigest := digest(key)
		settle := RetentionObjectSettlement{JobID: lease.JobID, ProgramID: lease.ProgramID, ProjectID: lease.ProjectID, ObjectKey: key, Result: result, Generation: lease.Generation, AttemptNumber: lease.AttemptNumber, ObjectKeyDigest: keyDigest, DeletionDigest: digest(struct {
			Job, Result string
			Key         []byte
			Attempt     int
		}{lease.JobID, result, keyDigest, lease.AttemptNumber}), At: s.now()}
		if err = s.repo.SettleRetentionObject(ctx, settle); err != nil {
			return err
		}
		if deleteErr != nil || result == "retryable_failure" {
			return s.repo.FinishRetention(ctx, RetentionFinish{JobID: lease.JobID, Generation: lease.Generation, ErrorCode: "object_delete_retryable", RetryAt: s.now().Add(time.Hour), At: s.now()})
		}
	}
	return s.repo.FinishRetention(ctx, RetentionFinish{JobID: lease.JobID, Generation: lease.Generation, At: s.now()})
}
