import { describe, expect, it, vi } from "vitest";

import {
  createPlacementAndBind,
  PlacementCreatedWithoutBindingError,
} from "@/features/placements/mutations/placement-mutations";
import type { HostedPublishingAdapter } from "@/features/publishing/api/hosted-publishing-adapter";

describe("Placement creation and Environment binding", () => {
  it("creates a Placement without forcing a default Paywall binding", async () => {
    const placement = {
      id: "placement_unbound",
      key: "export_pdf",
      name: "Export PDF",
      status: "active" as const,
    };
    const adapter = {
      bindPlacement: vi.fn(),
      createPlacement: vi.fn().mockResolvedValue(placement),
    } as unknown as HostedPublishingAdapter;

    await expect(
      createPlacementAndBind(
        { key: placement.key, name: placement.name },
        { environmentId: "env_01", projectId: "project_01" },
        adapter
      )
    ).resolves.toEqual(placement);
    expect(adapter.bindPlacement).not.toHaveBeenCalled();
  });

  it("retries binding against the Placement preserved after a partial failure", async () => {
    const placement = {
      id: "placement_01",
      key: "onboarding",
      name: "Onboarding",
      status: "active" as const,
    };
    const paywall = {
      id: "paywall_01",
      key: "onboarding_offer",
      name: "Onboarding offer",
      status: "active" as const,
      updatedAt: "2026-07-22T12:00:00Z",
    };
    const adapter = {
      bindPlacement: vi
        .fn()
        .mockRejectedValueOnce(new Error("temporary failure"))
        .mockResolvedValueOnce({}),
      createPlacement: vi.fn().mockResolvedValue(placement),
    } as unknown as HostedPublishingAdapter;
    const scope = { environmentId: "env_01", projectId: "project_01" };
    const request = { key: placement.key, name: placement.name, paywall };

    const partial = await createPlacementAndBind(request, scope, adapter).catch(
      (error: unknown) => error
    );
    expect(partial).toBeInstanceOf(PlacementCreatedWithoutBindingError);

    await expect(
      createPlacementAndBind(
        {
          ...request,
          existingPlacement: (partial as PlacementCreatedWithoutBindingError)
            .placement,
        },
        scope,
        adapter
      )
    ).resolves.toMatchObject({ binding: { paywallId: paywall.id } });
    expect(adapter.createPlacement).toHaveBeenCalledOnce();
    expect(adapter.bindPlacement).toHaveBeenCalledTimes(2);
  });
});
