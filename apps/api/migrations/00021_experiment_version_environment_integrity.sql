-- +goose Up
-- experiment_versions carried two independent composite keys: one binding the
-- version to its Experiment within a Project, and one binding it to an
-- Environment within that Project. Nothing bound the version's Environment to
-- its Experiment's Environment, so a version could be attributed to a different
-- Environment than the Experiment it belongs to. Every assignment, exposure, and
-- analysis row is keyed on that Environment, so the gap is a tenant-boundary
-- and Experiment-integrity risk rather than a cosmetic one.
--
-- experiments already declares UNIQUE (id, environment_id), so the composite
-- reference below is exact. It is added NOT VALID and validated separately to
-- keep the write-blocking window short on a populated table.
ALTER TABLE experiment_versions
    ADD CONSTRAINT experiment_versions_experiment_environment_fk
    FOREIGN KEY (experiment_id, environment_id)
    REFERENCES experiments(id, environment_id) ON DELETE RESTRICT NOT VALID;

ALTER TABLE experiment_versions
    VALIDATE CONSTRAINT experiment_versions_experiment_environment_fk;

-- +goose Down
ALTER TABLE experiment_versions
    DROP CONSTRAINT experiment_versions_experiment_environment_fk;
