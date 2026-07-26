-- +goose Up
ALTER TABLE analytics_deletion_jobs ADD COLUMN deletion_applied_at timestamptz;

-- +goose Down
ALTER TABLE analytics_deletion_jobs DROP COLUMN deletion_applied_at;
