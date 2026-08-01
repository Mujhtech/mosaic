import { useForm } from "@tanstack/react-form";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ProviderConnectionCreatedButTestFailed } from "@/features/provider-connections/mutations/provider-connection-mutations";
import {
  type CreateRevenueCatConnectionInput,
  environmentMatchesConnectionMode,
  validateRevenueCatCredential,
} from "@/features/provider-connections/types/provider-operation-input";
import type { Application, Environment } from "@/generated/api";

const PROVIDERS_SUFFIX = /\/catalog\/providers$/;

interface ConnectRevenueCatSheetProps {
  applications: readonly Application[];
  environments: readonly Environment[];
  onConnect: (input: CreateRevenueCatConnectionInput) => Promise<void>;
  providerBaseHref: string;
}

const CONNECTION_MODE_OPTIONS = [
  { label: "Sandbox", value: "sandbox" },
  { label: "Production", value: "production" },
];

export function ConnectRevenueCatSheet({
  applications,
  environments,
  onConnect,
  providerBaseHref,
}: ConnectRevenueCatSheetProps) {
  const [open, setOpen] = useState(false);
  const [submitError, setSubmitError] = useState<Error | null>(null);
  const form = useForm({
    defaultValues: {
      applicationIds: [] as string[],
      credential: "",
      environmentIds: [] as string[],
      externalProjectId: "",
      mode: "sandbox" as "production" | "sandbox",
      name: "RevenueCat sandbox",
    },
    onSubmit: async ({ value }) => {
      setSubmitError(null);
      try {
        await onConnect({
          applicationIds: value.applicationIds,
          credential: value.credential,
          environmentIds: value.environmentIds,
          externalProjectId: value.externalProjectId.trim(),
          mode: value.mode,
          name: value.name.trim(),
        });
        form.reset();
        setOpen(false);
      } catch (error) {
        setSubmitError(
          error instanceof Error
            ? error
            : new Error("RevenueCat connection failed.")
        );
      } finally {
        form.setFieldValue("credential", "");
      }
    },
  });

  return (
    <Sheet
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        setSubmitError(null);
        if (!nextOpen) {
          form.reset();
        }
      }}
      open={open}
    >
      <SheetTrigger render={<Button type="button" />}>
        Connect RevenueCat
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="border-b p-5">
          <SheetTitle>Connect RevenueCat</SheetTitle>
          <SheetDescription>
            Create one explicitly scoped sandbox or production connection, then
            test its read-only catalog access.
          </SheetDescription>
        </SheetHeader>
        <form
          className="flex flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            form.handleSubmit();
          }}
        >
          <div className="space-y-5 p-5">
            <form.Field
              name="name"
              validators={{
                onSubmit: ({ value }) =>
                  (() => {
                    if (value.trim().length === 0) {
                      return "Enter a connection name.";
                    }
                    if (value.length > 120) {
                      return "Use 120 characters or fewer.";
                    }
                  })(),
              }}
            >
              {(field) => (
                <Field data-invalid={field.state.meta.errors.length > 0}>
                  <FieldLabel htmlFor="revenuecat-connection-name">
                    Connection name
                  </FieldLabel>
                  <Input
                    aria-invalid={field.state.meta.errors.length > 0}
                    id="revenuecat-connection-name"
                    onBlur={field.handleBlur}
                    onChange={(event) =>
                      field.handleChange(event.currentTarget.value)
                    }
                    placeholder="RevenueCat sandbox"
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

            <form.Field name="mode">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="revenuecat-connection-mode">
                    Connection mode
                  </FieldLabel>
                  <Select
                    items={CONNECTION_MODE_OPTIONS}
                    onValueChange={(value) => {
                      const mode = value as "production" | "sandbox";
                      field.handleChange(mode);
                      form.setFieldValue(
                        "environmentIds",
                        form.getFieldValue("environmentIds").filter((id) => {
                          const environment = environments.find(
                            (item) => item.id === id
                          );
                          return (
                            environment &&
                            environmentMatchesConnectionMode(
                              environment.mode,
                              mode
                            )
                          );
                        })
                      );
                    }}
                    value={field.state.value}
                  >
                    <SelectTrigger id="revenuecat-connection-mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONNECTION_MODE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldDescription>
                    Sandbox and production connections remain separate and
                    cannot silently replace one another.
                  </FieldDescription>
                </Field>
              )}
            </form.Field>

            <form.Field
              name="credential"
              validators={{
                onSubmit: ({ value }) => validateRevenueCatCredential(value),
              }}
            >
              {(field) => (
                <Field data-invalid={field.state.meta.errors.length > 0}>
                  <FieldLabel htmlFor="revenuecat-credential">
                    RevenueCat secret API key
                  </FieldLabel>
                  <Input
                    aria-describedby="revenuecat-credential-help"
                    aria-invalid={field.state.meta.errors.length > 0}
                    autoComplete="off"
                    id="revenuecat-credential"
                    onBlur={field.handleBlur}
                    onChange={(event) =>
                      field.handleChange(event.currentTarget.value)
                    }
                    spellCheck={false}
                    type="password"
                    value={field.state.value}
                  />
                  <FieldDescription id="revenuecat-credential-help">
                    Entered once over TLS, encrypted by the API, cleared after
                    this attempt, and never returned or shown again. In
                    RevenueCat, create a secret v2 key limited to read access
                    for Apps, Products, Offerings, Packages, and Entitlements.
                  </FieldDescription>
                  <FieldError
                    errors={field.state.meta.errors.map((message) => ({
                      message,
                    }))}
                  />
                </Field>
              )}
            </form.Field>

            <form.Field
              name="externalProjectId"
              validators={{
                onSubmit: ({ value }) =>
                  (() => {
                    if (value.trim().length === 0) {
                      return "Enter the RevenueCat Project ID.";
                    }
                    if (value.length > 255) {
                      return "Use 255 characters or fewer.";
                    }
                  })(),
              }}
            >
              {(field) => (
                <Field data-invalid={field.state.meta.errors.length > 0}>
                  <FieldLabel htmlFor="revenuecat-project-id">
                    RevenueCat project ID
                  </FieldLabel>
                  <Input
                    aria-invalid={field.state.meta.errors.length > 0}
                    id="revenuecat-project-id"
                    onBlur={field.handleBlur}
                    onChange={(event) =>
                      field.handleChange(event.currentTarget.value)
                    }
                    placeholder="proj_…"
                    value={field.state.value}
                  />
                  <FieldDescription>
                    Copy the Project resource ID from RevenueCat Project
                    settings. It starts with <code>proj_</code> and is not a
                    secret.
                  </FieldDescription>
                  <FieldError
                    errors={field.state.meta.errors.map((message) => ({
                      message,
                    }))}
                  />
                </Field>
              )}
            </form.Field>

            <form.Field
              name="environmentIds"
              validators={{
                onSubmit: ({ value }) => {
                  if (value.length === 0) {
                    return "Select at least one compatible Environment.";
                  }
                  const mode = form.getFieldValue("mode");
                  return value.some((id) => {
                    const environment = environments.find(
                      (item) => item.id === id
                    );
                    return !(
                      environment &&
                      environmentMatchesConnectionMode(environment.mode, mode)
                    );
                  })
                    ? "Selected Environments must match the connection mode."
                    : undefined;
                },
              }}
            >
              {(field) => (
                <CheckboxScope
                  emptyHref={providerBaseHref.replace(
                    PROVIDERS_SUFFIX,
                    "/settings/environments"
                  )}
                  error={field.state.meta.errors[0]}
                  items={environments
                    .filter((environment) =>
                      environmentMatchesConnectionMode(
                        environment.mode,
                        form.getFieldValue("mode")
                      )
                    )
                    .map((environment) => ({
                      description: environment.mode,
                      id: environment.id,
                      label: environment.name,
                    }))}
                  label="Environment scopes"
                  onChange={field.handleChange}
                  selected={field.state.value}
                />
              )}
            </form.Field>

            <form.Field
              name="applicationIds"
              validators={{
                onSubmit: ({ value }) =>
                  value.length === 0
                    ? "Select at least one Application."
                    : undefined,
              }}
            >
              {(field) => (
                <CheckboxScope
                  emptyHref={providerBaseHref.replace(
                    PROVIDERS_SUFFIX,
                    "/apps"
                  )}
                  error={field.state.meta.errors[0]}
                  items={applications.map((application) => ({
                    description: `${application.platform.toUpperCase()} · ${application.identifier}`,
                    id: application.id,
                    label: application.name,
                  }))}
                  label="Application scopes"
                  onChange={field.handleChange}
                  selected={field.state.value}
                />
              )}
            </form.Field>

            {submitError ? (
              <div
                className="rounded border border-destructive/25 bg-destructive/5 p-3"
                role="alert"
              >
                <p className="text-destructive text-sm">
                  {submitError.message}
                </p>
                <p className="mt-1 text-muted-foreground text-xs">
                  The credential field was cleared. Re-enter it to retry safely.
                </p>
                {submitError instanceof
                ProviderConnectionCreatedButTestFailed ? (
                  <a
                    className="mt-2 inline-flex font-semibold text-primary text-xs"
                    href={`${providerBaseHref}/${encodeURIComponent(submitError.connection.id)}`}
                  >
                    Open {submitError.connection.name} to test or reconnect
                  </a>
                ) : null}
              </div>
            ) : null}
          </div>
          <SheetFooter className="border-t p-5">
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <Button disabled={isSubmitting} type="submit">
                  {isSubmitting
                    ? "Creating and testing…"
                    : "Create and test connection"}
                </Button>
              )}
            </form.Subscribe>
            <p className="text-muted-foreground text-xs">
              Mosaic requests read-only catalog permissions. It does not
              validate receipts or own customer subscription state.
            </p>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function CheckboxScope({
  error,
  emptyHref,
  items,
  label,
  onChange,
  selected,
}: {
  error?: string;
  emptyHref: string;
  items: readonly { description: string; id: string; label: string }[];
  label: string;
  onChange: (value: string[]) => void;
  selected: readonly string[];
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="font-medium text-sm">{label}</legend>
      {items.length === 0 ? (
        <div className="rounded border border-dashed p-3 text-xs">
          <p className="text-muted-foreground">
            Create this scope before connecting RevenueCat.
          </p>
          <a
            className="mt-2 inline-flex font-semibold text-primary"
            href={emptyHref}
          >
            Create scope
          </a>
        </div>
      ) : (
        <div className="grid gap-2">
          {items.map((item) => (
            <label
              className="flex items-start gap-3 rounded border p-3 text-sm"
              key={item.id}
            >
              <input
                checked={selected.includes(item.id)}
                className="mt-0.5 size-4 accent-primary"
                onChange={(event) =>
                  onChange(
                    event.currentTarget.checked
                      ? [...selected, item.id]
                      : selected.filter((id) => id !== item.id)
                  )
                }
                type="checkbox"
              />
              <span>
                <span className="block font-medium">{item.label}</span>
                <span className="mt-0.5 block text-muted-foreground text-xs">
                  {item.description}
                </span>
              </span>
            </label>
          ))}
        </div>
      )}
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
