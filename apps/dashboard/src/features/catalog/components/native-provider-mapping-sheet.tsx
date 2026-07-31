import { useForm } from "@tanstack/react-form"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import {
  nativeProviderLabel,
  nativeProviderMatchesPlatform,
  validateNativeProviderMapping,
  type GoogleOfferSelection,
  type NativeProviderKind,
  type NativeProviderMappingInput,
} from "@/features/catalog/types/native-provider-mapping"
import type { Application, Environment, Product } from "@/generated/api"

interface NativeProviderMappingSheetProps {
  application: Application
  environment: Environment
  initialValue?: Pick<
    NativeProviderMappingInput,
    "googleBasePlanId" | "googleOfferId" | "providerProductIdentifier"
  >
  mode?: "create" | "replace"
  onSubmit: (input: NativeProviderMappingInput) => Promise<void>
  product: Product
  provider: NativeProviderKind
  triggerLabel?: string
}

export function NativeProviderMappingSheet({
  application,
  environment,
  initialValue,
  mode = "create",
  onSubmit,
  product,
  provider,
  triggerLabel,
}: NativeProviderMappingSheetProps) {
  const [open, setOpen] = useState(false)
  const [submitError, setSubmitError] = useState<Error | null>(null)
  const providerLabel = nativeProviderLabel(provider)
  const platformCompatible = nativeProviderMatchesPlatform(provider, application.platform)
  const form = useForm({
    defaultValues: {
      googleBasePlanId: initialValue?.googleBasePlanId ?? "",
      googleOfferId: initialValue?.googleOfferId ?? "",
      offerSelection: (initialValue?.googleOfferId ? "specific" : "none") as GoogleOfferSelection,
      providerProductIdentifier: initialValue?.providerProductIdentifier ?? "",
    },
    onSubmit: async ({ value }) => {
      setSubmitError(null)
      if (!platformCompatible) {
        setSubmitError(
          new Error(
            `${providerLabel} cannot be mapped to an ${application.platform.toUpperCase()} Application.`,
          ),
        )
        return
      }
      const input: NativeProviderMappingInput = {
        applicationId: application.id,
        environmentId: environment.id,
        productType: product.type,
        provider,
        providerProductIdentifier: value.providerProductIdentifier.trim(),
        ...(provider === "google_play" && product.type === "subscription"
          ? {
              googleBasePlanId: value.googleBasePlanId.trim(),
              ...(value.offerSelection === "specific"
                ? { googleOfferId: value.googleOfferId.trim() }
                : {}),
            }
          : {}),
      }
      const errors = validateNativeProviderMapping(input)
      if (Object.keys(errors).length > 0) return
      try {
        await onSubmit(input)
        setOpen(false)
      } catch (error) {
        setSubmitError(
          error instanceof Error
            ? error
            : new Error(`${providerLabel} mapping could not be saved.`),
        )
      }
    },
  })

  return (
    <Sheet
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        setSubmitError(null)
        if (!nextOpen) form.reset()
      }}
      open={open}
    >
      <SheetTrigger render={<Button size="sm" type="button" variant="outline" />}>
        {triggerLabel ??
          (mode === "replace" ? "Review replacement" : `Add ${providerLabel} mapping`)}
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="border-b p-5">
          <SheetTitle>
            {mode === "replace"
              ? `Replace ${providerLabel} mapping`
              : `Add ${providerLabel} mapping`}
          </SheetTitle>
          <SheetDescription>
            Map this stable Mosaic Product to one exact native store Product. Saving configuration
            does not prove store availability or purchase success.
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
            <dl className="bg-muted/40 grid gap-3 rounded border p-4 text-xs sm:grid-cols-2">
              <ScopeField
                label="Mosaic Product"
                value={`${product.internalName} · ${product.key}`}
              />
              <ScopeField
                label="Product type"
                value={product.type === "subscription" ? "Subscription" : "One-time non-consumable"}
              />
              <ScopeField
                label="Mosaic Environment"
                value={`${environment.name} · ${environment.mode}`}
              />
              <ScopeField
                label="Application"
                value={`${application.name} · ${application.platform.toUpperCase()}`}
              />
            </dl>
            {!platformCompatible ? (
              <p
                className="text-destructive rounded border border-current p-3 text-sm"
                role="alert"
              >
                {providerLabel} is not compatible with this {application.platform.toUpperCase()}{" "}
                Application. Choose the platform’s built-in provider instead.
              </p>
            ) : null}

            <form.Field
              name="providerProductIdentifier"
              validators={{
                onSubmit: ({ value }) =>
                  validateNativeProviderMapping({
                    applicationId: application.id,
                    environmentId: environment.id,
                    productType: product.type,
                    provider,
                    providerProductIdentifier: value,
                  }).providerProductIdentifier,
              }}
            >
              {(field) => (
                <Field data-invalid={field.state.meta.errors.length > 0}>
                  <FieldLabel htmlFor={`native-product-id-${provider}`}>
                    {provider === "app_store" ? "StoreKit Product ID" : "Google Play Product ID"}
                  </FieldLabel>
                  <Input
                    aria-invalid={field.state.meta.errors.length > 0}
                    autoComplete="off"
                    id={`native-product-id-${provider}`}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.currentTarget.value)}
                    placeholder={
                      provider === "app_store" ? "com.example.pro.monthly" : "pro_subscription"
                    }
                    spellCheck={false}
                    value={field.state.value}
                  />
                  <FieldDescription>
                    Exact identifier only. Mosaic never matches by display name, price, period, or
                    similarity.
                    {provider === "google_play"
                      ? " One Google Product ID can map to only one Mosaic Product in this Environment and Application so purchase recovery remains unambiguous."
                      : null}
                  </FieldDescription>
                  <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
                </Field>
              )}
            </form.Field>

            {provider === "google_play" && product.type === "subscription" ? (
              <>
                <form.Field
                  name="googleBasePlanId"
                  validators={{
                    onSubmit: ({ value }) =>
                      value.trim() ? undefined : "Enter the exact base plan ID.",
                  }}
                >
                  {(field) => (
                    <Field data-invalid={field.state.meta.errors.length > 0}>
                      <FieldLabel htmlFor="google-base-plan-id">Base plan ID</FieldLabel>
                      <Input
                        aria-invalid={field.state.meta.errors.length > 0}
                        id="google-base-plan-id"
                        onBlur={field.handleBlur}
                        onChange={(event) => field.handleChange(event.currentTarget.value)}
                        placeholder="monthly"
                        spellCheck={false}
                        value={field.state.value}
                      />
                      <FieldDescription>
                        Required for subscriptions and kept inside this Provider Product Mapping.
                      </FieldDescription>
                      <FieldError
                        errors={field.state.meta.errors.map((message) => ({ message }))}
                      />
                    </Field>
                  )}
                </form.Field>

                <form.Field name="offerSelection">
                  {(field) => (
                    <fieldset className="space-y-2">
                      <legend className="text-sm font-medium">Offer</legend>
                      <label className="flex items-start gap-3 rounded border p-3 text-sm">
                        <input
                          checked={field.state.value === "none"}
                          className="accent-primary mt-0.5 size-4"
                          name="google-offer-selection"
                          onChange={() => {
                            field.handleChange("none")
                            form.setFieldValue("googleOfferId", "")
                          }}
                          type="radio"
                        />
                        <span>
                          <span className="block font-medium">No offer</span>
                          <span className="text-muted-foreground mt-0.5 block text-xs">
                            Use the exact regular base plan.
                          </span>
                        </span>
                      </label>
                      <label className="flex items-start gap-3 rounded border p-3 text-sm">
                        <input
                          checked={field.state.value === "specific"}
                          className="accent-primary mt-0.5 size-4"
                          name="google-offer-selection"
                          onChange={() => field.handleChange("specific")}
                          type="radio"
                        />
                        <span>
                          <span className="block font-medium">Use a specific offer</span>
                          <span className="text-muted-foreground mt-0.5 block text-xs">
                            Require an exact offer ID. The runtime resolves its current offer token;
                            Mosaic never stores or guesses that token.
                          </span>
                        </span>
                      </label>
                    </fieldset>
                  )}
                </form.Field>

                <form.Subscribe selector={(state) => state.values.offerSelection}>
                  {(offerSelection) =>
                    offerSelection === "specific" ? (
                      <form.Field
                        name="googleOfferId"
                        validators={{
                          onSubmit: ({ value }) =>
                            value.trim() ? undefined : "Enter the exact offer ID.",
                        }}
                      >
                        {(field) => (
                          <Field data-invalid={field.state.meta.errors.length > 0}>
                            <FieldLabel htmlFor="google-offer-id">Offer ID</FieldLabel>
                            <Input
                              aria-invalid={field.state.meta.errors.length > 0}
                              id="google-offer-id"
                              onBlur={field.handleBlur}
                              onChange={(event) => field.handleChange(event.currentTarget.value)}
                              placeholder="intro"
                              spellCheck={false}
                              value={field.state.value}
                            />
                            <FieldError
                              errors={field.state.meta.errors.map((message) => ({ message }))}
                            />
                          </Field>
                        )}
                      </form.Field>
                    ) : null
                  }
                </form.Subscribe>
              </>
            ) : null}

            <div className="border-border bg-muted/35 rounded border p-4 text-sm">
              <p className="font-semibold">Test evidence remains separate</p>
              <p className="text-muted-foreground mt-1 text-xs leading-5">
                Mosaic Environment: {environment.name}. Store context will be shown separately as
                StoreKit Configuration, Apple Sandbox, Google Play test, Production, or Unknown
                after an authenticated test client reports an observation.
              </p>
            </div>

            {submitError ? (
              <p className="text-destructive text-sm" role="alert">
                {submitError.message}
              </p>
            ) : null}
          </div>
          <SheetFooter className="border-t p-5">
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <Button disabled={isSubmitting || !platformCompatible} type="submit">
                  {isSubmitting
                    ? "Saving mapping…"
                    : mode === "replace"
                      ? "Create replacement mapping"
                      : "Save configured mapping"}
                </Button>
              )}
            </form.Subscribe>
            <p className="text-muted-foreground text-xs">
              Provider-owned localized metadata is read-only and appears only after an accepted
              observation. Published Paywall documents continue to store the Mosaic Product ID.
            </p>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}

function ScopeField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-medium">{value}</dd>
    </div>
  )
}
