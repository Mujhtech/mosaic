import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useCallback, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PaywallEditorProviders,
  PaywallEditorWorkspace,
} from "@/features/paywall-editor/components/paywall-editor-workspace";
import { STUDIO_WORKSPACE_STORAGE_KEY } from "@/features/paywall-editor/constants/studio-workspace";
import { useEditorActions } from "@/features/paywall-editor/stores/editor-store-context";
import type { StudioWorkspaceSnapshot } from "@/features/paywall-editor/stores/studio-workspace-store";
import {
  useStudioWorkspaceActions,
  useStudioWorkspaceSelector,
} from "@/features/paywall-editor/stores/studio-workspace-store-context";

const selectSelectedTool = (snapshot: StudioWorkspaceSnapshot) =>
  snapshot.preferences.selectedTool;
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
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
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
});
