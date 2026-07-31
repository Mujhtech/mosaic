package billingpostgres

import (
	"bytes"
	"context"
	"errors"
	"testing"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/billing"
)

type failOnceLineageBinder struct {
	calls    int
	bindings []billing.FactBinding
}

func (b *failOnceLineageBinder) BindFact(_ context.Context, binding billing.FactBinding) error {
	b.calls++
	b.bindings = append(b.bindings, binding)
	if b.calls == 1 {
		return errors.New("fixture identity store unavailable")
	}
	return nil
}

func bindingOutcome(projectID, environmentID, applicationID, rawInputID, attemptID, factID string,
	factDigest, chainDigest, referenceDigest, correlatorDigest []byte, now time.Time) billing.AttemptOutcome {

	periodStart := now.Add(-24 * time.Hour)
	periodEnd := now.Add(30 * 24 * time.Hour)
	fact := billing.TransactionFact{
		ID: factID, ProjectID: projectID, EnvironmentID: environmentID,
		EnvironmentMode: "production", ApplicationID: applicationID,
		Provider: billing.ProviderAppStore, StoreEnvironment: billing.StoreProduction,
		ProviderTransactionID: "3000000000000051", PurchaseChainDigest: chainDigest,
		TransactionType: billing.TypeAutoRenewableSubscription, FactKind: billing.KindInitialPurchase,
		OccurredAt: periodStart, PeriodStartAt: &periodStart, PeriodEndAt: &periodEnd,
		ProviderProductIdentifier: "fixture.monthly", ResolutionState: billing.StateUnresolved,
		ValidatorVersion: billing.ValidatorVersion, FactVersion: 1,
		SourceRawInputID: rawInputID, ValidationAttemptID: attemptID,
		FactDigest: factDigest, RecordedAt: now,
	}
	return billing.AttemptOutcome{
		Attempt: billing.ValidationAttempt{
			ID: attemptID, ProjectID: projectID, EnvironmentID: environmentID,
			RawInputID: rawInputID, AttemptNumber: 1, ValidatorVersion: billing.ValidatorVersion,
			StartedAt: now, CompletedAt: now, Outcome: billing.OutcomeValidated,
			StoreEnvironment: billing.StoreProduction, CorrelationID: "identity-binding-fixture",
		},
		Fact:             &fact,
		ReferenceDigests: [][]byte{referenceDigest},
		Correlators: []billing.AssociationCorrelator{{
			EvidenceType: "app_account_token", AliasType: "app_account_token", Digest: correlatorDigest,
		}},
	}
}

func persistBindingInput(t *testing.T, ctx context.Context, repository *Repository,
	projectID, environmentID, applicationID, key string, now time.Time) (billing.PersistResult, billing.ValidationJob) {

	t.Helper()
	result, err := repository.PersistRawInput(ctx,
		sampleInput(projectID, environmentID, applicationID, key), true, now)
	if err != nil {
		t.Fatalf("persist raw input: %v", err)
	}
	job, leased, err := repository.LeaseValidationJob(ctx, "validation-fixture", now, now.Add(2*time.Minute))
	if err != nil || !leased {
		t.Fatalf("lease validation job: leased=%v err=%v", leased, err)
	}
	return result, job
}

// This protects the crash/failure window between a committed fact and its
// identity decision. A transient binder failure must retry only the binding;
// the provider-facing validation attempt and append-only fact stay singular.
func TestIdentityBindingRetriesWithoutRepeatingValidationOrFact(t *testing.T) {
	pool, ctx := testPool(t)
	repository := New(pool)
	projectID, environmentID, applicationID := seed(t, ctx, pool, "identity_retry")
	now := time.Now().UTC().Truncate(time.Millisecond)
	input, validationJob := persistBindingInput(t, ctx, repository,
		projectID, environmentID, applicationID, "identity-retry", now)
	outcome := bindingOutcome(projectID, environmentID, applicationID, input.RawInputID,
		"bva_identity_retry", "btf_identity_retry", billing.ContentDigest([]byte("fact")),
		billing.ContentDigest([]byte("chain")), billing.ContentDigest([]byte("reference")),
		billing.ContentDigest([]byte("correlator")), now)
	if err := repository.CompleteAttempt(ctx, validationJob, outcome, now); err != nil {
		t.Fatalf("complete validation attempt: %v", err)
	}

	clock := now
	binder := &failOnceLineageBinder{}
	service := billing.NewService(repository, nil, nil,
		billing.WithClock(func() time.Time { return clock }), billing.WithSeam(binder, nil))
	processed, err := service.ProcessNextIdentityBinding(ctx, "identity-worker")
	if !processed || err == nil {
		t.Fatalf("first binding: processed=%v err=%v, want processed failure", processed, err)
	}
	clock = clock.Add(2 * time.Second)
	processed, err = service.ProcessNextIdentityBinding(ctx, "identity-worker")
	if !processed || err != nil {
		t.Fatalf("retried binding: processed=%v err=%v", processed, err)
	}

	var attempts, facts, bindingAttempts int
	var status string
	if err := pool.QueryRow(ctx, `SELECT
		(SELECT count(*) FROM billing_validation_attempts WHERE project_id=$1),
		(SELECT count(*) FROM billing_transaction_facts WHERE project_id=$1),
		status, attempt_count
		FROM billing_identity_binding_jobs WHERE validation_attempt_id=$2`, projectID, outcome.Attempt.ID).
		Scan(&attempts, &facts, &status, &bindingAttempts); err != nil {
		t.Fatal(err)
	}
	if attempts != 1 || facts != 1 || binder.calls != 2 || status != "completed" || bindingAttempts != 2 {
		t.Fatalf("attempts=%d facts=%d binderCalls=%d job=%s/%d", attempts, facts, binder.calls, status, bindingAttempts)
	}
	bound := binder.bindings[1]
	if len(bound.ReferenceDigests) != 1 ||
		!bytes.Equal(bound.ReferenceDigests[0], outcome.ReferenceDigests[0]) ||
		len(bound.Correlators) != 1 || !bytes.Equal(bound.Correlators[0].Digest, outcome.Correlators[0].Digest) {
		t.Fatalf("digest-only binding payload did not round-trip: %+v", bound)
	}
}

// This protects evidence freshness on revalidation. Fact deduplication must not
// absorb a later attempt's identity work, because that attempt can carry a new
// digest-only correlator or submission reference that resolves ownership.
func TestDeduplicatedRevalidationCreatesNewEvidenceBindingJob(t *testing.T) {
	pool, ctx := testPool(t)
	repository := New(pool)
	projectID, environmentID, applicationID := seed(t, ctx, pool, "identity_dedup")
	now := time.Now().UTC().Truncate(time.Millisecond)
	input, firstJob := persistBindingInput(t, ctx, repository,
		projectID, environmentID, applicationID, "identity-dedup", now)
	factDigest := billing.ContentDigest([]byte("stable-fact"))
	chainDigest := billing.ContentDigest([]byte("stable-chain"))
	first := bindingOutcome(projectID, environmentID, applicationID, input.RawInputID,
		"bva_identity_dedup_1", "btf_identity_dedup_1", factDigest, chainDigest,
		billing.ContentDigest([]byte("reference-1")), billing.ContentDigest([]byte("correlator-1")), now)
	if err := repository.CompleteAttempt(ctx, firstJob, first, now); err != nil {
		t.Fatalf("complete first attempt: %v", err)
	}

	raw, err := repository.RawInput(ctx, projectID, input.RawInputID)
	if err != nil {
		t.Fatal(err)
	}
	secondJob, err := repository.LeaseValidationJobFor(ctx, "revalidation-fixture", raw,
		now.Add(time.Second), now.Add(2*time.Minute))
	if err != nil {
		t.Fatalf("lease revalidation: %v", err)
	}
	second := bindingOutcome(projectID, environmentID, applicationID, input.RawInputID,
		"bva_identity_dedup_2", "btf_identity_dedup_2", factDigest, chainDigest,
		billing.ContentDigest([]byte("reference-2")), billing.ContentDigest([]byte("correlator-2")), now.Add(time.Second))
	second.Attempt.AttemptNumber = 2
	if err := repository.CompleteAttempt(ctx, secondJob, second, now.Add(time.Second)); err != nil {
		t.Fatalf("complete deduplicated attempt: %v", err)
	}

	var facts, attempts, jobs, distinctEvidence int
	if err := pool.QueryRow(ctx, `SELECT
		(SELECT count(*) FROM billing_transaction_facts WHERE project_id=$1),
		(SELECT count(*) FROM billing_validation_attempts WHERE project_id=$1),
		count(*), count(DISTINCT correlators)
		FROM billing_identity_binding_jobs WHERE project_id=$1`, projectID).
		Scan(&facts, &attempts, &jobs, &distinctEvidence); err != nil {
		t.Fatal(err)
	}
	if facts != 1 || attempts != 2 || jobs != 2 || distinctEvidence != 2 {
		t.Fatalf("facts=%d attempts=%d jobs=%d evidenceDocuments=%d", facts, attempts, jobs, distinctEvidence)
	}

	// Reclaim must prefer the expired lease for this lineage even when its
	// queued sibling sorts first. Otherwise the sibling's transition to leased
	// collides with the partial unique leased-lineage index, and neither item of
	// durable work can advance.
	leaseTime := now.Add(2 * time.Second)
	leased, ok, err := repository.LeaseIdentityBindingJob(ctx, "expired-owner",
		leaseTime, leaseTime.Add(time.Second))
	if err != nil || !ok {
		t.Fatalf("lease first identity job: leased=%v err=%v", ok, err)
	}
	if leased.ValidationAttemptID != first.Attempt.ID {
		t.Fatalf("leased attempt %q, want first attempt %q", leased.ValidationAttemptID, first.Attempt.ID)
	}
	if _, err := pool.Exec(ctx,
		`UPDATE billing_identity_binding_jobs SET available_at=$2
		 WHERE project_id=$1 AND validation_attempt_id=$3`,
		projectID, now.Add(-time.Hour), second.Attempt.ID); err != nil {
		t.Fatal(err)
	}
	reclaimed, ok, err := repository.LeaseIdentityBindingJob(ctx, "recovery-owner",
		leaseTime.Add(2*time.Second), leaseTime.Add(time.Minute))
	if err != nil || !ok {
		t.Fatalf("reclaim expired identity job: leased=%v err=%v", ok, err)
	}
	if reclaimed.ID != leased.ID || reclaimed.ValidationAttemptID != first.Attempt.ID {
		t.Fatalf("reclaimed job %q/%q, want expired job %q/%q",
			reclaimed.ID, reclaimed.ValidationAttemptID, leased.ID, first.Attempt.ID)
	}

	// If that reclaimed lease consumed its final attempt and the worker exited,
	// it must relinquish the unique lineage slot as failed. The queued sibling
	// then becomes leaseable in the very same repository call.
	exhaustedAt := leaseTime.Add(3 * time.Second)
	if _, err := pool.Exec(ctx,
		`UPDATE billing_identity_binding_jobs
		 SET attempt_count=max_attempts, lease_expires_at=$2
		 WHERE id=$1`, reclaimed.ID, exhaustedAt.Add(-time.Second)); err != nil {
		t.Fatal(err)
	}
	sibling, ok, err := repository.LeaseIdentityBindingJob(ctx, "sibling-owner",
		exhaustedAt, exhaustedAt.Add(time.Minute))
	if err != nil || !ok {
		t.Fatalf("lease sibling after exhausted expiry: leased=%v err=%v", ok, err)
	}
	if sibling.ValidationAttemptID != second.Attempt.ID {
		t.Fatalf("leased attempt %q, want queued sibling %q", sibling.ValidationAttemptID, second.Attempt.ID)
	}
	var exhaustedStatus string
	var exhaustedOwner *string
	var exhaustedExpiry *time.Time
	if err := pool.QueryRow(ctx,
		`SELECT status, lease_owner, lease_expires_at
		 FROM billing_identity_binding_jobs WHERE id=$1`, reclaimed.ID).
		Scan(&exhaustedStatus, &exhaustedOwner, &exhaustedExpiry); err != nil {
		t.Fatal(err)
	}
	if exhaustedStatus != "failed" || exhaustedOwner != nil || exhaustedExpiry != nil {
		t.Fatalf("exhausted job state=%q owner=%v expiry=%v, want failed with lease cleared",
			exhaustedStatus, exhaustedOwner, exhaustedExpiry)
	}
}
