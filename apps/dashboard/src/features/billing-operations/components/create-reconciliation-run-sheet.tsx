import { useForm, useStore } from "@tanstack/react-form"
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
  providerLabel,
  reconciliationStrategyLabel,
  storeEnvironmentLabel,
} from "@/features/billing-ledger/types/billing-vocabulary"
import {
  defaultReconciliationWindow,
  describeReconciliationRangeIssue,
  MAX_RECONCILIATION_WINDOW_DAYS,
  toIsoInstant,
  validateReconciliationRange,
} from "@/features/billing-operations/types/reconciliation-range"
import type { CreateReconciliationRunRequest, StoreServerCredential } from "@/generated/api"

const fieldClass =
  "border-input bg-background focus-visible:border-ring focus-visible:ring-ring/40 h-9 w-full rounded border px-3 text-sm outline-none focus-visible:ring-3"

/**
 * The strategies the API accepts today.
 *
 * `apple_transaction_history` is deliberately absent: the worker has no run
 * loop for it, so offering it produced a queued run that failed later with
 * `unsupported_strategy` and no explanation anywhere the operator could see.
 * It stays in the stored enumeration for forward compatibility, which is why
 * the read side still labels it on historical runs.
 */
type Strategy = NonNullable<CreateReconciliationRunRequest["strategy"]>

function strategiesFor(provider: string | undefined): readonly Strategy[] {
  return provider === "google_play" ? ["google_token_requery"] : ["apple_notification_history"]
}

interface CreateReconciliationRunSheetProps {
  credentials: readonly StoreServerCredential[]
  environmentName: string
  onCreate: (request: CreateReconciliationRunRequest) => Promise<void>
  storeConnectionsHref: string
}

/**
 * Starting a reconciliation pass.
 *
 * The window is bounded before submission because an unbounded or inverted
 * range either floods ingestion or quietly examines nothing. The ceiling is the
 * contract's own limit and matches Apple's notification-history retention.
 */
export function CreateReconciliationRunSheet({
  credentials,
  environmentName,
  onCreate,
  storeConnectionsHref,
}: CreateReconciliationRunSheetProps) {
  const [open, setOpen] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const usable = credentials.filter((credential) => credential.status !== "revoked")
  const initialWindow = defaultReconciliationWindow()

  const form = useForm({
    defaultValues: {
      credentialId: usable[0]?.id ?? "",
      strategy: strategiesFor(usable[0]?.provider)[0] as Strategy,
      windowEnd: initialWindow.windowEnd,
      windowStart: initialWindow.windowStart,
    },
    onSubmit: async ({ value }) => {
      setSubmitError(null)
      const credential = usable.find((item) => item.id === value.credentialId)
      if (!credential?.provider) {
        setSubmitError("Choose a Store Server Credential to reconcile against.")
        return
      }
      try {
        await onCreate({
          credentialId: value.credentialId,
          provider: credential.provider,
          strategy: value.strategy,
          windowEnd: toIsoInstant(value.windowEnd),
          windowStart: toIsoInstant(value.windowStart),
        })
        form.reset()
        setOpen(false)
      } catch (error) {
        setSubmitError(
          error instanceof Error
            ? error.message
            : "Mosaic could not queue this reconciliation run.",
        )
      }
    },
  })

  const credentialId = useStore(form.store, (state) => state.values.credentialId)
  const selected = usable.find((item) => item.id === credentialId)

  return (
    <Sheet
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        setSubmitError(null)
        if (!nextOpen) form.reset()
      }}
      open={open}
    >
      <SheetTrigger render={<Button type="button" />}>Start reconciliation</SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="border-b p-5">
          <SheetTitle>Start a reconciliation run</SheetTitle>
          <SheetDescription>
            Reconciliation re-reads store history to find inputs Mosaic never received. It validates
            store-confirmed facts; it does not calculate anyone&rsquo;s access to your app.
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
            {usable.length === 0 ? (
              <div className="rounded border border-dashed p-4 text-sm">
                <p className="text-muted-foreground">
                  Reconciliation needs an active Store Server Credential to authenticate with.
                </p>
                <a
                  className="text-primary mt-2 inline-flex font-semibold"
                  href={storeConnectionsHref}
                >
                  Add a Store Server Credential
                </a>
              </div>
            ) : null}

            <form.Field
              name="credentialId"
              validators={{
                onSubmit: ({ value }) =>
                  value.length === 0 ? "Choose a Store Server Credential." : undefined,
              }}
            >
              {(field) => (
                <Field data-invalid={field.state.meta.errors.length > 0}>
                  <FieldLabel htmlFor="reconciliation-credential">
                    Store Server Credential
                  </FieldLabel>
                  <select
                    className={fieldClass}
                    id="reconciliation-credential"
                    onChange={(event) => {
                      field.handleChange(event.currentTarget.value)
                      const next = usable.find((item) => item.id === event.currentTarget.value)
                      form.setFieldValue("strategy", strategiesFor(next?.provider)[0] as Strategy)
                    }}
                    value={field.state.value}
                  >
                    <option value="">Select a credential</option>
                    {usable.map((credential) => (
                      <option key={credential.id} value={credential.id}>
                        {credential.name} · {providerLabel(credential.provider)} ·{" "}
                        {storeEnvironmentLabel(credential.storeEnvironment)}
                      </option>
                    ))}
                  </select>
                  <FieldDescription>
                    The credential fixes both the store and the Store Environment. The Mosaic
                    Environment is {environmentName} and comes from the address.
                  </FieldDescription>
                  <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
                </Field>
              )}
            </form.Field>

            <form.Field name="strategy">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="reconciliation-strategy">Strategy</FieldLabel>
                  <select
                    className={fieldClass}
                    id="reconciliation-strategy"
                    onChange={(event) => field.handleChange(event.currentTarget.value as Strategy)}
                    value={field.state.value}
                  >
                    {strategiesFor(selected?.provider).map((strategy) => (
                      <option key={strategy} value={strategy}>
                        {reconciliationStrategyLabel(strategy)}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </form.Field>

            <form.Field
              name="windowStart"
              validators={{
                onSubmit: ({ value }) => {
                  const issues = validateReconciliationRange({
                    windowEnd: form.getFieldValue("windowEnd"),
                    windowStart: value,
                  })
                  return issues.length > 0
                    ? describeReconciliationRangeIssue(issues[0]!)
                    : undefined
                },
              }}
            >
              {(field) => (
                <Field data-invalid={field.state.meta.errors.length > 0}>
                  <FieldLabel htmlFor="reconciliation-start">Window start (local time)</FieldLabel>
                  <Input
                    aria-invalid={field.state.meta.errors.length > 0}
                    id="reconciliation-start"
                    onChange={(event) => field.handleChange(event.currentTarget.value)}
                    type="datetime-local"
                    value={field.state.value}
                  />
                  <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
                </Field>
              )}
            </form.Field>

            <form.Field
              name="windowEnd"
              validators={{
                onSubmit: ({ value }) => {
                  const issues = validateReconciliationRange({
                    windowEnd: value,
                    windowStart: form.getFieldValue("windowStart"),
                  })
                  return issues.length > 0
                    ? describeReconciliationRangeIssue(issues[0]!)
                    : undefined
                },
              }}
            >
              {(field) => (
                <Field data-invalid={field.state.meta.errors.length > 0}>
                  <FieldLabel htmlFor="reconciliation-end">Window end (local time)</FieldLabel>
                  <Input
                    aria-invalid={field.state.meta.errors.length > 0}
                    id="reconciliation-end"
                    onChange={(event) => field.handleChange(event.currentTarget.value)}
                    type="datetime-local"
                    value={field.state.value}
                  />
                  <FieldDescription>
                    Bounded to {MAX_RECONCILIATION_WINDOW_DAYS} days. Run consecutive windows to
                    cover a longer period.
                  </FieldDescription>
                  <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
                </Field>
              )}
            </form.Field>

            {submitError ? (
              <p className="text-destructive text-sm" role="alert">
                {submitError}
              </p>
            ) : null}
          </div>
          <SheetFooter className="border-t p-5">
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <Button disabled={isSubmitting || usable.length === 0} type="submit">
                  {isSubmitting ? "Queueing…" : "Queue reconciliation run"}
                </Button>
              )}
            </form.Subscribe>
            <p className="text-muted-foreground text-xs leading-5">
              Reconciliation only appends. Anything it discovers enters the same deduplication
              pipeline as a live notification, so re-running an overlapping window records nothing
              twice.
            </p>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
