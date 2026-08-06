-- Analytics collection is enabled by default (owner decision).
--
-- Migration 00012 created `analytics_environment_settings.collection_enabled`
-- with a `false` default, so every Environment started with ingestion refused
-- and an owner or admin had to turn collection on before the SDKs could send a
-- single event. The overview surface reported every funnel metric as
-- `analytics_collection_disabled` until someone found the setting. The product
-- decision is that a new Mosaic install collects its own monetization events
-- without an operator step.
--
-- This changes three things that have to move together, or the default and the
-- data disagree:
--
--   1. the column default, so rows created from here on are enabled;
--   2. a settings row for every Environment that somehow lacks one, so the
--      absent-row case stays impossible and the repository's ErrNotFound stays
--      an honest error rather than a silent "disabled";
--   3. existing rows that nobody ever decided, flipped on. The owner explicitly
--      wants Environments that already exist collecting, not only ones created
--      after the upgrade — but an operator who deliberately turned collection
--      off is a decision this migration must not overrule.
--
-- The `initialize_analytics_environment_settings` trigger from 00012 inserts
-- without naming `collection_enabled`, so it picks up the new default with no
-- change of its own.

-- +goose Up
ALTER TABLE analytics_environment_settings
    ALTER COLUMN collection_enabled SET DEFAULT true;

-- Every Environment created since 00012 already has a row from the trigger.
-- This covers anything that predates it or was removed by hand, and is a no-op
-- on a healthy database. `raw_retention_days` is left to the column default so
-- the retention window is stated in exactly one place.
INSERT INTO analytics_environment_settings(environment_id, project_id, collection_enabled)
SELECT e.id, e.project_id, true
FROM environments e
WHERE NOT EXISTS (
    SELECT 1 FROM analytics_environment_settings s WHERE s.environment_id = e.id
);

-- Only rows nobody ever decided are flipped.
--
-- `updated_by_actor_id IS NULL` is exactly that set. 00012 created the column
-- with a `false` default and its `initialize_analytics_environment_settings`
-- trigger inserts without naming either column, so a row that has never been
-- through the settings endpoint carries no actor and reads `false` because
-- nothing decided otherwise. The settings endpoint always records the actor who
-- changed the setting, so a row reading `false` with an actor is an owner or
-- admin who deliberately turned collection off. Flipping those would silently
-- start collecting events for an Environment whose operator asked Mosaic not
-- to, and would erase the attribution that is the only record of their
-- decision. A privacy choice is not a stale default.
--
-- `updated_by_actor_id` stays NULL on the rows this does touch: no operator made
-- this choice for this Environment, and attributing a platform default to a
-- person would misreport who enabled collection. `updated_at` moves because the
-- setting genuinely changed, and the settings surface reads it as "when this was
-- last decided".
UPDATE analytics_environment_settings
SET collection_enabled = true, updated_at = now()
WHERE collection_enabled = false AND updated_by_actor_id IS NULL;

-- +goose Down
-- Only the default is restored. The flipped rows are deliberately left enabled.
--
-- After this migration has been applied, a row reading `true` is
-- indistinguishable from a row an owner enabled themselves afterwards, and
-- nothing records which rows this migration changed. Flipping every row back to
-- false on the way down would silently stop ingestion for Environments whose
-- operator explicitly asked for it, and the events lost while collection was
-- off can never be recovered — the SDKs drop rejected batches. A default that
-- disagrees with existing rows is the safe half of the rollback; discarding an
-- operator's decision is not.
--
-- Operators who need the pre-upgrade state restored for a specific Environment
-- should set it through
-- `PUT /v1/projects/{projectId}/environments/{environmentId}/analytics/settings`,
-- which records the actor who made the decision.
ALTER TABLE analytics_environment_settings
    ALTER COLUMN collection_enabled SET DEFAULT false;
