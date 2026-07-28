-- Phase 9B review correction I-14.3: make a cross-Project supersession pointer
-- unrepresentable.
--
-- Migration 00031 declared `superseded_by_lineage_id` as a single-column
-- self-reference to purchase_lineages(id). Every other relationship in 9B is a
-- composite (id, project_id) foreign key precisely so tenancy is a schema
-- property rather than an application convention — this one was the exception,
-- and it permitted one Project's lineage to point at another Project's lineage.
-- The projection treats that edge as terminal (a superseded lineage stops
-- granting access), so a wrong or malicious pointer written by any code path
-- that forgets a Project check is a cross-tenant access revocation.
--
-- The composite FK is the same shape as the lineage's own
-- billing_customer_id/project_id and application_id/project_id references, and
-- purchase_lineages already carries the UNIQUE (id, project_id) the reference
-- requires.
--
-- The self-referencing CHECK forbidding a lineage from superseding itself is
-- unaffected and stays where 00031 put it.

-- +goose Up
ALTER TABLE purchase_lineages
    DROP CONSTRAINT purchase_lineages_superseded_by_lineage_id_fkey;
ALTER TABLE purchase_lineages
    ADD CONSTRAINT purchase_lineages_superseded_by_lineage_fkey
        FOREIGN KEY (superseded_by_lineage_id, project_id)
        REFERENCES purchase_lineages(id, project_id) ON DELETE RESTRICT;

-- +goose Down
-- Rolling back widens the constraint, so it cannot fail on existing data: every
-- row satisfying the composite reference also satisfies the single-column one.
ALTER TABLE purchase_lineages
    DROP CONSTRAINT purchase_lineages_superseded_by_lineage_fkey;
ALTER TABLE purchase_lineages
    ADD CONSTRAINT purchase_lineages_superseded_by_lineage_id_fkey
        FOREIGN KEY (superseded_by_lineage_id)
        REFERENCES purchase_lineages(id) ON DELETE RESTRICT;
