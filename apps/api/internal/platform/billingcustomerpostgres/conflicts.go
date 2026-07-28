package billingcustomerpostgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingcustomer"
)

// conflictColumns deliberately omits alias_digest. An operator resolves a
// conflict from the customer identifiers and the alias *family*; the digest is
// a stable per-person identifier and nothing on the surface needs it.
//
// DiagnosticCode has no column of its own: migration 00044 carries it in the
// existing `detail` object, so it is projected out here rather than duplicated
// into a column that could disagree with the document.
const conflictColumns = `id, project_id, conflict_scope, COALESCE(purchase_lineage_id,''),
	COALESCE(alias_type,''), status, first_customer_id, second_customer_id,
	COALESCE(detail->>'diagnosticCode',''), opened_at, resolved_at, COALESCE(resolution_action,''),
	COALESCE(detail->>'resolutionReason','')`

func scanConflict(row pgx.Row) (billingcustomer.Conflict, error) {
	var conflict billingcustomer.Conflict
	err := row.Scan(&conflict.ID, &conflict.ProjectID, &conflict.Scope, &conflict.PurchaseLineageID,
		&conflict.AliasType, &conflict.Status, &conflict.FirstCustomerID, &conflict.SecondCustomerID,
		&conflict.DiagnosticCode, &conflict.OpenedAt, &conflict.ResolvedAt, &conflict.ResolutionAction,
		&conflict.ResolutionReason)
	return conflict, err
}

// OpenConflict opens the single open conflict for a disputed subject and
// freezes that subject, in one transaction.
//
// The freeze is not a separate call on purpose. A conflict that did not freeze
// would let the very next projection grant access to whichever candidate
// happened to be read first, which is the outcome OD-10 exists to prevent — and
// splitting the two across transactions leaves exactly that window open on
// every crash between them.
//
// It is idempotent. Re-opening returns the existing open conflict rather than a
// second one, and re-applies the freeze, so a caller's retry converges instead
// of accumulating operator work. The uniqueness is the database's:
// `billing_identity_conflicts_open_lineage_idx` and
// `…_open_alias_idx` are partial unique indexes over the two dispute subjects,
// so a concurrent second opener loses at the index rather than in Go.
func (r *Repository) OpenConflict(ctx context.Context, conflict billingcustomer.Conflict) (billingcustomer.Conflict, error) {
	if conflict.Scope == "" {
		conflict.Scope = billingcustomer.ConflictScopeLineage
	}
	switch conflict.Scope {
	case billingcustomer.ConflictScopeLineage:
		if conflict.PurchaseLineageID == "" {
			return billingcustomer.Conflict{}, billingcustomer.ErrNotFound
		}
	case billingcustomer.ConflictScopeAlias:
		if conflict.AliasType == "" || len(conflict.Digest()) == 0 {
			return billingcustomer.Conflict{}, billingcustomer.ErrInvalidAlias
		}
	default:
		return billingcustomer.Conflict{}, billingcustomer.ErrConflict
	}

	detail := []byte(`{}`)
	if conflict.DiagnosticCode != "" {
		if raw, err := json.Marshal(map[string]string{"diagnosticCode": conflict.DiagnosticCode}); err == nil {
			detail = raw
		}
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return billingcustomer.Conflict{}, fmt.Errorf("begin identity conflict: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	conflictID := conflict.ID
	// The insert runs inside a savepoint so a uniqueness loss does not abort
	// the surrounding transaction — the freeze still has to happen on the
	// idempotent path.
	savepoint, err := tx.Begin(ctx)
	if err != nil {
		return billingcustomer.Conflict{}, fmt.Errorf("begin identity conflict savepoint: %w", err)
	}
	_, insertErr := savepoint.Exec(ctx,
		`INSERT INTO billing_identity_conflicts(
			id, project_id, conflict_scope, purchase_lineage_id, alias_type, alias_digest,
			status, first_customer_id, second_customer_id, detail, opened_at)
		 VALUES ($1,$2,$3,NULLIF($4,''),NULLIF($5,''),$6,'open',$7,$8,$9,$10)`,
		conflict.ID, conflict.ProjectID, conflict.Scope, conflict.PurchaseLineageID,
		conflict.AliasType, nullBytes(conflict.Digest()), conflict.FirstCustomerID,
		conflict.SecondCustomerID, detail, conflict.OpenedAt)
	switch {
	case insertErr == nil:
		if err := savepoint.Commit(ctx); err != nil {
			return billingcustomer.Conflict{}, fmt.Errorf("commit identity conflict insert: %w", err)
		}
	case isUniqueViolation(insertErr):
		if err := savepoint.Rollback(ctx); err != nil {
			return billingcustomer.Conflict{}, fmt.Errorf("roll back identity conflict insert: %w", err)
		}
		existing, err := openConflictFor(ctx, tx, conflict)
		if err != nil {
			return billingcustomer.Conflict{}, err
		}
		conflictID = existing
	default:
		_ = savepoint.Rollback(ctx)
		if isForeignKeyViolation(insertErr) {
			return billingcustomer.Conflict{}, billingcustomer.ErrNotFound
		}
		return billingcustomer.Conflict{}, fmt.Errorf("open identity conflict: %w", insertErr)
	}

	if err := freezeDisputedSubject(ctx, tx, conflict); err != nil {
		return billingcustomer.Conflict{}, err
	}

	opened, err := scanConflict(tx.QueryRow(ctx,
		`SELECT `+conflictColumns+` FROM billing_identity_conflicts WHERE id=$1 AND project_id=$2`,
		conflictID, conflict.ProjectID))
	if err != nil {
		return billingcustomer.Conflict{}, fmt.Errorf("read opened identity conflict: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return billingcustomer.Conflict{}, fmt.Errorf("commit identity conflict: %w", err)
	}
	return opened, nil
}

// openConflictFor re-reads the open conflict that already owns this dispute
// subject, which is what makes re-opening idempotent.
func openConflictFor(ctx context.Context, tx pgx.Tx, conflict billingcustomer.Conflict) (string, error) {
	var id string
	var err error
	if conflict.Scope == billingcustomer.ConflictScopeAlias {
		err = tx.QueryRow(ctx,
			`SELECT id FROM billing_identity_conflicts
			 WHERE project_id=$1 AND conflict_scope='alias' AND alias_type=$2
			   AND alias_digest=$3 AND status='open'`,
			conflict.ProjectID, conflict.AliasType, conflict.Digest()).Scan(&id)
	} else {
		err = tx.QueryRow(ctx,
			`SELECT id FROM billing_identity_conflicts
			 WHERE project_id=$1 AND conflict_scope='lineage' AND purchase_lineage_id=$2
			   AND status='open'`,
			conflict.ProjectID, conflict.PurchaseLineageID).Scan(&id)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		// The uniqueness that rejected the insert was the primary key, not the
		// open-conflict index: the caller reused a conflict identifier.
		return "", billingcustomer.ErrConflict
	}
	if err != nil {
		return "", fmt.Errorf("read existing identity conflict: %w", err)
	}
	return id, nil
}

// freezeDisputedSubject is the other half of the transaction.
//
// A lineage-scoped conflict freezes the lineage, so the projector preserves the
// last committed state instead of choosing a claimant. An alias-scoped conflict
// disputes no lineage, so it freezes the customer the caller tried to extend —
// which is what stops the next identical request quietly retrying the same
// reassignment. The other customer is deliberately untouched: its grants come
// from its own lineages and are not in dispute, and freezing a paying customer
// because someone else's backend sent a bad attach would be a self-inflicted
// outage.
func freezeDisputedSubject(ctx context.Context, tx pgx.Tx, conflict billingcustomer.Conflict) error {
	if conflict.Scope == billingcustomer.ConflictScopeAlias {
		tag, err := tx.Exec(ctx,
			`UPDATE billing_customers
			 SET status='frozen', diagnostics_status='identity_conflict', updated_at=$3
			 WHERE id=$1 AND project_id=$2 AND status <> 'anonymized'`,
			conflict.FirstCustomerID, conflict.ProjectID, conflict.OpenedAt)
		if err != nil {
			return fmt.Errorf("freeze disputed billing customer: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return billingcustomer.ErrNotFound
		}
		return nil
	}
	tag, err := tx.Exec(ctx,
		`UPDATE purchase_lineages
		 SET projection_frozen=true, diagnostic_status='identity_conflict', updated_at=$3
		 WHERE id=$1 AND project_id=$2`,
		conflict.PurchaseLineageID, conflict.ProjectID, conflict.OpenedAt)
	if err != nil {
		return fmt.Errorf("freeze disputed purchase lineage: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return billingcustomer.ErrNotFound
	}
	return nil
}

func (r *Repository) Conflict(ctx context.Context, actor billingcustomer.Actor, projectID, conflictID string) (billingcustomer.Conflict, error) {
	if _, err := requireRole(ctx, r.pool, actor, projectID, operatorRoles...); err != nil {
		return billingcustomer.Conflict{}, err
	}
	conflict, err := scanConflict(r.pool.QueryRow(ctx,
		`SELECT `+conflictColumns+` FROM billing_identity_conflicts WHERE id=$1 AND project_id=$2`,
		conflictID, projectID))
	if errors.Is(err, pgx.ErrNoRows) {
		return billingcustomer.Conflict{}, billingcustomer.ErrNotFound
	}
	if err != nil {
		return billingcustomer.Conflict{}, fmt.Errorf("read identity conflict: %w", err)
	}
	return conflict, nil
}

func (r *Repository) ListConflicts(ctx context.Context, actor billingcustomer.Actor, projectID, status string) ([]billingcustomer.Conflict, error) {
	if _, err := requireRole(ctx, r.pool, actor, projectID, operatorRoles...); err != nil {
		return nil, err
	}
	rows, err := r.pool.Query(ctx,
		`SELECT `+conflictColumns+` FROM billing_identity_conflicts
		 WHERE project_id=$1 AND ($2::text = '' OR status = $2)
		 ORDER BY opened_at DESC, id`, projectID, status)
	if err != nil {
		return nil, fmt.Errorf("list identity conflicts: %w", err)
	}
	defer rows.Close()
	conflicts := make([]billingcustomer.Conflict, 0, 8)
	for rows.Next() {
		conflict, err := scanConflict(rows)
		if err != nil {
			return nil, fmt.Errorf("scan identity conflict: %w", err)
		}
		conflicts = append(conflicts, conflict)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read identity conflicts: %w", err)
	}
	return conflicts, nil
}

// ResolveConflict applies an operator's decision in one transaction.
//
// The row is taken FOR UPDATE and re-read under the lock, so two operators
// clicking at once cannot both apply an action, and the second sees the
// conflict already resolved rather than overwriting the first's decision.
//
// An action naming a customer that is not party to the conflict is refused. A
// resolution surface that accepted an arbitrary customer identifier would be an
// unaudited "give this purchase to anyone" control, which is strictly more
// authority than the dispute it is supposed to settle.
func (r *Repository) ResolveConflict(ctx context.Context, actor billingcustomer.Actor, projectID, conflictID, action, assignedCustomerID, reason string, now time.Time) (billingcustomer.Conflict, error) {
	if _, err := requireRole(ctx, r.pool, actor, projectID, operatorRoles...); err != nil {
		return billingcustomer.Conflict{}, err
	}
	switch action {
	case "assigned_first", "assigned_second", "detached_both":
	default:
		return billingcustomer.Conflict{}, billingcustomer.ErrConflict
	}
	if strings.TrimSpace(reason) == "" || len(reason) > billingcustomer.MaxResolutionReasonLength {
		return billingcustomer.Conflict{}, billingcustomer.ErrInvalidAlias
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return billingcustomer.Conflict{}, fmt.Errorf("begin identity conflict resolution: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var scope, lineageID, aliasType string
	var aliasDigest []byte
	var first, second string
	err = tx.QueryRow(ctx,
		`SELECT conflict_scope, COALESCE(purchase_lineage_id,''), COALESCE(alias_type,''),
		        alias_digest, first_customer_id, second_customer_id
		 FROM billing_identity_conflicts
		 WHERE id=$1 AND project_id=$2 AND status='open' FOR UPDATE`, conflictID, projectID).
		Scan(&scope, &lineageID, &aliasType, &aliasDigest, &first, &second)
	if errors.Is(err, pgx.ErrNoRows) {
		return billingcustomer.Conflict{}, billingcustomer.ErrNotFound
	}
	if err != nil {
		return billingcustomer.Conflict{}, fmt.Errorf("read identity conflict for resolution: %w", err)
	}

	assigned, err := assignedParty(action, assignedCustomerID, first, second)
	if err != nil {
		return billingcustomer.Conflict{}, err
	}

	if scope == billingcustomer.ConflictScopeAlias {
		if err := applyAliasResolution(ctx, tx, actor, projectID, conflictID, aliasType,
			aliasDigest, assigned, now); err != nil {
			return billingcustomer.Conflict{}, err
		}
	} else {
		// The lineage is still frozen at this point, so the assignment is written
		// here rather than through AttachLineageCustomer — which refuses a frozen
		// lineage by design. Unfreezing is the caller's next step, after the
		// resolution has been committed and audited.
		if _, err := tx.Exec(ctx,
			`UPDATE purchase_lineages SET billing_customer_id=NULLIF($3,''), updated_at=$4
			 WHERE id=$1 AND project_id=$2`, lineageID, projectID, assigned, now); err != nil {
			return billingcustomer.Conflict{}, fmt.Errorf("apply lineage conflict resolution: %w", err)
		}
	}

	// The reason joins the diagnostic code in the existing detail document
	// rather than taking a column of its own: 00044 already established detail
	// as where a conflict's explanatory fields live, and one document cannot
	// disagree with itself the way a column and a document can.
	if _, err := tx.Exec(ctx,
		`UPDATE billing_identity_conflicts
		 SET status='resolved', resolved_at=$3, resolved_by_actor_id=NULLIF($4,''), resolution_action=$5,
		     detail = detail || jsonb_build_object('resolutionReason', $6::text)
		 WHERE id=$1 AND project_id=$2 AND status='open'`,
		conflictID, projectID, now, actor.ID, action, strings.TrimSpace(reason)); err != nil {
		return billingcustomer.Conflict{}, fmt.Errorf("close identity conflict: %w", err)
	}

	resolved, err := scanConflict(tx.QueryRow(ctx,
		`SELECT `+conflictColumns+` FROM billing_identity_conflicts WHERE id=$1 AND project_id=$2`,
		conflictID, projectID))
	if err != nil {
		return billingcustomer.Conflict{}, fmt.Errorf("read resolved identity conflict: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return billingcustomer.Conflict{}, fmt.Errorf("commit identity conflict resolution: %w", err)
	}
	return resolved, nil
}

// assignedParty maps an action to the customer it awards the disputed subject
// to, and refuses an explicit identifier that is not party to the conflict.
func assignedParty(action, assignedCustomerID, first, second string) (string, error) {
	switch action {
	case "assigned_first":
		if assignedCustomerID != "" && assignedCustomerID != first {
			return "", billingcustomer.ErrConflict
		}
		return first, nil
	case "assigned_second":
		if assignedCustomerID != "" && assignedCustomerID != second {
			return "", billingcustomer.ErrConflict
		}
		return second, nil
	default:
		if assignedCustomerID != "" {
			// "Detach both" names no winner. An identifier alongside it means the
			// operator meant something else, and guessing which is not this
			// layer's decision to make.
			return "", billingcustomer.ErrConflict
		}
		return "", nil
	}
}

// applyAliasResolution moves — or removes — the live resolution for a disputed
// alias digest.
//
// The end-date and the re-attach are in the caller's transaction and in this
// order, so the partial unique index never sees two live rows for the digest.
// The previous holder's row is kept and end-dated rather than deleted: who was
// linked when is exactly the history an operator needs if the resolution turns
// out to be wrong.
func applyAliasResolution(ctx context.Context, tx pgx.Tx, actor billingcustomer.Actor,
	projectID, conflictID, aliasType string, aliasDigest []byte, assigned string, now time.Time) error {
	var currentHolder string
	err := tx.QueryRow(ctx,
		`UPDATE billing_customer_aliases
		 SET effective_end = GREATEST($4, effective_start), revoked_by_actor_id = NULLIF($5,'')
		 WHERE project_id=$1 AND alias_type=$2 AND alias_digest=$3 AND effective_end IS NULL
		 RETURNING billing_customer_id`,
		projectID, aliasType, aliasDigest, now, actor.ID).Scan(&currentHolder)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("end-date disputed alias: %w", err)
	}
	if assigned == "" || assigned == currentHolder {
		if assigned != "" {
			// The winner already held it. Re-insert so the resolution leaves a
			// live row rather than an alias nobody resolves to.
			return insertOperatorAlias(ctx, tx, projectID, conflictID, aliasType, aliasDigest, assigned, now)
		}
		return nil
	}
	return insertOperatorAlias(ctx, tx, projectID, conflictID, aliasType, aliasDigest, assigned, now)
}

func insertOperatorAlias(ctx context.Context, tx pgx.Tx, projectID, conflictID, aliasType string,
	aliasDigest []byte, customerID string, now time.Time) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO billing_customer_aliases(
			id, project_id, billing_customer_id, alias_type, alias_digest,
			source_authority, verification_status, effective_start, created_at)
		 VALUES ($1,$2,$3,$4,$5,'operator','verified',$6,$6)`,
		"bca_"+hashID(conflictID, customerID, now.UnixNano()), projectID, customerID,
		aliasType, aliasDigest, now)
	if err != nil {
		if isUniqueViolation(err) {
			return billingcustomer.ErrConflict
		}
		if isForeignKeyViolation(err) {
			return billingcustomer.ErrNotFound
		}
		return fmt.Errorf("attach alias for conflict resolution: %w", err)
	}
	return nil
}
