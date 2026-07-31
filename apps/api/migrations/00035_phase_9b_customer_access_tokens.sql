-- Phase 9B: Customer Access Tokens (plan §11, OD-14(a)).
--
-- Opaque random tokens stored as SHA-256 digests, following the ADR-0017
-- posture already used for browser sessions and API keys. Project,
-- Environment, and customer scope are composite foreign-key columns rather
-- than claims to validate, so a token structurally cannot reach another
-- tenant's data: the scope is read from the row, never from the bearer.
-- Revocation is one UPDATE, which is why no signing ADR is required.

-- +goose Up
CREATE TABLE customer_access_tokens (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    billing_customer_id text NOT NULL,
    token_digest bytea NOT NULL UNIQUE CHECK (octet_length(token_digest) = 32),
    audience text NOT NULL CHECK (audience IN ('sdk_entitlement_sync')),
    scopes text[] NOT NULL DEFAULT ARRAY['entitlements:read']::text[],
    issued_by_api_key_id text,
    issued_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    last_used_at timestamptz,
    UNIQUE (id, project_id),
    FOREIGN KEY (environment_id, project_id)
        REFERENCES environments(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (billing_customer_id, project_id)
        REFERENCES billing_customers(id, project_id) ON DELETE RESTRICT,
    -- Short lived by construction: the service defaults to one hour and the
    -- schema refuses anything beyond twenty-four.
    CONSTRAINT customer_access_tokens_lifetime_check CHECK (
        expires_at > issued_at AND expires_at <= issued_at + interval '24 hours'
    ),
    CHECK (revoked_at IS NULL OR revoked_at >= issued_at),
    CHECK (cardinality(scopes) > 0)
);
CREATE INDEX customer_access_tokens_customer_idx
    ON customer_access_tokens(billing_customer_id, environment_id, issued_at DESC);
-- Expiry sweep support.
CREATE INDEX customer_access_tokens_expiry_idx
    ON customer_access_tokens(expires_at) WHERE revoked_at IS NULL;

-- Revocation is monotonic: a revoked token can never be un-revoked by a later
-- write, matching the api-key precedent from migration 00002.
-- +goose StatementBegin
CREATE FUNCTION preserve_customer_token_revocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL THEN
        NEW.revoked_at := OLD.revoked_at;
    END IF;
    IF NEW.token_digest <> OLD.token_digest
        OR NEW.billing_customer_id <> OLD.billing_customer_id
        OR NEW.environment_id <> OLD.environment_id
        OR NEW.project_id <> OLD.project_id THEN
        RAISE EXCEPTION 'customer access token scope is immutable' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER customer_access_tokens_preserve_revocation
BEFORE UPDATE ON customer_access_tokens
FOR EACH ROW EXECUTE FUNCTION preserve_customer_token_revocation();

-- +goose Down
DROP TRIGGER customer_access_tokens_preserve_revocation ON customer_access_tokens;
DROP FUNCTION preserve_customer_token_revocation();
DROP TABLE customer_access_tokens;
