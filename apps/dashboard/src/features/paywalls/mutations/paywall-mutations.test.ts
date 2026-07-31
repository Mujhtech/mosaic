import { describe, expect, it, vi } from "vitest";

import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates";
import {
  createPaywallWithDraft,
  PaywallCreatedWithoutDraftError,
} from "@/features/paywalls/mutations/paywall-mutations";
import type { HostedPublishingAdapter } from "@/features/publishing/api/hosted-publishing-adapter";

describe("Paywall and first Draft creation", () => {
  it("retries the Draft against the Paywall preserved after a partial failure", async () => {
    const paywall = {
      drafts: [],
      id: "paywall_01",
      key: "onboarding",
      name: "Onboarding",
      projectId: "project_01",
      status: "active" as const,
      updatedAt: "2026-07-22T12:00:00Z",
      versions: [],
    };
    const draft = {
      document: EDITOR_TEMPLATES[0]!.document,
      environmentId: "env_01",
      id: "draft_01",
      paywallId: paywall.id,
      projectId: paywall.projectId,
      revision: 1,
      updatedAt: "2026-07-22T12:01:00Z",
    };
    const adapter = {
      createDraft: vi
        .fn()
        .mockRejectedValueOnce(new Error("temporary failure"))
        .mockResolvedValueOnce(draft),
      createPaywall: vi.fn().mockResolvedValue(paywall),
    } as unknown as HostedPublishingAdapter;
    const request = {
      document: EDITOR_TEMPLATES[0]!.document,
      key: paywall.key,
      name: paywall.name,
    };
    const scope = { environmentId: "env_01", projectId: paywall.projectId };

    const partial = await createPaywallWithDraft(request, scope, adapter).catch(
      (error: unknown) => error
    );
    expect(partial).toBeInstanceOf(PaywallCreatedWithoutDraftError);

    await expect(
      createPaywallWithDraft(
        {
          ...request,
          existingPaywall: (partial as PaywallCreatedWithoutDraftError).paywall,
        },
        scope,
        adapter
      )
    ).resolves.toEqual({ draft, paywall });
    expect(adapter.createPaywall).toHaveBeenCalledOnce();
    expect(adapter.createDraft).toHaveBeenCalledTimes(2);
  });
});
