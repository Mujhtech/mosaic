-- Phase 9B: materialize the purchase-chain digest closure.
--
-- A Purchase Lineage is keyed on the *root* of a provider chain, but a fact
-- carries its own chain digest — for Google, the digest of the purchase token
-- that was live when the fact was recorded. A plan change hands the token over,
-- so a live subscription accumulates a chain of digests linked backwards by
-- `supersedes_chain_digest`, and only the first of them equals the lineage's
-- `lineage_key_digest`.
--
-- Every reader that needs "which facts belong to this lineage?" therefore has to
-- walk that chain. The projection loader does it with a recursive CTE, which is
-- correct and affordable because it runs once per projection command. The read
-- surfaces cannot afford it: `ProjectionStatusFor` is evaluated on the SDK sync
-- path, the highest-QPS authenticated surface Mosaic has, and it was joining
-- `lineage_key_digest = purchase_chain_digest` directly. That join silently
-- omits every mid-chain Google successor, so a customer with a plan change
-- appeared to have zero pending facts no matter how far behind the projection
-- actually was — a staleness signal that under-reports exactly the customers
-- most likely to be stale.
--
-- This table is the closure, maintained by trigger rather than by application
-- code so that every writer maintains it — including migrations, repairs, and
-- the demonstration seeder — and so a future writer cannot forget to.
--
-- It is derived state: it is rebuildable from the facts alone (the backfill
-- below is the rebuild), so losing it is a re-run, never a data loss.

-- +goose Up
CREATE TABLE purchase_chain_digest_links (
    project_id text NOT NULL,
    environment_id text NOT NULL,
    -- A digest that appears on some fact in the chain.
    chain_digest bytea NOT NULL CHECK (octet_length(chain_digest) = 32),
    -- The root of that chain: the digest a Purchase Lineage is keyed on.
    root_digest bytea NOT NULL CHECK (octet_length(root_digest) = 32),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, environment_id, chain_digest)
);
CREATE INDEX purchase_chain_digest_links_root_idx
    ON purchase_chain_digest_links(project_id, environment_id, root_digest);

-- +goose StatementBegin
CREATE FUNCTION maintain_purchase_chain_digest_link() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    resolved_root bytea;
BEGIN
    IF NEW.purchase_chain_digest IS NULL THEN
        RETURN NULL;
    END IF;

    -- A fact that supersedes nothing is its own root. A fact that supersedes
    -- something inherits that predecessor's root when it is already known, and
    -- otherwise treats the predecessor as the root — which is correct until the
    -- predecessor's own predecessor arrives, and is repaired below when it does.
    IF NEW.supersedes_chain_digest IS NULL THEN
        resolved_root := NEW.purchase_chain_digest;
    ELSE
        SELECT l.root_digest INTO resolved_root
        FROM purchase_chain_digest_links l
        WHERE l.project_id = NEW.project_id
          AND l.environment_id = NEW.environment_id
          AND l.chain_digest = NEW.supersedes_chain_digest;
        IF resolved_root IS NULL THEN
            resolved_root := NEW.supersedes_chain_digest;
            INSERT INTO purchase_chain_digest_links(
                project_id, environment_id, chain_digest, root_digest, updated_at)
            VALUES (NEW.project_id, NEW.environment_id, resolved_root, resolved_root, now())
            ON CONFLICT (project_id, environment_id, chain_digest) DO NOTHING;
        END IF;
    END IF;

    INSERT INTO purchase_chain_digest_links(
        project_id, environment_id, chain_digest, root_digest, updated_at)
    VALUES (NEW.project_id, NEW.environment_id, NEW.purchase_chain_digest, resolved_root, now())
    ON CONFLICT (project_id, environment_id, chain_digest)
    DO UPDATE SET root_digest = EXCLUDED.root_digest, updated_at = EXCLUDED.updated_at
    WHERE purchase_chain_digest_links.root_digest <> EXCLUDED.root_digest;

    -- Providers do not guarantee notification ordering, so a successor's fact
    -- can be recorded before its predecessor's. When the predecessor finally
    -- arrives it re-roots the chain, and every descendant that had provisionally
    -- adopted this fact's digest as its root has to follow.
    IF resolved_root <> NEW.purchase_chain_digest THEN
        UPDATE purchase_chain_digest_links
        SET root_digest = resolved_root, updated_at = now()
        WHERE project_id = NEW.project_id
          AND environment_id = NEW.environment_id
          AND root_digest = NEW.purchase_chain_digest;
    END IF;

    RETURN NULL;
END;
$$;
-- +goose StatementEnd

CREATE TRIGGER billing_transaction_facts_maintain_chain_links
AFTER INSERT ON billing_transaction_facts
FOR EACH ROW EXECUTE FUNCTION maintain_purchase_chain_digest_link();

-- Backfill: the closure over every fact that already exists. UNION rather than
-- UNION ALL terminates on a cycle; provider data cannot contain one, so reaching
-- a repeat means the data is already wrong and stopping is safer than looping.
-- +goose StatementBegin
WITH RECURSIVE roots(project_id, environment_id, root_digest, chain_digest) AS (
    SELECT f.project_id, f.environment_id, f.purchase_chain_digest, f.purchase_chain_digest
    FROM billing_transaction_facts f
    WHERE f.purchase_chain_digest IS NOT NULL
      AND f.supersedes_chain_digest IS NULL
  UNION
    SELECT r.project_id, r.environment_id, r.root_digest, f.purchase_chain_digest
    FROM billing_transaction_facts f
    JOIN roots r
      ON f.supersedes_chain_digest = r.chain_digest
     AND f.project_id = r.project_id
     AND f.environment_id = r.environment_id
    WHERE f.purchase_chain_digest IS NOT NULL
)
INSERT INTO purchase_chain_digest_links(project_id, environment_id, chain_digest, root_digest, updated_at)
SELECT DISTINCT ON (project_id, environment_id, chain_digest)
    project_id, environment_id, chain_digest, root_digest, now()
FROM roots
ORDER BY project_id, environment_id, chain_digest, root_digest
ON CONFLICT (project_id, environment_id, chain_digest) DO NOTHING;
-- +goose StatementEnd

-- Facts whose predecessor was never recorded (a Google chain whose earlier
-- token predates Mosaic ingestion) are their own root. Without this they would
-- have no link row at all and would disappear from every count.
INSERT INTO purchase_chain_digest_links(project_id, environment_id, chain_digest, root_digest, updated_at)
SELECT DISTINCT f.project_id, f.environment_id, f.purchase_chain_digest, f.purchase_chain_digest, now()
FROM billing_transaction_facts f
WHERE f.purchase_chain_digest IS NOT NULL
ON CONFLICT (project_id, environment_id, chain_digest) DO NOTHING;

-- +goose Down
DROP TRIGGER billing_transaction_facts_maintain_chain_links ON billing_transaction_facts;
DROP FUNCTION maintain_purchase_chain_digest_link();
DROP TABLE purchase_chain_digest_links;
