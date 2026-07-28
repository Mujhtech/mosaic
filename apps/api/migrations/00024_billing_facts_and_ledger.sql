-- Phase 9A: Transaction Facts, Product Resolutions, and the Billing Event Ledger.
--
-- A Transaction Fact is a provider-independent normalized statement that a
-- store confirmed something happened. It is never a subscription, an
-- entitlement, or an access grant, and Phase 9A creates no table that could
-- become one: there is no customer column, no price or currency column, no
-- subject identity, and no is_active flag.
--
-- Fact identity is UNIQUE (environment_id, fact_digest). Re-validating the same
-- input against the same mapping history recomputes the same digest, which is
-- what makes replay a structural no-op rather than an application convention.

-- +goose Up

CREATE TABLE billing_transaction_facts (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    environment_mode text NOT NULL CHECK (environment_mode IN ('development', 'staging', 'production')),
    application_id text NOT NULL,
    provider text NOT NULL CHECK (provider IN ('app_store', 'google_play')),
    store_environment text NOT NULL CHECK (store_environment IN ('sandbox', 'production')),

    -- Identity. Apple transaction ids are stored as given because they are the
    -- documented lookup key for Get Transaction Info; Google purchase tokens
    -- are never stored here, only their digest.
    provider_transaction_id text NOT NULL CHECK (
        btrim(provider_transaction_id) <> '' AND length(provider_transaction_id) <= 256
    ),
    provider_original_transaction_id text CHECK (
        provider_original_transaction_id IS NULL OR btrim(provider_original_transaction_id) <> ''
    ),
    purchase_chain_digest bytea CHECK (
        purchase_chain_digest IS NULL OR octet_length(purchase_chain_digest) = 32
    ),
    supersedes_chain_digest bytea CHECK (
        supersedes_chain_digest IS NULL OR octet_length(supersedes_chain_digest) = 32
    ),

    -- Classification. Phase 9A supports auto-renewable subscriptions and
    -- non-consumables only; consumables quarantine as unsupported.
    transaction_type text NOT NULL CHECK (
        transaction_type IN ('auto_renewable_subscription', 'non_consumable')
    ),
    fact_kind text NOT NULL CHECK (fact_kind IN (
        'initial_purchase', 'renewal', 'one_time_purchase', 'plan_change', 'offer_redeemed',
        'refund', 'revocation', 'expiration', 'grace_period_start', 'billing_retry_start',
        'cancellation_scheduled', 'auto_renew_disabled', 'auto_renew_enabled',
        'purchase_superseded', 'paused', 'resumed'
    )),
    occurred_at timestamptz NOT NULL,
    -- Provider-stated validity window. Recorded as a provider fact only; Phase
    -- 9A never interprets it as customer access.
    period_start_at timestamptz,
    period_end_at timestamptz,
    revoked_at timestamptz,
    refunded_at timestamptz,
    renewal_expected boolean,
    is_test_transaction boolean NOT NULL DEFAULT false,

    -- Resolution Snapshot: the exact mapping row and version used, so historical
    -- resolution is reproducible after the mapping changes.
    provider_product_identifier text NOT NULL CHECK (
        btrim(provider_product_identifier) <> '' AND length(provider_product_identifier) <= 255
    ),
    provider_base_plan_identifier text,
    provider_offer_identifier text,
    resolution_state text NOT NULL CHECK (resolution_state IN (
        'active_mapping', 'archived_mapping', 'replacement_chain', 'unresolved'
    )),
    mosaic_product_id text,
    provider_product_mapping_id text,
    resolved_mapping_version bigint CHECK (resolved_mapping_version IS NULL OR resolved_mapping_version >= 0),

    -- Provenance.
    validator_version integer NOT NULL CHECK (validator_version >= 1),
    fact_version integer NOT NULL DEFAULT 1 CHECK (fact_version >= 1),
    source_raw_input_id text NOT NULL,
    validation_attempt_id text NOT NULL,
    fact_digest bytea NOT NULL CHECK (octet_length(fact_digest) = 32),
    recorded_at timestamptz NOT NULL,

    UNIQUE (id, project_id),
    -- Identity. Duplicate delivery, reconciliation rediscovery, and replay all
    -- collapse onto this constraint rather than onto application logic.
    UNIQUE (environment_id, fact_digest),
    FOREIGN KEY (environment_id, project_id, environment_mode)
        REFERENCES environments(id, project_id, mode) ON DELETE RESTRICT,
    FOREIGN KEY (application_id, project_id)
        REFERENCES applications(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (mosaic_product_id, project_id)
        REFERENCES products(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (provider_product_mapping_id, project_id)
        REFERENCES provider_product_mappings(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (source_raw_input_id, project_id)
        REFERENCES billing_raw_inputs(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (validation_attempt_id, project_id)
        REFERENCES billing_validation_attempts(id, project_id) ON DELETE RESTRICT,
    -- Sandbox and production never mix: a production Store Environment can only
    -- be recorded against a production Mosaic Environment.
    CONSTRAINT billing_transaction_facts_environment_alignment_check CHECK (
        (environment_mode = 'production') = (store_environment = 'production')
    ),
    CONSTRAINT billing_transaction_facts_resolution_shape_check CHECK (
        (resolution_state = 'unresolved') = (mosaic_product_id IS NULL) AND
        (resolution_state = 'unresolved') = (provider_product_mapping_id IS NULL)
    ),
    CHECK (period_end_at IS NULL OR period_start_at IS NULL OR period_end_at >= period_start_at),
    CHECK (provider_offer_identifier IS NULL OR provider_base_plan_identifier IS NOT NULL),
    CHECK (provider = 'google_play' OR (provider_base_plan_identifier IS NULL AND provider_offer_identifier IS NULL))
);
CREATE INDEX billing_transaction_facts_environment_idx
    ON billing_transaction_facts(environment_id, occurred_at DESC, id);
CREATE INDEX billing_transaction_facts_chain_idx
    ON billing_transaction_facts(environment_id, purchase_chain_digest, occurred_at DESC)
    WHERE purchase_chain_digest IS NOT NULL;
CREATE INDEX billing_transaction_facts_product_idx
    ON billing_transaction_facts(environment_id, mosaic_product_id, occurred_at DESC)
    WHERE mosaic_product_id IS NOT NULL;
CREATE INDEX billing_transaction_facts_input_idx
    ON billing_transaction_facts(source_raw_input_id, recorded_at DESC);

CREATE TRIGGER billing_transaction_facts_append_only
BEFORE UPDATE OR DELETE ON billing_transaction_facts
FOR EACH ROW EXECUTE FUNCTION reject_billing_append_only_change();

-- Product Resolution results, including the ones that failed. Recording a
-- failed resolution rather than dropping the input is what makes the ledger
-- complete enough for reconciliation and later backfill.
CREATE TABLE billing_product_resolutions (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    application_id text,
    validation_attempt_id text NOT NULL,
    raw_input_id text NOT NULL,
    provider text NOT NULL CHECK (provider IN ('app_store', 'google_play')),
    provider_product_identifier text NOT NULL CHECK (btrim(provider_product_identifier) <> ''),
    provider_base_plan_identifier text,
    provider_offer_identifier text,
    outcome text NOT NULL CHECK (outcome IN (
        'resolved', 'unknown', 'ambiguous', 'cross_environment_mismatch', 'unsupported_product_type'
    )),
    resolution_state text CHECK (resolution_state IS NULL OR resolution_state IN (
        'active_mapping', 'archived_mapping', 'replacement_chain'
    )),
    mosaic_product_id text,
    provider_product_mapping_id text,
    -- The mapping row the walk actually matched, which may differ from the
    -- mapping whose Mosaic Product was adopted when a replacement chain was
    -- followed. Both are recorded so provenance is exact.
    matched_mapping_id text,
    mapping_version bigint CHECK (mapping_version IS NULL OR mapping_version >= 0),
    candidate_count integer NOT NULL DEFAULT 0 CHECK (candidate_count >= 0),
    diagnostic_code text CHECK (diagnostic_code IS NULL OR (btrim(diagnostic_code) <> '' AND length(diagnostic_code) <= 128)),
    occurred_at timestamptz NOT NULL,
    resolved_at timestamptz NOT NULL,
    UNIQUE (id, project_id),
    UNIQUE (validation_attempt_id),
    FOREIGN KEY (environment_id, project_id)
        REFERENCES environments(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (application_id, project_id)
        REFERENCES applications(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (validation_attempt_id, project_id)
        REFERENCES billing_validation_attempts(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (raw_input_id, project_id)
        REFERENCES billing_raw_inputs(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (mosaic_product_id, project_id)
        REFERENCES products(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (provider_product_mapping_id, project_id)
        REFERENCES provider_product_mappings(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (matched_mapping_id, project_id)
        REFERENCES provider_product_mappings(id, project_id) ON DELETE RESTRICT,
    CONSTRAINT billing_product_resolutions_outcome_shape_check CHECK (
        (outcome = 'resolved') = (mosaic_product_id IS NOT NULL) AND
        (outcome = 'resolved') = (provider_product_mapping_id IS NOT NULL) AND
        (outcome = 'resolved') = (resolution_state IS NOT NULL)
    )
);
CREATE INDEX billing_product_resolutions_environment_idx
    ON billing_product_resolutions(environment_id, resolved_at DESC, id);
CREATE INDEX billing_product_resolutions_unresolved_idx
    ON billing_product_resolutions(environment_id, provider_product_identifier, resolved_at DESC)
    WHERE outcome <> 'resolved';

CREATE TRIGGER billing_product_resolutions_append_only
BEFORE UPDATE OR DELETE ON billing_product_resolutions
FOR EACH ROW EXECUTE FUNCTION reject_billing_append_only_change();

-- The Billing Event Ledger. Operational history only: what the pipeline did and
-- when. There is deliberately no update endpoint anywhere in the API, and the
-- trigger makes that a schema guarantee rather than a routing decision.
CREATE TABLE billing_ledger_entries (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    entry_type text NOT NULL CHECK (entry_type IN (
        'input_received', 'input_authenticated', 'input_duplicate_detected',
        'validation_started', 'validation_succeeded', 'validation_failed',
        'product_resolved', 'product_resolution_failed',
        'fact_recorded', 'fact_deduplicated',
        'input_quarantined', 'quarantine_closed',
        'reconciliation_started', 'reconciliation_discovery', 'reconciliation_completed',
        'replay_started', 'replay_completed', 'revalidation_completed',
        'credential_health_changed'
    )),
    raw_input_id text,
    validation_attempt_id text,
    transaction_fact_id text,
    credential_id text,
    -- Safe machine-readable detail only. The CHECK bans the key names that
    -- carry bearer values so a future caller cannot smuggle a token into the
    -- ledger by adding a field.
    detail jsonb NOT NULL DEFAULT '{}'::jsonb,
    correlation_id text NOT NULL CHECK (btrim(correlation_id) <> '' AND length(correlation_id) <= 128),
    occurred_at timestamptz NOT NULL,
    UNIQUE (id, project_id),
    FOREIGN KEY (environment_id, project_id)
        REFERENCES environments(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (raw_input_id, project_id)
        REFERENCES billing_raw_inputs(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (validation_attempt_id, project_id)
        REFERENCES billing_validation_attempts(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (transaction_fact_id, project_id)
        REFERENCES billing_transaction_facts(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (credential_id, project_id)
        REFERENCES store_server_credentials(id, project_id) ON DELETE RESTRICT,
    CONSTRAINT billing_ledger_entries_safe_detail_check CHECK (
        jsonb_typeof(detail) = 'object' AND
        octet_length(detail::text) <= 2048 AND
        NOT (detail ?| ARRAY[
            'token', 'purchaseToken', 'receipt', 'signedPayload', 'signedTransactionInfo',
            'signedRenewalInfo', 'credential', 'secret', 'password', 'authorization',
            'bearer', 'appAccountToken', 'privateKey'
        ])
    )
);
CREATE INDEX billing_ledger_entries_environment_idx
    ON billing_ledger_entries(environment_id, occurred_at DESC, id);
CREATE INDEX billing_ledger_entries_input_idx
    ON billing_ledger_entries(raw_input_id, occurred_at DESC)
    WHERE raw_input_id IS NOT NULL;

CREATE TRIGGER billing_ledger_entries_append_only
BEFORE UPDATE OR DELETE ON billing_ledger_entries
FOR EACH ROW EXECUTE FUNCTION reject_billing_append_only_change();

-- +goose Down
DROP TRIGGER billing_ledger_entries_append_only ON billing_ledger_entries;
DROP TABLE billing_ledger_entries;
DROP TRIGGER billing_product_resolutions_append_only ON billing_product_resolutions;
DROP TABLE billing_product_resolutions;
DROP TRIGGER billing_transaction_facts_append_only ON billing_transaction_facts;
DROP TABLE billing_transaction_facts;
