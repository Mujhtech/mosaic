import { describe, expect, it, vi } from "vitest";

import { createGeneratedPlacementDecisionsAdapter } from "@/features/placement-decisions/api/generated-placement-decisions-adapter";
import type { PlacementRuleSetDraft } from "@/features/placement-decisions/types/placement-decision";
import { createGeneratedDashboardClient } from "@/lib/api/generated-dashboard-client";

const scope = {
  environmentId: "env-staging",
  placementId: "placement-export",
  projectId: "project",
};

const sourceDraft: PlacementRuleSetDraft = {
  assignmentPolicy: "installation",
  defaultOutcome: { type: "no_paywall" },
  environmentId: scope.environmentId,
  fallbacks: [],
  id: "draft",
  placementId: scope.placementId,
  revision: 7,
  ruleSetId: "rule-set",
  rules: [],
  updatedAt: "2026-07-26T00:00:00Z",
};

describe("generated Placement decisions adapter", () => {
  it("archives the active Rule Set through the generated recovery endpoint", async () => {
    let archiveRequest: Request | undefined;
    const fetchImplementation = vi.fn(async (input: RequestInfo | URL) => {
      archiveRequest = input as Request;
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    const adapter = createGeneratedPlacementDecisionsAdapter(
      createGeneratedDashboardClient(fetchImplementation)
    );

    await adapter.archiveRuleSet(scope, "rule-set");

    expect(archiveRequest?.method).toBe("POST");
    expect(new URL(archiveRequest!.url).pathname).toBe(
      "/v1/projects/project/environments/env-staging/placements/placement-export/rule-sets/rule-set/archive"
    );
  });

  it("saves an optimistic-concurrency Draft through the generated REST client", async () => {
    let updateRequest: Request | undefined;
    const fetchImplementation = vi.fn(async (input: RequestInfo | URL) => {
      const request = input as Request;
      const url = new URL(request.url);
      if (url.pathname.endsWith("/placement-attributes")) {
        return response({ data: { items: [] } });
      }
      if (url.pathname.endsWith("/environments")) {
        return response({
          data: {
            items: [
              {
                createdAt: "2026-07-26T00:00:00Z",
                id: scope.environmentId,
                key: "staging",
                mode: "staging",
                name: "Staging",
                projectId: scope.projectId,
                updatedAt: "2026-07-26T00:00:00Z",
              },
            ],
          },
        });
      }
      if (url.pathname.endsWith("/placements")) {
        return response({
          data: {
            items: [
              {
                createdAt: "2026-07-26T00:00:00Z",
                id: scope.placementId,
                key: "export_pdf",
                name: "Export PDF",
                projectId: scope.projectId,
                status: "active",
                updatedAt: "2026-07-26T00:00:00Z",
              },
            ],
            page: {},
          },
        });
      }
      updateRequest = request;
      return response({
        data: {
          document: await request
            .clone()
            .json()
            .then((body) => body.document),
          draft: {
            createdAt: "2026-07-26T00:00:00Z",
            createdByActorId: "actor",
            environmentId: scope.environmentId,
            id: sourceDraft.id,
            projectId: scope.projectId,
            revision: 8,
            ruleSetId: sourceDraft.ruleSetId,
            status: "active",
            updatedAt: "2026-07-26T01:00:00Z",
            updatedByActorId: "actor",
          },
          ruleSet: {
            contractVersion: "1",
            createdAt: "2026-07-26T00:00:00Z",
            createdByActorId: "actor",
            currentDraftId: sourceDraft.id,
            environmentId: scope.environmentId,
            id: sourceDraft.ruleSetId,
            placementId: scope.placementId,
            projectId: scope.projectId,
            status: "active",
            updatedAt: "2026-07-26T01:00:00Z",
          },
          validation: { issues: [], valid: true },
        },
      });
    }) as typeof fetch;
    const adapter = createGeneratedPlacementDecisionsAdapter(
      createGeneratedDashboardClient(fetchImplementation)
    );

    const saved = await adapter.saveDraft(scope, {
      draft: sourceDraft,
      idempotencyKey: "mutation-key",
      revision: sourceDraft.revision,
    });

    expect(saved.revision).toBe(8);
    expect(updateRequest?.headers.get("If-Match")).toBe(
      '"ruleset-draft:draft:7"'
    );
    expect(updateRequest?.headers.get("Idempotency-Key")).toBe("mutation-key");
    const body = (await updateRequest?.clone().json()) as {
      document: {
        placementDecisionVersion: string;
        ruleSet: Record<string, unknown>;
      };
    };
    expect(body.document.placementDecisionVersion).toBe("1");
    expect(body.document.ruleSet).toMatchObject({
      defaultOutcome: { type: "no_paywall" },
      placementKey: "export_pdf",
    });
    expect(JSON.stringify(body)).not.toContain("customer");
  });
});

function response(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}
