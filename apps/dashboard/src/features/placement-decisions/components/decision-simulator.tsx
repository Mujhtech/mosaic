import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr/WarningCircle";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useCallback } from "react";

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
import type {
  AttributeDefinition,
  SimulationInput,
  SimulationResult,
} from "@/features/placement-decisions/types/placement-decision";

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

interface SimulatorFormValues {
  applicationVersion: string;
  attributes: Record<string, string>;
  country: string;
  entitlementKey: string;
  entitlementState:
    | "active"
    | "inactive"
    | "unknown"
    | "provider_unavailable"
    | "failed";
  installationId: string;
  locale: string;
  osVersion: string;
  overrideToken: string;
  platform: "ios" | "android";
  productAvailability: "available" | "unavailable" | "unknown";
  productId: string;
  productReadiness: "ready" | "not_ready" | "unknown";
  providerCapability: string;
  userId: string;
}

/**
 * Synthetic inputs become one request payload. Empty strings are omitted rather
 * than sent, so an untouched control never narrows the simulated context.
 */
function toSimulationInput(value: SimulatorFormValues): SimulationInput {
  return {
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
  };
}

const IDENTITY_FIELD_LABELS = {
  applicationVersion: "Application version",
  installationId: "Installation ID",
  locale: "Locale",
  osVersion: "Operating system version",
  userId: "Application user ID",
};

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
  const clearSimulation = useCallback(() => simulation.reset(), [simulation]);

  return (
    <section
      aria-labelledby="simulator-heading"
      className="grid gap-5 xl:grid-cols-[minmax(20rem,0.8fr)_minmax(0,1.2fr)]"
    >
      <SimulatorForm
        attributes={attributes}
        errorMessage={simulation.error?.message}
        isPending={simulation.isPending}
        onClear={clearSimulation}
        onSimulate={simulation.mutateAsync}
        standardAttributes={standardAttributes}
      />
      <DecisionTracePanel onOpenRule={onOpenRule} result={simulation.data} />
    </section>
  );
}

function SimulatorForm({
  attributes,
  errorMessage,
  isPending,
  onClear,
  onSimulate,
  standardAttributes,
}: {
  attributes: readonly AttributeDefinition[];
  errorMessage: string | undefined;
  isPending: boolean;
  onClear: () => void;
  onSimulate: (input: SimulationInput) => Promise<SimulationResult>;
  standardAttributes: readonly AttributeDefinition[];
}) {
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
      await onSimulate(toSimulationInput(value));
    },
  });

  const handleClick = useCallback(() => {
    form.reset();
    onClear();
  }, [form, onClear]);

  return (
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
        Synthetic inputs are sent only for this simulation. They are not placed
        in the URL, cache, browser storage, or recovery state.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <form.Field name="platform">
          {(field) => (
            <SimulatorSelectField
              id="simulator-platform"
              label="Platform"
              onValueChange={(value) =>
                field.handleChange(value as "ios" | "android")
              }
              options={SIMULATOR_PLATFORM_OPTIONS}
              value={field.state.value}
            />
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
              <SimulatorTextField
                autoComplete="off"
                id={`simulator-${name}`}
                label={IDENTITY_FIELD_LABELS[name]}
                onChange={field.handleChange}
                value={field.state.value}
              />
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
            <SimulatorTextField
              id="simulator-access-key"
              label="Access key"
              onChange={field.handleChange}
              placeholder="pro"
              value={field.state.value}
            />
          )}
        </form.Field>
        <form.Field name="entitlementState">
          {(field) => (
            <SimulatorSelectField
              id="simulator-access-state"
              label="Access state"
              onValueChange={(value) =>
                field.handleChange(value as typeof field.state.value)
              }
              options={ACCESS_STATE_OPTIONS}
              value={field.state.value}
            />
          )}
        </form.Field>
        <form.Field name="productId">
          {(field) => (
            <SimulatorTextField
              id="simulator-product-id"
              label="Mosaic Product ID"
              onChange={field.handleChange}
              value={field.state.value}
            />
          )}
        </form.Field>
        <form.Field name="productAvailability">
          {(field) => (
            <SimulatorSelectField
              id="simulator-product-availability"
              label="Product availability"
              onValueChange={(value) =>
                field.handleChange(value as typeof field.state.value)
              }
              options={PRODUCT_AVAILABILITY_OPTIONS}
              value={field.state.value}
            />
          )}
        </form.Field>
        <form.Field name="productReadiness">
          {(field) => (
            <SimulatorSelectField
              id="simulator-product-readiness"
              label="Product readiness"
              onValueChange={(value) =>
                field.handleChange(value as typeof field.state.value)
              }
              options={PRODUCT_READINESS_OPTIONS}
              value={field.state.value}
            />
          )}
        </form.Field>
        <form.Field name="providerCapability">
          {(field) => (
            <SimulatorSelectField
              id="simulator-provider-capability"
              label="Provider capability"
              onValueChange={(value) => field.handleChange(value)}
              options={PROVIDER_CAPABILITY_OPTIONS}
              value={field.state.value}
            />
          )}
        </form.Field>
        <form.Field name="overrideToken">
          {(field) => (
            <SimulatorTextField
              autoComplete="off"
              id="simulator-override-token"
              label="Test Override token"
              onChange={field.handleChange}
              type="password"
              value={field.state.value}
            />
          )}
        </form.Field>
      </fieldset>

      {standardAttributes.length > 0 ? (
        <fieldset className="mt-4 grid gap-3 rounded border border-border p-3 sm:grid-cols-2">
          <legend className="px-1 font-semibold text-xs">
            Synthetic standard attributes
          </legend>
          {standardAttributes.map((attribute) => (
            <form.Field key={attribute.id} name={`attributes.${attribute.key}`}>
              {(field) => (
                <SimulatorTextField
                  autoComplete="off"
                  id={`simulator-attribute-${attribute.key}`}
                  label={attribute.key}
                  onChange={field.handleChange}
                  value={field.state.value}
                />
              )}
            </form.Field>
          ))}
        </fieldset>
      ) : null}

      <SimulatorFormActions
        errorMessage={errorMessage}
        hasSensitiveAttributes={attributes.some(
          (attribute) => attribute.sensitivity === "sensitive"
        )}
        isPending={isPending}
        onClear={handleClick}
      />
    </form>
  );
}

function SimulatorFormActions({
  errorMessage,
  hasSensitiveAttributes,
  isPending,
  onClear,
}: {
  errorMessage: string | undefined;
  hasSensitiveAttributes: boolean;
  isPending: boolean;
  onClear: () => void;
}) {
  return (
    <>
      {hasSensitiveAttributes ? (
        <p className="mt-4 rounded border border-border bg-muted/30 p-3 text-xs">
          Sensitive attributes cannot be entered in the simulator. They are
          excluded from this run, and any sensitive values in server traces are
          redacted.
        </p>
      ) : null}
      <div className="mt-4 flex gap-2">
        <Button disabled={isPending} type="submit">
          {isPending ? "Evaluating…" : "Run simulation"}
        </Button>
        <Button onClick={onClear} type="button" variant="outline">
          Clear inputs
        </Button>
      </div>
      {errorMessage ? (
        <p className="mt-3 text-destructive text-sm" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </>
  );
}

function SimulatorTextField({
  autoComplete,
  id,
  label,
  onChange,
  placeholder,
  type,
  value,
}: {
  autoComplete?: "off";
  id: string;
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "password";
  value: string;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        autoComplete={autoComplete}
        id={id}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={placeholder}
        type={type}
        value={value}
      />
    </Field>
  );
}

function SimulatorSelectField({
  id,
  label,
  onValueChange,
  options,
  value,
}: {
  id: string;
  label: string;
  onValueChange: (value: string) => void;
  options: readonly { label: string; value: string }[];
  value: string;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select items={options} onValueChange={onValueChange} value={value}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function DecisionTracePanel({
  onOpenRule,
  result,
}: {
  onOpenRule: (ruleId: string) => void;
  result: SimulationResult | undefined;
}) {
  return (
    <section
      aria-labelledby="trace-heading"
      className="min-w-0 rounded border border-border p-4"
    >
      <h2 className="font-semibold" id="trace-heading">
        Decision trace
      </h2>
      {result ? (
        <>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded bg-muted/30 p-3 text-sm">
            <dt>Final decision</dt>
            <dd className="font-semibold">{result.finalOutcome.type}</dd>
            <dt>Winning Rule</dt>
            <dd>{result.winningRuleId ?? "Default decision"}</dd>
            <dt>Assignment</dt>
            <dd>{result.assignmentKeyType ?? "Not used"}</dd>
            <dt>Bucket</dt>
            <dd>{result.rolloutBucket ?? "Not evaluated"}</dd>
            <dt>Product readiness</dt>
            <dd>{result.productReadiness ?? "Not required"}</dd>
          </dl>
          {result.fallbackPath.length > 0 ? (
            <p className="mt-3 rounded border border-border p-3 text-sm">
              Fallback path: {result.fallbackPath.join(" → ")}
            </p>
          ) : null}
          <ol className="mt-4 space-y-2">
            {result.trace.map((step) => {
              const stepRuleId = step.ruleId;
              return (
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
                  {stepRuleId ? (
                    <Button
                      className="mt-2 h-auto p-0 text-xs"
                      onClick={() => onOpenRule(stepRuleId)}
                      size="sm"
                      type="button"
                      variant="link"
                    >
                      Open Rule
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </>
      ) : (
        <p className="mt-3 text-muted-foreground text-sm">
          Run a simulation to see source provenance, unknown states, rollout,
          fallback, and the final decision.
        </p>
      )}
    </section>
  );
}
