import { type QueryClient, useMutation } from "@tanstack/react-query";
import { useCallback } from "react";

import { useMigrationCommand } from "@/features/billing-migrations/hooks/use-migration-command";
import {
  assessMigrationReadinessMutationOptions,
  createMigrationBatchMutationOptions,
  createMigrationMappingMutationOptions,
  freezeMigrationMappingMutationOptions,
  queueMigrationRunMutationOptions,
} from "@/features/billing-migrations/mutations/migration-mutations";
import { migrationKeys } from "@/features/billing-migrations/queries/migration-queries";

export function useMigrationProgramCommands(
  projectId: string,
  programId: string,
  queryClient: QueryClient
) {
  const refetchProgram = useCallback(
    () =>
      queryClient.refetchQueries({
        queryKey: migrationKeys.program(projectId, programId),
      }),
    [programId, projectId, queryClient]
  );
  const command = useMigrationCommand(refetchProgram);

  const createMapping = useMutation(
    createMigrationMappingMutationOptions(projectId, programId, queryClient)
  );
  const freezeMapping = useMutation(
    freezeMigrationMappingMutationOptions(projectId, programId, queryClient)
  );
  const createBatch = useMutation(
    createMigrationBatchMutationOptions(projectId, programId, queryClient)
  );
  const dryRun = useMutation(
    queueMigrationRunMutationOptions(
      projectId,
      programId,
      "dry_run",
      queryClient
    )
  );
  const shadowRun = useMutation(
    queueMigrationRunMutationOptions(
      projectId,
      programId,
      "shadow",
      queryClient
    )
  );
  const assess = useMutation(
    assessMigrationReadinessMutationOptions(projectId, programId, queryClient)
  );

  return {
    anyCommandPending:
      createMapping.isPending ||
      freezeMapping.isPending ||
      createBatch.isPending ||
      dryRun.isPending ||
      shadowRun.isPending ||
      assess.isPending,
    assess,
    command,
    createBatch,
    createMapping,
    dryRun,
    freezeMapping,
    shadowRun,
  };
}
