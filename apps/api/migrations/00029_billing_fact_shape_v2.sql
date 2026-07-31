-- Phase 9B fact-shape pass (plan §8, validator version 2).
--
-- Additive columns for provider statements that validator 1 parsed but never
-- persisted (quality finding B10): grace end, billing retry, scheduled renewal
-- product, upgrade marker, revocation reason, refund type, ownership type,
-- subscription group — plus a recovered provider event time for Google facts,
-- whose occurred_at is the lineage-constant startTime and would otherwise tie
-- during canonical ordering. Every column is nullable because existing v1
-- facts are immutable and are never rewritten; all of them participate in
-- FactDigest under validator version 2.
--
-- Stated consequence of the validator bump (OD-13, review finding I-13):
-- validator version 2 mints a SECOND fact for a provider transaction that was
-- already recorded under validator version 1.
--
-- Fact identity is UNIQUE (environment_id, fact_digest), and FactDigest covers
-- the validator version and every column above. Re-validating a 9A input under
-- validator 2 therefore recomputes a different digest and inserts a new row
-- rather than colliding with the v1 row. Both rows describe the same provider
-- transaction. Neither is rewritten: 9A facts are immutable, which is the whole
-- reason the duplicate exists instead of an UPDATE.
--
-- Where that duplication is absorbed, and where it is not:
--
--   Access: absorbed. An Entitlement Source's identity is (purchase lineage,
--   product, grant version) — never a fact id — so two facts describing one
--   purchase produce one source and one grant. The projection engine is a fold
--   over the ordered timeline in which a restatement of the current position
--   changes nothing, so the derived snapshot and its checksum are unchanged.
--   This is why revalidation is safe to run.
--
--   Timeline: NOT absorbed. subscription_timeline_entries emits one entry per
--   fact that changes the story, and a v2 restatement of a v1 fact is a
--   distinct fact id. A customer's timeline can therefore show the same
--   purchase, renewal, or refund twice after a revalidation pass. The entries
--   are append-only and are explanations rather than state, so the duplication
--   is cosmetic — but it is customer-visible in the operator console and in any
--   surface that renders the timeline, and it is not deduplicated anywhere.
--
--   subscription_snapshot_facts: NOT absorbed. The snapshot-to-fact evidence
--   join lists every source fact by id, so a revalidated lineage cites both the
--   v1 and the v2 fact for the same provider statement. Counting rows there is
--   not a count of provider statements after a validator bump.
--
-- Removing either duplication would mean either rewriting immutable 9A facts or
-- teaching the timeline a cross-validator identity that facts deliberately do
-- not carry. Both are worse than the stated consequence, so the consequence is
-- stated here rather than engineered away.
--
-- Also extends the quarantine reason vocabulary with
-- 'missing_provider_timestamp' (9A correction B7): an input whose provider
-- payload carries no usable timestamp quarantines instead of producing a fact
-- dated with worker wall-clock.

-- +goose Up
ALTER TABLE billing_transaction_facts
    ADD COLUMN grace_period_expires_at timestamptz,
    ADD COLUMN billing_retry_active boolean,
    ADD COLUMN auto_renew_product_identifier text CHECK (
        auto_renew_product_identifier IS NULL OR
        (btrim(auto_renew_product_identifier) <> '' AND length(auto_renew_product_identifier) <= 255)
    ),
    ADD COLUMN is_upgraded boolean,
    ADD COLUMN revocation_reason integer CHECK (revocation_reason IS NULL OR revocation_reason >= 0),
    ADD COLUMN refund_type text CHECK (
        refund_type IS NULL OR refund_type IN ('full', 'prorated', 'quantity_partial')
    ),
    ADD COLUMN in_app_ownership_type text CHECK (
        in_app_ownership_type IS NULL OR
        (btrim(in_app_ownership_type) <> '' AND length(in_app_ownership_type) <= 64)
    ),
    ADD COLUMN subscription_group_identifier text CHECK (
        subscription_group_identifier IS NULL OR
        (btrim(subscription_group_identifier) <> '' AND length(subscription_group_identifier) <= 128)
    ),
    ADD COLUMN provider_event_occurred_at timestamptz;

ALTER TABLE billing_quarantine_records
    DROP CONSTRAINT billing_quarantine_records_reason_code_check;
ALTER TABLE billing_quarantine_records
    ADD CONSTRAINT billing_quarantine_records_reason_code_check CHECK (reason_code IN (
        'signature_invalid', 'application_mismatch', 'environment_mismatch',
        'store_environment_mismatch', 'credential_unavailable', 'credential_revoked',
        'missing_validation_credential', 'missing_provider_timestamp',
        'product_unknown', 'product_ambiguous', 'cross_environment_mismatch',
        'unsupported_product_type', 'unsupported_transaction_type',
        'malformed_reference', 'input_content_conflict', 'replay_conflict',
        'provider_permanently_failed', 'validation_exhausted'
    ));

-- +goose Down
-- Quarantine rows carrying the new reason must go before the narrower CHECK
-- can return; the raw inputs, attempts, and ledger entries behind them all
-- survive (same rationale as migration 00026's down path).
ALTER TABLE billing_quarantine_actions DISABLE TRIGGER billing_quarantine_actions_append_only;
DELETE FROM billing_quarantine_actions
    WHERE quarantine_record_id IN (
        SELECT id FROM billing_quarantine_records WHERE reason_code = 'missing_provider_timestamp');
ALTER TABLE billing_quarantine_actions ENABLE TRIGGER billing_quarantine_actions_append_only;
DELETE FROM billing_quarantine_records WHERE reason_code = 'missing_provider_timestamp';

ALTER TABLE billing_quarantine_records
    DROP CONSTRAINT billing_quarantine_records_reason_code_check;
ALTER TABLE billing_quarantine_records
    ADD CONSTRAINT billing_quarantine_records_reason_code_check CHECK (reason_code IN (
        'signature_invalid', 'application_mismatch', 'environment_mismatch',
        'store_environment_mismatch', 'credential_unavailable', 'credential_revoked',
        'missing_validation_credential',
        'product_unknown', 'product_ambiguous', 'cross_environment_mismatch',
        'unsupported_product_type', 'unsupported_transaction_type',
        'malformed_reference', 'input_content_conflict', 'replay_conflict',
        'provider_permanently_failed', 'validation_exhausted'
    ));

-- Dropping the v2 columns is plain DDL; the append-only trigger guards only
-- row UPDATE/DELETE and does not need to be lifted.
ALTER TABLE billing_transaction_facts
    DROP COLUMN grace_period_expires_at,
    DROP COLUMN billing_retry_active,
    DROP COLUMN auto_renew_product_identifier,
    DROP COLUMN is_upgraded,
    DROP COLUMN revocation_reason,
    DROP COLUMN refund_type,
    DROP COLUMN in_app_ownership_type,
    DROP COLUMN subscription_group_identifier,
    DROP COLUMN provider_event_occurred_at;
