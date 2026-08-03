-- Fallback-audit remediation (backend #2 / theme T3): make a grant version's
-- coverage an explicit statement rather than something the schema guesses.
--
-- Two fail-open shapes met here. `supported_purchase_types` could be an empty
-- array, and the projection read an empty list as "covers every purchase type"
-- — so the least-specified grant row was the widest possible grant. And every
-- access-granting policy column carried DEFAULT true, so any INSERT that simply
-- omitted them granted active, trial, grace, and one-time ownership access.
-- Together, a row written by a partial or buggy insert over-granted in exactly
-- the direction that costs money.
--
-- `billingprojection.supportsPurchaseType` now refuses to match an empty list.
-- This migration makes that reading safe by turning "non-empty" into an
-- invariant the database holds, matching what `billinggrant.ValidateShape`
-- already refuses at the API boundary, and removes the granting defaults so an
-- insert must say what it grants. The closed-by-default columns
-- (`grants_in_billing_retry`, `grants_in_paused`) keep their `false` defaults:
-- omitting them cannot over-grant.
--
-- The CHECK is validated against existing rows deliberately. The 00033 column
-- default is a non-empty array and the only production writer names every
-- column, so no row should violate it; if one does, an operator needs to know
-- that access has been computed from a grant that states no coverage.

-- +goose Up
ALTER TABLE product_entitlement_grant_versions
    ADD CONSTRAINT product_entitlement_grant_versions_purchase_types_present
    CHECK (cardinality(supported_purchase_types) > 0);

ALTER TABLE product_entitlement_grant_versions ALTER COLUMN supported_purchase_types DROP DEFAULT;
ALTER TABLE product_entitlement_grant_versions ALTER COLUMN grants_in_active DROP DEFAULT;
ALTER TABLE product_entitlement_grant_versions ALTER COLUMN grants_in_trial DROP DEFAULT;
ALTER TABLE product_entitlement_grant_versions ALTER COLUMN grants_in_grace DROP DEFAULT;
ALTER TABLE product_entitlement_grant_versions ALTER COLUMN grants_in_one_time_ownership DROP DEFAULT;

-- +goose Down
ALTER TABLE product_entitlement_grant_versions
    ALTER COLUMN supported_purchase_types
    SET DEFAULT ARRAY['auto_renewable_subscription','non_consumable']::text[];
ALTER TABLE product_entitlement_grant_versions ALTER COLUMN grants_in_active SET DEFAULT true;
ALTER TABLE product_entitlement_grant_versions ALTER COLUMN grants_in_trial SET DEFAULT true;
ALTER TABLE product_entitlement_grant_versions ALTER COLUMN grants_in_grace SET DEFAULT true;
ALTER TABLE product_entitlement_grant_versions ALTER COLUMN grants_in_one_time_ownership SET DEFAULT true;

ALTER TABLE product_entitlement_grant_versions
    DROP CONSTRAINT product_entitlement_grant_versions_purchase_types_present;
