-- Phase 9B: application webhooks (plan §3, OD-1(b) minimal slice).
--
-- Only the schema lands in this batch, because the projection transaction must
-- create webhook event rows inside the same commit as the state they announce
-- — an access-change webhook may only exist for state that was committed. The
-- delivery worker, destination management API, and signing implementation are
-- the next batch; ADR-0024 records the signing and SSRF policy they follow.
--
-- Events are destination-independent and immutable, which is what gives
-- consumers a stable event id across retries: a retry is a new delivery
-- attempt, never a new logical event.

-- +goose Up
CREATE TABLE webhook_destinations (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    url text NOT NULL CHECK (url LIKE 'https://%' AND length(url) <= 2048),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'disabled')),
    event_types text[] NOT NULL DEFAULT ARRAY['customer.entitlements.changed']::text[],
    description text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    created_by_actor_id text,
    UNIQUE (id, project_id),
    FOREIGN KEY (environment_id, project_id)
        REFERENCES environments(id, project_id) ON DELETE RESTRICT,
    CHECK (cardinality(event_types) > 0)
);
CREATE INDEX webhook_destinations_environment_idx
    ON webhook_destinations(environment_id, status, id);

-- Signing secrets are sealed with the existing provider-credential envelope
-- under a new v2 AAD SubjectKind (webhook_signing_secret). Several may be
-- active at once so a rotation has an overlap window.
CREATE TABLE webhook_signing_secrets (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    webhook_destination_id text NOT NULL,
    status text NOT NULL CHECK (status IN ('active', 'retired')),
    envelope_version integer NOT NULL,
    algorithm text NOT NULL,
    key_id text NOT NULL,
    nonce bytea NOT NULL,
    ciphertext bytea NOT NULL,
    fingerprint bytea NOT NULL,
    created_at timestamptz NOT NULL,
    retired_at timestamptz,
    UNIQUE (id, project_id),
    FOREIGN KEY (webhook_destination_id, project_id)
        REFERENCES webhook_destinations(id, project_id) ON DELETE RESTRICT,
    CHECK ((status = 'retired') = (retired_at IS NOT NULL))
);
CREATE INDEX webhook_signing_secrets_destination_idx
    ON webhook_signing_secrets(webhook_destination_id, status, created_at DESC);

CREATE TABLE webhook_events (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    event_type text NOT NULL CHECK (event_type IN ('customer.entitlements.changed')),
    billing_customer_id text NOT NULL,
    -- The committed snapshot this event announces. The FK is what makes
    -- "a webhook event for state that was not committed" unrepresentable.
    customer_entitlement_snapshot_id text NOT NULL,
    snapshot_version bigint NOT NULL CHECK (snapshot_version >= 1),
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 65536),
    occurred_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL,
    UNIQUE (id, project_id),
    -- One logical event per committed snapshot: an idempotent re-run of the
    -- projection cannot produce a second announcement of the same state.
    UNIQUE (customer_entitlement_snapshot_id, event_type),
    FOREIGN KEY (environment_id, project_id)
        REFERENCES environments(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (billing_customer_id, project_id)
        REFERENCES billing_customers(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (customer_entitlement_snapshot_id, project_id)
        REFERENCES customer_entitlement_snapshots(id, project_id) ON DELETE RESTRICT
);
CREATE INDEX webhook_events_environment_idx
    ON webhook_events(environment_id, created_at DESC, id);

CREATE TRIGGER webhook_events_append_only
BEFORE UPDATE OR DELETE ON webhook_events
FOR EACH ROW EXECUTE FUNCTION reject_billing_append_only_change();

CREATE TABLE webhook_delivery_attempts (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    webhook_event_id text NOT NULL,
    webhook_destination_id text NOT NULL,
    attempt_number integer NOT NULL CHECK (attempt_number >= 1),
    outcome text NOT NULL CHECK (outcome IN ('delivered', 'retryable_failure', 'permanent_failure', 'exhausted')),
    response_status integer,
    error_code text CHECK (error_code IS NULL OR (btrim(error_code) <> '' AND length(error_code) <= 128)),
    latency_ms integer CHECK (latency_ms IS NULL OR latency_ms >= 0),
    attempted_at timestamptz NOT NULL,
    UNIQUE (id, project_id),
    UNIQUE (webhook_event_id, webhook_destination_id, attempt_number),
    FOREIGN KEY (webhook_event_id, project_id)
        REFERENCES webhook_events(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (webhook_destination_id, project_id)
        REFERENCES webhook_destinations(id, project_id) ON DELETE RESTRICT
);
CREATE INDEX webhook_delivery_attempts_event_idx
    ON webhook_delivery_attempts(webhook_event_id, attempted_at DESC);

CREATE TRIGGER webhook_delivery_attempts_append_only
BEFORE UPDATE OR DELETE ON webhook_delivery_attempts
FOR EACH ROW EXECUTE FUNCTION reject_billing_append_only_change();

-- +goose Down
DROP TRIGGER webhook_delivery_attempts_append_only ON webhook_delivery_attempts;
DROP TABLE webhook_delivery_attempts;
DROP TRIGGER webhook_events_append_only ON webhook_events;
DROP TABLE webhook_events;
DROP TABLE webhook_signing_secrets;
DROP TABLE webhook_destinations;
