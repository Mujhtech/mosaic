-- Phase 9C Work Packages 17-18: frozen stabilization monitoring and immutable rollback-readiness checkpoints.
-- These records observe and attest the existing authority path; they never mutate authority or execute rollback.

-- +goose Up
ALTER TABLE billing_migration_final_deltas
    ADD CONSTRAINT billing_migration_final_deltas_scope_unique UNIQUE(id,program_id,project_id);
CREATE TABLE billing_migration_stabilization_policies (
    id text PRIMARY KEY,
    program_id text NOT NULL,
    project_id text NOT NULL,
    state_version bigint NOT NULL CHECK (state_version >= 1),
    authority_mismatch_max bigint NOT NULL CHECK (authority_mismatch_max >= 0),
    access_api_error_max bigint NOT NULL CHECK (access_api_error_max >= 0),
    sdk_sync_failure_max bigint NOT NULL CHECK (sdk_sync_failure_max >= 0),
    divergence_max bigint NOT NULL CHECK (divergence_max >= 0),
    validation_backlog_max bigint NOT NULL CHECK (validation_backlog_max >= 0),
    source_delta_lag_max_seconds bigint NOT NULL CHECK (source_delta_lag_max_seconds >= 1),
    webhook_failure_max bigint NOT NULL CHECK (webhook_failure_max >= 0),
    webhook_freshness_max_seconds bigint NOT NULL CHECK (webhook_freshness_max_seconds >= 1),
    quarantine_max bigint NOT NULL CHECK (quarantine_max >= 0),
    support_case_max bigint NOT NULL CHECK (support_case_max >= 0),
    old_app_version_max bigint NOT NULL CHECK (old_app_version_max >= 0),
    worker_unhealthy_max bigint NOT NULL CHECK (worker_unhealthy_max >= 0),
    policy_digest bytea NOT NULL CHECK (octet_length(policy_digest)=32),
    frozen_by_actor_id text NOT NULL,
    frozen_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
    UNIQUE (program_id), UNIQUE (program_id,policy_digest), UNIQUE(id,program_id,project_id),
    FOREIGN KEY (program_id,project_id) REFERENCES billing_migration_programs(id,project_id) ON DELETE RESTRICT
);

CREATE TABLE billing_migration_stabilization_observations (
    id text PRIMARY KEY,
    program_id text NOT NULL,
    project_id text NOT NULL,
    policy_id text NOT NULL,
    state_version bigint NOT NULL CHECK (state_version >= 1),
    authority_epoch bigint NOT NULL CHECK (authority_epoch >= 1),
    authority_mismatches bigint NOT NULL CHECK (authority_mismatches >= 0),
    access_api_errors bigint NOT NULL CHECK (access_api_errors >= 0),
    sdk_sync_failures bigint NOT NULL CHECK (sdk_sync_failures >= 0),
    divergences bigint NOT NULL CHECK (divergences >= 0),
    validation_backlog bigint NOT NULL CHECK (validation_backlog >= 0),
    source_delta_lag_seconds bigint NOT NULL CHECK (source_delta_lag_seconds >= 0),
    webhook_failures bigint NOT NULL CHECK (webhook_failures >= 0),
    webhook_age_seconds bigint NOT NULL CHECK (webhook_age_seconds >= 0),
    quarantined_records bigint NOT NULL CHECK (quarantined_records >= 0),
    support_cases bigint NOT NULL CHECK (support_cases >= 0),
    old_app_versions bigint NOT NULL CHECK (old_app_versions >= 0),
    unhealthy_workers bigint NOT NULL CHECK (unhealthy_workers >= 0),
    source_watermark timestamptz NOT NULL,
    webhook_last_success_at timestamptz NOT NULL,
    breach_codes text[] NOT NULL,
    healthy boolean NOT NULL,
    evidence_digest bytea NOT NULL CHECK (octet_length(evidence_digest)=32),
    observed_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
    UNIQUE (program_id,evidence_digest), UNIQUE (id,program_id,project_id),
    FOREIGN KEY (program_id,project_id) REFERENCES billing_migration_programs(id,project_id) ON DELETE RESTRICT,
    FOREIGN KEY (policy_id,program_id,project_id) REFERENCES billing_migration_stabilization_policies(id,program_id,project_id) ON DELETE RESTRICT,
    CHECK (healthy = (cardinality(breach_codes)=0)),
    CHECK (source_watermark <= observed_at AND webhook_last_success_at <= observed_at)
);
CREATE INDEX billing_migration_stabilization_observations_cursor_idx
    ON billing_migration_stabilization_observations(program_id,observed_at DESC,id DESC);

CREATE TABLE billing_migration_access_api_signal_windows (
    id text PRIMARY KEY,
    program_id text NOT NULL,
    project_id text NOT NULL,
    window_started_at timestamptz NOT NULL,
    window_ended_at timestamptz NOT NULL,
    request_count bigint NOT NULL CHECK (request_count >= 0),
    error_count bigint NOT NULL CHECK (error_count >= 0 AND error_count <= request_count),
    evidence_digest bytea NOT NULL CHECK (octet_length(evidence_digest)=32),
    recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
    UNIQUE(program_id,evidence_digest),
    FOREIGN KEY(program_id,project_id) REFERENCES billing_migration_programs(id,project_id) ON DELETE RESTRICT,
    CHECK(window_ended_at > window_started_at AND window_ended_at <= recorded_at)
);
CREATE INDEX billing_migration_access_api_signals_cursor_idx ON billing_migration_access_api_signal_windows(program_id,window_ended_at DESC,id DESC);

CREATE TABLE billing_migration_rollback_readiness_assessments (
    id text PRIMARY KEY,
    program_id text NOT NULL,
    project_id text NOT NULL,
    observation_id text NOT NULL,
    state_version bigint NOT NULL CHECK (state_version >= 1),
    source_support_available boolean NOT NULL,
    source_healthy boolean NOT NULL,
    source_health_digest bytea NOT NULL CHECK (octet_length(source_health_digest)=32),
    source_current_access_digest bytea NOT NULL CHECK (octet_length(source_current_access_digest)=32),
    source_current_access_at timestamptz NOT NULL,
    latest_delta_id text NOT NULL,
    latest_delta_digest bytea NOT NULL CHECK (octet_length(latest_delta_digest)=32),
    customer_impact_count bigint NOT NULL CHECK (customer_impact_count >= 0),
    customer_impact_digest bytea NOT NULL CHECK (octet_length(customer_impact_digest)=32),
    application_compatible boolean NOT NULL,
    application_compatibility_digest bytea NOT NULL CHECK (octet_length(application_compatibility_digest)=32),
    limitations_blocking boolean NOT NULL,
    limitation_report_digest bytea NOT NULL CHECK (octet_length(limitation_report_digest)=32),
    audit_digest bytea NOT NULL CHECK (octet_length(audit_digest)=32),
    stabilization_healthy boolean NOT NULL,
    ready boolean NOT NULL,
    readiness_digest bytea NOT NULL CHECK (octet_length(readiness_digest)=32),
    assessed_by_actor_id text NOT NULL,
    assessed_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
    UNIQUE (program_id,readiness_digest), UNIQUE (id,program_id,project_id), UNIQUE(id,program_id,project_id,ready),
    FOREIGN KEY (program_id,project_id) REFERENCES billing_migration_programs(id,project_id) ON DELETE RESTRICT,
    FOREIGN KEY (observation_id,program_id,project_id) REFERENCES billing_migration_stabilization_observations(id,program_id,project_id) ON DELETE RESTRICT,
    FOREIGN KEY (latest_delta_id,program_id,project_id) REFERENCES billing_migration_final_deltas(id,program_id,project_id) ON DELETE RESTRICT,
    CHECK (ready = (stabilization_healthy AND source_support_available AND source_healthy AND application_compatible AND NOT limitations_blocking))
);
CREATE INDEX billing_migration_rollback_readiness_cursor_idx
    ON billing_migration_rollback_readiness_assessments(program_id,assessed_at DESC,id DESC);

CREATE TABLE billing_migration_rollback_readiness_checkpoints (
    id text PRIMARY KEY,
    program_id text NOT NULL,
    project_id text NOT NULL,
    assessment_id text NOT NULL,
    assessment_ready boolean NOT NULL CHECK (assessment_ready),
    state_version bigint NOT NULL CHECK (state_version >= 1),
    authority_epoch bigint NOT NULL CHECK (authority_epoch >= 1),
    authority_digest bytea NOT NULL CHECK (octet_length(authority_digest)=32),
    policy_digest bytea NOT NULL CHECK (octet_length(policy_digest)=32),
    evidence_digest bytea NOT NULL CHECK (octet_length(evidence_digest)=32),
    readiness_digest bytea NOT NULL CHECK (octet_length(readiness_digest)=32),
    checkpoint_digest bytea NOT NULL CHECK (octet_length(checkpoint_digest)=32),
    created_by_actor_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
    UNIQUE (program_id,checkpoint_digest), UNIQUE (id,program_id,project_id),
    FOREIGN KEY (program_id,project_id) REFERENCES billing_migration_programs(id,project_id) ON DELETE RESTRICT,
    FOREIGN KEY (assessment_id,program_id,project_id,assessment_ready) REFERENCES billing_migration_rollback_readiness_assessments(id,program_id,project_id,ready) ON DELETE RESTRICT
);
CREATE INDEX billing_migration_rollback_checkpoints_cursor_idx
    ON billing_migration_rollback_readiness_checkpoints(program_id,created_at DESC,id DESC);

CREATE TRIGGER billing_migration_stabilization_policies_immutable BEFORE UPDATE OR DELETE ON billing_migration_stabilization_policies FOR EACH ROW EXECUTE FUNCTION reject_billing_migration_immutable_change();
CREATE TRIGGER billing_migration_stabilization_observations_immutable BEFORE UPDATE OR DELETE ON billing_migration_stabilization_observations FOR EACH ROW EXECUTE FUNCTION reject_billing_migration_immutable_change();
CREATE TRIGGER billing_migration_access_api_signals_immutable BEFORE UPDATE OR DELETE ON billing_migration_access_api_signal_windows FOR EACH ROW EXECUTE FUNCTION reject_billing_migration_immutable_change();
CREATE TRIGGER billing_migration_rollback_readiness_immutable BEFORE UPDATE OR DELETE ON billing_migration_rollback_readiness_assessments FOR EACH ROW EXECUTE FUNCTION reject_billing_migration_immutable_change();
CREATE TRIGGER billing_migration_rollback_checkpoints_immutable BEFORE UPDATE OR DELETE ON billing_migration_rollback_readiness_checkpoints FOR EACH ROW EXECUTE FUNCTION reject_billing_migration_immutable_change();

-- +goose Down
-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM billing_migration_stabilization_policies)
       OR EXISTS (SELECT 1 FROM billing_migration_stabilization_observations)
       OR EXISTS (SELECT 1 FROM billing_migration_access_api_signal_windows)
       OR EXISTS (SELECT 1 FROM billing_migration_rollback_readiness_assessments)
       OR EXISTS (SELECT 1 FROM billing_migration_rollback_readiness_checkpoints) THEN
        RAISE EXCEPTION 'cannot rollback migration 00061: immutable stabilization or rollback-readiness evidence exists' USING ERRCODE='55000';
    END IF;
END;
$$;
-- +goose StatementEnd
DROP TRIGGER billing_migration_rollback_checkpoints_immutable ON billing_migration_rollback_readiness_checkpoints;
DROP TRIGGER billing_migration_rollback_readiness_immutable ON billing_migration_rollback_readiness_assessments;
DROP TRIGGER billing_migration_stabilization_observations_immutable ON billing_migration_stabilization_observations;
DROP TRIGGER billing_migration_access_api_signals_immutable ON billing_migration_access_api_signal_windows;
DROP TRIGGER billing_migration_stabilization_policies_immutable ON billing_migration_stabilization_policies;
DROP TABLE billing_migration_rollback_readiness_checkpoints;
DROP TABLE billing_migration_rollback_readiness_assessments;
DROP TABLE billing_migration_access_api_signal_windows;
DROP TABLE billing_migration_stabilization_observations;
DROP TABLE billing_migration_stabilization_policies;
ALTER TABLE billing_migration_final_deltas DROP CONSTRAINT billing_migration_final_deltas_scope_unique;
