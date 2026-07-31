-- Phase 9C Package E: bind known provider-reference validation to the exact
-- Application and frozen Product mapping selected by the migration program.

-- +goose Up
ALTER TABLE billing_raw_inputs DROP CONSTRAINT billing_raw_inputs_source_check;
ALTER TABLE billing_raw_inputs ADD CONSTRAINT billing_raw_inputs_source_check CHECK (source IN (
    'apple_notification', 'apple_notification_history', 'apple_transaction_history',
    'google_rtdn', 'google_token_requery', 'client_observation',
    'trusted_server_observation', 'migration_known_reference'
));
ALTER TABLE billing_migration_import_batch_records
    ADD COLUMN expected_store_environment text NOT NULL
        CHECK (expected_store_environment IN ('production','sandbox'));

CREATE TABLE billing_migration_validation_bindings (
    id text PRIMARY KEY,
    program_id text NOT NULL,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    raw_input_id text NOT NULL,
    provider text NOT NULL CHECK (provider IN ('app_store','google_play')),
    reference_kind text NOT NULL CHECK (reference_kind IN (
        'app_store_transaction_id','google_play_purchase_token','google_play_order_id'
    )),
    reference_digest bytea NOT NULL CHECK (octet_length(reference_digest)=32),
    expected_application_id text NOT NULL,
    expected_store_product_identifier text NOT NULL CHECK (btrim(expected_store_product_identifier)<>''),
    expected_store_environment text NOT NULL CHECK (expected_store_environment IN ('production','sandbox')),
    expected_mosaic_product_id text NOT NULL,
    status text NOT NULL CHECK (status IN ('accepted','validated','quarantined')),
    diagnostic_code text CHECK (diagnostic_code IS NULL OR (
        btrim(diagnostic_code)<>'' AND length(diagnostic_code)<=128 AND diagnostic_code !~ '[[:cntrl:]]'
    )),
    validation_attempt_id text,
    evidence_digest bytea CHECK (evidence_digest IS NULL OR octet_length(evidence_digest)=32),
    provider_watermark timestamptz,
    accepted_at timestamptz NOT NULL,
    completed_at timestamptz,
    UNIQUE (program_id, provider, reference_kind, reference_digest),
    UNIQUE (raw_input_id),
    UNIQUE (id, project_id),
    FOREIGN KEY (program_id, project_id) REFERENCES billing_migration_programs(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (raw_input_id, project_id) REFERENCES billing_raw_inputs(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (environment_id, project_id) REFERENCES environments(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (expected_application_id, project_id) REFERENCES applications(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (expected_mosaic_product_id, project_id) REFERENCES products(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (validation_attempt_id, project_id) REFERENCES billing_validation_attempts(id, project_id) ON DELETE RESTRICT,
    CHECK ((status='accepted' AND diagnostic_code IS NULL AND validation_attempt_id IS NULL AND evidence_digest IS NULL AND provider_watermark IS NULL AND completed_at IS NULL)
        OR (status IN ('validated','quarantined') AND validation_attempt_id IS NOT NULL AND evidence_digest IS NOT NULL AND provider_watermark IS NOT NULL AND completed_at IS NOT NULL))
);
CREATE INDEX billing_migration_validation_bindings_outcome_idx
    ON billing_migration_validation_bindings(program_id,status,id);

-- Only the validation-attempt transaction may complete a binding. Identity,
-- scope, and frozen expectations remain immutable for the lifetime of the row.
-- +goose StatementBegin
CREATE FUNCTION protect_billing_migration_validation_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status <> 'accepted' OR NEW.status NOT IN ('validated','quarantined') OR
       NEW.id IS DISTINCT FROM OLD.id OR NEW.program_id IS DISTINCT FROM OLD.program_id OR
       NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.environment_id IS DISTINCT FROM OLD.environment_id OR
       NEW.raw_input_id IS DISTINCT FROM OLD.raw_input_id OR NEW.provider IS DISTINCT FROM OLD.provider OR
       NEW.reference_kind IS DISTINCT FROM OLD.reference_kind OR NEW.reference_digest IS DISTINCT FROM OLD.reference_digest OR
       NEW.expected_application_id IS DISTINCT FROM OLD.expected_application_id OR
       NEW.expected_store_product_identifier IS DISTINCT FROM OLD.expected_store_product_identifier OR
       NEW.expected_store_environment IS DISTINCT FROM OLD.expected_store_environment OR
       NEW.expected_mosaic_product_id IS DISTINCT FROM OLD.expected_mosaic_product_id OR
       NEW.accepted_at IS DISTINCT FROM OLD.accepted_at THEN
        RAISE EXCEPTION 'migration validation binding is immutable outside terminal completion' USING ERRCODE='55000';
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER billing_migration_validation_bindings_protected
BEFORE UPDATE OR DELETE ON billing_migration_validation_bindings
FOR EACH ROW EXECUTE FUNCTION protect_billing_migration_validation_binding();

-- +goose Down
-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS(SELECT 1 FROM billing_migration_validation_bindings)
       OR EXISTS(SELECT 1 FROM billing_migration_import_batch_records) THEN
        RAISE EXCEPTION 'migration 00059 rollback refused: immutable migration validation evidence exists' USING ERRCODE='55000';
    END IF;
END;
$$;
-- +goose StatementEnd
DROP TRIGGER billing_migration_validation_bindings_protected ON billing_migration_validation_bindings;
DROP FUNCTION protect_billing_migration_validation_binding;
DROP TABLE billing_migration_validation_bindings;
ALTER TABLE billing_migration_import_batch_records DROP COLUMN expected_store_environment;
ALTER TABLE billing_raw_inputs DROP CONSTRAINT billing_raw_inputs_source_check;
ALTER TABLE billing_raw_inputs ADD CONSTRAINT billing_raw_inputs_source_check CHECK (source IN (
    'apple_notification', 'apple_notification_history', 'apple_transaction_history',
    'google_rtdn', 'google_token_requery', 'client_observation', 'trusted_server_observation'
));
