import { ArrowDownIcon } from "@phosphor-icons/react/dist/ssr/ArrowDown"
import { ArrowUpIcon } from "@phosphor-icons/react/dist/ssr/ArrowUp"
import { CopyIcon } from "@phosphor-icons/react/dist/ssr/Copy"
import { PlusIcon } from "@phosphor-icons/react/dist/ssr/Plus"
import { TrashIcon } from "@phosphor-icons/react/dist/ssr/Trash"

import { Button } from "@/components/ui/button"
import { ConditionEditor } from "@/features/placement-decisions/components/condition-editor"
import { OutcomeEditor } from "@/features/placement-decisions/components/outcome-editor"
import type {
  AttributeDefinition,
  DecisionValidationIssue,
  NamedFallback,
  PlacementRule,
} from "@/features/placement-decisions/types/placement-decision"
import { duplicateRule, moveRule } from "@/features/placement-decisions/types/rule-priority"
import type { HostedPaywallListItem } from "@/features/publishing/api/hosted-publishing-adapter"

function identifier(prefix: string) {
  return `${prefix}-${typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : Date.now().toString(36)}`
}

function createRule(priority: number): PlacementRule {
  return {
    conditions: {
      children: [
        {
          id: identifier("condition"),
          kind: "condition",
          operator: "equals",
          source: "device.platform",
          value: "ios",
        },
        {
          id: identifier("condition"),
          kind: "condition",
          operator: "greater_than_or_equal",
          source: "application.version",
          value: "1.0.0",
        },
      ],
      id: identifier("group"),
      kind: "all",
    },
    enabled: false,
    id: identifier("rule"),
    name: "New rule",
    outcome: { reason: "no_safe_decision", type: "unavailable" },
    priority,
  }
}

export function RuleBuilder({
  attributes,
  fallbacks,
  issues,
  onChange,
  paywalls,
  rules,
}: {
  attributes: readonly AttributeDefinition[]
  fallbacks: readonly NamedFallback[]
  issues: readonly DecisionValidationIssue[]
  onChange: (rules: readonly PlacementRule[]) => void
  paywalls: readonly HostedPaywallListItem[]
  rules: readonly PlacementRule[]
}) {
  const ordered = [...rules].sort((left, right) => left.priority - right.priority)

  return (
    <section aria-labelledby="rules-heading" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold" id="rules-heading">
            Rules
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Lowest priority number runs first. The first true enabled Rule wins; false and unknown
            continue.
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            New Rules start disabled with a safe unavailable outcome. Review the conditions and
            decision before enabling them.
          </p>
        </div>
        <Button
          disabled={rules.length >= 100}
          onClick={() => onChange([...ordered, createRule((ordered.at(-1)?.priority ?? -10) + 10)])}
          type="button"
        >
          <PlusIcon aria-hidden /> Add Rule
        </Button>
      </div>

      {ordered.length === 0 ? (
        <div className="border-border rounded border border-dashed p-6 text-center">
          <p className="font-medium">No advanced Rules</p>
          <p className="text-muted-foreground mt-1 text-sm">
            The default decision remains compatible with the existing simple Placement binding.
          </p>
        </div>
      ) : null}

      <ol className="space-y-4">
        {ordered.map((rule, index) => {
          const ruleIssues = issues.filter((issue) => issue.ruleId === rule.id)
          return (
            <li
              className="border-border scroll-mt-28 rounded border"
              id={`rule-${rule.id}`}
              key={rule.id}
              tabIndex={-1}
            >
              <div className="bg-muted/30 flex flex-wrap items-center gap-2 border-b p-3">
                <span
                  className="bg-background rounded border px-2 py-1 font-mono text-xs"
                  aria-label={`Priority ${rule.priority}`}
                >
                  {rule.priority}
                </span>
                <input
                  aria-label="Rule name"
                  className="border-input bg-background h-8 min-w-44 flex-1 rounded border px-2 text-sm font-semibold"
                  onChange={(event) =>
                    onChange(
                      ordered.map((item) =>
                        item.id === rule.id ? { ...item, name: event.currentTarget.value } : item,
                      ),
                    )
                  }
                  value={rule.name}
                />
                <label className="flex items-center gap-2 text-xs font-medium">
                  <input
                    checked={rule.enabled}
                    className="accent-primary size-4"
                    onChange={(event) =>
                      onChange(
                        ordered.map((item) =>
                          item.id === rule.id
                            ? { ...item, enabled: event.currentTarget.checked }
                            : item,
                        ),
                      )
                    }
                    type="checkbox"
                  />
                  Enabled
                </label>
                <Button
                  aria-label={`Move ${rule.name} up`}
                  disabled={index === 0}
                  onClick={() => onChange(moveRule(ordered, rule.id, "up"))}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <ArrowUpIcon aria-hidden />
                </Button>
                <Button
                  aria-label={`Move ${rule.name} down`}
                  disabled={index === ordered.length - 1}
                  onClick={() => onChange(moveRule(ordered, rule.id, "down"))}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <ArrowDownIcon aria-hidden />
                </Button>
                <Button
                  aria-label={`Duplicate ${rule.name}`}
                  onClick={() => onChange(duplicateRule(ordered, rule.id, identifier("rule")))}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <CopyIcon aria-hidden />
                </Button>
                <Button
                  aria-label={`Remove ${rule.name}`}
                  onClick={() => onChange(ordered.filter((item) => item.id !== rule.id))}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <TrashIcon aria-hidden />
                </Button>
              </div>

              <div className="grid gap-5 p-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(18rem,0.7fr)]">
                <ConditionEditor
                  attributes={attributes}
                  issues={ruleIssues}
                  onChange={(conditions) =>
                    onChange(
                      ordered.map((item) => (item.id === rule.id ? { ...item, conditions } : item)),
                    )
                  }
                  value={rule.conditions}
                />
                <div className="space-y-5">
                  <OutcomeEditor
                    fallbacks={fallbacks}
                    id={`rule-${rule.id}-outcome`}
                    onChange={(outcome) =>
                      onChange(
                        ordered.map((item) => (item.id === rule.id ? { ...item, outcome } : item)),
                      )
                    }
                    paywalls={paywalls}
                    value={rule.outcome}
                  />
                  <fieldset className="border-border rounded border p-3">
                    <legend className="px-1 text-xs font-semibold">Percentage rollout</legend>
                    <label className="mt-2 grid gap-1 text-xs font-medium">
                      Traffic percentage
                      <div className="flex items-center gap-2">
                        <input
                          className="border-input bg-background h-9 w-24 rounded border px-2 text-sm"
                          max={100}
                          min={0}
                          onChange={(event) => {
                            const percentage = Number(event.currentTarget.value)
                            onChange(
                              ordered.map((item) =>
                                item.id === rule.id
                                  ? {
                                      ...item,
                                      rollout:
                                        Number.isFinite(percentage) && percentage < 100
                                          ? { thresholdBasisPoints: Math.round(percentage * 100) }
                                          : undefined,
                                    }
                                  : item,
                              ),
                            )
                          }}
                          step={0.01}
                          type="number"
                          value={(rule.rollout?.thresholdBasisPoints ?? 10_000) / 100}
                        />
                        <span aria-hidden>%</span>
                      </div>
                    </label>
                    <div
                      className="bg-muted mt-3 h-2 overflow-hidden rounded-full"
                      role="img"
                      aria-label={`${(rule.rollout?.thresholdBasisPoints ?? 10_000) / 100} percent allocation`}
                    >
                      <div
                        className="bg-primary h-full"
                        style={{
                          width: `${(rule.rollout?.thresholdBasisPoints ?? 10_000) / 100}%`,
                        }}
                      />
                    </div>
                    <p className="text-muted-foreground mt-2 text-xs">
                      Stable traffic control using the selected assignment identity. This is not an
                      Experiment or a significance estimate.
                    </p>
                  </fieldset>
                  {ruleIssues
                    .filter((issue) => !issue.conditionId)
                    .map((issue) => (
                      <p
                        className={
                          issue.severity === "error"
                            ? "text-destructive text-sm"
                            : "text-muted-foreground text-sm"
                        }
                        key={`${issue.code}:${issue.message}`}
                        role={issue.severity === "error" ? "alert" : "status"}
                      >
                        {issue.message}
                      </p>
                    ))}
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
