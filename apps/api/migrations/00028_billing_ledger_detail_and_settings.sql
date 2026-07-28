-- Phase 9A fix pass round 2: make the ledger detail guard exhaustive.
--
-- `billing_ledger_entries_safe_detail_check` banned a list of key names with
-- `detail ?| ARRAY[...]`, which tests **top-level keys only**. A nested value
-- such as {"provider":{"purchaseToken":"…"}} passed it untouched, so the
-- constraint that exists specifically to keep bearer material out of the
-- operator-readable ledger could be stepped around by one level of nesting.
--
-- Rather than walk the document recursively, `detail` is constrained to what
-- the application already writes: a flat object of string values. That makes
-- the top-level key check exhaustive by construction, and it removes the whole
-- category of "a future caller nests something" rather than chasing it.
--
-- The key rule is also widened from an exact list to a pattern. An exact list
-- has to be maintained in step with every new field name and fails open on the
-- adjacent one — `googlePurchaseToken` was not on it.

-- +goose Up

-- +goose StatementBegin
CREATE FUNCTION billing_ledger_detail_is_safe(detail jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT bool_and(
        jsonb_typeof(value) = 'string'
        AND key !~* '(token|receipt|secret|password|authoriz|bearer|credential|signed|private|payload)'
    ) IS NOT FALSE
    FROM jsonb_each(detail)
$$;
-- +goose StatementEnd

ALTER TABLE billing_ledger_entries
    DROP CONSTRAINT billing_ledger_entries_safe_detail_check,
    ADD CONSTRAINT billing_ledger_entries_safe_detail_check CHECK (
        jsonb_typeof(detail) = 'object' AND
        octet_length(detail::text) <= 2048 AND
        billing_ledger_detail_is_safe(detail)
    );

-- +goose Down
ALTER TABLE billing_ledger_entries
    DROP CONSTRAINT billing_ledger_entries_safe_detail_check,
    ADD CONSTRAINT billing_ledger_entries_safe_detail_check CHECK (
        jsonb_typeof(detail) = 'object' AND
        octet_length(detail::text) <= 2048 AND
        NOT (detail ?| ARRAY[
            'token', 'purchaseToken', 'receipt', 'signedPayload', 'signedTransactionInfo',
            'signedRenewalInfo', 'credential', 'secret', 'password', 'authorization',
            'bearer', 'appAccountToken', 'privateKey'
        ])
    );
DROP FUNCTION billing_ledger_detail_is_safe(jsonb);
