-- +goose Up
CREATE TABLE analytics_dirty_buckets (
    environment_id text NOT NULL,
    project_id text NOT NULL,
    bucket_date date NOT NULL,
    reason text NOT NULL CHECK (reason IN ('ingestion', 'late_event', 'privacy_deletion', 'retention')),
    marked_at timestamptz NOT NULL,
    PRIMARY KEY (environment_id, bucket_date),
    FOREIGN KEY (environment_id, project_id) REFERENCES environments(id, project_id) ON DELETE RESTRICT
);

CREATE TABLE analytics_aggregate_watermarks (
    environment_id text PRIMARY KEY,
    project_id text NOT NULL,
    latest_received_at timestamptz,
    latest_aggregated_at timestamptz,
    latest_bucket_date date,
    updated_at timestamptz NOT NULL,
    FOREIGN KEY (environment_id, project_id) REFERENCES environments(id, project_id) ON DELETE RESTRICT
);

CREATE TABLE analytics_daily_event_counts (
    id bigserial PRIMARY KEY,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    bucket_date date NOT NULL,
    event_name text NOT NULL,
    authority text NOT NULL CHECK (authority IN ('client_observed', 'trusted_server', 'provider_confirmed')),
    platform text NOT NULL CHECK (platform IN ('ios', 'android')),
    locale text NOT NULL,
    application_version text NOT NULL,
    placement_id text,
    paywall_version_id text,
    product_id text,
    provider text,
    event_count bigint NOT NULL CHECK (event_count >= 0),
    latest_received_at timestamptz NOT NULL,
    FOREIGN KEY (environment_id, project_id) REFERENCES environments(id, project_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX analytics_daily_event_counts_dimensions_key
    ON analytics_daily_event_counts(environment_id, bucket_date, event_name, authority, platform,
        locale, application_version, placement_id, paywall_version_id, product_id, provider) NULLS NOT DISTINCT;
CREATE INDEX analytics_daily_event_counts_query_idx
    ON analytics_daily_event_counts(environment_id, bucket_date, event_name);

CREATE TABLE analytics_daily_funnel_counts (
    id bigserial PRIMARY KEY,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    bucket_date date NOT NULL,
    metric_id text NOT NULL,
    authority text NOT NULL CHECK (authority IN ('client_observed', 'trusted_server', 'provider_confirmed')),
    platform text,
    locale text,
    placement_id text,
    paywall_version_id text,
    product_id text,
    provider text,
    numerator bigint NOT NULL CHECK (numerator >= 0),
    denominator bigint CHECK (denominator IS NULL OR denominator >= 0),
    latest_received_at timestamptz NOT NULL,
    FOREIGN KEY (environment_id, project_id) REFERENCES environments(id, project_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX analytics_daily_funnel_counts_dimensions_key
    ON analytics_daily_funnel_counts(environment_id, bucket_date, metric_id, authority,
        platform, locale, placement_id, paywall_version_id, product_id, provider) NULLS NOT DISTINCT;
CREATE INDEX analytics_daily_funnel_counts_query_idx
    ON analytics_daily_funnel_counts(environment_id, bucket_date, metric_id);

CREATE TABLE analytics_aggregation_jobs (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    bucket_date date NOT NULL,
    status text NOT NULL CHECK (status IN ('queued', 'leased', 'completed', 'failed')),
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 10),
    available_at timestamptz NOT NULL,
    lease_owner text,
    lease_expires_at timestamptz,
    last_error_code text,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    UNIQUE (environment_id, bucket_date),
    FOREIGN KEY (environment_id, project_id) REFERENCES environments(id, project_id) ON DELETE RESTRICT,
    CHECK ((status = 'leased') = (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL))
);
CREATE INDEX analytics_aggregation_jobs_lease_idx
    ON analytics_aggregation_jobs(available_at, created_at, id)
    WHERE status IN ('queued', 'leased');

-- +goose Down
DROP TABLE analytics_aggregation_jobs;
DROP TABLE analytics_daily_funnel_counts;
DROP TABLE analytics_daily_event_counts;
DROP TABLE analytics_aggregate_watermarks;
DROP TABLE analytics_dirty_buckets;
