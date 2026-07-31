package billingrestore

import (
	"context"
	"errors"
	"testing"
	"time"
)

// The two tests in this file cover the two failures that would be invisible
// until production.
//
// The first is the lie the restore_sync_jobs table exists to prevent: reporting
// `restored` before an accepted snapshot reflects the restore. Nothing about it
// is a compile error and nothing about it fails loudly — the caller simply gets
// told they have access Mosaic has not granted.
//
// The second is that outcome and uncertainty_reason are paired by database CHECK
// constraints, so a wrong pairing is an insert failure at runtime rather than a
// build failure. The table below is the pairing table, asserted where it can be
// asserted cheaply.

// fakeRepository records what the service decided to write. It deliberately
// implements no chain logic: the point is to observe the decision, not to
// re-simulate the database.
type fakeRepository struct {
	enabled  bool
	job      Job
	chain    ChainState
	chainErr error

	completed   *Decision
	completedAs ChainState
	rescheduled int
	baseline    *int64
	leased      bool
}

func (f *fakeRepository) BillingEnabled(context.Context, string) (bool, error) {
	return f.enabled, nil
}

func (f *fakeRepository) CreateJob(_ context.Context, job Job, _ []string, _ time.Time) (Job, error) {
	return job, nil
}

func (f *fakeRepository) LeaseJob(context.Context, string, time.Time, time.Time) (Job, bool, error) {
	if f.leased {
		return Job{}, false, nil
	}
	f.leased = true
	return f.job, true, nil
}

func (f *fakeRepository) LoadChain(context.Context, Job) (ChainState, error) {
	return f.chain, f.chainErr
}

func (f *fakeRepository) AdoptBaseline(_ context.Context, _ Job, customerID string, baseline int64, _ time.Time) error {
	f.baseline = &baseline
	f.job.CustomerID = customerID
	return nil
}

func (f *fakeRepository) CompleteJob(_ context.Context, _ Job, decision Decision, chain ChainState, _ time.Time) error {
	if err := decision.Validate(); err != nil {
		return err
	}
	f.completed = &decision
	f.completedAs = chain
	return nil
}

func (f *fakeRepository) RescheduleJob(context.Context, Job, Decision, ChainState, time.Time, time.Time) error {
	f.rescheduled++
	return nil
}

func (f *fakeRepository) Job(context.Context, string, string, string) (Job, error) {
	return f.job, nil
}

func baselineOf(version int64) *int64 { return &version }

func settledChain(customerID string, snapshotVersion int64) ChainState {
	return ChainState{
		CustomerID:        customerID,
		LinkedInputCount:  1,
		FactCount:         1,
		ProjectionSettled: true,
		SnapshotVersion:   snapshotVersion,
	}
}

// TestRestoredRequiresTheSnapshotThatProvesIt is the load-bearing test of this
// package.
//
// Risk covered: reporting restored access that no accepted snapshot has granted.
// Every case below is a chain where the native restore succeeded and the facts
// validated — the exact situation in which a naive implementation answers
// `restored` — and none of them may produce it.
func TestRestoredRequiresTheSnapshotThatProvesIt(t *testing.T) {
	base := Job{
		ID: "rst_1", ProjectID: "prj", EnvironmentID: "env",
		StorePlatform: StoreApple, ProviderOutcome: ProviderOutcomeCompleted,
		ObservedTransactionCount: 2, MaxAttempts: DefaultMaxAttempts, AttemptCount: 1,
		RequestedAt: time.Unix(1700000000, 0).UTC(),
	}

	t.Run("a snapshot that has not moved past the baseline is not a restore", func(t *testing.T) {
		job := base
		job.BaselineSnapshotVersion = baselineOf(5)
		repository := &fakeRepository{enabled: true, job: job, chain: settledChain("cus_1", 5)}
		service := NewService(repository, nil)

		if _, err := service.ProcessNextRestoreSync(context.Background(), "worker"); err != nil {
			t.Fatalf("process restore: %v", err)
		}
		if repository.completed == nil {
			t.Fatal("the restore should have reached a terminal outcome")
		}
		if repository.completed.Outcome == OutcomeRestored {
			t.Fatalf("a snapshot still at the baseline was reported as %q", OutcomeRestored)
		}
		if repository.completed.Outcome != OutcomeNoAdditionalPurchases {
			t.Fatalf("outcome = %q, want %q", repository.completed.Outcome, OutcomeNoAdditionalPurchases)
		}
		if version := repository.completed.SnapshotVersion(); version != 0 {
			t.Fatalf("a non-restored outcome carried snapshot evidence %d", version)
		}
	})

	t.Run("validated facts whose projection has not run are stale, not restored", func(t *testing.T) {
		// This is the case the whole design turns on: the native restore
		// succeeded, the facts are validated and attached to the customer, and
		// the only thing missing is the projection. Access has not been granted
		// yet, so the answer is not restored — and the job is not even terminal.
		job := base
		job.BaselineSnapshotVersion = baselineOf(5)
		chain := settledChain("cus_1", 5)
		chain.ProjectionSettled = false
		repository := &fakeRepository{enabled: true, job: job, chain: chain}
		service := NewService(repository, nil)

		if _, err := service.ProcessNextRestoreSync(context.Background(), "worker"); err != nil {
			t.Fatalf("process restore: %v", err)
		}
		if repository.completed != nil {
			t.Fatalf("an unfinished chain reached a terminal outcome %q",
				repository.completed.Outcome)
		}
		if repository.rescheduled != 1 {
			t.Fatalf("reschedules = %d, want 1", repository.rescheduled)
		}
	})

	t.Run("no baseline means no restore, however far the version has moved", func(t *testing.T) {
		job := base
		job.BaselineSnapshotVersion = nil
		repository := &fakeRepository{enabled: true, job: job, chain: settledChain("cus_1", 99)}
		service := NewService(repository, nil)

		if _, err := service.ProcessNextRestoreSync(context.Background(), "worker"); err != nil {
			t.Fatalf("process restore: %v", err)
		}
		if repository.completed != nil && repository.completed.Outcome == OutcomeRestored {
			t.Fatal("restored was reported against a baseline that was never captured")
		}
		if repository.baseline == nil || *repository.baseline != 99 {
			t.Fatalf("the baseline should have been adopted at the version seen when identity resolved, got %v",
				repository.baseline)
		}
	})

	t.Run("an advanced snapshot is a restore and carries its evidence", func(t *testing.T) {
		job := base
		job.BaselineSnapshotVersion = baselineOf(5)
		repository := &fakeRepository{enabled: true, job: job, chain: settledChain("cus_1", 6)}
		service := NewService(repository, nil)

		if _, err := service.ProcessNextRestoreSync(context.Background(), "worker"); err != nil {
			t.Fatalf("process restore: %v", err)
		}
		if repository.completed == nil || repository.completed.Outcome != OutcomeRestored {
			t.Fatalf("an advanced snapshot should be %q, got %+v", OutcomeRestored, repository.completed)
		}
		if version := repository.completed.SnapshotVersion(); version != 6 {
			t.Fatalf("snapshot evidence = %d, want 6", version)
		}
	})

	t.Run("a restored decision assembled outside Decide carries no evidence", func(t *testing.T) {
		// This is the structural half of the invariant. A future caller that
		// builds the outcome by hand gets a decision that proves nothing and is
		// refused before it reaches a row.
		forged := Decision{Outcome: OutcomeRestored, UncertaintyReason: ReasonNone}
		if version := forged.SnapshotVersion(); version != 0 {
			t.Fatalf("a hand-built restored decision reported evidence %d", version)
		}
		if err := forged.Validate(); err == nil {
			t.Fatal("a restored decision without evidence was accepted")
		}
	})
}

// TestChainStateOutcomeTable pins the chain-state-to-outcome mapping.
//
// Risk covered: the schema pairs `outcome` with `uncertainty_reason` under CHECK
// constraints — a definite outcome may not carry a reason, and an uncertain one
// must. A wrong pairing therefore fails as a database insert error on a live
// restore rather than at build time, and the caller polling that restore gets a
// 500 instead of an answer. The table asserts both the mapping and, through
// Validate, that every pairing it produces is one the schema will accept.
func TestChainStateOutcomeTable(t *testing.T) {
	job := Job{
		ID: "rst_1", ObservedTransactionCount: 1, MaxAttempts: DefaultMaxAttempts,
		BaselineSnapshotVersion: baselineOf(3),
	}

	cases := []struct {
		name     string
		job      Job
		chain    ChainState
		outcome  string
		reason   string
		terminal bool
	}{
		{
			name:     "a dead-lettered projection is a failure Mosaic owns",
			chain:    ChainState{CustomerID: "cus_1", FactCount: 1, ProjectionFailed: true},
			outcome:  OutcomeFailed,
			reason:   ReasonProjectionFailed,
			terminal: true,
		},
		{
			name:     "a disputed identity with no customer resolves to nobody",
			chain:    ChainState{IdentityConflict: true, FactCount: 1},
			outcome:  OutcomeIdentityUnresolved,
			reason:   ReasonConflictingFacts,
			terminal: true,
		},
		{
			name:     "a disputed identity that already named a customer fails rather than granting",
			chain:    ChainState{CustomerID: "cus_1", IdentityConflict: true, FactCount: 1},
			outcome:  OutcomeFailed,
			reason:   ReasonConflictingFacts,
			terminal: true,
		},
		{
			name:     "an unmappable Product is its own outcome, not a failure",
			chain:    ChainState{CustomerID: "cus_1", FactCount: 1, ProductUnresolved: true},
			outcome:  OutcomeProductUnresolved,
			reason:   ReasonProductUnresolved,
			terminal: false,
		},
		{
			name:     "waiting on the store is reported as the store being unavailable",
			chain:    ChainState{LinkedInputCount: 1, PendingValidationCount: 1, ProviderUnavailable: true},
			outcome:  OutcomeProviderUnavailable,
			reason:   ReasonProviderUnavailable,
			terminal: false,
		},
		{
			name:     "waiting on Mosaic is reported as validation pending",
			chain:    ChainState{LinkedInputCount: 1, PendingValidationCount: 1},
			outcome:  OutcomeValidationPending,
			reason:   ReasonMissingFact,
			terminal: false,
		},
		{
			name:     "an input that permanently failed validation fails the restore",
			chain:    ChainState{LinkedInputCount: 1, PermanentFailure: true},
			outcome:  OutcomeFailed,
			reason:   ReasonUnsupportedProviderState,
			terminal: true,
		},
		{
			name:     "no customer once validation settled is an unresolved identity",
			chain:    ChainState{LinkedInputCount: 1, FactCount: 1},
			outcome:  OutcomeIdentityUnresolved,
			reason:   ReasonIdentityUnresolved,
			terminal: false,
		},
		{
			name:     "a native restore that found nothing changed nothing",
			job:      Job{ID: "rst_1", ObservedTransactionCount: 0, MaxAttempts: DefaultMaxAttempts},
			chain:    ChainState{},
			outcome:  OutcomeNoAdditionalPurchases,
			reason:   ReasonNone,
			terminal: true,
		},
		{
			name:     "facts attached but the projection has not caught up is stale, not restored",
			chain:    ChainState{CustomerID: "cus_1", FactCount: 1, SnapshotVersion: 3},
			outcome:  OutcomeValidationPending,
			reason:   ReasonStaleValidation,
			terminal: false,
		},
		{
			name:     "a settled projection that did not move the version restored nothing new",
			chain:    settledChain("cus_1", 3),
			outcome:  OutcomeNoAdditionalPurchases,
			reason:   ReasonNone,
			terminal: true,
		},
		{
			name:     "a settled projection past the baseline is a restore",
			chain:    settledChain("cus_1", 4),
			outcome:  OutcomeRestored,
			reason:   ReasonNone,
			terminal: true,
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			subject := job
			if testCase.job.ID != "" {
				subject = testCase.job
			}
			decision := Decide(subject, testCase.chain)
			if decision.Outcome != testCase.outcome {
				t.Fatalf("outcome = %q, want %q", decision.Outcome, testCase.outcome)
			}
			if decision.UncertaintyReason != testCase.reason {
				t.Fatalf("uncertainty reason = %q, want %q", decision.UncertaintyReason, testCase.reason)
			}
			if decision.Terminal != testCase.terminal {
				t.Fatalf("terminal = %v, want %v", decision.Terminal, testCase.terminal)
			}
			// Every pairing the decision table can produce must be one the
			// schema's CHECK constraints accept.
			if err := decision.Validate(); err != nil {
				t.Fatalf("the decision table produced a pairing the schema would reject: %v", err)
			}
		})
	}
}

// TestChainReadFailureSurfacesToTheWorker is the regression for defect D-2's
// aggravating factor.
//
// A LoadChain error used to be absorbed: the job was rescheduled and the method
// returned (true, nil), which is the shape of healthy work. The stage-3 read
// referenced a column that does not exist, so every restore in the Environment
// was failing permanently while the worker's (processed, error) contract said
// nothing was wrong, `restoreFailedJobs` stayed at zero, and only the backlog
// rose. A failure nothing can observe is a failure nobody is paged for.
//
// Two properties are asserted: the error reaches the caller while attempts
// remain, and an exhausted job becomes terminally `failed` — which is the row
// state `restoreFailedJobs` counts — rather than being rescheduled forever.
func TestChainReadFailureSurfacesToTheWorker(t *testing.T) {
	base := Job{
		ID: "rst_chain", ProjectID: "prj", EnvironmentID: "env",
		StorePlatform: StoreApple, ProviderOutcome: ProviderOutcomeCompleted,
		MaxAttempts: DefaultMaxAttempts, RequestedAt: time.Unix(1700000000, 0).UTC(),
	}
	readFailure := errors.New("read restore identity chain")

	t.Run("a retryable read failure is rescheduled and still reported", func(t *testing.T) {
		repository := &fakeRepository{enabled: true, job: base, chainErr: readFailure}
		repository.job.AttemptCount = 1
		service := NewService(repository, nil)

		processed, err := service.ProcessNextRestoreSync(context.Background(), "worker")
		if !processed {
			t.Fatal("the job was leased, so the worker must be told work was processed")
		}
		if !errors.Is(err, readFailure) {
			t.Fatalf("error = %v, want the chain read failure to reach the worker loop", err)
		}
		if repository.rescheduled != 1 {
			t.Fatalf("rescheduled %d times, want 1", repository.rescheduled)
		}
		if repository.completed != nil {
			t.Fatal("a transient read failure must not write a terminal outcome")
		}
	})

	t.Run("an exhausted read failure becomes a counted failed job", func(t *testing.T) {
		repository := &fakeRepository{enabled: true, job: base, chainErr: readFailure}
		repository.job.AttemptCount = DefaultMaxAttempts
		service := NewService(repository, nil)

		processed, err := service.ProcessNextRestoreSync(context.Background(), "worker")
		if !processed {
			t.Fatal("the job was leased, so the worker must be told work was processed")
		}
		if !errors.Is(err, readFailure) {
			t.Fatalf("error = %v, want the chain read failure to reach the worker loop", err)
		}
		if repository.completed == nil {
			t.Fatal("an exhausted restore that could never be read must reach a terminal outcome")
		}
		if repository.completed.Outcome != OutcomeFailed {
			t.Fatalf("outcome = %q, want %q so restoreFailedJobs counts it",
				repository.completed.Outcome, OutcomeFailed)
		}
		if repository.rescheduled != 0 {
			t.Fatal("an exhausted job was rescheduled instead of failed")
		}
	})
}
