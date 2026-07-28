-- Phase 9A fix pass: give replay a resumable cursor.
--
-- billing_reconciliation_runs already carried cursor_token, and the Apple
-- notification-history strategy used it correctly. Window replay and the Google
-- token re-query did not: both scanned exactly one batch and then reported
-- `completed`, so an operator replaying a week containing four hundred inputs
-- saw twenty-five revalidated and a verdict of "identical". In an evidence
-- system a `completed` verdict over a silently partial scan is worse than an
-- outright failure, because it is indistinguishable from a real one.
--
-- The cursor is the keyset position of the last input examined, not an offset:
-- inputs are ordered by (received_at, id), which is stable under concurrent
-- appends, so resuming after the recorded position cannot skip or repeat a row.

-- +goose Up

ALTER TABLE billing_replay_jobs
    ADD COLUMN cursor_received_at timestamptz,
    ADD COLUMN cursor_input_id text,
    -- Both halves of a keyset position are meaningless alone.
    ADD CONSTRAINT billing_replay_jobs_cursor_shape_check
        CHECK ((cursor_received_at IS NULL) = (cursor_input_id IS NULL));

-- Gate 9A requires reconciliation to detect missing *or conflicting* state.
-- Missing state was detected; conflicting state had no category at all, so a
-- provider answer that contradicted a recorded fact was counted as a discovery
-- and was indistinguishable from newly learned information. Replay already had
-- the vocabulary; reconciliation gains the same counter.
ALTER TABLE billing_reconciliation_runs
    ADD COLUMN conflict_count bigint NOT NULL DEFAULT 0 CHECK (conflict_count >= 0);

-- The same keyset shape for reconciliation. cursor_token stays as it is: it
-- carries Apple's opaque pagination token, which is a provider position rather
-- than a Mosaic row position, and the two must not share a column.
ALTER TABLE billing_reconciliation_runs
    ADD COLUMN cursor_received_at timestamptz,
    ADD COLUMN cursor_input_id text,
    ADD CONSTRAINT billing_reconciliation_runs_cursor_shape_check
        CHECK ((cursor_received_at IS NULL) = (cursor_input_id IS NULL));

-- Resuming reads inputs in (received_at, id) order inside one Environment.
-- Without this index every resume degrades into a scan of the Environment's
-- whole input history, which is the table that grows fastest in this phase.
CREATE INDEX billing_raw_inputs_replay_cursor_idx
    ON billing_raw_inputs(project_id, environment_id, received_at, id)
    WHERE body_state = 'stored';

-- Revoking an Apple Store Server Credential was impossible.
--
-- RevokeCredential clears intake_token_digest — that is what actually stops the
-- notification endpoint resolving, and it is the entire point of revoking after
-- a suspected compromise — but the Apple shape CHECK required the digest to be
-- present for every app_store row regardless of status. The UPDATE therefore
-- failed with a constraint violation, so an operator responding to a leaked
-- intake token had no way to close it.
--
-- The requirement is narrowed to active credentials, which is where it belongs:
-- a live Apple credential must be reachable, a revoked one must not be.
ALTER TABLE store_server_credentials
    DROP CONSTRAINT store_server_credentials_apple_shape_check,
    ADD CONSTRAINT store_server_credentials_apple_shape_check CHECK (
        provider <> 'app_store' OR (
            credential_class = 'appleInAppPurchaseKey' AND
            apple_issuer_id IS NOT NULL AND apple_key_id IS NOT NULL AND
            (status <> 'active' OR intake_token_digest IS NOT NULL) AND
            google_client_email IS NULL AND google_pubsub_project_id IS NULL AND
            google_pubsub_subscription_id IS NULL
        )
    );

-- +goose Down
ALTER TABLE store_server_credentials
    DROP CONSTRAINT store_server_credentials_apple_shape_check,
    ADD CONSTRAINT store_server_credentials_apple_shape_check CHECK (
        provider <> 'app_store' OR (
            credential_class = 'appleInAppPurchaseKey' AND
            apple_issuer_id IS NOT NULL AND apple_key_id IS NOT NULL AND
            intake_token_digest IS NOT NULL AND
            google_client_email IS NULL AND google_pubsub_project_id IS NULL AND
            google_pubsub_subscription_id IS NULL
        )
    );
DROP INDEX billing_raw_inputs_replay_cursor_idx;
ALTER TABLE billing_reconciliation_runs
    DROP CONSTRAINT billing_reconciliation_runs_cursor_shape_check,
    DROP COLUMN cursor_input_id,
    DROP COLUMN cursor_received_at,
    DROP COLUMN conflict_count;
ALTER TABLE billing_replay_jobs
    DROP CONSTRAINT billing_replay_jobs_cursor_shape_check,
    DROP COLUMN cursor_input_id,
    DROP COLUMN cursor_received_at;
