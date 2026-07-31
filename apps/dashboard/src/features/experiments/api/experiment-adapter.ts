import type {
  ExperimentDetail,
  ExperimentDraft,
  ExperimentDraftDocument,
  ExperimentExportJob,
  ExperimentHistoryEntry,
  ExperimentListItem,
  ExperimentResults,
  ExperimentScope,
  ExperimentStatus,
  ExperimentValidation,
  CreateMutualExclusionGroupInput,
  ImmutablePaywallVersionOption,
  MetricDefinitionOption,
  MutualExclusionGroupOption,
  MutualExclusionGroupVersion,
  QaOverride,
  QaOverrideCreated,
} from "../types/experiment"

export interface ExperimentAdapter {
  archive(scope: ExperimentScope, experimentId: string, reason: string): Promise<ExperimentDetail>
  complete(scope: ExperimentScope, experimentId: string, reason: string): Promise<ExperimentDetail>
  create(
    scope: ExperimentScope,
    input: { hypothesis?: string; name: string; placementId: string },
  ): Promise<ExperimentDetail>
  createMutualExclusionGroup(
    scope: ExperimentScope,
    input: CreateMutualExclusionGroupInput,
  ): Promise<MutualExclusionGroupOption>
  createMutualExclusionGroupVersion(
    scope: ExperimentScope,
    groupId: string,
    input: Omit<CreateMutualExclusionGroupInput, "name">,
  ): Promise<MutualExclusionGroupVersion>
  createQaOverride(
    scope: ExperimentScope,
    experimentId: string,
    input: {
      expiresAt: string
      experimentVersionId: string
      identityType: QaOverride["identityType"]
      label: string
      variantId: string
    },
  ): Promise<QaOverrideCreated>
  deleteQaOverride(scope: ExperimentScope, experimentId: string, overrideId: string): Promise<void>
  emergencyStop(
    scope: ExperimentScope,
    experimentId: string,
    reason: string,
  ): Promise<ExperimentDetail>
  get(scope: ExperimentScope, experimentId: string): Promise<ExperimentDetail>
  history(scope: ExperimentScope, experimentId: string): Promise<readonly ExperimentHistoryEntry[]>
  list(scope: ExperimentScope): Promise<readonly ExperimentListItem[]>
  listImmutablePaywallVersions(
    scope: ExperimentScope,
  ): Promise<readonly ImmutablePaywallVersionOption[]>
  listMetricDefinitions(scope: ExperimentScope): Promise<readonly MetricDefinitionOption[]>
  listMutualExclusionGroups(scope: ExperimentScope): Promise<readonly MutualExclusionGroupOption[]>
  listMutualExclusionGroupVersions(
    scope: ExperimentScope,
    groupId: string,
  ): Promise<readonly MutualExclusionGroupVersion[]>
  listQaOverrides(scope: ExperimentScope, experimentId: string): Promise<readonly QaOverride[]>
  publish(
    scope: ExperimentScope,
    experimentId: string,
    expectedRevision: number,
  ): Promise<ExperimentDetail>
  requestExport(
    scope: ExperimentScope,
    experimentId: string,
    identityScoped: boolean,
  ): Promise<ExperimentExportJob>
  results(scope: ExperimentScope, experimentId: string): Promise<ExperimentResults>
  saveDraft(
    scope: ExperimentScope,
    experimentId: string,
    document: ExperimentDraftDocument,
    expectedRevision: number,
  ): Promise<ExperimentDraft>
  transition(
    scope: ExperimentScope,
    experimentId: string,
    target: ExperimentStatus,
    reason: string,
  ): Promise<ExperimentDetail>
  validate(scope: ExperimentScope, experimentId: string): Promise<ExperimentValidation>
}

export class ExperimentContractPendingError extends Error {
  constructor() {
    super("Experiment management is unavailable until the Phase 7 REST contract is deployed.")
    this.name = "ExperimentContractPendingError"
  }
}

export class ExperimentDraftConflictError extends Error {
  constructor(
    readonly currentRevision: number,
    readonly currentDraft?: ExperimentDraft,
  ) {
    super(`The server has a newer Draft revision (${currentRevision}).`)
    this.name = "ExperimentDraftConflictError"
  }
}

const pending = () => Promise.reject(new ExperimentContractPendingError())

export const CONTRACT_PENDING_EXPERIMENT_ADAPTER: ExperimentAdapter = {
  archive: pending,
  complete: pending,
  create: pending,
  createMutualExclusionGroup: pending,
  createMutualExclusionGroupVersion: pending,
  createQaOverride: pending,
  deleteQaOverride: pending,
  emergencyStop: pending,
  get: pending,
  history: pending,
  list: pending,
  listImmutablePaywallVersions: pending,
  listMetricDefinitions: pending,
  listMutualExclusionGroups: pending,
  listMutualExclusionGroupVersions: pending,
  listQaOverrides: pending,
  publish: pending,
  requestExport: pending,
  results: pending,
  saveDraft: pending,
  transition: pending,
  validate: pending,
}
