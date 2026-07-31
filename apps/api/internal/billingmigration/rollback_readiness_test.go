package billingmigration

import (
	"context"
	"testing"
)

type readinessAuth struct{ Repository }

func (readinessAuth) Authorize(context.Context, Actor, string, string) (Authorization, error) {
	return Authorization{}, nil
}

type readinessRepo struct {
	input AssessRollbackReadinessCommand
}

func (r *readinessRepo) AssessRollbackReadiness(_ context.Context, c AssessRollbackReadinessCommand) (RollbackReadinessAssessment, RollbackReadinessCheckpoint, bool, error) {
	r.input = c
	return RollbackReadinessAssessment{}, RollbackReadinessCheckpoint{}, false, nil
}

func TestRollbackReadinessInputContainsOnlyExpectedEvidenceBindings(t *testing.T) {
	repo := &readinessRepo{}
	service := NewRollbackReadinessService(readinessAuth{}, repo)
	input := AssessRollbackReadinessInput{ProjectID: "project", ProgramID: "program", ObservationID: "observation", IdempotencyKey: "key", ExpectedStateVersion: 7, ExpectedAuthorityEpoch: 2, ExpectedObservationDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111"}
	if _, _, _, err := service.Assess(context.Background(), Actor{ID: "owner"}, input); err != nil {
		t.Fatal(err)
	}
	if len(repo.input.ExpectedObservationDigest) != 32 {
		t.Fatal("observation digest was not bound")
	}
}
