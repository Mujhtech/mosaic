export interface WorkspaceScope {
  organizationId?: string
  projectId?: string
}

export function readWorkspaceScope(pathname: string): WorkspaceScope {
  const segments = pathname.split("/").filter(Boolean)
  const organizationIndex = segments.indexOf("organizations")
  const projectIndex = segments.indexOf("projects")

  return {
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
  return pathname.endsWith("/settings/api-keys")
}
