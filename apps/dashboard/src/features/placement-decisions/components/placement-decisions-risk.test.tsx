import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PlacementDecisionsAdapter } from "@/features/placement-decisions/api/placement-decisions-adapter";
import { ConditionEditor } from "@/features/placement-decisions/components/condition-editor";
import { DecisionSimulator } from "@/features/placement-decisions/components/decision-simulator";
import { OutcomeEditor } from "@/features/placement-decisions/components/outcome-editor";
import { ValidationSummary } from "@/features/placement-decisions/components/placement-decision-page";
import { QaOverrides } from "@/features/placement-decisions/components/qa-overrides";
import { RuleBuilder } from "@/features/placement-decisions/components/rule-builder";
import { openPlacementRule } from "@/features/placement-decisions/components/rule-navigation";
import { chooseSelectOption } from "@/test/select";

function adapter(
  overrides: Partial<PlacementDecisionsAdapter> = {}
): PlacementDecisionsAdapter {
  const unavailable = () => Promise.reject(new Error("not used"));
  return {
    archiveAttribute: unavailable,
    archivePlacement: unavailable,
    archiveRuleSet: unavailable,
    createAlias: unavailable,
    createAttribute: unavailable,
    createOverride: unavailable,
    getPlacementDecision: unavailable,
    listAttributes: unavailable,
    listOverrides: async () => [],
    publishRuleSet: unavailable,
    revokeOverride: unavailable,
    saveDraft: unavailable,
    simulate: unavailable,
    status: "available",
    updatePlacement: unavailable,
    validateDraft: unavailable,
    ...overrides,
  };
}

function withQueryClient(node: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {node}
    </QueryClientProvider>
  );
}

describe("Placement decision risk controls", () => {
  it("creates a disabled Rule with a safe unavailable decision", () => {
    const onChange = vi.fn();
    render(
      <RuleBuilder
        attributes={[]}
        fallbacks={[]}
        issues={[]}
        onChange={onChange}
        paywalls={[]}
        rules={[]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Add Rule" }));

    const [nextRules] = onChange.mock.calls[0] as [
      readonly {
        enabled: boolean;
        outcome: { type: string; reason?: string };
      }[],
    ];
    expect(nextRules[0]).toMatchObject({
      enabled: false,
      outcome: { reason: "no_safe_decision", type: "unavailable" },
    });
  });

  it("offers only operators supported by the selected source", async () => {
    const onChange = vi.fn();
    render(
      <ConditionEditor
        attributes={[]}
        issues={[]}
        onChange={onChange}
        value={{
          children: [
            {
              id: "condition-version",
              kind: "condition",
              operator: "greater_than",
              source: "application.version",
              value: "2.0.0",
            },
            {
              id: "condition-platform",
              kind: "condition",
              operator: "equals",
              source: "device.platform",
              value: "ios",
            },
          ],
          id: "group",
          kind: "all",
        }}
      />
    );

    const source = screen.getAllByLabelText("Source")[0]!;
    const [operator, exactOperator] = screen.getAllByLabelText("Operator");

    // The options only exist while the list is open, so each row is inspected
    // in turn rather than by reading a closed control's DOM.
    fireEvent.click(operator!);
    expect(
      await screen.findByRole("option", { name: "is greater than" })
    ).toBeVisible();
    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.queryByRole("option", { name: "is greater than" })
      ).not.toBeInTheDocument()
    );

    fireEvent.click(exactOperator!);
    expect(await screen.findByRole("option", { name: "equals" })).toBeVisible();
    expect(
      screen.queryByRole("option", { name: "is greater than" })
    ).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Escape" });

    await chooseSelectOption(source, "Explicit country");
    const changed = onChange.mock.calls.at(-1)?.[0];
    expect(changed.children[0]).toMatchObject({
      operator: "equals",
      source: "context.country",
    });
  });

  it("presents no Paywall as an intentional successful decision", () => {
    render(
      <OutcomeEditor
        fallbacks={[]}
        id="test-outcome"
        onChange={vi.fn()}
        paywalls={[]}
        value={{ type: "no_paywall" }}
      />
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "intentional successful decision"
    );
    expect(screen.getByRole("status")).not.toHaveTextContent(/error|failed/i);
  });

  it("surfaces shadow warnings without blocking a valid decision", () => {
    render(
      <ValidationSummary
        issues={[
          {
            code: "rule_shadowed_by_earlier_equivalent",
            message:
              "An earlier enabled Rule has the same conditions and will always win first.",
            ruleId: "shadowed-rule",
            severity: "warning",
          },
        ]}
        onOpenRule={vi.fn()}
        valid
      />
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Ready to publish with 1 warning"
    );
    expect(screen.getByRole("status")).not.toHaveTextContent(
      "Publishing is blocked"
    );
    expect(screen.getByText(/earlier enabled Rule/)).toBeVisible();
  });

  it("places server validation beside the affected condition control", () => {
    render(
      <ConditionEditor
        attributes={[]}
        issues={[
          {
            code: "condition.operator.invalid",
            conditionId: "condition-country",
            message: "Country supports equals, not lexical comparison.",
            severity: "error",
          },
        ]}
        onChange={vi.fn()}
        value={{
          children: [
            {
              id: "condition-country",
              kind: "condition",
              operator: "greater_than",
              source: "context.country",
              value: "DE",
            },
            {
              id: "condition-platform",
              kind: "condition",
              operator: "equals",
              source: "device.platform",
              value: "ios",
            },
          ],
          id: "group",
          kind: "all",
        }}
      />
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Country supports equals"
    );
  });

  it("links a redacted unknown trace step back to its Rule", async () => {
    const onOpenRule = vi.fn();
    const simulate = vi.fn(async () => ({
      assignmentKeyType: "installation" as const,
      fallbackPath: [],
      finalOutcome: { type: "no_paywall" as const },
      trace: [
        {
          detail: "raw student value",
          id: "step-1",
          label: "Sensitive student attribute",
          result: "unknown" as const,
          ruleId: "student-rule",
          sensitive: true,
          source: "host_application",
        },
      ],
      winningRuleId: "student-rule",
    }));
    withQueryClient(
      <DecisionSimulator
        adapter={adapter({ simulate })}
        attributes={[]}
        onOpenRule={onOpenRule}
        scope={{
          environmentId: "env",
          placementId: "placement",
          projectId: "project",
        }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Run simulation" }));
    await waitFor(() => expect(simulate).toHaveBeenCalledOnce());
    expect(screen.getByText("Sensitive value redacted")).toBeVisible();
    expect(screen.queryByText("raw student value")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open Rule" }));
    expect(onOpenRule).toHaveBeenCalledWith("student-rule");
    expect(screen.getByLabelText("Unknown")).toBeVisible();
  });

  it("switches to Rules before scrolling and focusing the requested Rule", async () => {
    const openRulesTab = vi.fn();
    const rule = document.createElement("article");
    rule.id = "rule-recovery";
    rule.tabIndex = -1;
    rule.scrollIntoView = vi.fn();
    document.body.append(rule);

    openPlacementRule("recovery", openRulesTab);

    expect(openRulesTab).toHaveBeenCalledOnce();
    await waitFor(() => expect(rule).toHaveFocus());
    expect(rule.scrollIntoView).toHaveBeenCalledWith({ block: "start" });
    rule.remove();
  });

  it("blocks Test Override creation in production", async () => {
    const createOverride = vi.fn();
    withQueryClient(
      <QaOverrides
        adapter={adapter({ createOverride })}
        environmentKind="production"
        scope={{
          environmentId: "env",
          placementId: "placement",
          projectId: "project",
        }}
      />
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Production overrides are unavailable"
    );
    expect(
      screen.queryByRole("button", { name: "Create override" })
    ).not.toBeInTheDocument();
    expect(createOverride).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByText(/No Test Overrides/)).toBeVisible()
    );
  });
});
