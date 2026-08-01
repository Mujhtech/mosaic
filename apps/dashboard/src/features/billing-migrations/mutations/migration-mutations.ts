import { mutationOptions, type QueryClient } from "@tanstack/react-query";
import { migrationKeys } from "@/features/billing-migrations/queries/migration-queries";
import {
  approveBillingMigrationLegalHold,
  approveBillingMigrationProposal,
  assessBillingMigrationReadiness,
  type BillingMigrationCheckpointRequest,
  type BillingMigrationCompletionRequest,
  type BillingMigrationCredentialRemovalRequest,
  type BillingMigrationCutoverExecutionRequest,
  type BillingMigrationCutoverProposalRequest,
  type BillingMigrationLegalHoldApprovalRequest,
  type BillingMigrationLegalHoldProposalRequest,
  type BillingMigrationObserveStabilizationRequest,
  type BillingMigrationRedeliveryRequest,
  type BillingMigrationRepairExecutionRequest,
  type BillingMigrationRepairPreviewRequest,
  type BillingMigrationRollbackExecutionRequest,
  type BillingMigrationRollbackProposalRequest,
  type BillingMigrationStateVersionRequest,
  type CreateBillingMigrationImportBatchRequest,
  type CreateBillingMigrationMappingSetRequest,
  type CreateBillingMigrationProgramRequestWritable,
  completeBillingMigration,
  createBillingMigrationCheckpoint,
  createBillingMigrationImportBatch,
  createBillingMigrationMappingSet,
  createBillingMigrationProgram,
  executeBillingMigrationCutover,
  executeBillingMigrationRepair,
  executeBillingMigrationRollback,
  freezeBillingMigrationMappingSet,
  observeBillingMigrationStabilization,
  previewBillingMigrationRepair,
  proposeBillingMigrationCutover,
  proposeBillingMigrationLegalHold,
  proposeBillingMigrationRollback,
  type QueueBillingMigrationRunRequest,
  queueBillingMigrationDryRun,
  queueBillingMigrationShadowRun,
  redeliverBillingMigrationWebhook,
  removeBillingMigrationCredential,
} from "@/generated/api";
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client";

export function createMigrationCommandKey() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `mosaic-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type LifecycleCommand =
  | { kind: "propose_cutover"; body: BillingMigrationCutoverProposalRequest }
  | {
      kind: "approve_proposal";
      proposalId: string;
      body: BillingMigrationStateVersionRequest;
    }
  | { kind: "create_checkpoint"; body: BillingMigrationCheckpointRequest }
  | { kind: "execute_cutover"; body: BillingMigrationCutoverExecutionRequest }
  | { kind: "propose_rollback"; body: BillingMigrationRollbackProposalRequest }
  | { kind: "execute_rollback"; body: BillingMigrationRollbackExecutionRequest }
  | {
      kind: "observe_stabilization";
      body: BillingMigrationObserveStabilizationRequest;
    }
  | { kind: "preview_repair"; body: BillingMigrationRepairPreviewRequest }
  | { kind: "execute_repair"; body: BillingMigrationRepairExecutionRequest }
  | { kind: "redeliver_webhook"; body: BillingMigrationRedeliveryRequest }
  | {
      kind: "remove_credential";
      body: BillingMigrationCredentialRemovalRequest;
    }
  | {
      kind: "propose_legal_hold";
      body: BillingMigrationLegalHoldProposalRequest;
    }
  | {
      kind: "approve_legal_hold";
      proposalId: string;
      body: BillingMigrationLegalHoldApprovalRequest;
    }
  | { kind: "complete"; body: BillingMigrationCompletionRequest };

export function migrationLifecycleMutationOptions(
  projectId: string,
  programId: string,
  queryClient: QueryClient
) {
  return mutationOptions({
    mutationFn: async ({
      command,
      idempotencyKey,
    }: {
      command: LifecycleCommand;
      idempotencyKey: string;
    }) => {
      const common = {
        client: generatedDashboardClient,
        headers: { "Idempotency-Key": idempotencyKey },
        path: { programId, projectId },
        throwOnError: true,
      } as const;
      switch (command.kind) {
        case "propose_cutover":
          return (
            await proposeBillingMigrationCutover({
              ...common,
              body: command.body,
            })
          ).data.data.payload;
        case "approve_proposal":
          return (
            await approveBillingMigrationProposal({
              ...common,
              body: command.body,
              path: { ...common.path, proposalId: command.proposalId },
            })
          ).data.data.payload;
        case "create_checkpoint":
          return (
            await createBillingMigrationCheckpoint({
              ...common,
              body: command.body,
            })
          ).data.data.payload;
        case "execute_cutover":
          return (
            await executeBillingMigrationCutover({
              ...common,
              body: command.body,
            })
          ).data.data.payload;
        case "propose_rollback":
          return (
            await proposeBillingMigrationRollback({
              ...common,
              body: command.body,
            })
          ).data.data.payload;
        case "execute_rollback":
          return (
            await executeBillingMigrationRollback({
              ...common,
              body: command.body,
            })
          ).data.data.payload;
        case "observe_stabilization":
          return (
            await observeBillingMigrationStabilization({
              ...common,
              body: command.body,
            })
          ).data.data.payload;
        case "preview_repair":
          return (
            await previewBillingMigrationRepair({
              ...common,
              body: command.body,
            })
          ).data.data.payload;
        case "execute_repair":
          return (
            await executeBillingMigrationRepair({
              ...common,
              body: command.body,
            })
          ).data.data.payload;
        case "redeliver_webhook":
          return (
            await redeliverBillingMigrationWebhook({
              ...common,
              body: command.body,
            })
          ).data.data.payload;
        case "remove_credential":
          return (
            await removeBillingMigrationCredential({
              ...common,
              body: command.body,
            })
          ).data.data.payload;
        case "propose_legal_hold":
          return (
            await proposeBillingMigrationLegalHold({
              ...common,
              body: command.body,
            })
          ).data.data.payload;
        case "approve_legal_hold":
          return (
            await approveBillingMigrationLegalHold({
              ...common,
              body: command.body,
              path: { ...common.path, proposalId: command.proposalId },
            })
          ).data.data.payload;
        case "complete":
          return (
            await completeBillingMigration({ ...common, body: command.body })
          ).data.data.payload;
        default: {
          const unhandled: never = command;
          throw new Error(
            `Unhandled command.kind: ${JSON.stringify(unhandled)}`
          );
        }
      }
    },
    onSettled: async () => {
      await refreshProgram(queryClient, projectId, programId);
      await queryClient.invalidateQueries({
        queryKey: migrationKeys.lifecycle(projectId, programId),
      });
    },
  });
}

async function refreshProgram(
  queryClient: QueryClient,
  projectId: string,
  programId?: string
) {
  await queryClient.invalidateQueries({
    queryKey: migrationKeys.project(projectId),
  });
  if (programId) {
    await queryClient.invalidateQueries({
      queryKey: migrationKeys.program(projectId, programId),
    });
  }
}

export function createMigrationProgramMutationOptions(
  projectId: string,
  queryClient: QueryClient
) {
  return mutationOptions({
    gcTime: 0,
    mutationFn: async ({
      body,
      idempotencyKey,
    }: {
      body: CreateBillingMigrationProgramRequestWritable;
      idempotencyKey: string;
    }) => {
      const result = await createBillingMigrationProgram({
        body,
        client: generatedDashboardClient,
        headers: { "Idempotency-Key": idempotencyKey },
        path: { projectId },
        throwOnError: true,
      });
      return result.data.data.payload.program;
    },
    onSuccess: () => refreshProgram(queryClient, projectId),
  });
}

export function createMigrationMappingMutationOptions(
  projectId: string,
  programId: string,
  queryClient: QueryClient
) {
  return mutationOptions({
    mutationFn: async (body: CreateBillingMigrationMappingSetRequest) => {
      const result = await createBillingMigrationMappingSet({
        body,
        client: generatedDashboardClient,
        path: { programId, projectId },
        throwOnError: true,
      });
      return result.data.data.payload;
    },
    onSettled: () => refreshProgram(queryClient, projectId, programId),
  });
}

export function freezeMigrationMappingMutationOptions(
  projectId: string,
  programId: string,
  queryClient: QueryClient
) {
  return mutationOptions({
    mutationFn: async ({
      expectedStateVersion,
      mappingSetId,
    }: BillingMigrationStateVersionRequest & { mappingSetId: string }) => {
      await freezeBillingMigrationMappingSet({
        body: { expectedStateVersion },
        client: generatedDashboardClient,
        path: { mappingSetId, programId, projectId },
        throwOnError: true,
      });
    },
    onSettled: () => refreshProgram(queryClient, projectId, programId),
  });
}

export function createMigrationBatchMutationOptions(
  projectId: string,
  programId: string,
  queryClient: QueryClient
) {
  return mutationOptions({
    mutationFn: async ({
      body,
      idempotencyKey,
    }: {
      body: CreateBillingMigrationImportBatchRequest;
      idempotencyKey: string;
    }) => {
      const result = await createBillingMigrationImportBatch({
        body,
        client: generatedDashboardClient,
        headers: { "Idempotency-Key": idempotencyKey },
        path: { programId, projectId },
        throwOnError: true,
      });
      return result.data.data.payload;
    },
    onSettled: () => refreshProgram(queryClient, projectId, programId),
  });
}

export function queueMigrationRunMutationOptions(
  projectId: string,
  programId: string,
  kind: "dry_run" | "shadow",
  queryClient: QueryClient
) {
  return mutationOptions({
    mutationFn: async ({
      body,
      idempotencyKey,
    }: {
      body: QueueBillingMigrationRunRequest;
      idempotencyKey: string;
    }) => {
      const operation =
        kind === "dry_run"
          ? queueBillingMigrationDryRun
          : queueBillingMigrationShadowRun;
      const result = await operation({
        body,
        client: generatedDashboardClient,
        headers: { "Idempotency-Key": idempotencyKey },
        path: { programId, projectId },
        throwOnError: true,
      });
      return result.data.data;
    },
    onSettled: () => refreshProgram(queryClient, projectId, programId),
  });
}

export function assessMigrationReadinessMutationOptions(
  projectId: string,
  programId: string,
  queryClient: QueryClient
) {
  return mutationOptions({
    mutationFn: async (body: BillingMigrationStateVersionRequest) => {
      const result = await assessBillingMigrationReadiness({
        body,
        client: generatedDashboardClient,
        path: { programId, projectId },
        throwOnError: true,
      });
      return result.data.data.payload;
    },
    onSettled: () => refreshProgram(queryClient, projectId, programId),
  });
}
