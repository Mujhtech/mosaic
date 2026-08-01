import type {
  Experiment as GeneratedExperiment,
  ExperimentDraft as GeneratedExperimentDraft,
  ExperimentQaOverride as GeneratedQaOverride,
  ExperimentValidationIssue as GeneratedValidationIssue,
} from "@/generated/api";
import {
  createExperiment,
  createExperimentGroupVersion,
  createExperimentMutualExclusionGroupVersion,
  createExperimentQaOverride,
  createExperimentRawExport,
  getExperiment,
  getExperimentResults,
  listExperimentGroups,
  listExperimentHistory,
  listExperimentMetricDefinitions,
  listExperimentMutualExclusionGroupVersions,
  listExperimentQaOverrides,
  listExperiments,
  listPaywalls,
  listPaywallVersions,
  listPlacements,
  publishExperiment,
  revokeExperimentQaOverride,
  transitionExperimentLifecycle,
  updateExperimentDraft,
  validateExperimentDraft,
} from "@/generated/api";
import type { Client } from "@/generated/api/client";
import { ApiError } from "@/lib/api/errors";
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client";
import type {
  ExperimentDetail,
  ExperimentDraft,
  ExperimentDraftDocument,
  ExperimentIssue,
  ExperimentListItem,
  GuardrailResult,
  QaOverride,
} from "../types/experiment";
import {
  type ExperimentAdapter,
  ExperimentDraftConflictError,
} from "./experiment-adapter";

const MATURITY_WARNING = /window|matur/i;

function createIdempotencyKey() {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `mosaic-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

const draftIdempotencyKeys = new Map<string, string>();
const createIdempotencyKeys = new Map<string, string>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mapDraft(draft: GeneratedExperimentDraft): ExperimentDraft {
  return {
    assignmentKeyPolicy: draft.document.assignmentKeyPolicy,
    endsAt: draft.document.schedule.endsAt,
    guardrailMetricVersionIds: draft.document.guardrailMetricVersionIds,
    id: draft.id,
    mutualExclusionGroupVersionId: draft.document.mutualExclusionGroupVersionId,
    primaryMetricVersionId: draft.document.primaryMetricVersionId,
    qaEnabled: draft.document.qaPolicy.enabled,
    revision: draft.revision,
    startsAt: draft.document.schedule.startsAt,
    updatedAt: draft.updatedAt,
    variants: draft.document.variants,
  };
}

function mapExperiment(
  experiment: GeneratedExperiment,
  placementNames: ReadonlyMap<string, string> = new Map()
): ExperimentDetail {
  const { activeVersion } = experiment;
  const matchingDraft =
    activeVersion &&
    experiment.currentDraft?.revision === activeVersion.sourceRevision
      ? experiment.currentDraft
      : undefined;
  return {
    activeDefinition: activeVersion
      ? {
          allocationVersion: activeVersion.allocationVersion,
          assignmentKeyPolicy: activeVersion.assignmentKeyPolicy,
          bucketingAlgorithm: activeVersion.bucketingAlgorithm,
          endsAt: activeVersion.schedule.endsAt,
          guardrailMetricVersionIds: activeVersion.guardrailMetricVersionIds,
          mutualExclusionGroupVersionId:
            activeVersion.mutualExclusionGroupVersionId,
          primaryMetricVersionId: activeVersion.primaryMetricVersionId,
          publishedAt: activeVersion.publishedAt,
          qaPolicyEnabled: matchingDraft?.document.qaPolicy.enabled,
          sourceRevision: activeVersion.sourceRevision,
          startsAt: activeVersion.schedule.startsAt,
          variants: activeVersion.variants.map((variant) => ({
            allocationBasisPoints:
              variant.allocationEnd - variant.allocationStart,
            id: variant.id,
            name: variant.name,
            paywallId: variant.paywallId,
            paywallVersionId: variant.paywallVersionId,
            role: variant.role,
          })),
        }
      : undefined,
    activeVariants: experiment.activeVersion?.variants.map((variant) => ({
      allocationBasisPoints: variant.allocationEnd - variant.allocationStart,
      id: variant.id,
      name: variant.name,
      paywallId: variant.paywallId,
      paywallVersionId: variant.paywallVersionId,
      role: variant.role,
    })),
    activeVersionId: experiment.activeVersion?.id,
    activeVersionNumber: experiment.activeVersion?.versionNumber,
    currentDraft: experiment.currentDraft
      ? mapDraft(experiment.currentDraft)
      : undefined,
    hypothesis: experiment.hypothesis,
    id: experiment.id,
    name: experiment.name,
    placementId: experiment.placementId,
    placementName:
      placementNames.get(experiment.placementId) ?? experiment.placementId,
    status: experiment.state,
    updatedAt: experiment.updatedAt,
  };
}

function mapIssue(issue: GeneratedValidationIssue): ExperimentIssue {
  return {
    affectedResources: issue.resourceId ? [issue.resourceId] : undefined,
    code: issue.code,
    continues: false,
    message: issue.message,
    recoveryAction: issue.recoveryAction,
    severity: issue.severity,
    title: issue.code.replaceAll("_", " "),
  };
}

function mapQaOverride(override: GeneratedQaOverride): QaOverride {
  return {
    expiresAt: override.expiresAt,
    id: override.id,
    identityType:
      override.identityType === "installation"
        ? "installation"
        : "identified_user",
    label: override.safeLabel,
    variantId: override.variantId,
    visibleSelectorDigest: override.selectorDigest ?? "Pending",
  };
}

function generatedDocument(document: ExperimentDraftDocument) {
  return {
    assignmentKeyPolicy: document.assignmentKeyPolicy,
    guardrailMetricVersionIds: [...document.guardrailMetricVersionIds],
    mutualExclusionGroupVersionId: document.mutualExclusionGroupVersionId,
    primaryMetricVersionId: document.primaryMetricVersionId,
    qaPolicy: { enabled: document.qaEnabled ?? true },
    schedule: { endsAt: document.endsAt, startsAt: document.startsAt },
    variants: document.variants.map((variant) => ({ ...variant })),
  };
}

function conflictFrom(error: unknown) {
  if (!(error instanceof ApiError) || error.status !== 409) {
    return null;
  }
  const details = isRecord(error.details) ? error.details : undefined;
  const currentRevision = details?.currentRevision;
  if (typeof currentRevision !== "number") {
    return null;
  }
  return new ExperimentDraftConflictError(currentRevision);
}

function warningIssue(
  code: string,
  message: string,
  severity: ExperimentIssue["severity"] = "warning"
): ExperimentIssue {
  return {
    code,
    continues: true,
    investigation:
      "Inspect exposure, Product, provider, and aggregate diagnostics for the affected Variant.",
    message,
    recoveryAction:
      "Resolve the underlying issue and wait for fresh aggregates. Do not change active allocation in place.",
    severity,
    title: code.replaceAll("_", " "),
  };
}

function stringValue(record: Record<string, unknown>, key: string) {
  return typeof record[key] === "string" ? record[key] : undefined;
}

function mapResultWarning(warning: unknown, index: number): ExperimentIssue {
  if (!isRecord(warning)) {
    return warningIssue(`result_warning_${index + 1}`, String(warning));
  }
  const code = stringValue(warning, "code") ?? `result_warning_${index + 1}`;
  const mapped = warningIssue(
    code,
    stringValue(warning, "message") ??
      stringValue(warning, "summary") ??
      "Result warning",
    warning.severity === "critical" || warning.severity === "info"
      ? warning.severity
      : "warning"
  );
  return {
    ...mapped,
    investigation:
      stringValue(warning, "investigation") ?? mapped.investigation,
    recoveryAction:
      stringValue(warning, "recoveryAction") ?? mapped.recoveryAction,
    title: stringValue(warning, "title") ?? mapped.title,
  };
}

function mapGuardrailResult(guardrail: unknown): GuardrailResult {
  if (!isRecord(guardrail)) {
    return {
      name: String(guardrail),
      severity: "warning" as const,
      summary: String(guardrail),
    };
  }
  const { severity } = guardrail;
  const mappedSeverity: GuardrailResult["severity"] =
    severity === "ok" ||
    severity === "critical" ||
    severity === "unavailable" ||
    severity === "warning"
      ? severity
      : "warning";
  return {
    code: stringValue(guardrail, "code"),
    estimate:
      typeof guardrail.estimate === "number" ? guardrail.estimate : undefined,
    investigation: stringValue(guardrail, "investigation"),
    name:
      stringValue(guardrail, "name") ??
      stringValue(guardrail, "title") ??
      "Guardrail",
    recoveryAction: stringValue(guardrail, "recoveryAction"),
    severity: mappedSeverity,
    summary:
      stringValue(guardrail, "summary") ??
      stringValue(guardrail, "message") ??
      "Unavailable",
  };
}

export function createGeneratedExperimentAdapter(
  client: Client = generatedDashboardClient
): ExperimentAdapter {
  return {
    archive(scope, experimentId, reason) {
      return this.transition(scope, experimentId, "archived", reason);
    },
    complete(scope, experimentId, reason) {
      return this.transition(scope, experimentId, "completed", reason);
    },
    async create(scope, input) {
      const requestScope = `${scope.projectId}:${scope.environmentId}:${input.placementId}:${input.name}`;
      const key =
        createIdempotencyKeys.get(requestScope) ?? createIdempotencyKey();
      createIdempotencyKeys.set(requestScope, key);
      const result = await createExperiment({
        body: input,
        client,
        headers: { "Idempotency-Key": key },
        path: scope,
        throwOnError: true,
      });
      createIdempotencyKeys.delete(requestScope);
      return mapExperiment(result.data.data);
    },
    async createMutualExclusionGroup(scope, input) {
      const result = await createExperimentGroupVersion({
        body: { ...input, members: [...input.members] },
        client,
        path: scope,
        throwOnError: true,
      });
      const { group, version } = result.data.data;
      return {
        assignmentKeyPolicy:
          version.assignmentKeyPolicy as typeof input.assignmentKeyPolicy,
        holdoutBasisPoints: version.holdoutBasisPoints,
        id: group.id,
        members: version.members,
        name: group.name,
        versionId: version.id,
      };
    },
    async createMutualExclusionGroupVersion(scope, groupId, input) {
      const result = await createExperimentMutualExclusionGroupVersion({
        body: { ...input, members: [...input.members] },
        client,
        path: { ...scope, groupId },
        throwOnError: true,
      });
      const version = result.data.data;
      return {
        assignmentKeyPolicy:
          version.assignmentKeyPolicy as typeof input.assignmentKeyPolicy,
        createdAt: version.createdAt,
        groupId: version.groupId,
        holdoutBasisPoints: version.holdoutBasisPoints,
        id: version.id,
        members: version.members,
        versionNumber: version.versionNumber,
      };
    },
    async createQaOverride(scope, experimentId, input) {
      const result = await createExperimentQaOverride({
        body: {
          expiresAt: input.expiresAt,
          experimentVersionId: input.experimentVersionId,
          identityType: input.identityType,
          safeLabel: input.label,
          variantId: input.variantId,
        },
        client,
        path: { ...scope, experimentId },
        throwOnError: true,
      });
      return {
        override: mapQaOverride(result.data.data.override),
        token: result.data.data.token,
      };
    },
    async deleteQaOverride(scope, experimentId, overrideId) {
      await revokeExperimentQaOverride({
        client,
        path: { ...scope, experimentId, overrideId },
        throwOnError: true,
      });
    },
    async emergencyStop(scope, experimentId, reason) {
      const result = await transitionExperimentLifecycle({
        body: { reason },
        client,
        path: { ...scope, experimentId, lifecycleAction: "emergency-stop" },
        throwOnError: true,
      });
      return mapExperiment(result.data.data);
    },
    async get(scope, experimentId) {
      const [experimentResult, placementsResult] = await Promise.all([
        getExperiment({
          client,
          path: { ...scope, experimentId },
          throwOnError: true,
        }),
        listPlacements({
          client,
          path: { projectId: scope.projectId },
          throwOnError: true,
        }),
      ]);
      const names = new Map(
        placementsResult.data.data.items.map((placement) => [
          placement.id,
          placement.name,
        ])
      );
      return mapExperiment(experimentResult.data.data, names);
    },
    async history(scope, experimentId) {
      const result = await listExperimentHistory({
        client,
        path: { ...scope, experimentId },
        throwOnError: true,
      });
      return result.data.data.items.map((entry) => ({
        actorLabel: entry.actorId,
        createdAt: entry.createdAt,
        id: entry.id,
        reason: entry.reason,
        releaseId: entry.releaseId,
        summary: `${entry.fromState} → ${entry.toState}`,
      }));
    },
    async list(scope) {
      const [experimentsResult, placementsResult] = await Promise.all([
        listExperiments({ client, path: scope, throwOnError: true }),
        listPlacements({
          client,
          path: { projectId: scope.projectId },
          throwOnError: true,
        }),
      ]);
      const names = new Map(
        placementsResult.data.data.items.map((placement) => [
          placement.id,
          placement.name,
        ])
      );
      return experimentsResult.data.data.items.map(
        (experiment): ExperimentListItem => mapExperiment(experiment, names)
      );
    },
    async listImmutablePaywallVersions(scope) {
      const paywallResult = await listPaywalls({
        client,
        path: { projectId: scope.projectId },
        throwOnError: true,
      });
      const versions = await Promise.all(
        paywallResult.data.data.items
          .filter((paywall) => paywall.status === "active")
          .map(async (paywall) => {
            const result = await listPaywallVersions({
              client,
              path: { paywallId: paywall.id, projectId: scope.projectId },
              throwOnError: true,
            });
            return result.data.data.items
              .filter(
                (version) => version.environmentId === scope.environmentId
              )
              .map((version) => ({
                createdAt: version.createdAt,
                id: version.id,
                paywallId: paywall.id,
                paywallName: paywall.name,
                versionNumber: version.versionNumber,
              }));
          })
      );
      return versions.flat();
    },
    async listMetricDefinitions(scope) {
      const result = await listExperimentMetricDefinitions({
        client,
        path: scope,
        throwOnError: true,
      });
      return result.data.data.items.map((metric) => ({
        assignmentUnit: metric.assignmentUnit,
        authority:
          metric.authority === "provider_confirmed"
            ? "provider_confirmed"
            : "client_observed",
        availability: metric.availability,
        definition: metric.definition,
        eligibleAsGuardrail: metric.guardrailEligible,
        eligibleAsPrimary: metric.primaryEligible,
        eventFilter: metric.eventFilter,
        id: metric.id,
        name: metric.name,
        versionId: `${metric.id}@${metric.version}`,
      }));
    },
    async listMutualExclusionGroups(scope) {
      const result = await listExperimentGroups({
        client,
        path: scope,
        throwOnError: true,
      });
      return result.data.data.items
        .filter((group) => group.status === "active" && group.activeVersionId)
        .map((group) => ({
          id: group.id,
          name: group.name,
          versionId: group.activeVersionId!,
        }));
    },
    async listMutualExclusionGroupVersions(scope, groupId) {
      const result = await listExperimentMutualExclusionGroupVersions({
        client,
        path: { ...scope, groupId },
        throwOnError: true,
      });
      return result.data.data.items.map((version) => ({
        assignmentKeyPolicy:
          version.assignmentKeyPolicy === "installation" ||
          version.assignmentKeyPolicy === "identified_user_or_installation"
            ? version.assignmentKeyPolicy
            : "identified_user",
        createdAt: version.createdAt,
        groupId: version.groupId,
        holdoutBasisPoints: version.holdoutBasisPoints,
        id: version.id,
        members: version.members,
        versionNumber: version.versionNumber,
      }));
    },
    async listQaOverrides(scope, experimentId) {
      const result = await listExperimentQaOverrides({
        client,
        path: { ...scope, experimentId },
        throwOnError: true,
      });
      return result.data.data.items
        .filter((override) => override.status === "active")
        .map(mapQaOverride);
    },
    async publish(scope, experimentId, expectedRevision) {
      await publishExperiment({
        body: { expectedRevision },
        client,
        path: { ...scope, experimentId },
        throwOnError: true,
      });
      return this.get(scope, experimentId);
    },
    async requestExport(scope, experimentId, identityScoped) {
      const result = await createExperimentRawExport({
        body: { format: "ndjson", includeIdentity: identityScoped },
        client,
        path: { ...scope, experimentId },
        throwOnError: true,
      });
      const job = result.data.data;
      return {
        expiresAt: job.expiresAt,
        id: job.id,
        identityScoped,
        status:
          job.status === "leased" || job.status === "recomputing"
            ? "running"
            : job.status,
      };
    },
    async results(scope, experimentId) {
      const [result, detail, metrics] = await Promise.all([
        getExperimentResults({
          client,
          path: { ...scope, experimentId },
          throwOnError: true,
        }),
        getExperiment({
          client,
          path: { ...scope, experimentId },
          throwOnError: true,
        }),
        listExperimentMetricDefinitions({
          client,
          path: scope,
          throwOnError: true,
        }),
      ]);
      const { data } = result.data;
      const names = new Map(
        detail.data.data.activeVersion?.variants.map((variant) => [
          variant.id,
          variant.name,
        ]) ?? []
      );
      const warnings = (data.warnings as readonly unknown[]).map(
        mapResultWarning
      );
      if (data.srm.status === "mismatch") {
        warnings.unshift({
          ...warningIssue(
            "sample_ratio_mismatch",
            data.srm.explanation,
            data.srm.severity === "critical" ? "critical" : "warning"
          ),
          investigation: data.srm.investigationSteps.join(" "),
        });
      } else if (data.srm.status === "insufficient_sample") {
        warnings.unshift(
          warningIssue("srm_insufficient_sample", data.srm.explanation, "info")
        );
      }
      const freshnessMinutes = data.freshness
        ? Math.max(
            0,
            Math.floor(
              (Date.now() - new Date(data.freshness).getTime()) / 60_000
            )
          )
        : undefined;
      const primaryId = detail.data.data.activeVersion?.primaryMetricVersionId;
      const primary = metrics.data.data.items.find(
        (metric) => `${metric.id}@${metric.version}` === primaryId
      );
      return {
        aggregateUpdatedAt: data.freshness,
        attributionWindowMature: !data.warnings.some((warning) =>
          MATURITY_WARNING.test(warning)
        ),
        fallbackExposures: data.variants.reduce(
          (total, variant) => total + variant.fallbackPresentations,
          0
        ),
        freshnessMinutes,
        guardrails: (data.guardrails as readonly unknown[]).map(
          mapGuardrailResult
        ),
        interim: data.interim,
        issues: warnings,
        primaryMetricName: primary?.name ?? primaryId ?? "Primary metric",
        primaryMetricAuthority:
          primary?.authority === "provider_confirmed"
            ? "provider_confirmed"
            : "client_observed",
        primaryMetricAvailability:
          primary?.availability ?? "trusted_source_unavailable",
        primaryMetricEventFilter: primary?.eventFilter ?? {},
        srm: data.srm,
        treatments: data.lifts.map((lift) => ({
          absoluteLift: lift.absoluteLift,
          interval: { high: lift.newcombe95.upper, low: lift.newcombe95.lower },
          relativeLift: lift.relativeLift,
          variantId: lift.treatmentVariantId,
        })),
        variants: data.variants.map((variant) => ({
          allocationBasisPoints: variant.allocationBasisPoints,
          conversions: variant.uniqueConversions,
          estimate: variant.estimate,
          interval: {
            high: variant.wilson95.upper,
            low: variant.wilson95.lower,
          },
          name: names.get(variant.variantId) ?? variant.variantId,
          role:
            variant.role === "control"
              ? ("control" as const)
              : ("treatment" as const),
          uniqueExposures: variant.uniqueExposures,
          variantId: variant.variantId,
        })),
      };
    },
    async saveDraft(scope, experimentId, document, expectedRevision) {
      const detail = await getExperiment({
        client,
        path: { ...scope, experimentId },
        throwOnError: true,
      });
      const { currentDraft } = detail.data.data;
      if (!currentDraft) {
        throw new Error("This Experiment has no editable Draft.");
      }
      if (currentDraft.revision !== expectedRevision) {
        throw new ExperimentDraftConflictError(
          currentDraft.revision,
          mapDraft(currentDraft)
        );
      }
      const requestScope = `${scope.projectId}:${scope.environmentId}:${experimentId}:${expectedRevision}`;
      const key =
        draftIdempotencyKeys.get(requestScope) ?? createIdempotencyKey();
      draftIdempotencyKeys.set(requestScope, key);
      try {
        const result = await updateExperimentDraft({
          body: { document: generatedDocument(document), expectedRevision },
          client,
          headers: {
            "Idempotency-Key": key,
            "If-Match": JSON.stringify(
              `experiment-draft:${currentDraft.id}:${expectedRevision}`
            ),
          },
          path: { ...scope, experimentId },
          throwOnError: true,
        });
        draftIdempotencyKeys.delete(requestScope);
        return mapDraft(result.data.data);
      } catch (error) {
        throw conflictFrom(error) ?? error;
      }
    },
    async transition(scope, experimentId, target, reason) {
      let action:
        | "schedule"
        | "start"
        | "pause"
        | "resume"
        | "stop"
        | "complete"
        | "archive";
      if (target === "running") {
        const current = await getExperiment({
          client,
          path: { ...scope, experimentId },
          throwOnError: true,
        });
        action = current.data.data.state === "paused" ? "resume" : "start";
      } else if (target === "scheduled") {
        action = "schedule";
      } else if (
        target === "paused" ||
        target === "stopped" ||
        target === "completed" ||
        target === "archived"
      ) {
        action =
          target === "stopped"
            ? "stop"
            : target === "paused"
              ? "pause"
              : target === "completed"
                ? "complete"
                : "archive";
      } else {
        throw new Error("Draft is not a lifecycle action.");
      }
      const result = await transitionExperimentLifecycle({
        body: { reason },
        client,
        path: { ...scope, experimentId, lifecycleAction: action },
        throwOnError: true,
      });
      return mapExperiment(result.data.data);
    },
    async validate(scope, experimentId) {
      const result = await validateExperimentDraft({
        client,
        path: { ...scope, experimentId },
        throwOnError: true,
      });
      return {
        canPublish: result.data.data.valid,
        issues: result.data.data.issues.map(mapIssue),
      };
    },
  };
}

export const generatedExperimentAdapter = createGeneratedExperimentAdapter();
