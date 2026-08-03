-- Fallback-audit remediation (backend #1 / theme T2): a quarantine reason for
-- "the provider named a lifecycle state Mosaic has no honest Fact Kind for".
--
-- Both provider paths used to fall back to `initial_purchase` on an unmapped
-- state: Apple when `transactionReason` was outside {PURCHASE, RENEWAL}, and
-- Google on any `subscriptionState` outside the mapped set — including
-- SUBSCRIPTION_STATE_PENDING, which is a signup *awaiting payment*. Because
-- `initial_purchase` is the one Fact Kind that grants an Entitlement, every
-- state either store added after that mapping was written silently granted
-- access, and an unpaid Play signup granted access immediately.
--
-- The worker now quarantines those inputs instead. No Transaction Fact is
-- written, so the purchase projects as `unknown` rather than `owned`, and the
-- diagnostic on the validation attempt distinguishes the three cases
-- (`unclassified_apple_transaction_reason`,
-- `unclassified_google_subscription_state`,
-- `unpaid_google_subscription_state_pending`).
--
-- The reason is deliberately not `unsupported_transaction_type`: that says
-- Mosaic does not model this *product*, while this says Mosaic models the
-- product but not what the provider claims happened to it. The operator action
-- differs — the first is permanent, the second is usually "Mosaic needs a
-- mapping" or "wait for the payment to settle and revalidate".
--
-- The CHECK is recreated rather than widened in place because PostgreSQL has no
-- ALTER ... MODIFY CHECK; dropping and adding inside one migration is atomic
-- (same pattern as 00026, 00029, and 00045).

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
        'void_product_unresolved', 'unclassified_provider_state',
        'malformed_reference', 'input_content_conflict', 'replay_conflict',
        'provider_permanently_failed', 'validation_exhausted'
    ));

-- +goose Down
-- Quarantine rows carrying the new reason must go before the narrower CHECK can
-- return. They are work items rather than ledger evidence: the Raw Billing
-- Input, its validation attempts, and its ledger entries all survive, so
-- nothing recording what the pipeline did or what the provider said is lost
-- (same rationale as 00026, 00029, and 00045). The append-only trigger on the
-- action audit is disabled only for the length of the delete.
ALTER TABLE billing_quarantine_actions DISABLE TRIGGER billing_quarantine_actions_append_only;
DELETE FROM billing_quarantine_actions
    WHERE quarantine_record_id IN (
        SELECT id FROM billing_quarantine_records WHERE reason_code = 'unclassified_provider_state');
ALTER TABLE billing_quarantine_actions ENABLE TRIGGER billing_quarantine_actions_append_only;
DELETE FROM billing_quarantine_records WHERE reason_code = 'unclassified_provider_state';

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
