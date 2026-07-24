import type {
  ActiveProviderAssignment,
  Application,
  Environment,
  ProviderConnection,
  ProviderHealthStatus,
} from "@/generated/api"

export interface ActiveProviderAssignmentView {
  assignment: ActiveProviderAssignment
  connection?: ProviderConnection
}

export interface ActiveProviderScopeView {
  application: Application
  assignment?: ActiveProviderAssignmentView
  environment: Environment
}

export function activeProviderScopes(
  applications: readonly Application[],
  environment: Environment,
  assignments: readonly ActiveProviderAssignment[],
  connections: readonly ProviderConnection[],
): ActiveProviderScopeView[] {
  const assignmentByApplication = new Map(
    assignments
      .filter((assignment) => assignment.environmentId === environment.id)
      .map((assignment) => [
        assignment.applicationId,
        {
          assignment,
          connection: connections.find((connection) => connection.id === assignment.connectionId),
        } satisfies ActiveProviderAssignmentView,
      ]),
  )

  return applications.map((application) => ({
    application,
    assignment: assignmentByApplication.get(application.id),
    environment,
  }))
}

export function providerCredentialActions(
  connection: Pick<ProviderConnection, "lastErrorCode" | "status">,
  healthStatus: ProviderHealthStatus,
): { reconnect: boolean; rotate: boolean } {
  const recoveryErrors = new Set([
    "credentialExpired",
    "credentialInvalid",
    "permissionDenied",
    "providerUnavailable",
  ])
  const revoked = connection.status === "revoked"
  return {
    reconnect:
      revoked ||
      healthStatus === "degraded" ||
      healthStatus === "unavailable" ||
      Boolean(connection.lastErrorCode && recoveryErrors.has(connection.lastErrorCode)),
    rotate: !revoked,
  }
}
