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
