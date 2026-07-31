package billingmigrationvalidation

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/billing"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingmigration"
)

func TestAdapterDistinguishesAcceptedFromAuthoritativelyValidated(t *testing.T) {
	store := &validationFake{outcome: billing.MigrationValidationBinding{ID: "binding", Status: billing.MigrationValidationAccepted}}
	adapter := New(store)
	refs := []billingmigration.KnownProviderReference{{Provider: billing.ProviderAppStore, EnvironmentID: "env", ApplicationID: "app", Reference: "2000001", ReferenceKind: billing.ReferenceAppStoreTransactionID, TargetProductID: "product", ExpectedStoreProductID: "store.product", ExpectedStoreEnvironment: billing.StoreProduction}}

	first, err := adapter.RevalidateKnownReferences(context.Background(), "project", "program", refs)
	if !errors.Is(err, billingmigration.ErrValidationPending) || first.Accepted != 1 || first.Validated != 0 {
		t.Fatalf("accepted result=%+v err=%v", first, err)
	}
	store.outcome.Status = billing.MigrationValidationValidated
	store.outcome.EvidenceDigest = bytesOf(7)
	store.outcome.ProviderWatermark = time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)
	second, err := New(store).RevalidateKnownReferences(context.Background(), "project", "program", refs)
	if err != nil || second.Validated != 1 || second.Accepted != 0 || len(second.EvidenceDigest) != 32 {
		t.Fatalf("validated result=%+v err=%v", second, err)
	}
	if store.created != 1 {
		t.Fatalf("idempotent replay created %d bindings, want 1", store.created)
	}
}

func TestAdapterCrashRetryReadsExistingQuarantine(t *testing.T) {
	store := &validationFake{outcome: billing.MigrationValidationBinding{ID: "binding", Status: billing.MigrationValidationAccepted}}
	ref := billingmigration.KnownProviderReference{Provider: billing.ProviderGooglePlay, EnvironmentID: "env", ApplicationID: "app", Reference: "purchase-token", ReferenceKind: "google_play_purchase_token", TargetProductID: "product", ExpectedStoreProductID: "sub.monthly", ExpectedStoreEnvironment: billing.StoreSandbox}
	_, _ = New(store).RevalidateKnownReferences(context.Background(), "project", "program", []billingmigration.KnownProviderReference{ref})
	// Simulate a worker commit after the importing process exited. A fresh
	// adapter must reuse and read the durable terminal row, not enqueue another.
	store.outcome.Status = billing.MigrationValidationQuarantined
	store.outcome.EvidenceDigest = bytesOf(9)
	store.outcome.ProviderWatermark = time.Now().UTC()
	result, err := New(store).RevalidateKnownReferences(context.Background(), "project", "program", []billingmigration.KnownProviderReference{ref})
	if err != nil || result.Quarantined != 1 || result.Validated != 0 {
		t.Fatalf("retry result=%+v err=%v", result, err)
	}
	if store.created != 1 {
		t.Fatalf("crash retry created %d bindings, want 1", store.created)
	}
}

type validationFake struct {
	created  int
	accepted bool
	outcome  billing.MigrationValidationBinding
}

func (f *validationFake) AcceptMigrationValidation(_ context.Context, _ billing.MigrationValidationRequest) (billing.MigrationValidationAcceptance, error) {
	if !f.accepted {
		f.accepted = true
		f.created++
	}
	return billing.MigrationValidationAcceptance{BindingID: f.outcome.ID, RawInputID: "raw", Status: f.outcome.Status}, nil
}
func (f *validationFake) MigrationValidationOutcome(context.Context, string, string, string) (billing.MigrationValidationBinding, error) {
	return f.outcome, nil
}
func bytesOf(v byte) []byte {
	b := make([]byte, 32)
	for i := range b {
		b[i] = v
	}
	return b
}
