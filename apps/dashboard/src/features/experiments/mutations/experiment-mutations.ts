import { mutationOptions, type QueryClient } from "@tanstack/react-query";

import type { ExperimentAdapter } from "../api/experiment-adapter";
import { experimentKeys } from "../queries/experiment-queries";
import type {
  CreateMutualExclusionGroupInput,
  ExperimentDraftDocument,
  ExperimentScope,
  ExperimentStatus,
  QaOverride,
} from "../types/experiment";

async function invalidateExperiment(
  queryClient: QueryClient,
  scope: ExperimentScope,
  experimentId?: string
) {
  await queryClient.invalidateQueries({ queryKey: experimentKeys.list(scope) });
  if (experimentId) {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: experimentKeys.detail(scope, experimentId),
      }),
      queryClient.invalidateQueries({
        queryKey: experimentKeys.history(scope, experimentId),
      }),
      queryClient.invalidateQueries({
        queryKey: experimentKeys.results(scope, experimentId),
      }),
    ]);
  }
}

export function createExperimentMutationOptions(
  scope: ExperimentScope,
  adapter: ExperimentAdapter,
  queryClient: QueryClient
) {
  return mutationOptions({
    mutationFn: (input: {
      hypothesis?: string;
      name: string;
      placementId: string;
    }) => adapter.create(scope, input),
    onSuccess: (experiment) =>
      invalidateExperiment(queryClient, scope, experiment.id),
  });
}

export function createExperimentGroupMutationOptions(
  scope: ExperimentScope,
  adapter: ExperimentAdapter,
  queryClient: QueryClient
) {
  return mutationOptions({
    mutationFn: (input: CreateMutualExclusionGroupInput) =>
      adapter.createMutualExclusionGroup(scope, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: experimentKeys.all });
    },
  });
}

export function createExperimentGroupVersionMutationOptions(
  scope: ExperimentScope,
  groupId: string,
  adapter: ExperimentAdapter,
  queryClient: QueryClient
) {
  return mutationOptions({
    mutationFn: (input: Omit<CreateMutualExclusionGroupInput, "name">) =>
      adapter.createMutualExclusionGroupVersion(scope, groupId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: experimentKeys.all });
    },
  });
}

export function saveExperimentDraftMutationOptions(
  scope: ExperimentScope,
  experimentId: string,
  adapter: ExperimentAdapter,
  queryClient: QueryClient
) {
  return mutationOptions({
    mutationFn: (input: {
      document: ExperimentDraftDocument;
      expectedRevision: number;
    }) =>
      adapter.saveDraft(
        scope,
        experimentId,
        input.document,
        input.expectedRevision
      ),
    onSuccess: async () => {
      await invalidateExperiment(queryClient, scope, experimentId);
    },
  });
}

export function validateExperimentMutationOptions(
  scope: ExperimentScope,
  experimentId: string,
  adapter: ExperimentAdapter
) {
  return mutationOptions({
    mutationFn: () => adapter.validate(scope, experimentId),
  });
}

export function publishExperimentMutationOptions(
  scope: ExperimentScope,
  experimentId: string,
  adapter: ExperimentAdapter,
  queryClient: QueryClient
) {
  return mutationOptions({
    mutationFn: (expectedRevision: number) =>
      adapter.publish(scope, experimentId, expectedRevision),
    onSuccess: () => invalidateExperiment(queryClient, scope, experimentId),
  });
}

export function transitionExperimentMutationOptions(
  scope: ExperimentScope,
  experimentId: string,
  adapter: ExperimentAdapter,
  queryClient: QueryClient
) {
  return mutationOptions({
    mutationFn: (input: { reason: string; target: ExperimentStatus }) =>
      (() => {
        if (input.target === "archived") {
          return adapter.archive(scope, experimentId, input.reason);
        }
        if (input.target === "completed") {
          return adapter.complete(scope, experimentId, input.reason);
        }
        return adapter.transition(
          scope,
          experimentId,
          input.target,
          input.reason
        );
      })(),
    onSuccess: () => invalidateExperiment(queryClient, scope, experimentId),
  });
}

export function emergencyStopMutationOptions(
  scope: ExperimentScope,
  experimentId: string,
  adapter: ExperimentAdapter,
  queryClient: QueryClient
) {
  return mutationOptions({
    mutationFn: (reason: string) =>
      adapter.emergencyStop(scope, experimentId, reason),
    onSuccess: () => invalidateExperiment(queryClient, scope, experimentId),
  });
}

export function createQaOverrideMutationOptions(
  scope: ExperimentScope,
  experimentId: string,
  adapter: ExperimentAdapter,
  queryClient: QueryClient
) {
  return mutationOptions({
    mutationFn: (input: {
      expiresAt: string;
      experimentVersionId: string;
      identityType: QaOverride["identityType"];
      label: string;
      variantId: string;
    }) => adapter.createQaOverride(scope, experimentId, input),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: experimentKeys.qa(scope, experimentId),
      }),
  });
}

export function deleteQaOverrideMutationOptions(
  scope: ExperimentScope,
  experimentId: string,
  adapter: ExperimentAdapter,
  queryClient: QueryClient
) {
  return mutationOptions({
    mutationFn: (overrideId: string) =>
      adapter.deleteQaOverride(scope, experimentId, overrideId),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: experimentKeys.qa(scope, experimentId),
      }),
  });
}

export function exportExperimentMutationOptions(
  scope: ExperimentScope,
  experimentId: string,
  adapter: ExperimentAdapter
) {
  return mutationOptions({
    mutationFn: (identityScoped: boolean) =>
      adapter.requestExport(scope, experimentId, identityScoped),
  });
}
