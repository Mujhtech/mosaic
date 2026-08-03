import { describe, expect, it } from "vitest";

import {
  formatReportedCount,
  isReportedCount,
  NOT_REPORTED_LABEL,
  reportedCountTone,
} from "@/features/billing-ledger/types/billing-vocabulary";

/**
 * Protects: a counter the API did not send is never rendered as zero, and never
 * drives a "positive" tone.
 *
 * The failure this catches is the one an operations dashboard exists to
 * prevent. Roughly forty counters across billing health, projection health, and
 * reconciliation used `?? 0`, and several gated tone on the defaulted value — so
 * an API that stopped reporting failed jobs painted a green "0 failed" pill.
 * The page would look healthiest at exactly the moment it knew least.
 *
 * These helpers are the single chokepoint every one of those sites now goes
 * through, which makes this the cheapest place to hold the rule. Asserting it
 * per page would be forty near-identical component tests protecting one
 * decision.
 */
describe("billing counter tri-state", () => {
  it("never reports a tone of health for a counter it was not given", () => {
    for (const absent of [undefined, null, Number.NaN]) {
      expect(isReportedCount(absent)).toBe(false);
      expect(formatReportedCount(absent)).toBe(NOT_REPORTED_LABEL);
      // The critical assertion: absent resolves to neutral, not to the
      // caller's zero tone, whatever that zero tone is.
      expect(reportedCountTone(absent, "negative", "positive")).toBe("neutral");
      expect(reportedCountTone(absent, "attention", "neutral")).toBe("neutral");
    }
  });

  it("still distinguishes a measured zero from a non-zero count", () => {
    expect(formatReportedCount(0)).toBe("0");
    expect(reportedCountTone(0, "negative", "positive")).toBe("positive");
    expect(reportedCountTone(3, "negative", "positive")).toBe("negative");
    expect(reportedCountTone(3, "attention", "neutral")).toBe("attention");
  });
});
