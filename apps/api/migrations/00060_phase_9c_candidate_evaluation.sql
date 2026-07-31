-- Phase 9C Package F: immutable migration-owned projection candidates.
-- Candidate snapshots are ordinary append-only snapshots so existing cutover
-- pointer FKs can name them, but these bindings prove that they were computed
-- from one frozen program epoch and never make them live.

-- +goose Up
ALTER TABLE billing_migration_divergences DROP CONSTRAINT billing_migration_divergences_reason_check;
ALTER TABLE billing_migration_divergences ADD CONSTRAINT billing_migration_divergences_reason_check CHECK (reason IN (
    'source_grants_mosaic_denies','mosaic_grants_source_denies','identity_conflict','authority_scope_conflict','mapping_missing',
    'provider_validation_missing','watermark_stale','unsupported_application_version',
    'historical_mismatch','provider_timing_lag','normalization_difference'
));

CREATE TABLE billing_migration_candidate_evaluations (
    id text PRIMARY KEY,
    program_id text NOT NULL,
    project_id text NOT NULL,
    job_id text NOT NULL,
    job_kind text NOT NULL CHECK (job_kind IN ('dry_run','shadow','final_delta')),
    state_version bigint NOT NULL CHECK (state_version >= 1),
    authority_epoch bigint NOT NULL CHECK (authority_epoch >= 0),
    manifest_digest bytea NOT NULL CHECK (octet_length(manifest_digest)=32),
    mapping_digest bytea NOT NULL CHECK (octet_length(mapping_digest)=32),
    policy_digest bytea NOT NULL CHECK (octet_length(policy_digest)=32),
    evidence_digest bytea NOT NULL CHECK (octet_length(evidence_digest)=32),
    source_watermark timestamptz NOT NULL,
    provider_watermark timestamptz NOT NULL,
    shadow_watermark timestamptz NOT NULL,
    cohort_digest bytea NOT NULL CHECK (octet_length(cohort_digest)=32),
    evaluation_digest bytea NOT NULL CHECK (octet_length(evaluation_digest)=32),
    evaluated_at timestamptz NOT NULL,
    UNIQUE (program_id, job_id),
    UNIQUE (id, program_id, project_id),
    FOREIGN KEY (program_id,project_id) REFERENCES billing_migration_programs(id,project_id) ON DELETE RESTRICT
);

CREATE TABLE billing_migration_candidate_snapshots (
    id text PRIMARY KEY,
    evaluation_id text NOT NULL,
    program_id text NOT NULL,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    application_id text NOT NULL,
    platform text NOT NULL CHECK (platform IN ('ios','android')),
    billing_customer_id text NOT NULL,
    snapshot_id text NOT NULL,
    source_evidence_digest bytea NOT NULL CHECK (octet_length(source_evidence_digest)=32),
    candidate_digest bytea NOT NULL CHECK (octet_length(candidate_digest)=32),
    comparison_digest bytea NOT NULL CHECK (octet_length(comparison_digest)=32),
    source_current_access boolean NOT NULL,
    mosaic_current_access boolean NOT NULL,
    created_at timestamptz NOT NULL,
    UNIQUE (evaluation_id,application_id,platform,billing_customer_id),
    UNIQUE (snapshot_id),
    FOREIGN KEY (evaluation_id,program_id,project_id)
        REFERENCES billing_migration_candidate_evaluations(id,program_id,project_id) ON DELETE RESTRICT,
    FOREIGN KEY (program_id,application_id,platform)
        REFERENCES billing_migration_program_scopes(program_id,application_id,platform) ON DELETE RESTRICT,
    FOREIGN KEY (snapshot_id,project_id,environment_id,billing_customer_id)
        REFERENCES customer_entitlement_snapshots(id,project_id,environment_id,billing_customer_id) ON DELETE RESTRICT
);
CREATE INDEX billing_migration_candidate_snapshots_scope_idx
    ON billing_migration_candidate_snapshots(program_id,application_id,platform,billing_customer_id);

CREATE TRIGGER billing_migration_candidate_evaluations_immutable
BEFORE UPDATE OR DELETE ON billing_migration_candidate_evaluations
FOR EACH ROW EXECUTE FUNCTION reject_billing_migration_immutable_change();
CREATE TRIGGER billing_migration_candidate_snapshots_immutable
BEFORE UPDATE OR DELETE ON billing_migration_candidate_snapshots
FOR EACH ROW EXECUTE FUNCTION reject_billing_migration_immutable_change();

-- +goose Down
-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM billing_migration_candidate_evaluations)
       OR EXISTS (SELECT 1 FROM billing_migration_candidate_snapshots) THEN
        RAISE EXCEPTION 'immutable candidate evaluation evidence exists; migration 00060 cannot be reversed'
            USING ERRCODE='55000';
    END IF;
END;
$$;
-- +goose StatementEnd
DROP TRIGGER billing_migration_candidate_snapshots_immutable ON billing_migration_candidate_snapshots;
DROP TRIGGER billing_migration_candidate_evaluations_immutable ON billing_migration_candidate_evaluations;
DROP TABLE billing_migration_candidate_snapshots;
DROP TABLE billing_migration_candidate_evaluations;
ALTER TABLE billing_migration_divergences DROP CONSTRAINT billing_migration_divergences_reason_check;
ALTER TABLE billing_migration_divergences ADD CONSTRAINT billing_migration_divergences_reason_check CHECK (reason IN (
    'source_grants_mosaic_denies','identity_conflict','authority_scope_conflict','mapping_missing',
    'provider_validation_missing','watermark_stale','unsupported_application_version',
    'historical_mismatch','provider_timing_lag','normalization_difference'
));
