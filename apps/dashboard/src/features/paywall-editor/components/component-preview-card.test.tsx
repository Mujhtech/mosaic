import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { describe, expect, it } from "vitest";

import { ComponentLibrary } from "@/features/paywall-editor/components/component-library";
import { constraintSentences } from "@/features/paywall-editor/constants/component-constraints";
import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates";
import {
  EditorStoreProvider,
  useEditorActions,
} from "@/features/paywall-editor/stores/editor-store-context";
import { StudioWorkspaceStoreProvider } from "@/features/paywall-editor/stores/studio-workspace-store-context";
import { flattenDocument } from "@/features/paywall-editor/utils/document-tree-traversal";
import { required } from "@/test/required";

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

/**
 * Selects the first Product Card in the document. A Product Card accepts only
 * passive product content, so Tabs genuinely cannot be inserted there.
 */
function SelectProductCard() {
  const editor = useEditorActions();

  useLayoutEffect(() => {
    const { document: snapshot } = editor.getSnapshot();
    if (!snapshot) {
      return;
    }
    const card = flattenDocument(snapshot)
      .map((entry) => entry.node)
      .find((node) => node.type === "productCard");
    if (card) {
      editor.selectComponent(card.id);
    }
  }, [editor]);

  return null;
}

function renderLibrary(extra?: React.ReactNode) {
  render(
    <StudioWorkspaceStoreProvider storage={null}>
      <EditorStoreProvider>
        <InitializeDocument />
        {extra}
        <ComponentLibrary />
      </EditorStoreProvider>
    </StudioWorkspaceStoreProvider>
  );
}

function catalogCard(label: string) {
  return screen.getByRole("button", { name: new RegExp(`^${label}\\b`, "i") });
}

describe("component library preview card", () => {
  it("opens on keyboard focus, not only on pointer hover, and closes on Escape", async () => {
    renderLibrary();
    await waitFor(() => expect(catalogCard("Tabs")).toBeVisible());

    // Real focus, not a synthetic focus event: the card opens keyboard focus
    // itself rather than waiting out the pointer-hover delay.
    catalogCard("Tabs").focus();

    const card = await screen.findByLabelText("Tabs preview");
    expect(card).toBeVisible();

    fireEvent.keyDown(card, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByLabelText("Tabs preview")).not.toBeInTheDocument()
    );
  });

  it("previews the node type insertion actually produces, with the schema's constraints", async () => {
    renderLibrary();
    await waitFor(() => expect(catalogCard("Timeline")).toBeVisible());

    fireEvent.focus(catalogCard("Timeline"));

    const card = await screen.findByLabelText("Timeline preview");
    expect(
      card.querySelector('[data-preview-node-type="timeline"]')
    ).not.toBeNull();
    for (const sentence of constraintSentences("timeline")) {
      expect(card).toHaveTextContent(sentence);
    }
    expect(card).toHaveTextContent("2–12 ordered entries.");
  });

  it("explains a refusal instead of previewing a component that cannot be inserted here", async () => {
    renderLibrary(<SelectProductCard />);
    await waitFor(() => expect(catalogCard("Tabs")).toBeVisible());

    fireEvent.focus(catalogCard("Tabs"));

    const card = await screen.findByLabelText("Tabs preview");
    await waitFor(() =>
      expect(card).toHaveTextContent(
        "The component subtree is not a valid Protocol 0.3 tree."
      )
    );
    expect(card.querySelector('[data-preview-node-type="tabs"]')).toBeNull();
  });
});
