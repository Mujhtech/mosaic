import {
  type AssignmentKeyPolicy,
  canSelectMetric,
  type ExperimentDetail,
  type ExperimentDraftDocument,
  type ExperimentVariantDraft,
  type ImmutablePaywallVersionOption,
  localDateTimeToUtc,
  type MetricDefinitionOption,
  type MutualExclusionGroupOption,
  utcToLocalDateTime,
  validateAllocation,
} from "../types/experiment";

export interface SelectOption {
  label: string;
  value: string;
}

export interface ExperimentBuilderValues {
  allocation0: string;
  allocation1: string;
  allocation2: string;
  allocation3: string;
  assignmentKeyPolicy: AssignmentKeyPolicy;
  controlVersionId: string;
  endsAt: string;
  guardrailMetricVersionIds: string[];
  hypothesis: string;
  mutualExclusionGroupVersionId: string;
  name: string;
  placementId: string;
  primaryMetricVersionId: string;
  qaEnabled: boolean;
  scheduleMode: "immediate" | "scheduled";
  startsAt: string;
  treatment1VersionId: string;
  treatment2VersionId: string;
  treatment3VersionId: string;
}

export function splitFor(count: number) {
  const base = Math.floor(10_000 / count);
  return Array.from({ length: count }, (_, index) =>
    index === count - 1 ? 10_000 - base * (count - 1) : base
  );
}

export const ASSIGNMENT_IDENTITY_OPTIONS = [
  { label: "Identified user (requires identity)", value: "identified_user" },
  {
    label: "Identified user, otherwise installation",
    value: "identified_user_or_installation",
  },
  { label: "Installation", value: "installation" },
];

export function experimentBuilderDefaultValues(
  experiment: ExperimentDetail | undefined
): ExperimentBuilderValues {
  const initialVariants = experiment?.currentDraft?.variants ?? [];
  const control = initialVariants.find((variant) => variant.role === "control");
  const treatments = initialVariants.filter(
    (variant) => variant.role === "treatment"
  );
  return {
    allocation0: String((control?.allocationBasisPoints ?? 5000) / 100),
    allocation1: String((treatments[0]?.allocationBasisPoints ?? 5000) / 100),
    allocation2: String((treatments[1]?.allocationBasisPoints ?? 0) / 100),
    allocation3: String((treatments[2]?.allocationBasisPoints ?? 0) / 100),
    assignmentKeyPolicy:
      experiment?.currentDraft?.assignmentKeyPolicy ?? "identified_user",
    controlVersionId: control?.paywallVersionId ?? "",
    endsAt: utcToLocalDateTime(experiment?.currentDraft?.endsAt),
    guardrailMetricVersionIds: [
      ...(experiment?.currentDraft?.guardrailMetricVersionIds ?? []),
    ],
    hypothesis:
      experiment?.hypothesis ?? experiment?.currentDraft?.hypothesis ?? "",
    mutualExclusionGroupVersionId:
      experiment?.currentDraft?.mutualExclusionGroupVersionId ?? "",
    name: experiment?.name ?? "",
    placementId: experiment?.placementId ?? "",
    primaryMetricVersionId:
      experiment?.currentDraft?.primaryMetricVersionId ?? "",
    qaEnabled: experiment?.currentDraft?.qaEnabled ?? true,
    scheduleMode: experiment ? "scheduled" : "immediate",
    startsAt: utcToLocalDateTime(experiment?.currentDraft?.startsAt),
    treatment1VersionId: treatments[0]?.paywallVersionId ?? "",
    treatment2VersionId: treatments[1]?.paywallVersionId ?? "",
    treatment3VersionId: treatments[2]?.paywallVersionId ?? "",
  };
}

/**
 * Every rejection here is raised as an `Error` because the builder surfaces one
 * message at a time next to the submit control, and the form owns that surface.
 */
export function buildExperimentDraftDocument({
  metrics,
  paywallVersions,
  treatmentCount,
  value,
}: {
  metrics: readonly MetricDefinitionOption[];
  paywallVersions: readonly ImmutablePaywallVersionOption[];
  treatmentCount: number;
  value: ExperimentBuilderValues;
}): ExperimentDraftDocument {
  const variantInputs = [
    {
      allocation: value.allocation0,
      name: "Control",
      role: "control" as const,
      versionId: value.controlVersionId,
    },
    {
      allocation: value.allocation1,
      name: "Treatment A",
      role: "treatment" as const,
      versionId: value.treatment1VersionId,
    },
    {
      allocation: value.allocation2,
      name: "Treatment B",
      role: "treatment" as const,
      versionId: value.treatment2VersionId,
    },
    {
      allocation: value.allocation3,
      name: "Treatment C",
      role: "treatment" as const,
      versionId: value.treatment3VersionId,
    },
  ].slice(0, treatmentCount + 1);
  const variants: ExperimentVariantDraft[] = variantInputs.map((item) => {
    const version = paywallVersions.find(
      (candidate) => candidate.id === item.versionId
    );
    return {
      allocationBasisPoints: Math.round(Number(item.allocation) * 100),
      name: item.name,
      paywallId: version?.paywallId ?? "",
      paywallVersionId: item.versionId,
      role: item.role,
    };
  });
  const allocationError = validateAllocation(variants);
  if (allocationError) {
    throw new Error(allocationError);
  }
  if (
    variants.some((variant) => !(variant.paywallVersionId && variant.paywallId))
  ) {
    throw new Error(
      "Choose an eligible immutable Paywall Version for every Variant."
    );
  }
  if (
    new Set(variants.map((variant) => variant.paywallVersionId)).size !==
    variants.length
  ) {
    throw new Error(
      "Each Variant must reference a different immutable Paywall Version."
    );
  }
  if (!value.primaryMetricVersionId) {
    throw new Error("Choose a primary metric.");
  }
  const primaryMetric = metrics.find(
    (metric) => metric.versionId === value.primaryMetricVersionId
  );
  if (!(primaryMetric && canSelectMetric(primaryMetric))) {
    throw new Error(
      "Choose a primary metric whose trusted source is available."
    );
  }
  if (value.scheduleMode === "scheduled" && !value.startsAt) {
    throw new Error("Choose an inclusive local start time.");
  }
  const startsAt =
    value.scheduleMode === "immediate"
      ? new Date().toISOString()
      : localDateTimeToUtc(value.startsAt);
  const endsAt = localDateTimeToUtc(value.endsAt);
  if (!startsAt) {
    throw new Error("Choose a valid start time.");
  }
  if (endsAt && new Date(startsAt).getTime() >= new Date(endsAt).getTime()) {
    throw new Error("The schedule end must be later than its start.");
  }
  return {
    assignmentKeyPolicy: value.assignmentKeyPolicy,
    endsAt,
    guardrailMetricVersionIds: value.guardrailMetricVersionIds,
    hypothesis: value.hypothesis.trim() || undefined,
    mutualExclusionGroupVersionId:
      value.mutualExclusionGroupVersionId || undefined,
    primaryMetricVersionId: value.primaryMetricVersionId,
    qaEnabled: value.qaEnabled,
    startsAt,
    variants,
  };
}

export function buildExperimentBuilderOptions({
  groups,
  metrics,
  paywallVersions,
  placements,
}: {
  groups: readonly MutualExclusionGroupOption[];
  metrics: readonly MetricDefinitionOption[];
  paywallVersions: readonly ImmutablePaywallVersionOption[];
  placements: readonly { id: string; name: string }[];
}) {
  return {
    groupOptions: [
      { label: "No group", value: "" },
      ...groups.map((group) => ({
        label: group.name,
        value: group.versionId,
      })),
    ],
    metricOptions: [
      { disabled: false, label: "Choose metric", value: "" },
      ...metrics.flatMap((metric) =>
        metric.eligibleAsPrimary
          ? [
              {
                disabled: !canSelectMetric(metric),
                label: `${metric.name} · ${metric.authority.replace("_", " ")}${
                  canSelectMetric(metric) ? "" : " · trusted source unavailable"
                }`,
                value: metric.versionId,
              },
            ]
          : []
      ),
    ],
    placementOptions: [
      { label: "Choose Placement", value: "" },
      ...placements.map((placement) => ({
        label: placement.name,
        value: placement.id,
      })),
    ],
    versionOptions: [
      { label: "Choose immutable Version", value: "" },
      ...paywallVersions.map((version) => ({
        label: `${version.paywallName} · v${version.versionNumber}`,
        value: version.id,
      })),
    ],
  };
}
