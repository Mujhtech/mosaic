-- Phase 9A: Raw Billing Inputs, Validation Attempts, and the validation queue.
--
-- Intake never validates inline. Both stores punish a slow or failing endpoint
-- (Apple retries a V2 notification five times in production and never in
-- sandbox; Pub/Sub redelivers aggressively), so the intake contract is
-- authenticate -> persist -> enqueue -> 2xx, and every provider call happens in
-- the worker against these rows.
--
-- Raw inputs are the replay substrate: the whole pipeline must be a pure
-- function of billing_raw_inputs plus Product-mapping history plus provider API
-- responses. Nothing downstream may hold state that cannot be rebuilt from them.

-- +goose Up

CREATE TABLE billing_raw_inputs (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    organization_id text NOT NULL,
    environment_id text NOT NULL,
    environment_mode text NOT NULL CHECK (environment_mode IN ('development', 'staging', 'production')),
    -- Resolved lazily: a notification names an Application by bundle id or
    -- package name, and a mismatch is a quarantine outcome rather than a
    -- rejection, so the column stays nullable.
    application_id text,
    credential_id text,
    provider text NOT NULL CHECK (provider IN ('app_store', 'google_play')),
    source text NOT NULL CHECK (source IN (
        'apple_notification', 'apple_notification_history', 'apple_transaction_history',
        'google_rtdn', 'google_token_requery',
        'client_observation', 'trusted_server_observation'
    )),
    source_authority text NOT NULL CHECK (source_authority IN (
        'store_notification', 'store_reconciliation',
        'client_observation', 'trusted_server_observation'
    )),
    -- Provider-assigned identity of the delivery (Apple notificationUUID,
    -- Pub/Sub messageId, client submissionId). Kept for operator display; the
    -- deduplication key is idempotency_key.
    provider_event_id text CHECK (provider_event_id IS NULL OR (btrim(provider_event_id) <> '' AND length(provider_event_id) <= 256)),
    idempotency_key bytea NOT NULL CHECK (octet_length(idempotency_key) = 32),
    content_digest bytea NOT NULL CHECK (octet_length(content_digest) = 32),
    -- SHA-256 of the transaction reference the input points at: the Apple
    -- transaction id or the Google purchase token. This is the RTDN-to-
    -- observation attribution join and never the raw value.
    transaction_reference_digest bytea CHECK (
        transaction_reference_digest IS NULL OR octet_length(transaction_reference_digest) = 32
    ),
    -- Encrypted body. Sealed only after the tenant is known; an input that
    -- cannot be attributed is never persisted with a plaintext body.
    body_state text NOT NULL CHECK (body_state IN ('stored', 'not_retained', 'expired')),
    envelope_version integer CHECK (envelope_version IS NULL OR envelope_version = 1),
    algorithm text CHECK (algorithm IS NULL OR algorithm = 'AES-256-GCM'),
    key_id text CHECK (key_id IS NULL OR (length(key_id) BETWEEN 1 AND 64 AND key_id ~ '^[ -~]+$')),
    nonce bytea CHECK (nonce IS NULL OR octet_length(nonce) = 12),
    ciphertext bytea CHECK (ciphertext IS NULL OR octet_length(ciphertext) >= 16),
    fingerprint bytea CHECK (fingerprint IS NULL OR octet_length(fingerprint) = 32),
    envelope_rotated_at timestamptz,
    authentication_result text NOT NULL CHECK (authentication_result IN (
        'verified_signature', 'verified_transport', 'unauthenticated_client', 'failed'
    )),
    store_environment text NOT NULL CHECK (store_environment IN ('sandbox', 'production', 'unclassified')),
    notification_kind text CHECK (notification_kind IS NULL OR (btrim(notification_kind) <> '' AND length(notification_kind) <= 64)),
    notification_subtype text CHECK (notification_subtype IS NULL OR (btrim(notification_subtype) <> '' AND length(notification_subtype) <= 64)),
    ingestion_status text NOT NULL CHECK (ingestion_status IN (
        'accepted', 'duplicate', 'conflicted', 'quarantined'
    )),
    correlation_id text NOT NULL CHECK (btrim(correlation_id) <> '' AND length(correlation_id) <= 128),
    -- The store's own timestamp and Mosaic's receive timestamp are always kept
    -- apart: an older event that arrives after a newer one is never discarded,
    -- and ordering semantics are deliberately out of Phase 9A scope.
    provider_occurred_at timestamptz,
    received_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    UNIQUE (id, project_id),
    UNIQUE (project_id, provider, idempotency_key),
    FOREIGN KEY (project_id, organization_id)
        REFERENCES projects(id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (environment_id, project_id, environment_mode)
        REFERENCES environments(id, project_id, mode) ON DELETE RESTRICT,
    FOREIGN KEY (application_id, project_id)
        REFERENCES applications(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (credential_id, project_id, provider)
        REFERENCES store_server_credentials(id, project_id, provider) ON DELETE RESTRICT,
    CONSTRAINT billing_raw_inputs_envelope_shape_check CHECK (
        (body_state = 'stored') = (
            envelope_version IS NOT NULL AND algorithm IS NOT NULL AND key_id IS NOT NULL AND
            nonce IS NOT NULL AND ciphertext IS NOT NULL AND fingerprint IS NOT NULL
        )
    ),
    CHECK (expires_at >= received_at)
);
CREATE INDEX billing_raw_inputs_environment_idx
    ON billing_raw_inputs(environment_id, received_at DESC, id);
CREATE INDEX billing_raw_inputs_reference_idx
    ON billing_raw_inputs(environment_id, transaction_reference_digest, received_at DESC)
    WHERE transaction_reference_digest IS NOT NULL;
CREATE INDEX billing_raw_inputs_retention_idx
    ON billing_raw_inputs(expires_at, id)
    WHERE body_state = 'stored';
CREATE INDEX billing_raw_inputs_key_rotation_idx
    ON billing_raw_inputs(key_id, id)
    WHERE body_state = 'stored';

-- Raw inputs are append-only with two deliberate exceptions, both of which are
-- schema-level rather than application-level trust:
--
--   * DELETE is permitted, because the retention job is the only path that
--     removes an expired body and Phase 6 established the same shape for
--     analytics_events.
--   * UPDATE is permitted only when nothing but the encryption envelope
--     changed, so `keyring rotate` can reseal a body under a new key without
--     being able to alter what the body says, and so the retention job can drop
--     an expired body by clearing the envelope. The one permitted body_state
--     transition is 'stored' -> 'expired'; nothing can move the other way, so a
--     body that has aged out cannot be reinstated with different content.
-- +goose StatementBegin
CREATE FUNCTION reject_billing_raw_input_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.body_state IS DISTINCT FROM OLD.body_state
        AND NOT (OLD.body_state = 'stored' AND NEW.body_state = 'expired')
    THEN
        RAISE EXCEPTION 'billing raw input body state may only move from stored to expired'
            USING ERRCODE = '55000';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.project_id IS DISTINCT FROM OLD.project_id
        OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
        OR NEW.environment_id IS DISTINCT FROM OLD.environment_id
        OR NEW.environment_mode IS DISTINCT FROM OLD.environment_mode
        OR NEW.application_id IS DISTINCT FROM OLD.application_id
        OR NEW.credential_id IS DISTINCT FROM OLD.credential_id
        OR NEW.provider IS DISTINCT FROM OLD.provider
        OR NEW.source IS DISTINCT FROM OLD.source
        OR NEW.source_authority IS DISTINCT FROM OLD.source_authority
        OR NEW.provider_event_id IS DISTINCT FROM OLD.provider_event_id
        OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
        OR NEW.content_digest IS DISTINCT FROM OLD.content_digest
        OR NEW.transaction_reference_digest IS DISTINCT FROM OLD.transaction_reference_digest
        OR NEW.authentication_result IS DISTINCT FROM OLD.authentication_result
        OR NEW.store_environment IS DISTINCT FROM OLD.store_environment
        OR NEW.notification_kind IS DISTINCT FROM OLD.notification_kind
        OR NEW.notification_subtype IS DISTINCT FROM OLD.notification_subtype
        OR NEW.ingestion_status IS DISTINCT FROM OLD.ingestion_status
        OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id
        OR NEW.provider_occurred_at IS DISTINCT FROM OLD.provider_occurred_at
        OR NEW.received_at IS DISTINCT FROM OLD.received_at
        OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
    THEN
        RAISE EXCEPTION 'billing raw inputs are append-only outside encryption-key rotation'
            USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER billing_raw_inputs_append_only BEFORE UPDATE ON billing_raw_inputs
FOR EACH ROW EXECUTE FUNCTION reject_billing_raw_input_mutation();

CREATE TABLE billing_validation_attempts (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    raw_input_id text NOT NULL,
    credential_id text,
    attempt_number integer NOT NULL CHECK (attempt_number >= 1),
    validator_version integer NOT NULL CHECK (validator_version >= 1),
    started_at timestamptz NOT NULL,
    completed_at timestamptz NOT NULL,
    outcome text NOT NULL CHECK (outcome IN (
        'validated', 'recorded_no_fact', 'quarantined', 'retryable_failure', 'permanently_failed'
    )),
    retryable boolean NOT NULL,
    failure_category text CHECK (failure_category IS NULL OR failure_category IN (
        'transient', 'rate_limited', 'auth', 'quota', 'not_found_retryable',
        'not_found_terminal', 'invalid', 'signature', 'resolution', 'configuration'
    )),
    -- Mosaic's own stable taxonomy. Provider response bodies are never stored.
    diagnostic_code text CHECK (diagnostic_code IS NULL OR (btrim(diagnostic_code) <> '' AND length(diagnostic_code) <= 128)),
    -- The provider's own machine-readable code, bounded to a safe charset.
    provider_code text CHECK (provider_code IS NULL OR (btrim(provider_code) <> '' AND provider_code ~ '^[A-Za-z0-9_.-]{1,128}$')),
    provider_http_status integer CHECK (provider_http_status IS NULL OR provider_http_status BETWEEN 100 AND 599),
    store_environment text NOT NULL CHECK (store_environment IN ('sandbox', 'production', 'unclassified')),
    latency_ms integer NOT NULL CHECK (latency_ms >= 0),
    replay_of_attempt_id text,
    correlation_id text NOT NULL CHECK (btrim(correlation_id) <> '' AND length(correlation_id) <= 128),
    UNIQUE (id, project_id),
    UNIQUE (raw_input_id, attempt_number),
    FOREIGN KEY (raw_input_id, project_id)
        REFERENCES billing_raw_inputs(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (environment_id, project_id)
        REFERENCES environments(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (credential_id, project_id)
        REFERENCES store_server_credentials(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (replay_of_attempt_id, project_id)
        REFERENCES billing_validation_attempts(id, project_id) ON DELETE RESTRICT,
    CHECK (completed_at >= started_at),
    CHECK ((outcome = 'retryable_failure') = retryable)
);
CREATE INDEX billing_validation_attempts_input_idx
    ON billing_validation_attempts(raw_input_id, attempt_number);
CREATE INDEX billing_validation_attempts_environment_idx
    ON billing_validation_attempts(environment_id, started_at DESC, id);

-- +goose StatementBegin
CREATE FUNCTION reject_billing_append_only_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER billing_validation_attempts_append_only
BEFORE UPDATE OR DELETE ON billing_validation_attempts
FOR EACH ROW EXECUTE FUNCTION reject_billing_append_only_change();

-- Validation queue. Same lease/attempt/available_at shape as every other Mosaic
-- worker queue, so the Phase 8 backlog and dead-letter runbooks apply unchanged.
CREATE TABLE billing_validation_jobs (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    raw_input_id text NOT NULL,
    provider text NOT NULL CHECK (provider IN ('app_store', 'google_play')),
    status text NOT NULL CHECK (status IN ('queued', 'leased', 'completed', 'failed')),
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    max_attempts integer NOT NULL DEFAULT 8 CHECK (max_attempts BETWEEN 1 AND 12),
    available_at timestamptz NOT NULL,
    lease_owner text,
    lease_expires_at timestamptz,
    last_error_code text CHECK (last_error_code IS NULL OR (btrim(last_error_code) <> '' AND length(last_error_code) <= 128)),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    UNIQUE (raw_input_id),
    FOREIGN KEY (raw_input_id, project_id)
        REFERENCES billing_raw_inputs(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (environment_id, project_id)
        REFERENCES environments(id, project_id) ON DELETE RESTRICT,
    CHECK ((status = 'leased') = (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL))
);
CREATE INDEX billing_validation_jobs_lease_idx
    ON billing_validation_jobs(available_at, created_at, id)
    WHERE status IN ('queued', 'leased');

-- +goose Down
DROP TABLE billing_validation_jobs;
DROP TRIGGER billing_validation_attempts_append_only ON billing_validation_attempts;
DROP TABLE billing_validation_attempts;
DROP FUNCTION reject_billing_append_only_change();
DROP TRIGGER billing_raw_inputs_append_only ON billing_raw_inputs;
DROP FUNCTION reject_billing_raw_input_mutation();
DROP TABLE billing_raw_inputs;
