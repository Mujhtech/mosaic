import { useQuery } from "@tanstack/react-query"

import { detectNestedScopeMismatch } from "@/features/organizations/types/nested-scope"
import { projectQueryOptions } from "@/features/projects/queries/projects-query"

export function useValidatedProjectScope(organizationId: string, projectId: string) {
  const project = useQuery(projectQueryOptions(projectId))
  const scopeMismatch = detectNestedScopeMismatch({
    expectedOrganizationId: organizationId,
    expectedProjectId: projectId,
    project: project.data,
  })

  return {
    project,
    scopeMismatch,
    scopeReady: project.isSuccess && scopeMismatch === null,
  }
}
