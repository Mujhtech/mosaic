package billingwebhook

import (
	"context"
	"testing"
	"time"
)

type freshnessAttemptRepository struct {
	Repository
	result AttemptResult
}

func (r *freshnessAttemptRepository) CompleteAttempt(_ context.Context, result AttemptResult) (int, error) {
	r.result = result
	return 0, nil
}

func TestDeliveryServicePersistsVerifiedOutcomeWithoutCallerFreshnessField(t *testing.T) {
	repository := &freshnessAttemptRepository{}
	service := NewService(repository, nil, nil)
	now := time.Date(2026, 7, 30, 11, 0, 0, 0, time.UTC)
	leased := LeasedDelivery{Delivery: Delivery{ID: "delivery", ProjectID: "project", EnvironmentID: "environment", EventID: "event", DestinationID: "destination", AttemptCount: 1, MaxAttempts: 8}}
	result := AttemptResult{Delivery: leased.Delivery, AttemptNumber: 1, Outcome: OutcomeDelivered, Status: DeliverySucceeded, AttemptedAt: now, RespondedAt: &now, CompletedAt: &now, ResetDestinationFailures: true}

	if err := service.record(context.Background(), leased, result, ""); err != nil {
		t.Fatal(err)
	}
	if repository.result.Outcome != OutcomeDelivered || repository.result.Status != DeliverySucceeded || !repository.result.ResetDestinationFailures {
		t.Fatalf("persisted verified outcome=%#v", repository.result)
	}
}
