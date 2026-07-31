export interface WorkspaceScope {
  /**
   * The Environment as the address names it: the alias under `/env`, e.g. `prod`.
   * Resolving it to an Environment is useActiveEnvironment's job, because only the
   * Project's own Environment list can say whether the segment means anything.
   */
  environmentSegment?: string
  organizationId?: string
  projectId?: string
}

export function readWorkspaceScope(pathname: string): WorkspaceScope {
  const segments = pathname.split("/").filter(Boolean)
  const organizationIndex = segments.indexOf("orgs")
  const projectIndex = segments.indexOf("projects")
  const environmentIndex = segments.indexOf("env")

  return {
    environmentSegment: environmentIndex >= 0 ? segments[environmentIndex + 1] : undefined,
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

/** Every surface under a Project now names an Environment, uniformly, under `/env`. */
export function isEnvironmentSurface(pathname: string) {
  return pathname.includes("/env/")
}
