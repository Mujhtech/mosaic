import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { ComponentLibrary } from "@/features/paywall-editor/components/component-library";
import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates";
import {
  EditorStoreProvider,
  useEditorActions,
} from "@/features/paywall-editor/stores/editor-store-context";
import { StudioWorkspaceStoreProvider } from "@/features/paywall-editor/stores/studio-workspace-store-context";
import { required } from "@/test/required";

/**
 * The canvas renderer is forced to throw. The risk this covers is the one this
 * branch exists for: a preview that cannot render must say so, rather than
 * leaving a blank frame in the card or taking the component library — and with
 * it the editor — down with it.
 */
vi.mock("@/features/paywall-editor/components/canvas-preview-node", () => ({
  PreviewNode: () => {
    throw new Error("preview renderer failed");
  },
}));

function InitializeDocument() {
  const editor = useEditorActions();

  useLayoutEffect(() => {
    if (editor.getSnapshot().document) {
      return;
    }
    editor.loadTemplate(
      required(EDITOR_TEMPLATES[0], "EDITOR_TEMPLATES[0]").document
    );
  }, [editor]);

  return null;
}

function catalogCard(label: string) {
  return screen.getByRole("button", { name: new RegExp(`^${label}\\b`, "i") });
}

beforeAll(() => {
  // React re-logs the error the boundary already handled.
  vi.spyOn(console, "error").mockImplementation(() => {
    // intentionally silenced
  });
});

describe("component preview card render failure", () => {
  it("states a reason instead of an empty frame, and leaves the library usable", async () => {
    render(
      <StudioWorkspaceStoreProvider storage={null}>
        <EditorStoreProvider>
          <InitializeDocument />
          <ComponentLibrary />
        </EditorStoreProvider>
      </StudioWorkspaceStoreProvider>
    );
    await waitFor(() => expect(catalogCard("Award")).toBeVisible());

    fireEvent.focus(catalogCard("Award"));

    const card = await screen.findByLabelText("Award preview");
    await waitFor(() =>
      expect(card).toHaveTextContent(
        "Studio could not render Award starting content in this document."
      )
    );
    expect(catalogCard("Text")).toBeVisible();
  });
});
