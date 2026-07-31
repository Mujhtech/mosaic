package billingmigration

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"sort"
	"time"
)

type CutoverCommandDigests struct {
	Scope, Manifest, Mapping, Policy, Evidence, Readiness, FinalWatermark, ApplicationVersion, Approval string
}

func (d CutoverCommandDigests) Parse() (ParsedCutoverCommandDigests, error) {
	values := []string{d.Scope, d.Manifest, d.Mapping, d.Policy, d.Evidence, d.Readiness, d.FinalWatermark, d.ApplicationVersion, d.Approval}
	parsed := ParsedCutoverCommandDigests{}
	targets := []*[]byte{&parsed.Scope, &parsed.Manifest, &parsed.Mapping, &parsed.Policy, &parsed.Evidence, &parsed.Readiness, &parsed.FinalWatermark, &parsed.ApplicationVersion, &parsed.Approval}
	for index, value := range values {
		raw, err := ParseDigest(value)
		if err != nil {
			return parsed, ErrInvalid
		}
		*targets[index] = raw
	}
	return parsed, nil
}

type ParsedCutoverCommandDigests struct{ Scope, Manifest, Mapping, Policy, Evidence, Readiness, FinalWatermark, ApplicationVersion, Approval []byte }

type RollbackCommandDigests struct{ Checkpoint, Authority, RollbackPrerequisites, Approval string }
type ParsedRollbackCommandDigests struct{ Checkpoint, Authority, RollbackPrerequisites, Approval []byte }

func (d RollbackCommandDigests) Parse() (ParsedRollbackCommandDigests, error) {
	values := []string{d.Checkpoint, d.Authority, d.RollbackPrerequisites, d.Approval}
	parsed := ParsedRollbackCommandDigests{}
	targets := []*[]byte{&parsed.Checkpoint, &parsed.Authority, &parsed.RollbackPrerequisites, &parsed.Approval}
	for index, value := range values {
		raw, err := ParseDigest(value)
		if err != nil {
			return parsed, ErrInvalid
		}
		*targets[index] = raw
	}
	return parsed, nil
}

type ExecuteCutoverInput struct {
	ProjectID              string
	ProgramID              string
	IdempotencyKey         string
	ExpectedStateVersion   int64
	ExpectedDigests        CutoverCommandDigests
	Reason                 string
	Scope                  Scope
	CheckpointID           string
	ApprovalID             string
	ExpectedAuthorityEpoch int64
}

type ExecuteRollbackInput struct {
	ProjectID              string
	ProgramID              string
	IdempotencyKey         string
	ExpectedStateVersion   int64
	ExpectedDigests        RollbackCommandDigests
	Reason                 string
	Scope                  Scope
	CheckpointID           string
	ApprovalID             string
	ExpectedAuthorityEpoch int64
}

type AuthorityExecution struct {
	ProgramID      string    `json:"programId"`
	ExecutionID    string    `json:"executionId"`
	Command        string    `json:"command"`
	State          string    `json:"state"`
	StateVersion   int64     `json:"stateVersion"`
	AuthorityEpoch int64     `json:"authorityEpoch"`
	TransitionIDs  []string  `json:"transitionIds"`
	ExecutedAt     time.Time `json:"executedAt"`
}

type ExecuteCutoverWrite struct {
	Input         ExecuteCutoverInput
	ActorID       string
	Digests       ParsedCutoverCommandDigests
	RequestDigest []byte
	ExecutionID   string
	ExecutedAt    time.Time
}
type ExecuteRollbackWrite struct {
	Input         ExecuteRollbackInput
	ActorID       string
	Digests       ParsedRollbackCommandDigests
	RequestDigest []byte
	ExecutionID   string
	ExecutedAt    time.Time
}

func canonicalScope(scope Scope) (Scope, error) {
	if scope.ProjectID == "" || scope.EnvironmentID == "" || len(scope.Applications) == 0 {
		return Scope{}, ErrInvalid
	}
	result := scope
	result.Applications = append([]ScopeItem(nil), scope.Applications...)
	sort.Slice(result.Applications, func(i, j int) bool {
		if result.Applications[i].ApplicationID == result.Applications[j].ApplicationID {
			return result.Applications[i].Platform < result.Applications[j].Platform
		}
		return result.Applications[i].ApplicationID < result.Applications[j].ApplicationID
	})
	for index, item := range result.Applications {
		if item.ApplicationID == "" || (item.Platform != "ios" && item.Platform != "android") || (index > 0 && item == result.Applications[index-1]) {
			return Scope{}, ErrInvalid
		}
	}
	return result, nil
}

func deterministicExecutionID(command, programID string, requestDigest []byte) string {
	sum := sha256.Sum256(append(append([]byte(command+"\x1f"+programID+"\x1f"), requestDigest...), 0))
	return "mex_" + hex.EncodeToString(sum[:12])
}

func DeterministicTransitionID(executionID, authorityScopeID string) string {
	sum := sha256.Sum256([]byte(executionID + "\x1f" + authorityScopeID))
	return "mat_" + hex.EncodeToString(sum[:12])
}

func CanonicalAuthorityDigest(projectID, environmentID, applicationID, platform, authority string, epoch int64, programID string) []byte {
	return digest(struct {
		ProjectID, EnvironmentID, ApplicationID, Platform, Authority string
		Epoch                                                        int64
		ProgramID                                                    string
	}{projectID, environmentID, applicationID, platform, authority, epoch, programID})
}

func CanonicalTransitionDigest(programID, scopeID, from, to string, fromEpoch, toEpoch int64, kind string, at time.Time) []byte {
	return digest(struct {
		ProgramID, ScopeID, From, To string
		FromEpoch, ToEpoch           int64
		Kind                         string
		At                           time.Time
	}{programID, scopeID, from, to, fromEpoch, toEpoch, kind, at.UTC()})
}

func (s *Service) ExecuteCutover(ctx context.Context, actor Actor, input ExecuteCutoverInput) (AuthorityExecution, bool, error) {
	if s.cutover == nil || input.ProjectID == "" || input.ProgramID == "" || input.CheckpointID == "" || input.ApprovalID == "" || input.ExpectedStateVersion < 1 || input.ExpectedAuthorityEpoch < 0 || input.IdempotencyKey == "" || len(input.IdempotencyKey) > 128 || !validText(input.Reason, 500) {
		return AuthorityExecution{}, false, ErrInvalid
	}
	scope, err := canonicalScope(input.Scope)
	if err != nil || scope.ProjectID != input.ProjectID {
		return AuthorityExecution{}, false, ErrInvalid
	}
	input.Scope = scope
	digests, err := input.ExpectedDigests.Parse()
	if err != nil {
		return AuthorityExecution{}, false, err
	}
	if _, err = s.repository.Authorize(ctx, actor, input.ProjectID, CapabilityExecuteCutover); err != nil {
		return AuthorityExecution{}, false, err
	}
	payload := struct {
		ProgramID, IdempotencyKey string
		ExpectedStateVersion      int64
		ExpectedDigests           CutoverCommandDigests
		Reason, Command           string
		Scope                     Scope
		CheckpointID, ApprovalID  string
		ExpectedAuthorityEpoch    int64
	}{input.ProgramID, input.IdempotencyKey, input.ExpectedStateVersion, input.ExpectedDigests, input.Reason, "cutover", input.Scope, input.CheckpointID, input.ApprovalID, input.ExpectedAuthorityEpoch}
	requestDigest := digest(payload)
	at := s.now()
	executionID := deterministicExecutionID("cutover", input.ProgramID, requestDigest)
	return s.cutover.ExecuteCutover(ctx, ExecuteCutoverWrite{Input: input, ActorID: actor.ID, Digests: digests, RequestDigest: requestDigest, ExecutionID: executionID, ExecutedAt: at})
}

func (s *Service) ExecuteRollback(ctx context.Context, actor Actor, input ExecuteRollbackInput) (AuthorityExecution, bool, error) {
	if s.cutover == nil || input.ProjectID == "" || input.ProgramID == "" || input.CheckpointID == "" || input.ApprovalID == "" || input.ExpectedStateVersion < 1 || input.ExpectedAuthorityEpoch < 1 || input.IdempotencyKey == "" || len(input.IdempotencyKey) > 128 || !validText(input.Reason, 500) {
		return AuthorityExecution{}, false, ErrInvalid
	}
	scope, err := canonicalScope(input.Scope)
	if err != nil || scope.ProjectID != input.ProjectID {
		return AuthorityExecution{}, false, ErrInvalid
	}
	input.Scope = scope
	digests, err := input.ExpectedDigests.Parse()
	if err != nil {
		return AuthorityExecution{}, false, err
	}
	if _, err = s.repository.Authorize(ctx, actor, input.ProjectID, CapabilityExecuteRollback); err != nil {
		return AuthorityExecution{}, false, err
	}
	payload := struct {
		ProgramID, IdempotencyKey string
		ExpectedStateVersion      int64
		ExpectedDigests           RollbackCommandDigests
		Reason, Command           string
		Scope                     Scope
		CheckpointID, ApprovalID  string
		ExpectedAuthorityEpoch    int64
	}{input.ProgramID, input.IdempotencyKey, input.ExpectedStateVersion, input.ExpectedDigests, input.Reason, "rollback", input.Scope, input.CheckpointID, input.ApprovalID, input.ExpectedAuthorityEpoch}
	requestDigest := digest(payload)
	at := s.now()
	executionID := deterministicExecutionID("rollback", input.ProgramID, requestDigest)
	return s.cutover.ExecuteRollback(ctx, ExecuteRollbackWrite{Input: input, ActorID: actor.ID, Digests: digests, RequestDigest: requestDigest, ExecutionID: executionID, ExecutedAt: at})
}
