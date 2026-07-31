-- Phase 9B WP9: make the OD-8 "prospective + replacement" grant policy
-- expressible.
--
-- 00033 gave `product_entitlement_grant_versions` a blanket append-only trigger
-- and a partial unique index permitting exactly one open-ended (current)
-- version per (product, entitlement). Together those two make replacement
-- impossible: publishing a new version requires closing the current one, the
-- unique index refuses a second open-ended row, and the trigger refuses the
-- UPDATE that would close the first. The management surface the dashboard needs
-- could not be built against that schema, which is why nothing has ever written
-- these rows at runtime.
--
-- The fix is not to relax immutability but to name it precisely. A grant
-- version's *meaning* — its policy columns, its start, its supported purchase
-- types, its author and reason — stays immutable. The only permitted change is
-- the one operation that is not a rewrite of meaning: closing an open interval
-- by setting `effective_end` once, from NULL, to a later instant. Everything
-- else, including reopening a closed interval, re-closing one at a different
-- time, and DELETE, is still refused by the database rather than by the
-- application.
--
-- Stating it as a trigger rather than a column-level grant matters: a
-- column-level restriction would still let one UPDATE close a version at an
-- instant that rewrites which version a historical purchase selects, and grant
-- selection by period effective time is the whole reason versions exist.

-- +goose Up

DROP TRIGGER product_entitlement_grant_versions_append_only
    ON product_entitlement_grant_versions;

-- +goose StatementBegin
CREATE FUNCTION reject_grant_version_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'product_entitlement_grant_versions is append-only; publish a superseding version'
            USING ERRCODE = '55000';
    END IF;

    -- A closed interval has already been superseded. Re-closing it at a
    -- different instant silently moves the boundary between two versions, and
    -- every purchase between the old and new boundary changes which grant it
    -- selects — retroactive access change with no version, no audit, and no
    -- additive-superset check.
    IF OLD.effective_end IS NOT NULL THEN
        RAISE EXCEPTION 'grant version % is already closed and cannot be reopened or re-closed', OLD.id
            USING ERRCODE = '55000';
    END IF;
    IF NEW.effective_end IS NULL THEN
        RAISE EXCEPTION 'the only permitted update to a grant version is closing it'
            USING ERRCODE = '55000';
    END IF;

    -- Every other column must be byte-identical. Closing a version is a
    -- statement about when it stopped applying, never about what it meant.
    IF (NEW.id, NEW.project_id, NEW.product_id, NEW.entitlement_id, NEW.version,
        NEW.grant_policy_version, NEW.effective_start, NEW.supported_purchase_types,
        NEW.grants_in_active, NEW.grants_in_trial, NEW.grants_in_grace,
        NEW.grants_in_billing_retry, NEW.grants_in_paused,
        NEW.grants_in_one_time_ownership, NEW.created_at, NEW.created_by_actor_id,
        NEW.reason)
       IS DISTINCT FROM
       (OLD.id, OLD.project_id, OLD.product_id, OLD.entitlement_id, OLD.version,
        OLD.grant_policy_version, OLD.effective_start, OLD.supported_purchase_types,
        OLD.grants_in_active, OLD.grants_in_trial, OLD.grants_in_grace,
        OLD.grants_in_billing_retry, OLD.grants_in_paused,
        OLD.grants_in_one_time_ownership, OLD.created_at, OLD.created_by_actor_id,
        OLD.reason)
    THEN
        RAISE EXCEPTION 'grant version % is immutable apart from its closing instant', OLD.id
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$;
-- +goose StatementEnd

CREATE TRIGGER product_entitlement_grant_versions_append_only
BEFORE UPDATE OR DELETE ON product_entitlement_grant_versions
FOR EACH ROW EXECUTE FUNCTION reject_grant_version_rewrite();

-- The publish path writes an audit event under the pair's advisory lock; this
-- index is what makes "show me this pair's history" a lookup rather than a scan
-- once a catalog has accumulated versions.
CREATE INDEX IF NOT EXISTS product_entitlement_grant_versions_history_idx
    ON product_entitlement_grant_versions(project_id, product_id, entitlement_id, version DESC);

-- +goose Down
DROP INDEX IF EXISTS product_entitlement_grant_versions_history_idx;
DROP TRIGGER product_entitlement_grant_versions_append_only
    ON product_entitlement_grant_versions;
DROP FUNCTION reject_grant_version_rewrite();
CREATE TRIGGER product_entitlement_grant_versions_append_only
BEFORE UPDATE OR DELETE ON product_entitlement_grant_versions
FOR EACH ROW EXECUTE FUNCTION reject_billing_append_only_change();
