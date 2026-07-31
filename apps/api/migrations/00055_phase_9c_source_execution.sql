-- Phase 9C Stage 2E Package A: encrypted source-object and bounded execution queues.
-- Source evidence remains separate from billing_transaction_facts and live entitlement pointers.

-- +goose Up
CREATE TABLE billing_migration_source_objects (
    id text PRIMARY KEY,
    program_id text NOT NULL,
    project_id text NOT NULL,
    reservation_key text NOT NULL CHECK (btrim(reservation_key) <> '' AND length(reservation_key) <= 128),
    reservation_digest bytea NOT NULL CHECK (octet_length(reservation_digest) = 32),
    reservation_generation bigint NOT NULL DEFAULT 1 CHECK (reservation_generation >= 1),
    write_token_digest bytea NOT NULL CHECK (octet_length(write_token_digest) = 32),
    object_key text NOT NULL CHECK (btrim(object_key) <> '' AND length(object_key) <= 512),
    source_channel text NOT NULL CHECK (source_channel IN ('revenuecat_api_v2','scheduled_export_evidence')),
    adapter_version text NOT NULL CHECK (btrim(adapter_version) <> ''),
    schema_version text NOT NULL CHECK (btrim(schema_version) <> ''),
    state text NOT NULL CHECK (state IN ('reserved','verified','failed','deleted')),
    envelope_version integer,
    algorithm text,
    key_id text,
    nonce bytea,
    chunk_size integer,
    chunk_count integer,
    aad_digest bytea,
    plaintext_digest bytea,
    plaintext_size_bytes bigint,
    ciphertext_digest bytea,
    ciphertext_size_bytes bigint,
    error_code text CHECK (error_code IS NULL OR (btrim(error_code) <> '' AND length(error_code) <= 64 AND error_code !~ '[[:cntrl:]]')),
    reserved_at timestamptz NOT NULL,
    verified_at timestamptz,
    failed_at timestamptz,
    deleted_at timestamptz,
    deletion_actor_id text,
    deletion_digest bytea,
    UNIQUE (id, program_id, project_id),
    UNIQUE (program_id, reservation_key),
    UNIQUE (object_key),
    FOREIGN KEY (program_id, project_id) REFERENCES billing_migration_programs(id, project_id) ON DELETE RESTRICT,
    CHECK (plaintext_size_bytes IS NULL OR plaintext_size_bytes BETWEEN 0 AND 104857600),
    CHECK (ciphertext_size_bytes IS NULL OR ciphertext_size_bytes >= 0),
    CHECK ((state = 'reserved' AND envelope_version IS NULL AND verified_at IS NULL AND failed_at IS NULL AND deleted_at IS NULL)
        OR (state = 'verified' AND envelope_version = 1 AND algorithm = 'AES-256-GCM-CHUNKED'
            AND key_id IS NOT NULL AND btrim(key_id) <> '' AND nonce IS NOT NULL AND octet_length(nonce) = 12
            AND chunk_size IS NOT NULL AND chunk_size BETWEEN 16384 AND 4194304
            AND chunk_count >= 0 AND octet_length(aad_digest) = 32 AND octet_length(plaintext_digest) = 32
            AND plaintext_size_bytes IS NOT NULL AND octet_length(ciphertext_digest) = 32
            AND ciphertext_size_bytes IS NOT NULL AND verified_at IS NOT NULL AND failed_at IS NULL AND deleted_at IS NULL)
        OR (state = 'failed' AND error_code IS NOT NULL AND failed_at IS NOT NULL AND verified_at IS NULL AND deleted_at IS NULL)
        OR (state = 'deleted' AND verified_at IS NOT NULL AND deleted_at IS NOT NULL AND deletion_actor_id IS NOT NULL
            AND octet_length(deletion_digest) = 32)),
    CHECK ((deleted_at IS NULL AND deletion_actor_id IS NULL AND deletion_digest IS NULL)
        OR (deleted_at IS NOT NULL AND deletion_actor_id IS NOT NULL AND octet_length(deletion_digest) = 32))
);
CREATE INDEX billing_migration_source_objects_program_state_idx
    ON billing_migration_source_objects(program_id, state, reserved_at, id);

CREATE TABLE billing_migration_source_object_manifests (
    source_object_id text PRIMARY KEY,
    manifest_id text NOT NULL UNIQUE,
    program_id text NOT NULL,
    project_id text NOT NULL,
    binding_digest bytea NOT NULL CHECK (octet_length(binding_digest) = 32),
    bound_at timestamptz NOT NULL,
    FOREIGN KEY (source_object_id, program_id, project_id)
        REFERENCES billing_migration_source_objects(id, program_id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (manifest_id, program_id, project_id)
        REFERENCES billing_migration_source_manifests(id, program_id, project_id) ON DELETE RESTRICT
);

CREATE TABLE billing_migration_import_batch_records (
    import_batch_id text NOT NULL, program_id text NOT NULL, project_id text NOT NULL,
    source_record_id text NOT NULL, ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 999),
    provider text NOT NULL CHECK (provider IN ('app_store','google_play')),
    environment_id text NOT NULL, application_id text NOT NULL,
    provider_reference text NOT NULL CHECK (octet_length(provider_reference) BETWEEN 1 AND 512 AND provider_reference !~ '[[:cntrl:]]'),
    PRIMARY KEY(import_batch_id,source_record_id), UNIQUE(import_batch_id,ordinal),
    FOREIGN KEY(import_batch_id,program_id,project_id) REFERENCES billing_migration_import_batches(id,program_id,project_id) ON DELETE RESTRICT,
    FOREIGN KEY(source_record_id,program_id,project_id) REFERENCES billing_migration_source_records(id,program_id,project_id) ON DELETE RESTRICT,
    FOREIGN KEY(environment_id,project_id) REFERENCES environments(id,project_id) ON DELETE RESTRICT,
    FOREIGN KEY(application_id,project_id) REFERENCES applications(id,project_id) ON DELETE RESTRICT
);

ALTER TABLE billing_migration_import_batches
    ADD COLUMN due_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN max_attempts integer NOT NULL DEFAULT 8 CHECK (max_attempts BETWEEN 1 AND 20),
    ADD COLUMN last_error_code text CHECK (last_error_code IS NULL OR (btrim(last_error_code) <> '' AND length(last_error_code) <= 64 AND last_error_code !~ '[[:cntrl:]]'));
ALTER TABLE billing_migration_import_batches ALTER COLUMN due_at DROP DEFAULT, ALTER COLUMN max_attempts DROP DEFAULT;
DROP INDEX billing_migration_import_batches_claim_idx;
CREATE INDEX billing_migration_import_batches_claim_idx
    ON billing_migration_import_batches(due_at, updated_at, id)
    WHERE status = 'pending' OR status = 'running';

ALTER TABLE billing_migration_run_jobs
    ADD COLUMN due_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN max_attempts integer NOT NULL DEFAULT 8 CHECK (max_attempts BETWEEN 1 AND 20),
    ADD COLUMN last_error_code text CHECK (last_error_code IS NULL OR (btrim(last_error_code) <> '' AND length(last_error_code) <= 64 AND last_error_code !~ '[[:cntrl:]]'));
ALTER TABLE billing_migration_run_jobs ALTER COLUMN due_at DROP DEFAULT, ALTER COLUMN max_attempts DROP DEFAULT;
DROP INDEX billing_migration_run_jobs_claim_idx;
CREATE INDEX billing_migration_run_jobs_claim_idx
    ON billing_migration_run_jobs(due_at, updated_at, id)
    WHERE status = 'pending' OR status = 'running';

CREATE TABLE billing_migration_final_delta_jobs (
    id text PRIMARY KEY,
    program_id text NOT NULL,
    project_id text NOT NULL,
    idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> '' AND length(idempotency_key) <= 128),
    request_digest bytea NOT NULL CHECK (octet_length(request_digest) = 32),
    expected_program_state_version bigint NOT NULL CHECK (expected_program_state_version >= 1),
    manifest_digest bytea NOT NULL CHECK (octet_length(manifest_digest) = 32),
    mapping_digest bytea NOT NULL CHECK (octet_length(mapping_digest) = 32),
    evidence_digest bytea NOT NULL CHECK (octet_length(evidence_digest) = 32),
    status text NOT NULL CHECK (status IN ('pending','running','completed','failed')),
    result_final_delta_id text,
    due_at timestamptz NOT NULL,
    lease_owner text,
    lease_expires_at timestamptz,
    lease_generation bigint NOT NULL DEFAULT 0 CHECK (lease_generation >= 0),
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    max_attempts integer NOT NULL CHECK (max_attempts BETWEEN 1 AND 20),
    last_error_code text CHECK (last_error_code IS NULL OR (btrim(last_error_code) <> '' AND length(last_error_code) <= 64 AND last_error_code !~ '[[:cntrl:]]')),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    UNIQUE (id, program_id, project_id),
    UNIQUE (program_id, idempotency_key),
    FOREIGN KEY (program_id, project_id) REFERENCES billing_migration_programs(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (result_final_delta_id) REFERENCES billing_migration_final_deltas(id) ON DELETE RESTRICT,
    CHECK ((status = 'running') = (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)),
    CHECK ((status = 'completed') = (result_final_delta_id IS NOT NULL))
);
CREATE INDEX billing_migration_final_delta_jobs_claim_idx
    ON billing_migration_final_delta_jobs(due_at, updated_at, id)
    WHERE status = 'pending' OR status = 'running';

CREATE TABLE billing_migration_final_delta_prepared_pointers (
    final_delta_job_id text NOT NULL, lease_generation bigint NOT NULL CHECK(lease_generation>=1),
    program_id text NOT NULL, project_id text NOT NULL, environment_id text NOT NULL,
    application_id text NOT NULL, platform text NOT NULL CHECK(platform IN ('ios','android')),
    billing_customer_id text NOT NULL, prepared_snapshot_id text NOT NULL,
    prepared_digest bytea NOT NULL CHECK(octet_length(prepared_digest)=32), prepared_at timestamptz NOT NULL,
    PRIMARY KEY(final_delta_job_id,application_id,platform,billing_customer_id),
    FOREIGN KEY(final_delta_job_id,program_id,project_id) REFERENCES billing_migration_final_delta_jobs(id,program_id,project_id) ON DELETE RESTRICT,
    FOREIGN KEY(program_id,application_id,platform) REFERENCES billing_migration_program_scopes(program_id,application_id,platform) ON DELETE RESTRICT,
    FOREIGN KEY(prepared_snapshot_id,project_id,environment_id,billing_customer_id) REFERENCES customer_entitlement_snapshots(id,project_id,environment_id,billing_customer_id) ON DELETE RESTRICT
);

CREATE TABLE billing_migration_execution_attempts (
    id text PRIMARY KEY,
    program_id text NOT NULL,
    project_id text NOT NULL,
    job_kind text NOT NULL CHECK (job_kind IN ('import','dry_run','shadow','final_delta')),
    job_id text NOT NULL,
    lease_owner text NOT NULL,
    lease_generation bigint NOT NULL CHECK (lease_generation >= 1),
    attempt_phase text NOT NULL CHECK (attempt_phase IN ('started','completed','failed')),
    started_attempt_id text,
    result_digest bytea NOT NULL CHECK (octet_length(result_digest) = 32),
    error_code text CHECK (error_code IS NULL OR (btrim(error_code) <> '' AND length(error_code) <= 64 AND error_code !~ '[[:cntrl:]]')),
    recorded_at timestamptz NOT NULL,
    UNIQUE (job_kind, job_id, lease_generation, attempt_phase),
    FOREIGN KEY (program_id, project_id) REFERENCES billing_migration_programs(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (started_attempt_id) REFERENCES billing_migration_execution_attempts(id) ON DELETE RESTRICT,
    CHECK ((attempt_phase = 'started' AND started_attempt_id IS NULL AND error_code IS NULL)
        OR (attempt_phase = 'completed' AND started_attempt_id IS NOT NULL AND error_code IS NULL)
        OR (attempt_phase = 'failed' AND started_attempt_id IS NOT NULL AND error_code IS NOT NULL))
);
CREATE INDEX billing_migration_execution_attempts_job_idx
    ON billing_migration_execution_attempts(job_kind, job_id, lease_generation, recorded_at);

-- +goose StatementBegin
CREATE FUNCTION protect_billing_migration_verified_source_object() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'billing migration source objects cannot be deleted from the ledger' USING ERRCODE = '55000';
    END IF;
    IF OLD.state = 'verified' AND NOT (
        NEW.state = 'deleted' AND NEW.id = OLD.id AND NEW.program_id = OLD.program_id AND NEW.project_id = OLD.project_id
        AND NEW.reservation_key = OLD.reservation_key AND NEW.reservation_digest = OLD.reservation_digest
        AND NEW.reservation_generation = OLD.reservation_generation AND NEW.write_token_digest = OLD.write_token_digest
        AND NEW.object_key = OLD.object_key AND NEW.source_channel = OLD.source_channel
        AND NEW.adapter_version = OLD.adapter_version AND NEW.schema_version = OLD.schema_version
        AND NEW.envelope_version = OLD.envelope_version AND NEW.algorithm = OLD.algorithm AND NEW.key_id = OLD.key_id
        AND NEW.nonce = OLD.nonce AND NEW.chunk_size = OLD.chunk_size AND NEW.chunk_count = OLD.chunk_count
        AND NEW.aad_digest = OLD.aad_digest AND NEW.plaintext_digest = OLD.plaintext_digest
        AND NEW.plaintext_size_bytes = OLD.plaintext_size_bytes AND NEW.ciphertext_digest = OLD.ciphertext_digest
        AND NEW.ciphertext_size_bytes = OLD.ciphertext_size_bytes AND NEW.verified_at = OLD.verified_at
        AND NEW.reserved_at = OLD.reserved_at
        AND NEW.failed_at IS NULL AND NEW.error_code IS NOT DISTINCT FROM OLD.error_code
    ) THEN
        RAISE EXCEPTION 'verified billing migration source evidence is immutable' USING ERRCODE = '55000';
    END IF;
    IF OLD.state IN ('failed','deleted') THEN
        RAISE EXCEPTION 'terminal billing migration source object is immutable' USING ERRCODE = '55000';
    END IF;
    IF OLD.state = 'reserved' AND (
        NEW.state NOT IN ('verified','failed') OR NEW.id <> OLD.id OR NEW.program_id <> OLD.program_id
        OR NEW.project_id <> OLD.project_id OR NEW.reservation_key <> OLD.reservation_key
        OR NEW.reservation_digest <> OLD.reservation_digest OR NEW.object_key <> OLD.object_key
        OR NEW.reservation_generation <> OLD.reservation_generation OR NEW.write_token_digest <> OLD.write_token_digest
        OR NEW.source_channel <> OLD.source_channel OR NEW.adapter_version <> OLD.adapter_version
        OR NEW.schema_version <> OLD.schema_version OR NEW.reserved_at <> OLD.reserved_at
    ) THEN
        RAISE EXCEPTION 'reserved billing migration source object permits only verification or failure' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER billing_migration_source_objects_protected
    BEFORE UPDATE OR DELETE ON billing_migration_source_objects
    FOR EACH ROW EXECUTE FUNCTION protect_billing_migration_verified_source_object();
CREATE TRIGGER billing_migration_source_object_manifests_immutable
    BEFORE UPDATE OR DELETE ON billing_migration_source_object_manifests
    FOR EACH ROW EXECUTE FUNCTION reject_billing_migration_immutable_change();
CREATE TRIGGER billing_migration_execution_attempts_immutable
    BEFORE UPDATE OR DELETE ON billing_migration_execution_attempts
    FOR EACH ROW EXECUTE FUNCTION reject_billing_migration_immutable_change();
CREATE TRIGGER billing_migration_import_batch_records_immutable BEFORE UPDATE OR DELETE ON billing_migration_import_batch_records FOR EACH ROW EXECUTE FUNCTION reject_billing_migration_immutable_change();
CREATE TRIGGER billing_migration_final_delta_prepared_immutable BEFORE UPDATE OR DELETE ON billing_migration_final_delta_prepared_pointers FOR EACH ROW EXECUTE FUNCTION reject_billing_migration_immutable_change();

-- +goose Down
-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM billing_migration_source_objects WHERE state IN ('verified','deleted'))
       OR EXISTS (SELECT 1 FROM billing_migration_source_object_manifests)
       OR EXISTS (SELECT 1 FROM billing_migration_execution_attempts)
       OR EXISTS (SELECT 1 FROM billing_migration_import_batch_records)
       OR EXISTS (SELECT 1 FROM billing_migration_final_delta_prepared_pointers)
       OR EXISTS (SELECT 1 FROM billing_migration_final_delta_jobs) THEN
        RAISE EXCEPTION 'migration 00055 rollback refused: immutable source or execution evidence exists' USING ERRCODE = '55000';
    END IF;
END;
$$;
-- +goose StatementEnd
DROP TRIGGER billing_migration_execution_attempts_immutable ON billing_migration_execution_attempts;
DROP TRIGGER billing_migration_final_delta_prepared_immutable ON billing_migration_final_delta_prepared_pointers;
DROP TRIGGER billing_migration_import_batch_records_immutable ON billing_migration_import_batch_records;
DROP TRIGGER billing_migration_source_object_manifests_immutable ON billing_migration_source_object_manifests;
DROP TRIGGER billing_migration_source_objects_protected ON billing_migration_source_objects;
DROP FUNCTION protect_billing_migration_verified_source_object();
DROP TABLE billing_migration_execution_attempts;
DROP TABLE billing_migration_final_delta_prepared_pointers;
DROP TABLE billing_migration_final_delta_jobs;
DROP INDEX billing_migration_run_jobs_claim_idx;
ALTER TABLE billing_migration_run_jobs DROP COLUMN last_error_code, DROP COLUMN max_attempts, DROP COLUMN due_at;
CREATE INDEX billing_migration_run_jobs_claim_idx ON billing_migration_run_jobs(updated_at, id) WHERE status IN ('pending','running');
DROP INDEX billing_migration_import_batches_claim_idx;
ALTER TABLE billing_migration_import_batches DROP COLUMN last_error_code, DROP COLUMN max_attempts, DROP COLUMN due_at;
CREATE INDEX billing_migration_import_batches_claim_idx ON billing_migration_import_batches(updated_at, id) WHERE status IN ('pending','running');
DROP TABLE billing_migration_source_object_manifests;
DROP TABLE billing_migration_import_batch_records;
DROP TABLE billing_migration_source_objects;
