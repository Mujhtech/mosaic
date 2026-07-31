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

func (r *Repository) AssessRollbackReadiness(ctx context.Context, c billingmigration.AssessRollbackReadinessCommand) (billingmigration.RollbackReadinessAssessment, billingmigration.RollbackReadinessCheckpoint, bool, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return billingmigration.RollbackReadinessAssessment{}, billingmigration.RollbackReadinessCheckpoint{}, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	resource, replay, err := operationCommandReplay(ctx, tx, c.Input.ProgramID, "rollback_readiness", c.Input.IdempotencyKey, c.RequestDigest)
	if err != nil {
		return billingmigration.RollbackReadinessAssessment{}, billingmigration.RollbackReadinessCheckpoint{}, false, err
	}
	if replay {
		a, err := scanRollbackAssessment(tx.QueryRow(ctx, rollbackAssessmentSelect+` WHERE a.id=$1 AND a.project_id=$2`, resource, c.Input.ProjectID))
		if err != nil {
			return a, billingmigration.RollbackReadinessCheckpoint{}, true, err
		}
		checkpoint, cerr := scanRollbackCheckpoint(tx.QueryRow(ctx, rollbackCheckpointSelect+` WHERE c.assessment_id=$1 AND c.project_id=$2`, resource, c.Input.ProjectID))
		if errors.Is(cerr, billingmigration.ErrNotFound) {
			cerr = nil
		}
		return a, checkpoint, true, cerr
	}
	var state, environment, organization string
	var version int64
	var scopeRaw []byte
	var now time.Time
	if err = tx.QueryRow(ctx, `SELECT p.state,p.state_version,p.environment_id,pr.organization_id,p.scope_digest,clock_timestamp() FROM billing_migration_programs p JOIN projects pr ON pr.id=p.project_id WHERE p.id=$1 AND p.project_id=$2 FOR UPDATE OF p`, c.Input.ProgramID, c.Input.ProjectID).Scan(&state, &version, &environment, &organization, &scopeRaw, &now); errors.Is(err, pgx.ErrNoRows) {
		return billingmigration.RollbackReadinessAssessment{}, billingmigration.RollbackReadinessCheckpoint{}, false, billingmigration.ErrNotFound
	} else if err != nil {
		return billingmigration.RollbackReadinessAssessment{}, billingmigration.RollbackReadinessCheckpoint{}, false, err
	}
	if state != billingmigration.StateStabilizing || version != c.Input.ExpectedStateVersion {
		return billingmigration.RollbackReadinessAssessment{}, billingmigration.RollbackReadinessCheckpoint{}, false, billingmigration.ErrStaleState
	}
	var observationID string
	var observationDigest, policyDigest []byte
	var observationHealthy bool
	var oldVersions int64
	if err = tx.QueryRow(ctx, `SELECT o.id,o.evidence_digest,p.policy_digest,o.healthy,o.old_app_versions FROM billing_migration_stabilization_observations o JOIN billing_migration_stabilization_policies p ON p.id=o.policy_id WHERE o.program_id=$1 AND o.project_id=$2 ORDER BY o.observed_at DESC,o.id DESC LIMIT 1`, c.Input.ProgramID, c.Input.ProjectID).Scan(&observationID, &observationDigest, &policyDigest, &observationHealthy, &oldVersions); errors.Is(err, pgx.ErrNoRows) {
		return billingmigration.RollbackReadinessAssessment{}, billingmigration.RollbackReadinessCheckpoint{}, false, billingmigration.ErrRollbackPrerequisite
	} else if err != nil {
		return billingmigration.RollbackReadinessAssessment{}, billingmigration.RollbackReadinessCheckpoint{}, false, err
	}
	if observationID != c.Input.ObservationID || !bytes.Equal(observationDigest, c.ExpectedObservationDigest) {
		return billingmigration.RollbackReadinessAssessment{}, billingmigration.RollbackReadinessCheckpoint{}, false, billingmigration.ErrStaleDigest
	}
	var deltaID string
	var deltaDigest []byte
	var deltaAt, sourceAt time.Time
	if err = tx.QueryRow(ctx, `SELECT id,delta_digest,completed_at,source_watermark FROM billing_migration_final_deltas WHERE program_id=$1 AND project_id=$2 ORDER BY completed_at DESC,id DESC LIMIT 1`, c.Input.ProgramID, c.Input.ProjectID).Scan(&deltaID, &deltaDigest, &deltaAt, &sourceAt); errors.Is(err, pgx.ErrNoRows) {
		return billingmigration.RollbackReadinessAssessment{}, billingmigration.RollbackReadinessCheckpoint{}, false, billingmigration.ErrRollbackPrerequisite
	} else if err != nil {
		return billingmigration.RollbackReadinessAssessment{}, billingmigration.RollbackReadinessCheckpoint{}, false, err
	}
	var credentialID string
	var capabilityOK, pullOK bool
	var capabilityDigest, pullDigest, manifestDigest []byte
	var impact int64
	var pullCompletedAt time.Time
	if err = tx.QueryRow(ctx, `SELECT
	COALESCE((SELECT p.credential_id FROM billing_migration_programs p JOIN billing_migration_credentials x ON x.id=p.credential_id AND x.project_id=p.project_id WHERE p.id=$1 AND p.project_id=$2 AND x.status='active' AND x.removed_at IS NULL AND x.nonce IS NOT NULL AND x.ciphertext IS NOT NULL),''),
	COALESCE((SELECT provider_api_version='v2' AND capabilities @> ARRAY['read_customers','read_subscriptions','read_aliases','incremental_delta']::text[] FROM billing_migration_capability_assessments WHERE program_id=$1 AND project_id=$2 ORDER BY assessed_at DESC,id DESC LIMIT 1),false),
	COALESCE((SELECT assessment_digest FROM billing_migration_capability_assessments WHERE program_id=$1 AND project_id=$2 ORDER BY assessed_at DESC,id DESC LIMIT 1),decode(repeat('00',32),'hex')),
	EXISTS(SELECT 1 FROM billing_migration_source_pull_jobs p JOIN billing_migration_source_pull_jobs predecessor ON predecessor.id=p.predecessor_pull_job_id AND predecessor.program_id=p.program_id AND predecessor.project_id=p.project_id JOIN billing_migration_final_delta_jobs j ON j.id=p.result_final_delta_job_id AND j.program_id=p.program_id AND j.project_id=p.project_id WHERE p.id=(SELECT id FROM billing_migration_source_pull_jobs WHERE program_id=$1 AND project_id=$2 AND intent='final_delta' AND status='completed' ORDER BY completed_at DESC,id DESC LIMIT 1) AND predecessor.status='completed' AND p.starting_cursor=predecessor.resume_cursor AND p.starting_watermark=predecessor.final_watermark AND p.starting_watermark_digest=predecessor.evidence_digest AND j.status='completed' AND j.result_final_delta_id=$3),
	COALESCE((SELECT evidence_digest FROM billing_migration_source_pull_jobs WHERE program_id=$1 AND project_id=$2 AND intent='final_delta' AND status='completed' ORDER BY completed_at DESC,id DESC LIMIT 1),decode(repeat('00',32),'hex')),
	COALESCE((SELECT m.manifest_digest FROM billing_migration_source_pull_jobs p JOIN billing_migration_source_manifests m ON m.id=p.result_manifest_id AND m.program_id=p.program_id AND m.project_id=p.project_id WHERE p.program_id=$1 AND p.project_id=$2 AND p.intent='final_delta' AND p.status='completed' ORDER BY p.completed_at DESC,p.id DESC LIMIT 1),decode(repeat('00',32),'hex')),
	COALESCE((SELECT current_access_count FROM billing_migration_source_pull_jobs WHERE program_id=$1 AND project_id=$2 AND intent='final_delta' AND status='completed' ORDER BY completed_at DESC,id DESC LIMIT 1),0),
		COALESCE((SELECT completed_at FROM billing_migration_source_pull_jobs WHERE program_id=$1 AND project_id=$2 AND intent='final_delta' AND status='completed' ORDER BY completed_at DESC,id DESC LIMIT 1),to_timestamp(0))`, c.Input.ProgramID, c.Input.ProjectID, deltaID).Scan(&credentialID, &capabilityOK, &capabilityDigest, &pullOK, &pullDigest, &manifestDigest, &impact, &pullCompletedAt); err != nil {
		return billingmigration.RollbackReadinessAssessment{}, billingmigration.RollbackReadinessCheckpoint{}, false, err
	}
	// Require fresh accepted current-epoch SDK evidence for every exact scope.
	var scopeCount, compatibleScopeCount int64
	if err = tx.QueryRow(ctx, `SELECT count(*),count(*) FILTER(WHERE EXISTS(SELECT 1 FROM billing_migration_v2_sync_observations s WHERE s.program_id=ps.program_id AND s.project_id=ps.project_id AND s.application_id=ps.application_id AND s.platform=ps.platform AND s.authority_epoch=$3 AND s.sync_result='accepted' AND s.observed_at>=$4)) FROM billing_migration_program_scopes ps WHERE ps.program_id=$1 AND ps.project_id=$2`, c.Input.ProgramID, c.Input.ProjectID, c.Input.ExpectedAuthorityEpoch, sourceAt).Scan(&scopeCount, &compatibleScopeCount); err != nil {
		return billingmigration.RollbackReadinessAssessment{}, billingmigration.RollbackReadinessCheckpoint{}, false, err
	}
	cutoverCompatible, err := versionReadinessTx(ctx, tx, c.Input.ProjectID, c.Input.ProgramID)
	if err != nil {
		return billingmigration.RollbackReadinessAssessment{}, billingmigration.RollbackReadinessCheckpoint{}, false, err
	}
	applicationCompatible := cutoverCompatible && scopeCount > 0 && scopeCount == compatibleScopeCount && oldVersions == 0
	authorityRows, err := tx.Query(ctx, `SELECT a.authority_digest,a.current_epoch,a.current_authority,a.active_program_id FROM billing_migration_program_scopes ps JOIN billing_migration_authority_scopes a ON a.project_id=ps.project_id AND a.environment_id=ps.environment_id AND a.application_id=ps.application_id AND a.platform=ps.platform WHERE ps.program_id=$1 AND ps.project_id=$2 ORDER BY ps.application_id,ps.platform`, c.Input.ProgramID, c.Input.ProjectID)
	if err != nil {
		return billingmigration.RollbackReadinessAssessment{}, billingmigration.RollbackReadinessCheckpoint{}, false, err
	}
	var authorityParts []string
	authorityOK := true
	for authorityRows.Next() {
		var raw []byte
		var epoch int64
		var authority string
		var active *string
		if err = authorityRows.Scan(&raw, &epoch, &authority, &active); err != nil {
			authorityRows.Close()
			return billingmigration.RollbackReadinessAssessment{}, billingmigration.RollbackReadinessCheckpoint{}, false, err
		}
		authorityParts = append(authorityParts, billingmigration.FormatDigest(raw))
		authorityOK = authorityOK && epoch == c.Input.ExpectedAuthorityEpoch && authority == "mosaic" && active != nil && *active == c.Input.ProgramID
	}
	authorityRows.Close()
	if len(authorityParts) == 0 || !authorityOK {
		return billingmigration.RollbackReadinessAssessment{}, billingmigration.RollbackReadinessCheckpoint{}, false, billingmigration.ErrStaleAuthority
	}
	authorityDigest, err := billingmigration.AuthoritySetDigest(c.Input.ProgramID, billingmigration.FormatDigest(scopeRaw), authorityParts)
	if err != nil {
		return billingmigration.RollbackReadinessAssessment{}, billingmigration.RollbackReadinessCheckpoint{}, false, err
	}
	authorityRaw, _ := billingmigration.ParseDigest(authorityDigest)
	// Current-access evidence is the sorted immutable source-record digest set.
	recordRows, err := tx.Query(ctx, `SELECT s.record_digest FROM billing_migration_source_records s WHERE s.program_id=$1 AND s.project_id=$2 AND s.current_access AND s.manifest_id=(SELECT result_manifest_id FROM billing_migration_source_pull_jobs WHERE program_id=$1 AND project_id=$2 AND intent='final_delta' AND status='completed' ORDER BY completed_at DESC,id DESC LIMIT 1) ORDER BY s.record_digest`, c.Input.ProgramID, c.Input.ProjectID)
	if err != nil {
		return billingmigration.RollbackReadinessAssessment{}, billingmigration.RollbackReadinessCheckpoint{}, false, err
	}
	parts := [][]byte{manifestDigest}
	for recordRows.Next() {
		var raw []byte
		if err = recordRows.Scan(&raw); err != nil {
			recordRows.Close()
			return billingmigration.RollbackReadinessAssessment{}, billingmigration.RollbackReadinessCheckpoint{}, false, err
		}
		parts = append(parts, raw)
	}
	recordRows.Close()
	sourceAccessDigest := stabilizationDigest("mosaic-migration-rollback-source-access-v1", parts)
	credentialOK := credentialID != ""
	// Capability assessments append only for strict supersets. The exact latest
	// completed final pull therefore supplies freshness for an unchanged active
	// program credential while the latest immutable assessment supplies the
	// complete capability set.
	sourceSupport := credentialOK && capabilityOK && pullOK
	sourceHealthy := sourceSupport && !sourceAt.After(now) && !deltaAt.After(now) && !pullCompletedAt.After(now) && !pullCompletedAt.Before(deltaAt)
	limitationsBlocking := !observationHealthy || !sourceSupport || !sourceHealthy || !applicationCompatible
	sourceHealthDigest := stabilizationDigest("mosaic-migration-rollback-source-health-v1", struct {
		CredentialID                 string
		Credential, Capability, Pull bool
		CapabilityDigest, PullDigest []byte
		SourceAt, DeltaAt, PullAt    time.Time
	}{credentialID, credentialOK, capabilityOK, pullOK, capabilityDigest, pullDigest, sourceAt, deltaAt, pullCompletedAt})
	impactDigest := stabilizationDigest("mosaic-migration-rollback-impact-v1", struct {
		Program string
		Count   int64
		Source  []byte
	}{c.Input.ProgramID, impact, sourceAccessDigest})
	compatibilityDigest := stabilizationDigest("mosaic-migration-rollback-app-compatibility-v1", struct{ Scopes, Covered, Old, Epoch int64 }{scopeCount, compatibleScopeCount, oldVersions, c.Input.ExpectedAuthorityEpoch})
	limitationDigest := stabilizationDigest("mosaic-migration-rollback-limitations-v1", struct{ Stable, Support, Health, Compatible bool }{observationHealthy, sourceSupport, sourceHealthy, applicationCompatible})
	auditDigest := stabilizationDigest("mosaic-migration-rollback-readiness-audit-v1", struct {
		Program, Actor string
		At             time.Time
	}{c.Input.ProgramID, c.ActorID, now.UTC()})
	ready := !limitationsBlocking
	readinessRaw := stabilizationDigest("mosaic-migration-rollback-readiness-v1", struct {
		Program, Observation, Delta                                                                                 string
		Version, Epoch, Impact                                                                                      int64
		ObservationDigest, SourceHealth, SourceAccess, DeltaDigest, ImpactDigest, Compatibility, Limitations, Audit []byte
		Ready                                                                                                       bool
	}{c.Input.ProgramID, observationID, deltaID, version, c.Input.ExpectedAuthorityEpoch, impact, observationDigest, sourceHealthDigest, sourceAccessDigest, deltaDigest, impactDigest, compatibilityDigest, limitationDigest, auditDigest, ready})
	a := billingmigration.RollbackReadinessAssessment{ID: stabilizationID("mra", readinessRaw), ProgramID: c.Input.ProgramID, ProjectID: c.Input.ProjectID, ObservationID: observationID, LatestDeltaID: deltaID, ReadinessDigest: billingmigration.FormatDigest(readinessRaw), StateVersion: version, SourceSupportAvailable: sourceSupport, SourceHealthy: sourceHealthy, ApplicationCompatible: applicationCompatible, LimitationsBlocking: limitationsBlocking, Ready: ready, CustomerImpactCount: impact, AssessedAt: now.UTC()}
	_, err = tx.Exec(ctx, `INSERT INTO billing_migration_rollback_readiness_assessments(id,program_id,project_id,observation_id,state_version,source_support_available,source_healthy,source_health_digest,source_current_access_digest,source_current_access_at,latest_delta_id,latest_delta_digest,customer_impact_count,customer_impact_digest,application_compatible,application_compatibility_digest,limitations_blocking,limitation_report_digest,audit_digest,stabilization_healthy,ready,readiness_digest,assessed_by_actor_id,assessed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`, a.ID, a.ProgramID, a.ProjectID, a.ObservationID, a.StateVersion, a.SourceSupportAvailable, a.SourceHealthy, sourceHealthDigest, sourceAccessDigest, pullCompletedAt, deltaID, deltaDigest, a.CustomerImpactCount, impactDigest, a.ApplicationCompatible, compatibilityDigest, a.LimitationsBlocking, limitationDigest, auditDigest, observationHealthy, a.Ready, readinessRaw, c.ActorID, a.AssessedAt)
	if err != nil {
		return billingmigration.RollbackReadinessAssessment{}, billingmigration.RollbackReadinessCheckpoint{}, false, translate(err, "append rollback readiness")
	}
	var checkpoint billingmigration.RollbackReadinessCheckpoint
	if ready {
		checkpointRaw := stabilizationDigest("mosaic-migration-rollback-readiness-checkpoint-v1", struct {
			Program, Assessment                    string
			Version, Epoch                         int64
			Authority, Policy, Evidence, Readiness []byte
		}{a.ProgramID, a.ID, version, c.Input.ExpectedAuthorityEpoch, authorityRaw, policyDigest, observationDigest, readinessRaw})
		checkpoint = billingmigration.RollbackReadinessCheckpoint{ID: stabilizationID("mrc", checkpointRaw), ProgramID: a.ProgramID, ProjectID: a.ProjectID, AssessmentID: a.ID, AuthorityDigest: authorityDigest, PolicyDigest: billingmigration.FormatDigest(policyDigest), EvidenceDigest: billingmigration.FormatDigest(observationDigest), ReadinessDigest: a.ReadinessDigest, CheckpointDigest: billingmigration.FormatDigest(checkpointRaw), StateVersion: version, AuthorityEpoch: c.Input.ExpectedAuthorityEpoch, CreatedAt: a.AssessedAt}
		_, err = tx.Exec(ctx, `INSERT INTO billing_migration_rollback_readiness_checkpoints(id,program_id,project_id,assessment_id,assessment_ready,state_version,authority_epoch,authority_digest,policy_digest,evidence_digest,readiness_digest,checkpoint_digest,created_by_actor_id,created_at) VALUES($1,$2,$3,$4,true,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, checkpoint.ID, checkpoint.ProgramID, checkpoint.ProjectID, checkpoint.AssessmentID, checkpoint.StateVersion, checkpoint.AuthorityEpoch, authorityRaw, policyDigest, observationDigest, readinessRaw, checkpointRaw, c.ActorID, checkpoint.CreatedAt)
		if err != nil {
			return billingmigration.RollbackReadinessAssessment{}, billingmigration.RollbackReadinessCheckpoint{}, false, translate(err, "append rollback checkpoint")
		}
	}
	if _, err = tx.Exec(ctx, `INSERT INTO billing_migration_command_idempotency(id,program_id,project_id,command_kind,idempotency_key,request_digest,resource_id,created_at) VALUES('mci_'||$1,$2,$3,'rollback_readiness',$4,$5,$1,$6)`, a.ID, a.ProgramID, a.ProjectID, c.Input.IdempotencyKey, c.RequestDigest, a.AssessedAt); err != nil {
		return billingmigration.RollbackReadinessAssessment{}, billingmigration.RollbackReadinessCheckpoint{}, false, err
	}
	metadata, _ := json.Marshal(map[string]any{"ready": ready, "assessmentId": a.ID, "checkpointId": checkpoint.ID, "sourceSupportAvailable": sourceSupport, "limitationsBlocking": limitationsBlocking})
	if _, err = tx.Exec(ctx, `INSERT INTO audit_events(id,actor_id,organization_id,project_id,environment_id,action,resource_type,resource_id,metadata,created_at) VALUES('aud_'||$1,$2,$3,$4,$5,'billing.migration.rollback.readiness.assessed','billing_migration_program',$6,$7,$8)`, a.ID, c.ActorID, organization, a.ProjectID, environment, a.ProgramID, metadata, a.AssessedAt); err != nil {
		return billingmigration.RollbackReadinessAssessment{}, billingmigration.RollbackReadinessCheckpoint{}, false, err
	}
	if err = tx.Commit(ctx); err != nil {
		return billingmigration.RollbackReadinessAssessment{}, billingmigration.RollbackReadinessCheckpoint{}, false, err
	}
	return a, checkpoint, false, nil
}

const rollbackAssessmentSelect = `SELECT a.id,a.program_id,a.project_id,a.observation_id,a.latest_delta_id,a.readiness_digest,a.state_version,a.source_support_available,a.source_healthy,a.application_compatible,a.limitations_blocking,a.ready,a.customer_impact_count,a.assessed_at FROM billing_migration_rollback_readiness_assessments a`

func scanRollbackAssessment(row pgx.Row) (billingmigration.RollbackReadinessAssessment, error) {
	var a billingmigration.RollbackReadinessAssessment
	var readiness []byte
	err := row.Scan(&a.ID, &a.ProgramID, &a.ProjectID, &a.ObservationID, &a.LatestDeltaID, &readiness, &a.StateVersion, &a.SourceSupportAvailable, &a.SourceHealthy, &a.ApplicationCompatible, &a.LimitationsBlocking, &a.Ready, &a.CustomerImpactCount, &a.AssessedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return a, billingmigration.ErrNotFound
	}
	a.ReadinessDigest = billingmigration.FormatDigest(readiness)
	return a, err
}

const rollbackCheckpointSelect = `SELECT c.id,c.program_id,c.project_id,c.assessment_id,c.authority_digest,c.policy_digest,c.evidence_digest,c.readiness_digest,c.checkpoint_digest,c.state_version,c.authority_epoch,c.created_at FROM billing_migration_rollback_readiness_checkpoints c`

func scanRollbackCheckpoint(row pgx.Row) (billingmigration.RollbackReadinessCheckpoint, error) {
	var c billingmigration.RollbackReadinessCheckpoint
	var authority, policy, evidence, readiness, checkpoint []byte
	err := row.Scan(&c.ID, &c.ProgramID, &c.ProjectID, &c.AssessmentID, &authority, &policy, &evidence, &readiness, &checkpoint, &c.StateVersion, &c.AuthorityEpoch, &c.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, billingmigration.ErrNotFound
	}
	c.AuthorityDigest = billingmigration.FormatDigest(authority)
	c.PolicyDigest = billingmigration.FormatDigest(policy)
	c.EvidenceDigest = billingmigration.FormatDigest(evidence)
	c.ReadinessDigest = billingmigration.FormatDigest(readiness)
	c.CheckpointDigest = billingmigration.FormatDigest(checkpoint)
	return c, err
}
