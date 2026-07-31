-- +goose Up
CREATE TABLE assets (
    id text PRIMARY KEY,
    project_id text NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    kind text NOT NULL CHECK (kind IN ('image', 'video')),
    original_filename text NOT NULL CHECK (btrim(original_filename) <> ''),
    media_type text NOT NULL CHECK (media_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4')),
    byte_length bigint NOT NULL CHECK (byte_length > 0),
    content_digest text NOT NULL CHECK (content_digest ~ '^sha256:[0-9a-f]{64}$'),
    storage_key text NOT NULL CHECK (btrim(storage_key) <> ''),
    public_url text NOT NULL CHECK (public_url ~ '^https://'),
    status text NOT NULL CHECK (status IN ('pending', 'ready', 'failed', 'archived', 'deleted')),
    created_by_actor_id text NOT NULL,
    archived_at timestamptz,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    UNIQUE (id, project_id),
    UNIQUE (project_id, storage_key),
    UNIQUE (project_id, public_url),
    CHECK ((status = 'archived') = (archived_at IS NOT NULL))
);
CREATE INDEX assets_project_idx ON assets(project_id, id);

CREATE TABLE paywall_version_assets (
    version_id text NOT NULL,
    project_id text NOT NULL,
    asset_id text NOT NULL,
    document_asset_id text NOT NULL,
    PRIMARY KEY (version_id, document_asset_id),
    UNIQUE (version_id, asset_id),
    FOREIGN KEY (version_id, project_id) REFERENCES paywall_versions(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (asset_id, project_id) REFERENCES assets(id, project_id) ON DELETE RESTRICT
);
CREATE INDEX paywall_version_assets_asset_idx ON paywall_version_assets(asset_id, version_id);

CREATE TABLE configuration_release_assets (
    release_id text NOT NULL,
    environment_id text NOT NULL,
    project_id text NOT NULL,
    asset_id text NOT NULL,
    PRIMARY KEY (release_id, asset_id),
    FOREIGN KEY (release_id, environment_id) REFERENCES configuration_releases(id, environment_id) ON DELETE RESTRICT,
    FOREIGN KEY (asset_id, project_id) REFERENCES assets(id, project_id) ON DELETE RESTRICT
);
CREATE INDEX configuration_release_assets_asset_idx ON configuration_release_assets(asset_id, release_id);

CREATE TRIGGER immutable_paywall_version_assets
BEFORE UPDATE OR DELETE ON paywall_version_assets
FOR EACH ROW EXECUTE FUNCTION reject_immutable_publishing_change();
CREATE TRIGGER immutable_configuration_release_assets
BEFORE UPDATE OR DELETE ON configuration_release_assets
FOR EACH ROW EXECUTE FUNCTION reject_immutable_publishing_change();

-- +goose Down
DROP TRIGGER immutable_configuration_release_assets ON configuration_release_assets;
DROP TRIGGER immutable_paywall_version_assets ON paywall_version_assets;
DROP TABLE configuration_release_assets;
DROP TABLE paywall_version_assets;
DROP TABLE assets;
