package billingmigration

import (
	"context"
	"errors"
	"time"
)

const sourceExecutionLease = 2 * time.Minute

type SourceExecutionProcessor struct {
	repository SourceExecutionRepository
	provider   ProviderEvidenceImporter
	prepared   PreparedSnapshotBuilder
	finalDelta FinalDeltaBuilder
	now        func() time.Time
}

func NewSourceExecutionProcessor(repository SourceExecutionRepository, provider ProviderEvidenceImporter, prepared PreparedSnapshotBuilder, finalDelta FinalDeltaBuilder, now func() time.Time) *SourceExecutionProcessor {
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &SourceExecutionProcessor{repository: repository, provider: provider, prepared: prepared, finalDelta: finalDelta, now: now}
}

func boundedRetry(attempt int, now time.Time) time.Time {
	if attempt < 1 {
		attempt = 1
	}
	if attempt > 8 {
		attempt = 8
	}
	return now.Add(time.Duration(1<<uint(attempt-1)) * time.Second)
}

func (p *SourceExecutionProcessor) ProcessNextImport(ctx context.Context, workerID string) (bool, error) {
	now := p.now()
	lease, ok, err := p.repository.LeaseImport(ctx, workerID, now, now.Add(sourceExecutionLease))
	if err != nil || !ok {
		return ok, err
	}
	failureCode := "provider_revalidation_failed"
	if p.provider == nil {
		err = ErrUnavailable
	} else {
		for _, reference := range lease.References {
			validReferenceKind := (reference.Provider == "app_store" && reference.ReferenceKind == "app_store_transaction_id") ||
				(reference.Provider == "google_play" && reference.ReferenceKind == "google_play_order_id")
			if !validReferenceKind || reference.EnvironmentID == "" || reference.ApplicationID == "" || reference.Reference == "" {
				err = ErrInvalid
				failureCode = "invalid_provider_reference_kind"
				break
			}
			if reference.SourceProductID == "" || reference.TargetProductID == "" || reference.ExpectedStoreProductID == "" || (reference.ExpectedStoreEnvironment != "production" && reference.ExpectedStoreEnvironment != "sandbox") {
				err = ErrInvalid
				failureCode = "invalid_provider_reference_binding"
				break
			}
		}
		var result ProviderEvidenceResult
		if err == nil {
			result, err = p.provider.RevalidateKnownReferences(ctx, lease.ProjectID, lease.ProgramID, lease.References)
		}
		if errors.Is(err, ErrValidationPending) && result.Accepted+result.Validated+result.Quarantined == lease.RecordCount {
			return true, p.repository.DeferImport(ctx, ExecutionSettlement{ExecutionLease: lease, Status: "pending", ValidatedCount: result.Validated, QuarantinedCount: result.Quarantined, ResultDigest: result.EvidenceDigest, RetryAt: boundedRetry(lease.AttemptCount, p.now()), SettledAt: p.now()})
		}
		if err == nil && result.Validated+result.Quarantined == lease.RecordCount && lease.RecordCount == len(lease.References) {
			return true, p.repository.SettleImport(ctx, ExecutionSettlement{ExecutionLease: lease, Status: "completed", ValidatedCount: result.Validated, QuarantinedCount: result.Quarantined, ResultDigest: result.EvidenceDigest, SettledAt: p.now()})
		}
		if err == nil {
			err = ErrInvalid
		}
	}
	settleErr := p.repository.SettleImport(ctx, ExecutionSettlement{ExecutionLease: lease, Status: "failed", ErrorCode: failureCode, ResultDigest: digestExecutionError(failureCode), RetryAt: boundedRetry(lease.AttemptCount, p.now()), SettledAt: p.now()})
	return true, errors.Join(err, settleErr)
}

func (p *SourceExecutionProcessor) ProcessNextFinalDelta(ctx context.Context, workerID string) (bool, error) {
	now := p.now()
	lease, ok, err := p.repository.LeaseFinalDelta(ctx, workerID, now, now.Add(sourceExecutionLease))
	if err != nil || !ok {
		return ok, err
	}
	if p.finalDelta == nil {
		err = ErrUnavailable
	} else {
		var delta *FinalDeltaResult
		var pointers []PreparedPointer
		var resultDigest []byte
		delta, pointers, resultDigest, err = p.finalDelta.BuildFinalDelta(ctx, lease)
		if err == nil {
			return true, p.repository.SettleFinalDelta(ctx, ExecutionSettlement{ExecutionLease: lease, Status: "completed", ResultDigest: resultDigest, FinalDelta: delta, PreparedPointers: pointers, SettledAt: p.now()})
		}
	}
	settleErr := p.repository.SettleFinalDelta(ctx, ExecutionSettlement{ExecutionLease: lease, Status: "failed", ErrorCode: "final_delta_failed", ResultDigest: digestExecutionError("final_delta_failed"), RetryAt: boundedRetry(lease.AttemptCount, p.now()), SettledAt: p.now()})
	return true, errors.Join(err, settleErr)
}

func (p *SourceExecutionProcessor) ProcessNextRun(ctx context.Context, workerID string) (bool, error) {
	now := p.now()
	lease, ok, err := p.repository.LeaseRun(ctx, workerID, now, now.Add(sourceExecutionLease))
	if err != nil || !ok {
		return ok, err
	}
	if p.prepared == nil {
		err = ErrUnavailable
	} else {
		var pointers []PreparedPointer
		var run *RunExecutionResult
		var resultDigest []byte
		run, pointers, resultDigest, err = p.prepared.Evaluate(ctx, lease)
		if err == nil {
			return true, p.repository.SettleRun(ctx, ExecutionSettlement{ExecutionLease: lease, Status: "completed", ResultID: "run_" + lease.JobID, ResultDigest: resultDigest, PreparedPointers: pointers, Run: run, SettledAt: p.now()})
		}
	}
	settleErr := p.repository.SettleRun(ctx, ExecutionSettlement{ExecutionLease: lease, Status: "failed", ErrorCode: "prepared_snapshot_failed", ResultDigest: digestExecutionError("prepared_snapshot_failed"), RetryAt: boundedRetry(lease.AttemptCount, p.now()), SettledAt: p.now()})
	return true, errors.Join(err, settleErr)
}

func digestExecutionError(code string) []byte {
	// This is a stable, non-sensitive outcome digest. It never incorporates an
	// external error string or provider body.
	return digest(struct{ Domain, Code string }{"billing-migration-execution-v1", code})
}
