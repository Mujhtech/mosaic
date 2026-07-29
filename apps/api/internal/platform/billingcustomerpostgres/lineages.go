package billingcustomerpostgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingcustomer"
)

const lineageColumns = `id, project_id, environment_id, environment_mode, application_id, provider,
	store_environment, lineage_key_digest, lineage_type, COALESCE(billing_customer_id,''),
	COALESCE(superseded_by_lineage_id,''), projection_frozen, diagnostic_status, created_at, updated_at`

func scanLineage(row pgx.Row) (billingcustomer.Lineage, error) {
	var lineage billingcustomer.Lineage
	err := row.Scan(&lineage.ID, &lineage.ProjectID, &lineage.EnvironmentID, &lineage.EnvironmentMode,
		&lineage.ApplicationID, &lineage.Provider, &lineage.StoreEnvironment, &lineage.LineageKeyDigest,
		&lineage.LineageType, &lineage.BillingCustomerID, &lineage.SupersededByLineageID,
		&lineage.ProjectionFrozen, &lineage.DiagnosticStatus, &lineage.CreatedAt, &lineage.UpdatedAt)
	return lineage, err
}

// LocateLineage finds or creates the lineage for one provider purchase chain.
//
// The identity is exactly `(environment_id, provider, lineage_key_digest)`,
// which is the UNIQUE constraint migration 00031 declares. Nothing else takes
// part: two lineages are never merged because they share a Product, a price, a
// customer, or a time window, because a merge on similarity is unrecoverable
// once entitlements have been granted from it.
//
// INSERT ... ON CONFLICT DO NOTHING followed by a re-read is used rather than
// ON CONFLICT DO UPDATE with a RETURNING sentinel. DO UPDATE would touch the
// existing row on every validated fact — bumping updated_at, taking a row lock
// on the hot path, and creating a second writer for `billing_customer_id`
// alongside AttachLineageCustomer. DO NOTHING leaves an established lineage
// completely untouched, and the `created` flag stays truthful under concurrency
// because only the transaction whose insert actually produced a row sees
// RowsAffected() == 1; every loser re-reads the winner's committed row.
//
// The re-read is retried a small number of times because a conflicting
// transaction that rolls back leaves neither a row nor an insert: in that case
// this call's next attempt is the one that creates it.
func (r *Repository) LocateLineage(ctx context.Context, lineage billingcustomer.Lineage) (billingcustomer.Lineage, bool, error) {
	if lineage.DiagnosticStatus == "" {
		lineage.DiagnosticStatus = "none"
	}
	if len(lineage.LineageKeyDigest) == 0 {
		return billingcustomer.Lineage{}, false, billingcustomer.ErrInvalidAlias
	}

	for range 3 {
		tag, err := r.pool.Exec(ctx,
			`INSERT INTO purchase_lineages(
				id, project_id, environment_id, environment_mode, application_id, provider,
				store_environment, lineage_key_digest, lineage_type, billing_customer_id,
				projection_frozen, diagnostic_status, created_at, updated_at)
			 VALUES ($1,$2,$3,
				COALESCE(NULLIF($4,''), (SELECT mode FROM environments WHERE id=$3 AND project_id=$2)),
				$5,$6,$7,$8,$9,NULLIF($10,''),false,$11,$12,$12)
			 ON CONFLICT (environment_id, provider, lineage_key_digest) DO NOTHING`,
			lineage.ID, lineage.ProjectID, lineage.EnvironmentID, lineage.EnvironmentMode,
			lineage.ApplicationID, lineage.Provider, lineage.StoreEnvironment,
			lineage.LineageKeyDigest, lineage.LineageType, lineage.BillingCustomerID,
			lineage.DiagnosticStatus, lineage.CreatedAt)
		if err != nil {
			if isForeignKeyViolation(err) {
				return billingcustomer.Lineage{}, false, billingcustomer.ErrNotFound
			}
			return billingcustomer.Lineage{}, false, fmt.Errorf("insert purchase lineage: %w", err)
		}
		if tag.RowsAffected() == 1 {
			located, err := scanLineage(r.pool.QueryRow(ctx,
				`SELECT `+lineageColumns+` FROM purchase_lineages WHERE id=$1 AND project_id=$2`,
				lineage.ID, lineage.ProjectID))
			if err != nil {
				return billingcustomer.Lineage{}, false, fmt.Errorf("read created purchase lineage: %w", err)
			}
			return located, true, nil
		}

		located, err := scanLineage(r.pool.QueryRow(ctx,
			`SELECT `+lineageColumns+` FROM purchase_lineages
			 WHERE environment_id=$1 AND provider=$2 AND lineage_key_digest=$3`,
			lineage.EnvironmentID, lineage.Provider, lineage.LineageKeyDigest))
		if errors.Is(err, pgx.ErrNoRows) {
			// The conflicting writer rolled back. Try to be the creator.
			continue
		}
		if err != nil {
			return billingcustomer.Lineage{}, false, fmt.Errorf("read existing purchase lineage: %w", err)
		}
		if located.ProjectID != lineage.ProjectID {
			// The Environment is unique across Projects, so this is unreachable
			// through a correct caller; refusing rather than returning another
			// tenant's lineage keeps that assumption from becoming a leak.
			return billingcustomer.Lineage{}, false, billingcustomer.ErrNotFound
		}
		return located, false, nil
	}
	return billingcustomer.Lineage{}, false, billingcustomer.ErrUnavailable
}

// LineageByKey reads the lineage for one provider chain key.
//
// It is scoped by Environment and provider rather than by Project because that
// triple is the UNIQUE constraint the schema declares, and because Apple's chain
// digest is unique only per (store environment, original transaction id): two
// sandbox Environments in one Project can legitimately hold the same digest.
func (r *Repository) LineageByKey(ctx context.Context, environmentID, provider string, keyDigest []byte) (billingcustomer.Lineage, error) {
	if len(keyDigest) == 0 {
		return billingcustomer.Lineage{}, billingcustomer.ErrNotFound
	}
	lineage, err := scanLineage(r.pool.QueryRow(ctx,
		`SELECT `+lineageColumns+` FROM purchase_lineages
		 WHERE environment_id=$1 AND provider=$2 AND lineage_key_digest=$3`,
		environmentID, provider, keyDigest))
	if errors.Is(err, pgx.ErrNoRows) {
		return billingcustomer.Lineage{}, billingcustomer.ErrNotFound
	}
	if err != nil {
		return billingcustomer.Lineage{}, fmt.Errorf("read purchase lineage by key: %w", err)
	}
	return lineage, nil
}

func (r *Repository) Lineage(ctx context.Context, projectID, lineageID string) (billingcustomer.Lineage, error) {
	lineage, err := scanLineage(r.pool.QueryRow(ctx,
		`SELECT `+lineageColumns+` FROM purchase_lineages WHERE id=$1 AND project_id=$2`,
		lineageID, projectID))
	if errors.Is(err, pgx.ErrNoRows) {
		return billingcustomer.Lineage{}, billingcustomer.ErrNotFound
	}
	if err != nil {
		return billingcustomer.Lineage{}, fmt.Errorf("read purchase lineage: %w", err)
	}
	return lineage, nil
}

// AttachLineageCustomer records the resolver's accepted association.
//
// A frozen lineage is excluded from the predicate. Freezing exists precisely to
// stop an association being applied while an operator owns the dispute, and a
// write that ignored it would hand the purchase to whichever candidate the next
// projection read first — which is the failure OD-10 is about.
func (r *Repository) AttachLineageCustomer(ctx context.Context, projectID, lineageID, customerID string, now time.Time) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE purchase_lineages
		 SET billing_customer_id=$3, diagnostic_status='none', updated_at=$4
		 WHERE id=$1 AND project_id=$2 AND projection_frozen = false`,
		lineageID, projectID, customerID, now)
	if err != nil {
		if isForeignKeyViolation(err) {
			return billingcustomer.ErrNotFound
		}
		return fmt.Errorf("attach lineage customer: %w", err)
	}
	if tag.RowsAffected() == 0 {
		// Either the lineage does not exist in this Project, or it is frozen.
		// Both are reported as a frozen-or-absent refusal rather than as a
		// success, so a caller never believes an association it did not get.
		return r.lineageRefusal(ctx, projectID, lineageID)
	}
	return nil
}

// SetLineageSupersededBy records an explicit supersession edge. Nothing is
// deleted: the superseded lineage stops granting access and stays fully visible
// in history.
func (r *Repository) SetLineageSupersededBy(ctx context.Context, projectID, lineageID, supersededBy string, now time.Time) error {
	if lineageID == supersededBy {
		return billingcustomer.ErrConflict
	}
	tag, err := r.pool.Exec(ctx,
		`UPDATE purchase_lineages SET superseded_by_lineage_id=NULLIF($3,''), updated_at=$4
		 WHERE id=$1 AND project_id=$2`, lineageID, projectID, supersededBy, now)
	if err != nil {
		if isForeignKeyViolation(err) {
			// The successor is not a lineage of this Project. Migration 00043
			// makes that composite reference the schema's job.
			return billingcustomer.ErrNotFound
		}
		return fmt.Errorf("set lineage supersession: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return billingcustomer.ErrNotFound
	}
	return nil
}

// SetLineageFrozen is the projection freeze switch of OD-10.
func (r *Repository) SetLineageFrozen(ctx context.Context, projectID, lineageID string, frozen bool, diagnostic string, now time.Time) error {
	if diagnostic == "" {
		diagnostic = "none"
	}
	tag, err := r.pool.Exec(ctx,
		`UPDATE purchase_lineages SET projection_frozen=$3, diagnostic_status=$4, updated_at=$5
		 WHERE id=$1 AND project_id=$2`, lineageID, projectID, frozen, diagnostic, now)
	if err != nil {
		return fmt.Errorf("set lineage freeze: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return billingcustomer.ErrNotFound
	}
	return nil
}

// lineageRefusal distinguishes "no such lineage here" from "frozen", which are
// the only two reasons a scoped lineage write affects no rows.
func (r *Repository) lineageRefusal(ctx context.Context, projectID, lineageID string) error {
	var frozen bool
	err := r.pool.QueryRow(ctx,
		`SELECT projection_frozen FROM purchase_lineages WHERE id=$1 AND project_id=$2`,
		lineageID, projectID).Scan(&frozen)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return billingcustomer.ErrNotFound
	case err != nil:
		return fmt.Errorf("read purchase lineage state: %w", err)
	case frozen:
		return billingcustomer.ErrFrozen
	default:
		return billingcustomer.ErrNotFound
	}
}
