package billingpostgres

import (
	"context"
	"crypto/subtle"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Mujhtech/mosaic/apps/api/internal/billing"
)

// PersistMigrationInput atomically creates a raw input, its immutable migration
// expectation, and the ordinary validation job. A crash can therefore leave
// all three durable or none of them.
func (r *Repository) PersistMigrationInput(ctx context.Context, input billing.RawInput, binding billing.MigrationValidationBinding, now time.Time) (billing.MigrationValidationAcceptance, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return billing.MigrationValidationAcceptance{}, fmt.Errorf("begin migration validation intake: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if input.ID == "" {
		input.ID = "bri_" + hashID(input.ProjectID, string(input.IdempotencyKey), "migration")
	}
	binding.RawInputID = input.ID

	var existing billing.MigrationValidationBinding
	err = tx.QueryRow(ctx, `SELECT id,raw_input_id,status,reference_digest,expected_application_id,expected_store_product_identifier,expected_mosaic_product_id,expected_store_environment
		FROM billing_migration_validation_bindings WHERE program_id=$1 AND provider=$2 AND reference_kind=$3 AND reference_digest=$4`,
		binding.ProgramID, binding.Provider, binding.ReferenceKind, binding.ReferenceDigest).
		Scan(&existing.ID, &existing.RawInputID, &existing.Status, &existing.ReferenceDigest, &existing.ExpectedApplicationID,
			&existing.ExpectedStoreProductIdentifier, &existing.ExpectedMosaicProductID, &existing.ExpectedStoreEnvironment)
	if err == nil {
		if subtle.ConstantTimeCompare(existing.ReferenceDigest, binding.ReferenceDigest) != 1 ||
			existing.ExpectedApplicationID != binding.ExpectedApplicationID ||
			existing.ExpectedStoreProductIdentifier != binding.ExpectedStoreProductIdentifier ||
			existing.ExpectedMosaicProductID != binding.ExpectedMosaicProductID || existing.ExpectedStoreEnvironment != binding.ExpectedStoreEnvironment {
			return billing.MigrationValidationAcceptance{}, billing.ErrConflict
		}
		return billing.MigrationValidationAcceptance{BindingID: existing.ID, RawInputID: existing.RawInputID, Status: existing.Status}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return billing.MigrationValidationAcceptance{}, fmt.Errorf("read migration validation binding: %w", err)
	}

	var envelopeVersion *int
	var algorithm, keyID *string
	var nonce, ciphertext, fingerprint []byte
	if input.Envelope != nil && input.BodyState == "stored" {
		envelopeVersion = &input.Envelope.Version
		algorithm = &input.Envelope.Algorithm
		keyID = &input.Envelope.KeyID
		nonce, ciphertext, fingerprint = input.Envelope.Nonce, input.Envelope.Ciphertext, input.Envelope.Fingerprint
	}
	if input.BodyState == "" {
		input.BodyState = "not_retained"
	}
	_, err = tx.Exec(ctx, `INSERT INTO billing_raw_inputs(
		id,project_id,organization_id,environment_id,environment_mode,application_id,credential_id,
		provider,source,source_authority,provider_event_id,idempotency_key,content_digest,transaction_reference_digest,
		body_state,envelope_version,algorithm,key_id,nonce,ciphertext,fingerprint,authentication_result,store_environment,
		notification_kind,notification_subtype,ingestion_status,correlation_id,provider_occurred_at,received_at,expires_at)
		VALUES($1,$2,$3,$4,$5,$6,NULL,$7,$8,$9,NULL,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,NULL,NULL,$22,$23,NULL,$24,$25)`,
		input.ID, input.ProjectID, input.OrganizationID, input.EnvironmentID, input.EnvironmentMode, input.ApplicationID,
		input.Provider, input.Source, input.SourceAuthority, input.IdempotencyKey, input.ContentDigest, input.TransactionReferenceDigest,
		input.BodyState, envelopeVersion, algorithm, keyID, nonce, ciphertext, fingerprint, input.AuthenticationResult,
		input.StoreEnvironment, input.IngestionStatus, input.CorrelationID, input.ReceivedAt, input.ExpiresAt)
	if err != nil {
		return billing.MigrationValidationAcceptance{}, fmt.Errorf("insert migration raw input: %w", err)
	}
	if err := insertLedger(ctx, tx, billing.LedgerEntry{ID: "ble_" + hashID(input.ID, "received", now), ProjectID: input.ProjectID,
		EnvironmentID: input.EnvironmentID, EntryType: billing.LedgerInputReceived, RawInputID: input.ID,
		CorrelationID: input.CorrelationID, OccurredAt: now}); err != nil {
		return billing.MigrationValidationAcceptance{}, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO billing_validation_jobs(id,project_id,environment_id,raw_input_id,provider,status,attempt_count,max_attempts,available_at,created_at,updated_at)
		VALUES($1,$2,$3,$4,$5,'queued',0,$6,$7,$7,$7)`, "bvj_"+hashID(input.ID, "job", now), input.ProjectID, input.EnvironmentID, input.ID, input.Provider, billing.MaxValidationAttempts, now)
	if err != nil {
		return billing.MigrationValidationAcceptance{}, fmt.Errorf("enqueue migration validation: %w", err)
	}
	_, err = tx.Exec(ctx, `INSERT INTO billing_migration_validation_bindings(id,program_id,project_id,environment_id,raw_input_id,provider,reference_kind,reference_digest,expected_application_id,expected_store_product_identifier,expected_mosaic_product_id,expected_store_environment,status,accepted_at)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'accepted',$13)`, binding.ID, binding.ProgramID, binding.ProjectID, binding.EnvironmentID, input.ID, binding.Provider, binding.ReferenceKind, binding.ReferenceDigest, binding.ExpectedApplicationID, binding.ExpectedStoreProductIdentifier, binding.ExpectedMosaicProductID, binding.ExpectedStoreEnvironment, now)
	if err != nil {
		return billing.MigrationValidationAcceptance{}, fmt.Errorf("insert migration validation binding: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return billing.MigrationValidationAcceptance{}, fmt.Errorf("commit migration validation intake: %w", err)
	}
	return billing.MigrationValidationAcceptance{BindingID: binding.ID, RawInputID: input.ID, Status: billing.MigrationValidationAccepted}, nil
}

func (r *Repository) MigrationValidationOutcome(ctx context.Context, projectID, programID, bindingID string) (billing.MigrationValidationBinding, error) {
	var value billing.MigrationValidationBinding
	var diagnostic, attempt *string
	var evidence []byte
	var watermark, completed *time.Time
	err := r.pool.QueryRow(ctx, `SELECT id,program_id,project_id,environment_id,raw_input_id,provider,reference_kind,reference_digest,
		expected_application_id,expected_store_product_identifier,expected_mosaic_product_id,expected_store_environment,status,diagnostic_code,
		validation_attempt_id,evidence_digest,provider_watermark,accepted_at,completed_at
		FROM billing_migration_validation_bindings WHERE id=$1 AND project_id=$2 AND program_id=$3`, bindingID, projectID, programID).
		Scan(&value.ID, &value.ProgramID, &value.ProjectID, &value.EnvironmentID, &value.RawInputID, &value.Provider, &value.ReferenceKind, &value.ReferenceDigest,
			&value.ExpectedApplicationID, &value.ExpectedStoreProductIdentifier, &value.ExpectedMosaicProductID, &value.ExpectedStoreEnvironment, &value.Status, &diagnostic,
			&attempt, &evidence, &watermark, &value.AcceptedAt, &completed)
	if errors.Is(err, pgx.ErrNoRows) {
		return billing.MigrationValidationBinding{}, billing.ErrNotFound
	}
	if err != nil {
		return billing.MigrationValidationBinding{}, fmt.Errorf("read migration validation outcome: %w", err)
	}
	if diagnostic != nil {
		value.DiagnosticCode = *diagnostic
	}
	if attempt != nil {
		value.ValidationAttemptID = *attempt
	}
	value.EvidenceDigest = evidence
	if watermark != nil {
		value.ProviderWatermark = *watermark
	}
	if completed != nil {
		value.CompletedAt = *completed
	}
	return value, nil
}
