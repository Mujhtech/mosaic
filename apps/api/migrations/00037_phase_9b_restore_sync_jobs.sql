-- Phase 9B: restore and sync jobs (plan §11, §13 restore semantics).
--
-- A restore is not one action, it is a chain: the SDK submits provider
-- transaction references as observations, those observations become Raw
-- Billing Inputs, validation turns them into facts, and only then does a
-- projection produce a snapshot that reflects them. This table records the
-- whole chain so the outcome reported to the caller is derived from where the
-- chain actually got to, never from the fact that the native restore returned.
--
-- The single most important column is `snapshot_version`: the `restored`
-- outcome may only be written together with the accepted snapshot version that
-- demonstrates it. Without that column the restore surface could report
-- restored access that no snapshot has yet granted, which is exactly the lie
-- the Authoritative Entitlement contract's two-axis restore result exists to
-- prevent.

-- +goose Up
CREATE TABLE restore_sync_jobs (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    -- Null until identity resolves. `identity_unresolved` is precisely the
    -- outcome in which this stays null, which is why there is no NOT NULL here.
    billing_customer_id text,
    store_platform text NOT NULL CHECK (store_platform IN ('apple_app_store', 'google_play')),

    status text NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'leased', 'completed', 'failed')),
    -- Mosaic's authoritative answer, on the closed contract vocabulary.
    outcome text CHECK (outcome IS NULL OR outcome IN (
        'restored', 'no_additional_purchases', 'validation_pending',
        'identity_unresolved', 'product_unresolved', 'provider_unavailable', 'failed'
    )),
    -- What the native provider restore itself did, kept on its own axis and
    -- never merged into `outcome`.
    provider_outcome text NOT NULL DEFAULT 'not_attempted' CHECK (provider_outcome IN (
        'completed', 'no_purchases_found', 'cancelled', 'failed', 'unsupported', 'not_attempted'
    )),
    uncertainty_reason text NOT NULL DEFAULT 'none' CHECK (uncertainty_reason IN (
        'none', 'provider_unavailable', 'missing_fact', 'identity_unresolved',
        'product_unresolved', 'conflicting_facts', 'projection_failed',
        'stale_validation', 'unsupported_provider_state'
    )),

    observed_transaction_count integer NOT NULL DEFAULT 0 CHECK (observed_transaction_count >= 0),
    pending_validation_count integer NOT NULL DEFAULT 0 CHECK (pending_validation_count >= 0),
    -- The snapshot version current when the restore was requested. The restore
    -- is only "reflected" once the customer's version has moved past it.
    baseline_snapshot_version bigint CHECK (baseline_snapshot_version IS NULL OR baseline_snapshot_version >= 0),
    -- The accepted snapshot that reflects the restore. This is the evidence for
    -- the `restored` outcome.
    snapshot_version bigint CHECK (snapshot_version IS NULL OR snapshot_version >= 1),

    correlation_id text NOT NULL DEFAULT '' CHECK (length(correlation_id) <= 128),
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),
    available_at timestamptz NOT NULL,
    leased_by text,
    leased_until timestamptz,
    requested_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    completed_at timestamptz,

    UNIQUE (id, project_id),
    FOREIGN KEY (environment_id, project_id)
        REFERENCES environments(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (billing_customer_id, project_id)
        REFERENCES billing_customers(id, project_id) ON DELETE RESTRICT,

    -- The invariant the whole table exists for.
    CONSTRAINT restore_sync_jobs_restored_requires_snapshot CHECK (
        outcome <> 'restored' OR (snapshot_version IS NOT NULL AND billing_customer_id IS NOT NULL AND completed_at IS NOT NULL)
    ),
    CONSTRAINT restore_sync_jobs_identity_unresolved_has_no_customer CHECK (
        outcome <> 'identity_unresolved' OR billing_customer_id IS NULL
    ),
    -- Every non-definite outcome remains explainable, on the same uncertainty
    -- vocabulary every other entitlement surface uses.
    CONSTRAINT restore_sync_jobs_uncertain_outcomes_explained CHECK (
        outcome IS NULL
        OR outcome IN ('restored', 'no_additional_purchases')
        OR uncertainty_reason <> 'none'
    ),
    CONSTRAINT restore_sync_jobs_terminal_has_outcome CHECK (
        status NOT IN ('completed', 'failed') OR outcome IS NOT NULL
    )
);
CREATE INDEX restore_sync_jobs_queue_idx
    ON restore_sync_jobs(available_at, id) WHERE status IN ('queued', 'leased');
CREATE INDEX restore_sync_jobs_customer_idx
    ON restore_sync_jobs(billing_customer_id, environment_id, requested_at DESC)
    WHERE billing_customer_id IS NOT NULL;
CREATE INDEX restore_sync_jobs_environment_idx
    ON restore_sync_jobs(environment_id, requested_at DESC, id);

-- The submitted references, linked to the Raw Billing Inputs the observation
-- endpoint created for them. This is the join that lets the worker answer
-- "have all of this restore's submissions been validated yet?" without
-- guessing from timestamps.
CREATE TABLE restore_sync_job_inputs (
    restore_sync_job_id text NOT NULL,
    project_id text NOT NULL,
    raw_input_id text NOT NULL,
    transaction_reference_digest bytea NOT NULL CHECK (octet_length(transaction_reference_digest) = 32),
    created_at timestamptz NOT NULL,
    PRIMARY KEY (restore_sync_job_id, raw_input_id),
    FOREIGN KEY (restore_sync_job_id, project_id)
        REFERENCES restore_sync_jobs(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (raw_input_id, project_id)
        REFERENCES billing_raw_inputs(id, project_id) ON DELETE RESTRICT
);
CREATE INDEX restore_sync_job_inputs_digest_idx
    ON restore_sync_job_inputs(project_id, transaction_reference_digest);

CREATE TRIGGER restore_sync_job_inputs_append_only
BEFORE UPDATE OR DELETE ON restore_sync_job_inputs
FOR EACH ROW EXECUTE FUNCTION reject_billing_append_only_change();

-- +goose Down
DROP TRIGGER restore_sync_job_inputs_append_only ON restore_sync_job_inputs;
DROP TABLE restore_sync_job_inputs;
DROP TABLE restore_sync_jobs;
