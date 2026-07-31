package billingmigration

import (
	"context"
	"testing"
	"time"
)

type sourcePullRepositoryFake struct{ command SourcePullCommand }

func (f *sourcePullRepositoryFake) QueueSourcePull(_ context.Context, c SourcePullCommand) (SourcePullJob, bool, error) {
	f.command = c
	return SourcePullJob{ID: "pull", Intent: c.Intent}, false, nil
}
func (*sourcePullRepositoryFake) LeaseSourcePull(context.Context, string, time.Time, time.Time) (SourcePullLease, bool, error) {
	return SourcePullLease{}, false, nil
}
func (*sourcePullRepositoryFake) BindSourcePullRecords(context.Context, SourcePullLease, []SourcePullRecord) ([]NormalizedSourceRecord, error) {
	return nil, nil
}
func (*sourcePullRepositoryFake) SettleSourcePull(context.Context, SourcePullSettlement) error {
	return nil
}

func TestSourcePullServiceRequiresExplicitIntentAndCanonicalizesRequest(t *testing.T) {
	now := time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)
	repository := &sourcePullRepositoryFake{}
	service := NewSourcePullService(repository, func() time.Time { return now })
	base := SourcePullCommand{Actor: Actor{ID: "owner"}, ProjectID: "project", ProgramID: "program", IdempotencyKey: "pull-one", ExpectedStateVersion: 3}
	if _, _, err := service.Queue(context.Background(), base); err != ErrInvalid {
		t.Fatalf("implicit intent err=%v", err)
	}
	base.Intent = SourcePullFinalDelta
	base.StartingCursor = "opaque"
	base.StartingWatermark = "watermark"
	base.StartingWatermarkDigest = make([]byte, 32)
	job, replay, err := service.Queue(context.Background(), base)
	if err != nil || replay || job.Intent != SourcePullFinalDelta {
		t.Fatalf("job=%#v replay=%v err=%v", job, replay, err)
	}
	if len(repository.command.RequestDigest) != 32 || !repository.command.CreatedAt.Equal(now) {
		t.Fatalf("command=%#v", repository.command)
	}
	// An empty source snapshot has no terminal customer ID. Its server-bound
	// successor is still valid: RevenueCat is queried from the beginning and
	// will capture any customers created after that empty snapshot.
	base.IdempotencyKey = "empty-source-final"
	base.StartingCursor = ""
	base.RequestDigest = nil
	if _, _, err = service.Queue(context.Background(), base); err != nil {
		t.Fatalf("empty-source successor err=%v", err)
	}
}
