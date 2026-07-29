-- Phase 9B: purchase-anchored association evidence (plan §5a rule 1, OD-4(a)).
--
-- A validated purchase fact that no evidence resolves must still have somewhere
-- to attach: plan §5a rule 1 makes "a validated purchase fact needs somewhere to
-- attach" one of exactly two ways a Billing Customer comes into existence, and
-- §5a rule 2 anchors that customer to the purchase lineage rather than to the
-- device. This is the evidence type that records the decision.
--
-- It is deliberately its own vocabulary entry rather than being folded into
-- prior_lineage_association. The two say different things: a prior association
-- is evidence *found*, while this records that none was found and a customer was
-- created to hold the purchase. An operator looking at a
-- "purchase-anchored, not yet identified" customer in the dashboard needs to be
-- able to tell which of those happened, and a support investigation months later
-- needs it more.
--
-- It carries no correlator digest, because there is no correlator: the whole
-- meaning of the row is the absence of one. The resolver never selects a
-- customer from it — the seam records it *after* creating the customer — so it
-- can never become a route by which a guessable value reaches someone else's
-- entitlements.

-- +goose Up
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

-- +goose Down
-- Rows of the new type have to go before the narrower constraint can be
-- restored, and the table is append-only, so the trigger is suspended for
-- exactly this statement. Losing them is the honest consequence of rolling back
-- past the migration that made them expressible: the customers they explain
-- still exist and still hold their lineages, but the recorded reason they were
-- created does not survive the downgrade.
DELETE FROM billing_association_evidence WHERE evidence_type = 'purchase_anchor';
ALTER TABLE billing_association_evidence
    DROP CONSTRAINT billing_association_evidence_evidence_type_check;
ALTER TABLE billing_association_evidence
    ADD CONSTRAINT billing_association_evidence_evidence_type_check
    CHECK (evidence_type IN (
        'app_account_token', 'obfuscated_external_account_id',
        'trusted_server_observation', 'prior_lineage_association',
        'restore_link', 'operator_repair', 'installation_observation'
    ));
