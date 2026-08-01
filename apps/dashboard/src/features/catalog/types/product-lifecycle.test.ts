import { describe, expect, it } from "vitest";

import {
  canConfirmProductArchive,
  countProductUsage,
  replacementCandidates,
} from "@/features/catalog/types/product-lifecycle";

describe("Product lifecycle safeguards", () => {
  it("requires a replacement before confirming archive for an in-use Product", () => {
    const usageCount = countProductUsage({
      entitlements: [{ id: "entitlement_one" }],
      historicalReferences: [],
      plans: [{ id: "plan_one" }],
      providerMappings: [],
    });

    expect(usageCount).toBe(2);
    expect(canConfirmProductArchive(usageCount, false)).toBe(false);
    expect(canConfirmProductArchive(usageCount, true)).toBe(true);
  });

  it("excludes the current, archived, and incompatible Product types from replacement choices", () => {
    expect(
      replacementCandidates(
        [
          { id: "current", status: "draft", type: "subscription" },
          { id: "archived", status: "archived", type: "subscription" },
          {
            id: "incompatible",
            status: "connected",
            type: "one_time_non_consumable",
          },
          { id: "replacement", status: "connected", type: "subscription" },
        ],
        "current",
        "subscription"
      )
    ).toEqual([
      { id: "replacement", status: "connected", type: "subscription" },
    ]);
  });
});
