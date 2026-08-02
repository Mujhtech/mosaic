import { mutationOptions, type QueryClient } from "@tanstack/react-query";
import { invalidateCatalogImpact } from "@/features/catalog/mutations/catalog-impact";
import { catalogKeys } from "@/features/catalog/queries/catalog-query";
import { providerConnectionKeys } from "@/features/provider-connections/queries/provider-connection-queries";
import type {
  ProviderImportResultView,
  ProviderProductImportSelection,
} from "@/features/provider-connections/types/provider-catalog-import";
import type {
  CreateRevenueCatConnectionInput,
  ReplaceProviderCredentialInput,
} from "@/features/provider-connections/types/provider-operation-input";
import {
  clearActiveProviderAssignment,
  createProviderConnection,
  enqueueProviderSync,
  importProviderProducts,
  type ProviderConnection,
  type ProviderImportRequest,
  reconnectProviderConnection,
  revokeProviderConnection,
  rotateProviderCredential,
  type SetProviderAssignmentRequest,
  setActiveProviderAssignment,
  testProviderConnection,
} from "@/generated/api";
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client";

export class ProviderConnectionCreatedButTestFailed extends Error {
  readonly connection: ProviderConnection;

  constructor(connection: ProviderConnection, cause?: unknown) {
    super(
      `Connection “${connection.name}” was created, but its first test failed. Open the connection to retry or rotate its credential.`,
      { cause }
    );
    this.name = "ProviderConnectionCreatedButTestFailed";
    this.connection = connection;
  }
}

async function invalidateConnection(
  queryClient: QueryClient,
  connectionId: string,
  projectId: string
) {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: providerConnectionKeys.list(projectId),
    }),
    queryClient.invalidateQueries({
      queryKey: providerConnectionKeys.detail(connectionId),
    }),
    queryClient.invalidateQueries({
      queryKey: providerConnectionKeys.health(connectionId),
    }),
    queryClient.invalidateQueries({
      queryKey: providerConnectionKeys.capabilities(connectionId),
    }),
    queryClient.invalidateQueries({
      queryKey: providerConnectionKeys.diagnostics(connectionId),
    }),
  ]);
}

export function createAndTestRevenueCatMutationOptions(
  projectId: string,
  queryClient: QueryClient
) {
  return mutationOptions({
    mutationFn: async (input: CreateRevenueCatConnectionInput) => {
      const created = await createProviderConnection({
        body: {
          applicationIds: input.applicationIds,
          credential: input.credential,
          environmentIds: input.environmentIds,
          externalProjectId: input.externalProjectId,
          integrationMode: "server_connected",
          mode: input.mode,
          name: input.name,
          provider: "revenuecat",
        },
        client: generatedDashboardClient,
        path: { projectId },
        throwOnError: true,
      });
      const connection = created.data.data;
      try {
        const tested = await testProviderConnection({
          client: generatedDashboardClient,
          path: { connectionId: connection.id },
          throwOnError: true,
        });
        return { connection, health: tested.data.data };
      } catch (error) {
        // biome-ignore lint/style/useErrorCause: ProviderConnectionCreatedButTestFailed chains the cause through its constructor
        throw new ProviderConnectionCreatedButTestFailed(connection, error);
      }
    },
    onSettled: async (result, error) => {
      const connection =
        result?.connection ??
        (error instanceof ProviderConnectionCreatedButTestFailed
          ? error.connection
          : undefined);
      if (connection) {
        await invalidateConnection(queryClient, connection.id, projectId);
      }
    },
  });
}

export function testProviderConnectionMutationOptions(
  connectionId: string,
  projectId: string,
  queryClient: QueryClient
) {
  return mutationOptions({
    mutationFn: async () => {
      const result = await testProviderConnection({
        client: generatedDashboardClient,
        path: { connectionId },
        throwOnError: true,
      });
      return result.data.data;
    },
    onSettled: async () =>
      invalidateConnection(queryClient, connectionId, projectId),
  });
}

export function replaceProviderCredentialMutationOptions(
  action: "reconnect" | "rotate",
  connectionId: string,
  projectId: string,
  queryClient: QueryClient
) {
  return mutationOptions({
    mutationFn: async (input: ReplaceProviderCredentialInput) => {
      const request =
        action === "rotate"
          ? rotateProviderCredential
          : reconnectProviderConnection;
      const result = await request({
        body: input,
        client: generatedDashboardClient,
        path: { connectionId },
        throwOnError: true,
      });
      return result.data.data;
    },
    onSettled: async () =>
      invalidateConnection(queryClient, connectionId, projectId),
  });
}

export function revokeProviderConnectionMutationOptions(
  connectionId: string,
  projectId: string,
  queryClient: QueryClient
) {
  return mutationOptions({
    mutationFn: async () => {
      const result = await revokeProviderConnection({
        client: generatedDashboardClient,
        path: { connectionId },
        throwOnError: true,
      });
      return result.data.data;
    },
    onSettled: async () =>
      invalidateConnection(queryClient, connectionId, projectId),
  });
}

export function enqueueProviderSyncMutationOptions(
  connectionId: string,
  projectId: string,
  queryClient: QueryClient
) {
  return mutationOptions({
    mutationFn: async () => {
      const result = await enqueueProviderSync({
        client: generatedDashboardClient,
        path: { connectionId },
        throwOnError: true,
      });
      return result.data.data;
    },
    onSettled: async () => {
      await Promise.all([
        invalidateConnection(queryClient, connectionId, projectId),
        queryClient.invalidateQueries({
          queryKey: providerConnectionKeys.syncRuns(connectionId),
        }),
      ]);
    },
  });
}

export function importProviderProductsMutationOptions(
  connectionId: string,
  projectId: string,
  queryClient: QueryClient
) {
  return mutationOptions({
    mutationFn: async ({
      idempotencyKey,
      items,
    }: {
      idempotencyKey: string;
      items: ProviderProductImportSelection[];
    }): Promise<ProviderImportResultView> => {
      const body: ProviderImportRequest = { connectionId, items };
      const result = await importProviderProducts({
        body,
        client: generatedDashboardClient,
        headers: { "Idempotency-Key": idempotencyKey },
        path: { projectId },
        throwOnError: true,
      });
      return {
        id: result.data.data.import.id,
        items: result.data.data.items,
        status: result.data.data.import.status,
      };
    },
    onSuccess: async (result) => {
      await Promise.all([
        invalidateCatalogImpact(queryClient, {
          productIds: result.items.flatMap((item) =>
            item.mosaicProductId ? [item.mosaicProductId] : []
          ),
          projectId,
        }),
        queryClient.invalidateQueries({
          queryKey: providerConnectionKeys.catalogPreview(connectionId),
        }),
      ]);
    },
  });
}

export function setActiveProviderMutationOptions(
  applicationId: string,
  environmentId: string,
  projectId: string,
  queryClient: QueryClient
) {
  return mutationOptions({
    mutationFn: async (body: SetProviderAssignmentRequest) => {
      const result = await setActiveProviderAssignment({
        body,
        client: generatedDashboardClient,
        path: { applicationId, environmentId },
        throwOnError: true,
      });
      return result.data.data;
    },
    onSuccess: async () =>
      invalidateActiveProviderImpact(
        applicationId,
        environmentId,
        projectId,
        queryClient
      ),
  });
}

export function clearActiveProviderMutationOptions(
  applicationId: string,
  environmentId: string,
  projectId: string,
  queryClient: QueryClient
) {
  return mutationOptions({
    mutationFn: async () => {
      await clearActiveProviderAssignment({
        client: generatedDashboardClient,
        path: { applicationId, environmentId },
        throwOnError: true,
      });
    },
    onSuccess: async () =>
      invalidateActiveProviderImpact(
        applicationId,
        environmentId,
        projectId,
        queryClient
      ),
  });
}

export async function invalidateActiveProviderImpact(
  applicationId: string,
  environmentId: string,
  projectId: string,
  queryClient: QueryClient
) {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: providerConnectionKeys.activeAssignment(
        environmentId,
        applicationId
      ),
    }),
    queryClient.invalidateQueries({ queryKey: catalogKeys.all(projectId) }),
  ]);
}
