-- Phase 9B correction (review finding I-10): identity conflicts are not always
-- about a lineage.
--
-- Migration 00030 modelled every identity conflict as a dispute over one
-- purchase lineage, because that was the only conflict the resolver could
-- produce. Two more conflicts exist and had nowhere to live:
--
--   1. A lineage already attached to a customer whose evidence now names a
--      different one. The service used to move the pointer silently on
--      higher-authority evidence, leaving no operator record and a previously
--      granted customer whose committed snapshot still granted the purchase.
--      That is lineage-scoped and fits the existing shape; it gains only a
--      diagnostic code, carried in the existing `detail` column.
--   2. An application-user alias that already resolves to a different
--      customer (plan §5a rule 4). This disputes no lineage at all, so
--      `purchase_lineage_id` becomes nullable and the row instead names the
--      alias family and digest in dispute.
--
-- The alias digest is stored, never rendered: it is the same domain-separated
-- SHA-256 already held in billing_customer_aliases, and it is what makes "one
-- open conflict per disputed alias" enforceable by the database rather than by
-- application logic that a race can lose.

-- +goose Up
ALTER TABLE billing_identity_conflicts
    ADD COLUMN conflict_scope text NOT NULL DEFAULT 'lineage'
        CHECK (conflict_scope IN ('lineage', 'alias')),
    ADD COLUMN alias_type text CHECK (alias_type IS NULL OR alias_type IN (
        'application_user_id', 'installation_id',
        'apple_app_account_token', 'google_obfuscated_account_id'
    )),
    ADD COLUMN alias_digest bytea,
    ALTER COLUMN purchase_lineage_id DROP NOT NULL;

-- Exactly one dispute subject per row. Without this a row could name both a
-- lineage and an alias, and the resolution action would be ambiguous.
ALTER TABLE billing_identity_conflicts
    ADD CONSTRAINT billing_identity_conflicts_scope_shape CHECK (
        (conflict_scope = 'lineage'
            AND purchase_lineage_id IS NOT NULL
            AND alias_type IS NULL AND alias_digest IS NULL)
        OR (conflict_scope = 'alias'
            AND purchase_lineage_id IS NULL
            AND alias_type IS NOT NULL
            AND alias_digest IS NOT NULL AND octet_length(alias_digest) = 32)
    );

-- One open conflict per disputed subject. The lineage index keeps its former
-- meaning and is re-scoped so alias rows, whose lineage is NULL, cannot
-- collide with it.
DROP INDEX billing_identity_conflicts_open_idx;
CREATE UNIQUE INDEX billing_identity_conflicts_open_lineage_idx
    ON billing_identity_conflicts(purchase_lineage_id)
    WHERE status = 'open' AND conflict_scope = 'lineage';
CREATE UNIQUE INDEX billing_identity_conflicts_open_alias_idx
    ON billing_identity_conflicts(project_id, alias_type, alias_digest)
    WHERE status = 'open' AND conflict_scope = 'alias';

-- Operator listing is by Project and status; without this the conflicts page
-- scans the table once the first Project accumulates history.
CREATE INDEX billing_identity_conflicts_project_status_idx
    ON billing_identity_conflicts(project_id, status, opened_at DESC);

-- +goose Down
DROP INDEX billing_identity_conflicts_project_status_idx;
DROP INDEX billing_identity_conflicts_open_alias_idx;
DROP INDEX billing_identity_conflicts_open_lineage_idx;
CREATE UNIQUE INDEX billing_identity_conflicts_open_idx
    ON billing_identity_conflicts(purchase_lineage_id)
    WHERE status = 'open';
ALTER TABLE billing_identity_conflicts
    DROP CONSTRAINT billing_identity_conflicts_scope_shape;
DELETE FROM billing_identity_conflicts WHERE purchase_lineage_id IS NULL;
ALTER TABLE billing_identity_conflicts
    ALTER COLUMN purchase_lineage_id SET NOT NULL,
    DROP COLUMN alias_digest,
    DROP COLUMN alias_type,
    DROP COLUMN conflict_scope;
