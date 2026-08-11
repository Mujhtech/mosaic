import { describe, expect, it } from "vitest";

import {
  evaluatePublishGate,
  type GrantProposal,
  impactHeadline,
  isGrantVersionEditable,
  narrowingCodeExplanation,
  proposalFingerprint,
} from "@/features/entitlement-grants/types/grant-version-view";

const proposal: GrantProposal = {
  effectiveStart: "2026-08-01T00:00:00.000Z",
  entitlementId: "ent_01",
  grantsInActive: true,
  grantsInGrace: true,
  grantsInTrial: true,
  productId: "prod_01",
  reason: "Grace access was never intended to be off.",
  supportedPurchaseTypes: ["auto_renewable_subscription"],
};

const previewed = proposalFingerprint(proposal);

/** A preview that states its whole blast radius, as a real one does. */
const completeImpact = {
  additiveSuperset: true,
  impactedActiveSources: 3,
  impactedCustomers: 3,
  impactedEntitlements: 1,
  impactedProducts: 1,
};

/**
 * These tests protect the confirmation contract of the only Mosaic operation
 * that can take access away from a customer who did nothing wrong.
 *
 * The realistic failure is a form that enables "Publish" from a preview taken
 * against an earlier version of the proposal: the operator confirms "3
 * customers could lose access" and publishes a policy whose real number is 300.
 * The gate is pure, so this is the cheapest layer that catches it.
 */
describe("grant version publish gate", () => {
  it("refuses to publish until this exact proposal has been previewed", () => {
    const withoutPreview = evaluatePublishGate({
      canManage: true,
      impact: undefined,
      isSubmitting: false,
      previewedFingerprint: undefined,
      proposal,
    });
    expect(withoutPreview.allowed).toBe(false);
    expect(withoutPreview.blockedBy).toBe("preview_stale");
  });

  it("invalidates the preview when any published field changes afterwards", () => {
    const widened: GrantProposal = { ...proposal, grantsInBillingRetry: true };
    const gate = evaluatePublishGate({
      canManage: true,
      impact: completeImpact,
      isSubmitting: false,
      previewedFingerprint: previewed,
      proposal: widened,
    });
    expect(gate.allowed).toBe(false);
    expect(gate.blockedBy).toBe("preview_stale");
  });

  it("allows publishing a previewed, complete, additive proposal", () => {
    expect(
      evaluatePublishGate({
        canManage: true,
        impact: completeImpact,
        isSubmitting: false,
        previewedFingerprint: previewed,
        proposal,
      }).allowed
    ).toBe(true);
  });

  /**
   * Protects: publish stays blocked when the preview did not state its full
   * blast radius.
   *
   * The failure this catches: an impact response missing a count is rendered as
   * `0`, the confirmation reads "no customer can lose access", and an operator
   * publishes an irreversible version on a number nobody measured. Each field is
   * asserted separately because the gate has to fail on *any* of them, not just
   * the one the headline happens to use.
   */
  it("refuses to publish when any blast-radius count is missing", () => {
    for (const missing of [
      "impactedActiveSources",
      "impactedCustomers",
      "impactedEntitlements",
      "impactedProducts",
    ] as const) {
      const impact = { ...completeImpact };
      delete impact[missing];
      const gate = evaluatePublishGate({
        canManage: true,
        impact,
        isSubmitting: false,
        previewedFingerprint: previewed,
        proposal,
      });
      expect(gate.allowed).toBe(false);
      expect(gate.blockedBy).toBe("impact_incomplete");
    }
  });

  /**
   * Protects: the headline never claims safety from an unreported count.
   *
   * "No customer can lose access" is the sentence an operator acts on. It must
   * come from a measured zero, never from an absent field.
   */
  it("never states a safe blast radius from an unreported count", () => {
    expect(impactHeadline({ additiveSuperset: true })).not.toContain(
      "no customer can lose access"
    );
    expect(
      impactHeadline({ additiveSuperset: true, impactedActiveSources: 0 })
    ).toContain("no customer can lose access");
  });

  it("refuses a retroactive narrowing the publish call would reject anyway", () => {
    const gate = evaluatePublishGate({
      canManage: true,
      impact: {
        additiveSuperset: false,
        impactedActiveSources: 120,
        narrowingCode: "grace_access_narrowed",
      },
      isSubmitting: false,
      previewedFingerprint: previewed,
      proposal,
    });
    expect(gate.allowed).toBe(false);
    expect(gate.blockedBy).toBe("narrowing");
  });

  it("requires a reason and management permission", () => {
    expect(
      evaluatePublishGate({
        canManage: true,
        impact: completeImpact,
        isSubmitting: false,
        previewedFingerprint: previewed,
        proposal: { ...proposal, reason: "   " },
      }).blockedBy
    ).toBe("reason_required");

    expect(
      evaluatePublishGate({
        canManage: false,
        impact: completeImpact,
        isSubmitting: false,
        previewedFingerprint: previewed,
        proposal,
      }).blockedBy
    ).toBe("no_permission");
  });
});

describe("grant version immutability", () => {
  it("offers no edit affordance for any published version", () => {
    // The API answers 409 grant_version_immutable to PATCH, PUT, and DELETE.
    // A UI that offers editing turns a documented rule into a failed request.
    expect(isGrantVersionEditable()).toBe(false);
  });

  it("explains every narrowing code the additive-superset rule can produce", () => {
    for (const code of [
      "active_access_narrowed",
      "billing_retry_access_narrowed",
      "grace_access_narrowed",
      "grant_identity_changed",
      "one_time_access_narrowed",
      "purchase_type_support_narrowed",
      "trial_access_narrowed",
    ]) {
      expect(narrowingCodeExplanation(code)).toBeTruthy();
      expect(narrowingCodeExplanation(code)).not.toContain(code);
    }
    // A code this build has not seen still explains the rule rather than
    // rendering a bare enum member.
    expect(narrowingCodeExplanation("future_narrowing")).toContain(
      "never remove or narrow"
    );
  });
});
