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
import {
  AppStoreConnectPrivateKeyField,
  AppStoreConnectTextField,
} from "@/features/provider-connections/components/app-store-connect-credential-fields";
import {
  ConnectionScopeField,
  type ConnectionScopeReads,
  UNREADABLE_APPLICATION_SCOPES,
  UNREADABLE_ENVIRONMENT_SCOPES,
} from "@/features/provider-connections/components/connection-scope-field";
import { ProviderConnectionCreatedButTestFailed } from "@/features/provider-connections/mutations/provider-connection-mutations";
import {
  buildAppStoreConnectCredential,
  type CreateAppStoreConnectConnectionInput,
  environmentMatchesConnectionMode,
  validateAppStoreConnectPrivateKey,
  validateAppStoreConnectVendorNumber,
} from "@/features/provider-connections/types/provider-operation-input";
import {
  validateAppleIssuerId,
  validateAppleKeyId,
} from "@/features/store-connections/types/store-credential-input";
import type { Application, Environment } from "@/generated/api";

const PROVIDERS_SUFFIX = /\/catalog\/providers$/;

const CONNECTION_MODE_OPTIONS = [
  { label: "Sandbox", value: "sandbox" },
  { label: "Production", value: "production" },
];

interface ConnectAppStoreConnectSheetProps extends ConnectionScopeReads {
  applications: readonly Application[];
  environments: readonly Environment[];
  onConnect: (input: CreateAppStoreConnectConnectionInput) => Promise<void>;
  providerBaseHref: string;
}

/**
 * The four credential fields are assembled into one JSON document here and sent
 * as the single opaque `credential` string the API seals. `externalProjectId` is
 * never sent: an App Store Connect key is issued per Apple team and already
 * names every app it can read, and the API rejects the field for this provider.
 *
 * The `.p8` is read in this browser, sent once over TLS, and cleared in the
 * submit `finally` block on every path. It is never written to the Query cache,
 * a route search parameter, browser storage, or a log.
 */
function useConnectAppStoreConnectForm({
  onConnect,
  onError,
  onSuccess,
}: {
  onConnect: (input: CreateAppStoreConnectConnectionInput) => Promise<void>;
  onError: (error: Error | null) => void;
  onSuccess: () => void;
}) {
  const form = useForm({
    defaultValues: {
      applicationIds: [] as string[],
      environmentIds: [] as string[],
      issuerId: "",
      keyId: "",
      mode: "sandbox" as "production" | "sandbox",
      name: "App Store Connect sandbox",
      privateKey: "",
      vendorNumber: "",
    },
    onSubmit: async ({ value }) => {
      onError(null);
      try {
        await onConnect({
          applicationIds: value.applicationIds,
          credential: buildAppStoreConnectCredential({
            issuerId: value.issuerId,
            keyId: value.keyId,
            privateKey: value.privateKey,
            vendorNumber: value.vendorNumber,
          }),
          environmentIds: value.environmentIds,
          mode: value.mode,
          name: value.name.trim(),
        });
        form.reset();
        onSuccess();
      } catch (error) {
        onError(
          error instanceof Error
            ? error
            : new Error("App Store Connect connection failed.")
        );
      } finally {
        // Cleared on every path: a failed attempt must not leave key material
        // sitting in a form field behind a sheet the operator walked away from.
        form.setFieldValue("privateKey", "");
      }
    },
  });
  return form;
}

type ConnectAppStoreConnectForm = ReturnType<
  typeof useConnectAppStoreConnectForm
>;

/**
 * Write-once App Store Connect API key entry.
 */
export function ConnectAppStoreConnectSheet({
  applications,
  applicationsUnreadable,
  environments,
  environmentsUnreadable,
  onConnect,
  onRetryScopes,
  providerBaseHref,
}: ConnectAppStoreConnectSheetProps) {
  const [open, setOpen] = useState(false);
  const [submitError, setSubmitError] = useState<Error | null>(null);
  const form = useConnectAppStoreConnectForm({
    onConnect,
    onError: setSubmitError,
    onSuccess: () => setOpen(false),
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
      <SheetTrigger render={<Button type="button" variant="outline" />}>
        Connect App Store Connect
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="border-b p-5">
          <SheetTitle>Connect App Store Connect</SheetTitle>
          <SheetDescription>
            Mosaic reads your existing App Store catalog so Products can be
            imported instead of retyped. The adapter is read-only and never
            changes anything in App Store Connect.
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
            <AppStoreConnectIdentityFields
              environments={environments}
              form={form}
            />

            <AppStoreConnectCredentialFields form={form} />

            <AppStoreConnectScopeFields
              applications={applications}
              applicationsUnreadable={applicationsUnreadable}
              environments={environments}
              environmentsUnreadable={environmentsUnreadable}
              form={form}
              onRetryScopes={onRetryScopes}
              providerBaseHref={providerBaseHref}
            />

            {submitError ? (
              <div
                className="rounded border border-destructive/25 bg-destructive/5 p-3"
                role="alert"
              >
                <p className="text-destructive text-sm">
                  {submitError.message}
                </p>
                <p className="mt-1 text-muted-foreground text-xs">
                  The key was cleared. Upload the .p8 file again to retry
                  safely.
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
            <p className="text-muted-foreground text-xs leading-5">
              Use a Developer or App Manager key. Mosaic needs read access to
              Apps, In-App Purchases, Subscription Groups, and Subscriptions —
              and nothing else.
            </p>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

/**
 * What the connection is called and which mode it is for. Changing the mode
 * drops Environment scopes that no longer match it.
 */
function AppStoreConnectIdentityFields({
  environments,
  form,
}: {
  environments: readonly Environment[];
  form: ConnectAppStoreConnectForm;
}) {
  return (
    <>
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
            <FieldLabel htmlFor="app-store-connect-connection-name">
              Connection name
            </FieldLabel>
            <Input
              aria-invalid={field.state.meta.errors.length > 0}
              id="app-store-connect-connection-name"
              onBlur={field.handleBlur}
              onChange={(event) =>
                field.handleChange(event.currentTarget.value)
              }
              placeholder="App Store Connect sandbox"
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
            <FieldLabel htmlFor="app-store-connect-connection-mode">
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
                      environmentMatchesConnectionMode(environment.mode, mode)
                    );
                  })
                );
              }}
              value={field.state.value}
            >
              <SelectTrigger id="app-store-connect-connection-mode">
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
              Sandbox and production connections remain separate and cannot
              silently replace one another.
            </FieldDescription>
          </Field>
        )}
      </form.Field>
    </>
  );
}

/**
 * The four parts of one App Store Connect API key. They are assembled into a
 * single opaque credential on submit.
 */
function AppStoreConnectCredentialFields({
  form,
}: {
  form: ConnectAppStoreConnectForm;
}) {
  return (
    <>
      <form.Field
        name="privateKey"
        validators={{
          onSubmit: ({ value }) => validateAppStoreConnectPrivateKey(value),
        }}
      >
        {(field) => (
          <AppStoreConnectPrivateKeyField
            errors={field.state.meta.errors}
            idPrefix="connect"
            label="App Store Connect API key (.p8)"
            onBlur={field.handleBlur}
            onChange={field.handleChange}
            value={field.state.value}
          />
        )}
      </form.Field>

      <form.Field
        name="keyId"
        validators={{
          onSubmit: ({ value }) => validateAppleKeyId(value),
        }}
      >
        {(field) => (
          <AppStoreConnectTextField
            errors={field.state.meta.errors}
            idPrefix="connect"
            kind="keyId"
            onBlur={field.handleBlur}
            onChange={field.handleChange}
            value={field.state.value}
          />
        )}
      </form.Field>

      <form.Field
        name="issuerId"
        validators={{
          onSubmit: ({ value }) => validateAppleIssuerId(value),
        }}
      >
        {(field) => (
          <AppStoreConnectTextField
            errors={field.state.meta.errors}
            idPrefix="connect"
            kind="issuerId"
            onBlur={field.handleBlur}
            onChange={field.handleChange}
            value={field.state.value}
          />
        )}
      </form.Field>

      <form.Field
        name="vendorNumber"
        validators={{
          onSubmit: ({ value }) => validateAppStoreConnectVendorNumber(value),
        }}
      >
        {(field) => (
          <AppStoreConnectTextField
            errors={field.state.meta.errors}
            idPrefix="connect"
            kind="vendorNumber"
            onBlur={field.handleBlur}
            onChange={field.handleChange}
            value={field.state.value}
          />
        )}
      </form.Field>
    </>
  );
}

/**
 * The Environments and Applications this connection may be used for. Nothing is
 * inferred: an unselected scope is not connected.
 */
function AppStoreConnectScopeFields({
  applications,
  applicationsUnreadable,
  environments,
  environmentsUnreadable,
  form,
  onRetryScopes,
  providerBaseHref,
}: ConnectionScopeReads & {
  applications: readonly Application[];
  environments: readonly Environment[];
  form: ConnectAppStoreConnectForm;
  providerBaseHref: string;
}) {
  return (
    <>
      <form.Field
        name="environmentIds"
        validators={{
          onSubmit: ({ value }) => {
            if (value.length === 0) {
              return "Select at least one compatible Environment.";
            }
            const mode = form.getFieldValue("mode");
            return value.some((id) => {
              const environment = environments.find((item) => item.id === id);
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
          <ConnectionScopeField
            emptyDescription="Create this scope before connecting App Store Connect."
            emptyHref={providerBaseHref.replace(
              PROVIDERS_SUFFIX,
              "/settings/environments"
            )}
            error={field.state.meta.errors[0]}
            items={environments.flatMap((environment) =>
              environmentMatchesConnectionMode(
                environment.mode,
                form.getFieldValue("mode")
              )
                ? [
                    {
                      description: environment.mode,
                      id: environment.id,
                      label: environment.name,
                    },
                  ]
                : []
            )}
            label="Environment scopes"
            onChange={field.handleChange}
            onRetry={onRetryScopes}
            selected={field.state.value}
            unreadableDescription={
              environmentsUnreadable ? UNREADABLE_ENVIRONMENT_SCOPES : undefined
            }
          />
        )}
      </form.Field>

      <form.Field
        name="applicationIds"
        validators={{
          onSubmit: ({ value }) =>
            value.length === 0 ? "Select at least one Application." : undefined,
        }}
      >
        {(field) => (
          <ConnectionScopeField
            emptyDescription="Create this scope before connecting App Store Connect."
            emptyHref={providerBaseHref.replace(PROVIDERS_SUFFIX, "/apps")}
            error={field.state.meta.errors[0]}
            items={applications.map((application) => ({
              description: `${application.platform.toUpperCase()} · ${application.identifier}`,
              id: application.id,
              label: application.name,
            }))}
            label="Application scopes"
            onChange={field.handleChange}
            onRetry={onRetryScopes}
            selected={field.state.value}
            unreadableDescription={
              applicationsUnreadable ? UNREADABLE_APPLICATION_SCOPES : undefined
            }
          />
        )}
      </form.Field>
    </>
  );
}
