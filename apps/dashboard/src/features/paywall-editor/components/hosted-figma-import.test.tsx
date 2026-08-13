import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PaywallEditorWorkspace } from "@/features/paywall-editor/components/paywall-editor-workspace";
import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates";
import { FIGMA_BUNDLE_FORMAT } from "@/features/paywall-editor/mutations/figma-import";
import type { MosaicDocument } from "@/features/paywall-editor/types/editor";
import type { StudioSource } from "@/features/paywall-editor/types/studio-source";
import type { HostedDraft } from "@/features/publishing/api/hosted-publishing-adapter";
import { HostedPublishingAdapterContext } from "@/features/publishing/api/use-hosted-publishing-adapter";
import { createTestHostedPublishingAdapter } from "@/test/hosted-publishing-adapter";
import { required } from "@/test/required";
import canonicalFixture from "../../../../../../protocol/fixtures/v0.4/complete-paywall.json";

const originalInnerWidth = window.innerWidth;

const hostedSource: StudioSource = {
  draftId: "draft_1",
  environmentId: "env_1",
  kind: "hosted",
  organizationId: "org_1",
  paywallId: "paywall_1",
  projectId: "project_1",
};

const serverDraft: HostedDraft = {
  document: required(EDITOR_TEMPLATES[0], "EDITOR_TEMPLATES[0]").document,
  environmentId: "env_1",
  id: "draft_1",
  paywallId: "paywall_1",
  projectId: "project_1",
  revision: 3,
  updatedAt: "2026-08-01T00:00:00Z",
};

function documentOnlyBundle(document: MosaicDocument) {
  return JSON.stringify({
    document,
    format: FIGMA_BUNDLE_FORMAT,
    formatVersion: 1,
    images: [],
    report: { skipped: [], warnings: [] },
  });
}

describe("hosted Studio Figma import", () => {
  beforeEach(() => {
    window.localStorage.clear();
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1200,
    });
    window.dispatchEvent(new Event("resize"));
    vi.stubGlobal("WebSocket", undefined);
  });

  afterEach(() => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: originalInnerWidth,
    });
    vi.unstubAllGlobals();
  });

  /**
   * Applying an import mints a new editable document id. When the hosted
   * workspace re-opened the server Draft on every change to that id, the
   * author's import was overwritten by the server copy on the very next
   * render — silent data loss with no error anywhere.
   */
  it("keeps an imported document instead of reloading the server Draft over it", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const adapter = createTestHostedPublishingAdapter({
      getDraft: () => Promise.resolve(serverDraft),
      saveDraft: () => Promise.resolve(serverDraft),
    });

    render(
      <QueryClientProvider client={queryClient}>
        <HostedPublishingAdapterContext.Provider value={adapter}>
          <PaywallEditorWorkspace source={hostedSource} />
        </HostedPublishingAdapterContext.Provider>
      </QueryClientProvider>
    );

    await screen.findByTestId("studio-editor-shell");
    fireEvent.change(screen.getByLabelText("Import Mosaic JSON file"), {
      target: {
        files: [
          new File(
            [documentOnlyBundle(canonicalFixture as MosaicDocument)],
            "offer.mosaic-figma.json",
            { type: "application/json" }
          ),
        ],
      },
    });

    fireEvent.click(
      await screen.findByRole("button", { name: "Import paywall only" })
    );

    expect(
      await screen.findByText("Unlock every Mosaic Pro feature")
    ).toBeVisible();
    // The server Draft must not win a later render.
    await waitFor(() =>
      expect(screen.getByText("Unlock every Mosaic Pro feature")).toBeVisible()
    );
  });
});
