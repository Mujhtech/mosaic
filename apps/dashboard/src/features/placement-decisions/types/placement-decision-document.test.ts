import { describe, expect, it } from "vitest";

import { toContractRuleSet } from "@/features/placement-decisions/types/placement-decision-document";

describe("Placement decision document authoring", () => {
  it("persists numeric priority and an intentional no-paywall outcome in the protocol contract", () => {
    const document = toContractRuleSet(
      {
        assignmentPolicy: "installation",
        defaultOutcome: { type: "no_paywall" },
        environmentId: "env",
        fallbacks: [],
        id: "draft",
        placementId: "placement",
        revision: 4,
        ruleSetId: "rule-set",
        rules: [
          {
            conditions: {
              children: [
                {
                  id: "platform",
                  kind: "condition",
                  operator: "equals",
                  source: "device.platform",
                  value: "ios",
                },
                {
                  id: "version",
                  kind: "condition",
                  operator: "greater_than_or_equal",
                  source: "application.version",
                  value: "2.3.0",
                },
              ],
              id: "group",
              kind: "all",
            },
            enabled: true,
            id: "rule-later",
            name: "Later",
            outcome: { type: "no_paywall" },
            priority: 20,
          },
          {
            conditions: {
              children: [
                {
                  id: "country",
                  kind: "condition",
                  operator: "equals",
                  source: "context.country",
                  value: "DE",
                },
                {
                  id: "locale",
                  kind: "condition",
                  operator: "locale_matches",
                  source: "application.locale",
                  value: "de",
                },
              ],
              id: "group-first",
              kind: "all",
            },
            enabled: true,
            id: "rule-first",
            name: "First",
            outcome: { type: "no_paywall" },
            priority: 0,
          },
        ],
        updatedAt: "2026-07-26T00:00:00Z",
      },
      {
        attributes: [],
        environmentKey: "staging",
        placementKey: "export_pdf",
        projectId: "project",
      }
    );

    expect(document.rules.map((rule) => [rule.id, rule.priority])).toEqual([
      ["rule-first", 0],
      ["rule-later", 20],
    ]);
    expect(document.defaultOutcome).toEqual({ type: "no_paywall" });
    expect(document.rules[1]?.conditions).toMatchObject({
      children: [
        { operand: { type: "string", value: "ios" } },
        { operand: { type: "semantic_version", value: "2.3.0" } },
      ],
      type: "all",
    });
  });
});
