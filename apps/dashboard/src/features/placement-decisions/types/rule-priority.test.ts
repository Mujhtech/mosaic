import { describe, expect, it } from "vitest";
import type { PlacementRule } from "@/features/placement-decisions/types/placement-decision";
import { moveRule } from "@/features/placement-decisions/types/rule-priority";

function rule(id: string, priority: number): PlacementRule {
  return {
    conditions: { children: [], id: `${id}-group`, kind: "all" },
    enabled: true,
    id,
    name: id,
    outcome: { type: "no_paywall" },
    priority,
  };
}

describe("rule priority", () => {
  it("rewrites explicit numeric priority when a rule moves", () => {
    const moved = moveRule(
      [rule("later", 20), rule("first", 0), rule("middle", 10)],
      "later",
      "up"
    );
    expect(moved.map(({ id, priority }) => ({ id, priority }))).toEqual([
      { id: "first", priority: 0 },
      { id: "later", priority: 10 },
      { id: "middle", priority: 20 },
    ]);
  });
});
