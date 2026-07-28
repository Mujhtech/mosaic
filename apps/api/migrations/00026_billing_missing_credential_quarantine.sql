-- +goose Up
-- Phase 9A follow-up: a quarantine reason for "this Environment has no Store
-- Server Credential for this provider".
--
-- Before this migration the only reason available was 'credential_unavailable',
-- which is the code for a credential that exists but cannot be used (revoked,
-- undecryptable, wrong key). Reporting an absent connection under that code
-- sends an operator to rotate a credential that does not exist. The two
-- failures have different causes, different fixes, and different severities, so
-- they get different codes.
--
-- The CHECK is recreated rather than widened in place because PostgreSQL has no
-- ALTER ... MODIFY CHECK; dropping and adding inside one migration is atomic.
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

-- +goose Down
-- Rolling back has to remove rows carrying the new code, because the narrower
-- CHECK cannot be re-added while they exist. They are quarantine work items
-- rather than ledger evidence: the Raw Billing Input, its validation attempts,
-- and its ledger entries all survive, so nothing that records what the pipeline
-- did is lost. The append-only trigger on the action audit is disabled only for
-- the length of the delete.
ALTER TABLE billing_quarantine_actions DISABLE TRIGGER billing_quarantine_actions_append_only;
DELETE FROM billing_quarantine_actions
    WHERE quarantine_record_id IN (
        SELECT id FROM billing_quarantine_records WHERE reason_code = 'missing_validation_credential');
ALTER TABLE billing_quarantine_actions ENABLE TRIGGER billing_quarantine_actions_append_only;
DELETE FROM billing_quarantine_records WHERE reason_code = 'missing_validation_credential';

ALTER TABLE billing_quarantine_records
    DROP CONSTRAINT billing_quarantine_records_reason_code_check;
ALTER TABLE billing_quarantine_records
    ADD CONSTRAINT billing_quarantine_records_reason_code_check CHECK (reason_code IN (
        'signature_invalid', 'application_mismatch', 'environment_mismatch',
        'store_environment_mismatch', 'credential_unavailable', 'credential_revoked',
        'product_unknown', 'product_ambiguous', 'cross_environment_mismatch',
        'unsupported_product_type', 'unsupported_transaction_type',
        'malformed_reference', 'input_content_conflict', 'replay_conflict',
        'provider_permanently_failed', 'validation_exhausted'
    ));
