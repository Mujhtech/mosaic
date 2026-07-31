package billing

import (
	"context"
	"encoding/json"
	"strings"
	"time"
)

const (
	SourceMigrationKnownReference  = "migration_known_reference"
	MigrationValidationAccepted    = "accepted"
	MigrationValidationValidated   = "validated"
	MigrationValidationQuarantined = "quarantined"

	DiagnosticMigrationApplicationMismatch      = "migration_expected_application_mismatch"
	DiagnosticMigrationProviderProductMismatch  = "migration_expected_provider_product_mismatch"
	DiagnosticMigrationMosaicProductMismatch    = "migration_expected_mosaic_product_mismatch"
	DiagnosticMigrationMosaicProductUnresolved  = "migration_expected_mosaic_product_unresolved"
	DiagnosticMigrationStoreEnvironmentMismatch = "migration_expected_store_environment_mismatch"
)

// AcceptMigrationValidation durably creates or reuses the ordinary Phase 9A
// Raw Input and validation job for a known provider reference. Acceptance does
// not imply validation; callers must read the authoritative terminal outcome.
func (s *Service) AcceptMigrationValidation(ctx context.Context, request MigrationValidationRequest) (MigrationValidationAcceptance, error) {
	request.Reference = strings.TrimSpace(request.Reference)
	request.ExpectedStoreProductIdentifier = strings.TrimSpace(request.ExpectedStoreProductIdentifier)
	request.ExpectedStoreEnvironment = normalizeMigrationStoreEnvironment(request.ExpectedStoreEnvironment)
	if request.ProgramID == "" || request.ProjectID == "" || request.EnvironmentID == "" || request.ApplicationID == "" ||
		request.Reference == "" || request.ExpectedStoreProductIdentifier == "" || request.ExpectedMosaicProductID == "" || request.ExpectedStoreEnvironment == "" {
		return MigrationValidationAcceptance{}, ErrInvalid
	}
	validKind := (request.Provider == ProviderAppStore && request.ReferenceKind == ReferenceAppStoreTransactionID) ||
		(request.Provider == ProviderGooglePlay && (request.ReferenceKind == "google_play_purchase_token" || request.ReferenceKind == ReferenceGooglePlayOrderID))
	if !validKind {
		return MigrationValidationAcceptance{}, ErrInvalid
	}
	mode, organizationID, err := s.repository.EnvironmentScope(ctx, request.ProjectID, request.EnvironmentID)
	if err != nil {
		return MigrationValidationAcceptance{}, err
	}
	now := s.now()
	bodyRecord := map[string]string{"referenceKind": request.ReferenceKind}
	var referenceDigest []byte
	if request.Provider == ProviderAppStore {
		bodyRecord["reference"] = request.Reference
		referenceDigest = AppleTransactionKey(StoreUnclassified, request.Reference)
	} else if request.ReferenceKind == "google_play_purchase_token" {
		bodyRecord["purchaseToken"] = request.Reference
		referenceDigest = TokenDigest(request.Reference)
	} else {
		bodyRecord["orderReference"] = request.Reference
		referenceDigest = digestOf("mosaic-billing-google-order-v1", request.Reference)
	}
	body, err := json.Marshal(bodyRecord)
	if err != nil {
		return MigrationValidationAcceptance{}, ErrInvalid
	}
	bindingID, err := s.newID("bmv")
	if err != nil {
		return MigrationValidationAcceptance{}, ErrUnavailable
	}
	input := RawInput{
		ProjectID: request.ProjectID, OrganizationID: organizationID,
		EnvironmentID: request.EnvironmentID, EnvironmentMode: mode,
		ApplicationID: request.ApplicationID, Provider: request.Provider,
		Source: SourceMigrationKnownReference, SourceAuthority: AuthorityStoreReconciliation,
		IdempotencyKey: digestOf("mosaic-billing-migration-reference-v1", request.ProgramID, request.Provider, request.ReferenceKind, string(referenceDigest)),
		ContentDigest:  ContentDigest(body), TransactionReferenceDigest: referenceDigest,
		AuthenticationResult: AuthVerifiedTransport, StoreEnvironment: StoreUnclassified,
		IngestionStatus: IngestAccepted, CorrelationID: bindingID,
		ReceivedAt: now, ExpiresAt: now.Add(s.retention),
	}
	if err := s.sealBody(&input, body); err != nil {
		return MigrationValidationAcceptance{}, ErrUnavailable
	}
	binding := MigrationValidationBinding{
		ID: bindingID, ProgramID: request.ProgramID, ProjectID: request.ProjectID,
		EnvironmentID: request.EnvironmentID, RawInputID: input.ID, Provider: request.Provider,
		ReferenceKind: request.ReferenceKind, ReferenceDigest: referenceDigest,
		ExpectedApplicationID:          request.ApplicationID,
		ExpectedStoreProductIdentifier: request.ExpectedStoreProductIdentifier,
		ExpectedMosaicProductID:        request.ExpectedMosaicProductID,
		ExpectedStoreEnvironment:       request.ExpectedStoreEnvironment,
		Status:                         MigrationValidationAccepted, AcceptedAt: now,
	}
	return s.repository.PersistMigrationInput(ctx, input, binding, now)
}

func normalizeMigrationStoreEnvironment(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case StoreProduction:
		return StoreProduction
	case StoreSandbox:
		return StoreSandbox
	default:
		return ""
	}
}

func (s *Service) MigrationValidationOutcome(ctx context.Context, projectID, programID, bindingID string) (MigrationValidationBinding, error) {
	return s.repository.MigrationValidationOutcome(ctx, projectID, programID, bindingID)
}

func MigrationValidationEvidenceDigest(binding MigrationValidationBinding, attempt ValidationAttempt) []byte {
	watermark := attempt.CompletedAt.UTC().Format(time.RFC3339Nano)
	return digestOf("mosaic-billing-migration-validation-evidence-v1", binding.ProgramID, binding.ID,
		binding.ExpectedApplicationID, binding.ExpectedStoreProductIdentifier, binding.ExpectedMosaicProductID,
		binding.ExpectedStoreEnvironment,
		attempt.ID, attempt.Outcome, attempt.DiagnosticCode, watermark)
}
