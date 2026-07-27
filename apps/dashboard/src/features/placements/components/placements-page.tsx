import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"

import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/feedback/empty-state"
import { buttonVariants } from "@/components/ui/button-variants"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary"
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state"
import { MonetizationWorkspace } from "@/features/environments/components/monetization-workspace"
import { WorkflowPanel } from "@/features/organizations/components/workspace-page"
import { paywallsQueryOptions } from "@/features/paywalls/queries/paywall-queries"
import {
  bindPlacementMutationOptions,
  createPlacementAndBindMutationOptions,
  PlacementCreatedWithoutBindingError,
} from "@/features/placements/mutations/placement-mutations"
import { placementsQueryOptions } from "@/features/placements/queries/placement-queries"
import type {
  HostedPaywallListItem,
  HostedPlacement,
} from "@/features/publishing/api/hosted-publishing-adapter"
import { useHostedPublishingAdapter } from "@/features/publishing/api/use-hosted-publishing-adapter"

const KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/

function BindPlacementAction({
  environmentId,
  paywalls,
  placement,
  projectId,
}: {
  environmentId: string
  paywalls: readonly HostedPaywallListItem[]
  placement: HostedPlacement
  projectId: string
}) {
  const adapter = useHostedPublishingAdapter()
  const queryClient = useQueryClient()
  const mutation = useMutation(
    bindPlacementMutationOptions({ environmentId, placement, projectId }, adapter, queryClient),
  )
  const form = useForm({
    defaultValues: { paywallId: placement.binding?.paywallId ?? paywalls[0]?.id ?? "" },
    onSubmit: async ({ value }) => {
      const paywall = paywalls.find((item) => item.id === value.paywallId)
      if (paywall) await mutation.mutateAsync(paywall)
    },
  })

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void form.handleSubmit()
      }}
    >
      <form.Field name="paywallId">
        {(field) => (
          <label className="grid gap-1 text-xs font-medium">
            Bound paywall
            <select
              aria-label={`Paywall for ${placement.name}`}
              className="border-input bg-background h-8 min-w-48 rounded border px-2 text-sm"
              onChange={(event) => field.handleChange(event.currentTarget.value)}
              value={field.state.value}
            >
              {paywalls.map((paywall) => (
                <option key={paywall.id} value={paywall.id}>
                  {paywall.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </form.Field>
      <Button disabled={mutation.isPending || paywalls.length === 0} size="sm" type="submit">
        {mutation.isPending ? "Binding…" : placement.binding ? "Change binding" : "Bind"}
      </Button>
      {mutation.error ? (
        <p className="text-destructive basis-full text-sm" role="alert">
          {mutation.error.message}
        </p>
      ) : null}
    </form>
  )
}

function CreatePlacementForm({
  environmentId,
  paywalls,
  projectId,
}: {
  environmentId: string
  paywalls: readonly HostedPaywallListItem[]
  projectId: string
}) {
  const adapter = useHostedPublishingAdapter()
  const queryClient = useQueryClient()
  const mutation = useMutation(
    createPlacementAndBindMutationOptions({ environmentId, projectId }, adapter, queryClient),
  )
  const form = useForm({
    defaultValues: { key: "", name: "", paywallId: paywalls[0]?.id ?? "" },
    onSubmit: async ({ value, formApi }) => {
      const paywall = paywalls.find((item) => item.id === value.paywallId)
      try {
        const partial =
          mutation.error instanceof PlacementCreatedWithoutBindingError ? mutation.error : null
        await mutation.mutateAsync({
          existingPlacement: partial?.placement,
          key: value.key.trim(),
          name: value.name.trim(),
          paywall,
        })
        formApi.reset()
      } catch {
        // The form keeps its values and exposes a safe retry for the missing binding below.
      }
    },
  })

  return (
    <form
      className="grid gap-4 lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-start"
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void form.handleSubmit()
      }}
    >
      <form.Field
        name="name"
        validators={{
          onBlur: ({ value }) => (value.trim() ? undefined : "Enter a Placement name."),
          onSubmit: ({ value }) => (value.trim() ? undefined : "Enter a Placement name."),
        }}
      >
        {(field) => (
          <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
            <FieldLabel htmlFor="placement-name">Placement name</FieldLabel>
            <Input
              id="placement-name"
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.currentTarget.value)}
              placeholder="Onboarding complete"
              value={field.state.value}
            />
            <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
          </Field>
        )}
      </form.Field>
      <form.Field
        name="key"
        validators={{
          onBlur: ({ value }) =>
            KEY_PATTERN.test(value.trim()) ? undefined : "Enter a valid Placement key.",
          onSubmit: ({ value }) =>
            KEY_PATTERN.test(value.trim()) ? undefined : "Enter a valid Placement key.",
        }}
      >
        {(field) => (
          <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
            <FieldLabel htmlFor="placement-key">Placement key</FieldLabel>
            <Input
              id="placement-key"
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.currentTarget.value.toLowerCase())}
              placeholder="onboarding_complete"
              value={field.state.value}
            />
            <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
          </Field>
        )}
      </form.Field>
      <form.Field name="paywallId">
        {(field) => (
          <Field>
            <FieldLabel htmlFor="placement-paywall">Default Paywall (optional)</FieldLabel>
            <select
              className="border-input bg-background h-8 rounded border px-2 text-sm"
              id="placement-paywall"
              onChange={(event) => field.handleChange(event.currentTarget.value)}
              value={field.state.value}
            >
              <option value="">No Paywall yet</option>
              {paywalls.map((paywall) => (
                <option key={paywall.id} value={paywall.id}>
                  {paywall.name}
                </option>
              ))}
            </select>
          </Field>
        )}
      </form.Field>
      <Button className="lg:mt-6" disabled={mutation.isPending} type="submit">
        {mutation.isPending
          ? "Creating…"
          : mutation.error instanceof PlacementCreatedWithoutBindingError
            ? "Retry binding"
            : "Create Placement"}
      </Button>
      {mutation.error ? (
        <div
          className="border-destructive/25 bg-destructive/5 rounded border p-3 lg:col-span-4"
          role="alert"
        >
          <p className="text-destructive text-sm">{mutation.error.message}</p>
          {mutation.error instanceof PlacementCreatedWithoutBindingError ? (
            <p className="text-muted-foreground mt-1 text-xs">
              The Placement is safe and appears below after refresh. Submit again to retry only its
              Environment binding.
            </p>
          ) : null}
        </div>
      ) : null}
    </form>
  )
}

export function PlacementsPage({
  environmentId,
  organizationId,
  projectId,
}: {
  environmentId: string
  organizationId: string
  projectId: string
}) {
  const adapter = useHostedPublishingAdapter()
  // These resources are independent and begin together; TanStack Query deduplicates shared reads.
  const placements = useQuery(placementsQueryOptions({ environmentId, projectId }, adapter))
  const paywalls = useQuery(paywallsQueryOptions(projectId, adapter))
  const items = placements.data ?? []
  const availablePaywalls = paywalls.data?.filter((paywall) => paywall.status === "active") ?? []
  const state = resolveHostedQueryState({
    emptyDescription: "",
    emptyTitle: "",
    error: placements.error ?? paywalls.error,
    // Emptiness is handled inside the page, not by the boundary: the create
    // form is the recovery action and must stay reachable with zero Placements.
    isEmpty: false,
    isPending: placements.isPending || paywalls.isPending,
    loadingDescription: "Loading Placements and Paywalls together.",
    onRetry: () => {
      void placements.refetch()
      void paywalls.refetch()
    },
    permissionAction: (
      <Link
        className={buttonVariants({ variant: "outline" })}
        params={{ environmentId, organizationId, projectId }}
        to="/organizations/$organizationId/projects/$projectId/monetization/$environmentId/paywalls"
      >
        Return to Paywalls
      </Link>
    ),
    permissionDescription: "Project membership is required to manage Placement bindings.",
  })

  return (
    <MonetizationWorkspace
      description="Use stable app intent keys with a compatible default decision, then add deterministic Rules when needed."
      environmentId={environmentId}
      organizationId={organizationId}
      projectId={projectId}
      surface="placements"
      title="Placements"
    >
      <HostedResourceBoundary state={state}>
        <>
          <WorkflowPanel
            description="This creates the stable key. An optional active Paywall preserves the simple default binding."
            title="Create Placement"
          >
            <CreatePlacementForm
              environmentId={environmentId}
              paywalls={availablePaywalls}
              projectId={projectId}
            />
          </WorkflowPanel>
          <WorkflowPanel title="Environment bindings">
            {items.length === 0 ? (
              <EmptyState
                description="Create the first app intent above to bind a Paywall to this Environment."
                title="No Placements yet"
              />
            ) : (
              <ul className="space-y-3">
                {items.map((placement) => (
                  <li className="rounded border p-4" key={placement.id}>
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-center">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">{placement.name}</p>
                        <p className="text-muted-foreground mt-1 font-mono text-xs">
                          {placement.key}
                        </p>
                        <p className="text-muted-foreground mt-2 text-xs">
                          {placement.binding
                            ? `Bound to ${placement.binding.paywallName}`
                            : "Binding is not confirmed in this browser session."}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-end gap-2">
                        {availablePaywalls.length > 0 ? (
                          <BindPlacementAction
                            environmentId={environmentId}
                            paywalls={availablePaywalls}
                            placement={placement}
                            projectId={projectId}
                          />
                        ) : (
                          <span className="text-muted-foreground text-xs">
                            Create a Paywall to select a compatible default.
                          </span>
                        )}
                        <Link
                          className={buttonVariants({ size: "sm", variant: "outline" })}
                          params={{
                            environmentId,
                            organizationId,
                            placementId: placement.id,
                            projectId,
                          }}
                          to="/organizations/$organizationId/projects/$projectId/monetization/$environmentId/placements/$placementId"
                        >
                          Open decision
                        </Link>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </WorkflowPanel>
        </>
      </HostedResourceBoundary>
    </MonetizationWorkspace>
  )
}
