interface ProjectScopeRecord {
  id: string
  organizationId: string
}

interface ResourceScopeRecord {
  id: string
  projectId: string
}

interface NestedScopeInput {
  expectedOrganizationId: string
  expectedProjectId: string
  expectedResourceId?: string
  project?: ProjectScopeRecord
  resource?: ResourceScopeRecord
}

export type NestedScopeMismatch = "project" | "resource" | null

export function detectNestedScopeMismatch({
  expectedOrganizationId,
  expectedProjectId,
  expectedResourceId,
  project,
  resource,
}: NestedScopeInput): NestedScopeMismatch {
  if (
    project &&
    (project.id !== expectedProjectId || project.organizationId !== expectedOrganizationId)
  ) {
    return "project"
  }

  if (
    resource &&
    (resource.projectId !== expectedProjectId ||
      (expectedResourceId !== undefined && resource.id !== expectedResourceId))
  ) {
    return "resource"
  }

  return null
}
