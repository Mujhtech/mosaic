-- Phase 9C Stage 2E Package D: durable RevenueCat v2 source pulls and normalized relationships.

-- +goose Up
ALTER TABLE billing_migration_source_records DROP CONSTRAINT billing_migration_source_records_source_kind_check;
ALTER TABLE billing_migration_source_records ADD CONSTRAINT billing_migration_source_records_source_kind_check
    CHECK (source_kind IN ('customer','alias','subscription','product','entitlement','transaction','transfer'));

ALTER TABLE billing_migration_import_batch_records
    ADD COLUMN reference_kind text;
-- RevenueCat v2 exposes an Apple transaction id or a Google order id here,
-- never a Google purchase token. Bearer-grade purchase tokens must remain in
-- encrypted Raw Inputs/source objects and must not enter this plaintext table.
UPDATE billing_migration_import_batch_records
SET reference_kind = CASE provider
    WHEN 'app_store' THEN 'app_store_transaction_id'
    WHEN 'google_play' THEN 'google_play_order_id'
END;
ALTER TABLE billing_migration_import_batch_records
    ALTER COLUMN reference_kind SET NOT NULL,
    ADD CONSTRAINT billing_migration_import_records_reference_kind_check
        CHECK (reference_kind IN ('app_store_transaction_id','google_play_order_id')),
    ADD CONSTRAINT billing_migration_import_records_reference_provider_check
        CHECK ((provider='app_store' AND reference_kind='app_store_transaction_id')
            OR (provider='google_play' AND reference_kind='google_play_order_id'));
ALTER TABLE billing_migration_import_batch_records
    ADD COLUMN source_product_identifier text,
    ADD COLUMN mosaic_product_id text,
    ADD COLUMN expected_store_product_identifier text,
    ADD CONSTRAINT billing_migration_import_records_product_mapping_fkey FOREIGN KEY(mosaic_product_id,project_id) REFERENCES products(id,project_id) ON DELETE RESTRICT,
    ADD CONSTRAINT billing_migration_import_records_product_binding_check CHECK ((source_product_identifier IS NULL AND mosaic_product_id IS NULL AND expected_store_product_identifier IS NULL) OR (btrim(source_product_identifier)<>'' AND mosaic_product_id IS NOT NULL AND btrim(expected_store_product_identifier)<>''));

CREATE TABLE billing_migration_source_pull_jobs (
    id text PRIMARY KEY,
    program_id text NOT NULL,
    project_id text NOT NULL,
    intent text NOT NULL CHECK (intent IN ('snapshot','delta','final_delta')),
    idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> '' AND length(idempotency_key) <= 128),
    request_digest bytea NOT NULL CHECK (octet_length(request_digest) = 32),
    expected_program_state_version bigint NOT NULL CHECK (expected_program_state_version >= 1),
    starting_cursor text NOT NULL DEFAULT '',
    starting_watermark text NOT NULL DEFAULT '',
    starting_watermark_digest bytea CHECK (starting_watermark_digest IS NULL OR octet_length(starting_watermark_digest)=32),
    predecessor_pull_job_id text,
    mapping_set_id text NOT NULL,
    status text NOT NULL CHECK (status IN ('pending','running','completed','failed')),
    result_source_object_id text,
    result_manifest_id text,
    result_import_batch_id text,
    result_final_delta_job_id text,
    resume_cursor text NOT NULL DEFAULT '',
    final_watermark text NOT NULL DEFAULT '',
    evidence_digest bytea CHECK (evidence_digest IS NULL OR octet_length(evidence_digest) = 32),
    record_count integer NOT NULL DEFAULT 0 CHECK (record_count >= 0),
    current_access_count integer NOT NULL DEFAULT 0 CHECK (current_access_count BETWEEN 0 AND record_count),
    import_record_count integer NOT NULL DEFAULT 0 CHECK (import_record_count BETWEEN 0 AND record_count),
    due_at timestamptz NOT NULL,
    lease_owner text,
    lease_expires_at timestamptz,
    lease_generation bigint NOT NULL DEFAULT 0 CHECK (lease_generation >= 0),
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    max_attempts integer NOT NULL CHECK (max_attempts BETWEEN 1 AND 20),
    last_error_code text CHECK (last_error_code IS NULL OR (btrim(last_error_code) <> '' AND length(last_error_code) <= 64 AND last_error_code !~ '[[:cntrl:]]')),
    created_by_actor_id text NOT NULL,
    started_at timestamptz,
    completed_at timestamptz,
    failed_at timestamptz,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    UNIQUE (id, program_id, project_id),
    UNIQUE (program_id, idempotency_key),
    FOREIGN KEY (program_id, project_id) REFERENCES billing_migration_programs(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (predecessor_pull_job_id, program_id, project_id) REFERENCES billing_migration_source_pull_jobs(id, program_id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (mapping_set_id, program_id, project_id) REFERENCES billing_migration_mapping_sets(id, program_id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (result_source_object_id, program_id, project_id) REFERENCES billing_migration_source_objects(id, program_id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (result_manifest_id, program_id, project_id) REFERENCES billing_migration_source_manifests(id, program_id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (result_import_batch_id, program_id, project_id) REFERENCES billing_migration_import_batches(id, program_id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (result_final_delta_job_id, program_id, project_id) REFERENCES billing_migration_final_delta_jobs(id, program_id, project_id) ON DELETE RESTRICT,
    CHECK ((status = 'running') = (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)),
    CHECK ((status = 'completed') = (result_source_object_id IS NOT NULL AND result_manifest_id IS NOT NULL AND result_import_batch_id IS NOT NULL AND evidence_digest IS NOT NULL)),
    CHECK ((intent='snapshot' AND predecessor_pull_job_id IS NULL AND starting_cursor='' AND starting_watermark='' AND starting_watermark_digest IS NULL) OR (intent IN ('delta','final_delta') AND predecessor_pull_job_id IS NOT NULL AND octet_length(starting_cursor) BETWEEN 0 AND 512 AND starting_cursor !~ '[[:cntrl:]]' AND octet_length(starting_watermark) BETWEEN 1 AND 512 AND starting_watermark !~ '[[:cntrl:]]' AND octet_length(starting_watermark_digest)=32)),
    CHECK ((status='pending' AND started_at IS NULL AND completed_at IS NULL AND failed_at IS NULL) OR (status='running' AND started_at IS NOT NULL AND completed_at IS NULL AND failed_at IS NULL) OR (status='completed' AND started_at IS NOT NULL AND completed_at IS NOT NULL AND failed_at IS NULL) OR (status='failed' AND started_at IS NOT NULL AND completed_at IS NULL AND failed_at IS NOT NULL))
);
CREATE INDEX billing_migration_source_pull_jobs_claim_idx ON billing_migration_source_pull_jobs(due_at,updated_at,id)
    WHERE status='pending' OR status='running';
CREATE UNIQUE INDEX billing_migration_source_pull_jobs_import_idx ON billing_migration_source_pull_jobs(result_import_batch_id)
    WHERE result_import_batch_id IS NOT NULL;
CREATE UNIQUE INDEX billing_migration_source_pull_jobs_predecessor_idx ON billing_migration_source_pull_jobs(predecessor_pull_job_id)
    WHERE predecessor_pull_job_id IS NOT NULL AND status <> 'failed';

CREATE TABLE billing_migration_source_record_relationships (
    source_record_id text PRIMARY KEY,
    program_id text NOT NULL,
    project_id text NOT NULL,
    customer_source_identifier text,
    product_source_identifier text,
    entitlement_source_identifiers text[] NOT NULL DEFAULT '{}',
    external_application_id text,
    store text,
    provider_environment text,
    store_identifier text,
    mosaic_product_id text,
    ownership jsonb,
    ownership_digest bytea CHECK (ownership_digest IS NULL OR octet_length(ownership_digest)=32),
    quarantine_reason text CHECK (quarantine_reason IS NULL OR quarantine_reason IN ('unsupported_store','unsupported_environment','environment_mismatch','ambiguous_application','missing_application_binding','missing_provider_reference')),
    relationship_digest bytea NOT NULL CHECK (octet_length(relationship_digest)=32),
    created_at timestamptz NOT NULL,
    FOREIGN KEY (source_record_id,program_id,project_id) REFERENCES billing_migration_source_records(id,program_id,project_id) ON DELETE RESTRICT,
    FOREIGN KEY (program_id,project_id) REFERENCES billing_migration_programs(id,project_id) ON DELETE RESTRICT,
    FOREIGN KEY (mosaic_product_id,project_id) REFERENCES products(id,project_id) ON DELETE RESTRICT
);
CREATE INDEX billing_migration_source_record_relationships_customer_idx ON billing_migration_source_record_relationships(program_id,customer_source_identifier,source_record_id);
CREATE INDEX billing_migration_source_record_relationships_product_idx ON billing_migration_source_record_relationships(program_id,product_source_identifier,source_record_id);

CREATE TRIGGER billing_migration_source_record_relationships_immutable BEFORE UPDATE OR DELETE ON billing_migration_source_record_relationships
FOR EACH ROW EXECUTE FUNCTION reject_billing_migration_immutable_change();

-- +goose Down
-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM billing_migration_source_pull_jobs)
       OR EXISTS (SELECT 1 FROM billing_migration_source_record_relationships)
       OR EXISTS (SELECT 1 FROM billing_migration_source_records WHERE source_kind IN ('product','entitlement'))
       OR EXISTS (SELECT 1 FROM billing_migration_import_batch_records) THEN
        RAISE EXCEPTION 'cannot rollback migration 00058: durable source-pull evidence exists' USING ERRCODE='55000';
    END IF;
END;
$$;
-- +goose StatementEnd
DROP TRIGGER billing_migration_source_record_relationships_immutable ON billing_migration_source_record_relationships;
DROP TABLE billing_migration_source_record_relationships;
DROP INDEX billing_migration_source_pull_jobs_import_idx;
DROP INDEX billing_migration_source_pull_jobs_predecessor_idx;
DROP INDEX billing_migration_source_pull_jobs_claim_idx;
DROP TABLE billing_migration_source_pull_jobs;
ALTER TABLE billing_migration_import_batch_records
    DROP CONSTRAINT billing_migration_import_records_product_mapping_fkey,
    DROP CONSTRAINT billing_migration_import_records_product_binding_check,
    DROP CONSTRAINT billing_migration_import_records_reference_provider_check,
    DROP CONSTRAINT billing_migration_import_records_reference_kind_check,
    DROP COLUMN reference_kind,
    DROP COLUMN source_product_identifier,
    DROP COLUMN mosaic_product_id,
    DROP COLUMN expected_store_product_identifier;
ALTER TABLE billing_migration_source_records DROP CONSTRAINT billing_migration_source_records_source_kind_check;
ALTER TABLE billing_migration_source_records ADD CONSTRAINT billing_migration_source_records_source_kind_check
    CHECK (source_kind IN ('customer','alias','subscription','transaction','transfer'));
