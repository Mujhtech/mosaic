import { PlusIcon } from "@phosphor-icons/react/dist/ssr/Plus";
import { TrashIcon } from "@phosphor-icons/react/dist/ssr/Trash";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  AttributeDefinition,
  ConditionGroup,
  ConditionNode,
  ConditionOperator,
  ConditionSource,
  DecisionValidationIssue,
  LeafCondition,
} from "@/features/placement-decisions/types/placement-decision";

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
];

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
];

const EXACT_OPERATORS: readonly ConditionOperator[] = [
  "equals",
  "not_equals",
  "in",
  "not_in",
  "exists",
  "does_not_exist",
];
const ORDERED_OPERATORS: readonly ConditionOperator[] = [
  ...EXACT_OPERATORS,
  "greater_than",
  "greater_than_or_equal",
  "less_than",
  "less_than_or_equal",
];
const USER_ATTRIBUTE_OPERATORS: readonly ConditionOperator[] = [
  ...ORDERED_OPERATORS,
  "contains_any",
  "contains_all",
];

function operatorsFor(
  condition: LeafCondition,
  attributes: readonly AttributeDefinition[]
): readonly ConditionOperator[] {
  if (condition.source === "application.locale") {
    return [...EXACT_OPERATORS, "locale_matches"];
  }
  if (
    condition.source === "application.version" ||
    condition.source === "device.os_version"
  ) {
    return ORDERED_OPERATORS;
  }
  if (condition.source === "user_attribute") {
    const definition = attributes.find(
      (attribute) => attribute.key === condition.referenceKey
    );
    return definition
      ? definition.allowedOperators.filter((operator) =>
          USER_ATTRIBUTE_OPERATORS.includes(operator)
        )
      : USER_ATTRIBUTE_OPERATORS;
  }
  return EXACT_OPERATORS;
}

function id(prefix: string) {
  return `${prefix}-${typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : Date.now().toString(36)}`;
}

function newLeaf(): LeafCondition {
  return {
    id: id("condition"),
    kind: "condition",
    operator: "equals",
    source: "device.platform",
    value: "ios",
  };
}

function updateChild(
  group: ConditionGroup,
  childId: string,
  child: ConditionNode
): ConditionGroup {
  return {
    ...group,
    children: group.children.map((item) =>
      item.id === childId ? child : item
    ),
  };
}

const GROUP_KIND_OPTIONS = [
  { label: "All conditions", value: "all" },
  { label: "Any condition", value: "any" },
  { label: "Not", value: "not" },
];

export function ConditionEditor({
  attributes,
  depth = 1,
  issues,
  onChange,
  value,
}: {
  attributes: readonly AttributeDefinition[];
  depth?: number;
  issues: readonly DecisionValidationIssue[];
  onChange: (value: ConditionGroup) => void;
  value: ConditionGroup;
}) {
  const maxChildren = value.kind === "not" ? 1 : 16;
  return (
    <fieldset className="space-y-3 rounded border border-border p-3">
      <legend className="px-1 font-semibold text-xs">
        Condition group {depth} of 5
      </legend>
      <div className="grid gap-1 font-medium text-xs sm:max-w-52">
        <label htmlFor={`condition-group-kind-${depth}`}>Match</label>
        <Select
          items={GROUP_KIND_OPTIONS}
          onValueChange={(selectedValue) => {
            const kind = selectedValue as ConditionGroup["kind"];
            onChange({
              ...value,
              children:
                kind === "not" ? value.children.slice(0, 1) : value.children,
              kind,
            });
          }}
          value={value.kind}
        >
          <SelectTrigger id={`condition-group-kind-${depth}`} size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GROUP_KIND_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {value.children.map((node) =>
        node.kind === "condition" ? (
          <LeafEditor
            attributes={attributes}
            issues={issues.filter((issue) => issue.conditionId === node.id)}
            key={node.id}
            onChange={(child) => onChange(updateChild(value, node.id, child))}
            onRemove={() =>
              onChange({
                ...value,
                children: value.children.filter((item) => item.id !== node.id),
              })
            }
            value={node}
          />
        ) : (
          <div
            className="space-y-2 border-border/70 border-s ps-3"
            key={node.id}
          >
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
                  children: value.children.filter(
                    (item) => item.id !== node.id
                  ),
                })
              }
              size="sm"
              type="button"
              variant="ghost"
            >
              <TrashIcon aria-hidden /> Remove group
            </Button>
          </div>
        )
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          disabled={value.children.length >= maxChildren}
          onClick={() =>
            onChange({ ...value, children: [...value.children, newLeaf()] })
          }
          size="sm"
          type="button"
          variant="outline"
        >
          <PlusIcon aria-hidden /> Add condition
        </Button>
        <Button
          disabled={
            depth >= 5 ||
            value.kind === "not" ||
            value.children.length >= maxChildren
          }
          onClick={() =>
            onChange({
              ...value,
              children: [
                ...value.children,
                {
                  children: [newLeaf(), newLeaf()],
                  id: id("group"),
                  kind: "all",
                },
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
  );
}

function LeafEditor({
  attributes,
  issues,
  onChange,
  onRemove,
  value,
}: {
  attributes: readonly AttributeDefinition[];
  issues: readonly DecisionValidationIssue[];
  onChange: (value: LeafCondition) => void;
  onRemove: () => void;
  value: LeafCondition;
}) {
  const fieldId = useId();
  const allowedOperators = operatorsFor(value, attributes);
  const operatorOptions = OPERATORS.filter((operator) =>
    allowedOperators.includes(operator.value)
  );
  const attributeOptions = [
    { label: "Select attribute", value: "" },
    ...attributes.flatMap((attribute) =>
      attribute.status === "active"
        ? [{ label: attribute.key, value: attribute.key }]
        : []
    ),
  ];
  const noOperand =
    value.operator === "exists" || value.operator === "does_not_exist";
  const referenceLabel = (() => {
    if (value.source === "entitlement_state") {
      return "Access key";
    }
    if (
      value.source === "product_availability" ||
      value.source === "product_readiness"
    ) {
      return "Product ID";
    }
    if (value.source === "provider_capability") {
      return "Capability";
    }
  })();
  return (
    <div className="grid gap-2 rounded border bg-muted/25 p-3 md:grid-cols-[1fr_1fr_1fr_1fr_auto] md:items-start">
      <div className="grid gap-1 font-medium text-xs">
        <label htmlFor={`condition-source-${fieldId}`}>Source</label>
        <Select
          items={SOURCES}
          onValueChange={(selectedValue) => {
            const source = selectedValue as ConditionSource;
            onChange({
              ...value,
              operator: "equals",
              referenceKey: undefined,
              source,
            });
          }}
          value={value.source}
        >
          <SelectTrigger id={`condition-source-${fieldId}`} size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SOURCES.map((source) => (
              <SelectItem key={source.value} value={source.value}>
                {source.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1 font-medium text-xs">
        <label htmlFor={`condition-operator-${fieldId}`}>Operator</label>
        <Select
          items={operatorOptions}
          onValueChange={(selectedValue) =>
            onChange({ ...value, operator: selectedValue as ConditionOperator })
          }
          value={value.operator}
        >
          <SelectTrigger id={`condition-operator-${fieldId}`} size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {operatorOptions.map((operator) => (
              <SelectItem key={operator.value} value={operator.value}>
                {operator.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {(() => {
        if (value.source === "user_attribute") {
          return (
            <div className="grid gap-1 font-medium text-xs">
              <label htmlFor={`condition-attribute-${fieldId}`}>
                Attribute
              </label>
              <Select
                items={attributeOptions}
                onValueChange={(referenceKey) => {
                  const next = { ...value, referenceKey };
                  const nextOperators = operatorsFor(next, attributes);
                  onChange({
                    ...next,
                    operator: nextOperators.includes(value.operator)
                      ? value.operator
                      : (nextOperators[0] ?? "equals"),
                  });
                }}
                value={value.referenceKey ?? ""}
              >
                <SelectTrigger id={`condition-attribute-${fieldId}`} size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {attributeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        }
        if (referenceLabel) {
          return (
            <label className="grid gap-1 font-medium text-xs">
              {referenceLabel}
              <input
                className="h-8 rounded border border-input bg-background px-2 text-sm"
                onChange={(event) =>
                  onChange({
                    ...value,
                    referenceKey: event.currentTarget.value,
                  })
                }
                value={value.referenceKey ?? ""}
              />
            </label>
          );
        }
        return <span />;
      })()}
      {noOperand ? (
        <span />
      ) : (
        <label className="grid gap-1 font-medium text-xs">
          {value.source === "context.country"
            ? "Country (explicit host input)"
            : "Value"}
          <input
            className="h-8 rounded border border-input bg-background px-2 text-sm"
            onChange={(event) =>
              onChange({ ...value, value: event.currentTarget.value })
            }
            placeholder={
              value.source === "application.version" ? "2.3.0" : undefined
            }
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
        <p
          className="text-destructive text-xs md:col-span-5"
          key={issue.code}
          role="alert"
        >
          {issue.message}
        </p>
      ))}
    </div>
  );
}
