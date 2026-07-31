-- Phase 9C Stage 2E Package B: authority-transition notifications, Billing
-- State Webhook v2, and stable-event migration redelivery.

-- +goose Up
ALTER TABLE webhook_destinations
    ADD COLUMN contract_version integer NOT NULL DEFAULT 1
        CHECK (contract_version IN (1, 2)),
    ADD COLUMN last_successful_test_at timestamptz;

ALTER TABLE webhook_deliveries
    ADD COLUMN leased_destination_config_digest bytea
        CHECK (leased_destination_config_digest IS NULL OR octet_length(leased_destination_config_digest)=32);

-- +goose StatementBegin
CREATE FUNCTION webhook_destination_config_digest(destination_id text, owner_project_id text) RETURNS bytea LANGUAGE sql STABLE AS $$
    SELECT sha256(convert_to(jsonb_build_object(
        'url',d.url,
        'status',d.status,
        'eventTypes',d.event_types,
        'contractVersion',d.contract_version,
        'updatedAt',d.updated_at,
        'signingSecrets',COALESCE((
            SELECT jsonb_agg(jsonb_build_array(
                s.id,s.status,encode(s.fingerprint,'hex'),s.honored_until
            ) ORDER BY s.id)
            FROM webhook_signing_secrets s
            WHERE s.webhook_destination_id=d.id AND s.project_id=d.project_id
        ),'[]'::jsonb)
    )::text,'UTF8'))
    FROM webhook_destinations d
    WHERE d.id=destination_id AND d.project_id=owner_project_id
$$;
-- +goose StatementEnd

ALTER TABLE webhook_events
    DROP CONSTRAINT webhook_events_event_type_check,
    DROP CONSTRAINT webhook_events_customer_entitlement_snapshot_id_event_type_key,
    DROP CONSTRAINT webhook_events_customer_entitlement_snapshot_id_project_id_fkey,
    DROP CONSTRAINT webhook_events_snapshot_version_check,
    ALTER COLUMN customer_entitlement_snapshot_id DROP NOT NULL,
    ADD COLUMN contract_version integer NOT NULL DEFAULT 1
        CHECK (contract_version IN (1, 2)),
    ADD COLUMN payload_bytes bytea,
    ADD COLUMN payload_digest bytea,
    ADD COLUMN authority_scope_id text,
    ADD COLUMN authority_epoch bigint,
    ADD COLUMN authority_kind text,
    ADD COLUMN transition_state text,
    ADD COLUMN correlation_id text,
    ADD COLUMN snapshot_authority_digest bytea,
    ADD COLUMN transition_outbox_id text,
    ADD CONSTRAINT webhook_events_event_type_check CHECK (event_type IN (
        'customer.entitlements.changed', 'authority.cutover.pending',
        'authority.cutover.completed', 'authority.rollback.completed',
        'authority.stabilization.completed')),
    ADD CONSTRAINT webhook_events_snapshot_version_check CHECK (snapshot_version >= 0),
    ADD CONSTRAINT webhook_events_snapshot_fk FOREIGN KEY
        (customer_entitlement_snapshot_id, project_id)
        REFERENCES customer_entitlement_snapshots(id, project_id) ON DELETE RESTRICT,
    ADD CONSTRAINT webhook_events_authority_scope_fk FOREIGN KEY
        (authority_scope_id, project_id)
        REFERENCES billing_migration_authority_scopes(id, project_id) ON DELETE RESTRICT;

UPDATE webhook_events
SET payload_bytes = convert_to(payload::text, 'UTF8'),
    payload_digest = sha256(convert_to(payload::text, 'UTF8'));

-- +goose StatementBegin
CREATE FUNCTION normalize_webhook_event_payload_bytes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.payload_bytes IS NULL THEN
        NEW.payload_bytes := convert_to(NEW.payload::text, 'UTF8');
    END IF;
    IF NEW.payload_digest IS NULL THEN
        NEW.payload_digest := sha256(NEW.payload_bytes);
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER webhook_events_payload_bytes
BEFORE INSERT ON webhook_events
FOR EACH ROW EXECUTE FUNCTION normalize_webhook_event_payload_bytes();

ALTER TABLE webhook_events
    ALTER COLUMN payload_bytes SET NOT NULL,
    ALTER COLUMN payload_digest SET NOT NULL,
    ADD CONSTRAINT webhook_events_payload_bytes_size
        CHECK (octet_length(payload_bytes) BETWEEN 2 AND 65536),
    ADD CONSTRAINT webhook_events_payload_digest_size
        CHECK (octet_length(payload_digest) = 32),
    ADD CONSTRAINT webhook_events_payload_digest_matches
        CHECK (payload_digest = sha256(payload_bytes)),
    ADD CONSTRAINT webhook_events_contract_shape CHECK (
        (contract_version = 1
         AND event_type = 'customer.entitlements.changed'
         AND customer_entitlement_snapshot_id IS NOT NULL
         AND snapshot_version >= 1
         AND authority_scope_id IS NULL AND authority_epoch IS NULL
         AND authority_kind IS NULL AND transition_state IS NULL
         AND correlation_id IS NULL AND snapshot_authority_digest IS NULL
         AND transition_outbox_id IS NULL)
        OR
        (contract_version = 2
         AND authority_scope_id IS NOT NULL AND authority_epoch IS NOT NULL
         AND authority_epoch >= 0
         AND authority_kind IN ('source','mosaic','source_rollback')
         AND transition_state IN ('stable','cutover_pending','stabilizing','rolled_back')
         AND btrim(correlation_id) <> ''
         AND octet_length(snapshot_authority_digest) = 32
         AND ((snapshot_version = 0 AND customer_entitlement_snapshot_id IS NULL)
              OR (snapshot_version >= 1 AND customer_entitlement_snapshot_id IS NOT NULL))
         AND (
             (event_type = 'customer.entitlements.changed') OR
             (event_type = 'authority.cutover.pending' AND authority_kind = 'source' AND transition_state = 'cutover_pending') OR
             (event_type = 'authority.cutover.completed' AND authority_kind = 'mosaic' AND transition_state = 'stabilizing') OR
             (event_type = 'authority.rollback.completed' AND authority_kind = 'source_rollback' AND transition_state = 'rolled_back') OR
             (event_type = 'authority.stabilization.completed' AND authority_kind = 'mosaic' AND transition_state = 'stable')
         ))
    );
CREATE UNIQUE INDEX webhook_events_snapshot_event_unique
    ON webhook_events(customer_entitlement_snapshot_id,event_type);
CREATE UNIQUE INDEX webhook_events_transition_customer_unique
    ON webhook_events(transition_outbox_id,billing_customer_id)
    WHERE transition_outbox_id IS NOT NULL;

ALTER TABLE billing_migration_transition_outbox
    DROP CONSTRAINT billing_migration_transition_outbox_event_kind_check,
    DROP CONSTRAINT billing_migration_transition_outbox_authority_epoch_check,
    DROP CONSTRAINT billing_migration_transition_outbox_transition_id_fkey,
    ALTER COLUMN transition_id DROP NOT NULL,
    ADD COLUMN checkpoint_id text,
    ADD COLUMN completion_report_id text,
    ADD COLUMN correlation_id text,
    ADD COLUMN due_at timestamptz,
    ADD COLUMN lease_generation bigint NOT NULL DEFAULT 0 CHECK (lease_generation >= 0),
    ADD COLUMN max_attempts integer NOT NULL DEFAULT 8 CHECK (max_attempts BETWEEN 1 AND 32),
    ADD COLUMN last_error_code text,
    ADD COLUMN legacy_event_kind boolean NOT NULL DEFAULT false,
    ADD CONSTRAINT billing_migration_transition_outbox_event_kind_check CHECK (event_kind IN (
        'authority_changed','rollback_changed','cutover_pending','cutover_completed',
        'rollback_completed','stabilization_completed')),
    ADD CONSTRAINT billing_migration_transition_outbox_authority_epoch_check CHECK (authority_epoch >= 0),
    ADD CONSTRAINT billing_migration_transition_outbox_checkpoint_fk FOREIGN KEY
        (checkpoint_id, program_id, project_id)
        REFERENCES billing_migration_checkpoints(id, program_id, project_id) ON DELETE RESTRICT,
    ADD CONSTRAINT billing_migration_transition_outbox_transition_fk FOREIGN KEY
        (transition_id) REFERENCES billing_migration_authority_transitions(id) ON DELETE RESTRICT,
    ADD CONSTRAINT billing_migration_transition_outbox_completion_fk FOREIGN KEY
        (completion_report_id) REFERENCES billing_migration_completion_reports(id) ON DELETE RESTRICT;

UPDATE billing_migration_transition_outbox outbox
SET checkpoint_id = (SELECT c.id FROM billing_migration_checkpoints c
        WHERE c.program_id = outbox.program_id AND c.project_id = outbox.project_id
        ORDER BY c.created_at DESC, c.id DESC LIMIT 1),
    correlation_id = outbox.transition_id,
    due_at = outbox.updated_at,
    legacy_event_kind = true;

-- +goose StatementBegin
CREATE FUNCTION normalize_billing_migration_transition_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.event_kind = 'authority_changed' THEN
        NEW.legacy_event_kind := true;
    ELSIF NEW.event_kind = 'rollback_changed' THEN
        NEW.legacy_event_kind := true;
    END IF;
    IF NEW.checkpoint_id IS NULL THEN
        SELECT c.id INTO NEW.checkpoint_id FROM billing_migration_checkpoints c
        WHERE c.program_id=NEW.program_id AND c.project_id=NEW.project_id
        ORDER BY c.created_at DESC,c.id DESC LIMIT 1;
    END IF;
    NEW.correlation_id := COALESCE(NEW.correlation_id, NEW.transition_id, NEW.completion_report_id, NEW.checkpoint_id);
    NEW.due_at := COALESCE(NEW.due_at, NEW.updated_at, NEW.created_at);
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER billing_migration_transition_outbox_normalize
BEFORE INSERT ON billing_migration_transition_outbox
FOR EACH ROW EXECUTE FUNCTION normalize_billing_migration_transition_outbox();

ALTER TABLE billing_migration_transition_outbox
    ALTER COLUMN checkpoint_id SET NOT NULL,
    ALTER COLUMN correlation_id SET NOT NULL,
    ALTER COLUMN due_at SET NOT NULL,
    ADD CONSTRAINT billing_migration_transition_outbox_correlation_shape CHECK (
        (event_kind = 'cutover_pending' AND transition_id IS NULL AND completion_report_id IS NULL) OR
        (event_kind IN ('authority_changed','rollback_changed','cutover_completed','rollback_completed') AND transition_id IS NOT NULL AND completion_report_id IS NULL) OR
        (event_kind = 'stabilization_completed' AND transition_id IS NULL AND completion_report_id IS NOT NULL)),
    ADD CONSTRAINT billing_migration_transition_outbox_running_lease CHECK (
        (status = 'running') = (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)),
    ADD CONSTRAINT billing_migration_transition_outbox_logical_identity UNIQUE
        (program_id, authority_scope_id, event_kind, correlation_id);

DROP INDEX billing_migration_transition_outbox_claim_idx;
CREATE INDEX billing_migration_transition_outbox_claim_idx
    ON billing_migration_transition_outbox(due_at,id)
    WHERE status IN ('pending','running');

ALTER TABLE webhook_events
    ADD CONSTRAINT webhook_events_transition_outbox_fk FOREIGN KEY (transition_outbox_id)
        REFERENCES billing_migration_transition_outbox(id) ON DELETE RESTRICT;

CREATE TABLE billing_migration_webhook_redeliveries (
    id text PRIMARY KEY,
    program_id text NOT NULL,
    project_id text NOT NULL,
    webhook_event_id text NOT NULL,
    webhook_destination_id text NOT NULL,
    webhook_delivery_id text NOT NULL,
    idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
    request_digest bytea NOT NULL CHECK (octet_length(request_digest) = 32),
    expected_state_version bigint NOT NULL CHECK (expected_state_version >= 1),
    expected_event_digest bytea NOT NULL CHECK (octet_length(expected_event_digest) = 32),
    reason text NOT NULL CHECK (btrim(reason) <> '' AND length(reason) <= 500 AND reason !~ '[[:cntrl:]]'),
    actor_id text NOT NULL,
    created_at timestamptz NOT NULL,
    UNIQUE(program_id,idempotency_key),
    UNIQUE(id,program_id,project_id),
    FOREIGN KEY(program_id,project_id) REFERENCES billing_migration_programs(id,project_id) ON DELETE RESTRICT,
    FOREIGN KEY(webhook_event_id,project_id) REFERENCES webhook_events(id,project_id) ON DELETE RESTRICT,
    FOREIGN KEY(webhook_destination_id,project_id) REFERENCES webhook_destinations(id,project_id) ON DELETE RESTRICT,
    FOREIGN KEY(webhook_delivery_id,project_id) REFERENCES webhook_deliveries(id,project_id) ON DELETE RESTRICT
);
CREATE TRIGGER billing_migration_webhook_redeliveries_immutable
BEFORE UPDATE OR DELETE ON billing_migration_webhook_redeliveries
FOR EACH ROW EXECUTE FUNCTION reject_billing_migration_immutable_change();

-- +goose Down
-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM webhook_destinations WHERE contract_version = 2 OR last_successful_test_at IS NOT NULL)
       OR EXISTS (SELECT 1 FROM webhook_events WHERE contract_version = 2)
       OR EXISTS (SELECT 1 FROM billing_migration_transition_outbox WHERE NOT legacy_event_kind)
       OR EXISTS (SELECT 1 FROM billing_migration_webhook_redeliveries) THEN
        RAISE EXCEPTION 'cannot downgrade: Billing State Webhook v2 evidence exists' USING ERRCODE='55000';
    END IF;
END;
$$;
-- +goose StatementEnd

DROP TRIGGER billing_migration_webhook_redeliveries_immutable ON billing_migration_webhook_redeliveries;
DROP TABLE billing_migration_webhook_redeliveries;
ALTER TABLE webhook_deliveries DROP COLUMN leased_destination_config_digest;
DROP FUNCTION webhook_destination_config_digest(text,text);
ALTER TABLE webhook_events DROP CONSTRAINT webhook_events_transition_outbox_fk;
DROP INDEX webhook_events_transition_customer_unique;
DROP INDEX webhook_events_snapshot_event_unique;
DROP TRIGGER webhook_events_payload_bytes ON webhook_events;
DROP FUNCTION normalize_webhook_event_payload_bytes();
DROP INDEX billing_migration_transition_outbox_claim_idx;
ALTER TABLE billing_migration_transition_outbox
    DROP CONSTRAINT billing_migration_transition_outbox_logical_identity,
    DROP CONSTRAINT billing_migration_transition_outbox_running_lease,
    DROP CONSTRAINT billing_migration_transition_outbox_correlation_shape,
    ALTER COLUMN checkpoint_id DROP NOT NULL,
    ALTER COLUMN correlation_id DROP NOT NULL,
    ALTER COLUMN due_at DROP NOT NULL;
DROP TRIGGER billing_migration_transition_outbox_normalize ON billing_migration_transition_outbox;
DROP FUNCTION normalize_billing_migration_transition_outbox();
ALTER TABLE billing_migration_transition_outbox
    DROP CONSTRAINT billing_migration_transition_outbox_completion_fk,
    DROP CONSTRAINT billing_migration_transition_outbox_transition_fk,
    DROP CONSTRAINT billing_migration_transition_outbox_checkpoint_fk,
    DROP CONSTRAINT billing_migration_transition_outbox_event_kind_check,
    DROP CONSTRAINT billing_migration_transition_outbox_authority_epoch_check,
    DROP COLUMN legacy_event_kind,
    DROP COLUMN last_error_code,
    DROP COLUMN max_attempts,
    DROP COLUMN lease_generation,
    DROP COLUMN due_at,
    DROP COLUMN correlation_id,
    DROP COLUMN completion_report_id,
    DROP COLUMN checkpoint_id,
    ALTER COLUMN transition_id SET NOT NULL,
    ADD CONSTRAINT billing_migration_transition_outbox_event_kind_check
        CHECK(event_kind IN ('authority_changed','rollback_changed')),
    ADD CONSTRAINT billing_migration_transition_outbox_authority_epoch_check CHECK (authority_epoch >= 1),
    ADD CONSTRAINT billing_migration_transition_outbox_transition_id_fkey
        FOREIGN KEY(transition_id) REFERENCES billing_migration_authority_transitions(id) ON DELETE RESTRICT;
CREATE INDEX billing_migration_transition_outbox_claim_idx
    ON billing_migration_transition_outbox(updated_at,id) WHERE status IN ('pending','running');

ALTER TABLE webhook_events
    DROP CONSTRAINT webhook_events_contract_shape,
    DROP CONSTRAINT webhook_events_payload_digest_matches,
    DROP CONSTRAINT webhook_events_payload_digest_size,
    DROP CONSTRAINT webhook_events_payload_bytes_size,
    DROP CONSTRAINT webhook_events_authority_scope_fk,
    DROP CONSTRAINT webhook_events_snapshot_fk,
    DROP CONSTRAINT webhook_events_snapshot_version_check,
    DROP CONSTRAINT webhook_events_event_type_check,
    DROP COLUMN transition_outbox_id,
    DROP COLUMN snapshot_authority_digest,
    DROP COLUMN correlation_id,
    DROP COLUMN transition_state,
    DROP COLUMN authority_kind,
    DROP COLUMN authority_epoch,
    DROP COLUMN authority_scope_id,
    DROP COLUMN payload_digest,
    DROP COLUMN payload_bytes,
    DROP COLUMN contract_version,
    ALTER COLUMN customer_entitlement_snapshot_id SET NOT NULL,
    ADD CONSTRAINT webhook_events_event_type_check CHECK (event_type IN ('customer.entitlements.changed')),
    ADD CONSTRAINT webhook_events_snapshot_version_check CHECK (snapshot_version >= 1),
    ADD CONSTRAINT webhook_events_customer_entitlement_snapshot_id_project_id_fkey FOREIGN KEY
        (customer_entitlement_snapshot_id, project_id)
        REFERENCES customer_entitlement_snapshots(id, project_id) ON DELETE RESTRICT,
    ADD CONSTRAINT webhook_events_customer_entitlement_snapshot_id_event_type_key
        UNIQUE (customer_entitlement_snapshot_id,event_type);
ALTER TABLE webhook_destinations
    DROP COLUMN last_successful_test_at,
    DROP COLUMN contract_version;
