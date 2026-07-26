import { CheckCircleIcon } from "@phosphor-icons/react/dist/ssr/CheckCircle"

import { Field, FieldLabel } from "@/components/ui/field"
import type {
  DecisionOutcome,
  NamedFallback,
} from "@/features/placement-decisions/types/placement-decision"
import type { HostedPaywallListItem } from "@/features/publishing/api/hosted-publishing-adapter"

export function OutcomeEditor({
  fallbacks,
  id,
  label = "Outcome",
  onChange,
  paywalls,
  value,
}: {
  fallbacks: readonly NamedFallback[]
  id: string
  label?: string
  onChange: (value: DecisionOutcome) => void
  paywalls: readonly HostedPaywallListItem[]
  value: DecisionOutcome
}) {
  return (
    <div className="space-y-3">
      <Field>
        <FieldLabel htmlFor={`${id}-type`}>{label}</FieldLabel>
        <select
          className="border-input bg-background h-9 w-full rounded border px-3 text-sm"
          id={`${id}-type`}
          onChange={(event) => {
            const type = event.currentTarget.value as DecisionOutcome["type"]
            if (type === "paywall") onChange({ type, paywallVersionId: paywalls[0]?.id ?? "" })
            if (type === "no_paywall") onChange({ type })
            if (type === "fallback") onChange({ type, fallbackKey: fallbacks[0]?.key ?? "" })
            if (type === "unavailable") onChange({ type, reason: "no_safe_decision" })
          }}
          value={value.type}
        >
          <option value="paywall">Show Paywall</option>
          <option value="no_paywall">Show no Paywall</option>
          <option value="fallback">Use named fallback</option>
          <option value="unavailable">Return unavailable</option>
        </select>
      </Field>

      {value.type === "paywall" ? (
        <Field>
          <FieldLabel htmlFor={`${id}-paywall`}>Published Paywall</FieldLabel>
          <select
            className="border-input bg-background h-9 w-full rounded border px-3 text-sm"
            id={`${id}-paywall`}
            onChange={(event) =>
              onChange({ ...value, paywallVersionId: event.currentTarget.value })
            }
            value={value.paywallVersionId}
          >
            <option value="">Select a Paywall</option>
            {paywalls
              .filter((paywall) => paywall.status === "active")
              .map((paywall) => (
                <option key={paywall.id} value={paywall.id}>
                  {paywall.name}
                </option>
              ))}
          </select>
          <p className="text-muted-foreground text-xs">
            Publication pins the current immutable published version and checks Product readiness.
          </p>
        </Field>
      ) : null}

      {value.type === "fallback" ? (
        <Field>
          <FieldLabel htmlFor={`${id}-fallback`}>Fallback</FieldLabel>
          <select
            className="border-input bg-background h-9 w-full rounded border px-3 text-sm"
            id={`${id}-fallback`}
            onChange={(event) =>
              onChange({ type: "fallback", fallbackKey: event.currentTarget.value })
            }
            value={value.fallbackKey}
          >
            <option value="">Select a named fallback</option>
            {fallbacks.map((fallback) => (
              <option key={fallback.key} value={fallback.key}>
                {fallback.key}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      {value.type === "no_paywall" ? (
        <p
          className="border-primary/30 bg-primary/5 flex items-start gap-2 rounded border p-3 text-sm"
          role="status"
        >
          <CheckCircleIcon aria-hidden className="text-primary mt-0.5 shrink-0" weight="fill" />
          This is an intentional successful decision. Mosaic will not present a Paywall or enter a
          fallback.
        </p>
      ) : null}

      {value.type === "unavailable" ? (
        <Field>
          <FieldLabel htmlFor={`${id}-reason`}>Safe reason code</FieldLabel>
          <select
            className="border-input bg-background h-9 w-full rounded border px-3 text-sm"
            id={`${id}-reason`}
            onChange={(event) =>
              onChange({
                type: "unavailable",
                reason: event.currentTarget.value as Extract<
                  DecisionOutcome,
                  { type: "unavailable" }
                >["reason"],
              })
            }
            value={value.reason}
          >
            <option value="no_safe_decision">No safe decision</option>
            <option value="configuration_incompatible">Configuration incompatible</option>
            <option value="content_unavailable">Content unavailable</option>
            <option value="commerce_unavailable">Commerce unavailable</option>
          </select>
        </Field>
      ) : null}
    </div>
  )
}
