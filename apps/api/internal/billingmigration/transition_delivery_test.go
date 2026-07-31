package billingmigration

import (
	"bytes"
	"context"
	"errors"
	"testing"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingwebhook"
)

type transitionRepositoryStub struct {
	outbox    TransitionOutbox
	audience  []TransitionAudienceMember
	committed []billingwebhook.StoredEventV2
	commitErr error
	failure   *TransitionFailure
}

func (r *transitionRepositoryStub) AppendTransition(context.Context, AppendTransition) (TransitionOutbox, bool, error) {
	return TransitionOutbox{}, false, nil
}
func (r *transitionRepositoryStub) LeaseTransition(context.Context, string, time.Time, time.Time) (TransitionOutbox, bool, error) {
	return r.outbox, true, nil
}
func (r *transitionRepositoryStub) TransitionAudience(context.Context, TransitionOutbox) ([]TransitionAudienceMember, error) {
	return r.audience, nil
}
func (r *transitionRepositoryStub) CommitTransition(_ context.Context, _ TransitionOutbox, e []billingwebhook.StoredEventV2, _ time.Time) error {
	r.committed = e
	return r.commitErr
}
func (r *transitionRepositoryStub) FailTransition(_ context.Context, f TransitionFailure) error {
	r.failure = &f
	return nil
}

// The unit boundary protects deterministic rendering and absent-baseline
// semantics. PostgreSQL integration separately protects atomic insert/fanout.
func TestTransitionDeliveryRendersOneStableEventPerCustomerIncludingAbsentBaseline(t *testing.T) {
	now := time.Date(2026, 7, 30, 10, 0, 0, 0, time.UTC)
	out := TransitionOutbox{ID: "outbox-1", ProgramID: "program-1", ProjectID: "project-1", AuthorityScopeID: "scope-1",
		CheckpointID: "checkpoint-1", TransitionID: "transition-1", EventKind: TransitionRollbackCompleted,
		CorrelationID: "transition-1", AuthorityEpoch: 2, AttemptCount: 1, MaxAttempts: 8, LeaseGeneration: 1,
		LeaseOwner: "worker-1", CreatedAt: now}
	cutover := now.Add(-24 * time.Hour)
	previous := int64(8)
	repository := &transitionRepositoryStub{outbox: out, audience: []TransitionAudienceMember{
		{BillingCustomerID: "customer-a", SnapshotVersion: 0, PreviousSnapshotVersion: &previous,
			ProjectID: "project-1", EnvironmentID: "environment-1", ApplicationID: "app-1", Platform: "ios",
			AuthorityKind: "source_rollback", TransitionState: "rolled_back", AuthorityEpoch: 2, CutoverAt: &cutover, OccurredAt: now,
			AuthorityDigest: bytes.Repeat([]byte{1}, 32)},
		{BillingCustomerID: "customer-b", CustomerSnapshotID: "snapshot-b", SnapshotVersion: 4, PreviousSnapshotVersion: &previous,
			SnapshotChecksum: bytes.Repeat([]byte{2}, 32), ProjectID: "project-1", EnvironmentID: "environment-1", ApplicationID: "app-1", Platform: "ios",
			AuthorityKind: "source_rollback", TransitionState: "rolled_back", AuthorityEpoch: 2, CutoverAt: &cutover, OccurredAt: now,
			AuthorityDigest: bytes.Repeat([]byte{1}, 32)}}}
	service := NewTransitionDeliveryService(repository, func() time.Time { return now })
	processed, err := service.ProcessOne(context.Background(), "worker-1")
	if err != nil || !processed || len(repository.committed) != 2 {
		t.Fatalf("processed=%v events=%d err=%v", processed, len(repository.committed), err)
	}
	if repository.committed[0].Event.SnapshotVersion != 0 || repository.committed[0].CustomerSnapshotID != "" {
		t.Fatalf("absent baseline event=%#v", repository.committed[0])
	}
	first, err := renderTransitionEvent(out, repository.audience[0])
	if err != nil {
		t.Fatal(err)
	}
	second, err := renderTransitionEvent(out, repository.audience[0])
	if err != nil {
		t.Fatal(err)
	}
	if first.Event.EventID != second.Event.EventID || !bytes.Equal(first.Body, second.Body) || !bytes.Equal(first.Digest, second.Digest) {
		t.Fatal("crash retry changed event identity or bytes")
	}
}

func TestTransitionCommitFailureLeavesLeaseRetryable(t *testing.T) {
	now := time.Date(2026, 7, 30, 10, 0, 0, 0, time.UTC)
	cutover := now.Add(-time.Hour)
	repository := &transitionRepositoryStub{outbox: TransitionOutbox{ID: "outbox-failure", EventKind: TransitionCutoverCompleted,
		CorrelationID: "transition-1", AuthorityScopeID: "scope-1", LeaseOwner: "worker-1", LeaseGeneration: 3, AttemptCount: 2, CreatedAt: now},
		commitErr: errors.New("forced fanout failure"), audience: []TransitionAudienceMember{{BillingCustomerID: "customer-1", CustomerSnapshotID: "snapshot-1", SnapshotVersion: 1,
			ProjectID: "project-1", EnvironmentID: "environment-1", ApplicationID: "app-1", Platform: "ios", AuthorityKind: "mosaic", TransitionState: "stabilizing",
			AuthorityEpoch: 1, CutoverAt: &cutover, OccurredAt: now, SnapshotChecksum: bytes.Repeat([]byte{1}, 32), AuthorityDigest: bytes.Repeat([]byte{2}, 32)}}}
	processed, err := NewTransitionDeliveryService(repository, func() time.Time { return now }).ProcessOne(context.Background(), "worker-1")
	if !processed || err == nil || repository.failure == nil {
		t.Fatalf("processed=%v failure=%#v err=%v", processed, repository.failure, err)
	}
	if repository.failure.LeaseGeneration != 3 || repository.failure.RetryAt.Sub(now) != 30*time.Second {
		t.Fatalf("retry=%#v", repository.failure)
	}
}

func TestTransitionBackoffIsBounded(t *testing.T) {
	cases := map[int]time.Duration{1: 15 * time.Second, 2: 30 * time.Second, 4: 2 * time.Minute, 20: 10 * time.Minute}
	for attempt, want := range cases {
		if got := transitionBackoff(attempt); got != want {
			t.Fatalf("attempt %d backoff=%v want=%v", attempt, got, want)
		}
	}
}
