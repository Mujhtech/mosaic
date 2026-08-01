import { describe, expect, it } from "vitest";

import {
  canRequestExperimentExport,
  canSelectMetric,
  describeMetricEventFilter,
  type ExperimentVariantDraft,
  lifecycleActions,
  localDateTimeToUtc,
  type MetricDefinitionOption,
  utcToLocalDateTime,
  validateAllocation,
  validateMutualExclusionAllocation,
} from "./experiment";

function variant(
  role: "control" | "treatment",
  allocationBasisPoints: number
): ExperimentVariantDraft {
  return {
    allocationBasisPoints,
    name: role,
    paywallId: `paywall-${role}-${allocationBasisPoints}`,
    paywallVersionId: `version-${role}-${allocationBasisPoints}`,
    role,
  };
}

describe("Experiment authoring invariants", () => {
  it("keeps an unavailable trusted-source metric visible in the model but unselectable", () => {
    const metric: MetricDefinitionOption = {
      assignmentUnit: "assignment_key",
      authority: "provider_confirmed",
      availability: "trusted_source_unavailable",
      definition: "Provider-unavailability events per assigned unit.",
      eligibleAsGuardrail: true,
      eligibleAsPrimary: true,
      eventFilter: { "payload.reason": "provider_unavailable" },
      id: "provider_unavailability_rate",
      name: "Provider unavailability rate",
      versionId: "provider_unavailability_rate@1",
    };

    expect(canSelectMetric(metric)).toBe(false);
    expect(describeMetricEventFilter(metric.eventFilter)).toBe(
      "payload.reason = provider_unavailable"
    );
    expect(canSelectMetric({ ...metric, availability: "available" })).toBe(
      true
    );
  });

  it("rejects allocation that does not cover all 10,000 buckets", () => {
    expect(
      validateAllocation([variant("control", 5000), variant("treatment", 4999)])
    ).toMatch(/10,000 basis points/);
    expect(
      validateAllocation([variant("control", 5000), variant("treatment", 5000)])
    ).toBeUndefined();
  });

  it("keeps terminal lifecycle states from returning to Running", () => {
    expect(lifecycleActions("stopped")).toEqual(["archived"]);
    expect(lifecycleActions("completed")).toEqual(["archived"]);
    expect(lifecycleActions("archived")).toEqual([]);
  });

  it("reserves identity-scoped export for owners", () => {
    expect(canRequestExperimentExport("owner", true)).toBe(true);
    expect(canRequestExperimentExport("admin", true)).toBe(false);
    expect(canRequestExperimentExport("admin", false)).toBe(true);
    expect(canRequestExperimentExport("member", false)).toBe(false);
  });

  it("requires stable Experiment roots and holdout to cover all buckets exactly once", () => {
    expect(
      validateMutualExclusionAllocation(
        [
          { allocationBasisPoints: 4500, experimentId: "experiment-a" },
          { allocationBasisPoints: 4500, experimentId: "experiment-b" },
        ],
        1000
      )
    ).toBeUndefined();
    expect(
      validateMutualExclusionAllocation(
        [
          { allocationBasisPoints: 5000, experimentId: "experiment-a" },
          { allocationBasisPoints: 5000, experimentId: "experiment-a" },
        ],
        0
      )
    ).toMatch(/only once/);
  });

  it("round-trips a UTC schedule through datetime-local without changing the instant", () => {
    const instant = "2026-07-27T12:34:00.000Z";

    expect(localDateTimeToUtc(utcToLocalDateTime(instant))).toBe(instant);
  });
});
