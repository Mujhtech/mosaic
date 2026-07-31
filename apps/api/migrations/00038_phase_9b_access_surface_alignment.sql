-- Phase 9B: align the access surfaces with the frozen draft contracts.
--
-- Batch 1 landed the token and webhook schemas before the three 9B contracts
-- were frozen. Two vocabularies drifted apart in that window, and one delivery
-- concept was missing entirely:
--
--  1. Customer Access Token Contract v1 names the audience `sdk_sync` and the
--     scopes `entitlements.read` / `entitlements.sync` / `restore.request`.
--     Migration 00035 shipped `sdk_entitlement_sync` and `entitlements:read`.
--     Storing a different vocabulary from the one on the wire would put a
--     translation table between the token row and the contract, and a
--     translation table is a place two vocabularies can silently disagree — so
--     storage adopts the contract's words instead.
--  2. The contract requires a revocation reason on every revoked token. There
--     was no column for one, so a revoked token could not explain itself.
--  3. Delivery attempts were modelled, but the delivery itself — the retryable,
--     leasable unit of work per (event, destination) — was not. Attempts are
--     append-only history; the delivery is the mutable state machine that
--     produces them.

-- +goose Up

-- 1 + 2: token vocabulary and revocation reason.
ALTER TABLE customer_access_tokens
    DROP CONSTRAINT customer_access_tokens_audience_check;
UPDATE customer_access_tokens SET audience = 'sdk_sync' WHERE audience = 'sdk_entitlement_sync';
UPDATE customer_access_tokens
    SET scopes = ARRAY(SELECT replace(scope, ':', '.') FROM unnest(scopes) AS scope);
ALTER TABLE customer_access_tokens
    ADD CONSTRAINT customer_access_tokens_audience_check
        CHECK (audience IN ('sdk_sync', 'server_check')),
    ALTER COLUMN scopes SET DEFAULT ARRAY['entitlements.read']::text[],
    ADD CONSTRAINT customer_access_tokens_scope_vocabulary_check CHECK (
        scopes <@ ARRAY['entitlements.read', 'entitlements.sync', 'restore.request']::text[]
    ),
    ADD COLUMN revocation_reason text CHECK (revocation_reason IS NULL OR revocation_reason IN (
        'customer_signed_out', 'identity_changed', 'operator_revoked', 'customer_deleted',
        'key_rotated', 'suspected_compromise', 'superseded_by_new_token'
    )),
    ADD CONSTRAINT customer_access_tokens_revocation_pairing_check
        CHECK ((revoked_at IS NULL) = (revocation_reason IS NULL));

-- 3: the delivery state machine. One row per (event, destination); attempts
-- hang off it as append-only history.
CREATE TABLE webhook_deliveries (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    webhook_event_id text NOT NULL,
    webhook_destination_id text NOT NULL,
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'succeeded', 'failed', 'exhausted', 'skipped')),
    skipped_reason text CHECK (skipped_reason IS NULL OR skipped_reason IN (
        'destination_disabled', 'event_type_not_enabled', 'destination_deleted', 'tenant_suspended'
    )),
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    max_attempts integer NOT NULL DEFAULT 8 CHECK (max_attempts BETWEEN 1 AND 32),
    next_attempt_at timestamptz,
    leased_by text,
    leased_until timestamptz,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    completed_at timestamptz,
    UNIQUE (id, project_id),
    -- At-least-once delivery of one event to one destination is one delivery.
    -- A replay reuses this row and appends a further attempt, which is what
    -- keeps the event id stable across every retry and every manual replay.
    UNIQUE (webhook_event_id, webhook_destination_id),
    FOREIGN KEY (environment_id, project_id)
        REFERENCES environments(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (webhook_event_id, project_id)
        REFERENCES webhook_events(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (webhook_destination_id, project_id)
        REFERENCES webhook_destinations(id, project_id) ON DELETE RESTRICT,
    CHECK ((status = 'skipped') = (skipped_reason IS NOT NULL)),
    -- Terminal states schedule nothing.
    CHECK (status = 'pending' OR next_attempt_at IS NULL),
    CHECK ((status = 'pending') = (completed_at IS NULL))
);
CREATE INDEX webhook_deliveries_queue_idx
    ON webhook_deliveries(next_attempt_at, id) WHERE status = 'pending';
CREATE INDEX webhook_deliveries_destination_idx
    ON webhook_deliveries(webhook_destination_id, created_at DESC, id);
CREATE INDEX webhook_deliveries_environment_idx
    ON webhook_deliveries(environment_id, status, created_at DESC);

-- Attempt history gains the members the delivery contract records.
ALTER TABLE webhook_delivery_attempts
    DROP CONSTRAINT webhook_delivery_attempts_outcome_check;
ALTER TABLE webhook_delivery_attempts
    ADD CONSTRAINT webhook_delivery_attempts_outcome_check CHECK (outcome IN (
        'delivered', 'retryable_failure', 'permanent_failure', 'exhausted', 'skipped'
    )),
    ADD COLUMN webhook_delivery_id text,
    ADD COLUMN max_attempts integer NOT NULL DEFAULT 8 CHECK (max_attempts BETWEEN 1 AND 32),
    ADD COLUMN responded_at timestamptz,
    ADD COLUMN next_attempt_at timestamptz,
    -- Bounded, control-character-free, and never parsed: it exists so an
    -- integrator can see why their own endpoint refused, and for nothing else.
    ADD COLUMN response_excerpt text CHECK (
        response_excerpt IS NULL
        OR (length(response_excerpt) <= 240 AND response_excerpt !~ '[[:cntrl:]]')
    ),
    ADD COLUMN skipped_reason text CHECK (skipped_reason IS NULL OR skipped_reason IN (
        'destination_disabled', 'event_type_not_enabled', 'destination_deleted', 'tenant_suspended'
    )),
    ADD CONSTRAINT webhook_delivery_attempts_delivery_fkey
        FOREIGN KEY (webhook_delivery_id, project_id)
        REFERENCES webhook_deliveries(id, project_id) ON DELETE RESTRICT,
    -- Exhaustion is terminal, so it schedules nothing.
    ADD CONSTRAINT webhook_delivery_attempts_exhausted_is_terminal
        CHECK (outcome <> 'exhausted' OR next_attempt_at IS NULL),
    ADD CONSTRAINT webhook_delivery_attempts_skipped_reason_present
        CHECK ((outcome = 'skipped') = (skipped_reason IS NOT NULL));

-- Destinations record when their secret was last rotated so the one-time
-- display is auditable without keeping the secret anywhere.
ALTER TABLE webhook_destinations
    ADD COLUMN secret_last_rotated_at timestamptz,
    ADD COLUMN disabled_reason text CHECK (disabled_reason IS NULL OR (
        btrim(disabled_reason) <> '' AND length(disabled_reason) <= 128
    ));

-- +goose Down
ALTER TABLE webhook_destinations
    DROP COLUMN disabled_reason,
    DROP COLUMN secret_last_rotated_at;

ALTER TABLE webhook_delivery_attempts
    DROP CONSTRAINT webhook_delivery_attempts_skipped_reason_present,
    DROP CONSTRAINT webhook_delivery_attempts_exhausted_is_terminal,
    DROP CONSTRAINT webhook_delivery_attempts_delivery_fkey,
    DROP COLUMN skipped_reason,
    DROP COLUMN response_excerpt,
    DROP COLUMN next_attempt_at,
    DROP COLUMN responded_at,
    DROP COLUMN max_attempts,
    DROP COLUMN webhook_delivery_id,
    DROP CONSTRAINT webhook_delivery_attempts_outcome_check;
ALTER TABLE webhook_delivery_attempts
    ADD CONSTRAINT webhook_delivery_attempts_outcome_check CHECK (outcome IN (
        'delivered', 'retryable_failure', 'permanent_failure', 'exhausted'
    ));

DROP TABLE webhook_deliveries;

ALTER TABLE customer_access_tokens
    DROP CONSTRAINT customer_access_tokens_revocation_pairing_check,
    DROP COLUMN revocation_reason,
    DROP CONSTRAINT customer_access_tokens_scope_vocabulary_check,
    ALTER COLUMN scopes SET DEFAULT ARRAY['entitlements:read']::text[],
    DROP CONSTRAINT customer_access_tokens_audience_check;
UPDATE customer_access_tokens SET audience = 'sdk_entitlement_sync' WHERE audience = 'sdk_sync';
UPDATE customer_access_tokens
    SET scopes = ARRAY(SELECT replace(scope, '.', ':') FROM unnest(scopes) AS scope);
ALTER TABLE customer_access_tokens
    ADD CONSTRAINT customer_access_tokens_audience_check CHECK (audience IN ('sdk_entitlement_sync'));
