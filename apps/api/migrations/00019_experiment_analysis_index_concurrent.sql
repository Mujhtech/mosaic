-- +goose NO TRANSACTION
-- +goose Up
-- Migration 00018 originally built this index inline. On a populated
-- analytics_events table a plain CREATE INDEX holds a SHARE lock for a full
-- table scan, which blocks event ingestion for the length of the upgrade.
-- Building it CONCURRENTLY keeps ingestion available. IF NOT EXISTS makes the
-- migration a no-op for databases that already applied 00018 with the inline
-- index (every v1.0.0-rc.1 installation).
CREATE INDEX CONCURRENTLY IF NOT EXISTS analytics_events_experiment_analysis_idx
    ON analytics_events(environment_id,experiment_version_id,experiment_variant_id,occurred_at,subject_id)
    WHERE experiment_version_id IS NOT NULL AND experiment_qa_override=false;

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS analytics_events_experiment_analysis_idx;
