import { describe, expect, it } from "vitest";

import {
  accessStateExplanation,
  accessStateLabel,
  accessStateSubject,
  accessStates,
  accessStateTone,
  explanationSentence,
  sourceEndStatement,
  subscriptionAccessStatement,
} from "@/features/billing-customers/types/entitlement-vocabulary";

/**
 * These tests protect one rule, and it is the rule the whole phase turns on:
 * "Mosaic cannot answer" must never be rendered as "the customer has no
 * access". The realistic failure is not a typo — it is a contract member added
 * after this build (or a truncated payload) falling through a lookup into the
 * `inactive` copy or a destructive tone, at which point a support agent reads a
 * projection outage as a churned customer and acts on it.
 */
describe("entitlement access vocabulary", () => {
  const inactiveLabel = accessStateLabel("inactive");
  const inactiveExplanation = accessStateExplanation("inactive");

  it("gives every access state a distinct label", () => {
    const labels = accessStates.map((state) => accessStateLabel(state));
    expect(new Set(labels).size).toBe(accessStates.length);
  });

  it.each([
    "unknown",
    "unavailable",
  ])("never renders %s with the inactive label, copy, or a destructive tone", (state) => {
    expect(accessStateLabel(state)).not.toBe(inactiveLabel);
    expect(accessStateExplanation(state)).not.toBe(inactiveExplanation);
    expect(accessStateTone(state)).toBe("attention");
    expect(accessStateExplanation(state)).toContain("not the same as inactive");
  });

  it("treats a determined absence of access as an answer rather than a fault", () => {
    // Destructive tone on `inactive` is what trains an operator to read every
    // non-active customer as a problem, which hides the two states that are.
    expect(accessStateTone("inactive")).toBe("neutral");
    expect(accessStateTone("active")).toBe("positive");
  });

  it.each([
    "",
    "provisionally_active",
    "suspended",
    "INACTIVE",
  ])("degrades the unrecognised member %j to attention rather than to inactive", (state) => {
    expect(accessStateTone(state)).toBe("attention");
    expect(accessStateLabel(state)).not.toBe(inactiveLabel);
    expect(accessStateExplanation(state)).not.toBe(inactiveExplanation);
  });

  it("names the reason inside the undetermined sentence", () => {
    const sentence = accessStateExplanation("unknown", {
      reason: "identity_unresolved",
    });
    expect(sentence).toContain("Mosaic cannot currently determine access");
    expect(sentence).toContain("identity conflict");
  });

  it("attributes unavailable and unknown to Mosaic, not to the customer", () => {
    expect(accessStateSubject("unavailable")).toBe("mosaic");
    expect(accessStateSubject("unknown")).toBe("mosaic");
    expect(accessStateSubject("inactive")).toBe("customer");
    expect(accessStateSubject("active")).toBe("customer");
  });
});

/**
 * Cancellation flips renewal intent only. A merged status pill has to choose
 * between "Cancelled" (read as access gone) and "Active" (hides that renewal
 * stopped); both are wrong, and the first one is the one that gets acted on.
 */
describe("cancelled subscription still holding access", () => {
  it("states auto-renew disabled and access until the period end, never inactive", () => {
    const statement = subscriptionAccessStatement({
      accessState: "active",
      periodEnd: "2026-09-01T12:00:00Z",
      renewalIntent: "auto_renew_disabled",
    });

    expect(statement.renewal).toContain("Auto-renew disabled");
    expect(statement.access).toBe("Active until 2026-09-01 12:00:00 UTC");
    expect(statement.access).not.toBe(accessStateLabel("inactive"));
  });

  it("does not invent an end date when the projection states none", () => {
    const statement = subscriptionAccessStatement({
      accessState: "active",
      periodEnd: undefined,
      renewalIntent: "auto_renew_enabled",
    });
    expect(statement.access).toBe("Active with no end Mosaic can state");
  });
});

describe("entitlement source and explanation copy", () => {
  it("renders a permanent source as having no finite end rather than as expired", () => {
    // A one-time non-consumable has no `end`. Formatting an absent end as a
    // date, or reading it as elapsed, is the false-expiry failure.
    expect(sourceEndStatement({})).toBe(
      "No finite end — this source does not expire"
    );
    expect(sourceEndStatement({ end: "2026-01-01T00:00:00Z" })).toContain(
      "Ends 2026-01-01"
    );
  });

  it("shows an unrecognised explanation code verbatim instead of paraphrasing it", () => {
    // The contract's explanation vocabulary is closed: a reader may render its
    // own copy for a code but must never invent one.
    const sentence = explanationSentence("some_future_code");
    expect(sentence).toContain("some_future_code");
    expect(sentence).toContain("no copy for it");
  });

  it("keeps the cancellation explanation about renewal intent", () => {
    expect(
      explanationSentence("subscription_cancelled_access_until_period_end")
    ).toContain("Access continues until the validated period end");
  });
});
