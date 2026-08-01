import { describe, expect, it, vi } from "vitest";
import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates";
import { cloneValue } from "@/features/paywall-editor/utils/clone";
import {
  createGeneratedHostedPublishingAdapter,
  resolvePlacementReadiness,
} from "@/features/publishing/api/generated-hosted-publishing-adapter";
import {
  HostedDraftConflictError,
  HostedDraftOfflineError,
} from "@/features/publishing/api/hosted-publishing-adapter";
import { createGeneratedDashboardClient } from "@/lib/api/generated-dashboard-client";
import { required } from "@/test/required";

const input = {
  document: cloneValue(
    required(EDITOR_TEMPLATES[0], "EDITOR_TEMPLATES[0]").document
  ),
  draftId: "draft_01",
  expectedRevision: 4,
  paywallId: "paywall_01",
  projectId: "project_01",
};

function draftEnvelope(revision: number) {
  return {
    data: {
      document: input.document,
      draft: {
        createdAt: "2026-07-22T12:00:00Z",
        createdByActorId: "actor_01",
        environmentId: "env_staging",
        id: input.draftId,
        paywallId: input.paywallId,
        projectId: input.projectId,
        protocolVersion: "0.2",
        revision,
        status: "active",
        updatedAt: "2026-07-22T12:05:00Z",
        updatedByActorId: "actor_01",
        validation: { errors: [], warnings: [] },
        validationStatus: "valid",
      },
    },
  };
}

describe("generated hosted publishing adapter", () => {
  it("requires a Placement binding to the Paywall being reviewed", () => {
    const placements = [
      {
        id: "placement_01",
        key: "onboarding",
        name: "Onboarding",
        status: "active" as const,
        binding: {
          environmentId: "env_staging",
          paywallId: "paywall_other",
          paywallName: "Other Paywall",
        },
      },
    ];

    expect(resolvePlacementReadiness(placements, "paywall_01")).toEqual([
      { bound: false, id: "placement_01", key: "onboarding" },
    ]);
  });

  it("copies a local document into the hosted Paywall identity without mutating the local source", async () => {
    let request: Request | undefined;
    const fetchImplementation = vi.fn((inputRequest: RequestInfo | URL) => {
      request = inputRequest as Request;
      return Promise.resolve(
        new Response(JSON.stringify(draftEnvelope(1)), {
          headers: { "Content-Type": "application/json" },
          status: 201,
        })
      );
    }) as typeof fetch;
    const adapter = createGeneratedHostedPublishingAdapter(
      createGeneratedDashboardClient(fetchImplementation)
    );
    const localDocument = cloneValue(input.document);

    await adapter.createDraft({
      document: localDocument,
      environmentId: "env_staging",
      paywallId: input.paywallId,
      projectId: input.projectId,
    });

    const body = (await request?.clone().json()) as {
      document: { id: string };
    };
    expect(body.document.id).toBe(input.paywallId);
    expect(localDocument.id).toBe(input.document.id);
  });

  it("reuses its idempotency key after an uncertain save and sends the strong Draft precondition", async () => {
    const requests: Request[] = [];
    const fetchImplementation = vi.fn((request: RequestInfo | URL) => {
      const normalized = request as Request;
      requests.push(normalized);
      if (requests.length === 1) {
        throw new TypeError("network unavailable");
      }
      return Promise.resolve(
        new Response(JSON.stringify(draftEnvelope(5)), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        })
      );
    }) as typeof fetch;
    const adapter = createGeneratedHostedPublishingAdapter(
      createGeneratedDashboardClient(fetchImplementation)
    );

    await expect(adapter.saveDraft(input)).rejects.toBeInstanceOf(
      HostedDraftOfflineError
    );
    await expect(adapter.saveDraft(input)).resolves.toMatchObject({
      revision: 5,
    });

    expect(requests).toHaveLength(2);
    expect(required(requests[0], "requests[0]").credentials).toBe("include");
    expect(required(requests[0], "requests[0]").headers.get("If-Match")).toBe(
      '"draft-draft_01-r4"'
    );
    expect(
      required(requests[0], "requests[0]").headers.get("Idempotency-Key")
    ).toBe(required(requests[1], "requests[1]").headers.get("Idempotency-Key"));
  });

  it("maps safe server conflict details into the editor conflict error", async () => {
    const fetchImplementation = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: "draft_revision_conflict",
              details: {
                currentRevision: 7,
                updatedAt: "2026-07-22T12:10:00Z",
                updatedByActorId: "actor_private",
              },
              message: "The Draft has a newer server revision.",
              requestId: "request_01",
            },
          }),
          { headers: { "Content-Type": "application/json" }, status: 412 }
        )
    ) as typeof fetch;
    const adapter = createGeneratedHostedPublishingAdapter(
      createGeneratedDashboardClient(fetchImplementation)
    );

    const error = await adapter
      .saveDraft(input)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HostedDraftConflictError);
    expect(error).toMatchObject({
      latestRevision: 7,
      serverUpdatedAt: "2026-07-22T12:10:00Z",
    });
    expect(error).not.toHaveProperty("updatedByActorId");
  });

  it("discovers an active Environment Draft and treats no active Draft as an empty result", async () => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(draftEnvelope(6)), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: "not_found",
              message: "No active Draft exists.",
              requestId: "req_02",
            },
          }),
          { headers: { "Content-Type": "application/json" }, status: 404 }
        )
      ) as typeof fetch;
    const adapter = createGeneratedHostedPublishingAdapter(
      createGeneratedDashboardClient(fetchImplementation)
    );
    const scope = {
      environmentId: "env_staging",
      paywallId: input.paywallId,
      projectId: input.projectId,
    };

    await expect(adapter.getActiveDraft(scope)).resolves.toMatchObject({
      id: input.draftId,
      revision: 6,
    });
    await expect(adapter.getActiveDraft(scope)).resolves.toBeNull();
  });
});
