// Package billingdiagnosticspostgres is the PostgreSQL implementation of the
// Phase 9B projection health port.
//
// Every number this package produces is a count or a timestamp read straight
// from the tables that hold the state. Nothing is inferred from a queue gauge:
// a gauge reports what was enqueued, and the failure this surface exists to
// make visible is precisely the one where an enqueue never happened.
package billingdiagnosticspostgres

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingdiagnostics"
)

type Repository struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

var _ billingdiagnostics.Repository = (*Repository)(nil)

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

// requireRole resolves the actor's organization role for the Project.
//
// Absent membership is reported as not-found rather than forbidden, matching
// every other Mosaic surface: telling a caller that a Project exists but is not
// theirs is an existence oracle over other tenants' Projects.
func (r *Repository) requireRole(ctx context.Context, actor billingdiagnostics.Actor, projectID string) error {
	if strings.TrimSpace(actor.ID) == "" {
		return billingdiagnostics.ErrUnauthenticated
	}
	var role string
	err := r.pool.QueryRow(ctx,
		`SELECT m.role FROM projects p
		 JOIN organization_members m ON m.organization_id = p.organization_id
		 WHERE p.id = $1 AND m.actor_id = $2`, projectID, actor.ID).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		return billingdiagnostics.ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("resolve projection health role: %w", err)
	}
	switch role {
	case "owner", "admin":
		return nil
	default:
		return billingdiagnostics.ErrForbidden
	}
}

// ProjectionHealth reads the whole summary.
//
// It is deliberately one round trip. The counts are read together so they
// describe one instant: an operator comparing "backlog" against "stale
// customers" across two statements would be comparing two different moments,
// and during an incident those are exactly the two numbers being compared.
func (r *Repository) ProjectionHealth(ctx context.Context, actor billingdiagnostics.Actor,
	projectID, environmentID string) (billingdiagnostics.ProjectionHealth, error) {

	if err := r.requireRole(ctx, actor, projectID); err != nil {
		return billingdiagnostics.ProjectionHealth{}, err
	}
	var exists bool
	err := r.pool.QueryRow(ctx,
		`SELECT true FROM environments WHERE id=$1 AND project_id=$2`, environmentID, projectID).Scan(&exists)
	if errors.Is(err, pgx.ErrNoRows) {
		return billingdiagnostics.ProjectionHealth{}, billingdiagnostics.ErrNotFound
	}
	if err != nil {
		return billingdiagnostics.ProjectionHealth{}, fmt.Errorf("resolve projection health environment: %w", err)
	}

	health := billingdiagnostics.ProjectionHealth{
		EnvironmentID: environmentID,
		ObservedAt:    time.Now().UTC(),
	}
	enabled, err := r.BillingEnabled(ctx, projectID)
	if err != nil {
		return billingdiagnostics.ProjectionHealth{}, err
	}
	health.BillingEnabled = enabled

	staleBefore := health.ObservedAt.Add(-billingdiagnostics.StaleAfter)
	failuresSince := health.ObservedAt.Add(-time.Hour)

	err = r.pool.QueryRow(ctx,
		`SELECT
			(SELECT COALESCE(max(version),0) FROM projection_rule_versions WHERE status='active'),
			(SELECT count(*) FROM projection_rule_versions),

			(SELECT count(*) FROM projection_jobs
			   WHERE environment_id=$1 AND status IN ('queued','leased')),
			(SELECT COALESCE(max(extract(epoch from (now()-created_at))),0) FROM projection_jobs
			   WHERE environment_id=$1 AND status IN ('queued','leased')),
			(SELECT count(*) FROM projection_jobs WHERE environment_id=$1 AND status='failed'),
			(SELECT count(*) FROM projection_attempts a
			   JOIN projection_jobs j ON j.id = a.projection_job_id
			   WHERE j.environment_id=$1 AND a.outcome='failed' AND a.completed_at >= $3),

			-- A customer is Project-scoped but its committed state is per
			-- Environment, so staleness is asked of the pointer, not the customer.
			(SELECT count(*) FROM customer_entitlement_pointers
			   WHERE environment_id=$1 AND updated_at < $2),
			(SELECT count(*) FROM billing_customers c
			   WHERE c.project_id=$4 AND c.last_projected_at IS NULL),

			(SELECT count(*) FROM billing_identity_conflicts
			   WHERE project_id=$4 AND status='open'),
			(SELECT count(*) FROM purchase_lineages
			   WHERE environment_id=$1 AND projection_frozen),
			(SELECT count(*) FROM purchase_lineages
			   WHERE environment_id=$1
			     AND (billing_customer_id IS NULL
			          OR diagnostic_status IN ('identity_unresolved','product_unresolved'))),

			-- Unknown entries on the *current* snapshot only: historical
			-- snapshots record what was true then and are not an open problem.
			(SELECT count(*) FROM customer_entitlement_snapshot_entries e
			   JOIN customer_entitlement_pointers p
			     ON p.current_snapshot_id = e.customer_entitlement_snapshot_id
			   WHERE p.environment_id=$1 AND e.state='unknown'),

			(SELECT count(*) FROM restore_sync_jobs
			   WHERE environment_id=$1 AND status IN ('queued','leased')),
			(SELECT count(*) FROM restore_sync_jobs
			   WHERE environment_id=$1 AND status='failed'),
			(SELECT count(*) FROM webhook_deliveries
			   WHERE environment_id=$1 AND status='pending'),
			(SELECT count(*) FROM webhook_deliveries
			   WHERE environment_id=$1 AND status='exhausted'),
			(SELECT count(*) FROM webhook_destinations
			   WHERE environment_id=$1 AND status='active'),

			(SELECT max(created_at) FROM customer_entitlement_snapshots WHERE environment_id=$1)`,
		environmentID, staleBefore, failuresSince, projectID).
		Scan(&health.ActiveRuleVersion, &health.RuleVersionCount,
			&health.ProjectionQueueDepth, &health.ProjectionOldestAgeSecs,
			&health.ProjectionFailedJobs, &health.ProjectionFailuresLastHour,
			&health.StaleCustomers, &health.NeverProjectedCustomers,
			&health.OpenIdentityConflicts, &health.FrozenLineages, &health.UnresolvedLineages,
			&health.UnknownEntitlementEntries,
			&health.RestoreBacklog, &health.RestoreFailedJobs,
			&health.WebhookBacklog, &health.WebhookExhausted, &health.WebhookDestinations,
			&health.LastProjectionCommittedAt)
	if err != nil {
		return billingdiagnostics.ProjectionHealth{}, fmt.Errorf("read projection health: %w", err)
	}
	if health.LastProjectionCommittedAt != nil {
		utc := health.LastProjectionCommittedAt.UTC()
		health.LastProjectionCommittedAt = &utc
	}
	return health, nil
}

// AuthorizeReplay guards the one state change this package can trigger.
//
// It is deliberately a separate method from the health authorization rather
// than a shared helper with a boolean: a reader and a writer of the same
// resource should not share one permission check, because widening the read
// later would silently widen the write.
func (r *Repository) AuthorizeReplay(ctx context.Context, actor billingdiagnostics.Actor,
	projectID, environmentID string) error {

	if err := r.requireRole(ctx, actor, projectID); err != nil {
		return err
	}
	var exists bool
	err := r.pool.QueryRow(ctx,
		`SELECT true FROM environments WHERE id=$1 AND project_id=$2`, environmentID, projectID).Scan(&exists)
	if errors.Is(err, pgx.ErrNoRows) {
		return billingdiagnostics.ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("resolve replay environment: %w", err)
	}
	return nil
}

// RecordReplayAudit records that a replay ran and what it moved.
//
// The count of changed scopes is on the audit entry rather than only in the
// response, because the response is seen once by the operator who asked and the
// audit trail is what an investigation reads months later — and "a replay ran
// and changed nothing" and "a replay ran and rewrote four hundred customers"
// are the two answers such an investigation is actually asking about.
func (r *Repository) RecordReplayAudit(ctx context.Context, actor billingdiagnostics.Actor,
	projectID, environmentID string, ruleVersion, scopes, changed int, now time.Time) error {

	var organizationID string
	if err := r.pool.QueryRow(ctx, `SELECT organization_id FROM projects WHERE id=$1`, projectID).
		Scan(&organizationID); err != nil {
		return fmt.Errorf("read organization for replay audit: %w", err)
	}
	metadata, err := json.Marshal(map[string]any{
		"projectionRuleVersion": ruleVersion,
		"scopesReplayed":        scopes,
		"scopesChanged":         changed,
	})
	if err != nil {
		return fmt.Errorf("encode replay audit metadata: %w", err)
	}
	_, err = r.pool.Exec(ctx,
		`INSERT INTO audit_events(id, actor_id, organization_id, project_id, environment_id,
			action, resource_type, resource_id, metadata, created_at)
		 VALUES ($1,$2,$3,$4,$5,'billing.projection.replayed','billing_projection',$5,$6,$7)`,
		"aud_"+auditID(projectID, environmentID, now), actor.ID, organizationID, projectID,
		environmentID, metadata, now)
	if err != nil {
		return fmt.Errorf("insert replay audit event: %w", err)
	}
	return nil
}

func auditID(parts ...any) string {
	hasher := sha256.New()
	for _, part := range parts {
		fmt.Fprintf(hasher, "%v\x00", part)
	}
	return fmt.Sprintf("%x", hasher.Sum(nil))[:24]
}
