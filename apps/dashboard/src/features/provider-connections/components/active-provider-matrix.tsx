import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr/WarningCircle"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { ScopeBadge } from "@/features/organizations/components/workspace-page"
import {
  clearActiveProviderMutationOptions,
  setActiveProviderMutationOptions,
} from "@/features/provider-connections/mutations/provider-connection-mutations"
import { providerAssignmentImpactQueryOptions } from "@/features/provider-connections/queries/provider-connection-queries"
import { activeProviderScopes } from "@/features/provider-connections/types/provider-connection-view"
import { environmentMatchesConnectionMode } from "@/features/provider-connections/types/provider-operation-input"
import type {
  ActiveProviderAssignment,
  Application,
  Environment,
  ProviderConnection,
} from "@/generated/api"

export function ActiveProviderMatrix({
  applications,
  assignments,
  connections,
  environment,
  managementEnabled = false,
  organizationId,
  projectId,
}: {
  applications: readonly Application[]
  assignments: readonly ActiveProviderAssignment[]
  connections: readonly ProviderConnection[]
  environment: Environment
  managementEnabled?: boolean
  organizationId?: string
  projectId?: string
}) {
  const scopes = activeProviderScopes(applications, environment, assignments, connections)

  if (scopes.length === 0) {
    return (
      <div className="border-border rounded border border-dashed p-5">
        <p className="text-sm font-semibold">Register an Application first</p>
        <p className="text-muted-foreground mt-1 text-sm leading-6">
          Active providers are selected for one Environment and one concrete iOS or Android
          Application. Mosaic never guesses a provider from Product identifiers.
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-2xl border-separate border-spacing-0 text-left text-sm">
        <caption className="sr-only">
          Active commerce provider assignments for {environment.name}
        </caption>
        <thead>
          <tr className="text-muted-foreground">
            <th className="border-b px-3 py-2 font-medium" scope="col">
              Application
            </th>
            <th className="border-b px-3 py-2 font-medium" scope="col">
              Platform
            </th>
            <th className="border-b px-3 py-2 font-medium" scope="col">
              Active provider
            </th>
            <th className="border-b px-3 py-2 font-medium" scope="col">
              Connection state
            </th>
            <th className="border-b px-3 py-2 text-right font-medium" scope="col">
              Action
            </th>
          </tr>
        </thead>
        <tbody>
          {scopes.map(({ application, assignment: assignmentView }) => (
            <tr key={application.id}>
              <th className="border-b px-3 py-3 font-medium" scope="row">
                <span className="block">{application.name}</span>
                <span className="text-muted-foreground mt-0.5 block font-mono text-xs">
                  {application.identifier}
                </span>
              </th>
              <td className="border-b px-3 py-3">
                <ScopeBadge>{application.platform.toUpperCase()}</ScopeBadge>
              </td>
              <td className="border-b px-3 py-3">
                {assignmentView ? (
                  <div>
                    <p className="font-medium">
                      {assignmentView.connection?.name ?? assignmentView.assignment.connectionId}
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {assignmentView.connection
                        ? `${assignmentView.connection.provider === "revenuecat" ? "RevenueCat" : "Custom provider"} · ${assignmentView.connection.integrationMode === "sdk_only" ? "SDK-only" : "Server-connected"} · ${assignmentView.connection.mode}`
                        : "Connection metadata unavailable"}
                    </p>
                  </div>
                ) : (
                  <p className="flex items-center gap-1.5 font-medium">
                    <WarningCircleIcon aria-hidden className="text-destructive" size={16} />
                    Not selected
                  </p>
                )}
              </td>
              <td className="text-muted-foreground border-b px-3 py-3 text-xs">
                {assignmentView?.connection
                  ? `${assignmentView.connection.status} · ${assignmentView.connection.healthStatus}`
                  : assignmentView
                    ? "Assignment references an unavailable connection"
                    : "No active assignment"}
              </td>
              <td className="border-b px-3 py-3 text-right">
                {managementEnabled ? (
                  <ProviderAssignmentControl
                    application={application}
                    connections={connections}
                    currentConnectionId={assignmentView?.assignment.connectionId}
                    environment={environment}
                    organizationId={organizationId ?? ""}
                    projectId={projectId ?? environment.projectId}
                  />
                ) : (
                  <Button disabled size="sm" type="button" variant="outline">
                    {assignmentView ? "Review replacement" : "Select provider"}
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!managementEnabled ? (
        <p className="text-muted-foreground mt-3 text-xs leading-5">
          Assignment changes remain disabled in this package. Persisted assignments are shown
          read-only; replacement will require an explicit impact review.
        </p>
      ) : null}
    </div>
  )
}

function ProviderAssignmentControl({
  application,
  connections,
  currentConnectionId,
  environment,
  organizationId,
  projectId,
}: {
  application: Application
  connections: readonly ProviderConnection[]
  currentConnectionId?: string
  environment: Environment
  organizationId: string
  projectId: string
}) {
  const queryClient = useQueryClient()
  const [selectedConnectionId, setSelectedConnectionId] = useState(currentConnectionId ?? "")
  const [reviewAction, setReviewAction] = useState<"clear" | "set" | null>(null)
  const setProvider = useMutation(
    setActiveProviderMutationOptions(application.id, environment.id, projectId, queryClient),
  )
  const clearProvider = useMutation(
    clearActiveProviderMutationOptions(application.id, environment.id, projectId, queryClient),
  )
  const available = connections.filter(
    (connection) =>
      connection.status === "active" &&
      connection.healthStatus === "healthy" &&
      connection.environmentIds.includes(environment.id) &&
      connection.applicationIds.includes(application.id) &&
      environmentMatchesConnectionMode(environment.mode, connection.mode),
  )
  const selected = available.find((connection) => connection.id === selectedConnectionId)
  const unavailableCount = connections.length - available.length
  const current = connections.find((connection) => connection.id === currentConnectionId)
  const impact = useQuery({
    ...providerAssignmentImpactQueryOptions({
      applicationId: application.id,
      connectionId: current?.id ?? "unassigned",
      environmentId: environment.id,
      projectId,
    }),
    enabled: Boolean(reviewAction && current),
  })
  const mutation = reviewAction === "clear" ? clearProvider : setProvider
  const impactRequired = Boolean(current)
  const canConfirmImpact = !impactRequired || impact.isSuccess
  const catalogHref = `/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/catalog/products`
  const providersHref = `/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/catalog/providers`

  if (reviewAction && (reviewAction === "clear" || selected)) {
    const isClearing = reviewAction === "clear"
    return (
      <div className="ml-auto max-w-xs rounded border p-3 text-left">
        <p className="text-xs font-semibold">
          {isClearing
            ? `Clear ${current?.name ?? "active provider"}`
            : current
              ? `Replace ${current.name}`
              : "Select active provider"}
        </p>
        <p className="text-muted-foreground mt-1 text-xs leading-5">
          {isClearing
            ? `Clearing this assignment leaves ${application.name} without a commerce provider in ${environment.name}. New publishing will fail readiness and SDK configuration cannot resolve connected Product metadata until another healthy provider is selected.`
            : `${current ? `${current.name} → ${selected?.name}. ` : ""}This changes provider resolution for ${application.name} in ${environment.name}. Published history remains immutable; new publishing readiness and SDK configuration use this explicit assignment.`}
        </p>
        {impactRequired && impact.isPending ? (
          <p className="text-muted-foreground mt-2 text-xs" role="status">
            Calculating affected Products and active Paywalls…
          </p>
        ) : null}
        {impactRequired && impact.isError ? (
          <div className="border-destructive/40 mt-2 rounded border p-2">
            <p className="text-destructive text-xs" role="alert">
              Impact could not be loaded. Confirmation remains disabled.
            </p>
            <Button
              className="mt-2"
              onClick={() => void impact.refetch()}
              size="sm"
              type="button"
              variant="outline"
            >
              Retry impact
            </Button>
          </div>
        ) : null}
        {impact.data ? (
          <div className="bg-muted/50 mt-2 rounded p-2 text-xs leading-5">
            <p className="font-medium">
              {impact.data.products.length} affected Product
              {impact.data.products.length === 1 ? "" : "s"} · {impact.data.paywalls.length} active
              Paywall{impact.data.paywalls.length === 1 ? "" : "s"}
            </p>
            {impact.data.products.length > 0 ? (
              <p className="text-muted-foreground">
                Products: {impact.data.products.map((product) => product.internalName).join(", ")}
              </p>
            ) : null}
            {impact.data.paywalls.length > 0 ? (
              <p className="text-muted-foreground">
                Paywalls: {impact.data.paywalls.map((paywall) => paywall.name).join(", ")}
              </p>
            ) : null}
            <a className="text-primary font-medium hover:underline" href={catalogHref}>
              Review affected Products
            </a>
          </div>
        ) : null}
        {mutation.error ? (
          <p className="text-destructive mt-2 text-xs" role="alert">
            {mutation.error.message}
          </p>
        ) : null}
        <div className="mt-3 flex gap-2">
          <Button
            disabled={mutation.isPending || !canConfirmImpact}
            onClick={() => {
              if (isClearing) {
                clearProvider.mutate(undefined, { onSuccess: () => setReviewAction(null) })
                return
              }
              if (!selected) return
              setProvider.mutate(
                {
                  acknowledgeProductionConnectionUse: false,
                  connectionId: selected.id,
                },
                { onSuccess: () => setReviewAction(null) },
              )
            }}
            size="sm"
            type="button"
          >
            {mutation.isPending ? "Saving…" : isClearing ? "Confirm clear" : "Confirm selection"}
          </Button>
          <Button
            disabled={mutation.isPending}
            onClick={() => setReviewAction(null)}
            size="sm"
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="ml-auto max-w-xs text-right">
      <div className="flex items-center justify-end gap-2">
        <select
          aria-label={`Provider for ${application.name}`}
          className="border-input bg-background h-8 min-w-36 rounded border px-2 text-xs"
          onChange={(event) => setSelectedConnectionId(event.currentTarget.value)}
          value={selectedConnectionId}
        >
          <option value="">Select provider</option>
          {available.map((connection) => (
            <option key={connection.id} value={connection.id}>
              {connection.name}
            </option>
          ))}
        </select>
        <Button
          disabled={!selected || selected.id === currentConnectionId}
          onClick={() => setReviewAction("set")}
          size="sm"
          type="button"
          variant="outline"
        >
          Review impact
        </Button>
        {current ? (
          <Button
            onClick={() => setReviewAction("clear")}
            size="sm"
            type="button"
            variant="outline"
          >
            Clear provider
          </Button>
        ) : null}
      </div>
      {unavailableCount > 0 ? (
        <p className="text-muted-foreground mt-2 text-xs">
          {unavailableCount} connection(s) are hidden because their mode, scope, health, or status
          is incompatible.{" "}
          <a className="text-primary font-semibold" href={providersHref}>
            Review and recover connections
          </a>
        </p>
      ) : null}
    </div>
  )
}
