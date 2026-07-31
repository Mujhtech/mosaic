package billingmigrationpostgres

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingmigration"
)

type lockedScope struct {
	id, applicationID, platform, authority string
	epoch                                  int64
	authorityDigest                        []byte
}

func (r *Repository) ExecuteCutover(ctx context.Context, write billingmigration.ExecuteCutoverWrite) (billingmigration.AuthorityExecution, bool, error) {
	return retryExecution(ctx, func() (billingmigration.AuthorityExecution, bool, error) { return r.executeCutoverOnce(ctx, write) })
}

func (r *Repository) executeCutoverOnce(ctx context.Context, write billingmigration.ExecuteCutoverWrite) (billingmigration.AuthorityExecution, bool, error) {
	input := write.Input
	result := executionResult(input.ProgramID, write.ExecutionID, "cutover", billingmigration.StateStabilizing, input.ExpectedStateVersion+1, input.ExpectedAuthorityEpoch+1, write.ExecutedAt)
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return result, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, replay, replayErr := commandReplay(ctx, tx, input.ProgramID, input.ProjectID, "execute_cutover", input.IdempotencyKey, write.RequestDigest); replayErr != nil {
		if errors.Is(replayErr, billingmigration.ErrConflict) {
			return result, false, billingmigration.ErrIdempotencyConflict
		}
		return result, false, replayErr
	} else if replay {
		if err = loadExecutionReplay(ctx, tx, input.ProgramID, input.ProjectID, "execute_cutover", input.IdempotencyKey, "cutover", &result); err != nil {
			return result, true, err
		}
		return result, true, tx.Commit(ctx)
	}

	var state, environmentID string
	var stateVersion int64
	var scopeDigest []byte
	if err = tx.QueryRow(ctx, `SELECT state,state_version,environment_id,scope_digest FROM billing_migration_programs WHERE id=$1 AND project_id=$2 FOR UPDATE`, input.ProgramID, input.ProjectID).Scan(&state, &stateVersion, &environmentID, &scopeDigest); errors.Is(err, pgx.ErrNoRows) {
		return result, false, billingmigration.ErrNotFound
	} else if err != nil {
		return result, false, err
	}
	if state != billingmigration.StateCutoverPending || stateVersion != input.ExpectedStateVersion {
		return result, false, billingmigration.ErrStaleState
	}
	if environmentID != input.Scope.EnvironmentID || !bytes.Equal(scopeDigest, write.Digests.Scope) {
		return result, false, billingmigration.ErrStaleDigest
	}

	var command, status string
	var expiresAt time.Time
	var approvalDigest, checkpointDigest, manifest, mapping, policy, evidence, readiness, watermark, appVersion []byte
	err = tx.QueryRow(ctx, `SELECT proposal.command,proposal.status,approval.expires_at,approval.approval_digest,
		checkpoint.checkpoint_digest,checkpoint.manifest_digest,checkpoint.mapping_digest,checkpoint.policy_digest,
		checkpoint.evidence_digest,checkpoint.readiness_digest,checkpoint.final_watermark_digest,checkpoint.application_version_digest
		FROM billing_migration_approvals approval
		JOIN billing_migration_cutover_proposals proposal ON proposal.id=approval.proposal_id AND proposal.program_id=approval.program_id AND proposal.project_id=approval.project_id
		JOIN billing_migration_checkpoints checkpoint ON checkpoint.program_id=approval.program_id AND checkpoint.project_id=approval.project_id AND checkpoint.approval_digest=approval.approval_digest
		WHERE approval.id=$1 AND approval.program_id=$2 AND approval.project_id=$3 AND checkpoint.id=$4
		FOR UPDATE OF proposal,approval,checkpoint`, input.ApprovalID, input.ProgramID, input.ProjectID, input.CheckpointID).Scan(&command, &status, &expiresAt, &approvalDigest, &checkpointDigest, &manifest, &mapping, &policy, &evidence, &readiness, &watermark, &appVersion)
	if errors.Is(err, pgx.ErrNoRows) {
		return result, false, billingmigration.ErrStaleDigest
	} else if err != nil {
		return result, false, err
	}
	if command != "cutover" || status != "approved" || !bytes.Equal(approvalDigest, write.Digests.Approval) {
		return result, false, billingmigration.ErrStaleDigest
	}
	if !expiresAt.After(write.ExecutedAt) {
		return result, false, billingmigration.ErrExpiredApproval
	}
	actual := [][]byte{scopeDigest, manifest, mapping, policy, evidence, readiness, watermark, appVersion, approvalDigest}
	expected := [][]byte{write.Digests.Scope, write.Digests.Manifest, write.Digests.Mapping, write.Digests.Policy, write.Digests.Evidence, write.Digests.Readiness, write.Digests.FinalWatermark, write.Digests.ApplicationVersion, write.Digests.Approval}
	for i := range actual {
		if !bytes.Equal(actual[i], expected[i]) {
			return result, false, billingmigration.ErrStaleDigest
		}
	}
	if err = verifyCutoverFreshness(ctx, tx, input.ProjectID, input.ProgramID, input.CheckpointID, write.Digests, write.ExecutedAt); err != nil {
		return result, false, err
	}

	scopes, err := lockAuthorityScopes(ctx, tx, input.ProjectID, input.ProgramID)
	if err != nil {
		return result, false, err
	}
	if !sameScope(input.Scope, environmentID, scopes) {
		return result, false, billingmigration.ErrStaleDigest
	}
	for _, scope := range scopes {
		if scope.authority != "source" || scope.epoch != input.ExpectedAuthorityEpoch {
			return result, false, billingmigration.ErrAuthorityEpoch
		}
	}
	if err = verifyPointerCoverage(ctx, tx, input.ProjectID, input.ProgramID, input.CheckpointID); err != nil {
		return result, false, err
	}
	if err = lockCurrentPointers(ctx, tx, input.ProjectID, environmentID, scopes); err != nil {
		return result, false, err
	}

	_, err = tx.Exec(ctx, `INSERT INTO billing_migration_scope_current_pointers(project_id,environment_id,application_id,platform,billing_customer_id,current_snapshot_id,authority_epoch,updated_at)
		SELECT map.project_id,map.environment_id,map.application_id,map.platform,map.billing_customer_id,map.snapshot_id,$3,$4
		FROM billing_migration_checkpoint_pointer_maps map WHERE map.checkpoint_id=$1 AND map.program_id=$2 AND map.pointer_role='prepared_activation'
		ON CONFLICT(project_id,environment_id,application_id,platform,billing_customer_id) DO UPDATE SET current_snapshot_id=excluded.current_snapshot_id,authority_epoch=excluded.authority_epoch,updated_at=excluded.updated_at`, input.CheckpointID, input.ProgramID, input.ExpectedAuthorityEpoch+1, write.ExecutedAt)
	if err != nil {
		return result, false, err
	}
	for _, scope := range scopes {
		transitionID := billingmigration.DeterministicTransitionID(write.ExecutionID, scope.id)
		transitionDigest := billingmigration.CanonicalTransitionDigest(input.ProgramID, scope.id, "source", "mosaic", scope.epoch, scope.epoch+1, "cutover", write.ExecutedAt)
		newAuthorityDigest := billingmigration.CanonicalAuthorityDigest(input.ProjectID, environmentID, scope.applicationID, scope.platform, "mosaic", scope.epoch+1, input.ProgramID)
		tag, updateErr := tx.Exec(ctx, `UPDATE billing_migration_authority_scopes SET current_authority='mosaic',current_epoch=$3,authority_digest=$4,updated_at=$5 WHERE id=$1 AND project_id=$2 AND current_authority='source' AND current_epoch=$6 AND authority_digest=$7`, scope.id, input.ProjectID, scope.epoch+1, newAuthorityDigest, write.ExecutedAt, scope.epoch, scope.authorityDigest)
		if updateErr != nil {
			return result, false, updateErr
		}
		if tag.RowsAffected() != 1 {
			return result, false, billingmigration.ErrConcurrentTransition
		}
		if _, err = tx.Exec(ctx, `INSERT INTO billing_migration_authority_transitions(id,program_id,project_id,authority_scope_id,from_authority,to_authority,from_epoch,to_epoch,transition_kind,transition_digest,transitioned_at) VALUES($1,$2,$3,$4,'source','mosaic',$5,$6,'cutover',$7,$8)`, transitionID, input.ProgramID, input.ProjectID, scope.id, scope.epoch, scope.epoch+1, transitionDigest, write.ExecutedAt); err != nil {
			return result, false, err
		}
		if _, err = tx.Exec(ctx, `INSERT INTO billing_migration_transition_outbox(id,program_id,project_id,authority_scope_id,transition_id,event_kind,authority_epoch,status,created_at,updated_at) VALUES('mto_'||substr(md5($1||':'||$2),1,20),$3,$4,$2,$1,'authority_changed',$5,'pending',$6,$6)`, transitionID, scope.id, input.ProgramID, input.ProjectID, scope.epoch+1, write.ExecutedAt); err != nil {
			return result, false, err
		}
		result.TransitionIDs = append(result.TransitionIDs, transitionID)
	}
	if err = finishExecution(ctx, tx, input.ProjectID, input.ProgramID, input.ExpectedStateVersion, billingmigration.StateCutoverPending, billingmigration.StateStabilizing, write.ExecutionID, "execute_cutover", input.IdempotencyKey, write.RequestDigest, write.ActorID, input.Reason, len(scopes), input.ExpectedAuthorityEpoch+1, write.ExecutedAt); err != nil {
		return result, false, err
	}
	if err = tx.Commit(ctx); err != nil {
		return result, false, translateExecutionError(err)
	}
	return result, false, nil
}

func (r *Repository) ExecuteRollback(ctx context.Context, write billingmigration.ExecuteRollbackWrite) (billingmigration.AuthorityExecution, bool, error) {
	return retryExecution(ctx, func() (billingmigration.AuthorityExecution, bool, error) { return r.executeRollbackOnce(ctx, write) })
}

func (r *Repository) executeRollbackOnce(ctx context.Context, write billingmigration.ExecuteRollbackWrite) (billingmigration.AuthorityExecution, bool, error) {
	input := write.Input
	result := executionResult(input.ProgramID, write.ExecutionID, "rollback", "rolled_back", input.ExpectedStateVersion+1, input.ExpectedAuthorityEpoch+1, write.ExecutedAt)
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return result, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, replay, replayErr := commandReplay(ctx, tx, input.ProgramID, input.ProjectID, "execute_rollback", input.IdempotencyKey, write.RequestDigest); replayErr != nil {
		if errors.Is(replayErr, billingmigration.ErrConflict) {
			return result, false, billingmigration.ErrIdempotencyConflict
		}
		return result, false, replayErr
	} else if replay {
		if err = loadExecutionReplay(ctx, tx, input.ProgramID, input.ProjectID, "execute_rollback", input.IdempotencyKey, "rollback", &result); err != nil {
			return result, true, err
		}
		return result, true, tx.Commit(ctx)
	}
	var state, environmentID string
	var version int64
	var scopeDigest []byte
	if err = tx.QueryRow(ctx, `SELECT state,state_version,environment_id,scope_digest FROM billing_migration_programs WHERE id=$1 AND project_id=$2 FOR UPDATE`, input.ProgramID, input.ProjectID).Scan(&state, &version, &environmentID, &scopeDigest); errors.Is(err, pgx.ErrNoRows) {
		return result, false, billingmigration.ErrNotFound
	} else if err != nil {
		return result, false, err
	}
	if state != billingmigration.StateStabilizing || version != input.ExpectedStateVersion {
		return result, false, billingmigration.ErrStaleState
	}
	if environmentID != input.Scope.EnvironmentID {
		return result, false, billingmigration.ErrStaleDigest
	}
	var command, status string
	var expires, deadline time.Time
	var approvalDigest, checkpointDigest, authorityDigest, prerequisiteDigest, bindingScope []byte
	var credentialID, credentialStatus, capabilityID, sourceID, providerID string
	var removed bool
	var removedAt *time.Time
	var capabilityDigest, sourceDigest, providerDigest []byte
	var capabilityAt, sourceAt, providerAt time.Time
	err = tx.QueryRow(ctx, `SELECT proposal.command,proposal.status,approval.expires_at,approval.approval_digest,binding.checkpoint_digest,binding.authority_digest,binding.rollback_prerequisites_digest,binding.scope_digest,binding.rollback_deadline,binding.credential_id,binding.credential_status,binding.credential_removed,binding.credential_removed_at,binding.capability_assessment_id,binding.capability_assessment_digest,binding.capability_assessed_at,binding.source_validation_id,binding.source_validation_digest,binding.source_validated_at,binding.provider_validation_id,binding.provider_validation_digest,binding.provider_validated_at
		FROM billing_migration_approvals approval JOIN billing_migration_cutover_proposals proposal ON proposal.id=approval.proposal_id JOIN billing_migration_rollback_proposal_bindings binding ON binding.proposal_id=proposal.id
		WHERE approval.id=$1 AND approval.program_id=$2 AND approval.project_id=$3 AND proposal.command='rollback' AND binding.checkpoint_id=$4 FOR UPDATE OF proposal,approval,binding`, input.ApprovalID, input.ProgramID, input.ProjectID, input.CheckpointID).Scan(&command, &status, &expires, &approvalDigest, &checkpointDigest, &authorityDigest, &prerequisiteDigest, &bindingScope, &deadline, &credentialID, &credentialStatus, &removed, &removedAt, &capabilityID, &capabilityDigest, &capabilityAt, &sourceID, &sourceDigest, &sourceAt, &providerID, &providerDigest, &providerAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return result, false, billingmigration.ErrStaleRollbackPrerequisites
	} else if err != nil {
		return result, false, err
	}
	if command != "rollback" || status != "approved" || !bytes.Equal(approvalDigest, write.Digests.Approval) {
		return result, false, billingmigration.ErrStaleDigest
	}
	if !expires.After(write.ExecutedAt) {
		return result, false, billingmigration.ErrExpiredApproval
	}
	if write.ExecutedAt.After(deadline) {
		return result, false, billingmigration.ErrRollbackWindow
	}
	if !bytes.Equal(checkpointDigest, write.Digests.Checkpoint) || !bytes.Equal(authorityDigest, write.Digests.Authority) || !bytes.Equal(prerequisiteDigest, write.Digests.RollbackPrerequisites) || !bytes.Equal(bindingScope, scopeDigest) {
		return result, false, billingmigration.ErrStaleRollbackPrerequisites
	}
	if err = verifyRollbackPrerequisites(ctx, tx, input.ProjectID, input.ProgramID, credentialID, credentialStatus, removed, removedAt, capabilityID, capabilityDigest, capabilityAt, sourceID, sourceDigest, sourceAt, providerID, providerDigest, providerAt, write.ExecutedAt); err != nil {
		return result, false, err
	}
	scopes, err := lockAuthorityScopes(ctx, tx, input.ProjectID, input.ProgramID)
	if err != nil {
		return result, false, err
	}
	if !sameScope(input.Scope, environmentID, scopes) {
		return result, false, billingmigration.ErrStaleDigest
	}
	var authorityValues []string
	for _, scope := range scopes {
		if scope.authority != "mosaic" || scope.epoch != input.ExpectedAuthorityEpoch {
			return result, false, billingmigration.ErrAuthorityEpoch
		}
		authorityValues = append(authorityValues, billingmigration.FormatDigest(scope.authorityDigest))
	}
	setDigest, digestErr := billingmigration.AuthoritySetDigest(input.ProgramID, billingmigration.FormatDigest(scopeDigest), authorityValues)
	if digestErr != nil || setDigest != input.ExpectedDigests.Authority {
		return result, false, billingmigration.ErrStaleAuthority
	}
	if err = verifyRollbackMaps(ctx, tx, input.ProjectID, input.ProgramID, input.CheckpointID); err != nil {
		return result, false, err
	}
	if err = lockCurrentPointers(ctx, tx, input.ProjectID, environmentID, scopes); err != nil {
		return result, false, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO billing_migration_scope_current_pointers(project_id,environment_id,application_id,platform,billing_customer_id,current_snapshot_id,authority_epoch,updated_at)
		SELECT project_id,environment_id,application_id,platform,billing_customer_id,snapshot_id,$3,$4 FROM billing_migration_checkpoint_pointer_maps WHERE checkpoint_id=$1 AND program_id=$2 AND pointer_role='rollback_baseline' AND NOT absent_current
		ON CONFLICT(project_id,environment_id,application_id,platform,billing_customer_id) DO UPDATE SET current_snapshot_id=excluded.current_snapshot_id,authority_epoch=excluded.authority_epoch,updated_at=excluded.updated_at`, input.CheckpointID, input.ProgramID, input.ExpectedAuthorityEpoch+1, write.ExecutedAt)
	if err != nil {
		return result, false, err
	}
	_, err = tx.Exec(ctx, `DELETE FROM billing_migration_scope_current_pointers current USING billing_migration_program_scopes scope WHERE scope.program_id=$1 AND current.project_id=scope.project_id AND current.environment_id=scope.environment_id AND current.application_id=scope.application_id AND current.platform=scope.platform AND NOT EXISTS(SELECT 1 FROM billing_migration_checkpoint_pointer_maps map WHERE map.checkpoint_id=$2 AND map.program_id=$1 AND map.pointer_role='rollback_baseline' AND NOT map.absent_current AND map.application_id=current.application_id AND map.platform=current.platform AND map.billing_customer_id=current.billing_customer_id)`, input.ProgramID, input.CheckpointID)
	if err != nil {
		return result, false, err
	}
	for _, scope := range scopes {
		transitionID := billingmigration.DeterministicTransitionID(write.ExecutionID, scope.id)
		td := billingmigration.CanonicalTransitionDigest(input.ProgramID, scope.id, "mosaic", "source_rollback", scope.epoch, scope.epoch+1, "rollback", write.ExecutedAt)
		ad := billingmigration.CanonicalAuthorityDigest(input.ProjectID, environmentID, scope.applicationID, scope.platform, "source_rollback", scope.epoch+1, input.ProgramID)
		tag, e := tx.Exec(ctx, `UPDATE billing_migration_authority_scopes SET current_authority='source_rollback',current_epoch=$3,authority_digest=$4,updated_at=$5 WHERE id=$1 AND project_id=$2 AND current_authority='mosaic' AND current_epoch=$6 AND authority_digest=$7`, scope.id, input.ProjectID, scope.epoch+1, ad, write.ExecutedAt, scope.epoch, scope.authorityDigest)
		if e != nil {
			return result, false, e
		}
		if tag.RowsAffected() != 1 {
			return result, false, billingmigration.ErrConcurrentTransition
		}
		if _, e = tx.Exec(ctx, `INSERT INTO billing_migration_authority_transitions(id,program_id,project_id,authority_scope_id,from_authority,to_authority,from_epoch,to_epoch,transition_kind,transition_digest,transitioned_at) VALUES($1,$2,$3,$4,'mosaic','source_rollback',$5,$6,'rollback',$7,$8)`, transitionID, input.ProgramID, input.ProjectID, scope.id, scope.epoch, scope.epoch+1, td, write.ExecutedAt); e != nil {
			return result, false, e
		}
		if _, e = tx.Exec(ctx, `INSERT INTO billing_migration_transition_outbox(id,program_id,project_id,authority_scope_id,transition_id,event_kind,authority_epoch,status,created_at,updated_at) VALUES('mto_'||substr(md5($1||':'||$2),1,20),$3,$4,$2,$1,'rollback_changed',$5,'pending',$6,$6)`, transitionID, scope.id, input.ProgramID, input.ProjectID, scope.epoch+1, write.ExecutedAt); e != nil {
			return result, false, e
		}
		result.TransitionIDs = append(result.TransitionIDs, transitionID)
	}
	if err = finishExecution(ctx, tx, input.ProjectID, input.ProgramID, input.ExpectedStateVersion, billingmigration.StateStabilizing, "rolled_back", write.ExecutionID, "execute_rollback", input.IdempotencyKey, write.RequestDigest, write.ActorID, input.Reason, len(scopes), input.ExpectedAuthorityEpoch+1, write.ExecutedAt); err != nil {
		return result, false, err
	}
	if err = tx.Commit(ctx); err != nil {
		return result, false, translateExecutionError(err)
	}
	return result, false, nil
}

func verifyCutoverFreshness(ctx context.Context, tx pgx.Tx, projectID, programID, checkpointID string, d billingmigration.ParsedCutoverCommandDigests, now time.Time) error {
	var ready, authoritative, watermarksFresh bool
	var rd []byte
	var assessed time.Time
	if err := tx.QueryRow(ctx, `SELECT ready,authoritative,watermarks_fresh,readiness_digest,assessed_at FROM billing_migration_readiness_assessments WHERE program_id=$1 AND project_id=$2 ORDER BY assessed_at DESC,id DESC LIMIT 1`, programID, projectID).Scan(&ready, &authoritative, &watermarksFresh, &rd, &assessed); err != nil || !ready || !authoritative || !watermarksFresh || !bytes.Equal(rd, d.Readiness) {
		return billingmigration.ErrStaleDigest
	}
	var maxAge int
	var source, provider, shadow, completed time.Time
	var manifest, mapping, evidence, watermark []byte
	if err := tx.QueryRow(ctx, `SELECT policy.watermark_max_age_seconds,delta.source_watermark,delta.provider_watermark,delta.shadow_watermark,delta.completed_at,delta.manifest_digest,delta.mapping_digest,delta.evidence_digest,delta.final_watermark_digest FROM billing_migration_readiness_policies policy CROSS JOIN LATERAL(SELECT * FROM billing_migration_final_deltas WHERE program_id=$1 AND project_id=$2 ORDER BY completed_at DESC,id DESC LIMIT 1)delta WHERE policy.program_id=$1 AND policy.project_id=$2 ORDER BY policy.frozen_at DESC,policy.id DESC LIMIT 1`, programID, projectID).Scan(&maxAge, &source, &provider, &shadow, &completed, &manifest, &mapping, &evidence, &watermark); err != nil {
		return billingmigration.ErrStaleDigest
	}
	if now.Sub(source) > time.Duration(maxAge)*time.Second || now.Sub(provider) > time.Duration(maxAge)*time.Second || now.Sub(shadow) > time.Duration(maxAge)*time.Second || now.Sub(completed) > time.Duration(maxAge)*time.Second || now.Sub(assessed) > time.Duration(maxAge)*time.Second {
		return billingmigration.ErrStaleDigest
	}
	for i, pair := range [][2][]byte{{manifest, d.Manifest}, {mapping, d.Mapping}, {evidence, d.Evidence}, {watermark, d.FinalWatermark}} {
		if !bytes.Equal(pair[0], pair[1]) {
			_ = i
			return billingmigration.ErrStaleDigest
		}
	}
	var invalid bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM billing_migration_cases c WHERE c.program_id=$1 AND c.project_id=$2 AND c.classification IN('critical','blocking') AND c.status NOT IN('resolved','dismissed') AND NOT EXISTS(SELECT 1 FROM billing_migration_source_access_exceptions e WHERE e.case_id=c.id AND e.approved_at<=$3 AND e.expires_at>$3 AND e.identity_ambiguity_count=0 AND e.proposer_actor_id<>e.approver_actor_id))`, programID, projectID, now).Scan(&invalid); err != nil {
		return err
	}
	if invalid {
		return billingmigration.ErrStaleDigest
	}
	return nil
}

func verifyPointerCoverage(ctx context.Context, tx pgx.Tx, projectID, programID, checkpointID string) error {
	var invalid bool
	if err := tx.QueryRow(ctx, `WITH frozen_cohort AS (
		SELECT customer.billing_customer_id
		FROM billing_migration_checkpoints checkpoint
		JOIN billing_migration_final_delta_cohort_sets cohort_set ON cohort_set.program_id=checkpoint.program_id AND cohort_set.project_id=checkpoint.project_id AND cohort_set.cohort_digest=checkpoint.cohort_digest
		JOIN billing_migration_final_delta_cohort_customers customer ON customer.cohort_set_id=cohort_set.id AND customer.program_id=cohort_set.program_id AND customer.project_id=cohort_set.project_id
		WHERE checkpoint.id=$1 AND checkpoint.program_id=$2 AND checkpoint.project_id=$3
	), expected AS (
		SELECT scope.project_id,scope.environment_id,scope.application_id,scope.platform,customer.billing_customer_id,role.pointer_role
		FROM billing_migration_program_scopes scope CROSS JOIN frozen_cohort customer
		CROSS JOIN (VALUES('prepared_activation'::text),('rollback_baseline'::text)) role(pointer_role)
		WHERE scope.program_id=$2 AND scope.project_id=$3
	), actual AS (
		SELECT project_id,environment_id,application_id,platform,billing_customer_id,pointer_role
		FROM billing_migration_checkpoint_pointer_maps WHERE checkpoint_id=$1 AND program_id=$2
	)
	SELECT
		NOT EXISTS(SELECT 1 FROM frozen_cohort)
		OR EXISTS(SELECT * FROM expected EXCEPT SELECT * FROM actual)
		OR EXISTS(SELECT * FROM actual EXCEPT SELECT * FROM expected)
		OR EXISTS(
			SELECT 1 FROM billing_migration_checkpoint_pointer_maps map
			LEFT JOIN customer_entitlement_snapshots snapshot
			  ON snapshot.id=map.snapshot_id AND snapshot.project_id=map.project_id
			 AND snapshot.environment_id=map.environment_id AND snapshot.billing_customer_id=map.billing_customer_id
			WHERE map.checkpoint_id=$1 AND map.program_id=$2 AND (
				map.project_id<>$3
				OR (map.pointer_role='prepared_activation' AND (map.snapshot_id IS NULL OR map.absent_current OR snapshot.id IS NULL))
				OR (map.pointer_role='rollback_baseline' AND (
					(map.absent_current AND map.snapshot_id IS NOT NULL)
					OR (NOT map.absent_current AND (map.snapshot_id IS NULL OR snapshot.id IS NULL))
				))
			)
		)`, checkpointID, programID, projectID).Scan(&invalid); err != nil {
		return billingmigration.ErrPointerCoverage
	}
	if invalid {
		return billingmigration.ErrPointerCoverage
	}
	return nil
}

func verifyRollbackMaps(ctx context.Context, tx pgx.Tx, projectID, programID, checkpointID string) error {
	return verifyPointerCoverage(ctx, tx, projectID, programID, checkpointID)
}

func verifyRollbackPrerequisites(ctx context.Context, tx pgx.Tx, projectID, programID, credentialID, credentialStatus string, removed bool, removedAt *time.Time, capabilityID string, capabilityDigest []byte, capabilityAt time.Time, sourceID string, sourceDigest []byte, sourceAt time.Time, providerID string, providerDigest []byte, providerAt, now time.Time) error {
	if credentialStatus != "active" || removed || removedAt != nil {
		return billingmigration.ErrRollbackPrerequisite
	}
	var status string
	var dbRemoved *time.Time
	var envelope bool
	if err := tx.QueryRow(ctx, `SELECT status,removed_at,(nonce IS NOT NULL AND ciphertext IS NOT NULL) FROM billing_migration_credentials WHERE id=$1 AND project_id=$2`, credentialID, projectID).Scan(&status, &dbRemoved, &envelope); err != nil || status != "active" || dbRemoved != nil || !envelope {
		return billingmigration.ErrRollbackPrerequisite
	}
	var maxAge int
	if err := tx.QueryRow(ctx, `SELECT watermark_max_age_seconds FROM billing_migration_readiness_policies WHERE program_id=$1 AND project_id=$2 ORDER BY frozen_at DESC,id DESC LIMIT 1`, programID, projectID).Scan(&maxAge); err != nil {
		return billingmigration.ErrRollbackPrerequisite
	}
	if now.Sub(capabilityAt) > time.Duration(maxAge)*time.Second || now.Sub(sourceAt) > time.Duration(maxAge)*time.Second || now.Sub(providerAt) > time.Duration(maxAge)*time.Second {
		return billingmigration.ErrRollbackPrerequisite
	}
	var id string
	var raw []byte
	var at time.Time
	if err := tx.QueryRow(ctx, `SELECT id,assessment_digest,assessed_at FROM billing_migration_capability_assessments WHERE program_id=$1 AND project_id=$2 ORDER BY assessed_at DESC,id DESC LIMIT 1`, programID, projectID).Scan(&id, &raw, &at); err != nil || id != capabilityID || !bytes.Equal(raw, capabilityDigest) || !at.Equal(capabilityAt) {
		return billingmigration.ErrRollbackPrerequisite
	}
	for _, v := range []struct {
		kind, id string
		digest   []byte
		at       time.Time
	}{{"source_validation", sourceID, sourceDigest, sourceAt}, {"provider_validation", providerID, providerDigest, providerAt}} {
		if err := tx.QueryRow(ctx, `SELECT id,result_digest,attempted_at FROM billing_migration_validation_attempts WHERE program_id=$1 AND project_id=$2 AND attempt_kind=$3 AND status='succeeded' ORDER BY attempted_at DESC,id DESC LIMIT 1`, programID, projectID, v.kind).Scan(&id, &raw, &at); err != nil || id != v.id || !bytes.Equal(raw, v.digest) || !at.Equal(v.at) {
			return billingmigration.ErrRollbackPrerequisite
		}
	}
	return nil
}

func lockAuthorityScopes(ctx context.Context, tx pgx.Tx, projectID, programID string) ([]lockedScope, error) {
	rows, err := tx.Query(ctx, `SELECT authority.id,scope.application_id,scope.platform,authority.current_authority,authority.current_epoch,authority.authority_digest FROM billing_migration_program_scopes scope JOIN billing_migration_authority_scopes authority ON authority.project_id=scope.project_id AND authority.environment_id=scope.environment_id AND authority.application_id=scope.application_id AND authority.platform=scope.platform WHERE scope.program_id=$1 AND scope.project_id=$2 AND authority.active_program_id=$1 ORDER BY scope.application_id,scope.platform FOR UPDATE OF authority`, programID, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []lockedScope
	for rows.Next() {
		var v lockedScope
		if err = rows.Scan(&v.id, &v.applicationID, &v.platform, &v.authority, &v.epoch, &v.authorityDigest); err != nil {
			return nil, err
		}
		result = append(result, v)
	}
	if len(result) == 0 {
		return nil, billingmigration.ErrAuthorityEpoch
	}
	return result, rows.Err()
}

func lockCurrentPointers(ctx context.Context, tx pgx.Tx, projectID, environmentID string, scopes []lockedScope) error {
	for _, scope := range scopes {
		rows, err := tx.Query(ctx, `SELECT billing_customer_id FROM billing_migration_scope_current_pointers WHERE project_id=$1 AND environment_id=$2 AND application_id=$3 AND platform=$4 ORDER BY billing_customer_id FOR UPDATE`, projectID, environmentID, scope.applicationID, scope.platform)
		if err != nil {
			return err
		}
		rows.Close()
	}
	return nil
}

func sameScope(input billingmigration.Scope, environmentID string, scopes []lockedScope) bool {
	if input.EnvironmentID != environmentID || len(input.Applications) != len(scopes) {
		return false
	}
	for i, v := range scopes {
		if input.Applications[i].ApplicationID != v.applicationID || input.Applications[i].Platform != v.platform {
			return false
		}
	}
	return true
}

func finishExecution(ctx context.Context, tx pgx.Tx, projectID, programID string, expected int64, from, to, executionID, kind, key string, requestDigest []byte, actorID, reason string, scopeCount int, epoch int64, at time.Time) error {
	tag, err := tx.Exec(ctx, `UPDATE billing_migration_programs SET state=$4,state_version=state_version+1,updated_at=$5 WHERE id=$1 AND project_id=$2 AND state_version=$3 AND state=$6`, programID, projectID, expected, to, at, from)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return billingmigration.ErrConcurrentTransition
	}
	if err = storeCommand(ctx, tx, programID, projectID, kind, key, requestDigest, executionID, at); err != nil {
		return err
	}
	var organizationID, environmentID string
	if err = tx.QueryRow(ctx, `SELECT project.organization_id,program.environment_id FROM billing_migration_programs program JOIN projects project ON project.id=program.project_id WHERE program.id=$1 AND program.project_id=$2`, programID, projectID).Scan(&organizationID, &environmentID); err != nil {
		return err
	}
	metadata, _ := json.Marshal(map[string]any{"command": kind, "reason": reason, "scopeCount": scopeCount, "authorityEpoch": epoch, "requestDigest": billingmigration.FormatDigest(requestDigest)})
	_, err = tx.Exec(ctx, `INSERT INTO audit_events(id,actor_id,organization_id,project_id,environment_id,action,resource_type,resource_id,metadata,created_at) VALUES('aud_'||$1,$2,$3,$4,$5,$6,'billing_migration_program',$7,$8,$9)`, executionID, actorID, organizationID, projectID, environmentID, "billing.migration."+kind, programID, metadata, at)
	return err
}

func executionResult(programID, executionID, command, state string, version, epoch int64, at time.Time) billingmigration.AuthorityExecution {
	return billingmigration.AuthorityExecution{ProgramID: programID, ExecutionID: executionID, Command: command, State: state, StateVersion: version, AuthorityEpoch: epoch, ExecutedAt: at}
}
func loadExecutionReplay(ctx context.Context, tx pgx.Tx, programID, projectID, commandKind, key, transitionKind string, result *billingmigration.AuthorityExecution) error {
	if err := tx.QueryRow(ctx, `SELECT created_at FROM billing_migration_command_idempotency WHERE program_id=$1 AND project_id=$2 AND command_kind=$3 AND idempotency_key=$4`, programID, projectID, commandKind, key).Scan(&result.ExecutedAt); err != nil {
		return err
	}
	rows, err := tx.Query(ctx, `SELECT id FROM billing_migration_authority_transitions WHERE program_id=$1 AND project_id=$2 AND transition_kind=$3 AND transitioned_at=$4 ORDER BY authority_scope_id`, programID, projectID, transitionKind, result.ExecutedAt)
	if err != nil {
		return err
	}
	defer rows.Close()
	result.TransitionIDs = nil
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return err
		}
		result.TransitionIDs = append(result.TransitionIDs, id)
	}
	if len(result.TransitionIDs) == 0 {
		return billingmigration.ErrConcurrentTransition
	}
	return rows.Err()
}

func retryExecution(ctx context.Context, operation func() (billingmigration.AuthorityExecution, bool, error)) (billingmigration.AuthorityExecution, bool, error) {
	var result billingmigration.AuthorityExecution
	var replay bool
	var err error
	for attempt := 0; attempt < 3; attempt++ {
		result, replay, err = operation()
		if !isSerializationFailure(err) {
			return result, replay, err
		}
	}
	return result, replay, billingmigration.ErrConcurrentTransition
}
func isSerializationFailure(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "40001"
}
func translateExecutionError(err error) error {
	if isSerializationFailure(err) {
		return err
	}
	return err
}
