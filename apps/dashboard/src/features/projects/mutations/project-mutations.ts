import { mutationOptions, type QueryClient } from "@tanstack/react-query";
import { projectKeys } from "@/features/projects/queries/projects-query";
import {
  archiveProject,
  type CreateApplicationRequest,
  type CreateProjectRequest,
  createApplication,
  createProject,
  restoreProject,
} from "@/generated/api";
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client";

export function createProjectMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: async (body: CreateProjectRequest) => {
      const result = await createProject({
        body,
        client: generatedDashboardClient,
        throwOnError: true,
      });
      return result.data.data;
    },
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: projectKeys.all }),
  });
}

export function createApplicationMutationOptions(
  projectId: string,
  queryClient: QueryClient
) {
  return mutationOptions({
    mutationFn: async (body: CreateApplicationRequest) => {
      const result = await createApplication({
        body,
        client: generatedDashboardClient,
        path: { projectId },
        throwOnError: true,
      });
      return result.data.data;
    },
    onSuccess: async () =>
      queryClient.invalidateQueries({
        queryKey: projectKeys.applications(projectId),
      }),
  });
}

export function projectLifecycleMutationOptions(
  queryClient: QueryClient,
  action: "archive" | "restore"
) {
  return mutationOptions({
    mutationFn: async (projectId: string) => {
      const request = action === "archive" ? archiveProject : restoreProject;
      const result = await request({
        client: generatedDashboardClient,
        path: { projectId },
        throwOnError: true,
      });
      return result.data.data;
    },
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: projectKeys.all }),
  });
}
