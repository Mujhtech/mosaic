import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr/WarningCircle";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  DecisionScope,
  PlacementDecisionsAdapter,
} from "@/features/placement-decisions/api/placement-decisions-adapter";
import { simulateDecisionMutationOptions } from "@/features/placement-decisions/mutations/placement-decision-mutations";
import type { AttributeDefinition } from "@/features/placement-decisions/types/placement-decision";

const COUNTRY_CODE = /^[A-Za-z]{2}$/;

const SIMULATOR_PLATFORM_OPTIONS = [
  { label: "iOS", value: "ios" },
  { label: "Android", value: "android" },
];

const ACCESS_STATE_OPTIONS = [
  { label: "Active", value: "active" },
  { label: "Inactive", value: "inactive" },
  { label: "Unknown", value: "unknown" },
  { label: "Provider unavailable", value: "provider_unavailable" },
  { label: "Failed", value: "failed" },
];

const PRODUCT_AVAILABILITY_OPTIONS = [
  { label: "Available", value: "available" },
  { label: "Unavailable", value: "unavailable" },
  { label: "Unknown", value: "unknown" },
];

const PRODUCT_READINESS_OPTIONS = [
  { label: "Ready", value: "ready" },
  { label: "Not ready", value: "not_ready" },
  { label: "Unknown", value: "unknown" },
];

const PROVIDER_CAPABILITY_OPTIONS = [
  { label: "None supplied", value: "" },
  { label: "Product loading", value: "product_loading" },
  { label: "Purchase", value: "purchase" },
  { label: "Restore", value: "restore" },
  { label: "Access lookup", value: "entitlement_lookup" },
];

export function DecisionSimulator({
  adapter,
  attributes,
  onOpenRule,
  scope,
}: {
  adapter: PlacementDecisionsAdapter;
  attributes: readonly AttributeDefinition[];
  onOpenRule: (ruleId: string) => void;
  scope: DecisionScope;
}) {
  const simulation = useMutation(
    simulateDecisionMutationOptions(scope, adapter)
  );
  const standardAttributes = attributes.filter(
    (attribute) =>
      attribute.status === "active" && attribute.sensitivity === "standard"
  );
  const form = useForm({
    defaultValues: {
      applicationVersion: "",
      country: "",
      entitlementKey: "",
      entitlementState: "unknown" as
        | "active"
        | "inactive"
        | "unknown"
        | "provider_unavailable"
        | "failed",
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
      attributes: Object.fromEntries(
        standardAttributes.map((attribute) => [attribute.key, ""])
      ),
    },
    onSubmit: async ({ value }) => {
      await simulation.mutateAsync({
        applicationVersion: value.applicationVersion || undefined,
        attributes: Object.fromEntries(
          Object.entries(value.attributes).filter(
            ([, attributeValue]) => attributeValue !== ""
          )
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
        productReadiness: value.productId
          ? { [value.productId]: value.productReadiness }
          : {},
        providerCapabilities: value.providerCapability
          ? [value.providerCapability]
          : [],
        userId: value.userId || undefined,
      });
    },
  });

  return (
    <section
      aria-labelledby="simulator-heading"
      className="grid gap-5 xl:grid-cols-[minmax(20rem,0.8fr)_minmax(0,1.2fr)]"
    >
      <form
        autoComplete="off"
        className="rounded border border-border p-4"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          form.handleSubmit();
        }}
      >
        <h2 className="font-semibold" id="simulator-heading">
          Targeting simulator
        </h2>
        <p className="mt-1 text-muted-foreground text-sm">
          Synthetic inputs are sent only for this simulation. They are not
          placed in the URL, cache, browser storage, or recovery state.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <form.Field name="platform">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="simulator-platform">Platform</FieldLabel>
                <Select
                  items={SIMULATOR_PLATFORM_OPTIONS}
                  onValueChange={(value) =>
                    field.handleChange(value as "ios" | "android")
                  }
                  value={field.state.value}
                >
                  <SelectTrigger id="simulator-platform">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SIMULATOR_PLATFORM_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </form.Field>
          {(
            [
              "osVersion",
              "applicationVersion",
              "locale",
              "userId",
              "installationId",
            ] as const
          ).map((name) => (
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
                    onChange={(event) =>
                      field.handleChange(event.currentTarget.value)
                    }
                    value={field.state.value}
                  />
                </Field>
              )}
            </form.Field>
          ))}
          <form.Field
            name="country"
            validators={{
              onChange: ({ value }) =>
                !value || COUNTRY_CODE.test(value)
                  ? undefined
                  : "Use an ISO two-letter country code.",
            }}
          >
            {(field) => (
              <Field
                data-invalid={field.state.meta.errors.length > 0 || undefined}
              >
                <FieldLabel htmlFor="simulator-country">Country</FieldLabel>
                <Input
                  autoComplete="off"
                  id="simulator-country"
                  maxLength={2}
                  onChange={(event) =>
                    field.handleChange(event.currentTarget.value)
                  }
                  placeholder="DE"
                  value={field.state.value}
                />
                <p className="text-muted-foreground text-xs">
                  Source: explicit host application input, never inferred from
                  locale.
                </p>
                <FieldError
                  errors={field.state.meta.errors.map((message) => ({
                    message,
                  }))}
                />
              </Field>
            )}
          </form.Field>
        </div>

        <fieldset className="mt-4 grid gap-3 rounded border border-border p-3 sm:grid-cols-2">
          <legend className="px-1 font-semibold text-xs">
            Commerce and QA inputs
          </legend>
          <form.Field name="entitlementKey">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="simulator-access-key">
                  Access key
                </FieldLabel>
                <Input
                  id="simulator-access-key"
                  onChange={(event) =>
                    field.handleChange(event.currentTarget.value)
                  }
                  placeholder="pro"
                  value={field.state.value}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="entitlementState">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="simulator-access-state">
                  Access state
                </FieldLabel>
                <Select
                  items={ACCESS_STATE_OPTIONS}
                  onValueChange={(value) =>
                    field.handleChange(value as typeof field.state.value)
                  }
                  value={field.state.value}
                >
                  <SelectTrigger id="simulator-access-state">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACCESS_STATE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </form.Field>
          <form.Field name="productId">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="simulator-product-id">
                  Mosaic Product ID
                </FieldLabel>
                <Input
                  id="simulator-product-id"
                  onChange={(event) =>
                    field.handleChange(event.currentTarget.value)
                  }
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
                <Select
                  items={PRODUCT_AVAILABILITY_OPTIONS}
                  onValueChange={(value) =>
                    field.handleChange(value as typeof field.state.value)
                  }
                  value={field.state.value}
                >
                  <SelectTrigger id="simulator-product-availability">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRODUCT_AVAILABILITY_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </form.Field>
          <form.Field name="productReadiness">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="simulator-product-readiness">
                  Product readiness
                </FieldLabel>
                <Select
                  items={PRODUCT_READINESS_OPTIONS}
                  onValueChange={(value) =>
                    field.handleChange(value as typeof field.state.value)
                  }
                  value={field.state.value}
                >
                  <SelectTrigger id="simulator-product-readiness">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRODUCT_READINESS_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </form.Field>
          <form.Field name="providerCapability">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="simulator-provider-capability">
                  Provider capability
                </FieldLabel>
                <Select
                  items={PROVIDER_CAPABILITY_OPTIONS}
                  onValueChange={(value) => field.handleChange(value)}
                  value={field.state.value}
                >
                  <SelectTrigger id="simulator-provider-capability">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDER_CAPABILITY_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </form.Field>
          <form.Field name="overrideToken">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="simulator-override-token">
                  Test Override token
                </FieldLabel>
                <Input
                  autoComplete="off"
                  id="simulator-override-token"
                  onChange={(event) =>
                    field.handleChange(event.currentTarget.value)
                  }
                  type="password"
                  value={field.state.value}
                />
              </Field>
            )}
          </form.Field>
        </fieldset>

        {standardAttributes.length > 0 ? (
          <fieldset className="mt-4 grid gap-3 rounded border border-border p-3 sm:grid-cols-2">
            <legend className="px-1 font-semibold text-xs">
              Synthetic standard attributes
            </legend>
            {standardAttributes.map((attribute) => (
              <form.Field
                key={attribute.id}
                name={`attributes.${attribute.key}`}
              >
                {(field) => (
                  <Field>
                    <FieldLabel
                      htmlFor={`simulator-attribute-${attribute.key}`}
                    >
                      {attribute.key}
                    </FieldLabel>
                    <Input
                      autoComplete="off"
                      id={`simulator-attribute-${attribute.key}`}
                      onChange={(event) =>
                        field.handleChange(event.currentTarget.value)
                      }
                      value={field.state.value}
                    />
                  </Field>
                )}
              </form.Field>
            ))}
          </fieldset>
        ) : null}

        {attributes.some(
          (attribute) => attribute.sensitivity === "sensitive"
        ) ? (
          <p className="mt-4 rounded border border-border bg-muted/30 p-3 text-xs">
            Sensitive attributes cannot be entered in the simulator. They are
            excluded from this run, and any sensitive values in server traces
            are redacted.
          </p>
        ) : null}
        <div className="mt-4 flex gap-2">
          <Button disabled={simulation.isPending} type="submit">
            {simulation.isPending ? "Evaluating…" : "Run simulation"}
          </Button>
          <Button
            onClick={() => {
              form.reset();
              simulation.reset();
            }}
            type="button"
            variant="outline"
          >
            Clear inputs
          </Button>
        </div>
        {simulation.error ? (
          <p className="mt-3 text-destructive text-sm" role="alert">
            {simulation.error.message}
          </p>
        ) : null}
      </form>

      <section
        aria-labelledby="trace-heading"
        className="min-w-0 rounded border border-border p-4"
      >
        <h2 className="font-semibold" id="trace-heading">
          Decision trace
        </h2>
        {simulation.data ? (
          <>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded bg-muted/30 p-3 text-sm">
              <dt>Final decision</dt>
              <dd className="font-semibold">
                {simulation.data.finalOutcome.type}
              </dd>
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
              <p className="mt-3 rounded border border-border p-3 text-sm">
                Fallback path: {simulation.data.fallbackPath.join(" → ")}
              </p>
            ) : null}
            <ol className="mt-4 space-y-2">
              {simulation.data.trace.map((step) => (
                <li
                  className="rounded border border-border p-3 text-sm"
                  key={step.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{step.label}</p>
                      <p className="mt-1 text-muted-foreground">
                        {step.sensitive
                          ? "Sensitive value redacted"
                          : step.detail}
                      </p>
                      <p className="mt-1 text-muted-foreground text-xs">
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
        ) : (
          <p className="mt-3 text-muted-foreground text-sm">
            Run a simulation to see source provenance, unknown states, rollout,
            fallback, and the final decision.
          </p>
        )}
      </section>
    </section>
  );
}
