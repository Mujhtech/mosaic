-- +goose Up
-- Experiment scheduling jobs had no retry budget and no backoff column, so a
-- transient failure marked the job permanently failed and an expired lease was
-- never reclaimed: a scheduled Experiment start or completion could be lost
-- silently. These columns bring the table in line with the analytics job tables.
ALTER TABLE experiment_scheduling_jobs
    ADD COLUMN max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),
    ADD COLUMN available_at timestamptz,
    ADD COLUMN last_error_code text;

UPDATE experiment_scheduling_jobs SET available_at = scheduled_at WHERE available_at IS NULL;

ALTER TABLE experiment_scheduling_jobs
    ALTER COLUMN available_at SET NOT NULL;

DROP INDEX experiment_scheduling_jobs_lease_idx;
CREATE INDEX experiment_scheduling_jobs_lease_idx
    ON experiment_scheduling_jobs(available_at, scheduled_at, id)
    WHERE status IN ('queued','leased');

-- +goose Down
DROP INDEX experiment_scheduling_jobs_lease_idx;
CREATE INDEX experiment_scheduling_jobs_lease_idx ON experiment_scheduling_jobs(scheduled_at,id) WHERE status IN ('queued','leased');
ALTER TABLE experiment_scheduling_jobs
    DROP COLUMN last_error_code,
    DROP COLUMN available_at,
    DROP COLUMN max_attempts;
