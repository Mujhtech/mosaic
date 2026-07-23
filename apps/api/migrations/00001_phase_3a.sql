-- +goose Up
CREATE TABLE id_sequences (
    prefix text PRIMARY KEY,
    value bigint NOT NULL CHECK (value >= 0)
);

CREATE TABLE organizations (
    id text PRIMARY KEY,
    name text NOT NULL CHECK (btrim(name) <> ''),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
);

CREATE TABLE organization_members (
    organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    actor_id text NOT NULL,
    role text NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    PRIMARY KEY (organization_id, actor_id)
);
CREATE INDEX organization_members_actor_idx ON organization_members(actor_id, organization_id);

CREATE TABLE projects (
    id text PRIMARY KEY,
    organization_id text NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    key text NOT NULL CHECK (btrim(key) <> ''),
    name text NOT NULL CHECK (btrim(name) <> ''),
    status text NOT NULL CHECK (status IN ('active', 'archived')),
    archived_at timestamptz,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    UNIQUE (organization_id, key),
    UNIQUE (id, organization_id),
    CHECK ((status = 'archived') = (archived_at IS NOT NULL))
);
CREATE INDEX projects_organization_idx ON projects(organization_id, id);

CREATE TABLE applications (
    id text PRIMARY KEY,
    project_id text NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    name text NOT NULL CHECK (btrim(name) <> ''),
    platform text NOT NULL CHECK (platform IN ('ios', 'android')),
    identifier text NOT NULL CHECK (btrim(identifier) <> ''),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    UNIQUE (project_id, platform, identifier),
    UNIQUE (id, project_id)
);
CREATE INDEX applications_project_idx ON applications(project_id, id);

CREATE TABLE environments (
    id text PRIMARY KEY,
    project_id text NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    key text NOT NULL CHECK (btrim(key) <> ''),
    name text NOT NULL CHECK (btrim(name) <> ''),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    UNIQUE (project_id, key),
    UNIQUE (id, project_id)
);
CREATE INDEX environments_project_idx ON environments(project_id, key);

CREATE TABLE api_keys (
    id text PRIMARY KEY,
    environment_id text NOT NULL REFERENCES environments(id) ON DELETE RESTRICT,
    kind text NOT NULL CHECK (kind IN ('public_sdk', 'secret_server')),
    prefix text NOT NULL UNIQUE,
    secret_digest bytea NOT NULL CHECK (octet_length(secret_digest) = 32),
    created_by_actor_id text NOT NULL,
    created_at timestamptz NOT NULL,
    rotated_at timestamptz,
    revoked_at timestamptz,
    last_used_at timestamptz
);
CREATE INDEX api_keys_environment_idx ON api_keys(environment_id, id);

CREATE TABLE plans (
    id text PRIMARY KEY,
    project_id text NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    key text NOT NULL CHECK (btrim(key) <> ''),
    name text NOT NULL CHECK (btrim(name) <> ''),
    description text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    UNIQUE (project_id, key),
    UNIQUE (id, project_id)
);
CREATE INDEX plans_project_idx ON plans(project_id, id);

CREATE TABLE products (
    id text PRIMARY KEY,
    project_id text NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    key text NOT NULL CHECK (btrim(key) <> ''),
    internal_name text NOT NULL CHECK (btrim(internal_name) <> ''),
    description text NOT NULL DEFAULT '',
    type text NOT NULL CHECK (type IN ('subscription', 'one_time_non_consumable')),
    status text NOT NULL CHECK (status IN ('draft', 'connected', 'attention_required', 'archived')),
    metadata_source text NOT NULL CHECK (metadata_source IN ('mock', 'provider')),
    readiness_ready boolean NOT NULL,
    readiness_reasons jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(readiness_reasons) = 'array'),
    replacement_product_id text,
    archived_at timestamptz,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    UNIQUE (project_id, key),
    UNIQUE (id, project_id),
    FOREIGN KEY (replacement_product_id, project_id) REFERENCES products(id, project_id) ON DELETE RESTRICT,
    CHECK (replacement_product_id IS NULL OR replacement_product_id <> id),
    CHECK ((status = 'archived') = (archived_at IS NOT NULL))
);
CREATE INDEX products_project_idx ON products(project_id, id);
CREATE INDEX products_replacement_idx ON products(replacement_product_id) WHERE replacement_product_id IS NOT NULL;

CREATE TABLE entitlements (
    id text PRIMARY KEY,
    project_id text NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    key text NOT NULL CHECK (btrim(key) <> ''),
    name text NOT NULL CHECK (btrim(name) <> ''),
    description text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    UNIQUE (project_id, key),
    UNIQUE (id, project_id)
);
CREATE INDEX entitlements_project_idx ON entitlements(project_id, id);

CREATE TABLE plan_products (
    project_id text NOT NULL,
    plan_id text NOT NULL,
    product_id text NOT NULL,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (plan_id, product_id),
    FOREIGN KEY (plan_id, project_id) REFERENCES plans(id, project_id) ON DELETE CASCADE,
    FOREIGN KEY (product_id, project_id) REFERENCES products(id, project_id) ON DELETE RESTRICT
);
CREATE INDEX plan_products_product_idx ON plan_products(product_id, plan_id);

CREATE TABLE product_entitlement_grants (
    project_id text NOT NULL,
    product_id text NOT NULL,
    entitlement_id text NOT NULL,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (product_id, entitlement_id),
    FOREIGN KEY (product_id, project_id) REFERENCES products(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (entitlement_id, project_id) REFERENCES entitlements(id, project_id) ON DELETE RESTRICT
);
CREATE INDEX product_entitlement_grants_entitlement_idx ON product_entitlement_grants(entitlement_id, product_id);

CREATE TABLE provider_product_mappings (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    product_id text NOT NULL,
    application_id text NOT NULL,
    provider text NOT NULL CHECK (provider IN ('revenuecat', 'app_store', 'google_play', 'custom')),
    provider_product_identifier text NOT NULL,
    status text NOT NULL CHECK (status = 'placeholder'),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    UNIQUE (product_id, application_id, provider),
    FOREIGN KEY (product_id, project_id) REFERENCES products(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (application_id, project_id) REFERENCES applications(id, project_id) ON DELETE RESTRICT
);
CREATE INDEX provider_product_mappings_product_idx ON provider_product_mappings(product_id, id);

CREATE TABLE product_replacement_history (
    id bigserial PRIMARY KEY,
    project_id text NOT NULL,
    product_id text NOT NULL,
    replacement_product_id text NOT NULL,
    changed_at timestamptz NOT NULL DEFAULT now(),
    CHECK (product_id <> replacement_product_id),
    FOREIGN KEY (product_id, project_id) REFERENCES products(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (replacement_product_id, project_id) REFERENCES products(id, project_id) ON DELETE RESTRICT
);
CREATE INDEX product_replacement_history_product_idx ON product_replacement_history(product_id, changed_at);
CREATE INDEX product_replacement_history_target_idx ON product_replacement_history(replacement_product_id, changed_at);

CREATE TABLE audit_events (
    id text PRIMARY KEY,
    actor_id text NOT NULL,
    organization_id text NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    project_id text,
    environment_id text,
    action text NOT NULL,
    resource_type text NOT NULL,
    resource_id text NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
    created_at timestamptz NOT NULL,
    FOREIGN KEY (project_id, organization_id) REFERENCES projects(id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (environment_id, project_id) REFERENCES environments(id, project_id) ON DELETE RESTRICT,
    CHECK (environment_id IS NULL OR project_id IS NOT NULL)
);
CREATE INDEX audit_events_organization_idx ON audit_events(organization_id, id);
CREATE INDEX audit_events_project_idx ON audit_events(project_id, id) WHERE project_id IS NOT NULL;

-- Users, invitations, and browser sessions remain owned by the pending auth/session decision and
-- are intentionally absent because the current Phase 3A runtime exposes no repository for them.

-- +goose Down
DROP TABLE audit_events;
DROP TABLE product_replacement_history;
DROP TABLE provider_product_mappings;
DROP TABLE product_entitlement_grants;
DROP TABLE plan_products;
DROP TABLE entitlements;
DROP TABLE products;
DROP TABLE plans;
DROP TABLE api_keys;
DROP TABLE environments;
DROP TABLE applications;
DROP TABLE projects;
DROP TABLE organization_members;
DROP TABLE organizations;
DROP TABLE id_sequences;
