import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr/WarningCircle"

import { Button } from "@/components/ui/button"
import { ScopeBadge } from "@/features/organizations/components/workspace-page"
import { activeProviderScopes } from "@/features/provider-connections/types/provider-connection-view"
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
}: {
  applications: readonly Application[]
  assignments: readonly ActiveProviderAssignment[]
  connections: readonly ProviderConnection[]
  environment: Environment
  managementEnabled?: boolean
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
                <Button disabled={!managementEnabled} size="sm" type="button" variant="outline">
                  {assignmentView ? "Review replacement" : "Select provider"}
                </Button>
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
