-- Phase 9C Stage 2E Package C: bounded repairs, credential destruction,
-- completion, legal holds, and raw-source retention.

-- +goose Up
ALTER TABLE billing_migration_divergences ADD CONSTRAINT billing_migration_divergences_scope_unique UNIQUE(id,program_id,project_id);
ALTER TABLE billing_migration_cases
    ADD COLUMN updated_at timestamptz,
    ADD COLUMN linked_divergence_id text,
    ADD COLUMN linked_source_record_id text,
    ADD CONSTRAINT billing_migration_cases_resolution_shape CHECK (
        (status IN ('open','in_progress') AND resolved_at IS NULL) OR
        (status IN ('resolved','dismissed') AND resolved_at IS NOT NULL)),
    ADD CONSTRAINT billing_migration_cases_divergence_fk FOREIGN KEY (linked_divergence_id,program_id,project_id)
        REFERENCES billing_migration_divergences(id,program_id,project_id) ON DELETE RESTRICT,
    ADD CONSTRAINT billing_migration_cases_source_record_fk FOREIGN KEY
        (linked_source_record_id,program_id,project_id)
        REFERENCES billing_migration_source_records(id,program_id,project_id) ON DELETE RESTRICT;
UPDATE billing_migration_cases SET updated_at=COALESCE(resolved_at,opened_at);
ALTER TABLE billing_migration_cases ALTER COLUMN updated_at SET DEFAULT now(), ALTER COLUMN updated_at SET NOT NULL;

ALTER TABLE billing_migration_repair_previews
    DROP CONSTRAINT billing_migration_repair_previews_repair_kind_check,
    ADD CONSTRAINT billing_migration_repair_previews_repair_kind_check CHECK(repair_kind IN (
        'provider_revalidate','projection_replay','attach_proven_alias',
        'replace_mapping_set','retry_quarantined_record')),
    ADD COLUMN expected_program_state_version bigint,
    ADD COLUMN expected_case_digest bytea,
    ADD COLUMN expected_policy_digest bytea,
    ADD COLUMN expected_scope_digest bytea,
    ADD COLUMN reason text,
    ADD COLUMN expires_at timestamptz;
UPDATE billing_migration_repair_previews p SET
    expected_program_state_version=(SELECT state_version FROM billing_migration_programs WHERE id=p.program_id),
    expected_case_digest=(SELECT case_digest FROM billing_migration_cases WHERE id=p.case_id),
    expected_policy_digest=(SELECT policy_digest FROM billing_migration_programs WHERE id=p.program_id),
    expected_scope_digest=(SELECT scope_digest FROM billing_migration_programs WHERE id=p.program_id),
    reason='legacy repair preview',
    expires_at=p.created_at+interval '1 hour';
ALTER TABLE billing_migration_repair_previews
    ALTER COLUMN expected_program_state_version SET NOT NULL,
    ALTER COLUMN expected_case_digest SET NOT NULL,
    ALTER COLUMN expected_policy_digest SET NOT NULL,
    ALTER COLUMN expected_scope_digest SET NOT NULL,
    ALTER COLUMN reason SET NOT NULL,
    ALTER COLUMN expires_at SET NOT NULL,
    ADD CONSTRAINT billing_migration_repair_previews_state_version CHECK(expected_program_state_version>=1),
    ADD CONSTRAINT billing_migration_repair_previews_case_digest CHECK(octet_length(expected_case_digest)=32),
    ADD CONSTRAINT billing_migration_repair_previews_policy_digest CHECK(octet_length(expected_policy_digest)=32),
    ADD CONSTRAINT billing_migration_repair_previews_scope_digest CHECK(octet_length(expected_scope_digest)=32),
    ADD CONSTRAINT billing_migration_repair_previews_reason CHECK(btrim(reason)<>'' AND length(reason)<=500 AND reason !~ '[[:cntrl:]]'),
    ADD CONSTRAINT billing_migration_repair_previews_expiry CHECK(expires_at>created_at);

ALTER TABLE billing_migration_repair_executions
    ADD COLUMN attempt_number integer,
    ADD COLUMN request_digest bytea,
    ADD COLUMN actual_before_digest bytea,
    ADD COLUMN actual_after_digest bytea,
    ADD COLUMN error_code text;
WITH numbered AS (
    SELECT id,row_number() OVER(PARTITION BY preview_id ORDER BY executed_at,id) AS n
    FROM billing_migration_repair_executions
) UPDATE billing_migration_repair_executions e SET
    attempt_number=n.n,
    request_digest=sha256(convert_to(e.idempotency_key,'UTF8')),
    actual_before_digest=p.before_digest,
    actual_after_digest=p.after_digest
FROM numbered n,billing_migration_repair_previews p
WHERE e.id=n.id AND p.id=e.preview_id;
ALTER TABLE billing_migration_repair_executions
    ALTER COLUMN attempt_number SET NOT NULL,
    ALTER COLUMN request_digest SET NOT NULL,
    ALTER COLUMN actual_before_digest SET NOT NULL,
    ALTER COLUMN actual_after_digest SET NOT NULL,
    ADD CONSTRAINT billing_migration_repair_executions_attempt CHECK(attempt_number BETWEEN 1 AND 16),
    ADD CONSTRAINT billing_migration_repair_executions_request_digest CHECK(octet_length(request_digest)=32),
    ADD CONSTRAINT billing_migration_repair_executions_before_digest CHECK(octet_length(actual_before_digest)=32),
    ADD CONSTRAINT billing_migration_repair_executions_after_digest CHECK(octet_length(actual_after_digest)=32),
    ADD CONSTRAINT billing_migration_repair_executions_error_shape CHECK(
        (result='failed' AND btrim(error_code)<>'') OR (result<>'failed' AND error_code IS NULL)),
    ADD CONSTRAINT billing_migration_repair_executions_preview_attempt_unique UNIQUE(preview_id,attempt_number);

CREATE TABLE billing_migration_repair_reservations (
    id text PRIMARY KEY, preview_id text NOT NULL, program_id text NOT NULL, project_id text NOT NULL,
    idempotency_key text NOT NULL CHECK(btrim(idempotency_key)<>''), request_digest bytea NOT NULL CHECK(octet_length(request_digest)=32),
    attempt_number integer NOT NULL CHECK(attempt_number BETWEEN 1 AND 16), expected_program_state_version bigint NOT NULL CHECK(expected_program_state_version>=1), actor_id text NOT NULL,
    reserved_at timestamptz NOT NULL, settled_at timestamptz,
    UNIQUE(program_id,idempotency_key), UNIQUE(preview_id,attempt_number),
    FOREIGN KEY(preview_id,program_id,project_id) REFERENCES billing_migration_repair_previews(id,program_id,project_id) ON DELETE RESTRICT
);

CREATE TABLE billing_migration_repair_invalidations (
    id text PRIMARY KEY, execution_id text NOT NULL, program_id text NOT NULL, project_id text NOT NULL,
    invalidation_kind text NOT NULL CHECK(invalidation_kind IN ('dry_run','shadow','readiness','checkpoint','approval')),
    invalidated_reference_id text NOT NULL CHECK(btrim(invalidated_reference_id)<>''),
    invalidation_digest bytea NOT NULL CHECK(octet_length(invalidation_digest)=32), invalidated_at timestamptz NOT NULL,
    UNIQUE(execution_id,invalidation_kind,invalidated_reference_id),
    FOREIGN KEY(execution_id) REFERENCES billing_migration_repair_executions(id) ON DELETE RESTRICT,
    FOREIGN KEY(program_id,project_id) REFERENCES billing_migration_programs(id,project_id) ON DELETE RESTRICT
);

CREATE TABLE billing_migration_credential_removals (
    id text PRIMARY KEY, program_id text NOT NULL, project_id text NOT NULL, credential_id text NOT NULL,
    idempotency_key text NOT NULL CHECK(btrim(idempotency_key)<>''), expected_state_version bigint NOT NULL CHECK(expected_state_version>=1),
    reason text NOT NULL CHECK(btrim(reason)<>'' AND length(reason)<=500 AND reason !~ '[[:cntrl:]]'),
    early_removal boolean NOT NULL, irreversible_acknowledged boolean NOT NULL CHECK(irreversible_acknowledged),
    actor_id text NOT NULL, envelope_digest bytea NOT NULL CHECK(octet_length(envelope_digest)=32),
    removal_digest bytea NOT NULL CHECK(octet_length(removal_digest)=32), removed_at timestamptz NOT NULL,
    UNIQUE(program_id,idempotency_key), UNIQUE(credential_id),
    FOREIGN KEY(program_id,project_id) REFERENCES billing_migration_programs(id,project_id) ON DELETE RESTRICT,
    FOREIGN KEY(credential_id,project_id) REFERENCES billing_migration_credentials(id,project_id) ON DELETE RESTRICT
);

CREATE TABLE billing_migration_legal_hold_proposals (
    id text PRIMARY KEY, program_id text NOT NULL, project_id text NOT NULL,
    command text NOT NULL CHECK(command IN ('set','release')),
    reason text NOT NULL CHECK(btrim(reason)<>'' AND length(reason)<=500 AND reason !~ '[[:cntrl:]]'),
    external_compliance_reference text NOT NULL CHECK(btrim(external_compliance_reference)<>'' AND length(external_compliance_reference)<=256),
    proposer_actor_id text NOT NULL, expected_previous_command_digest bytea,
    proposal_digest bytea NOT NULL CHECK(octet_length(proposal_digest)=32), idempotency_key text NOT NULL,
    request_digest bytea NOT NULL CHECK(octet_length(request_digest)=32), status text NOT NULL CHECK(status IN('pending','approved','expired','invalidated')),
    proposed_at timestamptz NOT NULL, expires_at timestamptz NOT NULL CHECK(expires_at>proposed_at),
    UNIQUE(program_id,idempotency_key), UNIQUE(id,program_id,project_id), UNIQUE(program_id,proposal_digest),
    FOREIGN KEY(program_id,project_id) REFERENCES billing_migration_programs(id,project_id) ON DELETE RESTRICT,
    CHECK(expected_previous_command_digest IS NULL OR octet_length(expected_previous_command_digest)=32)
);
CREATE TABLE billing_migration_legal_hold_commands (
    id text PRIMARY KEY, program_id text NOT NULL, project_id text NOT NULL,
    proposal_id text NOT NULL,
    command text NOT NULL CHECK(command IN ('set','release')),
    reason text NOT NULL CHECK(btrim(reason)<>'' AND length(reason)<=500 AND reason !~ '[[:cntrl:]]'),
    external_compliance_reference text NOT NULL CHECK(btrim(external_compliance_reference)<>'' AND length(external_compliance_reference)<=256),
    proposer_actor_id text NOT NULL, approver_actor_id text NOT NULL, production boolean NOT NULL,
    previous_command_id text, command_digest bytea NOT NULL CHECK(octet_length(command_digest)=32), commanded_at timestamptz NOT NULL,
    UNIQUE(id,program_id,project_id),
    UNIQUE(proposal_id),
    FOREIGN KEY(program_id,project_id) REFERENCES billing_migration_programs(id,project_id) ON DELETE RESTRICT,
    FOREIGN KEY(proposal_id,program_id,project_id) REFERENCES billing_migration_legal_hold_proposals(id,program_id,project_id) ON DELETE RESTRICT,
    FOREIGN KEY(previous_command_id,program_id,project_id) REFERENCES billing_migration_legal_hold_commands(id,program_id,project_id) ON DELETE RESTRICT,
    CHECK((production AND proposer_actor_id<>approver_actor_id) OR (NOT production AND proposer_actor_id=approver_actor_id))
);
CREATE UNIQUE INDEX billing_migration_legal_hold_one_root
    ON billing_migration_legal_hold_commands(program_id) WHERE previous_command_id IS NULL;
CREATE UNIQUE INDEX billing_migration_legal_hold_one_successor
    ON billing_migration_legal_hold_commands(previous_command_id) WHERE previous_command_id IS NOT NULL;
-- +goose StatementBegin
CREATE FUNCTION enforce_billing_migration_legal_hold_proposal_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.id<>OLD.id OR NEW.program_id<>OLD.program_id OR NEW.project_id<>OLD.project_id OR NEW.command<>OLD.command
       OR NEW.reason<>OLD.reason OR NEW.external_compliance_reference<>OLD.external_compliance_reference
       OR NEW.proposer_actor_id<>OLD.proposer_actor_id OR NEW.expected_previous_command_digest IS DISTINCT FROM OLD.expected_previous_command_digest
       OR NEW.proposal_digest<>OLD.proposal_digest OR NEW.idempotency_key<>OLD.idempotency_key OR NEW.request_digest<>OLD.request_digest
       OR NEW.proposed_at<>OLD.proposed_at OR NEW.expires_at<>OLD.expires_at
       OR NOT (OLD.status='pending' AND NEW.status IN('approved','expired','invalidated')) THEN
        RAISE EXCEPTION 'billing migration legal hold proposal consent is immutable' USING ERRCODE='55000';
    END IF;
    RETURN NEW;
END $$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION enforce_billing_migration_legal_hold_environment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    environment_mode text;
    proposal billing_migration_legal_hold_proposals%ROWTYPE;
BEGIN
    SELECT e.mode INTO STRICT environment_mode
    FROM billing_migration_programs mp
    JOIN environments e ON e.id=mp.environment_id AND e.project_id=mp.project_id
    WHERE mp.id=NEW.program_id AND mp.project_id=NEW.project_id;

    SELECT * INTO STRICT proposal
    FROM billing_migration_legal_hold_proposals
    WHERE id=NEW.proposal_id AND program_id=NEW.program_id AND project_id=NEW.project_id;

    IF NEW.production IS DISTINCT FROM (environment_mode='production') THEN
        RAISE EXCEPTION 'billing migration legal hold production flag does not match environment' USING ERRCODE='23514';
    END IF;
    IF (environment_mode='production' AND NEW.proposer_actor_id=NEW.approver_actor_id)
       OR (environment_mode<>'production' AND NEW.proposer_actor_id<>NEW.approver_actor_id) THEN
        RAISE EXCEPTION 'billing migration legal hold approval actors do not match environment policy' USING ERRCODE='23514';
    END IF;
    IF proposal.status<>'pending' OR NEW.commanded_at>proposal.expires_at
       OR NEW.command<>proposal.command OR NEW.reason<>proposal.reason
       OR NEW.external_compliance_reference<>proposal.external_compliance_reference
       OR NEW.proposer_actor_id<>proposal.proposer_actor_id THEN
        RAISE EXCEPTION 'billing migration legal hold command does not match pending proposal consent' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END $$;
-- +goose StatementEnd

ALTER TABLE billing_migration_completion_reports
    ADD COLUMN authority_digest bytea,
    ADD COLUMN stability_evidence_digest bytea,
    ADD COLUMN completion_policy_digest bytea;
-- +goose StatementBegin
DO $$ DECLARE constraint_name text; BEGIN
    SELECT c.conname INTO constraint_name FROM pg_constraint c
    WHERE c.conrelid='billing_migration_completion_reports'::regclass
      AND c.contype='c' AND pg_get_constraintdef(c.oid) LIKE '%credential_removed_at >= rollback_window_ended_at%';
    IF constraint_name IS NOT NULL THEN EXECUTE format('ALTER TABLE billing_migration_completion_reports DROP CONSTRAINT %I',constraint_name); END IF;
END $$;
-- +goose StatementEnd
UPDATE billing_migration_completion_reports r SET
    authority_digest=sha256(r.completion_digest||convert_to('authority','UTF8')),
    stability_evidence_digest=sha256(r.completion_digest||convert_to('stability','UTF8')),
    completion_policy_digest=sha256(r.completion_digest||convert_to('policy','UTF8'));
ALTER TABLE billing_migration_completion_reports
    ALTER COLUMN authority_digest SET NOT NULL,
    ALTER COLUMN stability_evidence_digest SET NOT NULL,
    ALTER COLUMN completion_policy_digest SET NOT NULL,
    ADD CONSTRAINT billing_migration_completion_authority_digest CHECK(octet_length(authority_digest)=32),
    ADD CONSTRAINT billing_migration_completion_stability_digest CHECK(octet_length(stability_evidence_digest)=32),
    ADD CONSTRAINT billing_migration_completion_policy_digest CHECK(octet_length(completion_policy_digest)=32);
ALTER TABLE billing_migration_completion_reports
    ADD CONSTRAINT billing_migration_completion_credential_removed_before_completion CHECK(credential_removed_at<=completed_at);

ALTER TABLE billing_migration_retention_jobs
    ADD COLUMN completion_report_id text,
    ADD COLUMN attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 16),
    ADD COLUMN max_attempts integer NOT NULL DEFAULT 8 CHECK(max_attempts BETWEEN 1 AND 16),
    ADD COLUMN last_error_code text,
    ADD COLUMN deletion_identity bytea;
UPDATE billing_migration_retention_jobs j SET
    completion_report_id=(SELECT id FROM billing_migration_completion_reports WHERE program_id=j.program_id),
    deletion_identity=sha256(convert_to(j.program_id||chr(31)||j.id,'UTF8'));
ALTER TABLE billing_migration_retention_jobs
    ALTER COLUMN completion_report_id SET NOT NULL,
    ALTER COLUMN deletion_identity SET NOT NULL,
    ADD CONSTRAINT billing_migration_retention_completion_fk FOREIGN KEY(completion_report_id)
        REFERENCES billing_migration_completion_reports(id) ON DELETE RESTRICT,
    ADD CONSTRAINT billing_migration_retention_identity_digest CHECK(octet_length(deletion_identity)=32),
    ADD CONSTRAINT billing_migration_retention_due CHECK(due_at>=created_at),
    ADD CONSTRAINT billing_migration_retention_program_unique UNIQUE(program_id),
    ADD CONSTRAINT billing_migration_retention_error_shape CHECK(
        (status='failed' AND btrim(last_error_code)<>'') OR status<>'failed');
ALTER TABLE billing_migration_retention_jobs ADD COLUMN original_due_at timestamptz;
UPDATE billing_migration_retention_jobs SET original_due_at=due_at;
ALTER TABLE billing_migration_retention_jobs ALTER COLUMN original_due_at SET NOT NULL;

ALTER TABLE billing_migration_object_deletions
    DROP CONSTRAINT billing_migration_object_deletions_deletion_result_check,
    ADD COLUMN retention_job_id text,
    ADD COLUMN attempt_number integer,
    ADD CONSTRAINT billing_migration_object_deletions_deletion_result_check CHECK(deletion_result IN ('deleted','not_found','retryable_failure','legal_hold'));
UPDATE billing_migration_object_deletions d SET
    retention_job_id=(SELECT id FROM billing_migration_retention_jobs WHERE program_id=d.program_id),
    attempt_number=1;
ALTER TABLE billing_migration_object_deletions
    ALTER COLUMN retention_job_id SET NOT NULL,
    ALTER COLUMN attempt_number SET NOT NULL,
    ADD CONSTRAINT billing_migration_object_deletions_job_fk FOREIGN KEY(retention_job_id)
        REFERENCES billing_migration_retention_jobs(id) ON DELETE RESTRICT,
    ADD CONSTRAINT billing_migration_object_deletions_attempt CHECK(attempt_number BETWEEN 1 AND 16),
    ADD CONSTRAINT billing_migration_object_deletions_identity_unique UNIQUE(retention_job_id,object_key_digest,attempt_number);

CREATE TRIGGER billing_migration_repair_invalidations_immutable BEFORE UPDATE OR DELETE ON billing_migration_repair_invalidations FOR EACH ROW EXECUTE FUNCTION reject_billing_migration_immutable_change();
CREATE TRIGGER billing_migration_credential_removals_immutable BEFORE UPDATE OR DELETE ON billing_migration_credential_removals FOR EACH ROW EXECUTE FUNCTION reject_billing_migration_immutable_change();
CREATE TRIGGER billing_migration_legal_holds_immutable BEFORE UPDATE OR DELETE ON billing_migration_legal_hold_commands FOR EACH ROW EXECUTE FUNCTION reject_billing_migration_immutable_change();
CREATE TRIGGER billing_migration_legal_hold_proposals_immutable_delete BEFORE DELETE ON billing_migration_legal_hold_proposals FOR EACH ROW EXECUTE FUNCTION reject_billing_migration_immutable_change();
CREATE TRIGGER billing_migration_legal_hold_proposals_update BEFORE UPDATE ON billing_migration_legal_hold_proposals FOR EACH ROW EXECUTE FUNCTION enforce_billing_migration_legal_hold_proposal_update();
CREATE TRIGGER billing_migration_legal_hold_environment BEFORE INSERT OR UPDATE ON billing_migration_legal_hold_commands FOR EACH ROW EXECUTE FUNCTION enforce_billing_migration_legal_hold_environment();

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN
    IF EXISTS(SELECT 1 FROM billing_migration_repair_invalidations)
       OR EXISTS(SELECT 1 FROM billing_migration_credential_removals)
       OR EXISTS(SELECT 1 FROM billing_migration_legal_hold_commands)
       OR EXISTS(SELECT 1 FROM billing_migration_legal_hold_proposals)
       OR EXISTS(SELECT 1 FROM billing_migration_completion_reports)
       OR EXISTS(SELECT 1 FROM billing_migration_retention_jobs)
       OR EXISTS(SELECT 1 FROM billing_migration_object_deletions)
       OR EXISTS(SELECT 1 FROM billing_migration_repair_previews)
       OR EXISTS(SELECT 1 FROM billing_migration_repair_executions)
       OR EXISTS(SELECT 1 FROM billing_migration_repair_reservations) THEN
        RAISE EXCEPTION 'cannot downgrade: Phase 9C repair, completion, or retention evidence exists' USING ERRCODE='55000';
    END IF;
END $$;
-- +goose StatementEnd
DROP TRIGGER billing_migration_legal_holds_immutable ON billing_migration_legal_hold_commands;
DROP TRIGGER billing_migration_legal_hold_environment ON billing_migration_legal_hold_commands;
DROP TRIGGER billing_migration_legal_hold_proposals_immutable_delete ON billing_migration_legal_hold_proposals;
DROP TRIGGER billing_migration_legal_hold_proposals_update ON billing_migration_legal_hold_proposals;
DROP TRIGGER billing_migration_credential_removals_immutable ON billing_migration_credential_removals;
DROP TRIGGER billing_migration_repair_invalidations_immutable ON billing_migration_repair_invalidations;
DROP TABLE billing_migration_legal_hold_commands;
DROP TABLE billing_migration_legal_hold_proposals;
DROP FUNCTION enforce_billing_migration_legal_hold_environment();
DROP FUNCTION enforce_billing_migration_legal_hold_proposal_update();
DROP TABLE billing_migration_credential_removals;
DROP TABLE billing_migration_repair_invalidations;
DROP TABLE billing_migration_repair_reservations;
ALTER TABLE billing_migration_object_deletions DROP CONSTRAINT billing_migration_object_deletions_identity_unique, DROP CONSTRAINT billing_migration_object_deletions_attempt, DROP CONSTRAINT billing_migration_object_deletions_job_fk, DROP COLUMN attempt_number, DROP COLUMN retention_job_id, DROP CONSTRAINT billing_migration_object_deletions_deletion_result_check, ADD CONSTRAINT billing_migration_object_deletions_deletion_result_check CHECK(deletion_result IN ('deleted','not_found','failed','legal_hold'));
ALTER TABLE billing_migration_retention_jobs DROP COLUMN original_due_at, DROP CONSTRAINT billing_migration_retention_error_shape, DROP CONSTRAINT billing_migration_retention_program_unique, DROP CONSTRAINT billing_migration_retention_due, DROP CONSTRAINT billing_migration_retention_identity_digest, DROP CONSTRAINT billing_migration_retention_completion_fk, DROP COLUMN deletion_identity, DROP COLUMN last_error_code, DROP COLUMN max_attempts, DROP COLUMN attempt_count, DROP COLUMN completion_report_id;
ALTER TABLE billing_migration_completion_reports DROP CONSTRAINT billing_migration_completion_credential_removed_before_completion, DROP CONSTRAINT billing_migration_completion_policy_digest, DROP CONSTRAINT billing_migration_completion_stability_digest, DROP CONSTRAINT billing_migration_completion_authority_digest, DROP COLUMN completion_policy_digest, DROP COLUMN stability_evidence_digest, DROP COLUMN authority_digest, ADD CHECK(credential_removed_at>=rollback_window_ended_at);
ALTER TABLE billing_migration_repair_executions DROP CONSTRAINT billing_migration_repair_executions_preview_attempt_unique, DROP CONSTRAINT billing_migration_repair_executions_error_shape, DROP CONSTRAINT billing_migration_repair_executions_after_digest, DROP CONSTRAINT billing_migration_repair_executions_before_digest, DROP CONSTRAINT billing_migration_repair_executions_request_digest, DROP CONSTRAINT billing_migration_repair_executions_attempt, DROP COLUMN error_code, DROP COLUMN actual_after_digest, DROP COLUMN actual_before_digest, DROP COLUMN request_digest, DROP COLUMN attempt_number;
ALTER TABLE billing_migration_repair_previews DROP CONSTRAINT billing_migration_repair_previews_expiry, DROP CONSTRAINT billing_migration_repair_previews_reason, DROP CONSTRAINT billing_migration_repair_previews_scope_digest, DROP CONSTRAINT billing_migration_repair_previews_policy_digest, DROP CONSTRAINT billing_migration_repair_previews_case_digest, DROP CONSTRAINT billing_migration_repair_previews_state_version, DROP COLUMN expires_at, DROP COLUMN reason, DROP COLUMN expected_scope_digest, DROP COLUMN expected_policy_digest, DROP COLUMN expected_case_digest, DROP COLUMN expected_program_state_version, DROP CONSTRAINT billing_migration_repair_previews_repair_kind_check, ADD CONSTRAINT billing_migration_repair_previews_repair_kind_check CHECK(repair_kind IN ('provider_revalidate','projection_replay','attach_proven_alias','replace_mapping_set','retry_quarantined_record'));
ALTER TABLE billing_migration_cases DROP CONSTRAINT billing_migration_cases_source_record_fk, DROP CONSTRAINT billing_migration_cases_divergence_fk, DROP CONSTRAINT billing_migration_cases_resolution_shape, DROP COLUMN linked_source_record_id, DROP COLUMN linked_divergence_id, DROP COLUMN updated_at;
ALTER TABLE billing_migration_divergences DROP CONSTRAINT billing_migration_divergences_scope_unique;
