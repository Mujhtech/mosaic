package billingmigration

import (
	"context"
	"crypto/sha256"
	"errors"
	"testing"
	"time"
)

func TestRunProcessorPersistsDeterministicMismatchEvidence(t *testing.T) {
	now := time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)
	lease := ExecutionLease{JobID: "job", JobKind: "shadow", ProjectID: "project", ProgramID: "program", Owner: "worker", Generation: 1, ManifestDigest: bytes32(1), MappingDigest: bytes32(2), PolicyDigest: bytes32(3), ExpiresAt: now.Add(time.Minute)}
	var first []byte
	for iteration := 0; iteration < 2; iteration++ {
		repo := &executionRepoFake{lease: lease}
		processor := NewSourceExecutionProcessor(repo, nil, mismatchEvaluator{now: now}, nil, func() time.Time { return now })
		processed, err := processor.ProcessNextRun(context.Background(), "worker")
		if err != nil || !processed {
			t.Fatalf("iteration %d processed=%v err=%v", iteration, processed, err)
		}
		if repo.settlement.Run == nil || len(repo.settlement.Run.Divergences) != 2 {
			t.Fatalf("missing actual mismatch result: %#v", repo.settlement.Run)
		}
		if repo.settlement.Run.Divergences[0].Divergence.Classification != "critical" || repo.settlement.Run.Divergences[1].Divergence.Classification != "blocking" {
			t.Fatalf("classes=%#v", repo.settlement.Run.Divergences)
		}
		if repo.settlement.Run.SourceWatermark == "" || repo.settlement.Run.ProviderWatermark == "" || repo.settlement.Run.ShadowWatermark == "" {
			t.Fatal("empty run watermark")
		}
		if iteration == 0 {
			first = append([]byte(nil), repo.settlement.ResultDigest...)
		} else if string(first) != string(repo.settlement.ResultDigest) {
			t.Fatal("deterministic rerun digest changed")
		}
	}
}

func TestImportProcessorDefersAcceptedValidationWithoutRecordingFailure(t *testing.T) {
	now := time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)
	lease := ExecutionLease{JobID: "import", JobKind: "import", ProjectID: "project", ProgramID: "program", Owner: "worker", Generation: 1, AttemptCount: 1, MaxAttempts: 8, RecordCount: 1, References: []KnownProviderReference{{Provider: "app_store", EnvironmentID: "env", ApplicationID: "app", Reference: "tx", ReferenceKind: "app_store_transaction_id", SourceProductID: "source", TargetProductID: "product", ExpectedStoreProductID: "store", ExpectedStoreEnvironment: "production"}}, ExpiresAt: now.Add(time.Minute)}
	repo := &executionRepoFake{lease: lease, importAvailable: true}
	processor := NewSourceExecutionProcessor(repo, pendingImporter{}, nil, nil, func() time.Time { return now })
	processed, err := processor.ProcessNextImport(context.Background(), "worker")
	if err != nil || !processed {
		t.Fatalf("processed=%v err=%v", processed, err)
	}
	if repo.deferred.Status != "pending" || repo.settlement.Status != "" {
		t.Fatalf("deferred=%+v failed=%+v", repo.deferred, repo.settlement)
	}
}

// Import-batch references are plaintext operational joins. Bearer-grade Play
// purchase tokens and untyped provider references must be rejected before the
// validation adapter can observe them.
func TestImportProcessorRejectsUnsafeReferenceKindsBeforeProviderDispatch(t *testing.T) {
	for _, referenceKind := range []string{"provider_reference", "google_play_purchase_token"} {
		t.Run(referenceKind, func(t *testing.T) {
			now := time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)
			lease := ExecutionLease{JobID: "import", JobKind: "import", ProjectID: "project", ProgramID: "program", Owner: "worker", Generation: 1, AttemptCount: 1, MaxAttempts: 8, RecordCount: 1, References: []KnownProviderReference{{Provider: "google_play", EnvironmentID: "env", ApplicationID: "app", Reference: "must-not-dispatch", ReferenceKind: referenceKind, SourceProductID: "source", TargetProductID: "product", ExpectedStoreProductID: "store", ExpectedStoreEnvironment: "production"}}, ExpiresAt: now.Add(time.Minute)}
			repo := &executionRepoFake{lease: lease, importAvailable: true}
			importer := &recordingImporter{}
			processed, err := NewSourceExecutionProcessor(repo, importer, nil, nil, func() time.Time { return now }).ProcessNextImport(context.Background(), "worker")
			if !processed || !errors.Is(err, ErrInvalid) {
				t.Fatalf("processed=%v err=%v", processed, err)
			}
			if importer.called {
				t.Fatal("unsafe plaintext reference reached provider validation adapter")
			}
			if repo.settlement.Status != "failed" || repo.settlement.ErrorCode != "invalid_provider_reference_kind" {
				t.Fatalf("settlement=%+v", repo.settlement)
			}
		})
	}
}

type pendingImporter struct{}

func (pendingImporter) RevalidateKnownReferences(context.Context, string, string, []KnownProviderReference) (ProviderEvidenceResult, error) {
	return ProviderEvidenceResult{Accepted: 1, EvidenceDigest: bytes32(8)}, ErrValidationPending
}

type recordingImporter struct{ called bool }

func (i *recordingImporter) RevalidateKnownReferences(context.Context, string, string, []KnownProviderReference) (ProviderEvidenceResult, error) {
	i.called = true
	return ProviderEvidenceResult{}, nil
}

type mismatchEvaluator struct{ now time.Time }

func (e mismatchEvaluator) Evaluate(_ context.Context, lease ExecutionLease) (*RunExecutionResult, []PreparedPointer, []byte, error) {
	d := sha256.Sum256([]byte("stable-mismatch"))
	run := &RunExecutionResult{SourceWatermark: "source:1", ProviderWatermark: "provider:1", ShadowWatermark: "shadow:1", Divergences: []DivergenceWrite{{Divergence: Divergence{ProgramID: lease.ProgramID, StateVersion: 1, DivergenceID: "critical", Classification: "critical", Reason: "source_grants_mosaic_denies", ObservedAt: e.now, ClassificationRuleVersion: "v1"}, EvidenceDigest: bytes32(4)}, {Divergence: Divergence{ProgramID: lease.ProgramID, StateVersion: 1, DivergenceID: "blocking", Classification: "blocking", Reason: "provider_validation_missing", ObservedAt: e.now, ClassificationRuleVersion: "v1"}, EvidenceDigest: bytes32(5)}}}
	return run, nil, d[:], nil
}

type executionRepoFake struct {
	lease           ExecutionLease
	settlement      ExecutionSettlement
	deferred        ExecutionSettlement
	importAvailable bool
}

func (r *executionRepoFake) LeaseRun(context.Context, string, time.Time, time.Time) (ExecutionLease, bool, error) {
	return r.lease, true, nil
}
func (r *executionRepoFake) SettleRun(_ context.Context, s ExecutionSettlement) error {
	r.settlement = s
	return nil
}
func (r *executionRepoFake) LeaseImport(context.Context, string, time.Time, time.Time) (ExecutionLease, bool, error) {
	return r.lease, r.importAvailable, nil
}
func (r *executionRepoFake) SettleImport(_ context.Context, s ExecutionSettlement) error {
	r.settlement = s
	return nil
}
func (r *executionRepoFake) DeferImport(_ context.Context, s ExecutionSettlement) error {
	r.deferred = s
	return nil
}
func (*executionRepoFake) LeaseFinalDelta(context.Context, string, time.Time, time.Time) (ExecutionLease, bool, error) {
	return ExecutionLease{}, false, nil
}
func (*executionRepoFake) SettleFinalDelta(context.Context, ExecutionSettlement) error { return nil }
func bytes32(v byte) []byte {
	b := make([]byte, 32)
	for i := range b {
		b[i] = v
	}
	return b
}
