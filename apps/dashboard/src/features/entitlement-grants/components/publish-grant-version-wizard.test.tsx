import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PublishGrantVersionWizard } from "@/features/entitlement-grants/components/publish-grant-version-wizard";
import type {
  Entitlement,
  GrantVersionImpact,
  Product,
  PublishGrantVersionRequest,
} from "@/generated/api";

const products = [
  {
    createdAt: "2026-01-01T00:00:00Z",
    id: "prod_01",
    internalName: "Pro monthly",
    key: "pro_monthly",
    metadataSource: "manual",
    projectId: "proj_01",
    readiness: "ready",
    status: "active",
    type: "subscription",
    updatedAt: "2026-01-01T00:00:00Z",
  },
] as unknown as Product[];

const entitlements = [
  {
    createdAt: "2026-01-01T00:00:00Z",
    id: "ent_01",
    key: "pro",
    name: "Pro",
    projectId: "proj_01",
    updatedAt: "2026-01-01T00:00:00Z",
  },
] as unknown as Entitlement[];

type PreviewFn = (
  proposal: PublishGrantVersionRequest
) => Promise<GrantVersionImpact | undefined>;
type PublishFn = (proposal: PublishGrantVersionRequest) => Promise<void>;

function renderWizard(
  overrides: { onPreview?: PreviewFn; onPublish?: PublishFn } = {}
) {
  const onPreview = vi.fn<PreviewFn>(
    overrides.onPreview ??
      (async () => ({ additiveSuperset: true, impactedActiveSources: 12 }))
  );
  const onPublish = vi.fn<PublishFn>(
    overrides.onPublish ?? (async () => undefined)
  );
  render(
    <PublishGrantVersionWizard
      canManage
      entitlementId="ent_01"
      entitlements={entitlements}
      onPreview={onPreview}
      onPublish={onPublish}
      productId="prod_01"
      products={products}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "Create new version" }));
  return { onPreview, onPublish };
}

/**
 * This protects the wiring the pure gate cannot: that the wizard actually
 * consumes it.
 *
 * The realistic failure is a Publish button rendered beside the shape fields, or
 * enabled from a preview taken before the operator edited the policy. Either
 * one lets a change that could remove access from paying customers be published
 * without the one number — `impactedActiveSources` — that describes how many.
 */
describe("publish grant version wizard", () => {
  it("offers no publish control until the impact of this proposal has been previewed", async () => {
    const { onPreview } = renderWizard();

    expect(
      screen.queryByRole("button", { name: /Publish new version/ })
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Preview impact" }));
    await waitFor(() => expect(onPreview).toHaveBeenCalledTimes(1));

    // Step two states the blast radius and still does not publish.
    expect(
      await screen.findByText(/12 purchases currently granting access/)
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Publish new version/ })
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Continue to publish" })
    );
    const publish = await screen.findByRole("button", {
      name: /Publish new version/,
    });
    // A reason is required before the version can be written.
    expect(publish).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Reason for this change"), {
      target: { value: "Grace access was never meant to be off." },
    });
    await waitFor(() => expect(publish).not.toBeDisabled());
  });

  it("discards the preview when the proposal is edited afterwards", async () => {
    const { onPreview } = renderWizard();

    fireEvent.click(screen.getByRole("button", { name: "Preview impact" }));
    await waitFor(() => expect(onPreview).toHaveBeenCalled());
    fireEvent.click(
      await screen.findByRole("button", { name: "Back to shape" })
    );

    // Widening the policy makes the number the operator was shown wrong, so the
    // preview and every downstream step are withdrawn.
    fireEvent.click(screen.getByLabelText(/Billing retry/));

    expect(
      screen.queryByText(/purchases currently granting access/)
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Preview impact" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Publish new version/ })
    ).not.toBeInTheDocument();
  });

  it("refuses a retroactive narrowing the publish call would reject", async () => {
    renderWizard({
      onPreview: async () => ({
        additiveSuperset: false,
        impactedActiveSources: 340,
        narrowingCode: "grace_access_narrowed",
      }),
    });

    fireEvent.click(screen.getByRole("button", { name: "Preview impact" }));

    expect(
      await screen.findByText("Publish would be refused")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Continue to publish" })
    ).toBeDisabled();
  });
});
