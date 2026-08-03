-- Fallback-audit remediation (backend #11): a failure category for a provider
-- response Mosaic's classification rules do not describe.
--
-- The default arm of both provider classifiers folded an unrecognised HTTP
-- status into `invalid`, non-retryable. `invalid` means "the request was
-- wrong", and non-retryable means "this input can never validate" — two
-- assertions made on the strength of a status nobody had a rule for. The input
-- then quarantined as `provider_permanently_failed` and the purchase behind it
-- stopped being re-examined.
--
-- `unclassified` says only what is true: the response was not understood. It is
-- retryable under its own low cap (billing.MaxUnclassifiedAttempts), so a
-- transient oddity recovers and a persistent one still reaches an operator
-- quickly, under a diagnostic that distinguishes "not understood" from
-- "rejected".
--
-- The CHECK is recreated rather than widened in place (same pattern as 00026,
-- 00029, 00045, and 00062).

-- +goose Up
ALTER TABLE billing_validation_attempts
    DROP CONSTRAINT billing_validation_attempts_failure_category_check;
ALTER TABLE billing_validation_attempts
    ADD CONSTRAINT billing_validation_attempts_failure_category_check CHECK (
        failure_category IS NULL OR failure_category IN (
            'transient', 'rate_limited', 'auth', 'quota', 'not_found_retryable',
            'not_found_terminal', 'invalid', 'signature', 'resolution', 'configuration',
            'unclassified'
        ));

-- +goose Down
-- Validation attempts are append-only evidence and are never deleted. Rows
-- already carrying the new category are relabelled to the value they would have
-- had before this migration, so the narrower CHECK can return without losing an
-- attempt record. The append-only trigger is disabled only for the length of
-- the relabel.
ALTER TABLE billing_validation_attempts DISABLE TRIGGER USER;
UPDATE billing_validation_attempts SET failure_category = 'invalid'
    WHERE failure_category = 'unclassified';
ALTER TABLE billing_validation_attempts ENABLE TRIGGER USER;

ALTER TABLE billing_validation_attempts
    DROP CONSTRAINT billing_validation_attempts_failure_category_check;
ALTER TABLE billing_validation_attempts
    ADD CONSTRAINT billing_validation_attempts_failure_category_check CHECK (
        failure_category IS NULL OR failure_category IN (
            'transient', 'rate_limited', 'auth', 'quota', 'not_found_retryable',
            'not_found_terminal', 'invalid', 'signature', 'resolution', 'configuration'
        ));
