import { ShieldWarningIcon } from "@phosphor-icons/react/dist/ssr/ShieldWarning";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LiveAnnouncer } from "@/components/feedback/live-announcer";
import { LocalDateTime } from "@/components/feedback/local-date-time";
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
import {
  createOverrideMutationOptions,
  revokeOverrideMutationOptions,
} from "@/features/placement-decisions/mutations/placement-decision-mutations";
import { qaOverridesQueryOptions } from "@/features/placement-decisions/queries/placement-decision-queries";
import type { EnvironmentKind } from "@/features/placement-decisions/types/placement-decision";

function defaultExpiry() {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16);
}

const IDENTITY_TYPE_OPTIONS = [
  { label: "Installation", value: "installation" },
  { label: "Identified user", value: "identified_user" },
];

const FORCED_OUTCOME_OPTIONS = [
  { label: "Show no Paywall", value: "no_paywall" },
  { label: "Return unavailable", value: "unavailable" },
];

export function QaOverrides({
  adapter,
  environmentKind,
  scope,
}: {
  adapter: PlacementDecisionsAdapter;
  environmentKind: EnvironmentKind;
  scope: DecisionScope;
}) {
  const production = environmentKind === "production";

  return (
    <section aria-labelledby="qa-overrides-heading" className="space-y-4">
      <div>
        <h2 className="font-semibold text-base" id="qa-overrides-heading">
          Test Overrides
        </h2>
        <p className="mt-1 text-muted-foreground text-sm">
          Owner/admin-only, audited, token-matched overrides for development and
          staging. Active overrides take precedence over normal Rules.
        </p>
      </div>
      {production ? (
        <div
          className="rounded border border-destructive/30 bg-destructive/5 p-4"
          role="alert"
        >
          <p className="flex items-center gap-2 font-semibold">
            <ShieldWarningIcon aria-hidden /> Production overrides are
            unavailable
          </p>
          <p className="mt-1 text-muted-foreground text-sm">
            Switch to a development or staging Environment. Mosaic never creates
            hidden production targeting.
          </p>
        </div>
      ) : (
        <CreateOverrideForm
          adapter={adapter}
          environmentKind={environmentKind}
          scope={scope}
        />
      )}

      <ActiveOverrideList adapter={adapter} scope={scope} />
    </section>
  );
}

function CreateOverrideForm({
  adapter,
  environmentKind,
  scope,
}: {
  adapter: PlacementDecisionsAdapter;
  environmentKind: EnvironmentKind;
  scope: DecisionScope;
}) {
  const queryClient = useQueryClient();
  const create = useMutation(
    createOverrideMutationOptions(scope, environmentKind, adapter, queryClient)
  );
  const form = useForm({
    defaultValues: {
      expiresAt: defaultExpiry(),
      identityReference: "",
      identityType: "installation" as "installation" | "identified_user",
      label: "",
      outcomeType: "no_paywall" as "no_paywall" | "unavailable",
    },
    onSubmit: async ({ value, formApi }) => {
      await create.mutateAsync({
        expiresAt: new Date(value.expiresAt).toISOString(),
        identityReference: value.identityReference,
        identityType: value.identityType,
        label: value.label,
        outcome:
          value.outcomeType === "no_paywall"
            ? { type: "no_paywall" }
            : { type: "unavailable", reason: "no_safe_decision" },
      });
      formApi.reset();
    },
  });

  return (
    <form
      className="grid gap-3 rounded border border-border p-4 lg:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        form.handleSubmit();
      }}
    >
      <form.Field
        name="label"
        validators={{
          onSubmit: ({ value }) =>
            value.trim() ? undefined : "Add a safe label.",
        }}
      >
        {(field) => (
          <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
            <FieldLabel htmlFor="override-label">Safe label</FieldLabel>
            <Input
              id="override-label"
              maxLength={80}
              onChange={(event) =>
                field.handleChange(event.currentTarget.value)
              }
              placeholder="QA export flow"
              value={field.state.value}
            />
            <FieldError
              errors={field.state.meta.errors.map((message) => ({
                message,
              }))}
            />
          </Field>
        )}
      </form.Field>
      <form.Field name="identityType">
        {(field) => (
          <Field>
            <FieldLabel htmlFor="override-identity-type">
              Identity type
            </FieldLabel>
            <Select
              items={IDENTITY_TYPE_OPTIONS}
              onValueChange={(value) =>
                field.handleChange(value as "installation" | "identified_user")
              }
              value={field.state.value}
            >
              <SelectTrigger id="override-identity-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {IDENTITY_TYPE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
      </form.Field>
      <form.Field
        name="identityReference"
        validators={{
          onSubmit: ({ value }) =>
            value.trim() ? undefined : "Enter the test identity reference.",
        }}
      >
        {(field) => (
          <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
            <FieldLabel htmlFor="override-identity">
              Test identity reference
            </FieldLabel>
            <Input
              autoComplete="off"
              id="override-identity"
              onChange={(event) =>
                field.handleChange(event.currentTarget.value)
              }
              value={field.state.value}
            />
            <p className="text-muted-foreground text-xs">
              Used server-side to mint an opaque token; raw selector material is
              not published.
            </p>
            <FieldError
              errors={field.state.meta.errors.map((message) => ({
                message,
              }))}
            />
          </Field>
        )}
      </form.Field>
      <form.Field
        name="expiresAt"
        validators={{
          onSubmit: ({ value }) => {
            const duration = new Date(value).getTime() - Date.now();
            return duration > 0 && duration <= 24 * 60 * 60 * 1000
              ? undefined
              : "Choose an expiry within the next 24 hours.";
          },
        }}
      >
        {(field) => (
          <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
            <FieldLabel htmlFor="override-expiry">Expires</FieldLabel>
            <Input
              id="override-expiry"
              onChange={(event) =>
                field.handleChange(event.currentTarget.value)
              }
              type="datetime-local"
              value={field.state.value}
            />
            <FieldError
              errors={field.state.meta.errors.map((message) => ({
                message,
              }))}
            />
          </Field>
        )}
      </form.Field>
      <form.Field name="outcomeType">
        {(field) => (
          <Field>
            <FieldLabel htmlFor="override-outcome">Forced outcome</FieldLabel>
            <Select
              items={FORCED_OUTCOME_OPTIONS}
              onValueChange={(value) =>
                field.handleChange(value as "no_paywall" | "unavailable")
              }
              value={field.state.value}
            >
              <SelectTrigger id="override-outcome">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FORCED_OUTCOME_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
      </form.Field>
      <div className="self-end">
        <Button disabled={create.isPending} type="submit">
          {create.isPending ? "Creating…" : "Create override"}
        </Button>
      </div>
      <p className="rounded border border-border bg-muted/30 p-3 text-xs lg:col-span-2">
        <strong>Privacy:</strong> do not enter email, phone number, display
        name, or provider customer metadata. The returned opaque token is shown
        once and must be handled as a secret.
      </p>
      {/* Only the fact that a token exists is announced; the secret itself
              is never pushed into a live region. */}
      <LiveAnnouncer
        message={
          create.data?.token
            ? "One-time override token created below."
            : undefined
        }
      />
      {create.data?.token ? (
        <p className="break-all rounded border border-primary/30 bg-primary/5 p-3 font-mono text-sm lg:col-span-2">
          One-time override token: {create.data.token}
        </p>
      ) : null}
      {create.error ? (
        <p className="text-destructive text-sm lg:col-span-2" role="alert">
          {create.error.message}
        </p>
      ) : null}
    </form>
  );
}

function ActiveOverrideList({
  adapter,
  scope,
}: {
  adapter: PlacementDecisionsAdapter;
  scope: DecisionScope;
}) {
  const queryClient = useQueryClient();
  const overrides = useQuery(qaOverridesQueryOptions(scope, adapter));
  const revoke = useMutation(
    revokeOverrideMutationOptions(scope, adapter, queryClient)
  );

  return (
    <>
      {overrides.isPending ? (
        <p className="text-muted-foreground text-sm" role="status">
          Loading active overrides…
        </p>
      ) : null}
      {overrides.error ? (
        <p className="text-destructive text-sm" role="alert">
          {overrides.error.message}
        </p>
      ) : null}
      {overrides.data?.length === 0 ? (
        <p className="rounded border border-border border-dashed p-5 text-center text-sm">
          No Test Overrides for this Placement and Environment.
        </p>
      ) : null}
      <ul className="space-y-2">
        {overrides.data?.map((override) => (
          <li
            className="flex flex-wrap items-center justify-between gap-3 rounded border border-border p-4"
            key={override.id}
          >
            <div>
              <p className="font-medium">{override.label}</p>
              <p className="mt-1 text-muted-foreground text-xs">
                {override.identityType.replace("_", " ")} ·{" "}
                {override.outcome.type} · expires{" "}
                <LocalDateTime value={override.expiresAt} /> · {override.status}
              </p>
              {override.createdBy ? (
                <p className="mt-1 text-muted-foreground text-xs">
                  Created by {override.createdBy}
                </p>
              ) : null}
            </div>
            {override.status === "active" ? (
              <Button
                disabled={revoke.isPending}
                onClick={() => revoke.mutate(override.id)}
                size="sm"
                type="button"
                variant="outline"
              >
                Revoke
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {revoke.error ? (
        <p className="text-destructive text-sm" role="alert">
          {revoke.error.message}
        </p>
      ) : null}
    </>
  );
}
