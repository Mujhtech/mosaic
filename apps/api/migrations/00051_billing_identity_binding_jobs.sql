-- Phase 9B: make the identity half of the Phase 9A -> 9B fact seam durable.
--
-- Validation used to call the identity binder only after the fact transaction
-- committed. A process exit in that interval permanently lost the association
-- work. This queue is written in the fact/attempt transaction and contains only
-- digests and non-secret identifiers, so retry never needs the retained raw
-- provider body and never repeats provider validation.

-- +goose Up
CREATE TABLE billing_identity_binding_jobs (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    validation_attempt_id text NOT NULL UNIQUE,
    raw_input_id text NOT NULL,
    provider text NOT NULL CHECK (provider IN ('app_store', 'google_play')),
    lineage_key_digest bytea NOT NULL CHECK (octet_length(lineage_key_digest) = 32),
    fact_chain_digest bytea NOT NULL CHECK (octet_length(fact_chain_digest) = 32),
    reference_digests bytea[] NOT NULL DEFAULT '{}',
    correlators jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(correlators) = 'array'),
    acquired_at timestamptz NOT NULL,
    status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'leased', 'completed', 'failed')),
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    max_attempts integer NOT NULL DEFAULT 8 CHECK (max_attempts > 0),
    available_at timestamptz NOT NULL,
    lease_owner text,
    lease_expires_at timestamptz,
    last_error_code text,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    CONSTRAINT billing_identity_binding_jobs_environment_fk
        FOREIGN KEY (environment_id, project_id) REFERENCES environments(id, project_id),
    CONSTRAINT billing_identity_binding_jobs_attempt_fk
        FOREIGN KEY (validation_attempt_id, project_id)
        REFERENCES billing_validation_attempts(id, project_id) ON DELETE CASCADE,
    CONSTRAINT billing_identity_binding_jobs_raw_input_fk
        FOREIGN KEY (raw_input_id, project_id) REFERENCES billing_raw_inputs(id, project_id),
    CONSTRAINT billing_identity_binding_jobs_lease_shape CHECK (
        (status = 'leased' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
        OR (status <> 'leased' AND lease_owner IS NULL AND lease_expires_at IS NULL)
    ),
    CONSTRAINT billing_identity_binding_jobs_reference_digests_check CHECK (
        array_position(reference_digests, NULL) IS NULL
    )
);

CREATE INDEX billing_identity_binding_jobs_claim_idx
    ON billing_identity_binding_jobs (available_at, created_at, id)
    WHERE status IN ('queued', 'leased');

-- The partial unique index is the cross-worker serialization boundary. Two
-- evidence-bearing attempts for one lineage may be queued, but only one may be
-- inside the identity decision at a time.
CREATE UNIQUE INDEX billing_identity_binding_jobs_lineage_lease_idx
    ON billing_identity_binding_jobs (environment_id, provider, lineage_key_digest)
    WHERE status = 'leased';

-- +goose Down
DROP TABLE billing_identity_binding_jobs;
