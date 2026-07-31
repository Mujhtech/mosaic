-- Phase 9B: what webhook delivery still needs (WP19-21, ADR-0024).
--
-- 00036 landed destinations, signing secrets, immutable events, and the
-- append-only attempt history. 00038 landed the delivery state machine itself.
-- Between them almost everything the delivery worker needs already exists, so
-- this migration is deliberately small: it adds the three things that are
-- genuinely absent and nothing that merely looks tidier.
--
--  1. A rotation overlap window. ADR-0024 §2 requires that a destination may
--     hold more than one active signing secret so a receiver that has adopted
--     the new secret and one that has not both verify. 00036 models retirement
--     as instantaneous — status flips to 'retired', retired_at is stamped, and
--     the secret stops signing that instant — which is exactly the behaviour
--     the ADR rejected, because it demands a rotation that is simultaneous on
--     both sides or a period of rejected deliveries, and an operator can
--     achieve neither.
--
--  2. Auto-disable policy state. A destination whose deliveries keep exhausting
--     their attempt budget is misconfigured or gone, not having an incident.
--     Without a counter there is nothing to base a bounded run on, and the
--     worker attempts a dead URL for every event forever.
--
--  3. A fan-out marker. webhook_events carries an append-only trigger, so it
--     cannot hold a "fanned out" flag — the flag would be an UPDATE, and the
--     whole point of the trigger is that an announced state is never rewritten.
--
-- Two CHECK constraints are tightened at the same time; both are noted below
-- with the specific delivery bug they make unrepresentable.

-- +goose Up

-- --------------------------------------------------------------------------
-- 1. Rotation overlap
-- --------------------------------------------------------------------------

-- honored_until lives on the secret rather than on the destination.
--
-- The destination-level alternative ("previous_secret_expires_at") assumes
-- there is exactly one previous secret. During a second rotation started
-- before the first overlap lapsed there are two, and a single destination
-- column would silently retire one of them early — the precise failure the
-- overlap exists to prevent. Keeping the window on the row it governs means
-- each secret carries its own answer and the signing query is a plain
-- predicate rather than a join against a shared deadline.
--
-- Semantics: a secret signs while status = 'active', OR while it is retired
-- and honored_until is still in the future. Once honored_until passes the
-- secret stops signing with no further action, which is what makes lapsing
-- safe even if no operator or worker ever touches the row again.
ALTER TABLE webhook_signing_secrets
    ADD COLUMN honored_until timestamptz,
    -- An overlap window is a property of retirement. An active secret already
    -- signs, so a window on one would be either redundant or a contradiction.
    ADD CONSTRAINT webhook_signing_secrets_honored_until_requires_retirement
        CHECK (honored_until IS NULL OR retired_at IS NOT NULL);

-- The signing read: every secret for a destination that is still permitted to
-- sign. Partial on status so the retired-and-lapsed rows, which accumulate
-- forever and are never read again, stay out of the index.
CREATE INDEX webhook_signing_secrets_signing_idx
    ON webhook_signing_secrets(webhook_destination_id, honored_until)
    WHERE status = 'active' OR honored_until IS NOT NULL;

-- --------------------------------------------------------------------------
-- 2. Auto-disable policy
-- --------------------------------------------------------------------------

-- consecutive_failure_count counts exhausted *deliveries* in a row, not failed
-- attempts: a single delivery already burns its whole attempt budget against a
-- provider outage, so counting attempts would disable a destination for one bad
-- afternoon. Any success resets it to zero, so a genuine outage that recovers
-- never trips the policy.
--
-- auto_disable_reason is a Mosaic-owned stable code and is kept separate from
-- the free-text disabled_reason added in 00038. disabled_reason is whatever an
-- operator wrote when they disabled the destination by hand; this column is set
-- only by the automatic path, so "did Mosaic disable this, or did a person?" is
-- answerable without parsing prose.
ALTER TABLE webhook_destinations
    ADD COLUMN consecutive_failure_count integer NOT NULL DEFAULT 0
        CHECK (consecutive_failure_count >= 0),
    ADD COLUMN auto_disabled_at timestamptz,
    ADD COLUMN auto_disable_reason text CHECK (auto_disable_reason IS NULL OR auto_disable_reason IN (
        'consecutive_exhausted_deliveries', 'destination_refused'
    )),
    ADD CONSTRAINT webhook_destinations_auto_disable_pairing
        CHECK ((auto_disabled_at IS NULL) = (auto_disable_reason IS NULL)),
    -- An automatically disabled destination must actually be disabled.
    -- Recording the reason while leaving status 'active' would produce a
    -- destination that reads as auto-disabled everywhere in the API and is
    -- still attempted by the worker.
    ADD CONSTRAINT webhook_destinations_auto_disable_implies_disabled
        CHECK (auto_disabled_at IS NULL OR status = 'disabled');

-- --------------------------------------------------------------------------
-- 3. Fan-out marker
-- --------------------------------------------------------------------------

-- One row per event that has been expanded into deliveries.
--
-- Recording the count as well as the instant makes the zero-destination case
-- distinguishable from the never-processed case. Those are identical when read
-- from webhook_deliveries alone — both are "no delivery rows" — and they are
-- the two answers an operator debugging "my endpoint never received this" most
-- needs told apart. It is also what stops a Project with no destinations
-- re-examining every event it has ever emitted on every worker poll.
CREATE TABLE webhook_event_fanouts (
    webhook_event_id text PRIMARY KEY,
    project_id text NOT NULL,
    delivery_count integer NOT NULL CHECK (delivery_count >= 0),
    skipped_count integer NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
    fanned_out_at timestamptz NOT NULL,
    FOREIGN KEY (webhook_event_id, project_id)
        REFERENCES webhook_events(id, project_id) ON DELETE RESTRICT
);

-- --------------------------------------------------------------------------
-- Two tightened CHECKs on the 00038 delivery row
-- --------------------------------------------------------------------------

-- Exhaustion means the attempts actually ran out. The delivery contract's
-- semantic validator rejects an exhausted record whose attempt count has not
-- reached its maximum, and a delivery marked exhausted after two attempts of
-- eight is a worker that gave up early — a silently dropped notification that
-- looks, in every operator view, exactly like one that was tried properly.
ALTER TABLE webhook_deliveries
    ADD CONSTRAINT webhook_deliveries_exhausted_ran_out
        CHECK (status <> 'exhausted' OR attempt_count >= max_attempts);

-- A pending delivery must be scheduled. 00038 permits pending with a NULL
-- next_attempt_at; such a row sits in the queue index forever and is never
-- returned by the claim query, because `next_attempt_at <= now` is never true
-- of NULL. That is an invisible stuck delivery, and the only signal is a
-- customer's backend that never heard about a change.
ALTER TABLE webhook_deliveries
    ADD CONSTRAINT webhook_deliveries_pending_is_scheduled
        CHECK (status <> 'pending' OR next_attempt_at IS NOT NULL);

-- +goose Down
ALTER TABLE webhook_deliveries
    DROP CONSTRAINT webhook_deliveries_pending_is_scheduled,
    DROP CONSTRAINT webhook_deliveries_exhausted_ran_out;
DROP TABLE webhook_event_fanouts;
ALTER TABLE webhook_destinations
    DROP CONSTRAINT webhook_destinations_auto_disable_implies_disabled,
    DROP CONSTRAINT webhook_destinations_auto_disable_pairing,
    DROP COLUMN auto_disable_reason,
    DROP COLUMN auto_disabled_at,
    DROP COLUMN consecutive_failure_count;
DROP INDEX webhook_signing_secrets_signing_idx;
ALTER TABLE webhook_signing_secrets
    DROP CONSTRAINT webhook_signing_secrets_honored_until_requires_retirement,
    DROP COLUMN honored_until;
