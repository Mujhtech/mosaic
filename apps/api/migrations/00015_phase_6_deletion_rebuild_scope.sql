-- +goose Up
CREATE TABLE analytics_deletion_job_buckets (
    job_id text NOT NULL,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    bucket_date date NOT NULL,
    PRIMARY KEY (job_id, environment_id, bucket_date),
    FOREIGN KEY (job_id, project_id) REFERENCES analytics_deletion_jobs(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (environment_id, project_id) REFERENCES environments(id, project_id) ON DELETE RESTRICT
);

-- +goose Down
DROP TABLE analytics_deletion_job_buckets;
