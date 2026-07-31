-- Phase 9C Stage 2E execution prerequisites only. No authority transition is executed here.

-- +goose Up
ALTER TABLE billing_migration_readiness_policy_scopes
    ADD COLUMN minimum_sdk_version text NOT NULL DEFAULT '0.0.0' CHECK(btrim(minimum_sdk_version)<>'' AND length(minimum_sdk_version)<=64),
    ADD COLUMN required_capabilities text[] NOT NULL DEFAULT ARRAY['authority_epoch','authority_scope','urgent_authority_sync','mosaic_authoritative_targeting']::text[]
        CHECK(cardinality(required_capabilities) BETWEEN 1 AND 4 AND billing_migration_text_array_unique(required_capabilities)
              AND required_capabilities <@ ARRAY['authority_epoch','authority_scope','urgent_authority_sync','mosaic_authoritative_targeting']::text[]),
    ADD COLUMN serving_requirements_digest bytea NOT NULL DEFAULT decode(repeat('00',32),'hex') CHECK(octet_length(serving_requirements_digest)=32);
ALTER TABLE billing_migration_readiness_policy_scopes DISABLE TRIGGER billing_migration_readiness_policy_scopes_immutable;
UPDATE billing_migration_readiness_policy_scopes
SET serving_requirements_digest=sha256(convert_to(concat_ws(chr(31),program_id,application_id,platform,minimum_sdk_version,
    (SELECT string_agg(capability,chr(30) ORDER BY capability) FROM unnest(required_capabilities) capability)),'UTF8'));
ALTER TABLE billing_migration_readiness_policy_scopes ENABLE TRIGGER billing_migration_readiness_policy_scopes_immutable;
ALTER TABLE billing_migration_readiness_policy_scopes
    ALTER COLUMN minimum_sdk_version DROP DEFAULT,
    ALTER COLUMN required_capabilities DROP DEFAULT,
    ALTER COLUMN serving_requirements_digest DROP DEFAULT,
    ADD CONSTRAINT billing_migration_serving_requirements_nonzero CHECK(serving_requirements_digest<>decode(repeat('00',32),'hex'));

CREATE TABLE billing_migration_final_delta_cohort_sets (
    id text PRIMARY KEY, final_delta_id text NOT NULL, program_id text NOT NULL, project_id text NOT NULL,
    customer_count integer NOT NULL CHECK(customer_count BETWEEN 1 AND 1000000),
    cohort_digest bytea NOT NULL CHECK(octet_length(cohort_digest)=32), frozen_at timestamptz NOT NULL,
    UNIQUE(final_delta_id), UNIQUE(program_id,cohort_digest), UNIQUE(id,program_id,project_id),
    FOREIGN KEY(final_delta_id) REFERENCES billing_migration_final_deltas(id) ON DELETE RESTRICT,
    FOREIGN KEY(program_id,project_id) REFERENCES billing_migration_programs(id,project_id) ON DELETE RESTRICT
);
CREATE TABLE billing_migration_final_delta_cohort_customers (
    cohort_set_id text NOT NULL, program_id text NOT NULL, project_id text NOT NULL, billing_customer_id text NOT NULL,
    customer_digest bytea NOT NULL CHECK(octet_length(customer_digest)=32),
    PRIMARY KEY(cohort_set_id,billing_customer_id),
    FOREIGN KEY(cohort_set_id,program_id,project_id) REFERENCES billing_migration_final_delta_cohort_sets(id,program_id,project_id) ON DELETE RESTRICT,
    FOREIGN KEY(billing_customer_id,project_id) REFERENCES billing_customers(id,project_id) ON DELETE RESTRICT
);
ALTER TABLE billing_migration_checkpoints
    ADD COLUMN cohort_digest bytea NOT NULL DEFAULT decode(repeat('00',32),'hex') CHECK(octet_length(cohort_digest)=32);
-- Pre-00054 checkpoints cannot recover a deleted cohort membership set. Bind a
-- deterministic non-placeholder legacy marker to the immutable checkpoint; all
-- newly created checkpoints use the exact final-delta cohort digest.
ALTER TABLE billing_migration_checkpoints DISABLE TRIGGER billing_migration_checkpoints_immutable;
UPDATE billing_migration_checkpoints SET cohort_digest=sha256(checkpoint_digest);
ALTER TABLE billing_migration_checkpoints ENABLE TRIGGER billing_migration_checkpoints_immutable;
ALTER TABLE billing_migration_checkpoints
    ALTER COLUMN cohort_digest DROP DEFAULT,
    ADD CONSTRAINT billing_migration_checkpoint_cohort_nonzero CHECK(cohort_digest<>decode(repeat('00',32),'hex'));

CREATE TABLE billing_migration_rollback_proposal_bindings (
    proposal_id text PRIMARY KEY, program_id text NOT NULL, project_id text NOT NULL,
    checkpoint_id text NOT NULL, checkpoint_digest bytea NOT NULL CHECK(octet_length(checkpoint_digest)=32),
    authority_digest bytea NOT NULL CHECK(octet_length(authority_digest)=32),
    rollback_prerequisites_digest bytea NOT NULL CHECK(octet_length(rollback_prerequisites_digest)=32),
    scope_digest bytea NOT NULL CHECK(octet_length(scope_digest)=32),
    cutover_transition_id text NOT NULL, cutover_transition_digest bytea NOT NULL CHECK(octet_length(cutover_transition_digest)=32),
    cutover_epoch bigint NOT NULL CHECK(cutover_epoch>=1), cutover_transitioned_at timestamptz NOT NULL, rollback_deadline timestamptz NOT NULL,
    credential_id text NOT NULL, credential_status text NOT NULL CHECK(credential_status='active'),
    credential_removed boolean NOT NULL CHECK(NOT credential_removed), credential_removed_at timestamptz CHECK(credential_removed_at IS NULL),
    capability_assessment_id text NOT NULL, capability_assessment_digest bytea NOT NULL CHECK(octet_length(capability_assessment_digest)=32), capability_assessed_at timestamptz NOT NULL,
    source_validation_id text NOT NULL, source_validation_digest bytea NOT NULL CHECK(octet_length(source_validation_digest)=32), source_validated_at timestamptz NOT NULL,
    provider_validation_id text NOT NULL, provider_validation_digest bytea NOT NULL CHECK(octet_length(provider_validation_digest)=32), provider_validated_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL,
    FOREIGN KEY(proposal_id,program_id,project_id) REFERENCES billing_migration_cutover_proposals(id,program_id,project_id) ON DELETE RESTRICT,
    FOREIGN KEY(checkpoint_id,program_id,project_id) REFERENCES billing_migration_checkpoints(id,program_id,project_id) ON DELETE RESTRICT,
    FOREIGN KEY(cutover_transition_id) REFERENCES billing_migration_authority_transitions(id) ON DELETE RESTRICT,
    FOREIGN KEY(credential_id,project_id) REFERENCES billing_migration_credentials(id,project_id) ON DELETE RESTRICT,
    FOREIGN KEY(capability_assessment_id) REFERENCES billing_migration_capability_assessments(id) ON DELETE RESTRICT,
    FOREIGN KEY(source_validation_id,program_id,project_id) REFERENCES billing_migration_validation_attempts(id,program_id,project_id) ON DELETE RESTRICT,
    FOREIGN KEY(provider_validation_id,program_id,project_id) REFERENCES billing_migration_validation_attempts(id,program_id,project_id) ON DELETE RESTRICT,
    CHECK(rollback_deadline>cutover_transitioned_at)
);

CREATE TRIGGER billing_migration_cohort_sets_immutable BEFORE UPDATE OR DELETE ON billing_migration_final_delta_cohort_sets FOR EACH ROW EXECUTE FUNCTION reject_billing_migration_immutable_change();
CREATE TRIGGER billing_migration_cohort_customers_immutable BEFORE UPDATE OR DELETE ON billing_migration_final_delta_cohort_customers FOR EACH ROW EXECUTE FUNCTION reject_billing_migration_immutable_change();
CREATE TRIGGER billing_migration_rollback_bindings_immutable BEFORE UPDATE OR DELETE ON billing_migration_rollback_proposal_bindings FOR EACH ROW EXECUTE FUNCTION reject_billing_migration_immutable_change();

-- +goose Down
-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS(SELECT 1 FROM billing_migration_final_delta_cohort_sets)
       OR EXISTS(SELECT 1 FROM billing_migration_final_delta_cohort_customers)
       OR EXISTS(SELECT 1 FROM billing_migration_rollback_proposal_bindings) THEN
        RAISE EXCEPTION 'migration 00054 rollback refused: immutable cohort or rollback proposal evidence exists' USING ERRCODE='55000';
    END IF;
END;
$$;
-- +goose StatementEnd
DROP TRIGGER billing_migration_rollback_bindings_immutable ON billing_migration_rollback_proposal_bindings;
DROP TRIGGER billing_migration_cohort_customers_immutable ON billing_migration_final_delta_cohort_customers;
DROP TRIGGER billing_migration_cohort_sets_immutable ON billing_migration_final_delta_cohort_sets;
DROP TABLE billing_migration_rollback_proposal_bindings;
ALTER TABLE billing_migration_checkpoints DROP CONSTRAINT billing_migration_checkpoint_cohort_nonzero, DROP COLUMN cohort_digest;
DROP TABLE billing_migration_final_delta_cohort_customers;
DROP TABLE billing_migration_final_delta_cohort_sets;
ALTER TABLE billing_migration_readiness_policy_scopes
    DROP CONSTRAINT billing_migration_serving_requirements_nonzero,
    DROP COLUMN serving_requirements_digest,
    DROP COLUMN required_capabilities,
    DROP COLUMN minimum_sdk_version;
