package analytics

import (
	"context"
	"errors"
	"testing"
	"time"
)

type recordingFailureRepository struct {
	Repository
	called        bool
	observedError error
}

func (r *recordingFailureRepository) FailJob(ctx context.Context, _ Job, _ string, _ time.Time) error {
	r.called = true
	r.observedError = ctx.Err()
	return nil
}

// A worker receiving SIGTERM mid-job cancels the run context. If the failure
// record is written on that cancelled context the write is refused, the lease
// silently expires, and the job appears never to have run — the silent job-loss
// class Phase 8 closes. The failure write must therefore be detached from the
// caller's cancellation.
func TestJobFailureIsCommittedOnACancelledRunContext(t *testing.T) {
	repository := &recordingFailureRepository{}
	service := NewService(repository, nil)

	ctx, cancel := context.WithCancel(t.Context())
	cancel()

	err := service.runJob(ctx, Job{ID: "job_1", Kind: "aggregate"}, func() error {
		return errors.New("aggregation failed")
	})

	if err == nil {
		t.Fatal("runJob returned nil, want the job error surfaced to the worker")
	}
	if !repository.called {
		t.Fatal("the job-failure record was never written")
	}
	if repository.observedError != nil {
		t.Fatalf("failure record used a cancelled context: %v", repository.observedError)
	}
}
