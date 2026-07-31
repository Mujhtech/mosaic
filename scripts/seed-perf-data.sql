-- Seeds a worker backlog for latency and drain measurement.
-- See docs/backend/operations/performance.md.
--
-- Run only against a throwaway measurement database:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/seed-perf-data.sql
--
-- What this seeds and what it does NOT:
--
--   * It enqueues analytics aggregation jobs across a range of bucket dates for
--     every existing Environment. Aggregation jobs are unique per
--     (environment_id, bucket_date), so backlog depth is bounded by the number
--     of Environments times the number of days seeded.
--
--   * It does NOT insert analytics_events rows directly. Those rows carry
--     foreign keys to ingestion batches, API keys, installations, subjects, and
--     sessions, all of which the ingestion boundary creates together. Seeding
--     event volume goes through the real ingestion path instead:
--
--       loadgen -scenario ingest -url http://localhost:8080 -key <public sdk key> \
--               -batch 100 -c 8 -d 5m
--
--     That guarantees every invariant the application enforces still holds, so
--     the measured read paths run against data shaped exactly like production.
--
-- Adjust the seeded window with -v days=<n> (default 365).

\set ON_ERROR_STOP on
\if :{?days}
\else
\set days 365
\endif

BEGIN;

INSERT INTO analytics_aggregation_jobs (
    id, project_id, environment_id, bucket_date, status,
    attempt_count, max_attempts, available_at, created_at, updated_at
)
SELECT
    'perf_aggregate_' || e.id || '_' || to_char(bucket, 'YYYYMMDD'),
    e.project_id,
    e.id,
    bucket,
    'queued',
    0,
    5,
    now(),
    now(),
    now()
FROM environments e
CROSS JOIN generate_series(
    (current_date - (:days)::integer),
    (current_date - 1),
    interval '1 day'
) AS bucket
ON CONFLICT (environment_id, bucket_date) DO NOTHING;

COMMIT;

ANALYZE analytics_aggregation_jobs;

SELECT
    count(*) FILTER (WHERE status IN ('queued', 'leased')) AS pending_aggregation_jobs,
    min(available_at) AS oldest_available_at
FROM analytics_aggregation_jobs;
