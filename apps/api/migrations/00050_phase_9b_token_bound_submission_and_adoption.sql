-- Phase 9B Stage 5 fix round 1: separate the token-bound public-SDK-key
-- submission from the trusted-server submission, and record anchored-customer
-- adoption (plan §5a rule 3).
--
-- Two vocabulary additions and one status addition, all for the same defect.
--
-- `token_bound_submission` exists because a submission that arrived on the
-- *public* SDK key carrying a Customer Access Token was being recorded as
-- `trusted_server_observation`, which is the highest non-operator authority in
-- the resolver. The public SDK key ships inside every install, so that recorded
-- a claim anybody could make at the authority of the application's own backend:
-- presenting a token for a transaction could take an established purchase away
-- from the customer that owned it, or freeze the lineage in an identity
-- conflict so that neither party was granted anything. Both were remote
-- denial-of-access primitives against a paying customer. Rank 90 now belongs
-- only to a submission authenticated by the secret server key; the new type
-- ranks below `prior_lineage_association`, so it can attach an unattached
-- lineage and can never move or freeze an attached one.
--
-- `anchored_customer_adoption` records plan §5a rule 3's adoption: an
-- identified customer taking over the lineage of a purchase-anchored customer
-- that has no aliases and no identifying evidence of its own. It is distinct
-- from `restore_link` because it is not a restore — nothing asked a store for
-- purchases — and distinct from `operator_repair` because no operator was
-- involved. Its diagnostic code carries the ownership proof that permitted it.
--
-- The `absorbed` customer status marks the anchor afterwards. The row is not
-- deleted: entitlement snapshots, evidence, and audit events already cite it,
-- and an investigation has to be able to follow a purchase from the anchor to
-- the person who turned out to own it.

-- +goose Up
ALTER TABLE billing_association_evidence
    DROP CONSTRAINT billing_association_evidence_evidence_type_check;
ALTER TABLE billing_association_evidence
    ADD CONSTRAINT billing_association_evidence_evidence_type_check
    CHECK (evidence_type IN (
        'app_account_token', 'obfuscated_external_account_id',
        'trusted_server_observation', 'prior_lineage_association',
        'restore_link', 'operator_repair', 'installation_observation',
        'purchase_anchor', 'token_bound_submission', 'anchored_customer_adoption'
    ));

ALTER TABLE billing_customers
    DROP CONSTRAINT billing_customers_status_check;
ALTER TABLE billing_customers
    ADD CONSTRAINT billing_customers_status_check
    CHECK (status IN ('active', 'frozen', 'anonymized', 'absorbed'));

-- +goose Down
-- An absorbed customer becomes active again. That is the honest reversal: the
-- lineage the adoption moved is not moved back — evidence is append-only and
-- the adopting customer's committed snapshot already grants the purchase — so
-- the anchor returns to the only other status that does not assert something
-- false about it.
UPDATE billing_customers SET status = 'active' WHERE status = 'absorbed';
ALTER TABLE billing_customers
    DROP CONSTRAINT billing_customers_status_check;
ALTER TABLE billing_customers
    ADD CONSTRAINT billing_customers_status_check
    CHECK (status IN ('active', 'frozen', 'anonymized'));

-- Rows of the two new types have to go before the narrower constraint can be
-- restored, and the table is append-only, so the trigger is suspended for
-- exactly those statements, as 00042 and 00049 do.
ALTER TABLE billing_association_evidence
    DISABLE TRIGGER billing_association_evidence_append_only;
DELETE FROM billing_association_evidence
    WHERE evidence_type IN ('token_bound_submission', 'anchored_customer_adoption');
ALTER TABLE billing_association_evidence
    ENABLE TRIGGER billing_association_evidence_append_only;

ALTER TABLE billing_association_evidence
    DROP CONSTRAINT billing_association_evidence_evidence_type_check;
ALTER TABLE billing_association_evidence
    ADD CONSTRAINT billing_association_evidence_evidence_type_check
    CHECK (evidence_type IN (
        'app_account_token', 'obfuscated_external_account_id',
        'trusted_server_observation', 'prior_lineage_association',
        'restore_link', 'operator_repair', 'installation_observation',
        'purchase_anchor'
    ));
