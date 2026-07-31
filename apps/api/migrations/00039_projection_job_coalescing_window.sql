-- Phase 9B correction: coalesce projection triggers onto queued work only.
--
-- Migration 00032 made the scope-key coalescing index partial over
-- `status IN ('queued','leased')`, so a trigger arriving while a projection was
-- already leased was silently absorbed. That is correct for a duplicate trigger
-- and wrong for a new one: a fact committed after the running job read its
-- input is not covered by that job's output, so absorbing its trigger left the
-- customer's access stale until some unrelated event happened to enqueue again.
-- For an expiration or a refund, "some unrelated event" can be never.
--
-- Coalescing on `queued` alone keeps the burst protection that matters — a
-- hundred facts for one customer still collapse into one waiting job — while
-- guaranteeing that work arriving during a run gets a run of its own. The two
-- jobs cannot interleave: the projection's transaction-scoped advisory lock
-- serializes them, and the compare-and-swap on current_projection_version makes
-- the loser retry against fresh input rather than overwrite.

-- +goose Up
DROP INDEX projection_jobs_scope_coalesce_idx;
CREATE UNIQUE INDEX projection_jobs_scope_coalesce_idx
    ON projection_jobs(scope_key)
    WHERE status = 'queued';

-- +goose Down
DROP INDEX projection_jobs_scope_coalesce_idx;
CREATE UNIQUE INDEX projection_jobs_scope_coalesce_idx
    ON projection_jobs(scope_key)
    WHERE status IN ('queued', 'leased');
