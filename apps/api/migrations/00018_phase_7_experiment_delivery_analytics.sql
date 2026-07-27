-- +goose Up
ALTER TABLE configuration_releases
    DROP CONSTRAINT configuration_releases_delivery_contract_version_check,
    ADD CONSTRAINT configuration_releases_delivery_contract_version_check CHECK (delivery_contract_version IN ('1','2','3'));
ALTER TABLE configuration_release_representations
    DROP CONSTRAINT configuration_release_represent_delivery_contract_version_check,
    ADD CONSTRAINT configuration_release_represent_delivery_contract_version_check CHECK (delivery_contract_version IN ('1','2','3'));

ALTER TABLE configuration_releases
    ADD CONSTRAINT configuration_releases_id_project_environment_key UNIQUE (id,project_id,environment_id);
ALTER TABLE experiment_versions
    ADD CONSTRAINT experiment_versions_scope_allocation_key UNIQUE (id,experiment_id,project_id,environment_id,allocation_version),
    ADD CONSTRAINT experiment_versions_scope_key UNIQUE (id,experiment_id,project_id,environment_id),
    ADD CONSTRAINT experiment_versions_id_project_environment_key UNIQUE (id,project_id,environment_id);
ALTER TABLE experiment_variants
    ADD CONSTRAINT experiment_variants_id_version_project_key UNIQUE (id,experiment_version_id,project_id);

CREATE TABLE configuration_release_experiment_versions (
    release_id text NOT NULL,
    experiment_version_id text NOT NULL,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    PRIMARY KEY (release_id, experiment_version_id),
    FOREIGN KEY (release_id, project_id, environment_id) REFERENCES configuration_releases(id, project_id, environment_id) ON DELETE RESTRICT,
    FOREIGN KEY (experiment_version_id, project_id, environment_id) REFERENCES experiment_versions(id, project_id, environment_id) ON DELETE RESTRICT
);

ALTER TABLE analytics_events
    DROP CONSTRAINT analytics_events_event_schema_version_check,
    ADD CONSTRAINT analytics_events_event_schema_version_check CHECK (event_schema_version IN ('1','2')),
    ADD COLUMN experiment_id text,
    ADD COLUMN experiment_version_id text,
    ADD COLUMN experiment_variant_id text,
    ADD COLUMN experiment_allocation_version text,
    ADD COLUMN experiment_qa_override boolean NOT NULL DEFAULT false,
    ADD CONSTRAINT analytics_events_experiment_attribution_shape CHECK (
      (experiment_id IS NULL AND experiment_version_id IS NULL AND experiment_variant_id IS NULL AND experiment_allocation_version IS NULL AND experiment_qa_override=false)
      OR
      (event_schema_version='2' AND experiment_id IS NOT NULL AND experiment_version_id IS NOT NULL AND experiment_variant_id IS NOT NULL AND experiment_allocation_version IS NOT NULL AND char_length(experiment_allocation_version) BETWEEN 1 AND 128)
    ),
    ADD CONSTRAINT analytics_events_experiment_tuple_fk FOREIGN KEY (experiment_version_id, experiment_id, project_id, environment_id, experiment_allocation_version) REFERENCES experiment_versions(id, experiment_id, project_id, environment_id, allocation_version) ON DELETE RESTRICT,
    ADD CONSTRAINT analytics_events_experiment_variant_tuple_fk FOREIGN KEY (experiment_variant_id, experiment_version_id, project_id) REFERENCES experiment_variants(id, experiment_version_id, project_id) ON DELETE RESTRICT;

CREATE INDEX analytics_events_experiment_analysis_idx
    ON analytics_events(environment_id,experiment_version_id,experiment_variant_id,occurred_at,subject_id)
    WHERE experiment_version_id IS NOT NULL AND experiment_qa_override=false;

CREATE TABLE experiment_daily_unique_units (
    project_id text NOT NULL,
    environment_id text NOT NULL,
    bucket_date date NOT NULL,
    experiment_id text NOT NULL,
    experiment_version_id text NOT NULL,
    variant_id text NOT NULL,
    metric_id text NOT NULL,
    metric_version integer NOT NULL,
    authority text NOT NULL CHECK (authority IN ('client_observed','provider_confirmed')),
    unique_exposures bigint NOT NULL CHECK (unique_exposures >= 0),
    unique_conversions bigint NOT NULL CHECK (unique_conversions >= 0 AND unique_conversions <= unique_exposures),
    raw_exposure_events bigint NOT NULL CHECK (raw_exposure_events >= unique_exposures),
    fallback_presentations bigint NOT NULL CHECK (fallback_presentations >= 0),
    latest_received_at timestamptz NOT NULL,
    rebuilt_at timestamptz NOT NULL,
    PRIMARY KEY (environment_id,bucket_date,experiment_version_id,variant_id,metric_id,metric_version,authority),
    FOREIGN KEY (experiment_version_id,experiment_id,project_id,environment_id) REFERENCES experiment_versions(id,experiment_id,project_id,environment_id) ON DELETE RESTRICT,
    FOREIGN KEY (variant_id,experiment_version_id,project_id) REFERENCES experiment_variants(id,experiment_version_id,project_id) ON DELETE RESTRICT,
    FOREIGN KEY (metric_id,metric_version) REFERENCES experiment_metric_definitions(id,version) ON DELETE RESTRICT
);
CREATE INDEX experiment_daily_unique_units_query_idx ON experiment_daily_unique_units(environment_id,experiment_version_id,metric_id,bucket_date);

CREATE TABLE experiment_analysis_rebuilds (
    environment_id text NOT NULL,
    project_id text NOT NULL,
    experiment_version_id text NOT NULL,
    bucket_date date NOT NULL,
    reason text NOT NULL CHECK (reason IN ('ingestion','late_event','privacy_deletion','retention')),
    marked_at timestamptz NOT NULL,
    PRIMARY KEY (environment_id,experiment_version_id,bucket_date),
    FOREIGN KEY (experiment_version_id,project_id,environment_id) REFERENCES experiment_versions(id,project_id,environment_id) ON DELETE RESTRICT
);

ALTER TABLE analytics_export_jobs
    DROP CONSTRAINT analytics_export_jobs_kind_check,
    ADD CONSTRAINT analytics_export_jobs_kind_check CHECK (kind IN ('events','application_user','installation','experiment')),
    ADD COLUMN experiment_version_id text,
    ADD COLUMN include_identity boolean NOT NULL DEFAULT false,
    ADD CONSTRAINT analytics_export_jobs_experiment_fk FOREIGN KEY (experiment_version_id,project_id) REFERENCES experiment_versions(id,project_id) ON DELETE RESTRICT;

-- Release references are immutable even if a representation is regenerated elsewhere.
CREATE TRIGGER immutable_release_experiment_versions BEFORE UPDATE OR DELETE ON configuration_release_experiment_versions
FOR EACH ROW EXECUTE FUNCTION reject_experiment_immutable_change();

-- +goose Down
DROP TRIGGER immutable_release_experiment_versions ON configuration_release_experiment_versions;
ALTER TABLE analytics_export_jobs DROP CONSTRAINT analytics_export_jobs_experiment_fk;
ALTER TABLE analytics_export_jobs DROP CONSTRAINT analytics_export_jobs_kind_check;
ALTER TABLE analytics_export_jobs ADD CONSTRAINT analytics_export_jobs_kind_check CHECK (kind IN ('events','application_user','installation'));
ALTER TABLE analytics_export_jobs DROP COLUMN include_identity;
ALTER TABLE analytics_export_jobs DROP COLUMN experiment_version_id;
DROP TABLE experiment_analysis_rebuilds;
DROP TABLE experiment_daily_unique_units;
DROP INDEX analytics_events_experiment_analysis_idx;
ALTER TABLE analytics_events
    DROP CONSTRAINT analytics_events_experiment_variant_tuple_fk,
    DROP CONSTRAINT analytics_events_experiment_tuple_fk,
    DROP CONSTRAINT analytics_events_experiment_attribution_shape,
    DROP COLUMN experiment_qa_override,
    DROP COLUMN experiment_allocation_version,
    DROP COLUMN experiment_variant_id,
    DROP COLUMN experiment_version_id,
    DROP COLUMN experiment_id,
    DROP CONSTRAINT analytics_events_event_schema_version_check,
    ADD CONSTRAINT analytics_events_event_schema_version_check CHECK (event_schema_version='1');
DROP TABLE configuration_release_experiment_versions;
ALTER TABLE experiment_variants DROP CONSTRAINT experiment_variants_id_version_project_key;
ALTER TABLE experiment_versions
    DROP CONSTRAINT experiment_versions_id_project_environment_key,
    DROP CONSTRAINT experiment_versions_scope_key,
    DROP CONSTRAINT experiment_versions_scope_allocation_key;
ALTER TABLE configuration_releases DROP CONSTRAINT configuration_releases_id_project_environment_key;
ALTER TABLE configuration_release_representations
    DROP CONSTRAINT configuration_release_represent_delivery_contract_version_check,
    ADD CONSTRAINT configuration_release_represent_delivery_contract_version_check CHECK (delivery_contract_version IN ('1','2'));
ALTER TABLE configuration_releases
    DROP CONSTRAINT configuration_releases_delivery_contract_version_check,
    ADD CONSTRAINT configuration_releases_delivery_contract_version_check CHECK (delivery_contract_version IN ('1','2'));
