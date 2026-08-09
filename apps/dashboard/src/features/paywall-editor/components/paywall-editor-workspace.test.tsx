import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useCallback, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PaywallEditorProviders,
  PaywallEditorWorkspace,
} from "@/features/paywall-editor/components/paywall-editor-workspace";
import {
  MAX_FIGMA_BUNDLE_BYTES,
  MAX_LOCAL_PROJECT_BYTES,
} from "@/features/paywall-editor/constants/editor-constants";
import { STUDIO_WORKSPACE_STORAGE_KEY } from "@/features/paywall-editor/constants/studio-workspace";
import { FIGMA_BUNDLE_FORMAT } from "@/features/paywall-editor/mutations/figma-import";
import { useEditorActions } from "@/features/paywall-editor/stores/editor-store-context";
import type { StudioWorkspaceSnapshot } from "@/features/paywall-editor/stores/studio-workspace-store";
import {
  useStudioWorkspaceActions,
  useStudioWorkspaceSelector,
} from "@/features/paywall-editor/stores/studio-workspace-store-context";
import canonicalFixture from "../../../../../../protocol/fixtures/v0.3/complete-paywall.json";

const selectSelectedTool = (snapshot: StudioWorkspaceSnapshot) =>
  snapshot.preferences.selectedTool;

function importFile(name: string, contents: string, size?: number) {
  const file = new File([contents], name, { type: "application/json" });
  if (size !== undefined) {
    Object.defineProperty(file, "size", { value: size });
  }
  fireEvent.change(screen.getByLabelText("Import Mosaic JSON"), {
    target: { files: [file] },
  });
}

function figmaBundle() {
  return JSON.stringify({
    document: canonicalFixture,
    format: FIGMA_BUNDLE_FORMAT,
    formatVersion: 1,
    images: [
      {
        accessibilityLabel: "Hero artwork",
        bytesBase64: "iVBORw0KGgo=",
        height: 600,
        id: "hero-shot",
        mimeType: "image/png",
        name: "Hero shot",
        placement: {
          childIndex: 1,
          parentStackId: "paywall-content",
          screenId: "offer",
        },
        scale: 2,
        width: 1200,
      },
    ],
    report: { skipped: [], warnings: [] },
  });
}
const originalInnerWidth = window.innerWidth;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

function setDesktopRequiredViewport() {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 700,
  });
  window.dispatchEvent(new Event("resize"));
}

describe("PaywallEditorWorkspace", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setDesktopRequiredViewport();
    vi.stubGlobal("WebSocket", undefined);
  });

  afterEach(() => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: originalInnerWidth,
    });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: originalCreateObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: originalRevokeObjectURL,
    });
    vi.unstubAllGlobals();
  });

  it("keeps the editor provider stable when workspace preferences change", () => {
    const editorStores = new Set<ReturnType<typeof useEditorActions>>();
    let mounts = 0;

    function ProviderProbe() {
      const editor = useEditorActions();
      const workspace = useStudioWorkspaceActions();
      const handleClick = useCallback(
        () => workspace.setSelectedTool("components"),
        [workspace]
      );
      const selectedTool = useStudioWorkspaceSelector(selectSelectedTool);
      editorStores.add(editor);

      useEffect(() => {
        mounts += 1;
      }, []);

      return (
        <button onClick={handleClick} type="button">
          {selectedTool}
        </button>
      );
    }

    render(
      <PaywallEditorProviders>
        <ProviderProbe />
      </PaywallEditorProviders>
    );

    fireEvent.click(screen.getByRole("button", { name: "layers" }));
    expect(screen.getByRole("button", { name: "components" })).toBeVisible();
    expect(editorStores.size).toBe(1);
    expect(mounts).toBe(1);
  });

  it("opens Templates in place from the Studio tool rail without leaving the editor", async () => {
    const confirm = vi.spyOn(window, "confirm");
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1200,
    });
    window.dispatchEvent(new Event("resize"));
    render(<PaywallEditorWorkspace />);

    fireEvent.click(screen.getByRole("button", { name: /Focused offer/ }));
    await screen.findByTestId("studio-editor-shell");
    expect(screen.getByTestId("studio-editor-shell")).toHaveAttribute(
      "data-studio-mode",
      "local"
    );
    expect(screen.getByText(/Saving locally|Saved locally/)).toBeVisible();
    expect(screen.queryByText(/hosted Draft/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Templates" }));

    await waitFor(() =>
      expect(
        JSON.parse(
          window.localStorage.getItem(STUDIO_WORKSPACE_STORAGE_KEY) ?? "null"
        )
      ).toMatchObject({ selectedTool: "templates" })
    );
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByTestId("studio-editor-shell")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Start with Focused offer/ })
    ).not.toBeInTheDocument();
  });

  it("retains a working local export in the sub-768 desktop fallback", async () => {
    const createObjectURL = vi.fn((_blob: Blob) => "blob:mosaic-export");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
      /* stub for a browser API jsdom does not implement */
    });
    render(<PaywallEditorWorkspace />);

    fireEvent.click(screen.getByRole("button", { name: /Focused offer/ }));
    await screen.findByTestId("studio-desktop-required");
    fireEvent.click(screen.getByRole("button", { name: "Export local draft" }));

    await waitFor(() => expect(createObjectURL).toHaveBeenCalledOnce());
    expect(createObjectURL.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mosaic-export");
    expect(
      screen.queryByRole("button", { name: /^save$/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^publish$/i })
    ).not.toBeInTheDocument();
  });

  // A bundle that fell through to the plain importer would be rejected as an
  // unrecognised document, and the plugin's conversion report would never be
  // seen.
  it("routes a Figma export bundle to the review dialog and imports its document", async () => {
    render(<PaywallEditorWorkspace />);
    importFile("offer.mosaic-figma.json", figmaBundle());

    expect(
      await screen.findByRole("heading", { name: "Review Figma import" })
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: /Images not imported \(1\)/ })
    ).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", { name: "Import paywall only" })
    );
    await screen.findByTestId("studio-desktop-required");
  });

  // The bundle's larger cap must not become the cap for every import.
  it("keeps plain protocol JSON at the one-megabyte limit", async () => {
    render(<PaywallEditorWorkspace />);
    importFile(
      "offer.mosaic.json",
      JSON.stringify(canonicalFixture),
      MAX_LOCAL_PROJECT_BYTES + 1
    );

    expect(
      await screen.findByText("Choose a Mosaic file under 1 MB.")
    ).toBeVisible();
  });

  it("refuses any import above the bundle limit before reading it", async () => {
    render(<PaywallEditorWorkspace />);
    importFile("huge.mosaic-figma.json", "{}", MAX_FIGMA_BUNDLE_BYTES + 1);

    expect(
      await screen.findByText("Choose a Mosaic file under 20 MB.")
    ).toBeVisible();
  });
});
