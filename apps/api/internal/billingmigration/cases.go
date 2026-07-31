package billingmigration

import (
	"context"
	"time"
)

type MigrationCase struct {
	CaseID               string     `json:"caseId"`
	ProgramID            string     `json:"programId"`
	ProjectID            string     `json:"-"`
	Classification       string     `json:"classification"`
	Status               string     `json:"status"`
	Reason               string     `json:"reason"`
	StateVersion         int64      `json:"stateVersion"`
	CaseDigest           string     `json:"caseDigest"`
	LinkedDivergenceID   string     `json:"linkedDivergenceId,omitempty"`
	LinkedSourceRecordID string     `json:"linkedSourceRecordId,omitempty"`
	OpenedAt             time.Time  `json:"openedAt"`
	UpdatedAt            time.Time  `json:"updatedAt"`
	ResolvedAt           *time.Time `json:"resolvedAt,omitempty"`
}

type CreateCaseInput struct {
	ProjectID, ProgramID, IdempotencyKey, Classification, Reason string
	ExpectedStateVersion                                         int64
	LinkedDivergenceID, LinkedSourceRecordID                     string
}

type TransitionCaseInput struct {
	ProjectID, ProgramID, CaseID, Status, Reason, ExpectedCaseDigest string
	ExpectedStateVersion                                             int64
}

func (s *OperationsService) CreateCase(ctx context.Context, actor Actor, input CreateCaseInput) (MigrationCase, bool, error) {
	if input.ProjectID == "" || input.ProgramID == "" || input.IdempotencyKey == "" || len(input.IdempotencyKey) > 128 || input.ExpectedStateVersion < 1 || !validText(input.Reason, 500) || !caseClass(input.Classification) || (input.LinkedDivergenceID == "" && input.LinkedSourceRecordID == "") {
		return MigrationCase{}, false, ErrInvalid
	}
	if _, err := s.auth.Authorize(ctx, actor, input.ProjectID, CapabilityResolveCases); err != nil {
		return MigrationCase{}, false, err
	}
	now := s.now()
	id, err := s.newID("mca")
	if err != nil {
		return MigrationCase{}, false, ErrUnavailable
	}
	c := MigrationCase{CaseID: id, ProgramID: input.ProgramID, ProjectID: input.ProjectID, Classification: input.Classification, Status: "open", Reason: input.Reason, StateVersion: input.ExpectedStateVersion, LinkedDivergenceID: input.LinkedDivergenceID, LinkedSourceRecordID: input.LinkedSourceRecordID, OpenedAt: now, UpdatedAt: now}
	c.CaseDigest = FormatDigest(digest(c))
	return s.repo.CreateCase(ctx, CaseWrite{Case: c, ActorID: actor.ID, IdempotencyKey: input.IdempotencyKey, RequestDigest: digest(input), ExpectedState: input.ExpectedStateVersion, LinkedDivergence: input.LinkedDivergenceID, LinkedRecord: input.LinkedSourceRecordID})
}

func (s *OperationsService) TransitionCase(ctx context.Context, actor Actor, input TransitionCaseInput) (MigrationCase, error) {
	if input.ProjectID == "" || input.ProgramID == "" || input.CaseID == "" || input.ExpectedStateVersion < 1 || !validText(input.Reason, 500) || (input.Status != "in_progress" && input.Status != "resolved" && input.Status != "dismissed") {
		return MigrationCase{}, ErrInvalid
	}
	expected, err := ParseDigest(input.ExpectedCaseDigest)
	if err != nil {
		return MigrationCase{}, ErrInvalid
	}
	if _, err = s.auth.Authorize(ctx, actor, input.ProjectID, CapabilityResolveCases); err != nil {
		return MigrationCase{}, err
	}
	now := s.now()
	next := digest(struct {
		CaseID, Status, Reason, Actor string
		State                         int64
		At                            time.Time
	}{input.CaseID, input.Status, input.Reason, actor.ID, input.ExpectedStateVersion, now})
	return s.repo.TransitionCase(ctx, CaseTransitionWrite{ProjectID: input.ProjectID, ProgramID: input.ProgramID, CaseID: input.CaseID, ActorID: actor.ID, Status: input.Status, Reason: input.Reason, ExpectedStateVersion: input.ExpectedStateVersion, ExpectedCaseDigest: expected, NewCaseDigest: next, At: now})
}

func caseClass(v string) bool {
	return v == "critical" || v == "blocking" || v == "warning" || v == "informational"
}
