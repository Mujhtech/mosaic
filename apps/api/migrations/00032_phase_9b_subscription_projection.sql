-- Phase 9B: subscription projection persistence (plan §5, §6, §8, §9).
--
-- Snapshots are immutable projected states; timeline entries are append-only
-- explanations; checkpoints are derived and rebuildable; rule versions are
-- global engine semantics with exactly one active; jobs follow the same lease
-- shape as every other Mosaic queue, with a partial-unique scope key that
-- coalesces duplicate triggers.

-- +goose Up
CREATE TABLE projection_rule_versions (
    id text PRIMARY KEY,
    version integer NOT NULL UNIQUE CHECK (version >= 1),
    status text NOT NULL CHECK (status IN ('draft', 'active', 'retired')),
    description text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL,
    promoted_at timestamptz,
    CHECK ((status = 'active') = (promoted_at IS NOT NULL) OR status = 'retired')
);
CREATE UNIQUE INDEX projection_rule_versions_one_active_idx
    ON projection_rule_versions(status) WHERE status = 'active';
INSERT INTO projection_rule_versions (id, version, status, description, created_at, promoted_at)
VALUES ('prv_1', 1, 'active', 'Phase 9B initial projection semantics (plan §6/§7, ordering version 1)', now(), now());

CREATE TABLE subscription_snapshots (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    subscription_instance_id text NOT NULL,
    projection_version bigint NOT NULL CHECK (projection_version >= 1),
    rule_version integer NOT NULL REFERENCES projection_rule_versions(version) ON DELETE RESTRICT,
    computed_at timestamptz NOT NULL,
    as_of timestamptz NOT NULL,
    -- Five state axes. 'unavailable' is a read-time service state and is
    -- deliberately not representable here (plan §5).
    access_state text NOT NULL CHECK (access_state IN ('active', 'inactive', 'unknown')),
    lifecycle_state text NOT NULL CHECK (lifecycle_state IN (
        'trialing', 'active', 'grace_period', 'billing_retry', 'paused',
        'expired', 'revoked', 'refunded', 'superseded', 'unknown'
    )),
    renewal_intent text NOT NULL CHECK (renewal_intent IN (
        'auto_renew_enabled', 'auto_renew_disabled', 'provider_managed', 'paused', 'unknown'
    )),
    billing_state text NOT NULL CHECK (billing_state IN (
        'current', 'retrying', 'grace', 'failed', 'refunded', 'revoked', 'unknown'
    )),
    uncertainty_reason text NOT NULL DEFAULT 'none' CHECK (uncertainty_reason IN (
        'none', 'provider_unavailable', 'missing_fact', 'identity_unresolved',
        'product_unresolved', 'conflicting_facts', 'projection_failed',
        'stale_validation', 'unsupported_provider_state'
    )),
    -- Effective timestamps, all provider-derived.
    period_start_at timestamptz,
    period_end_at timestamptz,
    grace_period_end_at timestamptz,
    billing_retry_start_at timestamptz,
    pause_start_at timestamptz,
    pause_resume_at timestamptz,
    cancellation_effective_at timestamptz,
    expiration_effective_at timestamptz,
    revocation_effective_at timestamptz,
    refund_effective_at timestamptz,
    current_product_id text,
    prior_product_id text,
    scheduled_product_identifier text,
    is_test_source boolean NOT NULL DEFAULT false,
    terminal boolean NOT NULL DEFAULT false,
    checksum bytea NOT NULL CHECK (octet_length(checksum) = 32),
    projection_reason text NOT NULL CHECK (btrim(projection_reason) <> '' AND length(projection_reason) <= 64),
    created_at timestamptz NOT NULL,
    UNIQUE (id, project_id),
    UNIQUE (subscription_instance_id, projection_version),
    FOREIGN KEY (environment_id, project_id)
        REFERENCES environments(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (subscription_instance_id, project_id)
        REFERENCES subscription_instances(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (current_product_id, project_id)
        REFERENCES products(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (prior_product_id, project_id)
        REFERENCES products(id, project_id) ON DELETE RESTRICT,
    -- Schema-level derivation invariants (plan §6).
    CHECK (lifecycle_state NOT IN ('revoked', 'refunded', 'expired', 'superseded') OR access_state <> 'active'),
    CHECK (lifecycle_state <> 'grace_period' OR grace_period_end_at IS NOT NULL),
    CHECK (access_state <> 'unknown' OR uncertainty_reason <> 'none')
);
CREATE INDEX subscription_snapshots_instance_idx
    ON subscription_snapshots(subscription_instance_id, projection_version DESC);

CREATE TRIGGER subscription_snapshots_append_only
BEFORE UPDATE OR DELETE ON subscription_snapshots
FOR EACH ROW EXECUTE FUNCTION reject_billing_append_only_change();

-- The current-snapshot pointer on the instance, now that snapshots exist.
ALTER TABLE subscription_instances
    ADD COLUMN current_snapshot_id text,
    ADD CONSTRAINT subscription_instances_current_snapshot_fkey
        FOREIGN KEY (current_snapshot_id, project_id)
        REFERENCES subscription_snapshots(id, project_id) ON DELETE RESTRICT;

CREATE TABLE subscription_snapshot_facts (
    snapshot_id text NOT NULL REFERENCES subscription_snapshots(id) ON DELETE RESTRICT,
    transaction_fact_id text NOT NULL REFERENCES billing_transaction_facts(id) ON DELETE RESTRICT,
    position integer NOT NULL CHECK (position >= 0),
    PRIMARY KEY (snapshot_id, transaction_fact_id),
    UNIQUE (snapshot_id, position)
);

CREATE TRIGGER subscription_snapshot_facts_append_only
BEFORE UPDATE OR DELETE ON subscription_snapshot_facts
FOR EACH ROW EXECUTE FUNCTION reject_billing_append_only_change();

CREATE TABLE subscription_timeline_entries (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    subscription_instance_id text,
    one_time_purchase_instance_id text,
    entry_type text NOT NULL CHECK (entry_type IN (
        'purchase_started', 'purchase_validated', 'trial_started', 'renewal_validated',
        'auto_renew_enabled', 'auto_renew_disabled', 'cancellation_requested',
        'grace_period_started', 'grace_period_ended', 'billing_retry_started',
        'billing_recovered', 'pause_scheduled', 'pause_started', 'pause_ended',
        'product_upgraded', 'product_downgraded', 'expiration', 'refund', 'revocation',
        'refund_reversed', 'purchase_superseded',
        'customer_association_changed', 'product_resolution_repaired',
        'projection_replayed', 'projection_rule_upgraded'
    )),
    effective_at timestamptz NOT NULL,
    observed_at timestamptz NOT NULL,
    old_snapshot_id text,
    new_snapshot_id text,
    product_id text,
    prior_product_id text,
    source_fact_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
    explanation_code text NOT NULL CHECK (btrim(explanation_code) <> '' AND length(explanation_code) <= 64),
    -- Safe machine detail only, guarded by the same function as the 9A ledger.
    detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (billing_ledger_detail_is_safe(detail)),
    rule_version integer NOT NULL REFERENCES projection_rule_versions(version) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL,
    UNIQUE (id, project_id),
    FOREIGN KEY (environment_id, project_id)
        REFERENCES environments(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (subscription_instance_id, project_id)
        REFERENCES subscription_instances(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (one_time_purchase_instance_id, project_id)
        REFERENCES one_time_purchase_instances(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (old_snapshot_id, project_id)
        REFERENCES subscription_snapshots(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (new_snapshot_id, project_id)
        REFERENCES subscription_snapshots(id, project_id) ON DELETE RESTRICT,
    CHECK ((subscription_instance_id IS NULL) <> (one_time_purchase_instance_id IS NULL))
);
CREATE INDEX subscription_timeline_entries_instance_idx
    ON subscription_timeline_entries(subscription_instance_id, effective_at DESC)
    WHERE subscription_instance_id IS NOT NULL;
CREATE INDEX subscription_timeline_entries_one_time_idx
    ON subscription_timeline_entries(one_time_purchase_instance_id, effective_at DESC)
    WHERE one_time_purchase_instance_id IS NOT NULL;

CREATE TRIGGER subscription_timeline_entries_append_only
BEFORE UPDATE OR DELETE ON subscription_timeline_entries
FOR EACH ROW EXECUTE FUNCTION reject_billing_append_only_change();

-- Checkpoints are derived state: rebuildable, updatable, invalidated by
-- out-of-order facts. Deliberately no append-only trigger.
CREATE TABLE projection_checkpoints (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    subscription_instance_id text,
    one_time_purchase_instance_id text,
    -- Opaque encoding of the canonical ordering position of the last fact
    -- projected (ordering version 1).
    high_watermark text NOT NULL,
    facts_projected bigint NOT NULL DEFAULT 0 CHECK (facts_projected >= 0),
    rule_version integer NOT NULL REFERENCES projection_rule_versions(version) ON DELETE RESTRICT,
    current_snapshot_id text,
    checksum bytea CHECK (checksum IS NULL OR octet_length(checksum) = 32),
    invalidated boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL,
    UNIQUE (id, project_id),
    FOREIGN KEY (environment_id, project_id)
        REFERENCES environments(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (subscription_instance_id, project_id)
        REFERENCES subscription_instances(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (one_time_purchase_instance_id, project_id)
        REFERENCES one_time_purchase_instances(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (current_snapshot_id, project_id)
        REFERENCES subscription_snapshots(id, project_id) ON DELETE RESTRICT,
    CHECK ((subscription_instance_id IS NULL) <> (one_time_purchase_instance_id IS NULL))
);
CREATE UNIQUE INDEX projection_checkpoints_subscription_idx
    ON projection_checkpoints(subscription_instance_id)
    WHERE subscription_instance_id IS NOT NULL;
CREATE UNIQUE INDEX projection_checkpoints_one_time_idx
    ON projection_checkpoints(one_time_purchase_instance_id)
    WHERE one_time_purchase_instance_id IS NOT NULL;

-- Projection jobs: same lease shape as billing_validation_jobs, with
-- scope-key coalescing — at most one queued-or-leased job per scope.
CREATE TABLE projection_jobs (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    environment_id text,
    -- 'customer:{billing_customer_id}' or 'lineage:{purchase_lineage_id}'.
    scope_key text NOT NULL CHECK (btrim(scope_key) <> '' AND length(scope_key) <= 200),
    kind text NOT NULL CHECK (kind IN (
        'fact_committed', 'association_established', 'quarantine_repair',
        'grant_version_published', 'rule_promotion', 'reconciliation_discovery',
        'replay', 'manual_sync'
    )),
    detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (billing_ledger_detail_is_safe(detail)),
    status text NOT NULL CHECK (status IN ('queued', 'leased', 'completed', 'failed')),
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    max_attempts integer NOT NULL DEFAULT 8 CHECK (max_attempts BETWEEN 1 AND 12),
    available_at timestamptz NOT NULL,
    lease_owner text,
    lease_expires_at timestamptz,
    last_error_code text CHECK (last_error_code IS NULL OR (btrim(last_error_code) <> '' AND length(last_error_code) <= 128)),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    FOREIGN KEY (environment_id, project_id)
        REFERENCES environments(id, project_id) ON DELETE RESTRICT,
    CHECK ((status = 'leased') = (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL))
);
CREATE UNIQUE INDEX projection_jobs_scope_coalesce_idx
    ON projection_jobs(scope_key)
    WHERE status IN ('queued', 'leased');
CREATE INDEX projection_jobs_lease_idx
    ON projection_jobs(available_at, created_at, id)
    WHERE status IN ('queued', 'leased');

-- Every execution records an attempt, including no-change and failed runs.
CREATE TABLE projection_attempts (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    projection_job_id text,
    scope_key text NOT NULL,
    rule_version integer NOT NULL,
    -- digest(scope, high-watermark, rule version, grant version set): the
    -- idempotency key of the projection command (plan §9).
    idempotency_key bytea CHECK (idempotency_key IS NULL OR octet_length(idempotency_key) = 32),
    outcome text NOT NULL CHECK (outcome IN (
        'projected', 'no_change', 'unresolved', 'frozen', 'failed'
    )),
    error_code text CHECK (error_code IS NULL OR (btrim(error_code) <> '' AND length(error_code) <= 128)),
    started_at timestamptz NOT NULL,
    completed_at timestamptz NOT NULL,
    UNIQUE (id, project_id)
);
CREATE INDEX projection_attempts_scope_idx
    ON projection_attempts(scope_key, completed_at DESC);

CREATE TRIGGER projection_attempts_append_only
BEFORE UPDATE OR DELETE ON projection_attempts
FOR EACH ROW EXECUTE FUNCTION reject_billing_append_only_change();

-- +goose Down
DROP TRIGGER projection_attempts_append_only ON projection_attempts;
DROP TABLE projection_attempts;
DROP TABLE projection_jobs;
DROP TABLE projection_checkpoints;
DROP TRIGGER subscription_timeline_entries_append_only ON subscription_timeline_entries;
DROP TABLE subscription_timeline_entries;
DROP TRIGGER subscription_snapshot_facts_append_only ON subscription_snapshot_facts;
DROP TABLE subscription_snapshot_facts;
ALTER TABLE subscription_instances
    DROP CONSTRAINT subscription_instances_current_snapshot_fkey,
    DROP COLUMN current_snapshot_id;
DROP TRIGGER subscription_snapshots_append_only ON subscription_snapshots;
DROP TABLE subscription_snapshots;
DROP TABLE projection_rule_versions;
