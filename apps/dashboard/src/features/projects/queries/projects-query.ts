import { queryOptions } from "@tanstack/react-query"

import { getProject, listApplications, listProjects } from "@/generated/api"
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client"

export const projectKeys = {
  all: ["projects"] as const,
  applications: (projectId: string) => ["projects", projectId, "applications"] as const,
  detail: (projectId: string) => ["projects", "detail", projectId] as const,
  list: (organizationId: string, status: "active" | "archived" = "active") =>
    ["projects", "list", organizationId, status] as const,
}

export function projectsQueryOptions(
  organizationId: string,
  status: "active" | "archived" = "active",
) {
  return queryOptions({
    queryKey: projectKeys.list(organizationId, status),
    queryFn: async ({ signal }) => {
      const result = await listProjects({
        client: generatedDashboardClient,
        query: { organizationId, status },
        signal,
        throwOnError: true,
      })
      return result.data.data
    },
  })
}

export function projectQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: projectKeys.detail(projectId),
    queryFn: async ({ signal }) => {
      const result = await getProject({
        client: generatedDashboardClient,
        path: { projectId },
        signal,
        throwOnError: true,
      })
      return result.data.data
    },
  })
}

export function applicationsQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: projectKeys.applications(projectId),
    queryFn: async ({ signal }) => {
      const result = await listApplications({
        client: generatedDashboardClient,
        path: { projectId },
        signal,
        throwOnError: true,
      })
      return result.data.data
    },
  })
}
