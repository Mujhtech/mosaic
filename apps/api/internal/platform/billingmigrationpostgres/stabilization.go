package billingmigrationpostgres

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingmigration"
)

// accessAPIEvidenceFreshness is intentionally shorter than an operator
// observation cadence. An old successful request cannot prove the access API
// is healthy now; after this bound, missing traffic/evidence fails closed as
// access_api_unknown. This is an internal monitoring invariant, not a public
// API or migration policy knob.
const accessAPIEvidenceFreshness = 2 * time.Minute

func stabilizationDigest(domain string, value any) []byte {
	raw, _ := json.Marshal(value)
	sum := sha256.Sum256(append([]byte(domain+"\x00"), raw...))
	return sum[:]
}
func stabilizationID(prefix string, raw []byte) string {
	return prefix + "_" + hex.EncodeToString(raw[:12])
}

func (r *Repository) RecordTrustedAccessAPISignal(ctx context.Context, s billingmigration.TrustedAccessAPISignal) error {
	if s.ID == "" || s.ProgramID == "" || s.ProjectID == "" || s.RequestCount < 0 || s.ErrorCount < 0 || s.ErrorCount > s.RequestCount || !s.WindowEndedAt.After(s.WindowStartedAt) || len(s.EvidenceDigest) != 32 {
		return billingmigration.ErrInvalid
	}
	_, err := r.pool.Exec(ctx, `INSERT INTO billing_migration_access_api_signal_windows(id,program_id,project_id,window_started_at,window_ended_at,request_count,error_count,evidence_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, s.ID, s.ProgramID, s.ProjectID, s.WindowStartedAt.UTC(), s.WindowEndedAt.UTC(), s.RequestCount, s.ErrorCount, s.EvidenceDigest)
	return translate(err, "append trusted access API signal")
}

// RecordTrustedAccessAPIResult maps one authenticated, completed trusted-server
// access check to every stabilizing Program in the exact Project/Environment.
// PostgreSQL supplies the evidence clock, and a random nonce keeps concurrent
// API instances from collapsing equal outcomes into one immutable row.
func (r *Repository) RecordTrustedAccessAPIResult(ctx context.Context, projectID, environmentID string, elapsed time.Duration, failed bool) error {
	if r == nil || r.pool == nil || projectID == "" || environmentID == "" {
		return billingmigration.ErrInvalid
	}
	if elapsed < time.Microsecond {
		elapsed = time.Microsecond
	}
	if elapsed > time.Minute {
		elapsed = time.Minute
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin trusted access API signal: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var endedAt time.Time
	if err = tx.QueryRow(ctx, `SELECT transaction_timestamp()`).Scan(&endedAt); err != nil {
		return fmt.Errorf("read trusted access API evidence clock: %w", err)
	}
	rows, err := tx.Query(ctx, `SELECT id,project_id FROM billing_migration_programs WHERE project_id=$1 AND environment_id=$2 AND state='stabilizing' ORDER BY id`, projectID, environmentID)
	if err != nil {
		return fmt.Errorf("select stabilizing programs for access API signal: %w", err)
	}
	type program struct{ id, projectID string }
	programs := make([]program, 0, 1)
	for rows.Next() {
		var p program
		if err = rows.Scan(&p.id, &p.projectID); err != nil {
			rows.Close()
			return fmt.Errorf("scan stabilizing program for access API signal: %w", err)
		}
		programs = append(programs, p)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return fmt.Errorf("iterate stabilizing programs for access API signal: %w", err)
	}
	rows.Close()

	for _, p := range programs {
		nonce := make([]byte, 16)
		if _, err = rand.Read(nonce); err != nil {
			return fmt.Errorf("generate trusted access API evidence nonce: %w", err)
		}
		errorCount := int64(0)
		if failed {
			errorCount = 1
		}
		startedAt := endedAt.Add(-elapsed)
		evidence := stabilizationDigest("mosaic-migration-access-api-signal-v1", struct {
			Program, Project string
			Started, Ended   time.Time
			Requests, Errors int64
			Nonce            []byte
		}{p.id, p.projectID, startedAt.UTC(), endedAt.UTC(), 1, errorCount, nonce})
		signal := billingmigration.TrustedAccessAPISignal{
			ID: stabilizationID("maw", evidence), ProgramID: p.id, ProjectID: p.projectID,
			WindowStartedAt: startedAt, WindowEndedAt: endedAt,
			RequestCount: 1, ErrorCount: errorCount, EvidenceDigest: evidence,
		}
		if _, err = tx.Exec(ctx, `INSERT INTO billing_migration_access_api_signal_windows(id,program_id,project_id,window_started_at,window_ended_at,request_count,error_count,evidence_digest,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$5)`, signal.ID, signal.ProgramID, signal.ProjectID, signal.WindowStartedAt.UTC(), signal.WindowEndedAt.UTC(), signal.RequestCount, signal.ErrorCount, signal.EvidenceDigest); err != nil {
			return translate(err, "append trusted access API signal")
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit trusted access API signal: %w", err)
	}
	return nil
}

func (r *Repository) FreezeStabilizationPolicy(ctx context.Context, c billingmigration.FreezeStabilizationPolicyCommand) (billingmigration.StabilizationPolicy, bool, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return billingmigration.StabilizationPolicy{}, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	resource, replay, err := operationCommandReplay(ctx, tx, c.Input.ProgramID, "stabilization_policy", c.Input.IdempotencyKey, c.RequestDigest)
	if err != nil {
		return billingmigration.StabilizationPolicy{}, false, err
	}
	if replay {
		p, err := scanStabilizationPolicy(tx.QueryRow(ctx, stabilizationPolicySelect+` WHERE id=$1 AND project_id=$2`, resource, c.Input.ProjectID))
		return p, true, err
	}
	var state string
	var version int64
	if err = tx.QueryRow(ctx, `SELECT state,state_version FROM billing_migration_programs WHERE id=$1 AND project_id=$2 FOR UPDATE`, c.Input.ProgramID, c.Input.ProjectID).Scan(&state, &version); errors.Is(err, pgx.ErrNoRows) {
		return billingmigration.StabilizationPolicy{}, false, billingmigration.ErrNotFound
	} else if err != nil {
		return billingmigration.StabilizationPolicy{}, false, err
	}
	if state != billingmigration.StateStabilizing || version != c.Input.ExpectedStateVersion {
		return billingmigration.StabilizationPolicy{}, false, billingmigration.ErrStaleState
	}
	raw := stabilizationDigest("mosaic-migration-stabilization-policy-v1", struct {
		Program    string
		Version    int64
		Thresholds billingmigration.StabilizationThresholds
	}{c.Input.ProgramID, version, c.Input.Thresholds})
	p := billingmigration.StabilizationPolicy{ID: stabilizationID("msp", raw), ProgramID: c.Input.ProgramID, ProjectID: c.Input.ProjectID, StateVersion: version, Thresholds: c.Input.Thresholds, PolicyDigest: billingmigration.FormatDigest(raw), FrozenByActorID: c.ActorID}
	t := p.Thresholds
	err = tx.QueryRow(ctx, `INSERT INTO billing_migration_stabilization_policies(id,program_id,project_id,state_version,authority_mismatch_max,access_api_error_max,sdk_sync_failure_max,divergence_max,validation_backlog_max,source_delta_lag_max_seconds,webhook_failure_max,webhook_freshness_max_seconds,quarantine_max,support_case_max,old_app_version_max,worker_unhealthy_max,policy_digest,frozen_by_actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING frozen_at`, p.ID, p.ProgramID, p.ProjectID, p.StateVersion, t.AuthorityMismatchMax, t.AccessAPIErrorMax, t.SDKSyncFailureMax, t.DivergenceMax, t.ValidationBacklogMax, t.SourceDeltaLagMaxSeconds, t.WebhookFailureMax, t.WebhookFreshnessMaxSeconds, t.QuarantineMax, t.SupportCaseMax, t.OldAppVersionMax, t.WorkerUnhealthyMax, raw, c.ActorID).Scan(&p.FrozenAt)
	if err != nil {
		return billingmigration.StabilizationPolicy{}, false, translate(err, "freeze stabilization policy")
	}
	if _, err = tx.Exec(ctx, `INSERT INTO billing_migration_command_idempotency(id,program_id,project_id,command_kind,idempotency_key,request_digest,resource_id,created_at) VALUES('mci_'||$1,$2,$3,'stabilization_policy',$4,$5,$1,$6)`, p.ID, p.ProgramID, p.ProjectID, c.Input.IdempotencyKey, c.RequestDigest, p.FrozenAt); err != nil {
		return billingmigration.StabilizationPolicy{}, false, err
	}
	if err = tx.Commit(ctx); err != nil {
		return billingmigration.StabilizationPolicy{}, false, err
	}
	return p, false, nil
}

const stabilizationPolicySelect = `SELECT id,program_id,project_id,state_version,authority_mismatch_max,access_api_error_max,sdk_sync_failure_max,divergence_max,validation_backlog_max,source_delta_lag_max_seconds,webhook_failure_max,webhook_freshness_max_seconds,quarantine_max,support_case_max,old_app_version_max,worker_unhealthy_max,policy_digest,frozen_by_actor_id,frozen_at FROM billing_migration_stabilization_policies`

func scanStabilizationPolicy(row pgx.Row) (billingmigration.StabilizationPolicy, error) {
	var p billingmigration.StabilizationPolicy
	var raw []byte
	t := &p.Thresholds
	err := row.Scan(&p.ID, &p.ProgramID, &p.ProjectID, &p.StateVersion, &t.AuthorityMismatchMax, &t.AccessAPIErrorMax, &t.SDKSyncFailureMax, &t.DivergenceMax, &t.ValidationBacklogMax, &t.SourceDeltaLagMaxSeconds, &t.WebhookFailureMax, &t.WebhookFreshnessMaxSeconds, &t.QuarantineMax, &t.SupportCaseMax, &t.OldAppVersionMax, &t.WorkerUnhealthyMax, &raw, &p.FrozenByActorID, &p.FrozenAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return p, billingmigration.ErrNotFound
	}
	p.PolicyDigest = billingmigration.FormatDigest(raw)
	return p, err
}

func (r *Repository) RecordStabilization(ctx context.Context, c billingmigration.RecordStabilizationCommand) (billingmigration.StabilizationObservation, bool, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return billingmigration.StabilizationObservation{}, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	resource, replay, err := operationCommandReplay(ctx, tx, c.Input.ProgramID, "stabilization_observation", c.Input.IdempotencyKey, c.RequestDigest)
	if err != nil {
		return billingmigration.StabilizationObservation{}, false, err
	}
	if replay {
		o, err := scanStabilizationObservation(tx.QueryRow(ctx, stabilizationObservationSelect+` WHERE o.id=$1 AND o.project_id=$2`, resource, c.Input.ProjectID))
		return o, true, err
	}
	var state, environment string
	var version int64
	var now time.Time
	if err = tx.QueryRow(ctx, `SELECT state,state_version,environment_id,clock_timestamp() FROM billing_migration_programs WHERE id=$1 AND project_id=$2 FOR UPDATE`, c.Input.ProgramID, c.Input.ProjectID).Scan(&state, &version, &environment, &now); errors.Is(err, pgx.ErrNoRows) {
		return billingmigration.StabilizationObservation{}, false, billingmigration.ErrNotFound
	} else if err != nil {
		return billingmigration.StabilizationObservation{}, false, err
	}
	if state != billingmigration.StateStabilizing || version != c.Input.ExpectedStateVersion {
		return billingmigration.StabilizationObservation{}, false, billingmigration.ErrStaleState
	}
	p, err := scanStabilizationPolicy(tx.QueryRow(ctx, stabilizationPolicySelect+` WHERE program_id=$1 AND project_id=$2`, c.Input.ProgramID, c.Input.ProjectID))
	if err != nil {
		return billingmigration.StabilizationObservation{}, false, err
	}
	policyRaw, _ := billingmigration.ParseDigest(p.PolicyDigest)
	if !bytes.Equal(policyRaw, c.ExpectedPolicyDigest) {
		return billingmigration.StabilizationObservation{}, false, billingmigration.ErrStaleDigest
	}
	m := billingmigration.StabilizationMetrics{}
	var sourceAt, webhookAt *time.Time
	var accessKnown bool
	err = tx.QueryRow(ctx, `SELECT
	(SELECT count(*) FROM billing_migration_program_scopes ps LEFT JOIN billing_migration_authority_scopes a ON a.project_id=ps.project_id AND a.environment_id=ps.environment_id AND a.application_id=ps.application_id AND a.platform=ps.platform WHERE ps.program_id=$1 AND ps.project_id=$2 AND (a.current_authority IS DISTINCT FROM 'mosaic' OR a.current_epoch IS DISTINCT FROM $4 OR a.active_program_id IS DISTINCT FROM $1)),
	COALESCE((SELECT sum(error_count) FROM billing_migration_access_api_signal_windows WHERE program_id=$1 AND project_id=$2 AND window_ended_at>=GREATEST($3,$7-($8*interval '1 second'))),$5+1),
	EXISTS(SELECT 1 FROM billing_migration_access_api_signal_windows WHERE program_id=$1 AND project_id=$2 AND request_count>0 AND window_ended_at>=GREATEST($3,$7-($8*interval '1 second'))),
	COALESCE((SELECT sum(traffic_count) FROM billing_migration_v2_sync_observations WHERE program_id=$1 AND project_id=$2 AND observed_at>=$3 AND sync_result<>'accepted'),0),
	(SELECT count(*) FROM billing_migration_divergences d LEFT JOIN billing_migration_divergence_resolutions x ON x.divergence_id=d.id WHERE d.program_id=$1 AND d.project_id=$2 AND x.id IS NULL),
	(SELECT count(*) FROM billing_migration_import_batch_records ir JOIN billing_migration_source_records sr ON sr.id=ir.source_record_id AND sr.program_id=ir.program_id AND sr.project_id=ir.project_id WHERE ir.program_id=$1 AND ir.project_id=$2 AND sr.current_access AND NOT EXISTS(SELECT 1 FROM billing_migration_validation_bindings vb WHERE vb.program_id=ir.program_id AND vb.project_id=ir.project_id AND vb.environment_id=ir.environment_id AND vb.expected_application_id=ir.application_id AND vb.provider=ir.provider AND vb.reference_kind=ir.reference_kind AND vb.reference_digest=CASE WHEN ir.provider='app_store' THEN sha256(convert_to('mosaic-billing-apple-transaction-v1'||chr(0)||'unclassified'||chr(0)||ir.provider_reference,'UTF8')) ELSE sha256(convert_to('mosaic-billing-google-order-v1'||chr(0)||ir.provider_reference,'UTF8')) END AND vb.expected_store_environment=ir.expected_store_environment AND (ir.expected_store_product_identifier IS NULL OR (vb.expected_store_product_identifier=ir.expected_store_product_identifier AND vb.expected_mosaic_product_id=ir.mosaic_product_id)) AND vb.status IN ('validated','quarantined')))+
	(SELECT count(*) FROM billing_migration_import_batches WHERE program_id=$1 AND project_id=$2 AND status IN ('pending','running')),
	COALESCE((SELECT source_watermark FROM billing_migration_final_deltas WHERE program_id=$1 AND project_id=$2 ORDER BY completed_at DESC,id DESC LIMIT 1),NULL),
	(SELECT count(*) FROM webhook_deliveries d JOIN webhook_events e ON e.id=d.webhook_event_id AND e.project_id=d.project_id JOIN billing_migration_authority_scopes a ON a.id=e.authority_scope_id AND a.project_id=e.project_id JOIN webhook_destinations destination ON destination.id=d.webhook_destination_id AND destination.project_id=d.project_id WHERE d.project_id=$2 AND d.environment_id=$6 AND a.active_program_id=$1 AND e.contract_version=2 AND e.event_type IN ('authority.cutover.completed','authority.rollback.completed','authority.stabilization.completed') AND destination.status='active' AND d.created_at>=$3 AND d.status IN ('failed','exhausted')),
	(SELECT CASE WHEN count(*)=count(last_success) THEN min(last_success) END FROM (SELECT ps.application_id,ps.platform,destination.id,(SELECT max(d.completed_at) FROM webhook_deliveries d JOIN webhook_events e ON e.id=d.webhook_event_id AND e.project_id=d.project_id JOIN billing_migration_authority_scopes a ON a.id=e.authority_scope_id AND a.project_id=e.project_id WHERE d.webhook_destination_id=destination.id AND a.project_id=ps.project_id AND a.environment_id=ps.environment_id AND a.application_id=ps.application_id AND a.platform=ps.platform AND a.active_program_id=ps.program_id AND e.contract_version=2 AND e.event_type IN ('authority.cutover.completed','authority.rollback.completed','authority.stabilization.completed') AND d.status='succeeded') last_success FROM billing_migration_program_scopes ps CROSS JOIN webhook_destinations destination WHERE ps.program_id=$1 AND ps.project_id=$2 AND destination.project_id=ps.project_id AND destination.environment_id=ps.environment_id AND destination.status='active' AND destination.contract_version=2 AND destination.event_types && ARRAY['authority.cutover.completed','authority.rollback.completed','authority.stabilization.completed']::text[]) coverage),
	(SELECT count(*) FROM billing_quarantine_records WHERE project_id=$2 AND environment_id=$6 AND status IN ('open','retrying'))+(SELECT count(*) FROM billing_migration_source_record_relationships WHERE program_id=$1 AND project_id=$2 AND quarantine_reason IS NOT NULL),
	(SELECT count(*) FROM billing_migration_cases WHERE program_id=$1 AND project_id=$2 AND status IN ('open','in_progress')),
	(SELECT count(*) FROM billing_migration_supported_app_versions WHERE program_id=$1 AND project_id=$2 AND (NOT supported OR NOT authority_aware)),
	(SELECT count(*) FROM billing_migration_run_jobs WHERE program_id=$1 AND project_id=$2 AND (status='failed' OR (status='running' AND lease_expires_at<$7)))+(SELECT count(*) FROM billing_migration_final_delta_jobs WHERE program_id=$1 AND project_id=$2 AND (status='failed' OR (status='running' AND lease_expires_at<$7)))+(SELECT count(*) FROM billing_migration_source_pull_jobs WHERE program_id=$1 AND project_id=$2 AND (status='failed' OR (status='running' AND lease_expires_at<$7)))`, c.Input.ProgramID, c.Input.ProjectID, p.FrozenAt, c.Input.ExpectedAuthorityEpoch, p.Thresholds.AccessAPIErrorMax, environment, now, int64(accessAPIEvidenceFreshness/time.Second)).Scan(&m.AuthorityMismatches, &m.AccessAPIErrors, &accessKnown, &m.SDKSyncFailures, &m.Divergences, &m.ValidationBacklog, &sourceAt, &m.WebhookFailures, &webhookAt, &m.QuarantinedRecords, &m.SupportCases, &m.OldAppVersions, &m.UnhealthyWorkers)
	if err != nil {
		return billingmigration.StabilizationObservation{}, false, err
	}
	breaches := billingmigration.StabilizationBreaches(p.Thresholds, m)
	if !accessKnown {
		breaches = append(breaches, "access_api_unknown")
	}
	if sourceAt == nil {
		v := now.Add(-time.Duration(p.Thresholds.SourceDeltaLagMaxSeconds+1) * time.Second)
		sourceAt = &v
		breaches = append(breaches, "source_delta_unknown")
	}
	if webhookAt == nil {
		v := now.Add(-time.Duration(p.Thresholds.WebhookFreshnessMaxSeconds+1) * time.Second)
		webhookAt = &v
		breaches = append(breaches, "webhook_unknown")
	}
	m.SourceDeltaLagSeconds = int64(now.Sub(*sourceAt).Seconds())
	m.WebhookAgeSeconds = int64(now.Sub(*webhookAt).Seconds())
	breaches = append(breaches, billingmigration.StabilizationBreaches(p.Thresholds, m)...)
	breaches = uniqueSorted(breaches)
	evidence := stabilizationDigest("mosaic-migration-stabilization-observation-v1", struct {
		Program             string
		Version, Epoch      int64
		Policy              []byte
		Metrics             billingmigration.StabilizationMetrics
		Breaches            []string
		Source, Webhook, At time.Time
	}{c.Input.ProgramID, version, c.Input.ExpectedAuthorityEpoch, policyRaw, m, breaches, sourceAt.UTC(), webhookAt.UTC(), now.UTC()})
	o := billingmigration.StabilizationObservation{ID: stabilizationID("mso", evidence), ProgramID: c.Input.ProgramID, ProjectID: c.Input.ProjectID, PolicyID: p.ID, PolicyDigest: p.PolicyDigest, EvidenceDigest: billingmigration.FormatDigest(evidence), StateVersion: version, AuthorityEpoch: c.Input.ExpectedAuthorityEpoch, Metrics: m, SourceWatermark: sourceAt.UTC(), WebhookLastSuccessAt: webhookAt.UTC(), ObservedAt: now.UTC(), BreachCodes: breaches, Healthy: len(breaches) == 0}
	_, err = tx.Exec(ctx, `INSERT INTO billing_migration_stabilization_observations(id,program_id,project_id,policy_id,state_version,authority_epoch,authority_mismatches,access_api_errors,sdk_sync_failures,divergences,validation_backlog,source_delta_lag_seconds,webhook_failures,webhook_age_seconds,quarantined_records,support_cases,old_app_versions,unhealthy_workers,source_watermark,webhook_last_success_at,breach_codes,healthy,evidence_digest,observed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`, o.ID, o.ProgramID, o.ProjectID, o.PolicyID, o.StateVersion, o.AuthorityEpoch, m.AuthorityMismatches, m.AccessAPIErrors, m.SDKSyncFailures, m.Divergences, m.ValidationBacklog, m.SourceDeltaLagSeconds, m.WebhookFailures, m.WebhookAgeSeconds, m.QuarantinedRecords, m.SupportCases, m.OldAppVersions, m.UnhealthyWorkers, o.SourceWatermark, o.WebhookLastSuccessAt, o.BreachCodes, o.Healthy, evidence, o.ObservedAt)
	if err != nil {
		return billingmigration.StabilizationObservation{}, false, translate(err, "append stabilization observation")
	}
	if _, err = tx.Exec(ctx, `INSERT INTO billing_migration_command_idempotency(id,program_id,project_id,command_kind,idempotency_key,request_digest,resource_id,created_at) VALUES('mci_'||$1,$2,$3,'stabilization_observation',$4,$5,$1,$6)`, o.ID, o.ProgramID, o.ProjectID, c.Input.IdempotencyKey, c.RequestDigest, o.ObservedAt); err != nil {
		return billingmigration.StabilizationObservation{}, false, err
	}
	if err = tx.Commit(ctx); err != nil {
		return billingmigration.StabilizationObservation{}, false, err
	}
	return o, false, nil
}

func uniqueSorted(values []string) []string {
	sort.Strings(values)
	out := values[:0]
	for _, v := range values {
		if len(out) == 0 || out[len(out)-1] != v {
			out = append(out, v)
		}
	}
	return out
}

const stabilizationObservationSelect = `SELECT o.id,o.program_id,o.project_id,o.policy_id,p.policy_digest,o.state_version,o.authority_epoch,o.authority_mismatches,o.access_api_errors,o.sdk_sync_failures,o.divergences,o.validation_backlog,o.source_delta_lag_seconds,o.webhook_failures,o.webhook_age_seconds,o.quarantined_records,o.support_cases,o.old_app_versions,o.unhealthy_workers,o.source_watermark,o.webhook_last_success_at,o.breach_codes,o.healthy,o.evidence_digest,o.observed_at FROM billing_migration_stabilization_observations o JOIN billing_migration_stabilization_policies p ON p.id=o.policy_id`

func scanStabilizationObservation(row pgx.Row) (billingmigration.StabilizationObservation, error) {
	var o billingmigration.StabilizationObservation
	var policy, evidence []byte
	m := &o.Metrics
	err := row.Scan(&o.ID, &o.ProgramID, &o.ProjectID, &o.PolicyID, &policy, &o.StateVersion, &o.AuthorityEpoch, &m.AuthorityMismatches, &m.AccessAPIErrors, &m.SDKSyncFailures, &m.Divergences, &m.ValidationBacklog, &m.SourceDeltaLagSeconds, &m.WebhookFailures, &m.WebhookAgeSeconds, &m.QuarantinedRecords, &m.SupportCases, &m.OldAppVersions, &m.UnhealthyWorkers, &o.SourceWatermark, &o.WebhookLastSuccessAt, &o.BreachCodes, &o.Healthy, &evidence, &o.ObservedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return o, billingmigration.ErrNotFound
	}
	o.PolicyDigest = billingmigration.FormatDigest(policy)
	o.EvidenceDigest = billingmigration.FormatDigest(evidence)
	if err != nil {
		return o, fmt.Errorf("scan stabilization observation: %w", err)
	}
	return o, nil
}
