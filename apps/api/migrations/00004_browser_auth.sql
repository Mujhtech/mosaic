-- +goose Up
CREATE TABLE users (
    id text PRIMARY KEY,
    email text NOT NULL CHECK (btrim(email) <> '' AND email = lower(email)),
    name text NOT NULL CHECK (btrim(name) <> ''),
    password_hash text NOT NULL CHECK (btrim(password_hash) <> ''),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX users_email_unique_idx ON users(lower(email));

CREATE TABLE browser_sessions (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_digest bytea NOT NULL CHECK (octet_length(token_digest) = 32),
    authenticated_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    last_seen_at timestamptz NOT NULL,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL,
    UNIQUE (token_digest),
    CHECK (expires_at > authenticated_at),
    CHECK (last_seen_at >= authenticated_at)
);
CREATE INDEX browser_sessions_user_active_idx
    ON browser_sessions(user_id, expires_at) WHERE revoked_at IS NULL;

-- +goose Down
DROP TABLE browser_sessions;
DROP TABLE users;
