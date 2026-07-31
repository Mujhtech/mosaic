-- Phase 9A: quarantine, reconciliation, and replay.
--
-- Quarantine is the only place a stuck input lives, and it has exactly one exit
-- that produces a Transaction Fact: a *successful* revalidation. There is no
-- "mark as valid" column, action, or status anywhere in this schema, so an
-- operator cannot assert authenticity that the store never confirmed.

-- +goose Up

CREATE TABLE billing_quarantine_records (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    raw_input_id text NOT NULL,
    application_id text,
    provider text NOT NULL CHECK (provider IN ('app_store', 'google_play')),
    reason_code text NOT NULL CHECK (reason_code IN (
        'signature_invalid', 'application_mismatch', 'environment_mismatch',
        'store_environment_mismatch', 'credential_unavailable', 'credential_revoked',
        'product_unknown', 'product_ambiguous', 'cross_environment_mismatch',
        'unsupported_product_type', 'unsupported_transaction_type',
        'malformed_reference', 'input_content_conflict', 'replay_conflict',
        'provider_permanently_failed', 'validation_exhausted'
    )),
    severity text NOT NULL CHECK (severity IN ('warning', 'error', 'security')),
    -- The scopes an operator has to repair before a retry can succeed. Kept as a
    -- bounded text array rather than free-form JSON so the dashboard filter is a
    -- closed set.
    scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
    status text NOT NULL CHECK (status IN ('open', 'retrying', 'closed_after_success', 'closed_superseded')),
    attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count >= 1),
    first_seen_at timestamptz NOT NULL,
    last_attempt_at timestamptz NOT NULL,
    -- Closure always names the successful attempt (or the superseding record)
    -- that justified it. A CHECK makes a closure without evidence impossible.
    closing_attempt_id text,
    superseded_by_record_id text,
    closed_at timestamptz,
    closed_by_actor_id text,
    diagnostic_code text CHECK (diagnostic_code IS NULL OR (btrim(diagnostic_code) <> '' AND length(diagnostic_code) <= 128)),
    UNIQUE (id, project_id),
    -- One open record per input: retries update the existing record rather than
    -- growing the queue.
    UNIQUE (raw_input_id),
    FOREIGN KEY (raw_input_id, project_id)
        REFERENCES billing_raw_inputs(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (environment_id, project_id)
        REFERENCES environments(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (application_id, project_id)
        REFERENCES applications(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (closing_attempt_id, project_id)
        REFERENCES billing_validation_attempts(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (superseded_by_record_id, project_id)
        REFERENCES billing_quarantine_records(id, project_id) ON DELETE RESTRICT,
    CHECK (last_attempt_at >= first_seen_at),
    CHECK (array_length(scopes, 1) IS NULL OR array_length(scopes, 1) <= 8),
    CONSTRAINT billing_quarantine_records_closure_shape_check CHECK (
        (status IN ('closed_after_success', 'closed_superseded')) = (closed_at IS NOT NULL) AND
        (status = 'closed_after_success') = (closing_attempt_id IS NOT NULL) AND
        (status = 'closed_superseded') = (superseded_by_record_id IS NOT NULL)
    )
);
CREATE INDEX billing_quarantine_records_open_idx
    ON billing_quarantine_records(environment_id, reason_code, first_seen_at)
    WHERE status IN ('open', 'retrying');
CREATE INDEX billing_quarantine_records_history_idx
    ON billing_quarantine_records(environment_id, last_attempt_at DESC, id);

-- Recovery history is append-only: the audit trail of who retried what survives
-- even though the quarantine record itself is a mutable work queue.
CREATE TABLE billing_quarantine_actions (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    quarantine_record_id text NOT NULL,
    action text NOT NULL CHECK (action IN ('retry_validation', 'rerun_resolution', 'close_superseded')),
    outcome text NOT NULL CHECK (outcome IN ('accepted', 'rejected', 'succeeded', 'failed')),
    diagnostic_code text CHECK (diagnostic_code IS NULL OR (btrim(diagnostic_code) <> '' AND length(diagnostic_code) <= 128)),
    actor_id text NOT NULL,
    occurred_at timestamptz NOT NULL,
    FOREIGN KEY (quarantine_record_id, project_id)
        REFERENCES billing_quarantine_records(id, project_id) ON DELETE RESTRICT
);
CREATE INDEX billing_quarantine_actions_history_idx
    ON billing_quarantine_actions(quarantine_record_id, occurred_at DESC, id);

CREATE TRIGGER billing_quarantine_actions_append_only
BEFORE UPDATE OR DELETE ON billing_quarantine_actions
FOR EACH ROW EXECUTE FUNCTION reject_billing_append_only_change();

-- Reconciliation runs are their own queue, following the analytics retention-run
-- shape. The cursor columns make a run restart-safe: an interrupted run resumes
-- from the last committed cursor rather than re-scanning the whole window.
CREATE TABLE billing_reconciliation_runs (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    credential_id text NOT NULL,
    provider text NOT NULL CHECK (provider IN ('app_store', 'google_play')),
    trigger text NOT NULL CHECK (trigger IN ('scheduled', 'manual')),
    strategy text NOT NULL CHECK (strategy IN (
        'apple_notification_history', 'apple_transaction_history', 'google_token_requery'
    )),
    status text NOT NULL CHECK (status IN ('queued', 'leased', 'completed', 'partial', 'failed')),
    window_start timestamptz NOT NULL,
    window_end timestamptz NOT NULL,
    -- Provider pagination cursor (Apple paginationToken / revision, Google
    -- keyset position). Opaque and bounded; never a credential.
    cursor_token text CHECK (cursor_token IS NULL OR length(cursor_token) <= 2048),
    cursor_position bigint CHECK (cursor_position IS NULL OR cursor_position >= 0),
    examined_count bigint NOT NULL DEFAULT 0 CHECK (examined_count >= 0),
    discovered_count bigint NOT NULL DEFAULT 0 CHECK (discovered_count >= 0),
    duplicate_count bigint NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
    failure_count bigint NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 10),
    available_at timestamptz NOT NULL,
    lease_owner text,
    lease_expires_at timestamptz,
    last_error_code text CHECK (last_error_code IS NULL OR (btrim(last_error_code) <> '' AND length(last_error_code) <= 128)),
    requested_by_actor_id text NOT NULL,
    created_at timestamptz NOT NULL,
    started_at timestamptz,
    completed_at timestamptz,
    updated_at timestamptz NOT NULL,
    UNIQUE (id, project_id),
    FOREIGN KEY (environment_id, project_id)
        REFERENCES environments(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (credential_id, project_id, provider)
        REFERENCES store_server_credentials(id, project_id, provider) ON DELETE RESTRICT,
    CHECK (window_end > window_start),
    CHECK ((status = 'leased') = (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)),
    CHECK ((status IN ('completed', 'partial', 'failed')) = (completed_at IS NOT NULL))
);
CREATE INDEX billing_reconciliation_runs_lease_idx
    ON billing_reconciliation_runs(available_at, created_at, id)
    WHERE status IN ('queued', 'leased');
CREATE INDEX billing_reconciliation_runs_history_idx
    ON billing_reconciliation_runs(environment_id, created_at DESC, id);
-- One live run per credential and strategy, so a scheduled run and an operator
-- run cannot double-scan the same window.
CREATE UNIQUE INDEX billing_reconciliation_runs_active_key
    ON billing_reconciliation_runs(credential_id, strategy)
    WHERE status IN ('queued', 'leased');

-- Replay re-runs accepted inputs deterministically. It appends new Validation
-- Attempts and never rewrites prior attempts or facts; the comparison columns
-- record what changed, which is the entire operator-visible product of a replay.
CREATE TABLE billing_replay_jobs (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('replay', 'revalidation')),
    -- Replay sources: a single input (quarantine recovery) or a bounded window.
    raw_input_id text,
    window_start timestamptz,
    window_end timestamptz,
    validator_version integer NOT NULL CHECK (validator_version >= 1),
    status text NOT NULL CHECK (status IN ('queued', 'leased', 'completed', 'failed')),
    comparison_result text CHECK (comparison_result IS NULL OR comparison_result IN (
        'identical', 'new_facts', 'conflicting', 'still_failing'
    )),
    examined_count bigint NOT NULL DEFAULT 0 CHECK (examined_count >= 0),
    unchanged_count bigint NOT NULL DEFAULT 0 CHECK (unchanged_count >= 0),
    new_fact_count bigint NOT NULL DEFAULT 0 CHECK (new_fact_count >= 0),
    conflict_count bigint NOT NULL DEFAULT 0 CHECK (conflict_count >= 0),
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
    available_at timestamptz NOT NULL,
    lease_owner text,
    lease_expires_at timestamptz,
    last_error_code text CHECK (last_error_code IS NULL OR (btrim(last_error_code) <> '' AND length(last_error_code) <= 128)),
    requested_by_actor_id text NOT NULL,
    created_at timestamptz NOT NULL,
    completed_at timestamptz,
    updated_at timestamptz NOT NULL,
    UNIQUE (id, project_id),
    FOREIGN KEY (environment_id, project_id)
        REFERENCES environments(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (raw_input_id, project_id)
        REFERENCES billing_raw_inputs(id, project_id) ON DELETE RESTRICT,
    CHECK ((status = 'leased') = (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)),
    CHECK ((status IN ('completed', 'failed')) = (completed_at IS NOT NULL)),
    CONSTRAINT billing_replay_jobs_scope_shape_check CHECK (
        (raw_input_id IS NOT NULL AND window_start IS NULL AND window_end IS NULL) OR
        (raw_input_id IS NULL AND window_start IS NOT NULL AND window_end IS NOT NULL AND window_end > window_start)
    )
);
CREATE INDEX billing_replay_jobs_lease_idx
    ON billing_replay_jobs(available_at, created_at, id)
    WHERE status IN ('queued', 'leased');
CREATE INDEX billing_replay_jobs_history_idx
    ON billing_replay_jobs(environment_id, created_at DESC, id);

-- +goose Down
DROP TABLE billing_replay_jobs;
DROP TABLE billing_reconciliation_runs;
DROP TRIGGER billing_quarantine_actions_append_only ON billing_quarantine_actions;
DROP TABLE billing_quarantine_actions;
DROP TABLE billing_quarantine_records;
