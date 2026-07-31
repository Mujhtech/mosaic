package billingmigrationpostgres

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingmigration"
)

var _ billingmigration.CutoverRepository = (*Repository)(nil)

func (r *Repository) PromoteReady(ctx context.Context, projectID, programID string, expected int64, actorID string, now time.Time) (billingmigration.AuthoritativeReadiness, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return billingmigration.AuthoritativeReadiness{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var state string
	if err := tx.QueryRow(ctx, `SELECT state FROM billing_migration_programs WHERE id=$1 AND project_id=$2 AND state_version=$3 FOR UPDATE`, programID, projectID, expected).Scan(&state); errors.Is(err, pgx.ErrNoRows) {
		return billingmigration.AuthoritativeReadiness{}, billingmigration.ErrConflict
	} else if err != nil {
		return billingmigration.AuthoritativeReadiness{}, err
	}
	if state != billingmigration.StateShadowing {
		return billingmigration.AuthoritativeReadiness{}, billingmigration.ErrConflict
	}
	var warningThreshold int64
	var maxAge int
	var policyFrozen time.Time
	var appDigest []byte
	if err := tx.QueryRow(ctx, `SELECT warning_threshold,watermark_max_age_seconds,frozen_at,application_version_digest FROM billing_migration_readiness_policies WHERE program_id=$1 AND project_id=$2 ORDER BY frozen_at DESC,id LIMIT 1`, programID, projectID).Scan(&warningThreshold, &maxAge, &policyFrozen, &appDigest); errors.Is(err, pgx.ErrNoRows) {
		return billingmigration.AuthoritativeReadiness{}, billingmigration.ErrConflict
	} else if err != nil {
		return billingmigration.AuthoritativeReadiness{}, err
	}
	input, err := readinessInputTx(ctx, tx, projectID, programID, now.UTC())
	if err != nil {
		return billingmigration.AuthoritativeReadiness{}, err
	}
	var finalDeltaID string
	var sourceWatermark, providerWatermark, shadowWatermark, completedAt time.Time
	err = tx.QueryRow(ctx, `SELECT id,source_watermark,provider_watermark,shadow_watermark,completed_at FROM billing_migration_final_deltas WHERE program_id=$1 AND project_id=$2 AND state_version=$3 ORDER BY completed_at DESC,id LIMIT 1`, programID, projectID, expected).Scan(&finalDeltaID, &sourceWatermark, &providerWatermark, &shadowWatermark, &completedAt)
	input.FinalDeltaCompleted = err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return billingmigration.AuthoritativeReadiness{}, err
	}
	now = now.UTC()
	freshAfter := now.Add(-time.Duration(maxAge) * time.Second)
	input.WatermarksFresh = input.FinalDeltaCompleted && sourceWatermark.After(freshAfter) && providerWatermark.After(freshAfter) && shadowWatermark.After(freshAfter)
	var sourceFresh bool
	err = tx.QueryRow(ctx, `SELECT assessed_at >= $3 AND capabilities @> ARRAY['read_customers','read_subscriptions']::text[] FROM billing_migration_capability_assessments WHERE program_id=$1 AND project_id=$2 ORDER BY assessed_at DESC,id LIMIT 1`, programID, projectID, policyFrozen).Scan(&sourceFresh)
	if errors.Is(err, pgx.ErrNoRows) {
		sourceFresh = false
	} else if err != nil {
		return billingmigration.AuthoritativeReadiness{}, err
	}
	versionReady, err := versionReadinessTx(ctx, tx, projectID, programID)
	if err != nil {
		return billingmigration.AuthoritativeReadiness{}, err
	}
	input.SupportedVersionsAuthorityAware = versionReady
	cohortDigest, err := freezeFinalDeltaCohort(ctx, tx, projectID, programID, finalDeltaID, now)
	if err != nil {
		return billingmigration.AuthoritativeReadiness{}, err
	}
	assessment, err := billingmigration.AssessReadiness(programID, expected, input)
	if err != nil {
		return billingmigration.AuthoritativeReadiness{}, err
	}
	result, err := billingmigration.AssessAuthoritativeReadiness(programID, expected, assessment, sourceFresh, warningThreshold, billingmigration.FormatDigest(appDigest))
	if err != nil {
		return billingmigration.AuthoritativeReadiness{}, err
	}
	assessment = result.Assessment
	result.CohortDigest = cohortDigest
	readinessRaw, _ := billingmigration.ParseDigest(assessment.ReadinessDigest)
	_, err = tx.Exec(ctx, `INSERT INTO billing_migration_readiness_assessments(id,program_id,project_id,state_version,ready,current_access_mapping_percent,current_access_evidence_percent,critical_count,blocking_count,warning_count,informational_count,final_delta_completed,watermarks_fresh,supported_versions_authority_aware,readiness_digest,assessed_at,authoritative,source_capabilities_fresh,warning_threshold,application_version_digest)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,true,$17,$18,$19) ON CONFLICT(program_id,readiness_digest) DO NOTHING`,
		"mra_"+assessment.ReadinessDigest[7:23], programID, projectID, expected, assessment.Ready, assessment.CurrentAccessMappingPercent, assessment.CurrentAccessEvidencePercent, assessment.Unresolved.Critical, assessment.Unresolved.Blocking, assessment.Unresolved.Warning, assessment.Unresolved.Informational, assessment.FinalDeltaCompleted, assessment.WatermarksFresh, assessment.SupportedVersionsAuthorityAware, readinessRaw, now, sourceFresh, warningThreshold, appDigest)
	if err != nil {
		return billingmigration.AuthoritativeReadiness{}, translate(err, "record authoritative readiness")
	}
	if !assessment.Ready {
		if err := tx.Commit(ctx); err != nil {
			return result, err
		}
		return result, billingmigration.ErrConflict
	}
	command, err := tx.Exec(ctx, `UPDATE billing_migration_programs SET state='ready',state_version=state_version+1,updated_at=$4 WHERE id=$1 AND project_id=$2 AND state_version=$3 AND state='shadowing'`, programID, projectID, expected, now)
	if err != nil {
		return result, err
	}
	if command.RowsAffected() != 1 {
		return result, billingmigration.ErrConflict
	}
	return result, tx.Commit(ctx)
}

func freezeFinalDeltaCohort(ctx context.Context, tx pgx.Tx, projectID, programID, finalDeltaID string, now time.Time) (string, error) {
	if finalDeltaID == "" {
		return "", billingmigration.ErrConflict
	}
	rows, err := tx.Query(ctx, `WITH final_delta AS (SELECT manifest_digest,mapping_digest,completed_at FROM billing_migration_final_deltas WHERE id=$3 AND program_id=$1 AND project_id=$2),
		frozen AS (SELECT mapping.id FROM billing_migration_mapping_sets mapping,final_delta WHERE mapping.program_id=$1 AND mapping.project_id=$2 AND mapping.status='frozen' AND mapping.mapping_digest=final_delta.mapping_digest ORDER BY mapping.version DESC LIMIT 1)
		SELECT DISTINCT customer_id FROM (
			SELECT mapped.target_id customer_id
			FROM billing_migration_source_records source
			JOIN billing_migration_source_manifests manifest ON manifest.id=source.manifest_id AND manifest.program_id=source.program_id AND manifest.project_id=source.project_id
			JOIN final_delta ON final_delta.manifest_digest=manifest.manifest_digest
			JOIN billing_migration_mapping_entries mapped ON mapped.mapping_set_id=(SELECT id FROM frozen)
				AND mapped.source_identifier=source.source_identifier
				AND ((source.source_kind='customer' AND mapped.source_kind IN ('customer_id','original_customer_id'))
					OR (source.source_kind IN ('alias','transfer') AND mapped.source_kind='audited_alias'))
			JOIN billing_customers customer ON customer.id=mapped.target_id AND customer.project_id=source.project_id
			WHERE source.program_id=$1 AND source.project_id=$2 AND source.current_access
			UNION
			SELECT shadow.billing_customer_id FROM billing_migration_shadow_snapshots shadow,final_delta WHERE shadow.program_id=$1 AND shadow.project_id=$2 AND shadow.created_at<=final_delta.completed_at
		) cohort ORDER BY customer_id`, programID, projectID, finalDeltaID)
	if err != nil {
		return "", err
	}
	customers := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return "", err
		}
		customers = append(customers, id)
	}
	rows.Close()
	formatted, err := billingmigration.FinalDeltaCohortDigest(programID, finalDeltaID, customers)
	if err != nil {
		return "", billingmigration.ErrConflict
	}
	raw, _ := billingmigration.ParseDigest(formatted)
	setID := "mcs_" + formatted[7:23]
	_, err = tx.Exec(ctx, `INSERT INTO billing_migration_final_delta_cohort_sets(id,final_delta_id,program_id,project_id,customer_count,cohort_digest,frozen_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(final_delta_id) DO NOTHING`, setID, finalDeltaID, programID, projectID, len(customers), raw, now)
	if err != nil {
		return "", err
	}
	var stored []byte
	if err := tx.QueryRow(ctx, `SELECT cohort_digest FROM billing_migration_final_delta_cohort_sets WHERE final_delta_id=$1 AND program_id=$2 AND project_id=$3`, finalDeltaID, programID, projectID).Scan(&stored); err != nil || !bytes.Equal(stored, raw) {
		return "", billingmigration.ErrConflict
	}
	for _, customerID := range customers {
		_, err = tx.Exec(ctx, `INSERT INTO billing_migration_final_delta_cohort_customers(cohort_set_id,program_id,project_id,billing_customer_id,customer_digest) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, setID, programID, projectID, customerID, raw)
		if err != nil {
			return "", err
		}
	}
	return formatted, nil
}

func versionReadinessTx(ctx context.Context, tx pgx.Tx, projectID, programID string) (bool, error) {
	var scopeCount, policyCount int
	if err := tx.QueryRow(ctx, `SELECT (SELECT count(*) FROM billing_migration_program_scopes WHERE program_id=$1),(SELECT count(*) FROM billing_migration_readiness_policy_scopes WHERE program_id=$1)`, programID).Scan(&scopeCount, &policyCount); err != nil {
		return false, err
	}
	if scopeCount == 0 || policyCount != scopeCount {
		return false, nil
	}
	rows, err := tx.Query(ctx, `SELECT s.application_id,s.platform,ps.minimum_app_version,ps.maximum_app_version,ps.minimum_sdk_version,ps.required_capabilities,ps.serving_requirements_digest,ps.traffic_window_started_at,ps.traffic_window_ended_at,ps.outside_window_accepted,v.application_version,v.supported,v.authority_aware,v.observed_at
		FROM billing_migration_program_scopes s JOIN billing_migration_readiness_policy_scopes ps ON ps.program_id=s.program_id AND ps.application_id=s.application_id AND ps.platform=s.platform
		LEFT JOIN billing_migration_supported_app_versions v ON v.program_id=s.program_id AND v.application_id=s.application_id AND v.platform=s.platform WHERE s.program_id=$1 ORDER BY s.application_id,s.platform,v.application_version`, programID)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	type measured struct {
		app, platform, min, max, minSDK, version string
		required                                 []string
		servingDigest                            []byte
		start, end, observed                     time.Time
		outside, supported, aware                bool
	}
	items := []measured{}
	for rows.Next() {
		var item measured
		var version *string
		var supported, aware *bool
		var observed *time.Time
		if err := rows.Scan(&item.app, &item.platform, &item.min, &item.max, &item.minSDK, &item.required, &item.servingDigest, &item.start, &item.end, &item.outside, &version, &supported, &aware, &observed); err != nil {
			return false, err
		}
		if version == nil || len(item.servingDigest) != 32 || bytes.Equal(item.servingDigest, make([]byte, 32)) {
			return false, nil
		}
		item.version = *version
		item.supported, item.aware, item.observed = *supported, *aware, *observed
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return false, err
	}
	if len(items) == 0 {
		return false, nil
	}
	for _, item := range items {
		expectedServingDigest, err := billingmigration.ServingRequirementsDigest(programID, item.app, item.platform, item.minSDK, item.required)
		if err != nil || !bytes.Equal(item.servingDigest, mustDigest(expectedServingDigest)) {
			return false, nil
		}
		inRange, err := billingmigration.SemanticVersionInRange(item.version, item.min, item.max)
		if err != nil {
			return false, nil
		}
		inWindow := !item.observed.Before(item.start) && !item.observed.After(item.end)
		if !inRange || !inWindow {
			if item.outside {
				continue
			}
			return false, nil
		}
		if !item.supported || !item.aware {
			return false, nil
		}
		obs, err := tx.Query(ctx, `SELECT sdk_version,authority_capabilities FROM billing_migration_v2_sync_observations WHERE program_id=$1 AND project_id=$2 AND application_id=$3 AND platform=$4 AND app_version=$5 AND observed_at BETWEEN $6 AND $7 AND traffic_count>0 AND sync_result='accepted' AND '2'=ANY(supported_contract_versions)`, programID, projectID, item.app, item.platform, item.version, item.start, item.end)
		if err != nil {
			return false, err
		}
		qualified := false
		for obs.Next() {
			var sdk string
			var capabilities []string
			if err := obs.Scan(&sdk, &capabilities); err != nil {
				obs.Close()
				return false, err
			}
			sdkOK, parseErr := billingmigration.SemanticVersionInRange(sdk, item.minSDK, sdk)
			if parseErr == nil && sdkOK && containsAll(capabilities, item.required) {
				qualified = true
			}
		}
		obs.Close()
		if !qualified {
			return false, nil
		}
	}
	return true, nil
}

func containsAll(actual, required []string) bool {
	set := map[string]bool{}
	for _, value := range actual {
		set[value] = true
	}
	for _, value := range required {
		if !set[value] {
			return false
		}
	}
	return true
}

func readinessInputTx(ctx context.Context, tx pgx.Tx, projectID, programID string, now time.Time) (billingmigration.ReadinessInput, error) {
	var input billingmigration.ReadinessInput
	err := tx.QueryRow(ctx, `WITH current_records AS (SELECT id,source_kind,source_identifier,evidence_kind FROM billing_migration_source_records WHERE project_id=$1 AND program_id=$2 AND current_access), frozen_mapping AS (SELECT id FROM billing_migration_mapping_sets WHERE project_id=$1 AND program_id=$2 AND status='frozen' ORDER BY version DESC LIMIT 1), counts AS (SELECT d.classification,count(*) count FROM billing_migration_divergences d LEFT JOIN billing_migration_divergence_resolutions resolution ON resolution.divergence_id=d.id AND resolution.program_id=d.program_id AND resolution.project_id=d.project_id WHERE d.project_id=$1 AND d.program_id=$2 AND resolution.id IS NULL GROUP BY d.classification)
	SELECT CASE WHEN count(*)=0 THEN 0 ELSE 100.0*count(*) FILTER(WHERE EXISTS(SELECT 1 FROM billing_migration_mapping_entries e WHERE e.mapping_set_id=(SELECT id FROM frozen_mapping) AND e.source_identifier=current_records.source_identifier AND ((current_records.source_kind='customer' AND e.source_kind IN ('customer_id','original_customer_id')) OR (current_records.source_kind='alias' AND e.source_kind='audited_alias') OR (current_records.source_kind='subscription' AND e.source_kind IN ('product','entitlement')) OR (current_records.source_kind='transaction' AND e.source_kind='product') OR (current_records.source_kind='transfer' AND e.source_kind='audited_alias'))))/count(*) END,
	CASE WHEN count(*)=0 THEN 0 ELSE 100.0*count(*) FILTER(WHERE evidence_kind IN ('provider_signed','provider_validated') OR EXISTS(
		SELECT 1 FROM billing_migration_source_access_exception_subjects subject
		JOIN billing_migration_source_access_exceptions exception ON exception.id=subject.exception_id AND exception.program_id=subject.program_id AND exception.project_id=subject.project_id
		JOIN billing_migration_mapping_entries mapped ON mapped.mapping_set_id=(SELECT id FROM frozen_mapping) AND mapped.target_id=subject.billing_customer_id AND mapped.source_identifier=current_records.source_identifier
		WHERE subject.source_record_id=current_records.id AND subject.program_id=$2 AND subject.project_id=$1
		AND exception.approved_at<=$3 AND exception.expires_at>$3 AND exception.identity_ambiguity_count=0
		AND (mapped.application_id IS NULL OR (mapped.application_id=exception.application_id AND mapped.platform=exception.platform))
		AND (SELECT count(DISTINCT bounded.billing_customer_id) FROM billing_migration_source_access_exception_subjects bounded WHERE bounded.exception_id=exception.id)=exception.affected_customer_count
	))/count(*) END,
	COALESCE((SELECT count FROM counts WHERE classification='critical'),0),COALESCE((SELECT count FROM counts WHERE classification='blocking'),0),COALESCE((SELECT count FROM counts WHERE classification='warning'),0),COALESCE((SELECT count FROM counts WHERE classification='informational'),0) FROM current_records`, projectID, programID, now).Scan(&input.CurrentAccessMappingPercent, &input.CurrentAccessEvidencePercent, &input.Unresolved.Critical, &input.Unresolved.Blocking, &input.Unresolved.Warning, &input.Unresolved.Informational)
	return input, err
}

func (r *Repository) CreateProposal(ctx context.Context, write billingmigration.ProposalWrite) (billingmigration.CutoverProposal, bool, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return billingmigration.CutoverProposal{}, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if stored, replay, err := commandReplay(ctx, tx, write.Proposal.ProgramID, write.ProjectID, "propose_cutover", write.IdempotencyKey, write.RequestDigest); err != nil {
		return billingmigration.CutoverProposal{}, false, err
	} else if replay {
		proposal, readErr := readProposalTx(ctx, tx, write.ProjectID, write.Proposal.ProgramID, stored)
		if readErr != nil {
			return proposal, true, readErr
		}
		return proposal, true, tx.Commit(ctx)
	}
	p := write.Proposal
	if p.Command == "cutover" {
		if err := verifyPreApprovalDigests(ctx, tx, write.ProjectID, p.ProgramID, p.StateVersion, write.Digests); err != nil {
			return billingmigration.CutoverProposal{}, false, err
		}
	} else if p.Command == "rollback" && write.ExpectedRollback != nil {
		binding, digests, err := deriveRollbackPrerequisites(ctx, tx, write.ProjectID, p.ProgramID, p.StateVersion, p.ProposedAt, *write.ExpectedRollback)
		if err != nil {
			return billingmigration.CutoverProposal{}, false, err
		}
		p.RollbackBinding, p.Digests, write.Digests = &binding, formattedDigests(digests), digests
	} else {
		return billingmigration.CutoverProposal{}, false, billingmigration.ErrInvalid
	}
	_, err = tx.Exec(ctx, `INSERT INTO billing_migration_cutover_proposals(id,program_id,project_id,state_version,command,proposer_actor_id,reason,scope_digest,manifest_digest,mapping_digest,policy_digest,evidence_digest,readiness_digest,final_watermark_digest,application_version_digest,proposal_digest,status,proposed_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'pending',$17,$18)`, p.ProposalID, p.ProgramID, write.ProjectID, p.StateVersion, p.Command, p.ProposerActorID, p.Reason, write.Digests.Scope, write.Digests.Manifest, write.Digests.Mapping, write.Digests.Policy, write.Digests.Evidence, write.Digests.Readiness, write.Digests.FinalWatermark, write.Digests.ApplicationVersion, write.ProposalDigest, p.ProposedAt, p.ExpiresAt)
	if err != nil {
		return p, false, translate(err, "create cutover proposal")
	}
	if p.Command == "rollback" {
		checkpoint, authority, prerequisites, scope, parseErr := p.RollbackBinding.Parse()
		if parseErr != nil {
			return p, false, billingmigration.ErrInvalid
		}
		b := p.RollbackBinding
		transition, _ := billingmigration.ParseDigest(b.CutoverTransitionDigest)
		capability, _ := billingmigration.ParseDigest(b.CapabilityAssessmentDigest)
		sourceValidation, _ := billingmigration.ParseDigest(b.SourceValidationDigest)
		providerValidation, _ := billingmigration.ParseDigest(b.ProviderValidationDigest)
		_, err = tx.Exec(ctx, `INSERT INTO billing_migration_rollback_proposal_bindings(proposal_id,program_id,project_id,checkpoint_id,checkpoint_digest,authority_digest,rollback_prerequisites_digest,scope_digest,cutover_transition_id,cutover_transition_digest,cutover_epoch,cutover_transitioned_at,rollback_deadline,credential_id,credential_status,credential_removed,credential_removed_at,capability_assessment_id,capability_assessment_digest,capability_assessed_at,source_validation_id,source_validation_digest,source_validated_at,provider_validation_id,provider_validation_digest,provider_validated_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)`, p.ProposalID, p.ProgramID, write.ProjectID, b.CheckpointID, checkpoint, authority, prerequisites, scope, b.CutoverTransitionID, transition, b.CutoverEpoch, b.CutoverTransitionedAt, b.RollbackDeadline, b.CredentialID, b.CredentialStatus, b.CredentialRemoved, b.CredentialRemovedAt, b.CapabilityAssessmentID, capability, b.CapabilityAssessedAt, b.SourceValidationID, sourceValidation, b.SourceValidatedAt, b.ProviderValidationID, providerValidation, b.ProviderValidatedAt, p.ProposedAt)
		if err != nil {
			return p, false, translate(err, "bind rollback proposal")
		}
	}
	if err = storeCommand(ctx, tx, p.ProgramID, write.ProjectID, "propose_cutover", write.IdempotencyKey, write.RequestDigest, p.ProposalID, p.ProposedAt); err != nil {
		return p, false, err
	}
	var organizationID, environmentID string
	if err := tx.QueryRow(ctx, `SELECT pr.organization_id,mp.environment_id FROM billing_migration_programs mp JOIN projects pr ON pr.id=mp.project_id WHERE mp.id=$1 AND mp.project_id=$2`, p.ProgramID, write.ProjectID).Scan(&organizationID, &environmentID); err != nil {
		return p, false, err
	}
	metadata, _ := json.Marshal(map[string]any{"command": p.Command, "proposalDigest": p.ProposalDigest, "reason": p.Reason})
	if _, err := tx.Exec(ctx, `INSERT INTO audit_events(id,actor_id,organization_id,project_id,environment_id,action,resource_type,resource_id,metadata,created_at) VALUES($1,$2,$3,$4,$5,'billing.migration.cutover.proposed','billing_migration_cutover_proposal',$6,$7,$8)`, "aud_"+p.ProposalID, p.ProposerActorID, organizationID, write.ProjectID, environmentID, p.ProposalID, metadata, p.ProposedAt); err != nil {
		return p, false, err
	}
	return p, false, tx.Commit(ctx)
}

func (r *Repository) Proposal(ctx context.Context, projectID, programID, proposalID string) (billingmigration.CutoverProposal, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return billingmigration.CutoverProposal{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	p, err := readProposalTx(ctx, tx, projectID, programID, proposalID)
	if err != nil {
		return p, err
	}
	return p, tx.Commit(ctx)
}

func (r *Repository) ApproveProposal(ctx context.Context, write billingmigration.ApprovalWrite) (billingmigration.MigrationApproval, bool, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return billingmigration.MigrationApproval{}, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	a := write.Approval
	if stored, replay, err := commandReplay(ctx, tx, a.ProgramID, write.ProjectID, "approve_cutover", write.IdempotencyKey, write.RequestDigest); err != nil {
		return a, false, err
	} else if replay {
		var digest []byte
		err = tx.QueryRow(ctx, `SELECT id,program_id,state_version,command,proposer_actor_id,approver_actor_id,approval_digest,approved_at,expires_at FROM billing_migration_approvals WHERE id=$1 AND project_id=$2`, stored, write.ProjectID).Scan(&a.ApprovalID, &a.ProgramID, &a.StateVersion, &a.Command, &a.ProposerActorID, &a.ApproverActorID, &digest, &a.ApprovedAt, &a.ExpiresAt)
		a.ApprovalDigest = billingmigration.FormatDigest(digest)
		if err != nil {
			return a, true, err
		}
		return a, true, tx.Commit(ctx)
	}
	p, err := readProposalForUpdate(ctx, tx, write.ProjectID, a.ProgramID, write.ProposalID)
	if err != nil {
		return a, false, err
	}
	now := a.ApprovedAt
	if p.Status != "pending" || !p.ExpiresAt.After(now) {
		if p.Status == "pending" {
			_, _ = tx.Exec(ctx, `UPDATE billing_migration_cutover_proposals SET status='expired' WHERE id=$1`, p.ProposalID)
			_ = tx.Commit(ctx)
		}
		return a, false, billingmigration.ErrConflict
	}
	digests, _ := p.Digests.Parse()
	if err := verifyProposalPrerequisites(ctx, tx, write.ProjectID, p, digests, now); err != nil {
		_, _ = tx.Exec(ctx, `UPDATE billing_migration_cutover_proposals SET status='invalidated',invalidated_at=$2 WHERE id=$1`, p.ProposalID, now)
		_ = tx.Commit(ctx)
		return a, false, err
	}
	var mode string
	if err := tx.QueryRow(ctx, `SELECT e.mode FROM billing_migration_programs p JOIN environments e ON e.id=p.environment_id AND e.project_id=p.project_id WHERE p.id=$1 AND p.project_id=$2`, a.ProgramID, write.ProjectID).Scan(&mode); err != nil {
		return a, false, err
	}
	if mode == "production" && p.ProposerActorID == a.ApproverActorID {
		return a, false, billingmigration.ErrForbidden
	}
	if a.ProposerActorID != p.ProposerActorID || a.Command != p.Command || a.ExpiresAt != p.ExpiresAt {
		return a, false, billingmigration.ErrConflict
	}
	_, err = tx.Exec(ctx, `INSERT INTO billing_migration_approvals(id,program_id,project_id,proposal_id,state_version,command,proposer_actor_id,approver_actor_id,approval_digest,approved_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, a.ApprovalID, a.ProgramID, write.ProjectID, p.ProposalID, a.StateVersion, a.Command, a.ProposerActorID, a.ApproverActorID, write.ApprovalDigest, a.ApprovedAt, a.ExpiresAt)
	if err != nil {
		return a, false, translate(err, "approve cutover proposal")
	}
	_, err = tx.Exec(ctx, `UPDATE billing_migration_cutover_proposals SET status='approved' WHERE id=$1 AND status='pending'`, p.ProposalID)
	if err != nil {
		return a, false, err
	}
	if err = storeCommand(ctx, tx, a.ProgramID, write.ProjectID, "approve_cutover", write.IdempotencyKey, write.RequestDigest, a.ApprovalID, a.ApprovedAt); err != nil {
		return a, false, err
	}
	return a, false, tx.Commit(ctx)
}

func (r *Repository) CreateCheckpoint(ctx context.Context, write billingmigration.CheckpointWrite) (billingmigration.MigrationCheckpoint, bool, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return billingmigration.MigrationCheckpoint{}, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	c := write.Checkpoint
	if stored, replay, err := commandReplay(ctx, tx, c.ProgramID, write.ProjectID, "create_checkpoint", write.IdempotencyKey, write.RequestDigest); err != nil {
		return c, false, err
	} else if replay {
		err = scanCheckpoint(tx.QueryRow(ctx, checkpointSelect+` WHERE c.id=$1 AND c.project_id=$2`, stored, write.ProjectID), &c)
		if err != nil {
			return c, true, err
		}
		return c, true, tx.Commit(ctx)
	}
	if err := verifyPreApprovalDigests(ctx, tx, write.ProjectID, c.ProgramID, c.StateVersion, write.Digests); err != nil {
		invalidateApproval(ctx, tx, write.ApprovalID, c.CreatedAt)
		_ = tx.Commit(ctx)
		return c, false, billingmigration.ErrConflict
	}
	var approvalDigest []byte
	var expires time.Time
	var status string
	err = tx.QueryRow(ctx, `SELECT a.approval_digest,a.expires_at,p.status FROM billing_migration_approvals a JOIN billing_migration_cutover_proposals p ON p.id=a.proposal_id WHERE a.id=$1 AND a.program_id=$2 AND a.project_id=$3 FOR UPDATE`, write.ApprovalID, c.ProgramID, write.ProjectID).Scan(&approvalDigest, &expires, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, false, billingmigration.ErrConflict
	} else if err != nil {
		return c, false, err
	}
	if !bytes.Equal(approvalDigest, write.ApprovalDigest) || status != "approved" || !expires.After(c.CreatedAt) {
		invalidateApproval(ctx, tx, write.ApprovalID, c.CreatedAt)
		_ = tx.Commit(ctx)
		return c, false, billingmigration.ErrConflict
	}
	var epoch int64
	var scopeCount, authorityCount, distinctEpochs int
	err = tx.QueryRow(ctx, `SELECT (SELECT count(*) FROM billing_migration_program_scopes WHERE program_id=$1),count(a.id) FILTER(WHERE a.active_program_id=$1),count(DISTINCT a.current_epoch) FILTER(WHERE a.active_program_id=$1),COALESCE(min(a.current_epoch) FILTER(WHERE a.active_program_id=$1),0) FROM billing_migration_program_scopes s LEFT JOIN billing_migration_authority_scopes a ON a.project_id=s.project_id AND a.environment_id=s.environment_id AND a.application_id=s.application_id AND a.platform=s.platform WHERE s.program_id=$1`, c.ProgramID).Scan(&scopeCount, &authorityCount, &distinctEpochs, &epoch)
	if err != nil {
		return c, false, err
	}
	if scopeCount == 0 || authorityCount != scopeCount || distinctEpochs != 1 {
		return c, false, billingmigration.ErrConflict
	}
	c.AuthorityEpoch = epoch
	var cohortSetID string
	var finalDeltaJobID string
	var finalDeltaGeneration int64
	var cohortDigest []byte
	var cohortCustomers int
	if err := tx.QueryRow(ctx, `SELECT set.id,set.cohort_digest,set.customer_count,job.id,job.lease_generation FROM billing_migration_final_delta_cohort_sets set JOIN billing_migration_final_deltas delta ON delta.id=set.final_delta_id JOIN billing_migration_final_delta_jobs job ON job.result_final_delta_id=delta.id AND job.program_id=set.program_id WHERE set.program_id=$1 AND set.project_id=$2 AND job.status='completed' ORDER BY delta.completed_at DESC,delta.id DESC LIMIT 1`, c.ProgramID, write.ProjectID).Scan(&cohortSetID, &cohortDigest, &cohortCustomers, &finalDeltaJobID, &finalDeltaGeneration); err != nil || !bytes.Equal(cohortDigest, write.CohortDigest) {
		return c, false, billingmigration.ErrConflict
	}
	c.CohortDigest = billingmigration.FormatDigest(cohortDigest)
	var preparedCount int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM billing_migration_final_delta_prepared_pointers WHERE final_delta_job_id=$1 AND lease_generation=$2`, finalDeltaJobID, finalDeltaGeneration).Scan(&preparedCount); err != nil {
		return c, false, err
	}
	if cohortCustomers == 0 || preparedCount != scopeCount*cohortCustomers {
		return c, false, billingmigration.ErrConflict
	}
	var invalidCoverage bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM billing_migration_final_delta_prepared_pointers p WHERE p.final_delta_job_id=$3 AND p.lease_generation=$4 AND NOT EXISTS(SELECT 1 FROM billing_migration_final_delta_cohort_customers c WHERE c.cohort_set_id=$2 AND c.billing_customer_id=p.billing_customer_id)) OR EXISTS(SELECT 1 FROM billing_migration_program_scopes s CROSS JOIN billing_migration_final_delta_cohort_customers c WHERE s.program_id=$1 AND c.cohort_set_id=$2 AND NOT EXISTS(SELECT 1 FROM billing_migration_final_delta_prepared_pointers p WHERE p.final_delta_job_id=$3 AND p.lease_generation=$4 AND p.application_id=s.application_id AND p.platform=s.platform AND p.billing_customer_id=c.billing_customer_id))`, c.ProgramID, cohortSetID, finalDeltaJobID, finalDeltaGeneration).Scan(&invalidCoverage); err != nil {
		return c, false, err
	}
	if invalidCoverage {
		return c, false, billingmigration.ErrConflict
	}
	var scope billingmigration.Scope
	scope.ProjectID = write.ProjectID
	err = tx.QueryRow(ctx, `SELECT environment_id FROM billing_migration_programs WHERE id=$1 AND project_id=$2`, c.ProgramID, write.ProjectID).Scan(&scope.EnvironmentID)
	if err != nil {
		return c, false, err
	}
	rows, err := tx.Query(ctx, `SELECT application_id,platform FROM billing_migration_program_scopes WHERE program_id=$1 ORDER BY application_id,platform`, c.ProgramID)
	if err != nil {
		return c, false, err
	}
	for rows.Next() {
		var item billingmigration.ScopeItem
		if err := rows.Scan(&item.ApplicationID, &item.Platform); err != nil {
			rows.Close()
			return c, false, err
		}
		scope.Applications = append(scope.Applications, item)
	}
	rows.Close()
	c.Scope = scope
	err = tx.QueryRow(ctx, `SELECT source_watermark,provider_watermark,shadow_watermark FROM billing_migration_final_deltas WHERE program_id=$1 AND project_id=$2 ORDER BY completed_at DESC,id LIMIT 1`, c.ProgramID, write.ProjectID).Scan(&c.SourceWatermark, &c.ProviderWatermark, &c.ShadowWatermark)
	if err != nil {
		return c, false, billingmigration.ErrConflict
	}
	expectedStateVersion := c.StateVersion
	c.StateVersion++
	_, err = tx.Exec(ctx, `INSERT INTO billing_migration_checkpoints(id,program_id,project_id,state_version,authority_epoch,source_watermark,provider_watermark,shadow_watermark,scope_digest,manifest_digest,mapping_digest,policy_digest,evidence_digest,readiness_digest,final_watermark_digest,application_version_digest,approval_digest,checkpoint_digest,created_at,cohort_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`, c.CheckpointID, c.ProgramID, write.ProjectID, c.StateVersion, c.AuthorityEpoch, c.SourceWatermark, c.ProviderWatermark, c.ShadowWatermark, write.Digests.Scope, write.Digests.Manifest, write.Digests.Mapping, write.Digests.Policy, write.Digests.Evidence, write.Digests.Readiness, write.Digests.FinalWatermark, write.Digests.ApplicationVersion, write.ApprovalDigest, write.CheckpointDigest, c.CreatedAt, write.CohortDigest)
	if err != nil {
		return c, false, translate(err, "create migration checkpoint")
	}
	_, err = tx.Exec(ctx, `INSERT INTO billing_migration_checkpoint_pointer_maps(id,checkpoint_id,program_id,project_id,environment_id,application_id,platform,billing_customer_id,pointer_role,snapshot_id,absent_current,pointer_digest)
		SELECT 'mcm_'||md5($1||':activation:'||p.application_id||':'||p.platform||':'||p.billing_customer_id),$1,p.program_id,p.project_id,p.environment_id,p.application_id,p.platform,p.billing_customer_id,'prepared_activation',p.prepared_snapshot_id,false,p.prepared_digest
		FROM billing_migration_final_delta_prepared_pointers p JOIN billing_migration_final_delta_cohort_customers cohort ON cohort.cohort_set_id=$3 AND cohort.billing_customer_id=p.billing_customer_id WHERE p.program_id=$2 AND p.final_delta_job_id=$4 AND p.lease_generation=$5
		UNION ALL
		SELECT 'mcm_'||md5($1||':rollback:'||p.application_id||':'||p.platform||':'||p.billing_customer_id),$1,p.program_id,p.project_id,p.environment_id,p.application_id,p.platform,p.billing_customer_id,'rollback_baseline',current.current_snapshot_id,(current.current_snapshot_id IS NULL),decode(md5($1||':rollback:'||p.application_id||':'||p.platform||':'||p.billing_customer_id||':'||COALESCE(current.current_snapshot_id,'absent'))||md5(COALESCE(current.current_snapshot_id,'absent')||':'||$1),'hex')
		FROM billing_migration_final_delta_prepared_pointers p LEFT JOIN billing_migration_scope_current_pointers current ON current.project_id=p.project_id AND current.environment_id=p.environment_id AND current.application_id=p.application_id AND current.platform=p.platform AND current.billing_customer_id=p.billing_customer_id
		JOIN billing_migration_final_delta_cohort_customers cohort ON cohort.cohort_set_id=$3 AND cohort.billing_customer_id=p.billing_customer_id WHERE p.program_id=$2 AND p.final_delta_job_id=$4 AND p.lease_generation=$5`, c.CheckpointID, c.ProgramID, cohortSetID, finalDeltaJobID, finalDeltaGeneration)
	if err != nil {
		return c, false, translate(err, "snapshot checkpoint pointers")
	}
	if err = storeCommand(ctx, tx, c.ProgramID, write.ProjectID, "create_checkpoint", write.IdempotencyKey, write.RequestDigest, c.CheckpointID, c.CreatedAt); err != nil {
		return c, false, err
	}
	tag, err := tx.Exec(ctx, `UPDATE billing_migration_programs SET state='cutover_pending',state_version=state_version+1,updated_at=$4 WHERE id=$1 AND project_id=$2 AND state='ready' AND state_version=$3`, c.ProgramID, write.ProjectID, expectedStateVersion, c.CreatedAt)
	if err != nil {
		return c, false, err
	}
	if tag.RowsAffected() != 1 {
		return c, false, billingmigration.ErrConflict
	}
	return c, false, tx.Commit(ctx)
}

func commandReplay(ctx context.Context, tx pgx.Tx, programID, projectID, commandKind, key string, requestDigest []byte) (string, bool, error) {
	var resourceID string
	var storedDigest []byte
	err := tx.QueryRow(ctx, `SELECT resource_id,request_digest FROM billing_migration_command_idempotency WHERE program_id=$1 AND project_id=$2 AND command_kind=$3 AND idempotency_key=$4`, programID, projectID, commandKind, key).Scan(&resourceID, &storedDigest)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	if !bytes.Equal(storedDigest, requestDigest) {
		return "", false, billingmigration.ErrConflict
	}
	return resourceID, true, nil
}

func storeCommand(ctx context.Context, tx pgx.Tx, programID, projectID, commandKind, key string, requestDigest []byte, resourceID string, createdAt time.Time) error {
	_, err := tx.Exec(ctx, `INSERT INTO billing_migration_command_idempotency(id,program_id,project_id,command_kind,idempotency_key,request_digest,resource_id,created_at) VALUES('mci_'||md5($1||':'||$3||':'||$4),$1,$2,$3,$4,$5,$6,$7)`, programID, projectID, commandKind, key, requestDigest, resourceID, createdAt)
	if err == nil {
		return nil
	}
	return translate(err, "store cutover command idempotency")
}

func readProposalTx(ctx context.Context, tx pgx.Tx, projectID, programID, proposalID string) (billingmigration.CutoverProposal, error) {
	return readProposal(ctx, tx, projectID, programID, proposalID, false)
}

func readProposalForUpdate(ctx context.Context, tx pgx.Tx, projectID, programID, proposalID string) (billingmigration.CutoverProposal, error) {
	return readProposal(ctx, tx, projectID, programID, proposalID, true)
}

func readProposal(ctx context.Context, tx pgx.Tx, projectID, programID, proposalID string, lock bool) (billingmigration.CutoverProposal, error) {
	query := `SELECT id,program_id,state_version,command,proposer_actor_id,reason,scope_digest,manifest_digest,mapping_digest,policy_digest,evidence_digest,readiness_digest,final_watermark_digest,application_version_digest,proposal_digest,status,proposed_at,expires_at FROM billing_migration_cutover_proposals WHERE id=$1 AND program_id=$2 AND project_id=$3`
	if lock {
		query += ` FOR UPDATE`
	}
	var p billingmigration.CutoverProposal
	var scope, manifest, mapping, policy, evidence, readiness, watermark, appVersion, proposal []byte
	err := tx.QueryRow(ctx, query, proposalID, programID, projectID).Scan(&p.ProposalID, &p.ProgramID, &p.StateVersion, &p.Command, &p.ProposerActorID, &p.Reason, &scope, &manifest, &mapping, &policy, &evidence, &readiness, &watermark, &appVersion, &proposal, &p.Status, &p.ProposedAt, &p.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return p, billingmigration.ErrNotFound
	}
	if err != nil {
		return p, err
	}
	p.Digests = billingmigration.PreApprovalDigests{Scope: billingmigration.FormatDigest(scope), Manifest: billingmigration.FormatDigest(manifest), Mapping: billingmigration.FormatDigest(mapping), Policy: billingmigration.FormatDigest(policy), Evidence: billingmigration.FormatDigest(evidence), Readiness: billingmigration.FormatDigest(readiness), FinalWatermark: billingmigration.FormatDigest(watermark), ApplicationVersion: billingmigration.FormatDigest(appVersion)}
	p.ProposalDigest = billingmigration.FormatDigest(proposal)
	if p.Command == "rollback" {
		var binding billingmigration.RollbackProposalBinding
		var checkpoint, authority, prerequisites, bindingScope []byte
		var transition, capability, sourceValidation, providerValidation []byte
		if err := tx.QueryRow(ctx, `SELECT checkpoint_id,checkpoint_digest,authority_digest,rollback_prerequisites_digest,scope_digest,cutover_transition_id,cutover_transition_digest,cutover_epoch,cutover_transitioned_at,rollback_deadline,credential_id,credential_status,credential_removed,credential_removed_at,capability_assessment_id,capability_assessment_digest,capability_assessed_at,source_validation_id,source_validation_digest,source_validated_at,provider_validation_id,provider_validation_digest,provider_validated_at FROM billing_migration_rollback_proposal_bindings WHERE proposal_id=$1 AND program_id=$2 AND project_id=$3`, proposalID, programID, projectID).Scan(&binding.CheckpointID, &checkpoint, &authority, &prerequisites, &bindingScope, &binding.CutoverTransitionID, &transition, &binding.CutoverEpoch, &binding.CutoverTransitionedAt, &binding.RollbackDeadline, &binding.CredentialID, &binding.CredentialStatus, &binding.CredentialRemoved, &binding.CredentialRemovedAt, &binding.CapabilityAssessmentID, &capability, &binding.CapabilityAssessedAt, &binding.SourceValidationID, &sourceValidation, &binding.SourceValidatedAt, &binding.ProviderValidationID, &providerValidation, &binding.ProviderValidatedAt); err != nil {
			return p, err
		}
		binding.CheckpointDigest = billingmigration.FormatDigest(checkpoint)
		binding.AuthorityDigest = billingmigration.FormatDigest(authority)
		binding.RollbackPrerequisitesDigest = billingmigration.FormatDigest(prerequisites)
		binding.ScopeDigest = billingmigration.FormatDigest(bindingScope)
		binding.CutoverTransitionDigest = billingmigration.FormatDigest(transition)
		binding.CapabilityAssessmentDigest = billingmigration.FormatDigest(capability)
		binding.SourceValidationDigest = billingmigration.FormatDigest(sourceValidation)
		binding.ProviderValidationDigest = billingmigration.FormatDigest(providerValidation)
		p.RollbackBinding = &binding
	}
	return p, nil
}

func verifyProposalPrerequisites(ctx context.Context, tx pgx.Tx, projectID string, proposal billingmigration.CutoverProposal, digests billingmigration.ParsedDigests, operationAt time.Time) error {
	if proposal.Command == "cutover" {
		return verifyPreApprovalDigests(ctx, tx, projectID, proposal.ProgramID, proposal.StateVersion, digests)
	}
	if proposal.Command != "rollback" || proposal.RollbackBinding == nil {
		return billingmigration.ErrInvalid
	}
	expected := billingmigration.RollbackExpectedBinding{CheckpointID: proposal.RollbackBinding.CheckpointID, CheckpointDigest: proposal.RollbackBinding.CheckpointDigest, AuthorityDigest: proposal.RollbackBinding.AuthorityDigest, RollbackPrerequisitesDigest: proposal.RollbackBinding.RollbackPrerequisitesDigest}
	_, _, err := deriveRollbackPrerequisites(ctx, tx, projectID, proposal.ProgramID, proposal.StateVersion, operationAt, expected)
	return err
}

func deriveRollbackPrerequisites(ctx context.Context, tx pgx.Tx, projectID, programID string, stateVersion int64, operationAt time.Time, expected billingmigration.RollbackExpectedBinding) (billingmigration.RollbackProposalBinding, billingmigration.ParsedDigests, error) {
	var binding billingmigration.RollbackProposalBinding
	var d billingmigration.ParsedDigests
	var state, credentialID string
	var rollbackDays int
	if err := tx.QueryRow(ctx, `SELECT state,scope_digest,credential_id,rollback_window_days FROM billing_migration_programs WHERE id=$1 AND project_id=$2 AND state_version=$3 FOR UPDATE`, programID, projectID, stateVersion).Scan(&state, &d.Scope, &credentialID, &rollbackDays); errors.Is(err, pgx.ErrNoRows) || state != billingmigration.StateStabilizing {
		return binding, d, billingmigration.ErrStaleRollbackPrerequisites
	} else if err != nil {
		return binding, d, err
	}
	binding.CheckpointID, binding.CheckpointDigest = expected.CheckpointID, expected.CheckpointDigest
	var checkpoint []byte
	if err := tx.QueryRow(ctx, `SELECT checkpoint_digest,manifest_digest,mapping_digest,policy_digest,evidence_digest,readiness_digest,final_watermark_digest,application_version_digest FROM billing_migration_checkpoints WHERE id=$1 AND program_id=$2 AND project_id=$3`, expected.CheckpointID, programID, projectID).Scan(&checkpoint, &d.Manifest, &d.Mapping, &d.Policy, &d.Evidence, &d.Readiness, &d.FinalWatermark, &d.ApplicationVersion); errors.Is(err, pgx.ErrNoRows) || !bytes.Equal(checkpoint, mustDigest(expected.CheckpointDigest)) {
		return binding, d, billingmigration.ErrStaleCheckpoint
	} else if err != nil {
		return binding, d, err
	}
	binding.ScopeDigest = billingmigration.FormatDigest(d.Scope)
	rows, err := tx.Query(ctx, `SELECT authority.authority_digest,authority.current_epoch FROM billing_migration_program_scopes scope JOIN billing_migration_authority_scopes authority ON authority.project_id=scope.project_id AND authority.environment_id=scope.environment_id AND authority.application_id=scope.application_id AND authority.platform=scope.platform AND authority.active_program_id=scope.program_id AND authority.current_authority='mosaic' WHERE scope.program_id=$1 AND scope.project_id=$2 ORDER BY scope.application_id,scope.platform`, programID, projectID)
	if err != nil {
		return binding, d, err
	}
	var authorities []string
	var authorityEpoch *int64
	for rows.Next() {
		var raw []byte
		var epoch int64
		if err := rows.Scan(&raw, &epoch); err != nil {
			rows.Close()
			return binding, d, err
		}
		if authorityEpoch != nil && *authorityEpoch != epoch {
			rows.Close()
			return binding, d, billingmigration.ErrStaleAuthority
		}
		if authorityEpoch == nil {
			authorityEpoch = &epoch
		}
		authorities = append(authorities, billingmigration.FormatDigest(raw))
	}
	rows.Close()
	var scopeCount, activeCount int
	if err := tx.QueryRow(ctx, `SELECT (SELECT count(*) FROM billing_migration_program_scopes WHERE program_id=$1 AND project_id=$2),(SELECT count(*) FROM billing_migration_authority_scopes WHERE active_program_id=$1 AND project_id=$2 AND current_authority='mosaic')`, programID, projectID).Scan(&scopeCount, &activeCount); err != nil {
		return binding, d, err
	}
	if scopeCount == 0 || len(authorities) != scopeCount || activeCount != scopeCount {
		return binding, d, billingmigration.ErrStaleAuthority
	}
	binding.AuthorityDigest, err = billingmigration.AuthoritySetDigest(programID, binding.ScopeDigest, authorities)
	if err != nil || binding.AuthorityDigest != expected.AuthorityDigest {
		return binding, d, billingmigration.ErrStaleAuthority
	}
	var transitionDigest []byte
	var transitionCount, epochCount, timeCount int
	if err := tx.QueryRow(ctx, `SELECT count(*),count(DISTINCT to_epoch),count(DISTINCT transitioned_at),max(to_epoch),max(transitioned_at) FROM billing_migration_authority_transitions WHERE program_id=$1 AND project_id=$2 AND transition_kind='cutover'`, programID, projectID).Scan(&transitionCount, &epochCount, &timeCount, &binding.CutoverEpoch, &binding.CutoverTransitionedAt); err != nil || transitionCount != scopeCount || epochCount != 1 || timeCount != 1 {
		return binding, d, billingmigration.ErrStaleAuthority
	}
	if authorityEpoch == nil || *authorityEpoch != binding.CutoverEpoch {
		return binding, d, billingmigration.ErrStaleAuthority
	}
	if err := tx.QueryRow(ctx, `SELECT id,transition_digest FROM billing_migration_authority_transitions WHERE program_id=$1 AND project_id=$2 AND transition_kind='cutover' ORDER BY id DESC LIMIT 1`, programID, projectID).Scan(&binding.CutoverTransitionID, &transitionDigest); err != nil {
		return binding, d, billingmigration.ErrStaleAuthority
	}
	binding.CutoverTransitionDigest = billingmigration.FormatDigest(transitionDigest)
	binding.RollbackDeadline = binding.CutoverTransitionedAt.Add(time.Duration(rollbackDays) * 24 * time.Hour)
	if operationAt.After(binding.RollbackDeadline) {
		return binding, d, billingmigration.ErrStaleRollbackPrerequisites
	}
	binding.CredentialID = credentialID
	var envelopePresent bool
	if err := tx.QueryRow(ctx, `SELECT status,(removed_at IS NOT NULL),removed_at,(nonce IS NOT NULL AND ciphertext IS NOT NULL) FROM billing_migration_credentials WHERE id=$1 AND project_id=$2`, credentialID, projectID).Scan(&binding.CredentialStatus, &binding.CredentialRemoved, &binding.CredentialRemovedAt, &envelopePresent); err != nil {
		return binding, d, billingmigration.ErrStaleRollbackPrerequisites
	}
	if binding.CredentialStatus != "active" || binding.CredentialRemoved || binding.CredentialRemovedAt != nil || !envelopePresent {
		return binding, d, billingmigration.ErrStaleRollbackPrerequisites
	}
	var raw []byte
	if err := tx.QueryRow(ctx, `SELECT id,assessment_digest,assessed_at FROM billing_migration_capability_assessments WHERE program_id=$1 AND project_id=$2 ORDER BY assessed_at DESC,id DESC LIMIT 1`, programID, projectID).Scan(&binding.CapabilityAssessmentID, &raw, &binding.CapabilityAssessedAt); err != nil {
		return binding, d, billingmigration.ErrStaleRollbackPrerequisites
	}
	binding.CapabilityAssessmentDigest = billingmigration.FormatDigest(raw)
	if err := tx.QueryRow(ctx, `SELECT id,result_digest,attempted_at FROM billing_migration_validation_attempts WHERE program_id=$1 AND project_id=$2 AND attempt_kind='source_validation' AND status='succeeded' ORDER BY attempted_at DESC,id DESC LIMIT 1`, programID, projectID).Scan(&binding.SourceValidationID, &raw, &binding.SourceValidatedAt); err != nil {
		return binding, d, billingmigration.ErrStaleRollbackPrerequisites
	}
	binding.SourceValidationDigest = billingmigration.FormatDigest(raw)
	if err := tx.QueryRow(ctx, `SELECT id,result_digest,attempted_at FROM billing_migration_validation_attempts WHERE program_id=$1 AND project_id=$2 AND attempt_kind='provider_validation' AND status='succeeded' ORDER BY attempted_at DESC,id DESC LIMIT 1`, programID, projectID).Scan(&binding.ProviderValidationID, &raw, &binding.ProviderValidatedAt); err != nil {
		return binding, d, billingmigration.ErrStaleRollbackPrerequisites
	}
	binding.ProviderValidationDigest = billingmigration.FormatDigest(raw)
	binding.RollbackPrerequisitesDigest, err = billingmigration.RollbackPrerequisitesDigest(programID, stateVersion, binding)
	if err != nil || binding.RollbackPrerequisitesDigest != expected.RollbackPrerequisitesDigest {
		return binding, d, billingmigration.ErrStaleRollbackPrerequisites
	}
	return binding, d, nil
}

func formattedDigests(d billingmigration.ParsedDigests) billingmigration.PreApprovalDigests {
	return billingmigration.PreApprovalDigests{Scope: billingmigration.FormatDigest(d.Scope), Manifest: billingmigration.FormatDigest(d.Manifest), Mapping: billingmigration.FormatDigest(d.Mapping), Policy: billingmigration.FormatDigest(d.Policy), Evidence: billingmigration.FormatDigest(d.Evidence), Readiness: billingmigration.FormatDigest(d.Readiness), FinalWatermark: billingmigration.FormatDigest(d.FinalWatermark), ApplicationVersion: billingmigration.FormatDigest(d.ApplicationVersion)}
}

func mustDigest(value string) []byte {
	raw, _ := billingmigration.ParseDigest(value)
	return raw
}

func verifyPreApprovalDigests(ctx context.Context, tx pgx.Tx, projectID, programID string, stateVersion int64, d billingmigration.ParsedDigests) error {
	var state string
	var scope []byte
	if err := tx.QueryRow(ctx, `SELECT state,scope_digest FROM billing_migration_programs WHERE id=$1 AND project_id=$2 AND state_version=$3 FOR UPDATE`, programID, projectID, stateVersion).Scan(&state, &scope); errors.Is(err, pgx.ErrNoRows) || state != billingmigration.StateReady {
		return billingmigration.ErrConflict
	} else if err != nil {
		return err
	}
	if !bytes.Equal(scope, d.Scope) {
		return billingmigration.ErrConflict
	}
	var manifest, mapping, evidence, watermark []byte
	if err := tx.QueryRow(ctx, `SELECT manifest_digest,mapping_digest,evidence_digest,final_watermark_digest FROM billing_migration_final_deltas WHERE program_id=$1 AND project_id=$2 ORDER BY completed_at DESC,id DESC LIMIT 1`, programID, projectID).Scan(&manifest, &mapping, &evidence, &watermark); err != nil {
		return billingmigration.ErrConflict
	}
	var policy, appVersion []byte
	if err := tx.QueryRow(ctx, `SELECT policy_digest,application_version_digest FROM billing_migration_readiness_policies WHERE program_id=$1 AND project_id=$2 ORDER BY frozen_at DESC,id DESC LIMIT 1`, programID, projectID).Scan(&policy, &appVersion); err != nil {
		return billingmigration.ErrConflict
	}
	var readiness []byte
	var ready bool
	if err := tx.QueryRow(ctx, `SELECT readiness_digest,ready FROM billing_migration_readiness_assessments WHERE program_id=$1 AND project_id=$2 AND authoritative ORDER BY assessed_at DESC,id DESC LIMIT 1`, programID, projectID).Scan(&readiness, &ready); err != nil || !ready {
		return billingmigration.ErrConflict
	}
	actual := [][]byte{manifest, mapping, policy, evidence, readiness, watermark, appVersion}
	expected := [][]byte{d.Manifest, d.Mapping, d.Policy, d.Evidence, d.Readiness, d.FinalWatermark, d.ApplicationVersion}
	for i := range actual {
		if !bytes.Equal(actual[i], expected[i]) {
			return billingmigration.ErrConflict
		}
	}
	return nil
}

func invalidateApproval(ctx context.Context, tx pgx.Tx, approvalID string, invalidatedAt time.Time) {
	_, _ = tx.Exec(ctx, `UPDATE billing_migration_cutover_proposals p SET status='invalidated',invalidated_at=$2 FROM billing_migration_approvals a WHERE a.id=$1 AND a.proposal_id=p.id AND p.status='approved'`, approvalID, invalidatedAt)
}

const checkpointSelect = `SELECT c.id,c.program_id,c.state_version,p.environment_id,c.authority_epoch,c.source_watermark,c.provider_watermark,c.shadow_watermark,c.manifest_digest,c.mapping_digest,c.policy_digest,c.readiness_digest,c.checkpoint_digest,c.cohort_digest,c.created_at,COALESCE((SELECT jsonb_agg(jsonb_build_object('applicationId',s.application_id,'platform',s.platform) ORDER BY s.application_id,s.platform) FROM billing_migration_program_scopes s WHERE s.program_id=c.program_id),'[]'::jsonb) FROM billing_migration_checkpoints c JOIN billing_migration_programs p ON p.id=c.program_id AND p.project_id=c.project_id`

func scanCheckpoint(row rowScanner, checkpoint *billingmigration.MigrationCheckpoint) error {
	var manifest, mapping, policy, readiness, checkpointDigest, cohortDigest, applicationsJSON []byte
	checkpoint.Scope.Applications = nil
	err := row.Scan(&checkpoint.CheckpointID, &checkpoint.ProgramID, &checkpoint.StateVersion, &checkpoint.Scope.EnvironmentID, &checkpoint.AuthorityEpoch, &checkpoint.SourceWatermark, &checkpoint.ProviderWatermark, &checkpoint.ShadowWatermark, &manifest, &mapping, &policy, &readiness, &checkpointDigest, &cohortDigest, &checkpoint.CreatedAt, &applicationsJSON)
	if err != nil {
		return err
	}
	checkpoint.ManifestDigest, checkpoint.MappingDigest = billingmigration.FormatDigest(manifest), billingmigration.FormatDigest(mapping)
	checkpoint.PolicyDigest, checkpoint.ReadinessDigest = billingmigration.FormatDigest(policy), billingmigration.FormatDigest(readiness)
	checkpoint.CheckpointDigest = billingmigration.FormatDigest(checkpointDigest)
	checkpoint.CohortDigest = billingmigration.FormatDigest(cohortDigest)
	return json.Unmarshal(applicationsJSON, &checkpoint.Scope.Applications)
}
