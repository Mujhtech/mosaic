import { CheckCircleIcon } from "@phosphor-icons/react/dist/ssr/CheckCircle";

import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  DecisionOutcome,
  NamedFallback,
} from "@/features/placement-decisions/types/placement-decision";
import type { HostedPaywallListItem } from "@/features/publishing/api/hosted-publishing-adapter";

const OUTCOME_TYPE_OPTIONS = [
  { label: "Show Paywall", value: "paywall" },
  { label: "Show no Paywall", value: "no_paywall" },
  { label: "Use named fallback", value: "fallback" },
  { label: "Return unavailable", value: "unavailable" },
];

const UNAVAILABLE_REASON_OPTIONS = [
  { label: "No safe decision", value: "no_safe_decision" },
  { label: "Configuration incompatible", value: "configuration_incompatible" },
  { label: "Content unavailable", value: "content_unavailable" },
  { label: "Commerce unavailable", value: "commerce_unavailable" },
];

export function OutcomeEditor({
  fallbacks,
  id,
  label = "Outcome",
  onChange,
  paywalls,
  value,
}: {
  fallbacks: readonly NamedFallback[];
  id: string;
  label?: string;
  onChange: (value: DecisionOutcome) => void;
  paywalls: readonly HostedPaywallListItem[];
  value: DecisionOutcome;
}) {
  const paywallOptions = [
    { label: "Select a Paywall", value: "" },
    ...paywalls
      .filter((paywall) => paywall.status === "active")
      .map((paywall) => ({ label: paywall.name, value: paywall.id })),
  ];
  const fallbackOptions = [
    { label: "Select a named fallback", value: "" },
    ...fallbacks.map((fallback) => ({
      label: fallback.key,
      value: fallback.key,
    })),
  ];

  return (
    <div className="space-y-3">
      <Field>
        <FieldLabel htmlFor={`${id}-type`}>{label}</FieldLabel>
        <Select
          items={OUTCOME_TYPE_OPTIONS}
          onValueChange={(selectedValue) => {
            const type = selectedValue as DecisionOutcome["type"];
            if (type === "paywall") {
              onChange({ type, paywallVersionId: paywalls[0]?.id ?? "" });
            }
            if (type === "no_paywall") {
              onChange({ type });
            }
            if (type === "fallback") {
              onChange({ type, fallbackKey: fallbacks[0]?.key ?? "" });
            }
            if (type === "unavailable") {
              onChange({ type, reason: "no_safe_decision" });
            }
          }}
          value={value.type}
        >
          <SelectTrigger id={`${id}-type`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OUTCOME_TYPE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {value.type === "paywall" ? (
        <Field>
          <FieldLabel htmlFor={`${id}-paywall`}>Published Paywall</FieldLabel>
          <Select
            items={paywallOptions}
            onValueChange={(selectedValue) =>
              onChange({ ...value, paywallVersionId: selectedValue })
            }
            value={value.paywallVersionId}
          >
            <SelectTrigger id={`${id}-paywall`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {paywallOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-xs">
            Publication pins the current immutable published version and checks
            Product readiness.
          </p>
        </Field>
      ) : null}

      {value.type === "fallback" ? (
        <Field>
          <FieldLabel htmlFor={`${id}-fallback`}>Fallback</FieldLabel>
          <Select
            items={fallbackOptions}
            onValueChange={(selectedValue) =>
              onChange({ type: "fallback", fallbackKey: selectedValue })
            }
            value={value.fallbackKey}
          >
            <SelectTrigger id={`${id}-fallback`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {fallbackOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      ) : null}

      {value.type === "no_paywall" ? (
        <p
          className="flex items-start gap-2 rounded border border-primary/30 bg-primary/5 p-3 text-sm"
          role="status"
        >
          <CheckCircleIcon
            aria-hidden
            className="mt-0.5 shrink-0 text-primary"
            weight="fill"
          />
          This is an intentional successful decision. Mosaic will not present a
          Paywall or enter a fallback.
        </p>
      ) : null}

      {value.type === "unavailable" ? (
        <Field>
          <FieldLabel htmlFor={`${id}-reason`}>Safe reason code</FieldLabel>
          <Select
            items={UNAVAILABLE_REASON_OPTIONS}
            onValueChange={(selectedValue) =>
              onChange({
                type: "unavailable",
                reason: selectedValue as Extract<
                  DecisionOutcome,
                  { type: "unavailable" }
                >["reason"],
              })
            }
            value={value.reason}
          >
            <SelectTrigger id={`${id}-reason`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {UNAVAILABLE_REASON_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      ) : null}
    </div>
  );
}
