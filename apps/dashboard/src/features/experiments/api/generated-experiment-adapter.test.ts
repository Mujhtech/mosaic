import { describe, expect, it, vi } from "vitest";
import { createGeneratedDashboardClient } from "@/lib/api/generated-dashboard-client";
import { required } from "@/test/required";
import type { ExperimentDraftDocument } from "../types/experiment";
import { ExperimentDraftConflictError } from "./experiment-adapter";
import { createGeneratedExperimentAdapter } from "./generated-experiment-adapter";

const scope = { environmentId: "env-staging", projectId: "project" };

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data }), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function experiment(revision: number) {
  return {
    createdAt: "2026-07-26T00:00:00Z",
    currentDraft: {
      document: {
        assignmentKeyPolicy: "identified_user",
        guardrailMetricVersionIds: ["purchase_failure_rate@1"],
        primaryMetricVersionId: "presentation_to_purchase_start_rate@1",
        qaPolicy: { enabled: true },
        schedule: { startsAt: "2026-07-27T00:00:00Z" },
        variants: [
          {
            allocationBasisPoints: 5000,
            name: "Control",
            paywallId: "paywall-control",
            paywallVersionId: "version-control",
            role: "control",
          },
          {
            allocationBasisPoints: 5000,
            name: "Treatment A",
            paywallId: "paywall-treatment",
            paywallVersionId: "version-treatment",
            role: "treatment",
          },
        ],
      },
      id: "draft",
      revision,
      status: "active",
      updatedAt: "2026-07-26T01:00:00Z",
      validation: { issues: [], valid: true },
    },
    environmentId: scope.environmentId,
    id: "experiment",
    name: "Onboarding A/B",
    permissions: ["read", "write"],
    placementId: "placement",
    projectId: scope.projectId,
    role: "admin",
    state: "draft",
    updatedAt: "2026-07-26T01:00:00Z",
  };
}

function draftDocument(): ExperimentDraftDocument {
  const { document } = experiment(7).currentDraft;
  return {
    assignmentKeyPolicy: "identified_user",
    guardrailMetricVersionIds: document.guardrailMetricVersionIds,
    primaryMetricVersionId: document.primaryMetricVersionId,
    startsAt: document.schedule.startsAt,
    variants: document.variants.map((variant) => ({
      ...variant,
      role: variant.role === "control" ? "control" : "treatment",
    })),
  };
}

describe("generated Experiment adapter", () => {
  it("creates a subsequent mutual-exclusion Version without mutating the group root", async () => {
    let request: Request | undefined;
    const fetchImplementation = vi.fn((input: RequestInfo | URL) => {
      request = input as Request;
      return Promise.resolve(
        response(
          {
            assignmentKeyPolicy: "identified_user",
            bucketingAlgorithm: "experiment_sha256_length_prefixed_v1",
            createdAt: "2026-07-26T01:00:00Z",
            groupId: "group",
            holdoutBasisPoints: 1000,
            id: "group-version-2",
            members: [
              { allocationBasisPoints: 4500, experimentId: "experiment-a" },
              { allocationBasisPoints: 4500, experimentId: "experiment-b" },
            ],
            versionNumber: 2,
          },
          201
        )
      );
    }) as typeof fetch;
    const adapter = createGeneratedExperimentAdapter(
      createGeneratedDashboardClient(fetchImplementation)
    );

    const version = await adapter.createMutualExclusionGroupVersion(
      scope,
      "group",
      {
        assignmentKeyPolicy: "identified_user",
        holdoutBasisPoints: 1000,
        members: [
          { allocationBasisPoints: 4500, experimentId: "experiment-a" },
          { allocationBasisPoints: 4500, experimentId: "experiment-b" },
        ],
      }
    );

    expect(version).toMatchObject({ id: "group-version-2", versionNumber: 2 });
    expect(new URL(required(request, "request").url).pathname).toBe(
      "/v1/projects/project/environments/env-staging/experiments/groups/group/versions"
    );
    expect(await required(request, "request").clone().json()).toMatchObject({
      holdoutBasisPoints: 1000,
      members: [
        { allocationBasisPoints: 4500, experimentId: "experiment-a" },
        { allocationBasisPoints: 4500, experimentId: "experiment-b" },
      ],
    });
  });

  it("preserves unsaved input by stopping before PUT when the server Draft is newer", async () => {
    const requests: Request[] = [];
    const fetchImplementation = vi.fn((input: RequestInfo | URL) => {
      requests.push(input as Request);
      return Promise.resolve(response(experiment(8)));
    }) as typeof fetch;
    const adapter = createGeneratedExperimentAdapter(
      createGeneratedDashboardClient(fetchImplementation)
    );

    const error = await adapter
      .saveDraft(scope, "experiment", draftDocument(), 7)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ExperimentDraftConflictError);
    expect(error).toMatchObject({ currentRevision: 8 });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe("GET");
  });

  it("sends the strong Draft precondition and exact 10,000-bucket allocation", async () => {
    const requests: Request[] = [];
    const fetchImplementation = vi.fn(async (input: RequestInfo | URL) => {
      const request = input as Request;
      requests.push(request);
      if (request.method === "GET") {
        return response(experiment(7));
      }
      const body = (await request.clone().json()) as { document: unknown };
      return response({
        ...experiment(8).currentDraft,
        document: body.document,
      });
    }) as typeof fetch;
    const adapter = createGeneratedExperimentAdapter(
      createGeneratedDashboardClient(fetchImplementation)
    );

    await adapter.saveDraft(scope, "experiment", draftDocument(), 7);

    const update = required(requests[1], "requests[1]");
    expect(update.headers.get("If-Match")).toBe('"experiment-draft:draft:7"');
    expect(update.headers.get("Idempotency-Key")).toBeTruthy();
    const body = (await update.clone().json()) as {
      document: { variants: Array<{ allocationBasisPoints: number }> };
    };
    expect(
      body.document.variants.reduce(
        (sum, item) => sum + item.allocationBasisPoints,
        0
      )
    ).toBe(10_000);
  });
});
