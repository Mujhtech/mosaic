import { queryOptions } from "@tanstack/react-query"

import {
  getBillingMigrationImportBatch,
  getBillingMigrationProgram,
  getBillingMigrationRunJob,
  getLatestBillingMigrationReadiness,
  inspectBillingMigrationCompletion,
  listBillingMigrationApprovals,
  listBillingMigrationAuthorityExecutions,
  listBillingMigrationCases,
  listBillingMigrationCheckpoints,
  listBillingMigrationCompletionHistory,
  listBillingMigrationCredentialRemovals,
  listBillingMigrationDivergences,
  listBillingMigrationImportBatches,
  listBillingMigrationMappingSets,
  listBillingMigrationLegalHoldProposals,
  listBillingMigrationLegalHolds,
  listBillingMigrationPrograms,
  listBillingMigrationProposals,
  listBillingMigrationRepairExecutions,
  listBillingMigrationRepairPreviews,
  listBillingMigrationRollbackReadinessAssessments,
  listBillingMigrationSourceManifests,
  listBillingMigrationStabilizationObservations,
  listBillingMigrationWebhookRedeliveries,
} from "@/generated/api"
import {
  migrationRunPollingInterval,
  normalizeMigrationProgramDetail,
} from "@/features/billing-migrations/types/migration-operations"
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client"

export const migrationKeys = {
  project: (projectId: string) => ["billing-migrations", projectId] as const,
  programs: (projectId: string) => ["billing-migrations", projectId, "programs"] as const,
  program: (projectId: string, programId: string) =>
    ["billing-migrations", projectId, "program", programId] as const,
  manifests: (projectId: string, programId: string) =>
    ["billing-migrations", projectId, programId, "manifests"] as const,
  mappings: (projectId: string, programId: string) =>
    ["billing-migrations", projectId, programId, "mappings"] as const,
  batches: (projectId: string, programId: string) =>
    ["billing-migrations", projectId, programId, "batches"] as const,
  batch: (projectId: string, programId: string, batchId: string) =>
    ["billing-migrations", projectId, programId, "batch", batchId] as const,
  run: (projectId: string, programId: string, runJobId: string) =>
    ["billing-migrations", projectId, programId, "run", runJobId] as const,
  divergences: (projectId: string, programId: string, classification: string) =>
    ["billing-migrations", projectId, programId, "divergences", classification] as const,
  readiness: (projectId: string, programId: string) =>
    ["billing-migrations", projectId, programId, "readiness"] as const,
  lifecycle: (projectId: string, programId: string) =>
    ["billing-migrations", projectId, programId, "lifecycle"] as const,
}

export function migrationLifecycleQueryOptions(projectId: string, programId: string) {
  return queryOptions({
    queryKey: migrationKeys.lifecycle(projectId, programId),
    queryFn: async ({ signal }) => {
      const withSignal = {
        client: generatedDashboardClient,
        path: { programId, projectId },
        signal,
        throwOnError: true,
      } as const
      const [
        proposals,
        approvals,
        checkpoints,
        executions,
        cases,
        previews,
        repairs,
        redeliveries,
        removals,
        holdProposals,
        holds,
        reports,
        observations,
        rollbackAssessments,
        completion,
      ] = await Promise.all([
        listBillingMigrationProposals(withSignal),
        listBillingMigrationApprovals(withSignal),
        listBillingMigrationCheckpoints(withSignal),
        listBillingMigrationAuthorityExecutions(withSignal),
        listBillingMigrationCases(withSignal),
        listBillingMigrationRepairPreviews(withSignal),
        listBillingMigrationRepairExecutions(withSignal),
        listBillingMigrationWebhookRedeliveries(withSignal),
        listBillingMigrationCredentialRemovals(withSignal),
        listBillingMigrationLegalHoldProposals(withSignal),
        listBillingMigrationLegalHolds(withSignal),
        listBillingMigrationCompletionHistory(withSignal),
        listBillingMigrationStabilizationObservations(withSignal),
        listBillingMigrationRollbackReadinessAssessments(withSignal),
        inspectBillingMigrationCompletion(withSignal).catch(() => undefined),
      ])
      return {
        approvals: approvals.data.data.items,
        cases: cases.data.data.items,
        checkpoints: checkpoints.data.data.items,
        completion: completion?.data.data.payload,
        executions: executions.data.data.items,
        holdProposals: holdProposals.data.data.items,
        holds: holds.data.data.items,
        observations: observations.data.data.items,
        proposals: proposals.data.data.items,
        removals: removals.data.data.items,
        repairExecutions: repairs.data.data.items,
        repairPreviews: previews.data.data.items,
        reports: reports.data.data.items,
        rollbackAssessments: rollbackAssessments.data.data.items,
        webhookRedeliveries: redeliveries.data.data.items,
      }
    },
  })
}

export function migrationProgramsQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: migrationKeys.programs(projectId),
    queryFn: async ({ signal }) => {
      const result = await listBillingMigrationPrograms({
        client: generatedDashboardClient,
        path: { projectId },
        query: { limit: 100 },
        signal,
        throwOnError: true,
      })
      return result.data.data.items.map((record) => normalizeMigrationProgramDetail(record.payload))
    },
  })
}

export function migrationProgramQueryOptions(projectId: string, programId: string) {
  return queryOptions({
    queryKey: migrationKeys.program(projectId, programId),
    queryFn: async ({ signal }) => {
      const result = await getBillingMigrationProgram({
        client: generatedDashboardClient,
        path: { programId, projectId },
        signal,
        throwOnError: true,
      })
      return normalizeMigrationProgramDetail(result.data.data.payload)
    },
  })
}

export function migrationManifestsQueryOptions(projectId: string, programId: string) {
  return queryOptions({
    queryKey: migrationKeys.manifests(projectId, programId),
    queryFn: async ({ signal }) => {
      const result = await listBillingMigrationSourceManifests({
        client: generatedDashboardClient,
        path: { programId, projectId },
        query: { limit: 100 },
        signal,
        throwOnError: true,
      })
      return result.data.data.items.map((record) => record.payload)
    },
  })
}

export function migrationMappingsQueryOptions(projectId: string, programId: string) {
  return queryOptions({
    queryKey: migrationKeys.mappings(projectId, programId),
    queryFn: async ({ signal }) => {
      const result = await listBillingMigrationMappingSets({
        client: generatedDashboardClient,
        path: { programId, projectId },
        query: { limit: 100 },
        signal,
        throwOnError: true,
      })
      return result.data.data.items.map((record) => record.payload)
    },
  })
}

export function migrationBatchesQueryOptions(projectId: string, programId: string) {
  return queryOptions({
    queryKey: migrationKeys.batches(projectId, programId),
    queryFn: async ({ signal }) => {
      const result = await listBillingMigrationImportBatches({
        client: generatedDashboardClient,
        path: { programId, projectId },
        query: { limit: 100 },
        signal,
        throwOnError: true,
      })
      return result.data.data.items.map((record) => record.payload)
    },
  })
}

export function migrationBatchQueryOptions(projectId: string, programId: string, batchId: string) {
  return queryOptions({
    enabled: batchId.length > 0,
    queryKey: migrationKeys.batch(projectId, programId, batchId),
    queryFn: async ({ signal }) => {
      const result = await getBillingMigrationImportBatch({
        client: generatedDashboardClient,
        path: { batchId, programId, projectId },
        signal,
        throwOnError: true,
      })
      return result.data.data.payload
    },
  })
}

export function migrationRunQueryOptions(projectId: string, programId: string, runJobId: string) {
  return queryOptions({
    enabled: runJobId.length > 0,
    queryKey: migrationKeys.run(projectId, programId, runJobId),
    queryFn: async ({ signal }) => {
      const result = await getBillingMigrationRunJob({
        client: generatedDashboardClient,
        path: { programId, projectId, runJobId },
        signal,
        throwOnError: true,
      })
      return result.data.data
    },
    // A Stage 2B job may remain pending until a later worker stage is present.
    // Poll for at most two minutes, and always stop immediately on terminal state.
    refetchInterval: (query) =>
      migrationRunPollingInterval(query.state.data, query.state.dataUpdateCount),
  })
}

export function migrationDivergencesQueryOptions(
  projectId: string,
  programId: string,
  classification = "all",
) {
  return queryOptions({
    queryKey: migrationKeys.divergences(projectId, programId, classification),
    queryFn: async ({ signal }) => {
      const result = await listBillingMigrationDivergences({
        client: generatedDashboardClient,
        path: { programId, projectId },
        query: { limit: 100 },
        signal,
        throwOnError: true,
      })
      const items = result.data.data.items.map((record) => record.payload)
      return classification === "all"
        ? items
        : items.filter((item) => item.classification === classification)
    },
  })
}

export function migrationReadinessQueryOptions(projectId: string, programId: string) {
  return queryOptions({
    queryKey: migrationKeys.readiness(projectId, programId),
    queryFn: async ({ signal }) => {
      const result = await getLatestBillingMigrationReadiness({
        client: generatedDashboardClient,
        path: { programId, projectId },
        signal,
        throwOnError: true,
      })
      return result.data.data.payload
    },
    retry: (count, error) =>
      !(error instanceof Error && "status" in error && error.status === 404) && count < 2,
  })
}
