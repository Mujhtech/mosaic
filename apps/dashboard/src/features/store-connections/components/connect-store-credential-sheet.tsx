import { useForm, useStore } from "@tanstack/react-form"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { providerLabel } from "@/features/billing-ledger/types/billing-vocabulary"
import {
  buildCreateStoreCredentialRequest,
  readGoogleServiceAccount,
  storeEnvironmentMatchesMode,
  validateAppleIssuerId,
  validateAppleKeyId,
  validateApplePrivateKey,
  validateGoogleServiceAccount,
  validateProviderApplicationIdentifier,
  type StoreCredentialFormValues,
} from "@/features/store-connections/types/store-credential-input"
import type { Application, CreateStoreServerCredentialRequest, Environment } from "@/generated/api"

interface ConnectStoreCredentialSheetProps {
  applications: readonly Application[]
  applicationsHref: string
  environments: readonly Environment[]
  environmentsHref: string
  onCreate: (request: CreateStoreServerCredentialRequest) => Promise<void>
}

/**
 * Write-only Store Server Credential entry.
 *
 * The secret is typed once, sent once over TLS, and cleared in the submit
 * `finally` block whether the attempt succeeded or failed. It is never written
 * to the Query cache, a route search parameter, browser storage, or a route
 * loader, and no read ever returns it.
 *
 * Apple and Google share one sheet because the surrounding workflow — name,
 * Mosaic Environment, Store Environment, Application scope, one-time secret —
 * is identical; only the credential-specific fields differ. Two near-identical
 * sheets would be two places for the secret-handling rules to drift.
 */
const STORE_PROVIDER_OPTIONS = [
  { label: providerLabel("app_store"), value: "app_store" },
  { label: providerLabel("google_play"), value: "google_play" },
]

const STORE_ENVIRONMENT_OPTIONS = [
  { label: "Sandbox", value: "sandbox" },
  { label: "Production", value: "production" },
]

export function ConnectStoreCredentialSheet({
  applications,
  applicationsHref,
  environments,
  environmentsHref,
  onCreate,
}: ConnectStoreCredentialSheetProps) {
  const [open, setOpen] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const form = useForm({
    defaultValues: {
      applications: [] as StoreCredentialFormValues["applications"],
      appleIssuerId: "",
      appleKeyId: "",
      environmentId: "",
      googlePubSubProjectId: "",
      googlePubSubSubscriptionId: "",
      name: "",
      provider: "app_store" as StoreCredentialFormValues["provider"],
      secret: "",
      storeEnvironment: "sandbox" as StoreCredentialFormValues["storeEnvironment"],
    },
    onSubmit: async ({ value }) => {
      setSubmitError(null)
      try {
        await onCreate(
          buildCreateStoreCredentialRequest(value, (applicationId) =>
            applications.find((item) => item.id === applicationId)?.platform === "android"
              ? "android"
              : "ios",
          ),
        )
        form.reset()
        setOpen(false)
      } catch (error) {
        setSubmitError(
          error instanceof Error
            ? error.message
            : "Mosaic could not store this Store Server Credential.",
        )
      } finally {
        // Cleared on every path: a failed attempt must not leave key material
        // sitting in a form field behind a sheet the operator walked away from.
        form.setFieldValue("secret", "")
      }
    },
  })

  const provider = useStore(form.store, (state) => state.values.provider)
  const storeEnvironment = useStore(form.store, (state) => state.values.storeEnvironment)
  const secretValue = useStore(form.store, (state) => state.values.secret)
  const compatibleEnvironments = environments.filter((environment) =>
    storeEnvironmentMatchesMode(environment.mode, storeEnvironment),
  )
  const environmentOptions = [
    { label: "Select an Environment", value: "" },
    ...compatibleEnvironments.map((environment) => ({
      label: `${environment.name} · ${environment.mode}`,
      value: environment.id,
    })),
  ]
  const googleSummary =
    provider === "google_play" && secretValue.trim().length > 0
      ? readGoogleServiceAccount(secretValue)
      : undefined

  return (
    <Sheet
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        setSubmitError(null)
        if (!nextOpen) form.reset()
      }}
      open={open}
    >
      <SheetTrigger render={<Button type="button" />}>Add Store Server Credential</SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="border-b p-5">
          <SheetTitle>Add Store Server Credential</SheetTitle>
          <SheetDescription>
            Mosaic uses this key only to ask the store whether a transaction is authentic. It reads;
            it never changes anything in your store account.
          </SheetDescription>
        </SheetHeader>
        <form
          className="flex flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void form.handleSubmit()
          }}
        >
          <div className="space-y-5 p-5">
            <form.Field name="provider">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="store-credential-provider">Store</FieldLabel>
                  <Select
                    items={STORE_PROVIDER_OPTIONS}
                    onValueChange={(value) => {
                      field.handleChange(value as StoreCredentialFormValues["provider"])
                      form.setFieldValue("secret", "")
                    }}
                    value={field.state.value}
                  >
                    <SelectTrigger id="store-credential-provider">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STORE_PROVIDER_OPTIONS.map((option) => (
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
              name="name"
              validators={{
                onSubmit: ({ value }) =>
                  value.trim().length === 0
                    ? "Enter a name for this connection."
                    : value.length > 120
                      ? "Use 120 characters or fewer."
                      : undefined,
              }}
            >
              {(field) => (
                <Field data-invalid={field.state.meta.errors.length > 0}>
                  <FieldLabel htmlFor="store-credential-name">Connection name</FieldLabel>
                  <Input
                    aria-invalid={field.state.meta.errors.length > 0}
                    id="store-credential-name"
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.currentTarget.value)}
                    placeholder="App Store sandbox"
                    value={field.state.value}
                  />
                  <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
                </Field>
              )}
            </form.Field>

            <form.Field name="storeEnvironment">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="store-credential-store-environment">
                    Store Environment
                  </FieldLabel>
                  <Select
                    items={STORE_ENVIRONMENT_OPTIONS}
                    onValueChange={(value) => {
                      const next = value as StoreCredentialFormValues["storeEnvironment"]
                      field.handleChange(next)
                      const selected = environments.find(
                        (item) => item.id === form.getFieldValue("environmentId"),
                      )
                      if (selected && !storeEnvironmentMatchesMode(selected.mode, next)) {
                        form.setFieldValue("environmentId", "")
                      }
                    }}
                    value={field.state.value}
                  >
                    <SelectTrigger id="store-credential-store-environment">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STORE_ENVIRONMENT_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldDescription>
                    Sandbox and production are separate connections and never mix. This is the
                    store&rsquo;s own classification, not your Mosaic Environment.
                  </FieldDescription>
                </Field>
              )}
            </form.Field>

            <form.Field
              name="environmentId"
              validators={{
                onSubmit: ({ value }) =>
                  value.length === 0 ? "Select a Mosaic Environment." : undefined,
              }}
            >
              {(field) => (
                <Field data-invalid={field.state.meta.errors.length > 0}>
                  <FieldLabel htmlFor="store-credential-environment">Mosaic Environment</FieldLabel>
                  {compatibleEnvironments.length === 0 ? (
                    <div className="rounded border border-dashed p-3 text-xs">
                      <p className="text-muted-foreground">
                        No Mosaic Environment matches this Store Environment. A production Store
                        Environment needs a production Mosaic Environment.
                      </p>
                      <a
                        className="text-primary mt-2 inline-flex font-semibold"
                        href={environmentsHref}
                      >
                        Create an Environment
                      </a>
                    </div>
                  ) : (
                    <Select
                      items={environmentOptions}
                      onValueChange={(value) => field.handleChange(value)}
                      value={field.state.value}
                    >
                      <SelectTrigger
                        aria-invalid={field.state.meta.errors.length > 0}
                        id="store-credential-environment"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {environmentOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
                </Field>
              )}
            </form.Field>

            <form.Field
              name="applications"
              validators={{
                onSubmit: ({ value }) => {
                  if (value.length === 0) return "Select at least one Application."
                  return value.some((item) =>
                    validateProviderApplicationIdentifier(item.providerApplicationIdentifier),
                  )
                    ? "Enter the store identifier for every selected Application."
                    : undefined
                },
              }}
            >
              {(field) => (
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">Application scope</legend>
                  <p className="text-muted-foreground text-xs leading-5">
                    A verified notification is accepted only for an Application listed here. Mosaic
                    matches the store&rsquo;s own bundle ID or package name against these values.
                  </p>
                  {applications.length === 0 ? (
                    <div className="rounded border border-dashed p-3 text-xs">
                      <p className="text-muted-foreground">
                        Register an Application before adding a Store Server Credential.
                      </p>
                      <a
                        className="text-primary mt-2 inline-flex font-semibold"
                        href={applicationsHref}
                      >
                        Register an Application
                      </a>
                    </div>
                  ) : (
                    <div className="grid gap-2">
                      {applications.map((application) => {
                        const selected = field.state.value.find(
                          (item) => item.applicationId === application.id,
                        )
                        return (
                          <div className="rounded border p-3 text-sm" key={application.id}>
                            <label className="flex items-start gap-3">
                              <input
                                checked={Boolean(selected)}
                                className="accent-primary mt-0.5 size-4"
                                onChange={(event) =>
                                  field.handleChange(
                                    event.currentTarget.checked
                                      ? [
                                          ...field.state.value,
                                          {
                                            applicationId: application.id,
                                            providerApplicationIdentifier: application.identifier,
                                          },
                                        ]
                                      : field.state.value.filter(
                                          (item) => item.applicationId !== application.id,
                                        ),
                                  )
                                }
                                type="checkbox"
                              />
                              <span>
                                <span className="block font-medium">{application.name}</span>
                                <span className="text-muted-foreground mt-0.5 block text-xs">
                                  {application.platform.toUpperCase()} · {application.identifier}
                                </span>
                              </span>
                            </label>
                            {selected ? (
                              <label className="mt-3 block space-y-1 text-xs font-medium">
                                {provider === "app_store" ? "Bundle ID" : "Package name"}
                                <Input
                                  onChange={(event) =>
                                    field.handleChange(
                                      field.state.value.map((item) =>
                                        item.applicationId === application.id
                                          ? {
                                              ...item,
                                              providerApplicationIdentifier:
                                                event.currentTarget.value,
                                            }
                                          : item,
                                      ),
                                    )
                                  }
                                  spellCheck={false}
                                  value={selected.providerApplicationIdentifier}
                                />
                              </label>
                            ) : null}
                          </div>
                        )
                      })}
                    </div>
                  )}
                  {field.state.meta.errors[0] ? (
                    <p className="text-destructive text-sm" role="alert">
                      {field.state.meta.errors[0]}
                    </p>
                  ) : null}
                </fieldset>
              )}
            </form.Field>

            {provider === "app_store" ? (
              <>
                <form.Field
                  name="appleIssuerId"
                  validators={{ onSubmit: ({ value }) => validateAppleIssuerId(value) }}
                >
                  {(field) => (
                    <Field data-invalid={field.state.meta.errors.length > 0}>
                      <FieldLabel htmlFor="store-credential-issuer">Issuer ID</FieldLabel>
                      <Input
                        aria-invalid={field.state.meta.errors.length > 0}
                        id="store-credential-issuer"
                        onBlur={field.handleBlur}
                        onChange={(event) => field.handleChange(event.currentTarget.value)}
                        placeholder="00000000-0000-0000-0000-000000000000"
                        spellCheck={false}
                        value={field.state.value}
                      />
                      <FieldDescription>
                        App Store Connect · Users and Access · Integrations. Not a secret.
                      </FieldDescription>
                      <FieldError
                        errors={field.state.meta.errors.map((message) => ({ message }))}
                      />
                    </Field>
                  )}
                </form.Field>

                <form.Field
                  name="appleKeyId"
                  validators={{ onSubmit: ({ value }) => validateAppleKeyId(value) }}
                >
                  {(field) => (
                    <Field data-invalid={field.state.meta.errors.length > 0}>
                      <FieldLabel htmlFor="store-credential-key-id">Key ID</FieldLabel>
                      <Input
                        aria-invalid={field.state.meta.errors.length > 0}
                        id="store-credential-key-id"
                        onBlur={field.handleBlur}
                        onChange={(event) => field.handleChange(event.currentTarget.value)}
                        placeholder="ABCDE12345"
                        spellCheck={false}
                        value={field.state.value}
                      />
                      <FieldError
                        errors={field.state.meta.errors.map((message) => ({ message }))}
                      />
                    </Field>
                  )}
                </form.Field>
              </>
            ) : (
              <>
                <form.Field name="googlePubSubProjectId">
                  {(field) => (
                    <Field>
                      <FieldLabel htmlFor="store-credential-pubsub-project">
                        Pub/Sub project ID
                      </FieldLabel>
                      <Input
                        id="store-credential-pubsub-project"
                        onChange={(event) => field.handleChange(event.currentTarget.value)}
                        spellCheck={false}
                        value={field.state.value}
                      />
                    </Field>
                  )}
                </form.Field>
                <form.Field name="googlePubSubSubscriptionId">
                  {(field) => (
                    <Field>
                      <FieldLabel htmlFor="store-credential-pubsub-subscription">
                        Pub/Sub subscription ID
                      </FieldLabel>
                      <Input
                        id="store-credential-pubsub-subscription"
                        onChange={(event) => field.handleChange(event.currentTarget.value)}
                        spellCheck={false}
                        value={field.state.value}
                      />
                      <FieldDescription>
                        Mosaic pulls notifications from this subscription. Google Play needs no
                        inbound Mosaic address.
                      </FieldDescription>
                    </Field>
                  )}
                </form.Field>
              </>
            )}

            <form.Field
              name="secret"
              validators={{
                onSubmit: ({ value }) =>
                  form.getFieldValue("provider") === "app_store"
                    ? validateApplePrivateKey(value)
                    : validateGoogleServiceAccount(value),
              }}
            >
              {(field) => (
                <Field data-invalid={field.state.meta.errors.length > 0}>
                  <FieldLabel htmlFor="store-credential-secret">
                    {provider === "app_store"
                      ? "In-App Purchase key (.p8)"
                      : "Service-account JSON key"}
                  </FieldLabel>
                  {/*
                    A multi-line key cannot use type="password", so the field is
                    labelled explicitly instead: entered once, never shown again.
                  */}
                  <textarea
                    aria-describedby="store-credential-secret-help"
                    aria-invalid={field.state.meta.errors.length > 0}
                    autoComplete="off"
                    className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/40 min-h-32 w-full rounded border px-3 py-2 font-mono text-xs outline-none focus-visible:ring-3"
                    id="store-credential-secret"
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.currentTarget.value)}
                    spellCheck={false}
                    value={field.state.value}
                  />
                  <div>
                    <input
                      accept={provider === "app_store" ? ".p8,.pem" : ".json,application/json"}
                      aria-label="Read the key file into the field above"
                      className="text-muted-foreground text-xs"
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0]
                        // Read entirely in the browser into form state. The file
                        // is never uploaded as a file and never touches storage.
                        if (file) void file.text().then((text) => field.handleChange(text))
                      }}
                      type="file"
                    />
                  </div>
                  <FieldDescription id="store-credential-secret-help">
                    Entered once over TLS, encrypted by the API, cleared from this form after the
                    attempt, and never returned or shown again. Mosaic checks only the file format
                    here; the store decides whether the key works.
                  </FieldDescription>
                  {googleSummary && "summary" in googleSummary ? (
                    <p className="text-muted-foreground text-xs" role="status">
                      Service account: <strong>{googleSummary.summary.clientEmail}</strong>
                      {googleSummary.summary.projectId
                        ? ` · project ${googleSummary.summary.projectId}`
                        : ""}
                    </p>
                  ) : null}
                  <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
                </Field>
              )}
            </form.Field>

            {submitError ? (
              <div
                className="border-destructive/25 bg-destructive/5 rounded border p-3"
                role="alert"
              >
                <p className="text-destructive text-sm">{submitError}</p>
                <p className="text-muted-foreground mt-1 text-xs">
                  The key field was cleared. Paste it again to retry safely.
                </p>
              </div>
            ) : null}
          </div>
          <SheetFooter className="border-t p-5">
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <Button disabled={isSubmitting} type="submit">
                  {isSubmitting ? "Storing credential…" : "Store credential"}
                </Button>
              )}
            </form.Subscribe>
            <p className="text-muted-foreground text-xs leading-5">
              For the App Store, the notification endpoint address is shown exactly once on the next
              screen. Copy it before leaving the page.
            </p>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
