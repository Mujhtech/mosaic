export interface WorkspaceScope {
  environmentId?: string
  organizationId?: string
  projectId?: string
}

export function readWorkspaceScope(pathname: string): WorkspaceScope {
  const segments = pathname.split("/").filter(Boolean)
  const organizationIndex = segments.indexOf("organizations")
  const projectIndex = segments.indexOf("projects")
  const monetizationIndex = segments.indexOf("monetization")
  const analyticsIndex = segments.indexOf("analytics")
  const billingIndex = segments.indexOf("billing")

  return {
    environmentId:
      monetizationIndex >= 0
        ? segments[monetizationIndex + 1]
        : analyticsIndex >= 0
          ? segments[analyticsIndex + 1]
          : billingIndex >= 0
            ? segments[billingIndex + 1]
            : undefined,
    organizationId:
      organizationIndex >= 0 && segments[organizationIndex + 1] !== "new"
        ? segments[organizationIndex + 1]
        : undefined,
    projectId:
      projectIndex >= 0 && segments[projectIndex + 1] !== "new"
        ? segments[projectIndex + 1]
        : undefined,
  }
}

export function isProjectWideSurface(pathname: string) {
  return pathname.includes("/apps") || pathname.includes("/catalog/")
}

export function isEnvironmentSurface(pathname: string) {
  return (
    pathname.endsWith("/settings/api-keys") ||
    pathname.includes("/monetization/") ||
    pathname.includes("/analytics/") ||
    pathname.includes("/billing/")
  )
}
