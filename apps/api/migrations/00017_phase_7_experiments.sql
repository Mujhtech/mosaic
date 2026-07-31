-- +goose Up
CREATE TABLE experiment_metric_definitions (
    id text NOT NULL,
    version integer NOT NULL CHECK (version > 0),
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    numerator_event text NOT NULL,
    denominator_event text NOT NULL,
    assignment_unit text NOT NULL CHECK (assignment_unit='assignment_key'),
    authority text NOT NULL CHECK (authority IN ('client_observed','provider_confirmed')),
    availability text NOT NULL CHECK (availability IN ('available','trusted_source_unavailable')),
    event_filter jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (event_filter IN ('{}'::jsonb,'{"payload.reason":"provider_unavailable"}'::jsonb)),
    attribution_window_seconds integer NOT NULL CHECK (attribution_window_seconds BETWEEN 0 AND 2592000),
    freshness_seconds integer NOT NULL CHECK (freshness_seconds BETWEEN 60 AND 86400),
    definition text NOT NULL,
    primary_eligible boolean NOT NULL,
    guardrail_eligible boolean NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (id, version)
);

INSERT INTO experiment_metric_definitions
(id,version,name,numerator_event,denominator_event,assignment_unit,authority,availability,event_filter,attribution_window_seconds,freshness_seconds,definition,primary_eligible,guardrail_eligible)
VALUES
('presentation_product_selection',1,'Presentation to product selection','product_selected','experiment_exposed','assignment_key','client_observed','available','{}',86400,900,'First product selection after the first qualifying exposure.',true,false),
('product_selection_purchase_start',1,'Product selection to purchase start','purchase_started','product_selected','assignment_key','client_observed','available','{}',86400,900,'First purchase start after product selection.',true,false),
('presentation_purchase_start',1,'Presentation to purchase start','purchase_started','experiment_exposed','assignment_key','client_observed','available','{}',86400,900,'First purchase start after the first qualifying exposure.',true,false),
('presentation_client_purchase',1,'Presentation to client-completed purchase','purchase_completed_client','experiment_exposed','assignment_key','client_observed','available','{}',86400,900,'First client-observed purchase completion after exposure.',true,false),
('presentation_provider_purchase',1,'Presentation to provider-confirmed purchase','purchase_completed_provider','experiment_exposed','assignment_key','provider_confirmed','trusted_source_unavailable','{}',86400,900,'Unavailable until a trusted provider-confirmation ingestion source exists.',true,false),
('purchase_failure',1,'Purchase failure','purchase_failed','experiment_exposed','assignment_key','client_observed','available','{}',86400,900,'Purchase failures after exposure.',false,true),
('purchase_cancellation',1,'Purchase cancellation','purchase_cancelled','experiment_exposed','assignment_key','client_observed','available','{}',86400,900,'Purchase cancellations after exposure.',false,true),
('product_unavailable',1,'Product unavailable','product_unavailable','experiment_exposed','assignment_key','client_observed','available','{}',86400,900,'Product readiness failures after assignment.',false,true),
('paywall_render_failure',1,'Paywall render failure','paywall_render_failed','experiment_assigned','assignment_key','client_observed','available','{}',86400,900,'Render failures after assignment.',false,true),
('provider_unavailable',1,'Provider unavailable','product_unavailable','experiment_assigned','assignment_key','client_observed','available','{"payload.reason":"provider_unavailable"}',86400,900,'Product-unavailable events whose typed reason is provider_unavailable.',false,true),
('fallback_exposure',1,'Fallback exposure','experiment_fallback_presented','experiment_assigned','assignment_key','client_observed','available','{}',86400,900,'Normal-placement fallback presentations after assignment.',false,true);

CREATE TABLE experiment_groups (
    id text PRIMARY KEY,
    project_id text NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    environment_id text NOT NULL,
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    status text NOT NULL CHECK (status IN ('active','archived')),
    created_by_actor_id text NOT NULL,
    created_at timestamptz NOT NULL,
    archived_at timestamptz,
    UNIQUE (id, project_id),
    FOREIGN KEY (environment_id, project_id) REFERENCES environments(id, project_id) ON DELETE RESTRICT
);
CREATE TABLE experiment_group_versions (
    id text PRIMARY KEY,
    group_id text NOT NULL,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    version_number integer NOT NULL CHECK (version_number > 0),
    assignment_key_policy text NOT NULL CHECK (assignment_key_policy IN ('installation','identified_user','identified_user_or_installation')),
    algorithm text NOT NULL CHECK (algorithm='experiment_group_sha256_length_prefixed_v1'),
    holdout_start integer,
    holdout_end integer,
    created_by_actor_id text NOT NULL,
    created_at timestamptz NOT NULL,
    UNIQUE (group_id, version_number), UNIQUE (id, project_id),
    FOREIGN KEY (group_id, project_id) REFERENCES experiment_groups(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (environment_id, project_id) REFERENCES environments(id, project_id) ON DELETE RESTRICT,
    CHECK ((holdout_start IS NULL)=(holdout_end IS NULL)),
    CHECK (holdout_start IS NULL OR (holdout_start > 0 AND holdout_start < 10000 AND holdout_end = 10000))
);

CREATE TABLE experiments (
    id text PRIMARY KEY,
    project_id text NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    environment_id text NOT NULL,
    placement_id text NOT NULL,
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    hypothesis text CHECK (hypothesis IS NULL OR char_length(hypothesis) <= 1000),
    state text NOT NULL CHECK (state IN ('draft','scheduled','running','paused','stopped','completed','archived')),
    current_draft_id text,
    active_version_id text,
    created_by_actor_id text NOT NULL,
    updated_by_actor_id text NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    archived_at timestamptz,
    UNIQUE (id, project_id), UNIQUE (id, environment_id),
    FOREIGN KEY (environment_id, project_id) REFERENCES environments(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (placement_id, project_id) REFERENCES placements(id, project_id) ON DELETE RESTRICT,
    CHECK ((state='archived')=(archived_at IS NOT NULL))
);

CREATE TABLE experiment_drafts (
    id text PRIMARY KEY,
    experiment_id text NOT NULL,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    current_revision integer NOT NULL CHECK (current_revision > 0),
    status text NOT NULL CHECK (status IN ('active','published','superseded')),
    created_by_actor_id text NOT NULL,
    updated_by_actor_id text NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    UNIQUE (experiment_id) DEFERRABLE INITIALLY IMMEDIATE,
    UNIQUE (id, project_id),
    FOREIGN KEY (experiment_id, project_id) REFERENCES experiments(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (environment_id, project_id) REFERENCES environments(id, project_id) ON DELETE RESTRICT
);
ALTER TABLE experiments ADD CONSTRAINT experiments_current_draft_fk
    FOREIGN KEY (current_draft_id, project_id) REFERENCES experiment_drafts(id, project_id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE experiment_draft_revisions (
    draft_id text NOT NULL,
    revision integer NOT NULL CHECK (revision > 0),
    experiment_id text NOT NULL,
    project_id text NOT NULL,
    document jsonb NOT NULL CHECK (jsonb_typeof(document)='object'),
    canonical_digest bytea NOT NULL CHECK (octet_length(canonical_digest)=32),
    validation jsonb NOT NULL CHECK (jsonb_typeof(validation)='object'),
    mutation_key_digest bytea NOT NULL CHECK (octet_length(mutation_key_digest)=32),
    request_digest bytea NOT NULL CHECK (octet_length(request_digest)=32),
    actor_id text NOT NULL,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (draft_id, revision),
    UNIQUE (draft_id, mutation_key_digest),
    FOREIGN KEY (draft_id, project_id) REFERENCES experiment_drafts(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (experiment_id, project_id) REFERENCES experiments(id, project_id) ON DELETE RESTRICT
);

CREATE TABLE experiment_versions (
    id text PRIMARY KEY,
    experiment_id text NOT NULL,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    placement_id text NOT NULL,
    version_number integer NOT NULL CHECK (version_number > 0),
    source_draft_id text NOT NULL,
    source_revision integer NOT NULL,
    canonical_digest bytea NOT NULL CHECK (octet_length(canonical_digest)=32),
    assignment_key_policy text NOT NULL CHECK (assignment_key_policy IN ('installation','identified_user','identified_user_or_installation')),
    bucketing_algorithm text NOT NULL CHECK (bucketing_algorithm='experiment_sha256_length_prefixed_v1'),
    allocation_version text NOT NULL CHECK (char_length(allocation_version) BETWEEN 1 AND 128),
    primary_metric_id text NOT NULL,
    primary_metric_version integer NOT NULL,
    group_version_id text,
    starts_at timestamptz,
    ends_at timestamptz,
    fallback text NOT NULL CHECK (fallback='normal_placement'),
    compatibility jsonb NOT NULL CHECK (jsonb_typeof(compatibility)='object'),
    published_by_actor_id text NOT NULL,
    published_at timestamptz NOT NULL,
    UNIQUE (experiment_id, version_number), UNIQUE (id, project_id), UNIQUE (id, environment_id),
    FOREIGN KEY (experiment_id, project_id) REFERENCES experiments(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (environment_id, project_id) REFERENCES environments(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (placement_id, project_id) REFERENCES placements(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (source_draft_id, source_revision) REFERENCES experiment_draft_revisions(draft_id, revision) ON DELETE RESTRICT,
    FOREIGN KEY (primary_metric_id, primary_metric_version) REFERENCES experiment_metric_definitions(id, version) ON DELETE RESTRICT,
    FOREIGN KEY (group_version_id, project_id) REFERENCES experiment_group_versions(id, project_id) ON DELETE RESTRICT,
    CHECK (ends_at IS NULL OR (starts_at IS NOT NULL AND ends_at > starts_at))
);
ALTER TABLE experiments ADD CONSTRAINT experiments_active_version_fk
    FOREIGN KEY (active_version_id, project_id) REFERENCES experiment_versions(id, project_id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE experiment_variants (
    id text PRIMARY KEY,
    experiment_version_id text NOT NULL,
    project_id text NOT NULL,
    role text NOT NULL CHECK (role IN ('control','treatment')),
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
    paywall_id text NOT NULL,
    paywall_version_id text NOT NULL,
    allocation_start integer NOT NULL CHECK (allocation_start >= 0),
    allocation_end integer NOT NULL CHECK (allocation_end <= 10000),
    compatibility jsonb NOT NULL CHECK (jsonb_typeof(compatibility)='object'),
    UNIQUE (experiment_version_id, id),
    FOREIGN KEY (experiment_version_id, project_id) REFERENCES experiment_versions(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (paywall_id, project_id) REFERENCES paywalls(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (paywall_version_id, project_id) REFERENCES paywall_versions(id, project_id) ON DELETE RESTRICT,
    CHECK (allocation_end > allocation_start)
);
CREATE UNIQUE INDEX experiment_variants_one_control ON experiment_variants(experiment_version_id) WHERE role='control';

-- +goose StatementBegin
CREATE FUNCTION enforce_experiment_variant_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target text := COALESCE(NEW.experiment_version_id,OLD.experiment_version_id);
BEGIN
  IF (SELECT count(*) FROM experiment_variants WHERE experiment_version_id=target) NOT BETWEEN 2 AND 4
     OR (SELECT count(*) FROM experiment_variants WHERE experiment_version_id=target AND role='control') <> 1
     OR (SELECT min(allocation_start) FROM experiment_variants WHERE experiment_version_id=target) <> 0
     OR (SELECT max(allocation_end) FROM experiment_variants WHERE experiment_version_id=target) <> 10000
     OR EXISTS (
       SELECT 1 FROM (
         SELECT allocation_start,lag(allocation_end) OVER (ORDER BY allocation_start) previous_end
         FROM experiment_variants WHERE experiment_version_id=target
       ) ranges WHERE previous_end IS NOT NULL AND previous_end<>allocation_start
     )
  THEN RAISE EXCEPTION 'experiment allocation must be gap-free with one control and one to three treatments' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END;
$$;
-- +goose StatementEnd
CREATE CONSTRAINT TRIGGER experiment_variant_allocation_invariant
AFTER INSERT OR UPDATE OR DELETE ON experiment_variants DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_experiment_variant_allocation();

CREATE TABLE experiment_metric_snapshots (
    experiment_version_id text NOT NULL,
    project_id text NOT NULL,
    metric_id text NOT NULL,
    metric_version integer NOT NULL,
    kind text NOT NULL CHECK (kind IN ('primary','guardrail')),
    snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot)='object'),
    PRIMARY KEY (experiment_version_id, metric_id, metric_version),
    FOREIGN KEY (experiment_version_id, project_id) REFERENCES experiment_versions(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (metric_id, metric_version) REFERENCES experiment_metric_definitions(id, version) ON DELETE RESTRICT
);

CREATE TABLE experiment_group_memberships (
    group_version_id text NOT NULL,
    experiment_id text NOT NULL,
    project_id text NOT NULL,
    range_start integer NOT NULL CHECK (range_start >= 0),
    range_end integer NOT NULL CHECK (range_end <= 10000),
    PRIMARY KEY (group_version_id, experiment_id),
    FOREIGN KEY (group_version_id, project_id) REFERENCES experiment_group_versions(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (experiment_id, project_id) REFERENCES experiments(id, project_id) ON DELETE RESTRICT,
    CHECK (range_end > range_start)
);

-- +goose StatementBegin
CREATE FUNCTION enforce_experiment_group_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target text := COALESCE(NEW.group_version_id,OLD.group_version_id);
  expected_end integer;
BEGIN
  SELECT COALESCE(holdout_start,10000) INTO expected_end FROM experiment_group_versions WHERE id=target;
  IF expected_end IS NULL
     OR (SELECT count(*) FROM experiment_group_memberships WHERE group_version_id=target) < 1
     OR (SELECT min(range_start) FROM experiment_group_memberships WHERE group_version_id=target) <> 0
     OR (SELECT max(range_end) FROM experiment_group_memberships WHERE group_version_id=target) <> expected_end
     OR EXISTS (
       SELECT 1 FROM (
         SELECT range_start,lag(range_end) OVER (ORDER BY range_start) previous_end
         FROM experiment_group_memberships WHERE group_version_id=target
       ) ranges WHERE previous_end IS NOT NULL AND previous_end<>range_start
     )
  THEN RAISE EXCEPTION 'experiment group allocation must be unique, gap-free, and cover the member range' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END;
$$;
-- +goose StatementEnd
CREATE CONSTRAINT TRIGGER experiment_group_allocation_invariant
AFTER INSERT OR UPDATE OR DELETE ON experiment_group_memberships DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_experiment_group_allocation();

CREATE TABLE experiment_lifecycle_history (
    id text PRIMARY KEY,
    experiment_id text NOT NULL,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    from_state text NOT NULL,
    to_state text NOT NULL,
    reason text,
    release_id text,
    actor_id text NOT NULL,
    created_at timestamptz NOT NULL,
    FOREIGN KEY (experiment_id, project_id) REFERENCES experiments(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (release_id, environment_id) REFERENCES configuration_releases(id, environment_id) ON DELETE RESTRICT
);

CREATE TABLE experiment_qa_overrides (
    id text PRIMARY KEY,
    experiment_version_id text NOT NULL,
    variant_id text NOT NULL,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    identity_type text NOT NULL CHECK (identity_type IN ('installation','identified_user')),
    safe_label text NOT NULL CHECK (char_length(safe_label) BETWEEN 1 AND 80),
    selector_digest bytea NOT NULL CHECK (octet_length(selector_digest)=32),
    status text NOT NULL CHECK (status IN ('active','revoked','expired')),
    created_by_actor_id text NOT NULL,
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    UNIQUE (environment_id, selector_digest),
    FOREIGN KEY (experiment_version_id, project_id) REFERENCES experiment_versions(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (experiment_version_id, variant_id) REFERENCES experiment_variants(experiment_version_id, id) ON DELETE RESTRICT,
    CHECK (expires_at > created_at AND expires_at <= created_at + interval '24 hours')
);

CREATE TABLE experiment_scheduling_jobs (
    id text PRIMARY KEY,
    experiment_id text NOT NULL,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    action text NOT NULL CHECK (action IN ('start','complete')),
    scheduled_at timestamptz NOT NULL,
    status text NOT NULL CHECK (status IN ('queued','leased','completed','cancelled','failed')),
    actor_id text NOT NULL,
    lease_owner text, lease_expires_at timestamptz,
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
    UNIQUE (experiment_id, action, scheduled_at),
    FOREIGN KEY (experiment_id, project_id) REFERENCES experiments(id, project_id) ON DELETE RESTRICT,
    CHECK ((status='leased')=(lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL))
);

CREATE INDEX experiments_environment_state_idx ON experiments(environment_id,state,updated_at DESC);
CREATE INDEX experiments_placement_active_idx ON experiments(environment_id,placement_id,state) WHERE state IN ('scheduled','running','paused');
CREATE INDEX experiment_versions_environment_idx ON experiment_versions(environment_id,published_at DESC);
CREATE INDEX experiment_lifecycle_history_experiment_idx ON experiment_lifecycle_history(experiment_id,created_at);
CREATE INDEX experiment_qa_overrides_active_idx ON experiment_qa_overrides(environment_id,expires_at) WHERE status='active';
CREATE INDEX experiment_scheduling_jobs_lease_idx ON experiment_scheduling_jobs(scheduled_at,id) WHERE status IN ('queued','leased');

-- +goose StatementBegin
CREATE FUNCTION reject_experiment_immutable_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is immutable', TG_TABLE_NAME USING ERRCODE='55000'; END;
$$;
-- +goose StatementEnd
CREATE TRIGGER immutable_experiment_draft_revisions BEFORE UPDATE OR DELETE ON experiment_draft_revisions FOR EACH ROW EXECUTE FUNCTION reject_experiment_immutable_change();
CREATE TRIGGER immutable_experiment_versions BEFORE UPDATE OR DELETE ON experiment_versions FOR EACH ROW EXECUTE FUNCTION reject_experiment_immutable_change();
CREATE TRIGGER immutable_experiment_variants BEFORE UPDATE OR DELETE ON experiment_variants FOR EACH ROW EXECUTE FUNCTION reject_experiment_immutable_change();
CREATE TRIGGER immutable_experiment_metric_snapshots BEFORE UPDATE OR DELETE ON experiment_metric_snapshots FOR EACH ROW EXECUTE FUNCTION reject_experiment_immutable_change();
CREATE TRIGGER immutable_experiment_group_versions BEFORE UPDATE OR DELETE ON experiment_group_versions FOR EACH ROW EXECUTE FUNCTION reject_experiment_immutable_change();
CREATE TRIGGER immutable_experiment_group_memberships BEFORE UPDATE OR DELETE ON experiment_group_memberships FOR EACH ROW EXECUTE FUNCTION reject_experiment_immutable_change();

-- +goose StatementBegin
CREATE FUNCTION protect_active_experiment_mapping() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM experiment_variants v
    JOIN experiment_versions ev ON ev.id=v.experiment_version_id
    JOIN experiments e ON e.active_version_id=ev.id
    JOIN paywall_version_products pvp ON pvp.version_id=v.paywall_version_id
    WHERE pvp.product_id=OLD.product_id AND e.state IN ('scheduled','running','paused')
  ) THEN RAISE EXCEPTION 'mapping is used by an active experiment' USING ERRCODE='55000'; END IF;
  RETURN COALESCE(NEW,OLD);
END;
$$;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE FUNCTION protect_active_experiment_product() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM experiment_variants v
    JOIN experiment_versions ev ON ev.id=v.experiment_version_id
    JOIN experiments e ON e.active_version_id=ev.id
    JOIN paywall_version_products pvp ON pvp.version_id=v.paywall_version_id
    WHERE pvp.product_id=OLD.id AND e.state IN ('scheduled','running','paused')
  ) THEN RAISE EXCEPTION 'product is used by an active experiment' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER provider_mapping_experiment_protection BEFORE UPDATE OR DELETE ON provider_product_mappings FOR EACH ROW EXECUTE FUNCTION protect_active_experiment_mapping();
CREATE TRIGGER product_experiment_protection BEFORE UPDATE OF status ON products FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION protect_active_experiment_product();
CREATE TRIGGER grant_experiment_protection BEFORE DELETE ON product_entitlement_grants FOR EACH ROW EXECUTE FUNCTION protect_active_experiment_mapping();

-- +goose Down
DROP TRIGGER grant_experiment_protection ON product_entitlement_grants;
DROP TRIGGER product_experiment_protection ON products;
DROP TRIGGER provider_mapping_experiment_protection ON provider_product_mappings;
DROP FUNCTION protect_active_experiment_product();
DROP FUNCTION protect_active_experiment_mapping();
DROP TRIGGER immutable_experiment_group_memberships ON experiment_group_memberships;
DROP TRIGGER experiment_group_allocation_invariant ON experiment_group_memberships;
DROP FUNCTION enforce_experiment_group_allocation();
DROP TRIGGER immutable_experiment_group_versions ON experiment_group_versions;
DROP TRIGGER immutable_experiment_metric_snapshots ON experiment_metric_snapshots;
DROP TRIGGER immutable_experiment_variants ON experiment_variants;
DROP TRIGGER experiment_variant_allocation_invariant ON experiment_variants;
DROP FUNCTION enforce_experiment_variant_allocation();
DROP TRIGGER immutable_experiment_versions ON experiment_versions;
DROP TRIGGER immutable_experiment_draft_revisions ON experiment_draft_revisions;
DROP FUNCTION reject_experiment_immutable_change();
DROP TABLE experiment_scheduling_jobs;
DROP TABLE experiment_qa_overrides;
DROP TABLE experiment_lifecycle_history;
DROP TABLE experiment_group_memberships;
DROP TABLE experiment_metric_snapshots;
ALTER TABLE experiments DROP CONSTRAINT experiments_active_version_fk;
DROP TABLE experiment_variants;
DROP TABLE experiment_versions;
ALTER TABLE experiments DROP CONSTRAINT experiments_current_draft_fk;
DROP TABLE experiment_draft_revisions;
DROP TABLE experiment_drafts;
DROP TABLE experiments;
DROP TABLE experiment_group_versions;
DROP TABLE experiment_groups;
DROP TABLE experiment_metric_definitions;
