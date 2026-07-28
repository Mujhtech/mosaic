-- Phase 9B review correction I-4: a quarantine reason for "this Google voided
-- purchase was recorded as a refund, but Mosaic could not attribute it to a
-- Product".
--
-- Before this migration the void path had no way to record such a refund at
-- all. A voided-purchase notification carries no SKU; the SKU was recovered
-- from orders.get, and only when the order held exactly one line item. Every
-- other shape — a multi-line-item order, or an orders.get that failed
-- permanently — produced no Transaction Fact, so the refunded purchase kept
-- granting its Entitlement indefinitely.
--
-- The worker now records a refund fact with resolution_state = 'unresolved',
-- which projects the purchase as `unknown` rather than `owned`, and quarantines
-- the input under this reason. It is deliberately not 'product_unknown' or
-- 'malformed_reference': those say "an input could not be validated", while this
-- one says "revenue was refunded, access has been corrected to unknown, and a
-- Product attribution is still owed". The three have different operator actions
-- and different severities, so they get different codes.
--
-- The CHECK is recreated rather than widened in place because PostgreSQL has no
-- ALTER ... MODIFY CHECK; dropping and adding inside one migration is atomic
-- (same pattern as 00026 and 00029).

-- +goose Up
ALTER TABLE billing_quarantine_records
    DROP CONSTRAINT billing_quarantine_records_reason_code_check;
ALTER TABLE billing_quarantine_records
    ADD CONSTRAINT billing_quarantine_records_reason_code_check CHECK (reason_code IN (
        'signature_invalid', 'application_mismatch', 'environment_mismatch',
        'store_environment_mismatch', 'credential_unavailable', 'credential_revoked',
        'missing_validation_credential', 'missing_provider_timestamp',
        'product_unknown', 'product_ambiguous', 'cross_environment_mismatch',
        'unsupported_product_type', 'unsupported_transaction_type',
        'void_product_unresolved',
        'malformed_reference', 'input_content_conflict', 'replay_conflict',
        'provider_permanently_failed', 'validation_exhausted'
    ));

-- +goose Down
-- Quarantine rows carrying the new reason must go before the narrower CHECK can
-- return. They are work items rather than ledger evidence: the Raw Billing
-- Input, its validation attempts, its ledger entries, and — importantly — the
-- refund Transaction Fact itself all survive, so nothing that records what the
-- pipeline did or what the provider said is lost (same rationale as 00026 and
-- 00029). The append-only trigger on the action audit is disabled only for the
-- length of the delete.
ALTER TABLE billing_quarantine_actions DISABLE TRIGGER billing_quarantine_actions_append_only;
DELETE FROM billing_quarantine_actions
    WHERE quarantine_record_id IN (
        SELECT id FROM billing_quarantine_records WHERE reason_code = 'void_product_unresolved');
ALTER TABLE billing_quarantine_actions ENABLE TRIGGER billing_quarantine_actions_append_only;
DELETE FROM billing_quarantine_records WHERE reason_code = 'void_product_unresolved';

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
