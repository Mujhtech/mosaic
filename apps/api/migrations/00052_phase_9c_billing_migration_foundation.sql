-- Phase 9C Stage 2B: immutable migration evidence and resumable control-plane records.
-- Source records are deliberately isolated from billing_transaction_facts.

-- +goose Up
CREATE TABLE billing_migration_credentials (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    provider text NOT NULL CHECK (provider = 'revenuecat'),
    external_project_id text NOT NULL CHECK (btrim(external_project_id) <> ''),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
    envelope_version integer NOT NULL CHECK (envelope_version = 1),
    algorithm text NOT NULL CHECK (algorithm = 'AES-256-GCM'),
    key_id text NOT NULL CHECK (btrim(key_id) <> ''),
    nonce bytea NOT NULL CHECK (octet_length(nonce) = 12),
    ciphertext bytea NOT NULL CHECK (octet_length(ciphertext) >= 16),
    fingerprint bytea NOT NULL CHECK (octet_length(fingerprint) = 32),
    created_by_actor_id text NOT NULL,
    created_at timestamptz NOT NULL,
    revoked_at timestamptz,
    UNIQUE (id, project_id),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
    CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);
CREATE INDEX billing_migration_credentials_project_idx
    ON billing_migration_credentials(project_id, created_at DESC, id);

CREATE TABLE billing_migration_programs (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    source_adapter text NOT NULL CHECK (source_adapter = 'revenuecat'),
    source_adapter_version text NOT NULL CHECK (btrim(source_adapter_version) <> ''),
    credential_id text NOT NULL,
    state text NOT NULL DEFAULT 'draft' CHECK (state IN (
        'draft','assessing','mapping','importing','dry_run','shadowing','ready',
        'cutover_pending','stabilizing','completed','rolled_back','failed','cancelled')),
    state_version bigint NOT NULL DEFAULT 1 CHECK (state_version >= 1),
    authority_epoch_before bigint NOT NULL DEFAULT 0 CHECK (authority_epoch_before >= 0),
    stabilization_days integer NOT NULL DEFAULT 7 CHECK (stabilization_days BETWEEN 1 AND 30),
    rollback_window_days integer NOT NULL DEFAULT 7 CHECK (rollback_window_days BETWEEN 1 AND 30),
    scope_digest bytea NOT NULL CHECK (octet_length(scope_digest) = 32),
    policy_digest bytea NOT NULL CHECK (octet_length(policy_digest) = 32),
    idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
    request_digest bytea NOT NULL CHECK (octet_length(request_digest) = 32),
    created_by_actor_id text NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    UNIQUE (id, project_id),
    UNIQUE (id, project_id, environment_id),
    UNIQUE (project_id, idempotency_key),
    FOREIGN KEY (environment_id, project_id) REFERENCES environments(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (credential_id, project_id) REFERENCES billing_migration_credentials(id, project_id) ON DELETE RESTRICT
);
CREATE INDEX billing_migration_programs_project_idx
    ON billing_migration_programs(project_id, created_at DESC, id);

CREATE TABLE billing_migration_program_scopes (
    program_id text NOT NULL,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    application_id text NOT NULL,
    platform text NOT NULL CHECK (platform IN ('ios', 'android')),
    created_at timestamptz NOT NULL,
    PRIMARY KEY (program_id, application_id, platform),
    FOREIGN KEY (program_id, project_id, environment_id)
        REFERENCES billing_migration_programs(id, project_id, environment_id) ON DELETE RESTRICT,
    FOREIGN KEY (application_id, project_id, platform) REFERENCES applications(id, project_id, platform) ON DELETE RESTRICT
);
CREATE INDEX billing_migration_program_scopes_scope_idx
    ON billing_migration_program_scopes(project_id, environment_id, application_id, platform);

CREATE TABLE billing_migration_capability_assessments (
    id text PRIMARY KEY,
    program_id text NOT NULL,
    project_id text NOT NULL,
    state_version bigint NOT NULL CHECK (state_version >= 1),
    provider_api_version text NOT NULL CHECK (btrim(provider_api_version) <> ''),
    capabilities text[] NOT NULL CHECK (
        cardinality(capabilities) BETWEEN 1 AND 5 AND
        capabilities <@ ARRAY['read_customers','read_subscriptions','read_aliases','read_transfers','incremental_delta']::text[]),
    assessment_digest bytea NOT NULL CHECK (octet_length(assessment_digest) = 32),
    assessed_at timestamptz NOT NULL,
    UNIQUE (program_id, assessment_digest),
    FOREIGN KEY (program_id, project_id) REFERENCES billing_migration_programs(id, project_id) ON DELETE RESTRICT
);
CREATE INDEX billing_migration_capability_assessments_program_idx
    ON billing_migration_capability_assessments(program_id, assessed_at DESC, id);

CREATE TABLE billing_migration_source_manifests (
    id text PRIMARY KEY,
    program_id text NOT NULL,
    project_id text NOT NULL,
    state_version bigint NOT NULL CHECK (state_version >= 1),
    adapter_version text NOT NULL CHECK (btrim(adapter_version) <> ''),
    provider_api_version text NOT NULL CHECK (btrim(provider_api_version) <> ''),
    schema_version text NOT NULL CHECK (btrim(schema_version) <> ''),
    record_count bigint NOT NULL CHECK (record_count >= 0),
    current_access_record_count bigint NOT NULL CHECK (current_access_record_count BETWEEN 0 AND record_count),
    object_key text NOT NULL CHECK (btrim(object_key) <> ''),
    object_checksum bytea NOT NULL CHECK (octet_length(object_checksum) = 32),
    object_size_bytes bigint NOT NULL CHECK (object_size_bytes >= 0),
    object_encryption text NOT NULL CHECK (object_encryption = 'AES-256-GCM'),
    manifest_digest bytea NOT NULL CHECK (octet_length(manifest_digest) = 32),
    source_watermark text NOT NULL DEFAULT '',
    captured_at timestamptz NOT NULL,
    UNIQUE (id, program_id, project_id),
    UNIQUE (program_id, manifest_digest),
    FOREIGN KEY (program_id, project_id) REFERENCES billing_migration_programs(id, project_id) ON DELETE RESTRICT
);
CREATE INDEX billing_migration_source_manifests_program_idx
    ON billing_migration_source_manifests(program_id, captured_at DESC, id);

CREATE TABLE billing_migration_source_records (
    id text PRIMARY KEY,
    program_id text NOT NULL,
    project_id text NOT NULL,
    manifest_id text NOT NULL,
    source_kind text NOT NULL CHECK (source_kind IN ('customer','alias','subscription','transaction','transfer')),
    source_identifier text NOT NULL CHECK (
        octet_length(source_identifier) BETWEEN 1 AND 512 AND source_identifier !~ '[[:cntrl:]]'),
    source_revision text NOT NULL CHECK (octet_length(source_revision) BETWEEN 1 AND 256),
    source_cursor text NOT NULL DEFAULT '',
    record_digest bytea NOT NULL CHECK (octet_length(record_digest) = 32),
    current_access boolean NOT NULL DEFAULT false,
    normalization_schema_version text NOT NULL CHECK (btrim(normalization_schema_version) <> ''),
    evidence_kind text NOT NULL CHECK (evidence_kind IN (
        'trusted_source_export','trusted_provider_api','provider_signed','provider_validated','historical_informational')),
    observed_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL,
    UNIQUE (program_id, source_kind, source_identifier, source_revision, record_digest),
    FOREIGN KEY (program_id, project_id) REFERENCES billing_migration_programs(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (manifest_id, program_id, project_id)
        REFERENCES billing_migration_source_manifests(id, program_id, project_id) ON DELETE RESTRICT
);
CREATE INDEX billing_migration_source_records_program_cursor_idx
    ON billing_migration_source_records(program_id, source_cursor, id);

CREATE TABLE billing_migration_mapping_sets (
    id text PRIMARY KEY,
    program_id text NOT NULL,
    project_id text NOT NULL,
    version integer NOT NULL CHECK (version >= 1),
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'frozen')),
    mapping_digest bytea NOT NULL CHECK (octet_length(mapping_digest) = 32),
    expected_program_state_version bigint NOT NULL CHECK (expected_program_state_version >= 1),
    created_by_actor_id text NOT NULL,
    created_at timestamptz NOT NULL,
    frozen_at timestamptz,
    UNIQUE (id, program_id, project_id),
    UNIQUE (program_id, version),
    UNIQUE (program_id, mapping_digest),
    FOREIGN KEY (program_id, project_id) REFERENCES billing_migration_programs(id, project_id) ON DELETE RESTRICT,
    CHECK ((status = 'frozen') = (frozen_at IS NOT NULL))
);
CREATE INDEX billing_migration_mapping_sets_program_idx
    ON billing_migration_mapping_sets(program_id, version DESC);

CREATE TABLE billing_migration_mapping_entries (
    id text PRIMARY KEY,
    mapping_set_id text NOT NULL,
    program_id text NOT NULL,
    project_id text NOT NULL,
    source_kind text NOT NULL CHECK (source_kind IN ('customer_id','original_customer_id','audited_alias','product','entitlement')),
    source_identifier text NOT NULL CHECK (
        octet_length(source_identifier) BETWEEN 1 AND 512 AND source_identifier !~ '[[:cntrl:]]'),
    target_id text NOT NULL,
    match_kind text NOT NULL CHECK (match_kind IN ('exact','audited_alias')),
    application_id text,
    platform text CHECK (platform IN ('ios','android')),
    created_at timestamptz NOT NULL,
    UNIQUE (mapping_set_id, source_kind, source_identifier, application_id, platform),
    FOREIGN KEY (mapping_set_id, program_id, project_id)
        REFERENCES billing_migration_mapping_sets(id, program_id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (program_id, project_id) REFERENCES billing_migration_programs(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (program_id, application_id, platform)
        REFERENCES billing_migration_program_scopes(program_id, application_id, platform) ON DELETE RESTRICT,
    CHECK ((application_id IS NULL) = (platform IS NULL))
);
CREATE INDEX billing_migration_mapping_entries_set_idx
    ON billing_migration_mapping_entries(mapping_set_id, source_kind, id);
CREATE UNIQUE INDEX billing_migration_mapping_entries_global_source_key
    ON billing_migration_mapping_entries(mapping_set_id, source_kind, source_identifier)
    WHERE application_id IS NULL;

CREATE TABLE billing_migration_import_batches (
    id text PRIMARY KEY,
    program_id text NOT NULL,
    project_id text NOT NULL,
    manifest_id text NOT NULL,
    mapping_set_id text NOT NULL,
    idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
    request_digest bytea NOT NULL CHECK (octet_length(request_digest) = 32),
    expected_program_state_version bigint NOT NULL CHECK (expected_program_state_version >= 1),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed')),
    record_count integer NOT NULL CHECK (record_count BETWEEN 0 AND 1000),
    validated_count integer NOT NULL DEFAULT 0 CHECK (validated_count >= 0),
    quarantined_count integer NOT NULL DEFAULT 0 CHECK (quarantined_count >= 0),
    cursor_before text NOT NULL DEFAULT '',
    cursor_after text NOT NULL DEFAULT '',
    lease_owner text,
    lease_expires_at timestamptz,
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    lease_generation bigint NOT NULL DEFAULT 0 CHECK (lease_generation >= 0),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    UNIQUE (program_id, idempotency_key),
    FOREIGN KEY (program_id, project_id) REFERENCES billing_migration_programs(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (manifest_id, program_id, project_id)
        REFERENCES billing_migration_source_manifests(id, program_id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (mapping_set_id, program_id, project_id)
        REFERENCES billing_migration_mapping_sets(id, program_id, project_id) ON DELETE RESTRICT,
    CHECK (validated_count + quarantined_count <= record_count),
    CHECK ((status = 'running') = (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL))
);
CREATE INDEX billing_migration_import_batches_claim_idx
    ON billing_migration_import_batches(updated_at, id) WHERE status IN ('pending','running');

CREATE TABLE billing_migration_run_jobs (
    id text PRIMARY KEY,
    program_id text NOT NULL,
    project_id text NOT NULL,
    run_kind text NOT NULL CHECK (run_kind IN ('dry_run','shadow')),
    idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
    request_digest bytea NOT NULL CHECK (octet_length(request_digest) = 32),
    expected_program_state_version bigint NOT NULL CHECK (expected_program_state_version >= 1),
    manifest_digest bytea NOT NULL CHECK (octet_length(manifest_digest) = 32),
    mapping_digest bytea NOT NULL CHECK (octet_length(mapping_digest) = 32),
    policy_digest bytea NOT NULL CHECK (octet_length(policy_digest) = 32),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed')),
    result_run_id text,
    lease_owner text,
    lease_expires_at timestamptz,
    lease_generation bigint NOT NULL DEFAULT 0 CHECK (lease_generation >= 0),
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    UNIQUE (program_id, idempotency_key),
    UNIQUE (id, program_id, project_id),
    FOREIGN KEY (program_id, project_id) REFERENCES billing_migration_programs(id, project_id) ON DELETE RESTRICT,
    CHECK ((status = 'running') = (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)),
    CHECK ((status = 'completed') = (result_run_id IS NOT NULL))
);
CREATE INDEX billing_migration_run_jobs_claim_idx
    ON billing_migration_run_jobs(updated_at, id) WHERE status IN ('pending','running');

CREATE TABLE billing_migration_runs (
    id text PRIMARY KEY,
    program_id text NOT NULL,
    project_id text NOT NULL,
    run_kind text NOT NULL CHECK (run_kind IN ('dry_run','shadow')),
    state_version bigint NOT NULL CHECK (state_version >= 1),
    manifest_digest bytea NOT NULL CHECK (octet_length(manifest_digest) = 32),
    mapping_digest bytea NOT NULL CHECK (octet_length(mapping_digest) = 32),
    policy_digest bytea NOT NULL CHECK (octet_length(policy_digest) = 32),
    source_watermark text NOT NULL,
    provider_watermark text NOT NULL,
    shadow_watermark text NOT NULL,
    critical_count bigint NOT NULL DEFAULT 0 CHECK (critical_count >= 0),
    blocking_count bigint NOT NULL DEFAULT 0 CHECK (blocking_count >= 0),
    warning_count bigint NOT NULL DEFAULT 0 CHECK (warning_count >= 0),
    informational_count bigint NOT NULL DEFAULT 0 CHECK (informational_count >= 0),
    run_digest bytea NOT NULL CHECK (octet_length(run_digest) = 32),
    completed_at timestamptz NOT NULL,
    UNIQUE (id, program_id, project_id),
    UNIQUE (program_id, run_digest),
    FOREIGN KEY (program_id, project_id) REFERENCES billing_migration_programs(id, project_id) ON DELETE RESTRICT
);
CREATE INDEX billing_migration_runs_program_idx ON billing_migration_runs(program_id, completed_at DESC, id);

ALTER TABLE billing_migration_run_jobs ADD CONSTRAINT billing_migration_run_jobs_result_fk
    FOREIGN KEY (result_run_id, program_id, project_id)
    REFERENCES billing_migration_runs(id, program_id, project_id) ON DELETE RESTRICT;

CREATE TABLE billing_migration_divergences (
    id text PRIMARY KEY,
    program_id text NOT NULL,
    project_id text NOT NULL,
    run_id text NOT NULL,
    state_version bigint NOT NULL CHECK (state_version >= 1),
    classification text NOT NULL CHECK (classification IN ('critical','blocking','warning','informational')),
    reason text NOT NULL CHECK (reason IN (
        'source_grants_mosaic_denies','identity_conflict','authority_scope_conflict','mapping_missing',
        'provider_validation_missing','watermark_stale','unsupported_application_version',
        'historical_mismatch','provider_timing_lag','normalization_difference')),
    evidence_digest bytea NOT NULL CHECK (octet_length(evidence_digest) = 32),
    classification_rule_version text NOT NULL CHECK (btrim(classification_rule_version) <> ''),
    observed_at timestamptz NOT NULL,
    UNIQUE (run_id, evidence_digest),
    FOREIGN KEY (program_id, project_id) REFERENCES billing_migration_programs(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (run_id, program_id, project_id)
        REFERENCES billing_migration_runs(id, program_id, project_id) ON DELETE RESTRICT
);
CREATE INDEX billing_migration_divergences_program_class_idx
    ON billing_migration_divergences(program_id, classification, observed_at DESC, id);

CREATE TABLE billing_migration_readiness_assessments (
    id text PRIMARY KEY,
    program_id text NOT NULL,
    project_id text NOT NULL,
    state_version bigint NOT NULL CHECK (state_version >= 1),
    ready boolean NOT NULL,
    current_access_mapping_percent numeric(5,2) NOT NULL CHECK (current_access_mapping_percent BETWEEN 0 AND 100),
    current_access_evidence_percent numeric(5,2) NOT NULL CHECK (current_access_evidence_percent BETWEEN 0 AND 100),
    critical_count bigint NOT NULL CHECK (critical_count >= 0),
    blocking_count bigint NOT NULL CHECK (blocking_count >= 0),
    warning_count bigint NOT NULL CHECK (warning_count >= 0),
    informational_count bigint NOT NULL CHECK (informational_count >= 0),
    final_delta_completed boolean NOT NULL,
    watermarks_fresh boolean NOT NULL,
    supported_versions_authority_aware boolean NOT NULL,
    readiness_digest bytea NOT NULL CHECK (octet_length(readiness_digest) = 32),
    assessed_at timestamptz NOT NULL,
    UNIQUE (program_id, readiness_digest),
    FOREIGN KEY (program_id, project_id) REFERENCES billing_migration_programs(id, project_id) ON DELETE RESTRICT,
    CHECK (ready = (
        current_access_mapping_percent = 100 AND current_access_evidence_percent = 100 AND
        critical_count = 0 AND blocking_count = 0 AND final_delta_completed AND
        watermarks_fresh AND supported_versions_authority_aware))
);
CREATE INDEX billing_migration_readiness_program_idx
    ON billing_migration_readiness_assessments(program_id, assessed_at DESC, id);

-- +goose StatementBegin
CREATE FUNCTION reject_billing_migration_immutable_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% is immutable', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;
-- +goose StatementEnd

CREATE TRIGGER billing_migration_scopes_immutable BEFORE UPDATE OR DELETE ON billing_migration_program_scopes
FOR EACH ROW EXECUTE FUNCTION reject_billing_migration_immutable_change();
CREATE TRIGGER billing_migration_assessments_immutable BEFORE UPDATE OR DELETE ON billing_migration_capability_assessments
FOR EACH ROW EXECUTE FUNCTION reject_billing_migration_immutable_change();
CREATE TRIGGER billing_migration_manifests_immutable BEFORE UPDATE OR DELETE ON billing_migration_source_manifests
FOR EACH ROW EXECUTE FUNCTION reject_billing_migration_immutable_change();
CREATE TRIGGER billing_migration_records_immutable BEFORE UPDATE OR DELETE ON billing_migration_source_records
FOR EACH ROW EXECUTE FUNCTION reject_billing_migration_immutable_change();
CREATE TRIGGER billing_migration_entries_immutable BEFORE UPDATE OR DELETE ON billing_migration_mapping_entries
FOR EACH ROW EXECUTE FUNCTION reject_billing_migration_immutable_change();
CREATE TRIGGER billing_migration_runs_immutable BEFORE UPDATE OR DELETE ON billing_migration_runs
FOR EACH ROW EXECUTE FUNCTION reject_billing_migration_immutable_change();
CREATE TRIGGER billing_migration_divergences_immutable BEFORE UPDATE OR DELETE ON billing_migration_divergences
FOR EACH ROW EXECUTE FUNCTION reject_billing_migration_immutable_change();
CREATE TRIGGER billing_migration_readiness_immutable BEFORE UPDATE OR DELETE ON billing_migration_readiness_assessments
FOR EACH ROW EXECUTE FUNCTION reject_billing_migration_immutable_change();

-- +goose StatementBegin
CREATE FUNCTION protect_frozen_billing_migration_mapping() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status = 'frozen' THEN
        RAISE EXCEPTION 'frozen billing migration mapping set is immutable' USING ERRCODE = '55000';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    IF NEW.id <> OLD.id OR NEW.program_id <> OLD.program_id OR NEW.project_id <> OLD.project_id OR
       NEW.version <> OLD.version OR NEW.mapping_digest <> OLD.mapping_digest OR
       NEW.expected_program_state_version <> OLD.expected_program_state_version OR
       NEW.created_by_actor_id <> OLD.created_by_actor_id OR NEW.created_at <> OLD.created_at OR
       NEW.status <> 'frozen' OR NEW.frozen_at IS NULL THEN
        RAISE EXCEPTION 'mapping set permits only draft to frozen transition' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER billing_migration_mapping_sets_frozen
BEFORE UPDATE OR DELETE ON billing_migration_mapping_sets
FOR EACH ROW EXECUTE FUNCTION protect_frozen_billing_migration_mapping();

-- +goose StatementBegin
CREATE FUNCTION validate_billing_migration_mapping_target() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.source_kind IN ('customer_id','original_customer_id','audited_alias') AND NOT EXISTS (
        SELECT 1 FROM billing_customers WHERE id=NEW.target_id AND project_id=NEW.project_id
    ) THEN
        RAISE EXCEPTION 'identity mapping target is outside the migration Project' USING ERRCODE = '23503';
    ELSIF NEW.source_kind = 'product' AND NOT EXISTS (
        SELECT 1 FROM products WHERE id=NEW.target_id AND project_id=NEW.project_id
    ) THEN
        RAISE EXCEPTION 'product mapping target is outside the migration Project' USING ERRCODE = '23503';
    ELSIF NEW.source_kind = 'entitlement' AND NOT EXISTS (
        SELECT 1 FROM entitlements WHERE id=NEW.target_id AND project_id=NEW.project_id
    ) THEN
        RAISE EXCEPTION 'entitlement mapping target is outside the migration Project' USING ERRCODE = '23503';
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER billing_migration_mapping_target_scope
BEFORE INSERT ON billing_migration_mapping_entries
FOR EACH ROW EXECUTE FUNCTION validate_billing_migration_mapping_target();

-- +goose Down
DROP TRIGGER billing_migration_mapping_target_scope ON billing_migration_mapping_entries;
DROP FUNCTION validate_billing_migration_mapping_target;
DROP TRIGGER billing_migration_mapping_sets_frozen ON billing_migration_mapping_sets;
DROP FUNCTION protect_frozen_billing_migration_mapping;
DROP TRIGGER billing_migration_readiness_immutable ON billing_migration_readiness_assessments;
DROP TRIGGER billing_migration_divergences_immutable ON billing_migration_divergences;
DROP TRIGGER billing_migration_runs_immutable ON billing_migration_runs;
DROP TRIGGER billing_migration_entries_immutable ON billing_migration_mapping_entries;
DROP TRIGGER billing_migration_records_immutable ON billing_migration_source_records;
DROP TRIGGER billing_migration_manifests_immutable ON billing_migration_source_manifests;
DROP TRIGGER billing_migration_assessments_immutable ON billing_migration_capability_assessments;
DROP TRIGGER billing_migration_scopes_immutable ON billing_migration_program_scopes;
DROP FUNCTION reject_billing_migration_immutable_change;
DROP TABLE billing_migration_readiness_assessments;
DROP TABLE billing_migration_divergences;
DROP TABLE billing_migration_run_jobs;
DROP TABLE billing_migration_runs;
DROP TABLE billing_migration_import_batches;
DROP TABLE billing_migration_mapping_entries;
DROP TABLE billing_migration_mapping_sets;
DROP TABLE billing_migration_source_records;
DROP TABLE billing_migration_source_manifests;
DROP TABLE billing_migration_capability_assessments;
DROP TABLE billing_migration_program_scopes;
DROP TABLE billing_migration_programs;
DROP TABLE billing_migration_credentials;
