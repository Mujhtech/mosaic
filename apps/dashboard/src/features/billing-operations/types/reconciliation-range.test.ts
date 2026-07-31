import { describe, expect, it } from "vitest";

import {
  MAX_RECONCILIATION_WINDOW_DAYS,
  validateReconciliationRange,
} from "@/features/billing-operations/types/reconciliation-range";

/**
 * Risk: an unbounded, inverted, or future reconciliation window is submitted. A
 * too-large window floods ingestion and burns store API quota; an inverted or
 * future one examines nothing while appearing to run.
 */

const NOW = new Date("2026-07-28T12:00:00Z");

function days(count: number) {
  return new Date(NOW.getTime() - count * 24 * 60 * 60 * 1000).toISOString();
}

describe("reconciliation window", () => {
  it("accepts a bounded past window", () => {
    expect(
      validateReconciliationRange({
        now: NOW,
        windowEnd: days(0),
        windowStart: days(7),
      })
    ).toEqual([]);
  });

  it("rejects an inverted window", () => {
    expect(
      validateReconciliationRange({
        now: NOW,
        windowEnd: days(7),
        windowStart: days(0),
      })
    ).toContain("start_not_before_end");
  });

  it("rejects a zero-length window", () => {
    expect(
      validateReconciliationRange({
        now: NOW,
        windowEnd: days(3),
        windowStart: days(3),
      })
    ).toContain("start_not_before_end");
  });

  it("rejects a window longer than the store's own history retention", () => {
    expect(
      validateReconciliationRange({
        now: NOW,
        windowEnd: days(0),
        windowStart: days(MAX_RECONCILIATION_WINDOW_DAYS + 1),
      })
    ).toContain("window_too_long");

    expect(
      validateReconciliationRange({
        now: NOW,
        windowEnd: days(0),
        windowStart: days(MAX_RECONCILIATION_WINDOW_DAYS),
      })
    ).toEqual([]);
  });

  it("rejects a window that ends in the future", () => {
    expect(
      validateReconciliationRange({
        now: NOW,
        windowEnd: days(-2),
        windowStart: days(3),
      })
    ).toContain("end_in_future");
  });

  it("rejects missing and unparseable bounds without throwing", () => {
    expect(
      validateReconciliationRange({
        now: NOW,
        windowEnd: days(0),
        windowStart: "",
      })
    ).toEqual(["start_required"]);
    expect(
      validateReconciliationRange({
        now: NOW,
        windowEnd: "tomorrow",
        windowStart: "yesterday",
      })
    ).toEqual(["invalid_timestamp"]);
  });
});
