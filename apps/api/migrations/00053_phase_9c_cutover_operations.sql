-- Phase 9C Stage 2E packages A/B: reserved cutover, authority, repair, and retention persistence.
-- This migration creates control-plane records only. No authority transition is executed here.

-- +goose Up
-- +goose StatementBegin
CREATE FUNCTION billing_migration_text_array_unique(values_to_check text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT cardinality(values_to_check)=count(DISTINCT value) FROM unnest(values_to_check) value
$$;
-- +goose StatementEnd

ALTER TABLE billing_migration_credentials
    ALTER COLUMN nonce DROP NOT NULL,
    ALTER COLUMN ciphertext DROP NOT NULL,
    ADD COLUMN removed_at timestamptz,
    ADD COLUMN removed_by_actor_id text,
    ADD COLUMN removal_digest bytea CHECK (removal_digest IS NULL OR octet_length(removal_digest)=32),
    ADD CONSTRAINT billing_migration_credentials_secure_removal CHECK (
        (removed_at IS NULL AND removed_by_actor_id IS NULL AND removal_digest IS NULL AND nonce IS NOT NULL AND ciphertext IS NOT NULL)
        OR (removed_at IS NOT NULL AND removed_by_actor_id IS NOT NULL AND removal_digest IS NOT NULL AND nonce IS NULL AND ciphertext IS NULL)
    );
ALTER TABLE billing_migration_import_batches
    ADD CONSTRAINT billing_migration_import_batches_scope_unique UNIQUE(id,program_id,project_id);
ALTER TABLE billing_migration_source_records
    ADD CONSTRAINT billing_migration_source_records_scope_unique UNIQUE(id,program_id,project_id);
ALTER TABLE customer_entitlement_snapshots
    ADD CONSTRAINT customer_entitlement_snapshots_scope_unique UNIQUE(id,project_id,environment_id,billing_customer_id);
ALTER TABLE billing_migration_readiness_assessments
    DROP CONSTRAINT billing_migration_readiness_assessments_check,
    ADD COLUMN authoritative boolean NOT NULL DEFAULT false,
    ADD COLUMN source_capabilities_fresh boolean NOT NULL DEFAULT false,
    ADD COLUMN warning_threshold bigint NOT NULL DEFAULT 0 CHECK(warning_threshold>=0),
    ADD COLUMN application_version_digest bytea CHECK(application_version_digest IS NULL OR octet_length(application_version_digest)=32),
    ADD CONSTRAINT billing_migration_readiness_authoritative_check CHECK (ready = (
        current_access_mapping_percent=100 AND current_access_evidence_percent=100 AND
        critical_count=0 AND blocking_count=0 AND final_delta_completed AND watermarks_fresh AND
        supported_versions_authority_aware AND
        (NOT authoritative OR (source_capabilities_fresh AND warning_count<=warning_threshold AND application_version_digest IS NOT NULL))
    ));

CREATE TABLE billing_migration_validation_attempts (
    id text PRIMARY KEY, program_id text NOT NULL, project_id text NOT NULL, import_batch_id text,
    attempt_kind text NOT NULL CHECK (attempt_kind IN ('source_validation','provider_validation','final_delta')),
    status text NOT NULL CHECK (status IN ('succeeded','failed','quarantined')),
    record_count integer NOT NULL CHECK (record_count >= 0), result_digest bytea NOT NULL CHECK (octet_length(result_digest)=32),
    attempted_at timestamptz NOT NULL,
    UNIQUE(id,program_id,project_id),
    FOREIGN KEY(program_id,project_id) REFERENCES billing_migration_programs(id,project_id) ON DELETE RESTRICT,
    FOREIGN KEY(import_batch_id,program_id,project_id) REFERENCES billing_migration_import_batches(id,program_id,project_id) ON DELETE RESTRICT
);
CREATE TABLE billing_migration_import_attempts (
    id text PRIMARY KEY, program_id text NOT NULL, project_id text NOT NULL, import_batch_id text NOT NULL,
    lease_generation bigint NOT NULL CHECK(lease_generation>=0), status text NOT NULL CHECK(status IN ('started','completed','failed')),
    cursor_before text NOT NULL DEFAULT '', cursor_after text NOT NULL DEFAULT '', attempt_digest bytea NOT NULL CHECK(octet_length(attempt_digest)=32),
    attempted_at timestamptz NOT NULL, completed_at timestamptz,
    FOREIGN KEY(program_id,project_id) REFERENCES billing_migration_programs(id,project_id) ON DELETE RESTRICT,
    FOREIGN KEY(import_batch_id,program_id,project_id) REFERENCES billing_migration_import_batches(id,program_id,project_id) ON DELETE RESTRICT
);

CREATE TABLE billing_migration_shadow_snapshots (
    id text PRIMARY KEY, program_id text NOT NULL, project_id text NOT NULL, environment_id text NOT NULL,
    application_id text NOT NULL, platform text NOT NULL CHECK(platform IN ('ios','android')),
    billing_customer_id text NOT NULL, source_snapshot_id text, mosaic_snapshot_id text NOT NULL,
    shadow_digest bytea NOT NULL CHECK(octet_length(shadow_digest)=32), created_at timestamptz NOT NULL,
    UNIQUE(program_id,application_id,platform,billing_customer_id,shadow_digest),
    FOREIGN KEY(program_id,project_id,environment_id) REFERENCES billing_migration_programs(id,project_id,environment_id) ON DELETE RESTRICT,
    FOREIGN KEY(program_id,application_id,platform) REFERENCES billing_migration_program_scopes(program_id,application_id,platform) ON DELETE RESTRICT,
    FOREIGN KEY(billing_customer_id,project_id) REFERENCES billing_customers(id,project_id) ON DELETE RESTRICT,
    FOREIGN KEY(mosaic_snapshot_id,project_id,environment_id,billing_customer_id)
        REFERENCES customer_entitlement_snapshots(id,project_id,environment_id,billing_customer_id) ON DELETE RESTRICT
);

CREATE TABLE billing_migration_scope_current_pointers (
    project_id text NOT NULL, environment_id text NOT NULL, application_id text NOT NULL,
    platform text NOT NULL CHECK(platform IN ('ios','android')), billing_customer_id text NOT NULL,
    current_snapshot_id text NOT NULL, authority_epoch bigint NOT NULL CHECK(authority_epoch>=0), updated_at timestamptz NOT NULL,
    PRIMARY KEY(project_id,environment_id,application_id,platform,billing_customer_id),
    FOREIGN KEY(environment_id,project_id) REFERENCES environments(id,project_id) ON DELETE RESTRICT,
    FOREIGN KEY(application_id,project_id,platform) REFERENCES applications(id,project_id,platform) ON DELETE RESTRICT,
    FOREIGN KEY(billing_customer_id,project_id) REFERENCES billing_customers(id,project_id) ON DELETE RESTRICT,
    FOREIGN KEY(current_snapshot_id,project_id,environment_id,billing_customer_id)
        REFERENCES customer_entitlement_snapshots(id,project_id,environment_id,billing_customer_id) ON DELETE RESTRICT
);
CREATE TABLE billing_migration_scope_prepared_pointers (
    program_id text NOT NULL, project_id text NOT NULL, environment_id text NOT NULL, application_id text NOT NULL,
    platform text NOT NULL CHECK(platform IN ('ios','android')), billing_customer_id text NOT NULL,
    prepared_snapshot_id text NOT NULL, prepared_digest bytea NOT NULL CHECK(octet_length(prepared_digest)=32), prepared_at timestamptz NOT NULL,
    PRIMARY KEY(program_id,application_id,platform,billing_customer_id),
    FOREIGN KEY(program_id,project_id,environment_id) REFERENCES billing_migration_programs(id,project_id,environment_id) ON DELETE RESTRICT,
    FOREIGN KEY(program_id,application_id,platform) REFERENCES billing_migration_program_scopes(program_id,application_id,platform) ON DELETE RESTRICT,
    FOREIGN KEY(billing_customer_id,project_id) REFERENCES billing_customers(id,project_id) ON DELETE RESTRICT,
    FOREIGN KEY(prepared_snapshot_id,project_id,environment_id,billing_customer_id)
        REFERENCES customer_entitlement_snapshots(id,project_id,environment_id,billing_customer_id) ON DELETE RESTRICT
);

CREATE TABLE billing_migration_authority_scopes (
    id text PRIMARY KEY, project_id text NOT NULL, environment_id text NOT NULL, application_id text NOT NULL,
    platform text NOT NULL CHECK(platform IN ('ios','android')), current_authority text NOT NULL CHECK(current_authority IN ('source','mosaic','source_rollback')),
    current_epoch bigint NOT NULL CHECK(current_epoch>=0), active_program_id text,
    authority_digest bytea NOT NULL CHECK(octet_length(authority_digest)=32), updated_at timestamptz NOT NULL,
    UNIQUE(project_id,environment_id,application_id,platform), UNIQUE(id,project_id),
    FOREIGN KEY(environment_id,project_id) REFERENCES environments(id,project_id) ON DELETE RESTRICT,
    FOREIGN KEY(application_id,project_id,platform) REFERENCES applications(id,project_id,platform) ON DELETE RESTRICT,
    FOREIGN KEY(active_program_id,project_id) REFERENCES billing_migration_programs(id,project_id) ON DELETE RESTRICT
);
INSERT INTO billing_migration_authority_scopes(id,project_id,environment_id,application_id,platform,current_authority,current_epoch,active_program_id,authority_digest,updated_at)
SELECT 'mas_'||substr(md5(s.project_id||':'||s.environment_id||':'||s.application_id||':'||s.platform),1,16),
       s.project_id,s.environment_id,s.application_id,s.platform,'source',s.authority_epoch_before,s.program_id,
       decode(md5(s.project_id||':'||s.environment_id||':'||s.application_id||':'||s.platform||':source:'||s.authority_epoch_before::text)||md5(s.program_id),'hex'),s.created_at
FROM (
    SELECT DISTINCT ON (p.project_id,p.environment_id,ps.application_id,ps.platform)
        p.id AS program_id,p.project_id,p.environment_id,p.authority_epoch_before,p.created_at,ps.application_id,ps.platform
    FROM billing_migration_programs p JOIN billing_migration_program_scopes ps ON ps.program_id=p.id
    ORDER BY p.project_id,p.environment_id,ps.application_id,ps.platform,p.created_at,p.id
) s;
CREATE TABLE billing_migration_authority_transitions (
    id text PRIMARY KEY, program_id text NOT NULL, project_id text NOT NULL, authority_scope_id text NOT NULL,
    from_authority text NOT NULL CHECK(from_authority IN ('source','mosaic','source_rollback')), to_authority text NOT NULL CHECK(to_authority IN ('source','mosaic','source_rollback')),
    from_epoch bigint NOT NULL CHECK(from_epoch>=0), to_epoch bigint NOT NULL CHECK(to_epoch=from_epoch+1),
    transition_kind text NOT NULL CHECK(transition_kind IN ('cutover','rollback')),
    transition_digest bytea NOT NULL CHECK(octet_length(transition_digest)=32), transitioned_at timestamptz NOT NULL,
    UNIQUE(authority_scope_id,to_epoch),
    FOREIGN KEY(program_id,project_id) REFERENCES billing_migration_programs(id,project_id) ON DELETE RESTRICT,
    FOREIGN KEY(authority_scope_id,project_id) REFERENCES billing_migration_authority_scopes(id,project_id) ON DELETE RESTRICT,
    CHECK ((transition_kind='cutover' AND from_authority='source' AND to_authority='mosaic') OR
           (transition_kind='rollback' AND from_authority='mosaic' AND to_authority='source_rollback'))
);

CREATE TABLE billing_migration_readiness_policies (
    id text PRIMARY KEY, program_id text NOT NULL, project_id text NOT NULL, state_version bigint NOT NULL CHECK(state_version>=1),
    warning_threshold bigint NOT NULL DEFAULT 0 CHECK(warning_threshold>=0), watermark_max_age_seconds integer NOT NULL CHECK(watermark_max_age_seconds BETWEEN 1 AND 86400),
    supported_version_window_start timestamptz NOT NULL, application_version_digest bytea NOT NULL CHECK(octet_length(application_version_digest)=32),
    policy_digest bytea NOT NULL CHECK(octet_length(policy_digest)=32),
    frozen_at timestamptz NOT NULL, UNIQUE(program_id,policy_digest),
    FOREIGN KEY(program_id,project_id) REFERENCES billing_migration_programs(id,project_id) ON DELETE RESTRICT
);
CREATE TABLE billing_migration_readiness_policy_scopes (
    id text PRIMARY KEY, policy_id text NOT NULL, program_id text NOT NULL, project_id text NOT NULL,
    application_id text NOT NULL, platform text NOT NULL CHECK(platform IN ('ios','android')),
    minimum_app_version text NOT NULL CHECK(btrim(minimum_app_version)<>'' AND length(minimum_app_version)<=64),
    maximum_app_version text NOT NULL CHECK(btrim(maximum_app_version)<>'' AND length(maximum_app_version)<=64),
    traffic_window_started_at timestamptz NOT NULL, traffic_window_ended_at timestamptz NOT NULL,
    outside_window_accepted boolean NOT NULL DEFAULT false, outside_window_reason text,
    UNIQUE(policy_id,application_id,platform),
    FOREIGN KEY(policy_id) REFERENCES billing_migration_readiness_policies(id) ON DELETE RESTRICT,
    FOREIGN KEY(program_id,project_id) REFERENCES billing_migration_programs(id,project_id) ON DELETE RESTRICT,
    FOREIGN KEY(program_id,application_id,platform) REFERENCES billing_migration_program_scopes(program_id,application_id,platform) ON DELETE RESTRICT,
    CHECK(traffic_window_ended_at>traffic_window_started_at),
    CHECK(outside_window_accepted=(outside_window_reason IS NOT NULL))
);
CREATE TABLE billing_migration_supported_app_versions (
    id text PRIMARY KEY, program_id text NOT NULL, project_id text NOT NULL, application_id text NOT NULL,
    platform text NOT NULL CHECK(platform IN ('ios','android')), application_version text NOT NULL CHECK(btrim(application_version)<>''),
    supported boolean NOT NULL, authority_aware boolean NOT NULL, observation_digest bytea NOT NULL CHECK(octet_length(observation_digest)=32),
    observed_at timestamptz NOT NULL, UNIQUE(program_id,application_id,platform,application_version),
    FOREIGN KEY(program_id,project_id) REFERENCES billing_migration_programs(id,project_id) ON DELETE RESTRICT,
    FOREIGN KEY(program_id,application_id,platform) REFERENCES billing_migration_program_scopes(program_id,application_id,platform) ON DELETE RESTRICT
);
CREATE TABLE billing_migration_v2_sync_observations (
    id text PRIMARY KEY, program_id text NOT NULL, project_id text NOT NULL, application_id text NOT NULL,
    platform text NOT NULL CHECK(platform IN ('ios','android')),
    app_version text NOT NULL CHECK(btrim(app_version)<>'' AND length(app_version)<=64 AND app_version !~ '[[:cntrl:]]'),
    sdk_version text NOT NULL CHECK(btrim(sdk_version)<>'' AND length(sdk_version)<=64 AND sdk_version !~ '[[:cntrl:]]'),
    supported_contract_versions text[] NOT NULL CHECK(cardinality(supported_contract_versions) BETWEEN 1 AND 8 AND '2'=ANY(supported_contract_versions)),
    authority_capabilities text[] NOT NULL CHECK(cardinality(authority_capabilities) BETWEEN 1 AND 4 AND authority_capabilities <@ ARRAY['authority_epoch','authority_scope','urgent_authority_sync','mosaic_authoritative_targeting']::text[]),
    CHECK(billing_migration_text_array_unique(supported_contract_versions)),
    CHECK(billing_migration_text_array_unique(authority_capabilities)),
    traffic_count bigint NOT NULL CHECK(traffic_count>=1), authority_epoch bigint NOT NULL CHECK(authority_epoch>=0),
    sync_result text NOT NULL CHECK(sync_result IN ('accepted','rejected','unknown_authority')),
    observation_digest bytea NOT NULL CHECK(octet_length(observation_digest)=32), observed_at timestamptz NOT NULL,
    FOREIGN KEY(program_id,project_id) REFERENCES billing_migration_programs(id,project_id) ON DELETE RESTRICT,
    FOREIGN KEY(program_id,application_id,platform) REFERENCES billing_migration_program_scopes(program_id,application_id,platform) ON DELETE RESTRICT
);
CREATE INDEX billing_migration_v2_sync_scope_version_idx ON billing_migration_v2_sync_observations(program_id,application_id,platform,app_version,observed_at DESC);
CREATE TABLE billing_migration_final_deltas (
    id text PRIMARY KEY, program_id text NOT NULL, project_id text NOT NULL, state_version bigint NOT NULL CHECK(state_version>=1),
    manifest_digest bytea NOT NULL CHECK(octet_length(manifest_digest)=32), mapping_digest bytea NOT NULL CHECK(octet_length(mapping_digest)=32),
    evidence_digest bytea NOT NULL CHECK(octet_length(evidence_digest)=32), final_watermark_digest bytea NOT NULL CHECK(octet_length(final_watermark_digest)=32),
    source_watermark timestamptz NOT NULL, provider_watermark timestamptz NOT NULL, shadow_watermark timestamptz NOT NULL,
    delta_digest bytea NOT NULL CHECK(octet_length(delta_digest)=32), completed_at timestamptz NOT NULL,
    UNIQUE(program_id,delta_digest), FOREIGN KEY(program_id,project_id) REFERENCES billing_migration_programs(id,project_id) ON DELETE RESTRICT
);

CREATE TABLE billing_migration_command_idempotency (
    id text PRIMARY KEY, program_id text NOT NULL, project_id text NOT NULL, command_kind text NOT NULL,
    idempotency_key text NOT NULL, request_digest bytea NOT NULL CHECK(octet_length(request_digest)=32),
    resource_id text NOT NULL, created_at timestamptz NOT NULL, UNIQUE(program_id,command_kind,idempotency_key),
    FOREIGN KEY(program_id,project_id) REFERENCES billing_migration_programs(id,project_id) ON DELETE RESTRICT
);
CREATE TABLE billing_migration_cutover_proposals (
    id text PRIMARY KEY, program_id text NOT NULL, project_id text NOT NULL, state_version bigint NOT NULL CHECK(state_version>=1),
    command text NOT NULL CHECK(command IN ('cutover','rollback')), proposer_actor_id text NOT NULL,
    reason text NOT NULL CHECK(btrim(reason)<>'' AND length(reason)<=500 AND reason !~ '[[:cntrl:]]'),
    scope_digest bytea NOT NULL CHECK(octet_length(scope_digest)=32), manifest_digest bytea NOT NULL CHECK(octet_length(manifest_digest)=32),
    mapping_digest bytea NOT NULL CHECK(octet_length(mapping_digest)=32), policy_digest bytea NOT NULL CHECK(octet_length(policy_digest)=32),
    evidence_digest bytea NOT NULL CHECK(octet_length(evidence_digest)=32), readiness_digest bytea NOT NULL CHECK(octet_length(readiness_digest)=32),
    final_watermark_digest bytea NOT NULL CHECK(octet_length(final_watermark_digest)=32), application_version_digest bytea NOT NULL CHECK(octet_length(application_version_digest)=32),
    proposal_digest bytea NOT NULL CHECK(octet_length(proposal_digest)=32), status text NOT NULL CHECK(status IN ('pending','approved','expired','invalidated')),
    proposed_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, invalidated_at timestamptz,
    UNIQUE(program_id,proposal_digest), UNIQUE(id,program_id,project_id),
    FOREIGN KEY(program_id,project_id) REFERENCES billing_migration_programs(id,project_id) ON DELETE RESTRICT,
    CHECK(expires_at>proposed_at), CHECK((status='invalidated')=(invalidated_at IS NOT NULL))
);
CREATE TABLE billing_migration_approvals (
    id text PRIMARY KEY, program_id text NOT NULL, project_id text NOT NULL, proposal_id text NOT NULL,
    state_version bigint NOT NULL CHECK(state_version>=1), command text NOT NULL CHECK(command IN ('cutover','rollback')),
    proposer_actor_id text NOT NULL, approver_actor_id text NOT NULL,
    approval_digest bytea NOT NULL CHECK(octet_length(approval_digest)=32), approved_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
    UNIQUE(program_id,approval_digest), UNIQUE(proposal_id), UNIQUE(id,program_id,project_id),
    FOREIGN KEY(program_id,project_id) REFERENCES billing_migration_programs(id,project_id) ON DELETE RESTRICT,
    FOREIGN KEY(proposal_id,program_id,project_id) REFERENCES billing_migration_cutover_proposals(id,program_id,project_id) ON DELETE RESTRICT
);

-- +goose StatementBegin
CREATE FUNCTION enforce_billing_migration_two_person() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE environment_mode text;
BEGIN
    SELECT e.mode INTO environment_mode
    FROM billing_migration_programs p JOIN environments e ON e.id=p.environment_id AND e.project_id=p.project_id
    WHERE p.id=NEW.program_id AND p.project_id=NEW.project_id;
    IF (TG_TABLE_NAME='billing_migration_source_access_exceptions' OR environment_mode='production') AND NEW.proposer_actor_id=NEW.approver_actor_id THEN
        RAISE EXCEPTION 'production billing migration approval requires distinct actors' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER billing_migration_approvals_two_person BEFORE INSERT ON billing_migration_approvals FOR EACH ROW EXECUTE FUNCTION enforce_billing_migration_two_person();

CREATE TABLE billing_migration_checkpoints (
    id text PRIMARY KEY, program_id text NOT NULL, project_id text NOT NULL, state_version bigint NOT NULL CHECK(state_version>=1),
    authority_epoch bigint NOT NULL CHECK(authority_epoch>=0), source_watermark timestamptz NOT NULL, provider_watermark timestamptz NOT NULL, shadow_watermark timestamptz NOT NULL,
    scope_digest bytea NOT NULL CHECK(octet_length(scope_digest)=32), manifest_digest bytea NOT NULL CHECK(octet_length(manifest_digest)=32),
    mapping_digest bytea NOT NULL CHECK(octet_length(mapping_digest)=32), policy_digest bytea NOT NULL CHECK(octet_length(policy_digest)=32),
    evidence_digest bytea NOT NULL CHECK(octet_length(evidence_digest)=32), readiness_digest bytea NOT NULL CHECK(octet_length(readiness_digest)=32),
    final_watermark_digest bytea NOT NULL CHECK(octet_length(final_watermark_digest)=32), application_version_digest bytea NOT NULL CHECK(octet_length(application_version_digest)=32),
    approval_digest bytea NOT NULL CHECK(octet_length(approval_digest)=32), checkpoint_digest bytea NOT NULL CHECK(octet_length(checkpoint_digest)=32), created_at timestamptz NOT NULL,
    UNIQUE(program_id,checkpoint_digest), UNIQUE(id,program_id,project_id),
    FOREIGN KEY(program_id,project_id) REFERENCES billing_migration_programs(id,project_id) ON DELETE RESTRICT
);
CREATE TABLE billing_migration_checkpoint_pointer_maps (
    id text PRIMARY KEY, checkpoint_id text NOT NULL, program_id text NOT NULL, project_id text NOT NULL,
    environment_id text NOT NULL, application_id text NOT NULL, platform text NOT NULL CHECK(platform IN ('ios','android')),
    billing_customer_id text NOT NULL, pointer_role text NOT NULL CHECK(pointer_role IN ('rollback_baseline','prepared_activation')),
    snapshot_id text, absent_current boolean NOT NULL DEFAULT false, pointer_digest bytea NOT NULL CHECK(octet_length(pointer_digest)=32),
    UNIQUE(checkpoint_id,application_id,platform,billing_customer_id,pointer_role),
    FOREIGN KEY(checkpoint_id,program_id,project_id) REFERENCES billing_migration_checkpoints(id,program_id,project_id) ON DELETE RESTRICT,
    FOREIGN KEY(program_id,application_id,platform) REFERENCES billing_migration_program_scopes(program_id,application_id,platform) ON DELETE RESTRICT,
    FOREIGN KEY(billing_customer_id,project_id) REFERENCES billing_customers(id,project_id) ON DELETE RESTRICT,
    FOREIGN KEY(snapshot_id,project_id,environment_id,billing_customer_id)
        REFERENCES customer_entitlement_snapshots(id,project_id,environment_id,billing_customer_id) ON DELETE RESTRICT,
    CHECK((pointer_role='prepared_activation' AND snapshot_id IS NOT NULL AND NOT absent_current) OR
          (pointer_role='rollback_baseline' AND absent_current=(snapshot_id IS NULL)))
);

CREATE TABLE billing_migration_divergence_resolutions (
    id text PRIMARY KEY, divergence_id text NOT NULL, program_id text NOT NULL, project_id text NOT NULL,
    resolution text NOT NULL CHECK(resolution IN ('revalidated','mapped','accepted_exception','superseded')),
    actor_id text NOT NULL, reason text NOT NULL CHECK(btrim(reason)<>''), resolution_digest bytea NOT NULL CHECK(octet_length(resolution_digest)=32), resolved_at timestamptz NOT NULL,
    FOREIGN KEY(divergence_id) REFERENCES billing_migration_divergences(id) ON DELETE RESTRICT,
    FOREIGN KEY(program_id,project_id) REFERENCES billing_migration_programs(id,project_id) ON DELETE RESTRICT
);
CREATE TABLE billing_migration_cases (
    id text PRIMARY KEY, program_id text NOT NULL, project_id text NOT NULL, state_version bigint NOT NULL CHECK(state_version>=1),
    classification text NOT NULL CHECK(classification IN ('critical','blocking','warning','informational')),
    status text NOT NULL CHECK(status IN ('open','in_progress','resolved','dismissed')),
    reason text NOT NULL CHECK(btrim(reason)<>'' AND length(reason)<=500 AND reason !~ '[[:cntrl:]]'),
    case_digest bytea NOT NULL CHECK(octet_length(case_digest)=32), opened_at timestamptz NOT NULL, resolved_at timestamptz,
    UNIQUE(id,program_id,project_id), FOREIGN KEY(program_id,project_id) REFERENCES billing_migration_programs(id,project_id) ON DELETE RESTRICT
);
CREATE TABLE billing_migration_source_access_exceptions (
    id text PRIMARY KEY, case_id text NOT NULL, program_id text NOT NULL, project_id text NOT NULL,
    application_id text NOT NULL, platform text NOT NULL CHECK(platform IN ('ios','android')),
    reason text NOT NULL CHECK(btrim(reason)<>'' AND length(reason)<=500 AND reason !~ '[[:cntrl:]]'),
    affected_customer_count integer NOT NULL CHECK(affected_customer_count BETWEEN 1 AND 1000000),
    rollback_treatment text NOT NULL CHECK(btrim(rollback_treatment)<>'' AND length(rollback_treatment)<=500 AND rollback_treatment !~ '[[:cntrl:]]'),
    identity_ambiguity_count integer NOT NULL DEFAULT 0 CHECK(identity_ambiguity_count=0),
    proposer_actor_id text NOT NULL, approver_actor_id text NOT NULL, approved_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
    exception_digest bytea NOT NULL CHECK(octet_length(exception_digest)=32), UNIQUE(case_id), UNIQUE(id,program_id,project_id),
    FOREIGN KEY(case_id,program_id,project_id) REFERENCES billing_migration_cases(id,program_id,project_id) ON DELETE RESTRICT,
    FOREIGN KEY(program_id,application_id,platform) REFERENCES billing_migration_program_scopes(program_id,application_id,platform) ON DELETE RESTRICT,
    CHECK(expires_at>approved_at)
);
CREATE TABLE billing_migration_source_access_exception_subjects (
    id text PRIMARY KEY, exception_id text NOT NULL, program_id text NOT NULL, project_id text NOT NULL,
    source_record_id text NOT NULL, billing_customer_id text NOT NULL,
    subject_digest bytea NOT NULL CHECK(octet_length(subject_digest)=32), created_at timestamptz NOT NULL,
    UNIQUE(exception_id,source_record_id),
    FOREIGN KEY(exception_id,program_id,project_id) REFERENCES billing_migration_source_access_exceptions(id,program_id,project_id) ON DELETE RESTRICT,
    FOREIGN KEY(source_record_id,program_id,project_id) REFERENCES billing_migration_source_records(id,program_id,project_id) ON DELETE RESTRICT,
    FOREIGN KEY(billing_customer_id,project_id) REFERENCES billing_customers(id,project_id) ON DELETE RESTRICT
);
CREATE TRIGGER billing_migration_source_exceptions_two_person BEFORE INSERT ON billing_migration_source_access_exceptions FOR EACH ROW EXECUTE FUNCTION enforce_billing_migration_two_person();
CREATE TABLE billing_migration_case_comments (
    id text PRIMARY KEY, case_id text NOT NULL, program_id text NOT NULL, project_id text NOT NULL, actor_id text NOT NULL,
    body text NOT NULL CHECK(btrim(body)<>'' AND length(body)<=2000), comment_digest bytea NOT NULL CHECK(octet_length(comment_digest)=32), created_at timestamptz NOT NULL,
    FOREIGN KEY(case_id,program_id,project_id) REFERENCES billing_migration_cases(id,program_id,project_id) ON DELETE RESTRICT
);
CREATE TABLE billing_migration_case_actions (
    id text PRIMARY KEY, case_id text NOT NULL, program_id text NOT NULL, project_id text NOT NULL, actor_id text NOT NULL,
    action text NOT NULL, before_digest bytea NOT NULL CHECK(octet_length(before_digest)=32), after_digest bytea NOT NULL CHECK(octet_length(after_digest)=32), created_at timestamptz NOT NULL,
    FOREIGN KEY(case_id,program_id,project_id) REFERENCES billing_migration_cases(id,program_id,project_id) ON DELETE RESTRICT
);
CREATE TABLE billing_migration_repair_previews (
    id text PRIMARY KEY, case_id text NOT NULL, program_id text NOT NULL, project_id text NOT NULL,
    repair_kind text NOT NULL CHECK(repair_kind IN ('provider_revalidate','projection_replay','attach_proven_alias','replace_mapping_set','retry_quarantined_record')),
    scope_kind text NOT NULL CHECK(scope_kind IN ('provider_reference','fact_range','audited_alias','mapping_set','source_record')),
    scope_references text[] NOT NULL CHECK(cardinality(scope_references) BETWEEN 1 AND 100),
    affected_count integer NOT NULL CHECK(affected_count BETWEEN 0 AND 1000), before_digest bytea NOT NULL CHECK(octet_length(before_digest)=32),
    after_digest bytea NOT NULL CHECK(octet_length(after_digest)=32), preview_digest bytea NOT NULL CHECK(octet_length(preview_digest)=32), created_by_actor_id text NOT NULL, created_at timestamptz NOT NULL,
    UNIQUE(id,program_id,project_id), FOREIGN KEY(case_id,program_id,project_id) REFERENCES billing_migration_cases(id,program_id,project_id) ON DELETE RESTRICT
);
CREATE TABLE billing_migration_repair_executions (
    id text PRIMARY KEY, preview_id text NOT NULL, program_id text NOT NULL, project_id text NOT NULL, idempotency_key text NOT NULL,
    result text NOT NULL CHECK(result IN ('succeeded','failed','no_change')), result_digest bytea NOT NULL CHECK(octet_length(result_digest)=32), executed_by_actor_id text NOT NULL, executed_at timestamptz NOT NULL,
    UNIQUE(program_id,idempotency_key), FOREIGN KEY(preview_id,program_id,project_id) REFERENCES billing_migration_repair_previews(id,program_id,project_id) ON DELETE RESTRICT
);

CREATE TABLE billing_migration_completion_reports (
    id text PRIMARY KEY, program_id text NOT NULL, project_id text NOT NULL, state_version bigint NOT NULL CHECK(state_version>=1),
    completed_at timestamptz NOT NULL, stabilization_ended_at timestamptz NOT NULL, rollback_window_ended_at timestamptz NOT NULL,
    credential_removed boolean NOT NULL CHECK(credential_removed), credential_removed_at timestamptz NOT NULL,
    legal_hold boolean NOT NULL, source_objects_delete_at timestamptz,
    completion_digest bytea NOT NULL CHECK(octet_length(completion_digest)=32),
    UNIQUE(program_id), FOREIGN KEY(program_id,project_id) REFERENCES billing_migration_programs(id,project_id) ON DELETE RESTRICT
    ,CHECK(completed_at>=stabilization_ended_at AND completed_at>=rollback_window_ended_at)
    ,CHECK(credential_removed_at>=rollback_window_ended_at)
    ,CHECK((legal_hold AND source_objects_delete_at IS NULL) OR (NOT legal_hold AND source_objects_delete_at=completed_at+interval '30 days'))
);
CREATE TABLE billing_migration_retention_jobs (
    id text PRIMARY KEY, program_id text NOT NULL, project_id text NOT NULL, status text NOT NULL CHECK(status IN ('pending','running','completed','failed')),
    legal_hold boolean NOT NULL DEFAULT false, due_at timestamptz NOT NULL, lease_owner text, lease_expires_at timestamptz, lease_generation bigint NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
    FOREIGN KEY(program_id,project_id) REFERENCES billing_migration_programs(id,project_id) ON DELETE RESTRICT,
    CHECK((status='running')=(lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL))
);
CREATE TABLE billing_migration_object_deletions (
    id text PRIMARY KEY, program_id text NOT NULL, project_id text NOT NULL, manifest_id text,
    object_key_digest bytea NOT NULL CHECK(octet_length(object_key_digest)=32), deletion_result text NOT NULL CHECK(deletion_result IN ('deleted','not_found','failed','legal_hold')),
    deletion_digest bytea NOT NULL CHECK(octet_length(deletion_digest)=32), deleted_at timestamptz NOT NULL,
    FOREIGN KEY(program_id,project_id) REFERENCES billing_migration_programs(id,project_id) ON DELETE RESTRICT,
    FOREIGN KEY(manifest_id,program_id,project_id) REFERENCES billing_migration_source_manifests(id,program_id,project_id) ON DELETE RESTRICT
);
CREATE TABLE billing_migration_transition_outbox (
    id text PRIMARY KEY, program_id text NOT NULL, project_id text NOT NULL, authority_scope_id text NOT NULL,
    transition_id text NOT NULL, event_kind text NOT NULL CHECK(event_kind IN ('authority_changed','rollback_changed')),
    authority_epoch bigint NOT NULL CHECK(authority_epoch>=1), status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed')),
    attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0), lease_owner text, lease_expires_at timestamptz,
    created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
    UNIQUE(transition_id,authority_scope_id),
    FOREIGN KEY(program_id,project_id) REFERENCES billing_migration_programs(id,project_id) ON DELETE RESTRICT,
    FOREIGN KEY(authority_scope_id,project_id) REFERENCES billing_migration_authority_scopes(id,project_id) ON DELETE RESTRICT,
    FOREIGN KEY(transition_id) REFERENCES billing_migration_authority_transitions(id) ON DELETE RESTRICT,
    CHECK((status='running')=(lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL))
);
CREATE INDEX billing_migration_transition_outbox_claim_idx ON billing_migration_transition_outbox(updated_at,id) WHERE status IN ('pending','running');

-- Immutable evidence/control records. Mutable workflow rows are deliberately excluded.
CREATE TRIGGER billing_migration_validation_attempts_immutable BEFORE UPDATE OR DELETE ON billing_migration_validation_attempts FOR EACH ROW EXECUTE FUNCTION reject_billing_migration_immutable_change();
CREATE TRIGGER billing_migration_import_attempts_immutable BEFORE UPDATE OR DELETE ON billing_migration_import_attempts FOR EACH ROW EXECUTE FUNCTION reject_billing_migration_immutable_change();
CREATE TRIGGER billing_migration_shadow_snapshots_immutable BEFORE UPDATE OR DELETE ON billing_migration_shadow_snapshots FOR EACH ROW EXECUTE FUNCTION reject_billing_migration_immutable_change();
CREATE TRIGGER billing_migration_authority_transitions_immutable BEFORE UPDATE OR DELETE ON billing_migration_authority_transitions FOR EACH ROW EXECUTE FUNCTION reject_billing_migration_immutable_change();
CREATE TRIGGER billing_migration_readiness_policies_immutable BEFORE UPDATE OR DELETE ON billing_migration_readiness_policies FOR EACH ROW EXECUTE FUNCTION reject_billing_migration_immutable_change();
CREATE TRIGGER billing_migration_readiness_policy_scopes_immutable BEFORE UPDATE OR DELETE ON billing_migration_readiness_policy_scopes FOR EACH ROW EXECUTE FUNCTION reject_billing_migration_immutable_change();
CREATE TRIGGER billing_migration_supported_versions_immutable BEFORE UPDATE OR DELETE ON billing_migration_supported_app_versions FOR EACH ROW EXECUTE FUNCTION reject_billing_migration_immutable_change();
CREATE TRIGGER billing_migration_sync_observations_immutable BEFORE UPDATE OR DELETE ON billing_migration_v2_sync_observations FOR EACH ROW EXECUTE FUNCTION reject_billing_migration_immutable_change();
CREATE TRIGGER billing_migration_final_deltas_immutable BEFORE UPDATE OR DELETE ON billing_migration_final_deltas FOR EACH ROW EXECUTE FUNCTION reject_billing_migration_immutable_change();
CREATE TRIGGER billing_migration_approvals_immutable BEFORE UPDATE OR DELETE ON billing_migration_approvals FOR EACH ROW EXECUTE FUNCTION reject_billing_migration_immutable_change();
CREATE TRIGGER billing_migration_checkpoints_immutable BEFORE UPDATE OR DELETE ON billing_migration_checkpoints FOR EACH ROW EXECUTE FUNCTION reject_billing_migration_immutable_change();
CREATE TRIGGER billing_migration_checkpoint_maps_immutable BEFORE UPDATE OR DELETE ON billing_migration_checkpoint_pointer_maps FOR EACH ROW EXECUTE FUNCTION reject_billing_migration_immutable_change();
CREATE TRIGGER billing_migration_divergence_resolutions_immutable BEFORE UPDATE OR DELETE ON billing_migration_divergence_resolutions FOR EACH ROW EXECUTE FUNCTION reject_billing_migration_immutable_change();
CREATE TRIGGER billing_migration_case_comments_immutable BEFORE UPDATE OR DELETE ON billing_migration_case_comments FOR EACH ROW EXECUTE FUNCTION reject_billing_migration_immutable_change();
CREATE TRIGGER billing_migration_case_actions_immutable BEFORE UPDATE OR DELETE ON billing_migration_case_actions FOR EACH ROW EXECUTE FUNCTION reject_billing_migration_immutable_change();
CREATE TRIGGER billing_migration_source_exceptions_immutable BEFORE UPDATE OR DELETE ON billing_migration_source_access_exceptions FOR EACH ROW EXECUTE FUNCTION reject_billing_migration_immutable_change();
CREATE TRIGGER billing_migration_source_exception_subjects_immutable BEFORE UPDATE OR DELETE ON billing_migration_source_access_exception_subjects FOR EACH ROW EXECUTE FUNCTION reject_billing_migration_immutable_change();
CREATE TRIGGER billing_migration_repair_previews_immutable BEFORE UPDATE OR DELETE ON billing_migration_repair_previews FOR EACH ROW EXECUTE FUNCTION reject_billing_migration_immutable_change();
CREATE TRIGGER billing_migration_repair_executions_immutable BEFORE UPDATE OR DELETE ON billing_migration_repair_executions FOR EACH ROW EXECUTE FUNCTION reject_billing_migration_immutable_change();
CREATE TRIGGER billing_migration_completion_reports_immutable BEFORE UPDATE OR DELETE ON billing_migration_completion_reports FOR EACH ROW EXECUTE FUNCTION reject_billing_migration_immutable_change();
CREATE TRIGGER billing_migration_object_deletions_immutable BEFORE UPDATE OR DELETE ON billing_migration_object_deletions FOR EACH ROW EXECUTE FUNCTION reject_billing_migration_immutable_change();

-- +goose Down
-- Cryptographic removal is intentionally irreversible. Restoring the pre-00053
-- NOT NULL envelope shape would require fabricating ciphertext, so rollback is
-- refused while any retained credential metadata represents a removed secret.
-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM billing_migration_credentials
        WHERE removed_at IS NOT NULL OR nonce IS NULL OR ciphertext IS NULL
    ) THEN
        RAISE EXCEPTION 'cannot rollback migration 00053: cryptographically removed billing migration credentials cannot restore ciphertext'
            USING ERRCODE='55000';
    END IF;
END;
$$;
-- +goose StatementEnd
DROP TRIGGER billing_migration_source_exceptions_two_person ON billing_migration_source_access_exceptions;
DROP TRIGGER billing_migration_approvals_two_person ON billing_migration_approvals;
DROP TRIGGER billing_migration_object_deletions_immutable ON billing_migration_object_deletions;
DROP TRIGGER billing_migration_completion_reports_immutable ON billing_migration_completion_reports;
DROP TRIGGER billing_migration_repair_executions_immutable ON billing_migration_repair_executions;
DROP TRIGGER billing_migration_repair_previews_immutable ON billing_migration_repair_previews;
DROP TRIGGER billing_migration_case_actions_immutable ON billing_migration_case_actions;
DROP TRIGGER billing_migration_case_comments_immutable ON billing_migration_case_comments;
DROP TRIGGER billing_migration_source_exceptions_immutable ON billing_migration_source_access_exceptions;
DROP TRIGGER billing_migration_source_exception_subjects_immutable ON billing_migration_source_access_exception_subjects;
DROP TRIGGER billing_migration_divergence_resolutions_immutable ON billing_migration_divergence_resolutions;
DROP TRIGGER billing_migration_checkpoint_maps_immutable ON billing_migration_checkpoint_pointer_maps;
DROP TRIGGER billing_migration_checkpoints_immutable ON billing_migration_checkpoints;
DROP TRIGGER billing_migration_approvals_immutable ON billing_migration_approvals;
DROP TRIGGER billing_migration_final_deltas_immutable ON billing_migration_final_deltas;
DROP TRIGGER billing_migration_sync_observations_immutable ON billing_migration_v2_sync_observations;
DROP TRIGGER billing_migration_supported_versions_immutable ON billing_migration_supported_app_versions;
DROP TRIGGER billing_migration_readiness_policies_immutable ON billing_migration_readiness_policies;
DROP TRIGGER billing_migration_readiness_policy_scopes_immutable ON billing_migration_readiness_policy_scopes;
DROP TRIGGER billing_migration_authority_transitions_immutable ON billing_migration_authority_transitions;
DROP TRIGGER billing_migration_shadow_snapshots_immutable ON billing_migration_shadow_snapshots;
DROP TRIGGER billing_migration_import_attempts_immutable ON billing_migration_import_attempts;
DROP TRIGGER billing_migration_validation_attempts_immutable ON billing_migration_validation_attempts;
DROP TABLE billing_migration_transition_outbox;
DROP TABLE billing_migration_object_deletions;
DROP TABLE billing_migration_retention_jobs;
DROP TABLE billing_migration_completion_reports;
DROP TABLE billing_migration_repair_executions;
DROP TABLE billing_migration_repair_previews;
DROP TABLE billing_migration_case_actions;
DROP TABLE billing_migration_case_comments;
DROP TABLE billing_migration_source_access_exception_subjects;
DROP TABLE billing_migration_source_access_exceptions;
DROP TABLE billing_migration_cases;
DROP TABLE billing_migration_divergence_resolutions;
DROP TABLE billing_migration_checkpoint_pointer_maps;
DROP TABLE billing_migration_checkpoints;
DROP TABLE billing_migration_approvals;
DROP TABLE billing_migration_cutover_proposals;
DROP TABLE billing_migration_command_idempotency;
DROP TABLE billing_migration_final_deltas;
DROP TABLE billing_migration_v2_sync_observations;
DROP TABLE billing_migration_supported_app_versions;
DROP TABLE billing_migration_readiness_policy_scopes;
DROP TABLE billing_migration_readiness_policies;
DROP TABLE billing_migration_authority_transitions;
DROP TABLE billing_migration_authority_scopes;
DROP TABLE billing_migration_scope_prepared_pointers;
DROP TABLE billing_migration_scope_current_pointers;
DROP TABLE billing_migration_shadow_snapshots;
DROP TABLE billing_migration_import_attempts;
DROP TABLE billing_migration_validation_attempts;
ALTER TABLE billing_migration_readiness_assessments
    DROP CONSTRAINT billing_migration_readiness_authoritative_check,
    DROP COLUMN application_version_digest,
    DROP COLUMN warning_threshold,
    DROP COLUMN source_capabilities_fresh,
    DROP COLUMN authoritative,
    ADD CONSTRAINT billing_migration_readiness_assessments_check CHECK (ready = (
        current_access_mapping_percent=100 AND current_access_evidence_percent=100 AND
        critical_count=0 AND blocking_count=0 AND final_delta_completed AND
        watermarks_fresh AND supported_versions_authority_aware
    ));
ALTER TABLE customer_entitlement_snapshots DROP CONSTRAINT customer_entitlement_snapshots_scope_unique;
ALTER TABLE billing_migration_import_batches DROP CONSTRAINT billing_migration_import_batches_scope_unique;
ALTER TABLE billing_migration_source_records DROP CONSTRAINT billing_migration_source_records_scope_unique;
ALTER TABLE billing_migration_credentials
    DROP CONSTRAINT billing_migration_credentials_secure_removal,
    DROP COLUMN removal_digest,
    DROP COLUMN removed_by_actor_id,
    DROP COLUMN removed_at,
    ALTER COLUMN ciphertext SET NOT NULL,
    ALTER COLUMN nonce SET NOT NULL;
DROP FUNCTION enforce_billing_migration_two_person();
DROP FUNCTION billing_migration_text_array_unique(text[]);
