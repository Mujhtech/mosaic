package billingaccesspostgres

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingaccess"
)

func (r *Repository) LegacyAuthority(ctx context.Context, scope billingaccess.AuthorityScope) (string, error) {
	var authority string
	err := r.pool.QueryRow(ctx,
		`SELECT current_authority FROM billing_migration_authority_scopes
		 WHERE project_id=$1 AND environment_id=$2 AND application_id=$3 AND platform=$4`,
		scope.ProjectID, scope.EnvironmentID, scope.ApplicationID, scope.Platform).Scan(&authority)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", billingaccess.ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("read legacy serving authority: %w", err)
	}
	return authority, nil
}

func (r *Repository) MinimumSupport(ctx context.Context, scope billingaccess.AuthorityScope) (billingaccess.MinimumSupport, error) {
	var support billingaccess.MinimumSupport
	err := r.pool.QueryRow(ctx,
		`SELECT ps.program_id, ps.minimum_sdk_version, ps.minimum_app_version, ps.maximum_app_version,
		        ps.required_capabilities
		 FROM billing_migration_readiness_policy_scopes ps
		 JOIN billing_migration_readiness_policies p ON p.id=ps.policy_id AND p.program_id=ps.program_id
		 JOIN billing_migration_programs mp ON mp.id=ps.program_id AND mp.project_id=ps.project_id
		 WHERE ps.project_id=$1 AND mp.environment_id=$2 AND ps.application_id=$3 AND ps.platform=$4
		 ORDER BY p.frozen_at DESC, p.id DESC LIMIT 1`,
		scope.ProjectID, scope.EnvironmentID, scope.ApplicationID, scope.Platform).
		Scan(&support.ProgramID, &support.MinimumSDKVersion, &support.MinimumAppVersion, &support.MaximumAppVersion,
			&support.RequiredCapabilities)
	if errors.Is(err, pgx.ErrNoRows) {
		return billingaccess.MinimumSupport{}, billingaccess.ErrNotFound
	}
	if err != nil {
		return billingaccess.MinimumSupport{}, fmt.Errorf("read authority minimum support: %w", err)
	}
	return support, nil
}

func (r *Repository) AuthoritySelection(ctx context.Context, scope billingaccess.AuthorityScope,
	customerID string, at time.Time) (billingaccess.AuthoritySelection, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return billingaccess.AuthoritySelection{}, fmt.Errorf("begin authority selection: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	selection := billingaccess.AuthoritySelection{Scope: scope}
	var snapshotID, programState, transitionKind string
	var stabilizationDays int
	var transitionedAt, cutoverAt *time.Time
	err = tx.QueryRow(ctx,
		`SELECT a.active_program_id, a.current_epoch, a.current_authority,
		        p.state, p.stabilization_days,
		        ps.minimum_sdk_version, ps.minimum_app_version, ps.maximum_app_version,
		        ps.required_capabilities, cp.current_snapshot_id,
		        COALESCE(t.transition_kind,''), t.transitioned_at, c.transitioned_at
		 FROM billing_migration_authority_scopes a
		 JOIN billing_migration_programs p
		   ON p.id=a.active_program_id AND p.project_id=a.project_id AND p.environment_id=a.environment_id
		 JOIN billing_migration_readiness_policies rp
		   ON rp.program_id=p.id AND rp.project_id=p.project_id AND rp.policy_digest=p.policy_digest
		 JOIN billing_migration_readiness_policy_scopes ps
		   ON ps.policy_id=rp.id AND ps.program_id=p.id AND ps.application_id=a.application_id AND ps.platform=a.platform
		 JOIN billing_migration_scope_current_pointers cp
		   ON cp.project_id=a.project_id AND cp.environment_id=a.environment_id
		  AND cp.application_id=a.application_id AND cp.platform=a.platform
		  AND cp.billing_customer_id=$5 AND cp.authority_epoch=a.current_epoch
		 LEFT JOIN LATERAL (
		   SELECT transition_kind, transitioned_at
		   FROM billing_migration_authority_transitions
		   WHERE authority_scope_id=a.id AND to_epoch=a.current_epoch
		   ORDER BY transitioned_at DESC, id DESC LIMIT 1
		 ) t ON true
		 LEFT JOIN LATERAL (
		   SELECT transitioned_at
		   FROM billing_migration_authority_transitions
		   WHERE authority_scope_id=a.id AND transition_kind='cutover' AND to_epoch<=a.current_epoch
		   ORDER BY to_epoch DESC, id DESC LIMIT 1
		 ) c ON true
		 WHERE a.project_id=$1 AND a.environment_id=$2 AND a.application_id=$3 AND a.platform=$4`,
		scope.ProjectID, scope.EnvironmentID, scope.ApplicationID, scope.Platform, customerID).
		Scan(&selection.ProgramID, &selection.AuthorityEpoch, &selection.AuthorityKind,
			&programState, &stabilizationDays, &selection.MinimumSupport.MinimumSDKVersion,
			&selection.MinimumSupport.MinimumAppVersion, &selection.MinimumSupport.MaximumAppVersion,
			&selection.MinimumSupport.RequiredCapabilities, &snapshotID, &transitionKind, &transitionedAt, &cutoverAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return billingaccess.AuthoritySelection{}, billingaccess.ErrNotFound
	}
	if err != nil {
		return billingaccess.AuthoritySelection{}, fmt.Errorf("read authority selection: %w", err)
	}

	switch selection.AuthorityKind {
	case "source":
		selection.TransitionState = "stable"
		if programState == "cutover_pending" {
			selection.TransitionState = "cutover_pending"
		}
	case "mosaic":
		if transitionKind != "cutover" || transitionedAt == nil || cutoverAt == nil {
			return billingaccess.AuthoritySelection{}, billingaccess.ErrNotFound
		}
		cutover := cutoverAt.UTC()
		selection.CutoverAt = &cutover
		selection.TransitionState = "stable"
		if at.Before(cutover.Add(time.Duration(stabilizationDays) * 24 * time.Hour)) {
			selection.TransitionState = "stabilizing"
		}
	case "source_rollback":
		if transitionKind != "rollback" || transitionedAt == nil || cutoverAt == nil {
			return billingaccess.AuthoritySelection{}, billingaccess.ErrNotFound
		}
		cutover := cutoverAt.UTC()
		selection.CutoverAt = &cutover
		selection.TransitionState = "rolled_back"
	default:
		return billingaccess.AuthoritySelection{}, billingaccess.ErrNotFound
	}

	selection.Snapshot, err = readSnapshotByID(ctx, tx, scope, customerID, snapshotID)
	if err != nil {
		return billingaccess.AuthoritySelection{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return billingaccess.AuthoritySelection{}, fmt.Errorf("commit authority selection read: %w", err)
	}
	return selection, nil
}

func readSnapshotByID(ctx context.Context, tx pgx.Tx, scope billingaccess.AuthorityScope,
	customerID, snapshotID string) (billingaccess.SnapshotView, error) {
	var view billingaccess.SnapshotView
	var previousID *string
	err := tx.QueryRow(ctx,
		`SELECT id,project_id,environment_id,billing_customer_id,snapshot_version,rule_version,
		        computed_at,as_of,previous_snapshot_id,checksum,change_reason
		 FROM customer_entitlement_snapshots
		 WHERE id=$1 AND project_id=$2 AND environment_id=$3 AND billing_customer_id=$4`,
		snapshotID, scope.ProjectID, scope.EnvironmentID, customerID).
		Scan(&view.SnapshotID, &view.ProjectID, &view.EnvironmentID, &view.CustomerID,
			&view.SnapshotVersion, &view.RuleVersion, &view.ComputedAt, &view.AsOf,
			&previousID, &view.Checksum, &view.ChangeReason)
	if errors.Is(err, pgx.ErrNoRows) {
		return billingaccess.SnapshotView{}, billingaccess.ErrNotFound
	}
	if err != nil {
		return billingaccess.SnapshotView{}, fmt.Errorf("read scoped entitlement snapshot: %w", err)
	}
	if previousID != nil {
		_ = tx.QueryRow(ctx, `SELECT snapshot_version FROM customer_entitlement_snapshots WHERE id=$1`, *previousID).
			Scan(&view.PreviousSnapshotVersion)
	}

	rows, err := tx.Query(ctx,
		`SELECT e.id,e.entitlement_id,e.purchase_lineage_id,e.product_id,e.grant_version_id,
		        COALESCE(e.subscription_instance_id,''),COALESCE(e.one_time_purchase_instance_id,''),
		        COALESCE(e.source_snapshot_id,''),COALESCE(l.provider,''),e.source_type,e.source_state,
		        e.source_start,e.source_end,e.end_known,e.uncertainty_reason,e.is_test_source,e.explanation_code
		 FROM entitlement_sources e LEFT JOIN purchase_lineages l ON l.id=e.purchase_lineage_id
		 WHERE e.customer_entitlement_snapshot_id=$1 ORDER BY e.id`, snapshotID)
	if err != nil {
		return billingaccess.SnapshotView{}, fmt.Errorf("read scoped entitlement sources: %w", err)
	}
	byEntitlement := map[string][]string{}
	for rows.Next() {
		var source billingaccess.SnapshotSource
		if err := rows.Scan(&source.RowID, &source.EntitlementID, &source.PurchaseLineageID, &source.ProductID,
			&source.GrantVersionID, &source.SubscriptionInstanceID, &source.OneTimePurchaseInstanceID,
			&source.SourceSnapshotID, &source.StorePlatform, &source.SourceType, &source.SourceState,
			&source.SourceStart, &source.SourceEnd, &source.EndKnown, &source.UncertaintyReason,
			&source.IsTestSource, &source.ExplanationCode); err != nil {
			rows.Close()
			return view, fmt.Errorf("scan scoped source: %w", err)
		}
		byEntitlement[source.EntitlementID] = append(byEntitlement[source.EntitlementID], source.RowID)
		view.Sources = append(view.Sources, source)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return view, err
	}
	rows.Close()

	entries, err := tx.Query(ctx,
		`SELECT entitlement_id,entitlement_key,state,effective_start,effective_end,end_known,
		        source_count,uncertainty_reason,is_test_source,explanation_code
		 FROM customer_entitlement_snapshot_entries WHERE customer_entitlement_snapshot_id=$1 ORDER BY entitlement_key`, snapshotID)
	if err != nil {
		return view, fmt.Errorf("read scoped entitlement entries: %w", err)
	}
	defer entries.Close()
	for entries.Next() {
		var entry billingaccess.SnapshotEntry
		if err := entries.Scan(&entry.EntitlementID, &entry.EntitlementKey, &entry.State, &entry.EffectiveStart,
			&entry.EffectiveEnd, &entry.EndKnown, &entry.SourceCount, &entry.UncertaintyReason,
			&entry.IsTestSource, &entry.ExplanationCode); err != nil {
			return view, fmt.Errorf("scan scoped entry: %w", err)
		}
		entry.SourceIDs = byEntitlement[entry.EntitlementID]
		view.Entries = append(view.Entries, entry)
	}
	view.Projection = billingaccess.ProjectionStatus{State: billingaccess.ProjectionCurrent, LastProjectedAt: view.ComputedAt}
	return view, entries.Err()
}

func (r *Repository) ObservedSnapshotDigest(ctx context.Context, selection billingaccess.AuthoritySelection, digest []byte) (bool, error) {
	var found bool
	err := r.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM billing_migration_v2_sync_observations
		 WHERE program_id=$1 AND project_id=$2 AND application_id=$3 AND platform=$4
		   AND authority_epoch=$5 AND sync_result='accepted' AND observation_digest=$6)`,
		selection.ProgramID, selection.Scope.ProjectID, selection.Scope.ApplicationID,
		selection.Scope.Platform, selection.AuthorityEpoch, digest).Scan(&found)
	if err != nil {
		return false, fmt.Errorf("verify observed snapshot digest: %w", err)
	}
	return found, nil
}

func (r *Repository) AppendSyncObservation(ctx context.Context, observation billingaccess.SyncObservation) error {
	if observation.ProgramID == "" {
		return billingaccess.ErrNotFound
	}
	randomID := make([]byte, 16)
	if _, err := rand.Read(randomID); err != nil {
		return fmt.Errorf("generate v2 sync observation id: %w", err)
	}
	id := "bmo_" + hex.EncodeToString(randomID)
	_, err := r.pool.Exec(ctx,
		`INSERT INTO billing_migration_v2_sync_observations(
		 id,program_id,project_id,application_id,platform,app_version,sdk_version,
		 supported_contract_versions,authority_capabilities,traffic_count,authority_epoch,
		 sync_result,observation_digest,observed_at)
		 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10,$11,$12,$13)`,
		id, observation.ProgramID, observation.Scope.ProjectID, observation.Scope.ApplicationID,
		observation.Scope.Platform, observation.AppVersion, observation.SDKVersion,
		observation.SupportedContractVersions, observation.Capabilities, observation.AuthorityEpoch,
		observation.Result, observation.Digest, observation.ObservedAt)
	if err != nil {
		return fmt.Errorf("append v2 sync observation: %w", err)
	}
	return nil
}
