package billingmigrationevaluation

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingmigration"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingprojection"
)

func (b *Builder) persist(ctx context.Context, lease billingmigration.ExecutionLease, frozen frozenProgram, evaluationID string, evaluationDigest []byte, providerWatermark, asOf time.Time, candidates []candidate) error {
	tx, err := b.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	// Re-read all mutable bindings in the write transaction. A candidate may be
	// orphaned by a later job settlement, but it can never be written for a
	// state/digest/authority tuple that was already stale at commit time.
	var stateVersion, epoch int64
	var state string
	var policy, manifest, mapping []byte
	err = tx.QueryRow(ctx, `SELECT p.state,p.state_version,p.authority_epoch_before,p.policy_digest,
		(SELECT manifest_digest FROM billing_migration_source_manifests WHERE program_id=p.id AND project_id=p.project_id ORDER BY captured_at DESC,id DESC LIMIT 1),
		(SELECT mapping_digest FROM billing_migration_mapping_sets WHERE program_id=p.id AND project_id=p.project_id AND status='frozen' ORDER BY version DESC LIMIT 1)
		FROM billing_migration_programs p WHERE p.id=$1 AND p.project_id=$2 FOR UPDATE`, lease.ProgramID, lease.ProjectID).Scan(&state, &stateVersion, &epoch, &policy, &manifest, &mapping)
	if errors.Is(err, pgx.ErrNoRows) {
		return billingmigration.ErrStaleState
	}
	if err != nil {
		return err
	}
	if !validProgramBinding(lease, state, stateVersion) {
		return billingmigration.ErrStaleState
	}
	if epoch != frozen.authorityEpoch {
		return billingmigration.ErrAuthorityEpoch
	}
	if !bytes.Equal(policy, frozen.policyDigest) || !bytes.Equal(manifest, lease.ManifestDigest) || !bytes.Equal(mapping, lease.MappingDigest) {
		return billingmigration.ErrStaleDigest
	}
	var bad int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM billing_migration_program_scopes ps LEFT JOIN billing_migration_authority_scopes a
		ON a.project_id=$2 AND a.environment_id=$3 AND a.application_id=ps.application_id AND a.platform=ps.platform
		WHERE ps.program_id=$1 AND (a.current_authority IS DISTINCT FROM 'source' OR a.current_epoch IS DISTINCT FROM $4 OR a.active_program_id IS DISTINCT FROM $1)`, lease.ProgramID, lease.ProjectID, frozen.environmentID, frozen.authorityEpoch).Scan(&bad); err != nil {
		return err
	}
	if bad != 0 {
		return billingmigration.ErrAuthorityEpoch
	}

	cohortParts := [][]byte{}
	for _, c := range candidates {
		cohortParts = append(cohortParts, []byte(c.scope.applicationID), []byte(c.scope.platform), []byte(c.customerID), c.sourceDigest)
	}
	cohortDigest := hash("mosaic-migration-evaluation-cohort-v1", cohortParts...)
	tag, err := tx.Exec(ctx, `INSERT INTO billing_migration_candidate_evaluations(id,program_id,project_id,job_id,job_kind,state_version,authority_epoch,manifest_digest,mapping_digest,policy_digest,evidence_digest,source_watermark,provider_watermark,shadow_watermark,cohort_digest,evaluation_digest,evaluated_at)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) ON CONFLICT(program_id,job_id) DO NOTHING`, evaluationID, lease.ProgramID, lease.ProjectID, lease.JobID, lease.JobKind, lease.ExpectedStateVersion, frozen.authorityEpoch, lease.ManifestDigest, lease.MappingDigest, frozen.policyDigest, frozen.evidenceDigest, frozen.sourceWatermark, providerWatermark, asOf, cohortDigest, evaluationDigest, asOf)
	if err != nil {
		return fmt.Errorf("insert migration candidate evaluation: %w", err)
	}
	if tag.RowsAffected() == 0 {
		var existing []byte
		if err = tx.QueryRow(ctx, `SELECT evaluation_digest FROM billing_migration_candidate_evaluations WHERE program_id=$1 AND job_id=$2`, lease.ProgramID, lease.JobID).Scan(&existing); err != nil {
			return err
		}
		if !bytes.Equal(existing, evaluationDigest) {
			return billingmigration.ErrIdempotencyConflict
		}
	}

	for i := range candidates {
		c := &candidates[i]
		c.snapshotID = stableID("cesm", evaluationID, c.scope.applicationID, c.scope.platform, c.customerID)
		if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "billing-projection:customer:"+c.customerID); err != nil {
			return err
		}
		var existingDigest []byte
		err = tx.QueryRow(ctx, `SELECT candidate_digest FROM billing_migration_candidate_snapshots WHERE snapshot_id=$1`, c.snapshotID).Scan(&existingDigest)
		if err == nil {
			if !bytes.Equal(existingDigest, c.candidateDigest) {
				return billingmigration.ErrIdempotencyConflict
			}
			continue
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		var version int64
		if err = tx.QueryRow(ctx, `SELECT COALESCE(max(snapshot_version),0)+1 FROM customer_entitlement_snapshots WHERE billing_customer_id=$1 AND environment_id=$2`, c.customerID, frozen.environmentID).Scan(&version); err != nil {
			return err
		}
		if err = insertCandidateSnapshot(ctx, tx, lease, frozen, *c, version, asOf); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO billing_migration_candidate_snapshots(id,evaluation_id,program_id,project_id,environment_id,application_id,platform,billing_customer_id,snapshot_id,source_evidence_digest,candidate_digest,comparison_digest,source_current_access,mosaic_current_access,created_at)
			VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, stableID("mcs", evaluationID, c.scope.applicationID, c.scope.platform, c.customerID), evaluationID, lease.ProgramID, lease.ProjectID, frozen.environmentID, c.scope.applicationID, c.scope.platform, c.customerID, c.snapshotID, c.sourceDigest, c.candidateDigest, c.comparisonDigest, c.sourceCurrentAccess, c.mosaicCurrentAccess, asOf)
		if err != nil {
			return fmt.Errorf("bind migration candidate snapshot: %w", err)
		}
	}
	return tx.Commit(ctx)
}

func insertCandidateSnapshot(ctx context.Context, tx pgx.Tx, lease billingmigration.ExecutionLease, frozen frozenProgram, c candidate, version int64, now time.Time) error {
	_, err := tx.Exec(ctx, `INSERT INTO customer_entitlement_snapshots(id,project_id,environment_id,billing_customer_id,snapshot_version,rule_version,computed_at,as_of,previous_snapshot_id,checksum,change_reason,created_at)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,NULL,$9,'migration_candidate',$7)`, c.snapshotID, lease.ProjectID, frozen.environmentID, c.customerID, version, billingprojection.RuleVersion, now, c.snapshot.AsOf, c.snapshot.Checksum)
	if err != nil {
		return fmt.Errorf("insert migration customer candidate: %w", err)
	}
	for i, e := range c.snapshot.Entries {
		_, err = tx.Exec(ctx, `INSERT INTO customer_entitlement_snapshot_entries(id,project_id,customer_entitlement_snapshot_id,entitlement_id,entitlement_key,state,effective_start,effective_end,end_known,source_count,uncertainty_reason,is_test_source,explanation_code)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, stableID("cee", c.snapshotID, fmt.Sprint(i)), lease.ProjectID, c.snapshotID, e.EntitlementID, e.EntitlementKey, e.State, e.EffectiveStart, e.EffectiveEnd, e.EndKnown, e.SourceCount, e.UncertaintyReason, e.IsTestSource, e.ExplanationCode)
		if err != nil {
			return fmt.Errorf("insert migration candidate entry: %w", err)
		}
	}
	for i, s := range c.snapshot.Sources {
		_, err = tx.Exec(ctx, `INSERT INTO entitlement_sources(id,project_id,environment_id,customer_entitlement_snapshot_id,billing_customer_id,entitlement_id,purchase_lineage_id,product_id,grant_version_id,subscription_instance_id,one_time_purchase_instance_id,source_snapshot_id,source_type,source_state,source_start,source_end,end_known,uncertainty_reason,is_test_source,explanation_code,created_at)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,NULLIF($10,''),NULLIF($11,''),NULL,$12,$13,$14,$15,$16,$17,$18,$19,$20)`, stableID("esr", c.snapshotID, fmt.Sprint(i)), lease.ProjectID, frozen.environmentID, c.snapshotID, c.customerID, s.EntitlementID, s.PurchaseLineageID, s.ProductID, s.GrantVersionID, s.SubscriptionInstanceID, s.OneTimePurchaseInstanceID, s.SourceType, s.SourceState, s.SourceStart, s.SourceEnd, s.EndKnown, s.UncertaintyReason, s.IsTestSource, s.ExplanationCode, now)
		if err != nil {
			return fmt.Errorf("insert migration candidate source: %w", err)
		}
	}
	return nil
}
