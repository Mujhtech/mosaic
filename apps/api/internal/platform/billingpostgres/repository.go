// Package billingpostgres is the PostgreSQL implementation of the billing
// persistence port.
//
// Two rules run through every query here. Authorization is expressed in SQL
// alongside the data it protects, so a read cannot reach another tenant by
// forgetting a check in Go. And no query ever selects a raw purchase token, a
// signed payload, or a decrypted credential into a value that could reach a log
// line: envelope columns are read as opaque bytes and handed straight to the
// cipher.
package billingpostgres

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Mujhtech/mosaic/apps/api/internal/billing"
)

type Repository struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

var _ billing.Repository = (*Repository)(nil)

// requireRole enforces membership and role in one statement. Owner and admin
// are the only roles permitted to touch billing: the ledger contains store
// evidence and the credential lifecycle controls production notification
// delivery, so neither is a member-level surface.
func requireRole(ctx context.Context, q queryer, actor billing.Actor, projectID string, roles ...string) (string, error) {
	if strings.TrimSpace(actor.ID) == "" {
		return "", billing.ErrUnauthenticated
	}
	var role, organizationID string
	err := q.QueryRow(ctx,
		`SELECT m.role, p.organization_id FROM projects p
		 JOIN organization_members m ON m.organization_id = p.organization_id
		 WHERE p.id = $1 AND m.actor_id = $2`, projectID, actor.ID).Scan(&role, &organizationID)
	if errors.Is(err, pgx.ErrNoRows) {
		// Membership absent is reported as not-found rather than forbidden so a
		// caller cannot probe which Projects exist.
		return "", billing.ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("resolve billing role: %w", err)
	}
	for _, allowed := range roles {
		if role == allowed {
			return organizationID, nil
		}
	}
	return "", billing.ErrForbidden
}

type queryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

func (r *Repository) BillingEnabled(ctx context.Context, projectID string) (bool, error) {
	var enabled bool
	err := r.pool.QueryRow(ctx,
		`SELECT billing_enabled FROM billing_project_settings WHERE project_id = $1`, projectID).Scan(&enabled)
	if errors.Is(err, pgx.ErrNoRows) {
		// Absent means never configured, which is off. Mosaic Billing is opt-in.
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("read billing settings: %w", err)
	}
	return enabled, nil
}

func (r *Repository) OrganizationForProject(ctx context.Context, projectID string) (string, error) {
	var organizationID string
	err := r.pool.QueryRow(ctx, `SELECT organization_id FROM projects WHERE id = $1`, projectID).Scan(&organizationID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", billing.ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("resolve project organization: %w", err)
	}
	return organizationID, nil
}

// EnvironmentScope reads the Environment's own mode alongside the owning
// organization, in one statement, so the two can never be resolved from
// different rows.
func (r *Repository) EnvironmentScope(ctx context.Context, projectID, environmentID string) (string, string, error) {
	var mode, organizationID string
	err := r.pool.QueryRow(ctx,
		`SELECT e.mode, p.organization_id FROM environments e
		 JOIN projects p ON p.id = e.project_id
		 WHERE e.id = $1 AND e.project_id = $2`, environmentID, projectID).Scan(&mode, &organizationID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", billing.ErrNotFound
	}
	if err != nil {
		return "", "", fmt.Errorf("resolve environment scope: %w", err)
	}
	return mode, organizationID, nil
}

func (r *Repository) SetBillingEnabled(ctx context.Context, actor billing.Actor, projectID string, enabled bool, now time.Time) error {
	if _, err := requireRole(ctx, r.pool, actor, projectID, "owner", "admin"); err != nil {
		return err
	}
	if !enabled {
		// Turning billing off must actually stop ingestion. It cannot, while a
		// credential is live: Apple posts to an endpoint whose intake token
		// still resolves, and every refusal spends one of five non-renewable
		// delivery attempts. Requiring revocation first makes the switch mean
		// what it says, and makes the operator's action the one that stops the
		// store rather than a setting the store cannot see.
		var active int
		if err := r.pool.QueryRow(ctx,
			`SELECT count(*) FROM store_server_credentials WHERE project_id=$1 AND status='active'`,
			projectID).Scan(&active); err != nil {
			return fmt.Errorf("count active store server credentials: %w", err)
		}
		if active > 0 {
			return billing.ErrCredentialsStillActive
		}
	}
	_, err := r.pool.Exec(ctx,
		`INSERT INTO billing_project_settings(project_id, billing_enabled, updated_by_actor_id, created_at, updated_at)
		 VALUES ($1,$2,$3,$4,$4)
		 ON CONFLICT (project_id) DO UPDATE SET billing_enabled = EXCLUDED.billing_enabled,
		   updated_by_actor_id = EXCLUDED.updated_by_actor_id, updated_at = EXCLUDED.updated_at`,
		projectID, enabled, actor.ID, now)
	if err != nil {
		return fmt.Errorf("write billing settings: %w", err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Store Server Credentials
// ---------------------------------------------------------------------------

const credentialColumns = `id, project_id, environment_id, provider, store_environment, name, status, health_status,
	COALESCE(apple_issuer_id,''), COALESCE(apple_key_id,''), COALESCE(google_client_email,''),
	COALESCE(google_pubsub_project_id,''), COALESCE(google_pubsub_subscription_id,''),
	COALESCE(last_error_code,''), last_tested_at, created_at, rotated_at, revoked_at, updated_at`

func scanCredential(row pgx.Row) (billing.StoreServerCredential, error) {
	var value billing.StoreServerCredential
	err := row.Scan(&value.ID, &value.ProjectID, &value.EnvironmentID, &value.Provider, &value.StoreEnvironment,
		&value.Name, &value.Status, &value.HealthStatus, &value.AppleIssuerID, &value.AppleKeyID,
		&value.GoogleClientEmail, &value.GooglePubSubProjectID, &value.GooglePubSubSubscription,
		&value.LastErrorCode, &value.LastTestedAt, &value.CreatedAt, &value.RotatedAt, &value.RevokedAt, &value.UpdatedAt)
	return value, err
}

func (r *Repository) CreateCredential(ctx context.Context, actor billing.Actor, input billing.CredentialInput, envelope billing.Envelope, class string, intakeTokenDigest []byte, now time.Time) (billing.StoreServerCredential, error) {
	organizationID, err := requireRole(ctx, r.pool, actor, input.ProjectID, "owner", "admin")
	if err != nil {
		return billing.StoreServerCredential{}, err
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return billing.StoreServerCredential{}, fmt.Errorf("begin credential create: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var environmentMode string
	if err := tx.QueryRow(ctx, `SELECT mode FROM environments WHERE id = $1 AND project_id = $2`,
		input.EnvironmentID, input.ProjectID).Scan(&environmentMode); err != nil {
		return billing.StoreServerCredential{}, billing.ErrNotFound
	}

	_, err = tx.Exec(ctx,
		`INSERT INTO store_server_credentials(
			id, project_id, organization_id, environment_id, environment_mode, provider, store_environment,
			name, status, health_status, credential_class,
			envelope_version, algorithm, key_id, nonce, ciphertext, fingerprint,
			apple_issuer_id, apple_key_id, google_client_email, google_pubsub_project_id,
			google_pubsub_subscription_id, intake_token_digest, intake_token_rotated_at,
			created_by_actor_id, created_at, updated_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active','untested',$9,
			$10,$11,$12,$13,$14,$15,
			NULLIF($16,''),NULLIF($17,''),NULLIF($18,''),NULLIF($19,''),NULLIF($20,''),$21,$22,$23,$24,$24)`,
		input.CredentialID, input.ProjectID, organizationID, input.EnvironmentID, environmentMode,
		input.Provider, input.StoreEnvironment, input.Name, class,
		envelope.Version, envelope.Algorithm, envelope.KeyID, envelope.Nonce, envelope.Ciphertext, envelope.Fingerprint,
		input.AppleIssuerID, input.AppleKeyID, input.GoogleClientEmail,
		input.GooglePubSubProjectID, input.GooglePubSubSubscription,
		intakeTokenDigest, nullTime(intakeTokenDigest, now), actor.ID, now)
	if err != nil {
		if isUniqueViolation(err) {
			return billing.StoreServerCredential{}, billing.ErrConflict
		}
		return billing.StoreServerCredential{}, fmt.Errorf("insert store server credential: %w", err)
	}

	for _, application := range input.Applications {
		if _, err := tx.Exec(ctx,
			`INSERT INTO store_server_credential_applications(
				project_id, credential_id, application_id, platform, provider_application_identifier, created_at)
			 VALUES ($1,$2,$3,$4,$5,$6)`,
			input.ProjectID, input.CredentialID, application.ApplicationID, application.Platform,
			application.ProviderApplicationIdentifier, now); err != nil {
			if isUniqueViolation(err) {
				return billing.StoreServerCredential{}, billing.ErrConflict
			}
			return billing.StoreServerCredential{}, fmt.Errorf("scope credential to Application: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return billing.StoreServerCredential{}, fmt.Errorf("commit credential create: %w", err)
	}
	return r.GetCredential(ctx, actor, input.ProjectID, input.CredentialID)
}

func nullTime(digest []byte, now time.Time) any {
	if len(digest) == 0 {
		return nil
	}
	return now
}

func (r *Repository) RotateCredential(ctx context.Context, actor billing.Actor, projectID, credentialID string, envelope billing.Envelope, intakeTokenDigest []byte, now time.Time) (billing.StoreServerCredential, error) {
	if _, err := requireRole(ctx, r.pool, actor, projectID, "owner", "admin"); err != nil {
		return billing.StoreServerCredential{}, err
	}
	tag, err := r.pool.Exec(ctx,
		`UPDATE store_server_credentials
		 SET envelope_version=$3, algorithm=$4, key_id=$5, nonce=$6, ciphertext=$7, fingerprint=$8,
		     intake_token_digest = COALESCE($9, intake_token_digest),
		     intake_token_rotated_at = CASE WHEN $9 IS NULL THEN intake_token_rotated_at ELSE $10 END,
		     rotated_at=$10, updated_at=$10, health_status='untested', last_error_code=NULL
		 WHERE id=$1 AND project_id=$2 AND status='active'`,
		credentialID, projectID, envelope.Version, envelope.Algorithm, envelope.KeyID,
		envelope.Nonce, envelope.Ciphertext, envelope.Fingerprint, nullBytes(intakeTokenDigest), now)
	if err != nil {
		return billing.StoreServerCredential{}, fmt.Errorf("rotate store server credential: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return billing.StoreServerCredential{}, billing.ErrNotFound
	}
	return r.GetCredential(ctx, actor, projectID, credentialID)
}

func nullBytes(value []byte) any {
	if len(value) == 0 {
		return nil
	}
	return value
}

func (r *Repository) RevokeCredential(ctx context.Context, actor billing.Actor, projectID, credentialID string, now time.Time) (billing.StoreServerCredential, error) {
	if _, err := requireRole(ctx, r.pool, actor, projectID, "owner", "admin"); err != nil {
		return billing.StoreServerCredential{}, err
	}
	// Revocation clears the intake token digest, which is what actually stops
	// Apple notifications reaching this tenant: the endpoint stops resolving.
	tag, err := r.pool.Exec(ctx,
		`UPDATE store_server_credentials
		 SET status='revoked', health_status='revoked', revoked_at=$3, updated_at=$3, intake_token_digest=NULL
		 WHERE id=$1 AND project_id=$2 AND status='active'`, credentialID, projectID, now)
	if err != nil {
		return billing.StoreServerCredential{}, fmt.Errorf("revoke store server credential: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return billing.StoreServerCredential{}, billing.ErrNotFound
	}
	return r.GetCredential(ctx, actor, projectID, credentialID)
}

func (r *Repository) ListCredentials(ctx context.Context, actor billing.Actor, projectID string) ([]billing.StoreServerCredential, error) {
	if _, err := requireRole(ctx, r.pool, actor, projectID, "owner", "admin"); err != nil {
		return nil, err
	}
	rows, err := r.pool.Query(ctx,
		`SELECT `+credentialColumns+` FROM store_server_credentials WHERE project_id=$1 ORDER BY created_at DESC, id`, projectID)
	if err != nil {
		return nil, fmt.Errorf("list store server credentials: %w", err)
	}
	defer rows.Close()
	credentials := make([]billing.StoreServerCredential, 0, 4)
	for rows.Next() {
		credential, err := scanCredential(rows)
		if err != nil {
			return nil, fmt.Errorf("scan store server credential: %w", err)
		}
		credentials = append(credentials, credential)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read store server credentials: %w", err)
	}
	for index := range credentials {
		applications, err := r.credentialApplications(ctx, credentials[index].ID)
		if err != nil {
			return nil, err
		}
		credentials[index].Applications = applications
	}
	return credentials, nil
}

func (r *Repository) GetCredential(ctx context.Context, actor billing.Actor, projectID, credentialID string) (billing.StoreServerCredential, error) {
	if _, err := requireRole(ctx, r.pool, actor, projectID, "owner", "admin"); err != nil {
		return billing.StoreServerCredential{}, err
	}
	credential, err := scanCredential(r.pool.QueryRow(ctx,
		`SELECT `+credentialColumns+` FROM store_server_credentials WHERE id=$1 AND project_id=$2`, credentialID, projectID))
	if errors.Is(err, pgx.ErrNoRows) {
		return billing.StoreServerCredential{}, billing.ErrNotFound
	}
	if err != nil {
		return billing.StoreServerCredential{}, fmt.Errorf("read store server credential: %w", err)
	}
	credential.Applications, err = r.credentialApplications(ctx, credentialID)
	if err != nil {
		return billing.StoreServerCredential{}, err
	}
	return credential, nil
}

func (r *Repository) credentialApplications(ctx context.Context, credentialID string) ([]billing.CredentialApplication, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT application_id, platform, provider_application_identifier
		 FROM store_server_credential_applications WHERE credential_id=$1 ORDER BY application_id`, credentialID)
	if err != nil {
		return nil, fmt.Errorf("read credential Application scopes: %w", err)
	}
	defer rows.Close()
	applications := make([]billing.CredentialApplication, 0, 4)
	for rows.Next() {
		var application billing.CredentialApplication
		if err := rows.Scan(&application.ApplicationID, &application.Platform, &application.ProviderApplicationIdentifier); err != nil {
			return nil, fmt.Errorf("scan credential Application scope: %w", err)
		}
		applications = append(applications, application)
	}
	return applications, rows.Err()
}

// CredentialSecretFor reads the envelope for the worker. It performs no
// authorization because it is reachable only from the worker, which has already
// established the tenant from the input row it is processing.
func (r *Repository) CredentialSecretFor(ctx context.Context, projectID, credentialID string) (billing.StoreServerCredential, billing.Envelope, string, string, string, error) {
	var credential billing.StoreServerCredential
	var envelope billing.Envelope
	var class, organizationID string
	var bundleID *string
	err := r.pool.QueryRow(ctx,
		`SELECT c.id, c.project_id, c.environment_id, c.provider, c.store_environment, c.name, c.status,
		        c.health_status, COALESCE(c.apple_issuer_id,''), COALESCE(c.apple_key_id,''),
		        COALESCE(c.google_client_email,''), COALESCE(c.google_pubsub_project_id,''),
		        COALESCE(c.google_pubsub_subscription_id,''),
		        c.credential_class, c.organization_id,
		        c.envelope_version, c.algorithm, c.key_id, c.nonce, c.ciphertext, c.fingerprint,
		        (SELECT a.provider_application_identifier FROM store_server_credential_applications a
		          WHERE a.credential_id = c.id ORDER BY a.application_id LIMIT 1)
		 FROM store_server_credentials c WHERE c.id=$1 AND c.project_id=$2`, credentialID, projectID).
		Scan(&credential.ID, &credential.ProjectID, &credential.EnvironmentID, &credential.Provider,
			&credential.StoreEnvironment, &credential.Name, &credential.Status, &credential.HealthStatus,
			&credential.AppleIssuerID, &credential.AppleKeyID, &credential.GoogleClientEmail,
			&credential.GooglePubSubProjectID, &credential.GooglePubSubSubscription,
			&class, &organizationID,
			&envelope.Version, &envelope.Algorithm, &envelope.KeyID, &envelope.Nonce, &envelope.Ciphertext, &envelope.Fingerprint,
			&bundleID)
	if errors.Is(err, pgx.ErrNoRows) {
		return billing.StoreServerCredential{}, billing.Envelope{}, "", "", "", billing.ErrNotFound
	}
	if err != nil {
		return billing.StoreServerCredential{}, billing.Envelope{}, "", "", "", fmt.Errorf("read credential envelope: %w", err)
	}
	identifier := ""
	if bundleID != nil {
		identifier = *bundleID
	}
	return credential, envelope, class, organizationID, identifier, nil
}

func (r *Repository) CredentialForApplication(ctx context.Context, environmentID, provider, providerApplicationIdentifier string) (billing.IntakeIdentity, string, error) {
	var identity billing.IntakeIdentity
	var applicationID string
	err := r.pool.QueryRow(ctx,
		`SELECT c.id, c.project_id, c.organization_id, c.environment_id, c.environment_mode,
		        c.store_environment, c.provider, c.status, a.application_id
		 FROM store_server_credentials c
		 JOIN store_server_credential_applications a ON a.credential_id = c.id
		 WHERE c.environment_id=$1 AND c.provider=$2 AND a.provider_application_identifier=$3
		   AND c.status='active'`, environmentID, provider, providerApplicationIdentifier).
		Scan(&identity.CredentialID, &identity.ProjectID, &identity.OrganizationID, &identity.EnvironmentID,
			&identity.EnvironmentMode, &identity.StoreEnvironment, &identity.Provider, &identity.Status, &applicationID)
	if errors.Is(err, pgx.ErrNoRows) {
		return billing.IntakeIdentity{}, "", billing.ErrNotFound
	}
	if err != nil {
		return billing.IntakeIdentity{}, "", fmt.Errorf("resolve credential for Application: %w", err)
	}
	return identity, applicationID, nil
}

// CredentialForEnvironment resolves the one active credential a (Project,
// provider, Environment) scope has.
//
// Migration 00022 declares UNIQUE (project_id, provider, environment_id) on
// store_server_credentials, so this returns at most one row by schema rather
// than by an ordering rule an application defect could get wrong. The Project is
// part of the predicate as well as the Environment, so a caller that supplied a
// mismatched pair gets nothing rather than another tenant's credential.
func (r *Repository) CredentialForEnvironment(ctx context.Context, projectID, provider, environmentID string) (billing.IntakeIdentity, error) {
	var identity billing.IntakeIdentity
	err := r.pool.QueryRow(ctx,
		`SELECT id, project_id, organization_id, environment_id, environment_mode,
		        store_environment, provider, status
		 FROM store_server_credentials
		 WHERE project_id=$1 AND provider=$2 AND environment_id=$3 AND status='active'`,
		projectID, provider, environmentID).
		Scan(&identity.CredentialID, &identity.ProjectID, &identity.OrganizationID, &identity.EnvironmentID,
			&identity.EnvironmentMode, &identity.StoreEnvironment, &identity.Provider, &identity.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return billing.IntakeIdentity{}, billing.ErrCredentialMissing
	}
	if err != nil {
		return billing.IntakeIdentity{}, fmt.Errorf("resolve credential for Environment: %w", err)
	}
	return identity, nil
}

func (r *Repository) RecordCredentialEvent(ctx context.Context, projectID, credentialID, action, outcome, diagnosticCode, actorID string, now time.Time) error {
	id := "sce_" + hashID(credentialID, action, now)
	_, err := r.pool.Exec(ctx,
		`INSERT INTO store_server_credential_events(id, project_id, credential_id, action, outcome, diagnostic_code, actor_id, occurred_at)
		 VALUES ($1,$2,$3,$4,$5,NULLIF($6,''),$7,$8)`,
		id, projectID, credentialID, action, outcome, diagnosticCode, actorID, now)
	if err != nil {
		return fmt.Errorf("record credential event: %w", err)
	}
	return nil
}

func (r *Repository) UpdateCredentialHealth(ctx context.Context, projectID, credentialID, health, errorCode string, tested bool, now time.Time) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE store_server_credentials
		 SET health_status=$3, last_error_code=NULLIF($4,''), updated_at=$5,
		     last_tested_at = CASE WHEN $6 THEN $5 ELSE last_tested_at END
		 WHERE id=$1 AND project_id=$2 AND status='active'`,
		credentialID, projectID, health, errorCode, now, tested)
	if err != nil {
		return fmt.Errorf("update credential health: %w", err)
	}
	return nil
}

func (r *Repository) ActiveCredentials(ctx context.Context, provider string) ([]billing.IntakeIdentity, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, project_id, organization_id, environment_id, environment_mode, store_environment, provider, status
		 FROM store_server_credentials WHERE provider=$1 AND status='active' ORDER BY id`, provider)
	if err != nil {
		return nil, fmt.Errorf("list active credentials: %w", err)
	}
	defer rows.Close()
	identities := make([]billing.IntakeIdentity, 0, 8)
	for rows.Next() {
		var identity billing.IntakeIdentity
		if err := rows.Scan(&identity.CredentialID, &identity.ProjectID, &identity.OrganizationID,
			&identity.EnvironmentID, &identity.EnvironmentMode, &identity.StoreEnvironment,
			&identity.Provider, &identity.Status); err != nil {
			return nil, fmt.Errorf("scan active credential: %w", err)
		}
		identities = append(identities, identity)
	}
	return identities, rows.Err()
}

// ---------------------------------------------------------------------------
// Intake
// ---------------------------------------------------------------------------

// ResolveIntakeToken is the first statement executed on the unauthenticated
// Apple endpoint. It is a single indexed lookup on the digest so an invalid
// token costs one index probe and no body parsing.
func (r *Repository) ResolveIntakeToken(ctx context.Context, tokenDigest []byte) (billing.IntakeIdentity, error) {
	var identity billing.IntakeIdentity
	err := r.pool.QueryRow(ctx,
		`SELECT id, project_id, organization_id, environment_id, environment_mode, store_environment, provider, status
		 FROM store_server_credentials
		 WHERE intake_token_digest = $1 AND status = 'active'`, tokenDigest).
		Scan(&identity.CredentialID, &identity.ProjectID, &identity.OrganizationID, &identity.EnvironmentID,
			&identity.EnvironmentMode, &identity.StoreEnvironment, &identity.Provider, &identity.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return billing.IntakeIdentity{}, billing.ErrNotFound
	}
	if err != nil {
		return billing.IntakeIdentity{}, fmt.Errorf("resolve intake token: %w", err)
	}
	return identity, nil
}

// ProviderApplicationIdentifier resolves the store-side identifier (Apple
// bundle id, Google package name) for one Application inside one credential's
// scope.
//
// Apple requires a `bid` claim on every JWT, and it must be the bundle id of
// the Application the transaction actually belongs to. Taking the credential's
// alphabetically-first scoped Application instead — which is what a bare
// "LIMIT 1" does — silently sends the wrong `bid` for every Application after
// the first, and Apple answers 401. Because a 401 classifies as retryable, the
// input then burns its whole attempt budget and dead-letters with a diagnostic
// pointing the operator at credential rotation, which is not the problem.
func (r *Repository) ProviderApplicationIdentifier(ctx context.Context, credentialID, applicationID string) (string, error) {
	if strings.TrimSpace(applicationID) == "" {
		return "", billing.ErrNotFound
	}
	var identifier string
	err := r.pool.QueryRow(ctx,
		`SELECT provider_application_identifier FROM store_server_credential_applications
		 WHERE credential_id=$1 AND application_id=$2`, credentialID, applicationID).Scan(&identifier)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", billing.ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("resolve provider application identifier: %w", err)
	}
	return identifier, nil
}

func (r *Repository) ApplicationForIdentifier(ctx context.Context, credentialID, identifier string) (string, string, error) {
	if strings.TrimSpace(identifier) == "" {
		return "", "", billing.ErrNotFound
	}
	var applicationID, platform string
	err := r.pool.QueryRow(ctx,
		`SELECT application_id, platform FROM store_server_credential_applications
		 WHERE credential_id=$1 AND provider_application_identifier=$2`, credentialID, identifier).
		Scan(&applicationID, &platform)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", billing.ErrNotFound
	}
	if err != nil {
		return "", "", fmt.Errorf("resolve Application for identifier: %w", err)
	}
	return applicationID, platform, nil
}

// PersistRawInput writes a Raw Billing Input idempotently and optionally
// enqueues validation, in one transaction.
//
// The conflict handling is the important part. When the idempotency key already
// exists, the stored content digest is compared in constant time. Equal means a
// genuine duplicate delivery and nothing is written. Different means the same
// provider event id arrived carrying different content, which is either a
// provider defect or a forgery attempt; that is recorded as a conflict and
// quarantined rather than being allowed to overwrite the original.
func (r *Repository) PersistRawInput(ctx context.Context, input billing.RawInput, enqueue bool, now time.Time) (billing.PersistResult, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return billing.PersistResult{}, fmt.Errorf("begin raw input write: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if input.ID == "" {
		input.ID = "bri_" + hashID(input.ProjectID, string(input.IdempotencyKey), now)
	}
	if input.OrganizationID == "" {
		if err := tx.QueryRow(ctx, `SELECT organization_id FROM projects WHERE id=$1`, input.ProjectID).
			Scan(&input.OrganizationID); err != nil {
			return billing.PersistResult{}, fmt.Errorf("resolve organization for raw input: %w", err)
		}
	}
	if input.EnvironmentMode == "" {
		if err := tx.QueryRow(ctx, `SELECT mode FROM environments WHERE id=$1 AND project_id=$2`,
			input.EnvironmentID, input.ProjectID).Scan(&input.EnvironmentMode); err != nil {
			return billing.PersistResult{}, fmt.Errorf("resolve environment mode for raw input: %w", err)
		}
	}
	if input.BodyState == "" {
		input.BodyState = "not_retained"
	}

	var envelopeVersion *int
	var algorithm, keyID *string
	var nonce, ciphertext, fingerprint []byte
	if input.Envelope != nil && input.BodyState == "stored" {
		envelopeVersion = &input.Envelope.Version
		algorithm, keyID = &input.Envelope.Algorithm, &input.Envelope.KeyID
		nonce, ciphertext, fingerprint = input.Envelope.Nonce, input.Envelope.Ciphertext, input.Envelope.Fingerprint
	}

	tag, err := tx.Exec(ctx,
		`INSERT INTO billing_raw_inputs(
			id, project_id, organization_id, environment_id, environment_mode, application_id, credential_id,
			provider, source, source_authority, provider_event_id, idempotency_key, content_digest,
			transaction_reference_digest, body_state, envelope_version, algorithm, key_id, nonce, ciphertext,
			fingerprint, authentication_result, store_environment, notification_kind, notification_subtype,
			ingestion_status, correlation_id, provider_occurred_at, received_at, expires_at)
		 VALUES ($1,$2,$3,$4,$5,NULLIF($6,''),NULLIF($7,''),$8,$9,$10,NULLIF($11,''),$12,$13,$14,$15,
			$16,$17,$18,$19,$20,$21,$22,$23,NULLIF($24,''),NULLIF($25,''),$26,$27,$28,$29,$30)
		 ON CONFLICT (project_id, provider, idempotency_key) DO NOTHING`,
		input.ID, input.ProjectID, input.OrganizationID, input.EnvironmentID, input.EnvironmentMode,
		input.ApplicationID, input.CredentialID, input.Provider, input.Source, input.SourceAuthority,
		input.ProviderEventID, input.IdempotencyKey, input.ContentDigest, nullBytes(input.TransactionReferenceDigest),
		input.BodyState, envelopeVersion, algorithm, keyID, nonce, ciphertext, fingerprint,
		input.AuthenticationResult, input.StoreEnvironment, input.NotificationKind, input.NotificationSubtype,
		input.IngestionStatus, input.CorrelationID, input.ProviderOccurredAt, input.ReceivedAt, input.ExpiresAt)
	if err != nil {
		return billing.PersistResult{}, fmt.Errorf("insert raw billing input: %w", err)
	}

	result := billing.PersistResult{RawInputID: input.ID, Status: billing.IngestAccepted}
	if tag.RowsAffected() == 0 {
		var existingID string
		var existingDigest []byte
		if err := tx.QueryRow(ctx,
			`SELECT id, content_digest FROM billing_raw_inputs
			 WHERE project_id=$1 AND provider=$2 AND idempotency_key=$3`,
			input.ProjectID, input.Provider, input.IdempotencyKey).Scan(&existingID, &existingDigest); err != nil {
			return billing.PersistResult{}, fmt.Errorf("read existing raw billing input: %w", err)
		}
		result.RawInputID = existingID
		if subtle.ConstantTimeCompare(existingDigest, input.ContentDigest) == 1 {
			result.Status = billing.IngestDuplicate
		} else {
			result.Status = billing.IngestConflicted
			result.Conflicted = true
			if err := upsertQuarantine(ctx, tx, input.ProjectID, input.EnvironmentID, billing.QuarantineWrite{
				RawInputID: existingID, Provider: input.Provider,
				ReasonCode: billing.QuarantineInputContentConflict, Severity: "security",
				DiagnosticCode: "idempotency_key_content_conflict", OccurredAt: now,
			}); err != nil {
				return billing.PersistResult{}, err
			}
		}
		if err := insertLedger(ctx, tx, billing.LedgerEntry{
			ID: "ble_" + hashID(existingID, "duplicate", now), ProjectID: input.ProjectID,
			EnvironmentID: input.EnvironmentID, EntryType: billing.LedgerInputDuplicateDetected,
			RawInputID: existingID, CorrelationID: input.CorrelationID, OccurredAt: now,
		}); err != nil {
			return billing.PersistResult{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return billing.PersistResult{}, fmt.Errorf("commit duplicate raw input: %w", err)
		}
		return result, nil
	}

	if err := insertLedger(ctx, tx, billing.LedgerEntry{
		ID: "ble_" + hashID(input.ID, "received", now), ProjectID: input.ProjectID,
		EnvironmentID: input.EnvironmentID, EntryType: billing.LedgerInputReceived,
		RawInputID: input.ID, CredentialID: input.CredentialID,
		CorrelationID: input.CorrelationID, OccurredAt: now,
	}); err != nil {
		return billing.PersistResult{}, err
	}
	if input.IngestionStatus == billing.IngestQuarantined {
		if err := upsertQuarantine(ctx, tx, input.ProjectID, input.EnvironmentID, billing.QuarantineWrite{
			RawInputID: input.ID, ApplicationID: input.ApplicationID, Provider: input.Provider,
			ReasonCode: quarantineReasonForIntake(input), Severity: "error",
			DiagnosticCode: "intake_attribution_failed", OccurredAt: now,
		}); err != nil {
			return billing.PersistResult{}, err
		}
	}

	if enqueue {
		if _, err := tx.Exec(ctx,
			`INSERT INTO billing_validation_jobs(
				id, project_id, environment_id, raw_input_id, provider, status,
				attempt_count, max_attempts, available_at, created_at, updated_at)
			 VALUES ($1,$2,$3,$4,$5,'queued',0,$6,$7,$7,$7)
			 ON CONFLICT (raw_input_id) DO UPDATE
			   SET status='queued', available_at=$7, updated_at=$7, lease_owner=NULL, lease_expires_at=NULL`,
			"bvj_"+hashID(input.ID, "job", now), input.ProjectID, input.EnvironmentID, input.ID,
			input.Provider, billing.MaxValidationAttempts, now); err != nil {
			return billing.PersistResult{}, fmt.Errorf("enqueue validation job: %w", err)
		}
		result.Enqueued = true
	}

	if err := tx.Commit(ctx); err != nil {
		return billing.PersistResult{}, fmt.Errorf("commit raw billing input: %w", err)
	}
	return result, nil
}

func quarantineReasonForIntake(input billing.RawInput) string {
	if input.AuthenticationResult == billing.AuthFailed {
		return billing.QuarantineSignatureInvalid
	}
	return billing.QuarantineApplicationMismatch
}

func (r *Repository) RawInput(ctx context.Context, projectID, rawInputID string) (billing.RawInput, error) {
	var input billing.RawInput
	var applicationID, credentialID, providerEventID, notificationKind, notificationSubtype *string
	var envelopeVersion *int
	var algorithm, keyID *string
	var nonce, ciphertext, fingerprint, referenceDigest []byte
	err := r.pool.QueryRow(ctx,
		`SELECT id, project_id, organization_id, environment_id, environment_mode, application_id, credential_id,
		        provider, source, source_authority, provider_event_id, idempotency_key, content_digest,
		        transaction_reference_digest, body_state, envelope_version, algorithm, key_id, nonce, ciphertext,
		        fingerprint, authentication_result, store_environment, notification_kind, notification_subtype,
		        ingestion_status, correlation_id, provider_occurred_at, received_at, expires_at
		 FROM billing_raw_inputs WHERE id=$1 AND project_id=$2`, rawInputID, projectID).
		Scan(&input.ID, &input.ProjectID, &input.OrganizationID, &input.EnvironmentID, &input.EnvironmentMode,
			&applicationID, &credentialID, &input.Provider, &input.Source, &input.SourceAuthority,
			&providerEventID, &input.IdempotencyKey, &input.ContentDigest, &referenceDigest,
			&input.BodyState, &envelopeVersion, &algorithm, &keyID, &nonce, &ciphertext, &fingerprint,
			&input.AuthenticationResult, &input.StoreEnvironment, &notificationKind, &notificationSubtype,
			&input.IngestionStatus, &input.CorrelationID, &input.ProviderOccurredAt, &input.ReceivedAt, &input.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return billing.RawInput{}, billing.ErrNotFound
	}
	if err != nil {
		return billing.RawInput{}, fmt.Errorf("read raw billing input: %w", err)
	}
	input.ApplicationID = deref(applicationID)
	input.CredentialID = deref(credentialID)
	input.ProviderEventID = deref(providerEventID)
	input.NotificationKind = deref(notificationKind)
	input.NotificationSubtype = deref(notificationSubtype)
	input.TransactionReferenceDigest = referenceDigest
	if envelopeVersion != nil && algorithm != nil && keyID != nil {
		input.Envelope = &billing.Envelope{
			Version: *envelopeVersion, Algorithm: *algorithm, KeyID: *keyID,
			Nonce: nonce, Ciphertext: ciphertext, Fingerprint: fingerprint,
		}
	}
	return input, nil
}

func deref(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

// ---------------------------------------------------------------------------
// Observation authentication
// ---------------------------------------------------------------------------

func (r *Repository) AuthenticateSDKKey(ctx context.Context, raw string) (billing.ObservationScope, error) {
	return r.authenticateKey(ctx, raw, "public_sdk")
}

func (r *Repository) AuthenticateServerKey(ctx context.Context, raw string) (billing.ObservationScope, error) {
	return r.authenticateKey(ctx, raw, "secret_server")
}

// authenticateKey mirrors the analytics SDK-key path exactly: prefix lookup,
// then a constant-time digest comparison, so a wrong key costs the same time as
// a right one and the prefix alone proves nothing.
func (r *Repository) authenticateKey(ctx context.Context, raw, kind string) (billing.ObservationScope, error) {
	parts := strings.SplitN(strings.TrimSpace(raw), ".", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return billing.ObservationScope{}, billing.ErrUnauthenticated
	}
	var scope billing.ObservationScope
	var stored []byte
	var storedKind string
	var revoked *time.Time
	var applicationID *string
	var platform *string
	err := r.pool.QueryRow(ctx,
		`SELECT k.id, p.organization_id, e.project_id, e.id, e.mode, k.application_id, a.platform,
		        k.kind, k.secret_digest, k.revoked_at
		 FROM api_keys k
		 JOIN environments e ON e.id = k.environment_id
		 JOIN projects p ON p.id = e.project_id
		 LEFT JOIN applications a ON a.id = k.application_id
		 WHERE k.prefix = $1`, parts[0]).
		Scan(&scope.APIKeyID, &scope.OrganizationID, &scope.ProjectID, &scope.EnvironmentID,
			&scope.EnvironmentMode, &applicationID, &platform, &storedKind, &stored, &revoked)
	if errors.Is(err, pgx.ErrNoRows) {
		return billing.ObservationScope{}, billing.ErrUnauthenticated
	}
	if err != nil {
		return billing.ObservationScope{}, fmt.Errorf("authenticate billing key: %w", err)
	}
	digest := sha256.Sum256([]byte(raw))
	if storedKind != kind || revoked != nil || subtle.ConstantTimeCompare(digest[:], stored) != 1 {
		return billing.ObservationScope{}, billing.ErrUnauthenticated
	}
	scope.ApplicationID = deref(applicationID)
	scope.Platform = deref(platform)
	if kind == "public_sdk" && scope.ApplicationID == "" {
		// A public SDK key without an Application cannot attribute an
		// observation to anything, so it is not usable here.
		return billing.ObservationScope{}, billing.ErrUnauthenticated
	}
	return scope, nil
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

func insertLedger(ctx context.Context, tx pgx.Tx, entry billing.LedgerEntry) error {
	detail := []byte("{}")
	if len(entry.Detail) > 0 {
		encoded, err := json.Marshal(entry.Detail)
		if err == nil {
			detail = encoded
		}
	}
	_, err := tx.Exec(ctx,
		`INSERT INTO billing_ledger_entries(
			id, project_id, environment_id, entry_type, raw_input_id, validation_attempt_id,
			transaction_fact_id, credential_id, detail, correlation_id, occurred_at)
		 VALUES ($1,$2,$3,$4,NULLIF($5,''),NULLIF($6,''),NULLIF($7,''),NULLIF($8,''),$9,$10,$11)
		 ON CONFLICT (id) DO NOTHING`,
		entry.ID, entry.ProjectID, entry.EnvironmentID, entry.EntryType, entry.RawInputID,
		entry.ValidationAttemptID, entry.TransactionFactID, entry.CredentialID, detail,
		entry.CorrelationID, entry.OccurredAt)
	if err != nil {
		return fmt.Errorf("append billing ledger entry: %w", err)
	}
	return nil
}

// upsertQuarantine opens a record or advances an existing one. A repeated
// failure increments the attempt counter rather than creating a second record,
// so the operator queue reflects distinct problems rather than retry volume.
func upsertQuarantine(ctx context.Context, tx pgx.Tx, projectID, environmentID string, write billing.QuarantineWrite) error {
	scopes := write.Scopes
	if scopes == nil {
		scopes = []string{}
	}
	_, err := tx.Exec(ctx,
		`INSERT INTO billing_quarantine_records(
			id, project_id, environment_id, raw_input_id, application_id, provider, reason_code,
			severity, scopes, status, attempt_count, first_seen_at, last_attempt_at, diagnostic_code)
		 VALUES ($1,$2,$3,$4,NULLIF($5,''),$6,$7,$8,$9,'open',1,$10,$10,NULLIF($11,''))
		 ON CONFLICT (raw_input_id) DO UPDATE
		   SET attempt_count = billing_quarantine_records.attempt_count + 1,
		       last_attempt_at = EXCLUDED.last_attempt_at,
		       reason_code = EXCLUDED.reason_code,
		       severity = EXCLUDED.severity,
		       diagnostic_code = EXCLUDED.diagnostic_code,
		       status = CASE WHEN billing_quarantine_records.status IN ('closed_after_success','closed_superseded')
		                     THEN billing_quarantine_records.status ELSE 'open' END`,
		"bqr_"+hashID(write.RawInputID, write.ReasonCode, write.OccurredAt), projectID, environmentID,
		write.RawInputID, write.ApplicationID, write.Provider, write.ReasonCode, write.Severity,
		scopes, write.OccurredAt, write.DiagnosticCode)
	if err != nil {
		return fmt.Errorf("record quarantine: %w", err)
	}
	return nil
}

// hashID derives a deterministic identifier so a retried write produces the same
// row id and the ON CONFLICT clauses stay meaningful.
func hashID(parts ...any) string {
	hasher := sha256.New()
	for _, part := range parts {
		fmt.Fprintf(hasher, "%v\x00", part)
	}
	return fmt.Sprintf("%x", hasher.Sum(nil))[:24]
}

func isUniqueViolation(err error) bool {
	return err != nil && strings.Contains(err.Error(), "SQLSTATE 23505")
}
