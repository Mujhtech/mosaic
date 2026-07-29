// Package billingwebhookpostgres is the PostgreSQL implementation of the
// webhook persistence port.
//
// Two invariants shape almost every statement here. Every tenant-owned read
// and write filters on project_id, so isolation is a property of the query
// rather than of a caller remembering to check. And the delivery lease is
// committed before the caller makes any HTTP request: SELECT ... FOR UPDATE
// SKIP LOCKED claims the row, the transaction closes, and the network call
// happens with no lock held.
package billingwebhookpostgres

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingwebhook"
)

type Repository struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

var _ billingwebhook.Repository = (*Repository)(nil)

// AuthorizeProject is the single operator authorization boundary for billing
// webhook management. Billing webhooks carry authoritative entitlement state,
// so they use the same owner/admin role bar as the billing ledger and customer
// operator surfaces.
func (r *Repository) AuthorizeProject(ctx context.Context, actor billingwebhook.Actor, projectID string) error {
	actorID := strings.TrimSpace(actor.ID)
	if actorID == "" || strings.TrimSpace(projectID) == "" {
		return billingwebhook.ErrUnauthenticated
	}
	var role string
	err := r.pool.QueryRow(ctx,
		`SELECT m.role FROM projects p
		 JOIN organization_members m ON m.organization_id = p.organization_id
		 WHERE p.id = $1 AND m.actor_id = $2`, projectID, actorID).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		return billingwebhook.ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("resolve billing webhook operator role: %w", err)
	}
	switch role {
	case "owner", "admin":
		return nil
	default:
		return billingwebhook.ErrForbidden
	}
}

func (r *Repository) AuthorizeEnvironment(ctx context.Context, actor billingwebhook.Actor, projectID, environmentID string) error {
	if err := r.AuthorizeProject(ctx, actor, projectID); err != nil {
		return err
	}
	var exists bool
	err := r.pool.QueryRow(ctx,
		`SELECT true FROM environments WHERE id = $1 AND project_id = $2`, environmentID, projectID).
		Scan(&exists)
	if errors.Is(err, pgx.ErrNoRows) {
		return billingwebhook.ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("resolve billing webhook environment: %w", err)
	}
	return nil
}

// destinationColumns is the single projection every destination read uses, so
// a column added to one read cannot be forgotten by another.
const destinationColumns = `id, project_id, environment_id, url, status, event_types, description,
	created_at, updated_at, secret_last_rotated_at, coalesce(disabled_reason, ''),
	consecutive_failure_count, auto_disabled_at, coalesce(auto_disable_reason, '')`

func scanDestination(row pgx.Row) (billingwebhook.Destination, error) {
	var destination billingwebhook.Destination
	err := row.Scan(&destination.ID, &destination.ProjectID, &destination.EnvironmentID,
		&destination.URL, &destination.Status, &destination.EventTypes, &destination.Description,
		&destination.CreatedAt, &destination.UpdatedAt, &destination.SecretLastRotatedAt,
		&destination.DisabledReason, &destination.ConsecutiveFailureCount,
		&destination.AutoDisabledAt, &destination.AutoDisableReason)
	return destination, err
}

func (r *Repository) BillingEnabled(ctx context.Context, projectID string) (bool, error) {
	var enabled bool
	err := r.pool.QueryRow(ctx,
		`SELECT billing_enabled FROM billing_project_settings WHERE project_id = $1`, projectID).
		Scan(&enabled)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("read billing enablement: %w", err)
	}
	return enabled, nil
}

func (r *Repository) OrganizationForProject(ctx context.Context, projectID string) (string, error) {
	var organizationID string
	if err := r.pool.QueryRow(ctx,
		`SELECT organization_id FROM projects WHERE id = $1`, projectID).Scan(&organizationID); err != nil {
		return "", billingwebhook.ErrNotFound
	}
	return organizationID, nil
}

// ---------------------------------------------------------------------------
// Destinations
// ---------------------------------------------------------------------------

func (r *Repository) CreateDestination(ctx context.Context, destination billingwebhook.Destination,
	secret billingwebhook.SealedSecret, actorID string, now time.Time) (billingwebhook.Destination, error) {

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return billingwebhook.Destination{}, fmt.Errorf("begin webhook destination create: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx,
		`INSERT INTO webhook_destinations(
			id, project_id, environment_id, url, status, event_types, description,
			created_at, updated_at, created_by_actor_id, secret_last_rotated_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$8)`,
		destination.ID, destination.ProjectID, destination.EnvironmentID, destination.URL,
		destination.Status, destination.EventTypes, destination.Description, now, actorID); err != nil {
		return billingwebhook.Destination{}, translate(err, "insert webhook destination")
	}
	if err := insertSecret(ctx, tx, destination.ProjectID, destination.ID, secret, now); err != nil {
		return billingwebhook.Destination{}, err
	}
	// The destination and its first secret commit together. A destination that
	// existed without a secret could never sign a delivery, and every event it
	// received would fail for a reason no operator could act on.
	if err := recordAudit(ctx, tx, destination.ProjectID, destination.EnvironmentID, actorID,
		"billing.webhook.destination.created", destination.ID, nil, now); err != nil {
		return billingwebhook.Destination{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return billingwebhook.Destination{}, fmt.Errorf("commit webhook destination create: %w", err)
	}
	return r.Destination(ctx, destination.ProjectID, destination.ID)
}

func insertSecret(ctx context.Context, tx pgx.Tx, projectID, destinationID string,
	secret billingwebhook.SealedSecret, now time.Time) error {

	_, err := tx.Exec(ctx,
		`INSERT INTO webhook_signing_secrets(
			id, project_id, webhook_destination_id, status, envelope_version, algorithm, key_id,
			nonce, ciphertext, fingerprint, created_at)
		 VALUES ($1,$2,$3,'active',$4,$5,$6,$7,$8,$9,$10)`,
		secret.ID, projectID, destinationID, secret.EnvelopeVersion, secret.Algorithm,
		secret.KeyID, secret.Nonce, secret.Ciphertext, secret.Fingerprint, now)
	if err != nil {
		return translate(err, "insert webhook signing secret")
	}
	return nil
}

func (r *Repository) ListDestinations(ctx context.Context, projectID, environmentID string) ([]billingwebhook.Destination, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+destinationColumns+` FROM webhook_destinations
		 WHERE project_id = $1 AND ($2 = '' OR environment_id = $2)
		 ORDER BY created_at DESC, id`, projectID, environmentID)
	if err != nil {
		return nil, fmt.Errorf("list webhook destinations: %w", err)
	}
	defer rows.Close()

	destinations := make([]billingwebhook.Destination, 0, 8)
	for rows.Next() {
		destination, err := scanDestination(rows)
		if err != nil {
			return nil, fmt.Errorf("scan webhook destination: %w", err)
		}
		destinations = append(destinations, destination)
	}
	return destinations, rows.Err()
}

func (r *Repository) Destination(ctx context.Context, projectID, destinationID string) (billingwebhook.Destination, error) {
	destination, err := scanDestination(r.pool.QueryRow(ctx,
		`SELECT `+destinationColumns+` FROM webhook_destinations WHERE id = $1 AND project_id = $2`,
		destinationID, projectID))
	if errors.Is(err, pgx.ErrNoRows) {
		// A destination in another Project is reported absent rather than
		// forbidden: a caller must not be able to probe for another tenant's
		// destinations by comparing 404 against 403.
		return billingwebhook.Destination{}, billingwebhook.ErrNotFound
	}
	if err != nil {
		return billingwebhook.Destination{}, fmt.Errorf("read webhook destination: %w", err)
	}
	return destination, nil
}

func (r *Repository) UpdateDestination(ctx context.Context, projectID, destinationID string,
	update billingwebhook.DestinationUpdate, actorID string, now time.Time) (billingwebhook.Destination, error) {

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return billingwebhook.Destination{}, fmt.Errorf("begin webhook destination update: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// COALESCE against a typed NULL keeps "leave this alone" and "set this to
	// the empty string" distinguishable, which a plain string parameter cannot.
	tag, err := tx.Exec(ctx,
		`UPDATE webhook_destinations
		 SET url = coalesce($3, url),
		     event_types = coalesce($4, event_types),
		     description = coalesce($5, description),
		     updated_at = $6
		 WHERE id = $1 AND project_id = $2`,
		destinationID, projectID, update.URL, nullableArray(update.EventTypes), update.Description, now)
	if err != nil {
		return billingwebhook.Destination{}, translate(err, "update webhook destination")
	}
	if tag.RowsAffected() == 0 {
		return billingwebhook.Destination{}, billingwebhook.ErrNotFound
	}
	environmentID, err := environmentOf(ctx, tx, projectID, destinationID)
	if err != nil {
		return billingwebhook.Destination{}, err
	}
	if err := recordAudit(ctx, tx, projectID, environmentID, actorID,
		"billing.webhook.destination.updated", destinationID, nil, now); err != nil {
		return billingwebhook.Destination{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return billingwebhook.Destination{}, fmt.Errorf("commit webhook destination update: %w", err)
	}
	return r.Destination(ctx, projectID, destinationID)
}

func (r *Repository) SetDestinationStatus(ctx context.Context, projectID, destinationID, status, reason, actorID string,
	now time.Time) (billingwebhook.Destination, error) {

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return billingwebhook.Destination{}, fmt.Errorf("begin webhook destination status change: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Returning a destination to active clears the automatic disable state and
	// its failure counter. Without that, a destination Mosaic disabled would be
	// re-disabled by the very next failure, and an operator's fix would look
	// like it had not worked.
	tag, err := tx.Exec(ctx,
		`UPDATE webhook_destinations
		 SET status = $3,
		     disabled_reason = CASE WHEN $3 = 'active' OR $4 = '' THEN NULL ELSE $4 END,
		     auto_disabled_at = CASE WHEN $3 = 'active' THEN NULL ELSE auto_disabled_at END,
		     auto_disable_reason = CASE WHEN $3 = 'active' THEN NULL ELSE auto_disable_reason END,
		     consecutive_failure_count = CASE WHEN $3 = 'active' THEN 0 ELSE consecutive_failure_count END,
		     updated_at = $5
		 WHERE id = $1 AND project_id = $2`,
		destinationID, projectID, status, reason, now)
	if err != nil {
		return billingwebhook.Destination{}, translate(err, "update webhook destination status")
	}
	if tag.RowsAffected() == 0 {
		return billingwebhook.Destination{}, billingwebhook.ErrNotFound
	}
	environmentID, err := environmentOf(ctx, tx, projectID, destinationID)
	if err != nil {
		return billingwebhook.Destination{}, err
	}
	if err := recordAudit(ctx, tx, projectID, environmentID, actorID,
		"billing.webhook.destination.status_changed", destinationID,
		map[string]string{"status": status}, now); err != nil {
		return billingwebhook.Destination{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return billingwebhook.Destination{}, fmt.Errorf("commit webhook destination status change: %w", err)
	}
	return r.Destination(ctx, projectID, destinationID)
}

func (r *Repository) AutoDisableDestination(ctx context.Context, projectID, destinationID, reason string, now time.Time) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin webhook destination auto-disable: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Guarded on the current status so two workers finishing failed deliveries
	// at once produce one disable and one audit entry rather than two.
	tag, err := tx.Exec(ctx,
		`UPDATE webhook_destinations
		 SET status = 'disabled', auto_disabled_at = $4, auto_disable_reason = $3, updated_at = $4
		 WHERE id = $1 AND project_id = $2 AND status <> 'disabled'`,
		destinationID, projectID, reason, now)
	if err != nil {
		return translate(err, "auto-disable webhook destination")
	}
	if tag.RowsAffected() == 0 {
		return nil
	}
	environmentID, err := environmentOf(ctx, tx, projectID, destinationID)
	if err != nil {
		return err
	}
	// The actor is Mosaic itself. An automatic disable is exactly the kind of
	// change an operator later has to explain, so it is audited like any other.
	if err := recordAudit(ctx, tx, projectID, environmentID, "system",
		"billing.webhook.destination.auto_disabled", destinationID,
		map[string]string{"reason": reason}, now); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r *Repository) DeleteDestination(ctx context.Context, projectID, destinationID, actorID string, now time.Time) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin webhook destination delete: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	environmentID, err := environmentOf(ctx, tx, projectID, destinationID)
	if err != nil {
		return err
	}
	// Delivery history is the record of what a tenant's backend was told, and
	// the destination row is what identifies it. Once history exists the
	// supported answer is disable, not delete — the foreign keys would refuse
	// anyway, and refusing here produces a conflict an operator can read
	// instead of a constraint violation.
	var deliveries int
	if err := tx.QueryRow(ctx,
		`SELECT count(*) FROM webhook_deliveries WHERE webhook_destination_id = $1 AND project_id = $2`,
		destinationID, projectID).Scan(&deliveries); err != nil {
		return fmt.Errorf("count webhook deliveries: %w", err)
	}
	if deliveries > 0 {
		return billingwebhook.ErrConflict
	}
	if _, err := tx.Exec(ctx,
		`DELETE FROM webhook_signing_secrets WHERE webhook_destination_id = $1 AND project_id = $2`,
		destinationID, projectID); err != nil {
		return translate(err, "delete webhook signing secrets")
	}
	tag, err := tx.Exec(ctx,
		`DELETE FROM webhook_destinations WHERE id = $1 AND project_id = $2`, destinationID, projectID)
	if err != nil {
		return translate(err, "delete webhook destination")
	}
	if tag.RowsAffected() == 0 {
		return billingwebhook.ErrNotFound
	}
	if err := recordAudit(ctx, tx, projectID, environmentID, actorID,
		"billing.webhook.destination.deleted", destinationID, nil, now); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ---------------------------------------------------------------------------
// Signing secrets
// ---------------------------------------------------------------------------

func (r *Repository) RotateSecret(ctx context.Context, projectID, destinationID string,
	secret billingwebhook.SealedSecret, honoredUntil time.Time, actorID string, now time.Time) (billingwebhook.SecretMetadata, error) {

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return billingwebhook.SecretMetadata{}, fmt.Errorf("begin webhook secret rotation: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	environmentID, err := environmentOf(ctx, tx, projectID, destinationID)
	if err != nil {
		return billingwebhook.SecretMetadata{}, err
	}
	// Retire first, then insert. Doing it in this order means the new secret is
	// never caught by the retirement statement, so a rotation cannot retire the
	// secret it just created.
	if _, err := tx.Exec(ctx,
		`UPDATE webhook_signing_secrets
		 SET status = 'retired', retired_at = $3, honored_until = $4
		 WHERE webhook_destination_id = $1 AND project_id = $2 AND status = 'active'`,
		destinationID, projectID, now, honoredUntil); err != nil {
		return billingwebhook.SecretMetadata{}, translate(err, "retire webhook signing secrets")
	}
	if err := insertSecret(ctx, tx, projectID, destinationID, secret, now); err != nil {
		return billingwebhook.SecretMetadata{}, err
	}
	if _, err := tx.Exec(ctx,
		`UPDATE webhook_destinations SET secret_last_rotated_at = $3, updated_at = $3
		 WHERE id = $1 AND project_id = $2`, destinationID, projectID, now); err != nil {
		return billingwebhook.SecretMetadata{}, translate(err, "stamp webhook secret rotation")
	}
	if err := recordAudit(ctx, tx, projectID, environmentID, actorID,
		"billing.webhook.secret.rotated", destinationID,
		map[string]string{"honoredUntil": honoredUntil.UTC().Format(time.RFC3339)}, now); err != nil {
		return billingwebhook.SecretMetadata{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return billingwebhook.SecretMetadata{}, fmt.Errorf("commit webhook secret rotation: %w", err)
	}
	return billingwebhook.SecretMetadata{ID: secret.ID, Status: billingwebhook.SecretActive, CreatedAt: now}, nil
}

func (r *Repository) ListSecrets(ctx context.Context, projectID, destinationID string) ([]billingwebhook.SecretMetadata, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, status, created_at, retired_at, honored_until
		 FROM webhook_signing_secrets
		 WHERE webhook_destination_id = $1 AND project_id = $2
		 ORDER BY created_at DESC, id`, destinationID, projectID)
	if err != nil {
		return nil, fmt.Errorf("list webhook signing secrets: %w", err)
	}
	defer rows.Close()

	secrets := make([]billingwebhook.SecretMetadata, 0, 4)
	for rows.Next() {
		var secret billingwebhook.SecretMetadata
		if err := rows.Scan(&secret.ID, &secret.Status, &secret.CreatedAt,
			&secret.RetiredAt, &secret.HonoredUntil); err != nil {
			return nil, fmt.Errorf("scan webhook signing secret: %w", err)
		}
		secrets = append(secrets, secret)
	}
	return secrets, rows.Err()
}

func (r *Repository) RetireSecret(ctx context.Context, projectID, destinationID, secretID, actorID string,
	now time.Time) (billingwebhook.SecretMetadata, error) {

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return billingwebhook.SecretMetadata{}, fmt.Errorf("begin webhook secret retirement: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// A destination must keep at least one secret that can sign. Retiring the
	// last one would leave every subsequent delivery unsignable, and an
	// unsigned entitlement webhook is an unauthenticated instruction to grant
	// access — so the operation is refused rather than silently degrading.
	var remaining int
	if err := tx.QueryRow(ctx,
		`SELECT count(*) FROM webhook_signing_secrets
		 WHERE webhook_destination_id = $1 AND project_id = $2 AND status = 'active' AND id <> $3`,
		destinationID, projectID, secretID).Scan(&remaining); err != nil {
		return billingwebhook.SecretMetadata{}, fmt.Errorf("count active webhook signing secrets: %w", err)
	}

	var secret billingwebhook.SecretMetadata
	// honored_until is set to the retirement instant rather than left in place:
	// an explicit retirement ends the overlap now, which is the entire point of
	// taking the action after a suspected compromise.
	err = tx.QueryRow(ctx,
		`UPDATE webhook_signing_secrets
		 SET status = 'retired', retired_at = coalesce(retired_at, $4), honored_until = $4
		 WHERE id = $1 AND project_id = $2 AND webhook_destination_id = $3
		 RETURNING id, status, created_at, retired_at, honored_until`,
		secretID, projectID, destinationID, now).
		Scan(&secret.ID, &secret.Status, &secret.CreatedAt, &secret.RetiredAt, &secret.HonoredUntil)
	if errors.Is(err, pgx.ErrNoRows) {
		return billingwebhook.SecretMetadata{}, billingwebhook.ErrNotFound
	}
	if err != nil {
		return billingwebhook.SecretMetadata{}, translate(err, "retire webhook signing secret")
	}
	if remaining == 0 {
		return billingwebhook.SecretMetadata{}, billingwebhook.ErrConflict
	}
	environmentID, err := environmentOf(ctx, tx, projectID, destinationID)
	if err != nil {
		return billingwebhook.SecretMetadata{}, err
	}
	if err := recordAudit(ctx, tx, projectID, environmentID, actorID,
		"billing.webhook.secret.retired", destinationID,
		map[string]string{"secretId": secretID}, now); err != nil {
		return billingwebhook.SecretMetadata{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return billingwebhook.SecretMetadata{}, fmt.Errorf("commit webhook secret retirement: %w", err)
	}
	return secret, nil
}

// ---------------------------------------------------------------------------
// Fan-out
// ---------------------------------------------------------------------------

// FanOut expands committed events into deliveries.
//
// The whole expansion of one event is one transaction, so an event is either
// fully expanded or not expanded at all: a partial fan-out that recorded its
// marker would permanently skip the destinations it had not reached.
func (r *Repository) FanOut(ctx context.Context, now time.Time, limit int) (int, error) {
	if limit <= 0 {
		limit = billingwebhook.FanOutBatch
	}
	rows, err := r.pool.Query(ctx,
		`SELECT e.id, e.project_id
		 FROM webhook_events e
		 LEFT JOIN webhook_event_fanouts f ON f.webhook_event_id = e.id
		 WHERE f.webhook_event_id IS NULL AND e.created_at > $1
		 ORDER BY e.created_at, e.id
		 LIMIT $2`, now.Add(-billingwebhook.FanOutHorizon), limit)
	if err != nil {
		return 0, fmt.Errorf("select unexpanded webhook events: %w", err)
	}
	type pending struct{ eventID, projectID string }
	events := make([]pending, 0, limit)
	for rows.Next() {
		var event pending
		if err := rows.Scan(&event.eventID, &event.projectID); err != nil {
			rows.Close()
			return 0, fmt.Errorf("scan unexpanded webhook event: %w", err)
		}
		events = append(events, event)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("select unexpanded webhook events: %w", err)
	}

	expanded := 0
	for _, event := range events {
		if err := r.fanOutEvent(ctx, event.eventID, event.projectID, now); err != nil {
			return expanded, err
		}
		expanded++
	}
	return expanded, nil
}

func (r *Repository) fanOutEvent(ctx context.Context, eventID, projectID string, now time.Time) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin webhook fan-out: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Delivery ids are derived from (event, destination) rather than random, so
	// a fan-out interrupted after the insert and before the marker produces the
	// same ids on its next run and the ON CONFLICT absorbs it. Combined with
	// UNIQUE (webhook_event_id, webhook_destination_id), a crashed fan-out can
	// never send a destination the same event twice.
	//
	// A destination that is paused, disabled, or not subscribed to this event
	// type still gets a row, in terminal `skipped` state with its reason. An
	// operator asking "why did my endpoint not receive this?" then has an
	// answer other than silence.
	if _, err := tx.Exec(ctx,
		`INSERT INTO webhook_deliveries(
			id, project_id, environment_id, webhook_event_id, webhook_destination_id,
			status, skipped_reason, attempt_count, max_attempts, next_attempt_at,
			created_at, updated_at, completed_at)
		 SELECT 'whdl_' || md5(e.id || ':' || d.id), e.project_id, e.environment_id, e.id, d.id,
		        CASE WHEN d.status = 'active' AND e.event_type = ANY(d.event_types)
		             THEN 'pending' ELSE 'skipped' END,
		        CASE WHEN d.status = 'active' AND e.event_type = ANY(d.event_types) THEN NULL
		             WHEN d.status <> 'active' THEN 'destination_disabled'
		             ELSE 'event_type_not_enabled' END,
		        0, $3::integer,
		        -- The casts are load-bearing: inside a CASE whose other arm is
		        -- NULL, an uncast parameter is inferred as text and the insert
		        -- fails against a timestamptz column.
		        CASE WHEN d.status = 'active' AND e.event_type = ANY(d.event_types) THEN $2::timestamptz ELSE NULL END,
		        $2::timestamptz, $2::timestamptz,
		        CASE WHEN d.status = 'active' AND e.event_type = ANY(d.event_types) THEN NULL ELSE $2::timestamptz END
		 FROM webhook_events e
		 JOIN webhook_destinations d
		   ON d.project_id = e.project_id AND d.environment_id = e.environment_id
		 WHERE e.id = $1
		 ON CONFLICT (webhook_event_id, webhook_destination_id) DO NOTHING`,
		eventID, now, billingwebhook.DefaultMaxAttempts); err != nil {
		return translate(err, "expand webhook event into deliveries")
	}

	// A skip is a recorded attempt, not an absence of one. The delivery
	// contract's attempt record has a `skipped` status precisely so this shows
	// up in attempt history rather than only as a delivery status.
	if _, err := tx.Exec(ctx,
		`INSERT INTO webhook_delivery_attempts(
			id, project_id, webhook_event_id, webhook_destination_id, webhook_delivery_id,
			attempt_number, max_attempts, outcome, skipped_reason, attempted_at)
		 SELECT 'wha_' || md5(dl.id || ':1'), dl.project_id, dl.webhook_event_id,
		        dl.webhook_destination_id, dl.id, 1, dl.max_attempts, 'skipped',
		        dl.skipped_reason, $2
		 FROM webhook_deliveries dl
		 WHERE dl.webhook_event_id = $1 AND dl.status = 'skipped'
		 ON CONFLICT (webhook_event_id, webhook_destination_id, attempt_number) DO NOTHING`,
		eventID, now); err != nil {
		return translate(err, "record skipped webhook attempts")
	}

	if _, err := tx.Exec(ctx,
		`INSERT INTO webhook_event_fanouts(webhook_event_id, project_id, delivery_count, skipped_count, fanned_out_at)
		 SELECT $1, $2,
		        count(*) FILTER (WHERE dl.status <> 'skipped'),
		        count(*) FILTER (WHERE dl.status = 'skipped'),
		        $3
		 FROM webhook_deliveries dl WHERE dl.webhook_event_id = $1
		 ON CONFLICT (webhook_event_id) DO NOTHING`,
		eventID, projectID, now); err != nil {
		return translate(err, "mark webhook event fanned out")
	}
	return tx.Commit(ctx)
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

// LeaseDelivery claims one due delivery.
//
// The claim commits before this returns. Everything the attempt needs — the
// destination row, the stored body, the organization, and every signing secret
// still permitted to sign — is read afterwards, outside the transaction: a
// delivery that takes twenty seconds against a slow destination must not hold
// a row lock for twenty seconds.
func (r *Repository) LeaseDelivery(ctx context.Context, workerID string, now, leaseUntil time.Time) (billingwebhook.LeasedDelivery, bool, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return billingwebhook.LeasedDelivery{}, false, fmt.Errorf("begin webhook delivery lease: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var delivery billingwebhook.Delivery
	err = tx.QueryRow(ctx,
		`SELECT id, project_id, environment_id, webhook_event_id, webhook_destination_id,
		        attempt_count, max_attempts, created_at, updated_at
		 FROM webhook_deliveries
		 WHERE status = 'pending' AND next_attempt_at <= $1
		   AND (leased_until IS NULL OR leased_until <= $1)
		   AND attempt_count < max_attempts
		 ORDER BY next_attempt_at, id
		 FOR UPDATE SKIP LOCKED LIMIT 1`, now).
		Scan(&delivery.ID, &delivery.ProjectID, &delivery.EnvironmentID, &delivery.EventID,
			&delivery.DestinationID, &delivery.AttemptCount, &delivery.MaxAttempts,
			&delivery.CreatedAt, &delivery.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return billingwebhook.LeasedDelivery{}, false, nil
	}
	if err != nil {
		return billingwebhook.LeasedDelivery{}, false, fmt.Errorf("select webhook delivery: %w", err)
	}
	// attempt_count advances at claim time, not at completion. A worker that
	// dies mid-request has still consumed an attempt, which is what stops a
	// destination that reliably kills workers from being retried forever.
	if _, err := tx.Exec(ctx,
		`UPDATE webhook_deliveries
		 SET leased_by = $2, leased_until = $3, attempt_count = attempt_count + 1, updated_at = $4
		 WHERE id = $1`, delivery.ID, workerID, leaseUntil, now); err != nil {
		return billingwebhook.LeasedDelivery{}, false, fmt.Errorf("lease webhook delivery: %w", err)
	}
	delivery.AttemptCount++
	delivery.Status = billingwebhook.DeliveryPending
	if err := tx.Commit(ctx); err != nil {
		return billingwebhook.LeasedDelivery{}, false, fmt.Errorf("commit webhook delivery lease: %w", err)
	}

	leased := billingwebhook.LeasedDelivery{Delivery: delivery}
	if err := r.pool.QueryRow(ctx,
		`SELECT e.event_type, e.payload::text, p.organization_id
		 FROM webhook_events e JOIN projects p ON p.id = e.project_id
		 WHERE e.id = $1 AND e.project_id = $2`, delivery.EventID, delivery.ProjectID).
		Scan(&leased.EventType, &leased.Body, &leased.OrganizationID); err != nil {
		return billingwebhook.LeasedDelivery{}, false, fmt.Errorf("read webhook event body: %w", err)
	}
	destination, err := r.Destination(ctx, delivery.ProjectID, delivery.DestinationID)
	if err != nil {
		return billingwebhook.LeasedDelivery{}, false, err
	}
	leased.Destination = destination

	secrets, err := r.signingSecrets(ctx, delivery.ProjectID, delivery.DestinationID, now)
	if err != nil {
		return billingwebhook.LeasedDelivery{}, false, err
	}
	leased.Secrets = secrets
	return leased, true, nil
}

// signingSecrets reads every secret still permitted to sign: the active ones,
// plus retired ones whose overlap window has not lapsed.
func (r *Repository) signingSecrets(ctx context.Context, projectID, destinationID string, now time.Time) ([]billingwebhook.StoredSecret, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, status, envelope_version, algorithm, key_id, nonce, ciphertext, fingerprint, honored_until
		 FROM webhook_signing_secrets
		 WHERE webhook_destination_id = $1 AND project_id = $2
		   AND (status = 'active' OR honored_until > $3)
		 ORDER BY status, created_at DESC, id`, destinationID, projectID, now)
	if err != nil {
		return nil, fmt.Errorf("read webhook signing secrets: %w", err)
	}
	defer rows.Close()

	secrets := make([]billingwebhook.StoredSecret, 0, 2)
	for rows.Next() {
		var secret billingwebhook.StoredSecret
		if err := rows.Scan(&secret.ID, &secret.Status, &secret.EnvelopeVersion, &secret.Algorithm,
			&secret.KeyID, &secret.Nonce, &secret.Ciphertext, &secret.Fingerprint,
			&secret.HonoredUntil); err != nil {
			return nil, fmt.Errorf("scan webhook signing secret: %w", err)
		}
		secrets = append(secrets, secret)
	}
	return secrets, rows.Err()
}

// CompleteAttempt appends the attempt and applies the resulting delivery state
// in one transaction, then reports the destination's consecutive failure count.
func (r *Repository) CompleteAttempt(ctx context.Context, result billingwebhook.AttemptResult) (int, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("begin webhook attempt completion: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	attemptID := "wha_" + shortHash(result.Delivery.ID, result.AttemptNumber)
	if _, err := tx.Exec(ctx,
		`INSERT INTO webhook_delivery_attempts(
			id, project_id, webhook_event_id, webhook_destination_id, webhook_delivery_id,
			attempt_number, max_attempts, outcome, response_status, error_code, latency_ms,
			attempted_at, responded_at, next_attempt_at, response_excerpt, skipped_reason)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULLIF($10,''),$11,$12,$13,$14,NULLIF($15,''),NULLIF($16,''))
		 ON CONFLICT (webhook_event_id, webhook_destination_id, attempt_number) DO NOTHING`,
		attemptID, result.Delivery.ProjectID, result.Delivery.EventID, result.Delivery.DestinationID,
		result.Delivery.ID, result.AttemptNumber, result.Delivery.MaxAttempts, result.Outcome,
		result.ResponseStatus, result.ErrorCode, nullableInt(result.LatencyMS),
		result.AttemptedAt, result.RespondedAt, result.NextAttemptAt,
		result.ResponseExcerpt, result.SkippedReason); err != nil {
		return 0, translate(err, "insert webhook delivery attempt")
	}

	// The lease is released in the same statement that records the outcome, so
	// a delivery is never left leased to a worker that has already finished
	// with it.
	settled := result.AttemptedAt
	if result.RespondedAt != nil {
		settled = *result.RespondedAt
	}
	if _, err := tx.Exec(ctx,
		`UPDATE webhook_deliveries
		 SET status = $3, skipped_reason = NULLIF($4,''), next_attempt_at = $5,
		     completed_at = $6, leased_by = NULL, leased_until = NULL, updated_at = $7
		 WHERE id = $1 AND project_id = $2`,
		result.Delivery.ID, result.Delivery.ProjectID, result.Status, result.SkippedReason,
		result.NextAttemptAt, result.CompletedAt, settled); err != nil {
		return 0, translate(err, "update webhook delivery")
	}

	failures := 0
	switch {
	case result.ResetDestinationFailures:
		if err := tx.QueryRow(ctx,
			`UPDATE webhook_destinations SET consecutive_failure_count = 0, updated_at = $3
			 WHERE id = $1 AND project_id = $2
			 RETURNING consecutive_failure_count`,
			result.Delivery.DestinationID, result.Delivery.ProjectID, settled).
			Scan(&failures); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return 0, translate(err, "reset webhook destination failures")
		}
	case result.IncrementDestinationFailures:
		if err := tx.QueryRow(ctx,
			`UPDATE webhook_destinations
			 SET consecutive_failure_count = consecutive_failure_count + 1, updated_at = $3
			 WHERE id = $1 AND project_id = $2
			 RETURNING consecutive_failure_count`,
			result.Delivery.DestinationID, result.Delivery.ProjectID, settled).
			Scan(&failures); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return 0, translate(err, "increment webhook destination failures")
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("commit webhook attempt completion: %w", err)
	}
	return failures, nil
}

const deliveryColumns = `id, project_id, environment_id, webhook_event_id, webhook_destination_id,
	status, coalesce(skipped_reason, ''), attempt_count, max_attempts, next_attempt_at,
	created_at, updated_at, completed_at`

func scanDelivery(row pgx.Row) (billingwebhook.Delivery, error) {
	var delivery billingwebhook.Delivery
	err := row.Scan(&delivery.ID, &delivery.ProjectID, &delivery.EnvironmentID, &delivery.EventID,
		&delivery.DestinationID, &delivery.Status, &delivery.SkippedReason, &delivery.AttemptCount,
		&delivery.MaxAttempts, &delivery.NextAttemptAt, &delivery.CreatedAt, &delivery.UpdatedAt,
		&delivery.CompletedAt)
	return delivery, err
}

func (r *Repository) ListDeliveries(ctx context.Context, projectID string, filter billingwebhook.DeliveryFilter) ([]billingwebhook.Delivery, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+deliveryColumns+` FROM webhook_deliveries
		 WHERE project_id = $1
		   AND ($2 = '' OR environment_id = $2)
		   AND ($3 = '' OR webhook_event_id = $3)
		   AND ($4 = '' OR webhook_destination_id = $4)
		   AND ($5 = '' OR status = $5)
		 ORDER BY created_at DESC, id
		 LIMIT $6`,
		projectID, filter.EnvironmentID, filter.EventID, filter.DestinationID, filter.Status, filter.Limit)
	if err != nil {
		return nil, fmt.Errorf("list webhook deliveries: %w", err)
	}
	defer rows.Close()

	deliveries := make([]billingwebhook.Delivery, 0, filter.Limit)
	for rows.Next() {
		delivery, err := scanDelivery(rows)
		if err != nil {
			return nil, fmt.Errorf("scan webhook delivery: %w", err)
		}
		deliveries = append(deliveries, delivery)
	}
	return deliveries, rows.Err()
}

func (r *Repository) Delivery(ctx context.Context, projectID, deliveryID string) (billingwebhook.Delivery, error) {
	delivery, err := scanDelivery(r.pool.QueryRow(ctx,
		`SELECT `+deliveryColumns+` FROM webhook_deliveries WHERE id = $1 AND project_id = $2`,
		deliveryID, projectID))
	if errors.Is(err, pgx.ErrNoRows) {
		return billingwebhook.Delivery{}, billingwebhook.ErrNotFound
	}
	if err != nil {
		return billingwebhook.Delivery{}, fmt.Errorf("read webhook delivery: %w", err)
	}
	return delivery, nil
}

func (r *Repository) ListAttempts(ctx context.Context, projectID, deliveryID string) ([]billingwebhook.Attempt, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, webhook_delivery_id, webhook_event_id, webhook_destination_id, attempt_number,
		        max_attempts, outcome, response_status, coalesce(error_code, ''), latency_ms,
		        coalesce(response_excerpt, ''), coalesce(skipped_reason, ''),
		        attempted_at, responded_at, next_attempt_at
		 FROM webhook_delivery_attempts
		 WHERE webhook_delivery_id = $1 AND project_id = $2
		 ORDER BY attempt_number`, deliveryID, projectID)
	if err != nil {
		return nil, fmt.Errorf("list webhook delivery attempts: %w", err)
	}
	defer rows.Close()

	attempts := make([]billingwebhook.Attempt, 0, 8)
	for rows.Next() {
		var attempt billingwebhook.Attempt
		if err := rows.Scan(&attempt.ID, &attempt.DeliveryID, &attempt.EventID, &attempt.DestinationID,
			&attempt.AttemptNumber, &attempt.MaxAttempts, &attempt.Outcome, &attempt.ResponseStatus,
			&attempt.ErrorCode, &attempt.LatencyMS, &attempt.ResponseExcerpt, &attempt.SkippedReason,
			&attempt.AttemptedAt, &attempt.RespondedAt, &attempt.NextAttemptAt); err != nil {
			return nil, fmt.Errorf("scan webhook delivery attempt: %w", err)
		}
		attempts = append(attempts, attempt)
	}
	return attempts, rows.Err()
}

// ReplayDelivery re-queues a terminal delivery with a fresh attempt budget.
//
// attempt_count is deliberately not reset. Attempt numbers are unique per
// delivery, so restarting the count would collide with the history already
// recorded and the replay's own attempt would be silently discarded; extending
// the budget instead keeps every attempt distinct and makes a replayed delivery
// readable as one continuous history.
func (r *Repository) ReplayDelivery(ctx context.Context, projectID, deliveryID, actorID string, now time.Time) (billingwebhook.Delivery, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return billingwebhook.Delivery{}, fmt.Errorf("begin webhook delivery replay: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	existing, err := scanDelivery(tx.QueryRow(ctx,
		`SELECT `+deliveryColumns+` FROM webhook_deliveries WHERE id = $1 AND project_id = $2 FOR UPDATE`,
		deliveryID, projectID))
	if errors.Is(err, pgx.ErrNoRows) {
		return billingwebhook.Delivery{}, billingwebhook.ErrNotFound
	}
	if err != nil {
		return billingwebhook.Delivery{}, fmt.Errorf("read webhook delivery for replay: %w", err)
	}
	// Replaying a delivery that is still queued would double-send it.
	if existing.Status == billingwebhook.DeliveryPending ||
		existing.AttemptCount >= billingwebhook.MaxAttemptsCeiling {
		return billingwebhook.Delivery{}, billingwebhook.ErrConflict
	}

	if _, err := tx.Exec(ctx,
		`UPDATE webhook_deliveries
		 SET status = 'pending', skipped_reason = NULL, next_attempt_at = $3, completed_at = NULL,
		     max_attempts = LEAST($4, attempt_count + $5), leased_by = NULL, leased_until = NULL,
		     updated_at = $3
		 WHERE id = $1 AND project_id = $2`,
		deliveryID, projectID, now, billingwebhook.MaxAttemptsCeiling, billingwebhook.DefaultMaxAttempts); err != nil {
		return billingwebhook.Delivery{}, translate(err, "replay webhook delivery")
	}
	if err := recordAudit(ctx, tx, projectID, existing.EnvironmentID, actorID,
		"billing.webhook.delivery.replayed", deliveryID,
		map[string]string{"eventId": existing.EventID, "destinationId": existing.DestinationID}, now); err != nil {
		return billingwebhook.Delivery{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return billingwebhook.Delivery{}, fmt.Errorf("commit webhook delivery replay: %w", err)
	}
	return r.Delivery(ctx, projectID, deliveryID)
}

// ---------------------------------------------------------------------------
// Audit and helpers
// ---------------------------------------------------------------------------

func (r *Repository) RecordAudit(ctx context.Context, projectID, environmentID, actorID, action, resourceID string,
	metadata map[string]string, at time.Time) error {

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin webhook audit write: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := recordAudit(ctx, tx, projectID, environmentID, actorID, action, resourceID, metadata, at); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func recordAudit(ctx context.Context, tx pgx.Tx, projectID, environmentID, actorID, action, resourceID string,
	metadata map[string]string, at time.Time) error {

	var organizationID string
	if err := tx.QueryRow(ctx, `SELECT organization_id FROM projects WHERE id = $1`, projectID).
		Scan(&organizationID); err != nil {
		return fmt.Errorf("read organization for webhook audit: %w", err)
	}
	encoded := []byte("{}")
	if len(metadata) > 0 {
		// Metadata is a fixed, Mosaic-authored map of identifiers and codes. No
		// caller-supplied URL, secret, or response body ever reaches it.
		var builder strings.Builder
		builder.WriteByte('{')
		first := true
		for key, value := range metadata {
			if !first {
				builder.WriteByte(',')
			}
			first = false
			builder.WriteString(quoteJSON(key))
			builder.WriteByte(':')
			builder.WriteString(quoteJSON(value))
		}
		builder.WriteByte('}')
		encoded = []byte(builder.String())
	}
	actor := actorID
	if actor == "" {
		actor = "system"
	}
	id := "aud_" + shortHash(resourceID+":"+action, int(at.UnixNano()%1_000_000_000))
	_, err := tx.Exec(ctx,
		`INSERT INTO audit_events(id, actor_id, organization_id, project_id, environment_id,
			action, resource_type, resource_id, metadata, created_at)
		 VALUES ($1,$2,$3,$4,NULLIF($5,''),$6,'webhook_destination',$7,$8,$9)
		 ON CONFLICT (id) DO NOTHING`,
		id, actor, organizationID, projectID, environmentID, action, resourceID, encoded, at)
	if err != nil {
		return fmt.Errorf("insert webhook audit event: %w", err)
	}
	return nil
}

// quoteJSON renders a JSON string. Audit metadata is a small map of
// Mosaic-owned keys and identifier values, so this avoids pulling a marshaller
// into the transaction path for two-key maps.
func quoteJSON(value string) string {
	var builder strings.Builder
	builder.WriteByte('"')
	for _, character := range value {
		switch character {
		case '"':
			builder.WriteString(`\"`)
		case '\\':
			builder.WriteString(`\\`)
		default:
			if character < 0x20 {
				continue
			}
			builder.WriteRune(character)
		}
	}
	builder.WriteByte('"')
	return builder.String()
}

func environmentOf(ctx context.Context, tx pgx.Tx, projectID, destinationID string) (string, error) {
	var environmentID string
	err := tx.QueryRow(ctx,
		`SELECT environment_id FROM webhook_destinations WHERE id = $1 AND project_id = $2`,
		destinationID, projectID).Scan(&environmentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", billingwebhook.ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("read webhook destination environment: %w", err)
	}
	return environmentID, nil
}

func nullableArray(values []string) any {
	if values == nil {
		return nil
	}
	return values
}

func nullableInt(value int) any {
	if value < 0 {
		return nil
	}
	return value
}

// shortHash builds a deterministic identifier suffix. Determinism is what makes
// the attempt insert idempotent under an ON CONFLICT retry.
func shortHash(value string, discriminator int) string {
	seed := fmt.Sprintf("%s:%d", value, discriminator)
	sum := uint64(1469598103934665603)
	for index := 0; index < len(seed); index++ {
		sum ^= uint64(seed[index])
		sum *= 1099511628211
	}
	encoded := make([]byte, 8)
	for index := 0; index < 8; index++ {
		encoded[index] = byte(sum >> (index * 8))
	}
	return base64.RawURLEncoding.EncodeToString(encoded)
}

// translate maps the constraint violations this package can provoke onto stable
// domain errors, so no SQL error text ever reaches a handler.
func translate(err error, operation string) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23503", "23514":
			// Foreign key or check violation: the caller asked for a state the
			// schema does not permit.
			return billingwebhook.ErrConflict
		case "23505":
			return billingwebhook.ErrConflict
		case "55000":
			// An append-only trigger refused a rewrite of recorded history.
			return billingwebhook.ErrConflict
		}
	}
	return fmt.Errorf("%s: %w", operation, err)
}
