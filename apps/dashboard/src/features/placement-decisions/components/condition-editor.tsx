import { PlusIcon } from "@phosphor-icons/react/dist/ssr/Plus"
import { TrashIcon } from "@phosphor-icons/react/dist/ssr/Trash"

import { Button } from "@/components/ui/button"
import type {
  AttributeDefinition,
  ConditionGroup,
  ConditionNode,
  ConditionOperator,
  ConditionSource,
  DecisionValidationIssue,
  LeafCondition,
} from "@/features/placement-decisions/types/placement-decision"

const SOURCES: readonly { label: string; value: ConditionSource }[] = [
  { label: "Platform", value: "device.platform" },
  { label: "Operating system version", value: "device.os_version" },
  { label: "Application version", value: "application.version" },
  { label: "Locale", value: "application.locale" },
  { label: "Explicit country", value: "context.country" },
  { label: "User attribute", value: "user_attribute" },
  { label: "Access state", value: "entitlement_state" },
  { label: "Product availability", value: "product_availability" },
  { label: "Product readiness", value: "product_readiness" },
  { label: "Provider capability", value: "provider_capability" },
]

const OPERATORS: readonly { label: string; value: ConditionOperator }[] = [
  { label: "equals", value: "equals" },
  { label: "does not equal", value: "not_equals" },
  { label: "is in", value: "in" },
  { label: "is not in", value: "not_in" },
  { label: "is greater than", value: "greater_than" },
  { label: "is at least", value: "greater_than_or_equal" },
  { label: "is less than", value: "less_than" },
  { label: "is at most", value: "less_than_or_equal" },
  { label: "exists", value: "exists" },
  { label: "does not exist", value: "does_not_exist" },
  { label: "contains any", value: "contains_any" },
  { label: "contains all", value: "contains_all" },
  { label: "locale matches", value: "locale_matches" },
]

const EXACT_OPERATORS: readonly ConditionOperator[] = [
  "equals",
  "not_equals",
  "in",
  "not_in",
  "exists",
  "does_not_exist",
]
const ORDERED_OPERATORS: readonly ConditionOperator[] = [
  ...EXACT_OPERATORS,
  "greater_than",
  "greater_than_or_equal",
  "less_than",
  "less_than_or_equal",
]
const USER_ATTRIBUTE_OPERATORS: readonly ConditionOperator[] = [
  ...ORDERED_OPERATORS,
  "contains_any",
  "contains_all",
]

function operatorsFor(
  condition: LeafCondition,
  attributes: readonly AttributeDefinition[],
): readonly ConditionOperator[] {
  if (condition.source === "application.locale") {
    return [...EXACT_OPERATORS, "locale_matches"]
  }
  if (condition.source === "application.version" || condition.source === "device.os_version") {
    return ORDERED_OPERATORS
  }
  if (condition.source === "user_attribute") {
    const definition = attributes.find((attribute) => attribute.key === condition.referenceKey)
    return definition
      ? definition.allowedOperators.filter((operator) =>
          USER_ATTRIBUTE_OPERATORS.includes(operator),
        )
      : USER_ATTRIBUTE_OPERATORS
  }
  return EXACT_OPERATORS
}

function id(prefix: string) {
  return `${prefix}-${typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : Date.now().toString(36)}`
}

function newLeaf(): LeafCondition {
  return {
    id: id("condition"),
    kind: "condition",
    operator: "equals",
    source: "device.platform",
    value: "ios",
  }
}

function updateChild(group: ConditionGroup, childId: string, child: ConditionNode): ConditionGroup {
  return { ...group, children: group.children.map((item) => (item.id === childId ? child : item)) }
}

export function ConditionEditor({
  attributes,
  depth = 1,
  issues,
  onChange,
  value,
}: {
  attributes: readonly AttributeDefinition[]
  depth?: number
  issues: readonly DecisionValidationIssue[]
  onChange: (value: ConditionGroup) => void
  value: ConditionGroup
}) {
  const maxChildren = value.kind === "not" ? 1 : 16
  return (
    <fieldset className="border-border space-y-3 rounded border p-3">
      <legend className="px-1 text-xs font-semibold">Condition group {depth} of 5</legend>
      <label className="grid gap-1 text-xs font-medium sm:max-w-52">
        Match
        <select
          className="border-input bg-background h-8 rounded border px-2 text-sm"
          onChange={(event) => {
            const kind = event.currentTarget.value as ConditionGroup["kind"]
            onChange({
              ...value,
              children: kind === "not" ? value.children.slice(0, 1) : value.children,
              kind,
            })
          }}
          value={value.kind}
        >
          <option value="all">All conditions</option>
          <option value="any">Any condition</option>
          <option value="not">Not</option>
        </select>
      </label>

      {value.children.map((node) =>
        node.kind === "condition" ? (
          <LeafEditor
            attributes={attributes}
            issues={issues.filter((issue) => issue.conditionId === node.id)}
            key={node.id}
            onChange={(child) => onChange(updateChild(value, node.id, child))}
            onRemove={() =>
              onChange({ ...value, children: value.children.filter((item) => item.id !== node.id) })
            }
            value={node}
          />
        ) : (
          <div className="border-border/70 space-y-2 border-s ps-3" key={node.id}>
            <ConditionEditor
              attributes={attributes}
              depth={depth + 1}
              issues={issues}
              onChange={(child) => onChange(updateChild(value, node.id, child))}
              value={node}
            />
            <Button
              onClick={() =>
                onChange({
                  ...value,
                  children: value.children.filter((item) => item.id !== node.id),
                })
              }
              size="sm"
              type="button"
              variant="ghost"
            >
              <TrashIcon aria-hidden /> Remove group
            </Button>
          </div>
        ),
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          disabled={value.children.length >= maxChildren}
          onClick={() => onChange({ ...value, children: [...value.children, newLeaf()] })}
          size="sm"
          type="button"
          variant="outline"
        >
          <PlusIcon aria-hidden /> Add condition
        </Button>
        <Button
          disabled={depth >= 5 || value.kind === "not" || value.children.length >= maxChildren}
          onClick={() =>
            onChange({
              ...value,
              children: [
                ...value.children,
                { children: [newLeaf(), newLeaf()], id: id("group"), kind: "all" },
              ],
            })
          }
          size="sm"
          type="button"
          variant="outline"
        >
          <PlusIcon aria-hidden /> Add group
        </Button>
      </div>
      {value.children.length < (value.kind === "not" ? 1 : 2) ? (
        <p className="text-destructive text-xs" role="alert">
          {value.kind === "not"
            ? "Not requires exactly one child."
            : "All and Any require at least two children."}
        </p>
      ) : null}
    </fieldset>
  )
}

function LeafEditor({
  attributes,
  issues,
  onChange,
  onRemove,
  value,
}: {
  attributes: readonly AttributeDefinition[]
  issues: readonly DecisionValidationIssue[]
  onChange: (value: LeafCondition) => void
  onRemove: () => void
  value: LeafCondition
}) {
  const allowedOperators = operatorsFor(value, attributes)
  const noOperand = value.operator === "exists" || value.operator === "does_not_exist"
  const referenceLabel =
    value.source === "entitlement_state"
      ? "Access key"
      : value.source === "product_availability" || value.source === "product_readiness"
        ? "Product ID"
        : value.source === "provider_capability"
          ? "Capability"
          : undefined
  return (
    <div className="bg-muted/25 grid gap-2 rounded border p-3 md:grid-cols-[1fr_1fr_1fr_1fr_auto] md:items-start">
      <label className="grid gap-1 text-xs font-medium">
        Source
        <select
          className="border-input bg-background h-8 rounded border px-2 text-sm"
          onChange={(event) => {
            const source = event.currentTarget.value as ConditionSource
            onChange({
              ...value,
              operator: "equals",
              referenceKey: undefined,
              source,
            })
          }}
          value={value.source}
        >
          {SOURCES.map((source) => (
            <option key={source.value} value={source.value}>
              {source.label}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-xs font-medium">
        Operator
        <select
          className="border-input bg-background h-8 rounded border px-2 text-sm"
          onChange={(event) =>
            onChange({ ...value, operator: event.currentTarget.value as ConditionOperator })
          }
          value={value.operator}
        >
          {OPERATORS.filter((operator) => allowedOperators.includes(operator.value)).map(
            (operator) => (
              <option key={operator.value} value={operator.value}>
                {operator.label}
              </option>
            ),
          )}
        </select>
      </label>
      {value.source === "user_attribute" ? (
        <label className="grid gap-1 text-xs font-medium">
          Attribute
          <select
            className="border-input bg-background h-8 rounded border px-2 text-sm"
            onChange={(event) => {
              const referenceKey = event.currentTarget.value
              const next = { ...value, referenceKey }
              const nextOperators = operatorsFor(next, attributes)
              onChange({
                ...next,
                operator: nextOperators.includes(value.operator)
                  ? value.operator
                  : (nextOperators[0] ?? "equals"),
              })
            }}
            value={value.referenceKey ?? ""}
          >
            <option value="">Select attribute</option>
            {attributes
              .filter((attribute) => attribute.status === "active")
              .map((attribute) => (
                <option key={attribute.id} value={attribute.key}>
                  {attribute.key}
                </option>
              ))}
          </select>
        </label>
      ) : referenceLabel ? (
        <label className="grid gap-1 text-xs font-medium">
          {referenceLabel}
          <input
            className="border-input bg-background h-8 rounded border px-2 text-sm"
            onChange={(event) => onChange({ ...value, referenceKey: event.currentTarget.value })}
            value={value.referenceKey ?? ""}
          />
        </label>
      ) : (
        <span />
      )}
      {noOperand ? (
        <span />
      ) : (
        <label className="grid gap-1 text-xs font-medium">
          {value.source === "context.country" ? "Country (explicit host input)" : "Value"}
          <input
            className="border-input bg-background h-8 rounded border px-2 text-sm"
            onChange={(event) => onChange({ ...value, value: event.currentTarget.value })}
            placeholder={value.source === "application.version" ? "2.3.0" : undefined}
            value={typeof value.value === "string" ? value.value : ""}
          />
        </label>
      )}
      <Button
        aria-label="Remove condition"
        onClick={onRemove}
        size="icon"
        type="button"
        variant="ghost"
      >
        <TrashIcon aria-hidden />
      </Button>
      {issues.map((issue) => (
        <p className="text-destructive text-xs md:col-span-5" key={issue.code} role="alert">
          {issue.message}
        </p>
      ))}
    </div>
  )
}
