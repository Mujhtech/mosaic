import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr/WarningCircle"
import { useForm } from "@tanstack/react-form"
import { useMutation } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import type {
  DecisionScope,
  PlacementDecisionsAdapter,
} from "@/features/placement-decisions/api/placement-decisions-adapter"
import { simulateDecisionMutationOptions } from "@/features/placement-decisions/mutations/placement-decision-mutations"
import type { AttributeDefinition } from "@/features/placement-decisions/types/placement-decision"

export function DecisionSimulator({
  adapter,
  attributes,
  onOpenRule,
  scope,
}: {
  adapter: PlacementDecisionsAdapter
  attributes: readonly AttributeDefinition[]
  onOpenRule: (ruleId: string) => void
  scope: DecisionScope
}) {
  const simulation = useMutation(simulateDecisionMutationOptions(scope, adapter))
  const standardAttributes = attributes.filter(
    (attribute) => attribute.status === "active" && attribute.sensitivity === "standard",
  )
  const form = useForm({
    defaultValues: {
      applicationVersion: "",
      country: "",
      entitlementKey: "",
      entitlementState: "unknown" as
        "active" | "inactive" | "unknown" | "provider_unavailable" | "failed",
      locale: "",
      osVersion: "",
      overrideToken: "",
      platform: "ios" as "ios" | "android",
      productAvailability: "unknown" as "available" | "unavailable" | "unknown",
      productId: "",
      productReadiness: "unknown" as "ready" | "not_ready" | "unknown",
      providerCapability: "",
      userId: "",
      installationId: "",
      attributes: Object.fromEntries(standardAttributes.map((attribute) => [attribute.key, ""])),
    },
    onSubmit: async ({ value }) => {
      await simulation.mutateAsync({
        applicationVersion: value.applicationVersion || undefined,
        attributes: Object.fromEntries(
          Object.entries(value.attributes).filter(([, attributeValue]) => attributeValue !== ""),
        ),
        country: value.country ? value.country.toUpperCase() : undefined,
        entitlementStates: value.entitlementKey
          ? { [value.entitlementKey]: value.entitlementState }
          : {},
        installationId: value.installationId || undefined,
        locale: value.locale || undefined,
        osVersion: value.osVersion || undefined,
        platform: value.platform,
        overrideToken: value.overrideToken || undefined,
        productAvailability: value.productId
          ? { [value.productId]: value.productAvailability }
          : {},
        productReadiness: value.productId ? { [value.productId]: value.productReadiness } : {},
        providerCapabilities: value.providerCapability ? [value.providerCapability] : [],
        userId: value.userId || undefined,
      })
    },
  })

  return (
    <section
      aria-labelledby="simulator-heading"
      className="grid gap-5 xl:grid-cols-[minmax(20rem,0.8fr)_minmax(0,1.2fr)]"
    >
      <form
        autoComplete="off"
        className="border-border rounded border p-4"
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void form.handleSubmit()
        }}
      >
        <h2 className="font-semibold" id="simulator-heading">
          Targeting simulator
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Synthetic inputs are sent only for this simulation. They are not placed in the URL, cache,
          browser storage, or recovery state.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <form.Field name="platform">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="simulator-platform">Platform</FieldLabel>
                <select
                  id="simulator-platform"
                  className="border-input bg-background h-9 rounded border px-3 text-sm"
                  onChange={(event) =>
                    field.handleChange(event.currentTarget.value as "ios" | "android")
                  }
                  value={field.state.value}
                >
                  <option value="ios">iOS</option>
                  <option value="android">Android</option>
                </select>
              </Field>
            )}
          </form.Field>
          {(["osVersion", "applicationVersion", "locale", "userId", "installationId"] as const).map(
            (name) => (
              <form.Field key={name} name={name}>
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor={`simulator-${name}`}>
                      {
                        {
                          applicationVersion: "Application version",
                          installationId: "Installation ID",
                          locale: "Locale",
                          osVersion: "Operating system version",
                          userId: "Application user ID",
                        }[name]
                      }
                    </FieldLabel>
                    <Input
                      autoComplete="off"
                      id={`simulator-${name}`}
                      onChange={(event) => field.handleChange(event.currentTarget.value)}
                      value={field.state.value}
                    />
                  </Field>
                )}
              </form.Field>
            ),
          )}
          <form.Field
            name="country"
            validators={{
              onChange: ({ value }) =>
                !value || /^[A-Za-z]{2}$/.test(value)
                  ? undefined
                  : "Use an ISO two-letter country code.",
            }}
          >
            {(field) => (
              <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
                <FieldLabel htmlFor="simulator-country">Country</FieldLabel>
                <Input
                  autoComplete="off"
                  id="simulator-country"
                  maxLength={2}
                  onChange={(event) => field.handleChange(event.currentTarget.value)}
                  placeholder="DE"
                  value={field.state.value}
                />
                <p className="text-muted-foreground text-xs">
                  Source: explicit host application input, never inferred from locale.
                </p>
                <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
              </Field>
            )}
          </form.Field>
        </div>

        <fieldset className="border-border mt-4 grid gap-3 rounded border p-3 sm:grid-cols-2">
          <legend className="px-1 text-xs font-semibold">Commerce and QA inputs</legend>
          <form.Field name="entitlementKey">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="simulator-access-key">Access key</FieldLabel>
                <Input
                  id="simulator-access-key"
                  onChange={(event) => field.handleChange(event.currentTarget.value)}
                  placeholder="pro"
                  value={field.state.value}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="entitlementState">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="simulator-access-state">Access state</FieldLabel>
                <select
                  className="border-input bg-background h-9 rounded border px-3 text-sm"
                  id="simulator-access-state"
                  onChange={(event) =>
                    field.handleChange(event.currentTarget.value as typeof field.state.value)
                  }
                  value={field.state.value}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="unknown">Unknown</option>
                  <option value="provider_unavailable">Provider unavailable</option>
                  <option value="failed">Failed</option>
                </select>
              </Field>
            )}
          </form.Field>
          <form.Field name="productId">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="simulator-product-id">Mosaic Product ID</FieldLabel>
                <Input
                  id="simulator-product-id"
                  onChange={(event) => field.handleChange(event.currentTarget.value)}
                  value={field.state.value}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="productAvailability">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="simulator-product-availability">
                  Product availability
                </FieldLabel>
                <select
                  className="border-input bg-background h-9 rounded border px-3 text-sm"
                  id="simulator-product-availability"
                  onChange={(event) =>
                    field.handleChange(event.currentTarget.value as typeof field.state.value)
                  }
                  value={field.state.value}
                >
                  <option value="available">Available</option>
                  <option value="unavailable">Unavailable</option>
                  <option value="unknown">Unknown</option>
                </select>
              </Field>
            )}
          </form.Field>
          <form.Field name="productReadiness">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="simulator-product-readiness">Product readiness</FieldLabel>
                <select
                  className="border-input bg-background h-9 rounded border px-3 text-sm"
                  id="simulator-product-readiness"
                  onChange={(event) =>
                    field.handleChange(event.currentTarget.value as typeof field.state.value)
                  }
                  value={field.state.value}
                >
                  <option value="ready">Ready</option>
                  <option value="not_ready">Not ready</option>
                  <option value="unknown">Unknown</option>
                </select>
              </Field>
            )}
          </form.Field>
          <form.Field name="providerCapability">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="simulator-provider-capability">Provider capability</FieldLabel>
                <select
                  className="border-input bg-background h-9 rounded border px-3 text-sm"
                  id="simulator-provider-capability"
                  onChange={(event) => field.handleChange(event.currentTarget.value)}
                  value={field.state.value}
                >
                  <option value="">None supplied</option>
                  <option value="product_loading">Product loading</option>
                  <option value="purchase">Purchase</option>
                  <option value="restore">Restore</option>
                  <option value="entitlement_lookup">Access lookup</option>
                </select>
              </Field>
            )}
          </form.Field>
          <form.Field name="overrideToken">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="simulator-override-token">Test Override token</FieldLabel>
                <Input
                  autoComplete="off"
                  id="simulator-override-token"
                  onChange={(event) => field.handleChange(event.currentTarget.value)}
                  type="password"
                  value={field.state.value}
                />
              </Field>
            )}
          </form.Field>
        </fieldset>

        {standardAttributes.length > 0 ? (
          <fieldset className="border-border mt-4 grid gap-3 rounded border p-3 sm:grid-cols-2">
            <legend className="px-1 text-xs font-semibold">Synthetic standard attributes</legend>
            {standardAttributes.map((attribute) => (
              <form.Field key={attribute.id} name={`attributes.${attribute.key}`}>
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor={`simulator-attribute-${attribute.key}`}>
                      {attribute.key}
                    </FieldLabel>
                    <Input
                      autoComplete="off"
                      id={`simulator-attribute-${attribute.key}`}
                      onChange={(event) => field.handleChange(event.currentTarget.value)}
                      value={field.state.value}
                    />
                  </Field>
                )}
              </form.Field>
            ))}
          </fieldset>
        ) : null}

        {attributes.some((attribute) => attribute.sensitivity === "sensitive") ? (
          <p className="border-border bg-muted/30 mt-4 rounded border p-3 text-xs">
            Sensitive attributes cannot be entered in the simulator. They are excluded from this
            run, and any sensitive values in server traces are redacted.
          </p>
        ) : null}
        <div className="mt-4 flex gap-2">
          <Button disabled={simulation.isPending} type="submit">
            {simulation.isPending ? "Evaluating…" : "Run simulation"}
          </Button>
          <Button
            onClick={() => {
              form.reset()
              simulation.reset()
            }}
            type="button"
            variant="outline"
          >
            Clear inputs
          </Button>
        </div>
        {simulation.error ? (
          <p className="text-destructive mt-3 text-sm" role="alert">
            {simulation.error.message}
          </p>
        ) : null}
      </form>

      <section aria-labelledby="trace-heading" className="border-border min-w-0 rounded border p-4">
        <h2 className="font-semibold" id="trace-heading">
          Decision trace
        </h2>
        {!simulation.data ? (
          <p className="text-muted-foreground mt-3 text-sm">
            Run a simulation to see source provenance, unknown states, rollout, fallback, and the
            final decision.
          </p>
        ) : (
          <>
            <dl className="bg-muted/30 mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded p-3 text-sm">
              <dt>Final decision</dt>
              <dd className="font-semibold">{simulation.data.finalOutcome.type}</dd>
              <dt>Winning Rule</dt>
              <dd>{simulation.data.winningRuleId ?? "Default decision"}</dd>
              <dt>Assignment</dt>
              <dd>{simulation.data.assignmentKeyType ?? "Not used"}</dd>
              <dt>Bucket</dt>
              <dd>{simulation.data.rolloutBucket ?? "Not evaluated"}</dd>
              <dt>Product readiness</dt>
              <dd>{simulation.data.productReadiness ?? "Not required"}</dd>
            </dl>
            {simulation.data.fallbackPath.length > 0 ? (
              <p className="border-border mt-3 rounded border p-3 text-sm">
                Fallback path: {simulation.data.fallbackPath.join(" → ")}
              </p>
            ) : null}
            <ol className="mt-4 space-y-2">
              {simulation.data.trace.map((step) => (
                <li className="border-border rounded border p-3 text-sm" key={step.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{step.label}</p>
                      <p className="text-muted-foreground mt-1">
                        {step.sensitive ? "Sensitive value redacted" : step.detail}
                      </p>
                      <p className="text-muted-foreground mt-1 text-xs">
                        Source: {step.source ?? "decision configuration"}
                      </p>
                    </div>
                    <span
                      className={
                        step.result === "unknown"
                          ? "text-amber-700 dark:text-amber-300"
                          : "text-muted-foreground"
                      }
                    >
                      {step.result === "unknown" ? (
                        <WarningCircleIcon aria-label="Unknown" />
                      ) : (
                        step.result
                      )}
                    </span>
                  </div>
                  {step.ruleId ? (
                    <Button
                      className="mt-2 h-auto p-0 text-xs"
                      onClick={() => onOpenRule(step.ruleId!)}
                      size="sm"
                      type="button"
                      variant="link"
                    >
                      Open Rule
                    </Button>
                  ) : null}
                </li>
              ))}
            </ol>
          </>
        )}
      </section>
    </section>
  )
}
