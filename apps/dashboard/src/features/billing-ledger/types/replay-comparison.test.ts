import { describe, expect, it } from "vitest";

import {
  compareReplayAttempts,
  selectComparableAttempts,
} from "@/features/billing-ledger/types/replay-comparison";
import type { TransactionFact, ValidationAttempt } from "@/generated/api";

/**
 * Risk: a replay silently replaces or hides the earlier Validation Attempt, or
 * a contradicting result is presented as a plain update. Either destroys the
 * audit history the ledger exists to hold, and the second one lets an operator
 * act on a changed answer without knowing it changed.
 */

function attempt(overrides: Partial<ValidationAttempt>): ValidationAttempt {
  return {
    attemptNumber: 1,
    id: "attempt_1",
    outcome: "validated",
    startedAt: "2026-07-01T00:00:00Z",
    storeEnvironment: "production",
    validatorVersion: 1,
    ...overrides,
  };
}

describe("replay comparison", () => {
  it("keeps both attempts, whichever order the caller supplies", () => {
    const earlier = attempt({
      attemptNumber: 4,
      id: "attempt_4",
      outcome: "quarantined",
    });
    const later = attempt({
      attemptNumber: 5,
      id: "attempt_5",
      outcome: "validated",
    });

    const forwards = compareReplayAttempts(
      { attempt: earlier },
      { attempt: later }
    );
    const backwards = compareReplayAttempts(
      { attempt: later },
      { attempt: earlier }
    );

    expect(forwards.earlierAttemptNumber).toBe(4);
    expect(forwards.latestAttemptNumber).toBe(5);
    // Supplying the pair in the other order must not relabel history.
    expect(backwards.earlierAttemptNumber).toBe(4);
    expect(backwards.latestAttemptNumber).toBe(5);

    const outcomeRow = forwards.rows.find((row) => row.label === "Outcome");
    expect(outcomeRow?.earlier).toBe("Quarantined");
    expect(outcomeRow?.latest).toBe("Validated");
  });

  it("flags a conflict when the outcome or the resolved Product changes", () => {
    const earlier = attempt({
      attemptNumber: 1,
      id: "attempt_1",
      outcome: "validated",
    });
    const later = attempt({
      attemptNumber: 2,
      id: "attempt_2",
      outcome: "quarantined",
    });

    const outcomeConflict = compareReplayAttempts(
      { attempt: earlier },
      { attempt: later }
    );
    expect(outcomeConflict.hasConflict).toBe(true);
    expect(outcomeConflict.conflicts).toContain("outcome_changed");

    const productConflict = compareReplayAttempts(
      {
        attempt: earlier,
        fact: { mosaicProductId: "prod_a" } as TransactionFact,
      },
      {
        attempt: attempt({ attemptNumber: 2, id: "attempt_2" }),
        fact: { mosaicProductId: "prod_b" } as TransactionFact,
      }
    );
    expect(productConflict.conflicts).toEqual(["resolved_product_changed"]);
  });

  it("reports no conflict, and marks fields unchanged, when the replay reproduces the result", () => {
    const fact = {
      mosaicProductId: "prod_a",
      resolutionState: "active_mapping",
    } as TransactionFact;
    const comparison = compareReplayAttempts(
      { attempt: attempt({ attemptNumber: 1, id: "attempt_1" }), fact },
      { attempt: attempt({ attemptNumber: 2, id: "attempt_2" }), fact }
    );

    expect(comparison.hasConflict).toBe(false);
    expect(
      comparison.rows.find((row) => row.label === "Outcome")?.changed
    ).toBe(false);
    expect(
      comparison.rows.find((row) => row.label === "Resolved Mosaic Product")
        ?.changed
    ).toBe(false);
  });

  it("compares the newest attempt against the one before it and leaves older ones intact", () => {
    const attempts = [
      attempt({ attemptNumber: 1, id: "attempt_1" }),
      attempt({ attemptNumber: 3, id: "attempt_3" }),
      attempt({ attemptNumber: 2, id: "attempt_2" }),
    ];

    const pair = selectComparableAttempts(attempts);

    expect(pair?.[0].attempt.id).toBe("attempt_2");
    expect(pair?.[1].attempt.id).toBe("attempt_3");
    // The input array is the attempt history and must not be reordered in place.
    expect(attempts.map((item) => item.id)).toEqual([
      "attempt_1",
      "attempt_3",
      "attempt_2",
    ]);
  });

  it("produces no comparison from a single attempt rather than inventing a baseline", () => {
    expect(selectComparableAttempts([attempt({})])).toBeUndefined();
  });
});
