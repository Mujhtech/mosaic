// Package billingoperatorpostgres is the PostgreSQL read model behind Mosaic's
// Phase 9B operator surface.
//
// Every statement in this file is a SELECT. There is no INSERT, no UPDATE, and
// no DELETE anywhere in the package, which is what makes "the operator lookup
// cannot mint a customer" a property of the code rather than a promise about
// it: the trusted identify path is create-or-get, and reusing it as a search
// would create one Billing Customer per mistyped support query.
package billingoperatorpostgres

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingoperator"
)

type Repository struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

var _ billingoperator.Repository = (*Repository)(nil)

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

// AuthorizeProject resolves the actor's organization role for the Project and
// requires owner or admin.
//
// Absent membership is reported as not-found rather than forbidden, matching
// every other Mosaic surface: telling a caller that a Project exists but is not
// theirs is an existence oracle over other tenants' Projects. Billing customer
// state is the most sensitive read surface Mosaic has — it names who bought
// what — so it sits at the same role bar as the 9A ledger and quarantine pages
// rather than at plain membership.
func (r *Repository) AuthorizeProject(ctx context.Context, actor billingoperator.Actor, projectID string) error {
	if strings.TrimSpace(actor.ID) == "" {
		return billingoperator.ErrUnauthenticated
	}
	var role string
	err := r.pool.QueryRow(ctx,
		`SELECT m.role FROM projects p
		 JOIN organization_members m ON m.organization_id = p.organization_id
		 WHERE p.id = $1 AND m.actor_id = $2`, projectID, actor.ID).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		return billingoperator.ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("resolve billing operator role: %w", err)
	}
	switch role {
	case "owner", "admin":
		return nil
	default:
		return billingoperator.ErrForbidden
	}
}

// Authorize adds the Environment containment check.
//
// The Environment must belong to the Project named in the route. Without this,
// a member of Project A could read Project B's Environment by pairing their own
// projectId with B's environmentId — the role check would pass and every
// subsequent query, which filters on environment_id, would answer about B.
func (r *Repository) Authorize(ctx context.Context, actor billingoperator.Actor, projectID, environmentID string) error {
	if err := r.AuthorizeProject(ctx, actor, projectID); err != nil {
		return err
	}
	var exists bool
	err := r.pool.QueryRow(ctx,
		`SELECT true FROM environments WHERE id=$1 AND project_id=$2`, environmentID, projectID).Scan(&exists)
	if errors.Is(err, pgx.ErrNoRows) {
		return billingoperator.ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("resolve billing operator environment: %w", err)
	}
	return nil
}

func (r *Repository) BillingEnabled(ctx context.Context, projectID string) (bool, error) {
	var enabled bool
	err := r.pool.QueryRow(ctx,
		`SELECT billing_enabled FROM billing_project_settings WHERE project_id = $1`, projectID).Scan(&enabled)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("read billing enablement: %w", err)
	}
	return enabled, nil
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

// CustomerIDForAliasDigest resolves the single active alias resolution for a
// digest. It reads the same partial unique index the attach path writes
// against, so a lookup and an attachment can never disagree about who holds an
// identifier.
func (r *Repository) CustomerIDForAliasDigest(ctx context.Context, projectID, aliasType string, digest []byte) (string, error) {
	var customerID string
	err := r.pool.QueryRow(ctx,
		`SELECT billing_customer_id FROM billing_customer_aliases
		 WHERE project_id=$1 AND alias_type=$2 AND alias_digest=$3 AND effective_end IS NULL`,
		projectID, aliasType, digest).Scan(&customerID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", billingoperator.ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("resolve customer for alias digest: %w", err)
	}
	return customerID, nil
}

// CustomerIDForInstallationDigest resolves an installation identifier through
// association evidence.
//
// There is no alias resolution to read: an installation id is recorded as
// evidence and never anchors or selects a customer (plan §5a rule 2a, OD-4(a)).
// Reading the evidence backwards for a support lookup is a read of recorded
// history by an authorized operator, which is a different act from letting a
// client-asserted identifier select a customer at request time — and the two
// stay different because this method exists only behind the operator
// authorization above.
//
// The most recent resolving observation wins. Evidence is append-only, so an
// installation that was later seen against a different customer (a shared
// device, a reinstall) has both rows, and the newest is the one an operator is
// asking about.
func (r *Repository) CustomerIDForInstallationDigest(ctx context.Context, projectID string, digest []byte) (string, error) {
	var customerID string
	err := r.pool.QueryRow(ctx,
		`SELECT billing_customer_id FROM billing_association_evidence
		 WHERE project_id=$1 AND evidence_type='installation_observation'
		   AND evidence_digest=$2 AND billing_customer_id IS NOT NULL
		 ORDER BY observed_at DESC, id
		 LIMIT 1`, projectID, digest).Scan(&customerID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", billingoperator.ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("resolve customer for installation evidence: %w", err)
	}
	return customerID, nil
}

// ---------------------------------------------------------------------------
// Customer list and summary
// ---------------------------------------------------------------------------

// summarySelect is the shared projection behind the list and the single
// summary, so the customer header on the detail page cannot disagree with the
// row the operator clicked.
//
// `identified` is the presence of an active application-user alias, which is
// the only alias family a person's own backend asserts. `purchase_anchored` is
// the presence of a lineage in this Environment. The two are computed
// separately because a customer can be both, either, or neither, and the ones
// that are exactly one are the interesting ones (plan §5a).
const summarySelect = `
	SELECT c.id, c.project_id, c.status, c.diagnostics_status,
	       c.current_projection_version, c.last_projected_at, c.created_at, c.updated_at,
	       EXISTS (SELECT 1 FROM billing_customer_aliases a
	                WHERE a.billing_customer_id = c.id AND a.project_id = c.project_id
	                  AND a.alias_type = 'application_user_id' AND a.effective_end IS NULL) AS identified,
	       EXISTS (SELECT 1 FROM purchase_lineages l
	                WHERE l.billing_customer_id = c.id AND l.environment_id = $2) AS purchase_anchored,
	       EXISTS (SELECT 1 FROM billing_identity_conflicts k
	                WHERE k.project_id = c.project_id AND k.status = 'open'
	                  AND (k.first_customer_id = c.id OR k.second_customer_id = c.id)) AS has_open_conflict,
	       (SELECT count(*) FROM purchase_lineages l
	         WHERE l.billing_customer_id = c.id AND l.environment_id = $2 AND l.projection_frozen) AS frozen_lineages,
	       p.snapshot_version, p.updated_at AS snapshot_updated_at
	  FROM billing_customers c
	  LEFT JOIN customer_entitlement_pointers p
	         ON p.billing_customer_id = c.id AND p.environment_id = $2`

func scanSummary(row pgx.Row, environmentID string) (billingoperator.CustomerSummary, error) {
	var summary billingoperator.CustomerSummary
	err := row.Scan(&summary.ID, &summary.ProjectID, &summary.Status, &summary.DiagnosticsStatus,
		&summary.CurrentProjectionVersion, &summary.LastProjectedAt, &summary.CreatedAt, &summary.UpdatedAt,
		&summary.Identified, &summary.PurchaseAnchored, &summary.HasOpenConflict, &summary.FrozenLineageCount,
		&summary.SnapshotVersion, &summary.SnapshotUpdatedAt)
	summary.EnvironmentID = environmentID
	summary.CreatedAt = summary.CreatedAt.UTC()
	summary.UpdatedAt = summary.UpdatedAt.UTC()
	summary.LastProjectedAt = utcOrNil(summary.LastProjectedAt)
	summary.SnapshotUpdatedAt = utcOrNil(summary.SnapshotUpdatedAt)
	return summary, err
}

func (r *Repository) CustomerSummary(ctx context.Context, projectID, environmentID, customerID string) (billingoperator.CustomerSummary, error) {
	summary, err := scanSummary(r.pool.QueryRow(ctx,
		summarySelect+` WHERE c.id = $3 AND c.project_id = $1`, projectID, environmentID, customerID), environmentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return billingoperator.CustomerSummary{}, billingoperator.ErrNotFound
	}
	if err != nil {
		return billingoperator.CustomerSummary{}, fmt.Errorf("read billing customer summary: %w", err)
	}
	return summary, nil
}

// ListCustomers pages the Environment's customers, newest first.
//
// The Environment predicate admits a customer that holds a pointer or a lineage
// here, and additionally a customer that holds a lineage in no Environment at
// all. That last clause is not a loophole: a customer created by a trusted
// identify and not yet party to any purchase belongs to the Project and to no
// Environment, and hiding it from every Environment list would make the
// customer an operator just created invisible.
//
// The ordering is (created_at DESC, id ASC) — exactly
// `billing_customers_project_idx` — so paging is an index scan rather than a
// sort. The keyset predicate is written out rather than as a row comparison
// because the two halves sort in opposite directions.
func (r *Repository) ListCustomers(ctx context.Context, projectID, environmentID string,
	filter billingoperator.CustomerFilter, limit int, cursor string) ([]billingoperator.CustomerSummary, string, error) {

	position := decodeCursor(cursor)
	identified := (*bool)(nil)
	if filter.Identified != nil {
		value := *filter.Identified
		identified = &value
	}
	rows, err := r.pool.Query(ctx, summarySelect+`
		 WHERE c.project_id = $1
		   AND (p.billing_customer_id IS NOT NULL
		        OR EXISTS (SELECT 1 FROM purchase_lineages l
		                    WHERE l.billing_customer_id = c.id AND l.environment_id = $2)
		        OR NOT EXISTS (SELECT 1 FROM purchase_lineages l
		                        WHERE l.billing_customer_id = c.id))
		   AND ($3::text = '' OR c.status = $3)
		   AND ($4::boolean IS NULL OR $4::boolean = EXISTS (
		           SELECT 1 FROM billing_customer_aliases a
		            WHERE a.billing_customer_id = c.id AND a.project_id = c.project_id
		              AND a.alias_type = 'application_user_id' AND a.effective_end IS NULL))
		   AND (NOT $5::boolean OR EXISTS (
		           SELECT 1 FROM billing_identity_conflicts k
		            WHERE k.project_id = c.project_id AND k.status = 'open'
		              AND (k.first_customer_id = c.id OR k.second_customer_id = c.id)))
		   AND ($6::timestamptz IS NULL
		        OR c.created_at < $6::timestamptz
		        OR (c.created_at = $6::timestamptz AND c.id > $7))
		 ORDER BY c.created_at DESC, c.id
		 LIMIT $8`,
		projectID, environmentID, filter.Status, identified, filter.ConflictedOnly,
		position.At, position.ID, limit+1)
	if err != nil {
		return nil, "", fmt.Errorf("list billing customers: %w", err)
	}
	defer rows.Close()

	customers := make([]billingoperator.CustomerSummary, 0, limit)
	for rows.Next() {
		summary, scanErr := scanSummary(rows, environmentID)
		if scanErr != nil {
			return nil, "", fmt.Errorf("scan billing customer summary: %w", scanErr)
		}
		customers = append(customers, summary)
	}
	if err := rows.Err(); err != nil {
		return nil, "", fmt.Errorf("read billing customers: %w", err)
	}
	next := ""
	if len(customers) > limit {
		customers = customers[:limit]
		last := customers[limit-1]
		next = encodeCursor(last.CreatedAt, last.ID)
	}
	return customers, next, nil
}

// ---------------------------------------------------------------------------
// Customer detail components
// ---------------------------------------------------------------------------

func (r *Repository) Lineages(ctx context.Context, projectID, environmentID, customerID string) ([]billingoperator.LineageView, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, environment_id, provider, store_environment, lineage_type,
		        projection_frozen, diagnostic_status, COALESCE(superseded_by_lineage_id,''),
		        created_at, updated_at
		   FROM purchase_lineages
		  WHERE project_id=$1 AND environment_id=$2 AND billing_customer_id=$3
		  ORDER BY created_at DESC, id
		  LIMIT 200`, projectID, environmentID, customerID)
	if err != nil {
		return nil, fmt.Errorf("list customer purchase lineages: %w", err)
	}
	defer rows.Close()
	lineages := make([]billingoperator.LineageView, 0, 4)
	for rows.Next() {
		var lineage billingoperator.LineageView
		if err := rows.Scan(&lineage.PurchaseLineageID, &lineage.EnvironmentID, &lineage.Provider,
			&lineage.StoreEnvironment, &lineage.LineageType, &lineage.ProjectionFrozen,
			&lineage.DiagnosticStatus, &lineage.SupersededByLineageID,
			&lineage.CreatedAt, &lineage.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan customer purchase lineage: %w", err)
		}
		lineage.CreatedAt, lineage.UpdatedAt = lineage.CreatedAt.UTC(), lineage.UpdatedAt.UTC()
		lineages = append(lineages, lineage)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read customer purchase lineages: %w", err)
	}
	return lineages, nil
}

func (r *Repository) OneTimePurchases(ctx context.Context, projectID, environmentID, customerID string) ([]billingoperator.OneTimePurchaseView, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, purchase_lineage_id, provider, COALESCE(mosaic_product_id,''),
		        COALESCE(provider_product_identifier,''), acquired_at, validity_state,
		        refund_effective_at, revocation_effective_at
		   FROM one_time_purchase_instances
		  WHERE project_id=$1 AND environment_id=$2 AND billing_customer_id=$3
		  ORDER BY acquired_at DESC, id
		  LIMIT 200`, projectID, environmentID, customerID)
	if err != nil {
		return nil, fmt.Errorf("list customer one-time purchases: %w", err)
	}
	defer rows.Close()
	purchases := make([]billingoperator.OneTimePurchaseView, 0, 4)
	for rows.Next() {
		var purchase billingoperator.OneTimePurchaseView
		if err := rows.Scan(&purchase.InstanceID, &purchase.PurchaseLineageID, &purchase.Provider,
			&purchase.MosaicProductID, &purchase.ProviderProductIdentifier, &purchase.AcquiredAt,
			&purchase.ValidityState, &purchase.RefundEffectiveAt, &purchase.RevocationEffectiveAt); err != nil {
			return nil, fmt.Errorf("scan customer one-time purchase: %w", err)
		}
		purchase.AcquiredAt = purchase.AcquiredAt.UTC()
		purchase.RefundEffectiveAt = utcOrNil(purchase.RefundEffectiveAt)
		purchase.RevocationEffectiveAt = utcOrNil(purchase.RevocationEffectiveAt)
		purchases = append(purchases, purchase)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read customer one-time purchases: %w", err)
	}
	return purchases, nil
}

// CustomerConflicts returns the conflicts this customer is party to, on either
// side. Both sides are returned because a customer is just as affected by
// losing a disputed purchase as by claiming one, and a page that showed only
// the claims would leave the losing customer's freeze unexplained.
//
// alias_digest is not selected. A column that is never read cannot leak into a
// response or a log line.
func (r *Repository) CustomerConflicts(ctx context.Context, projectID, customerID string) ([]billingoperator.ConflictView, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, project_id, conflict_scope, status, COALESCE(purchase_lineage_id,''),
		        COALESCE(alias_type,''), first_customer_id, second_customer_id,
		        COALESCE(detail->>'diagnosticCode',''), opened_at, resolved_at,
		        COALESCE(resolution_action,''), COALESCE(detail->>'resolutionReason','')
		   FROM billing_identity_conflicts
		  WHERE project_id=$1 AND ($2 IN (first_customer_id, second_customer_id))
		  ORDER BY opened_at DESC, id
		  LIMIT 100`, projectID, customerID)
	if err != nil {
		return nil, fmt.Errorf("list customer identity conflicts: %w", err)
	}
	defer rows.Close()
	conflicts := make([]billingoperator.ConflictView, 0, 2)
	for rows.Next() {
		var conflict billingoperator.ConflictView
		var storedAction string
		if err := rows.Scan(&conflict.ConflictID, &conflict.ProjectID, &conflict.Scope, &conflict.Status,
			&conflict.PurchaseLineageID, &conflict.AliasType, &conflict.FirstCustomerID,
			&conflict.SecondCustomerID, &conflict.DiagnosticCode, &conflict.OpenedAt,
			&conflict.ResolvedAt, &storedAction, &conflict.ResolutionReason); err != nil {
			return nil, fmt.Errorf("scan customer identity conflict: %w", err)
		}
		conflict.OpenedAt = conflict.OpenedAt.UTC()
		conflict.ResolvedAt = utcOrNil(conflict.ResolvedAt)
		conflict.ResolutionAction = billingoperator.OperatorAction(storedAction)
		conflicts = append(conflicts, conflict)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read customer identity conflicts: %w", err)
	}
	return conflicts, nil
}

// ---------------------------------------------------------------------------
// Restore and sync jobs
// ---------------------------------------------------------------------------

const restoreColumns = `id, environment_id, COALESCE(billing_customer_id,''), store_platform,
	status, COALESCE(outcome,''), provider_outcome, uncertainty_reason,
	observed_transaction_count, pending_validation_count,
	baseline_snapshot_version, snapshot_version, attempt_count, max_attempts,
	requested_at, updated_at, completed_at`

func scanRestore(row pgx.Row) (billingoperator.RestoreJobView, error) {
	var job billingoperator.RestoreJobView
	err := row.Scan(&job.RestoreID, &job.EnvironmentID, &job.BillingCustomerID, &job.StorePlatform,
		&job.Status, &job.Outcome, &job.ProviderOutcome, &job.UncertaintyReason,
		&job.ObservedTransactionCount, &job.PendingValidationCount,
		&job.BaselineSnapshotVersion, &job.SnapshotVersion, &job.AttemptCount, &job.MaxAttempts,
		&job.RequestedAt, &job.UpdatedAt, &job.CompletedAt)
	job.RequestedAt, job.UpdatedAt = job.RequestedAt.UTC(), job.UpdatedAt.UTC()
	job.CompletedAt = utcOrNil(job.CompletedAt)
	return job, err
}

func (r *Repository) ListRestoreJobs(ctx context.Context, projectID, environmentID, customerID string,
	limit int, cursor string) ([]billingoperator.RestoreJobView, string, error) {

	position := decodeCursor(cursor)
	rows, err := r.pool.Query(ctx,
		`SELECT `+restoreColumns+`
		   FROM restore_sync_jobs
		  WHERE project_id=$1 AND environment_id=$2
		    AND ($3::text = '' OR billing_customer_id = $3)
		    AND ($4::timestamptz IS NULL
		         OR requested_at < $4::timestamptz
		         OR (requested_at = $4::timestamptz AND id > $5))
		  ORDER BY requested_at DESC, id
		  LIMIT $6`, projectID, environmentID, customerID, position.At, position.ID, limit+1)
	if err != nil {
		return nil, "", fmt.Errorf("list restore jobs: %w", err)
	}
	defer rows.Close()
	jobs := make([]billingoperator.RestoreJobView, 0, limit)
	for rows.Next() {
		job, scanErr := scanRestore(rows)
		if scanErr != nil {
			return nil, "", fmt.Errorf("scan restore job: %w", scanErr)
		}
		jobs = append(jobs, job)
	}
	if err := rows.Err(); err != nil {
		return nil, "", fmt.Errorf("read restore jobs: %w", err)
	}
	next := ""
	if len(jobs) > limit {
		jobs = jobs[:limit]
		last := jobs[limit-1]
		next = encodeCursor(last.RequestedAt, last.RestoreID)
	}
	return jobs, next, nil
}

func (r *Repository) RestoreJob(ctx context.Context, projectID, environmentID, restoreID string) (billingoperator.RestoreJobView, error) {
	job, err := scanRestore(r.pool.QueryRow(ctx,
		`SELECT `+restoreColumns+` FROM restore_sync_jobs
		  WHERE id=$3 AND project_id=$1 AND environment_id=$2`, projectID, environmentID, restoreID))
	if errors.Is(err, pgx.ErrNoRows) {
		return billingoperator.RestoreJobView{}, billingoperator.ErrNotFound
	}
	if err != nil {
		return billingoperator.RestoreJobView{}, fmt.Errorf("read restore job: %w", err)
	}
	return job, nil
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// listCursor is a keyset position: the ordering timestamp of the last row plus
// its id as the tie-break. Microsecond resolution, for the reason documented on
// billingcustomerpostgres.encodeCursor: PostgreSQL stores timestamptz at
// microsecond precision, and a coarser cursor silently drops every row created
// in the same tick as the last one on the previous page.
type listCursor struct {
	At *time.Time
	ID string
}

func encodeCursor(at time.Time, id string) string {
	return base64.RawURLEncoding.EncodeToString(
		[]byte(strconv.FormatInt(at.UTC().UnixMicro(), 10) + ":" + id))
}

// decodeCursor parses an opaque cursor. A malformed value yields the zero
// cursor, which starts from the beginning: a caller that mangles a cursor gets
// the first page rather than a silently truncated list.
func decodeCursor(raw string) listCursor {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return listCursor{}
	}
	decoded, err := base64.RawURLEncoding.DecodeString(trimmed)
	if err != nil {
		return listCursor{}
	}
	micros, id, found := strings.Cut(string(decoded), ":")
	if !found || id == "" {
		return listCursor{}
	}
	value, err := strconv.ParseInt(micros, 10, 64)
	if err != nil {
		return listCursor{}
	}
	at := time.UnixMicro(value).UTC()
	return listCursor{At: &at, ID: id}
}

func utcOrNil(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}
	utc := value.UTC()
	return &utc
}
