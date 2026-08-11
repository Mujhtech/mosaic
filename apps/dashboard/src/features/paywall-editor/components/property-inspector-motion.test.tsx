import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InspectorHarness } from "@/features/paywall-editor/components/property-inspector-test-support";
import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates";
import { upgradeDocumentToV04 } from "@/features/paywall-editor/mutations/upgrade-to-v04";
import { EditorStoreProvider } from "@/features/paywall-editor/stores/editor-store-context";
import { StudioWorkspaceStoreProvider } from "@/features/paywall-editor/stores/studio-workspace-store-context";
import type { MosaicDocument } from "@/features/paywall-editor/types/editor";
import { cloneValue } from "@/features/paywall-editor/utils/clone";
import { required } from "@/test/required";

function v04Template() {
  return upgradeDocumentToV04(
    cloneValue(required(EDITOR_TEMPLATES[0], "EDITOR_TEMPLATES[0]").document)
  );
}

function v03Template() {
  return cloneValue(
    required(EDITOR_TEMPLATES[0], "EDITOR_TEMPLATES[0]").document
  );
}

function renderMotionInspector(selection: string, document: MosaicDocument) {
  return render(
    <StudioWorkspaceStoreProvider storage={null}>
      <EditorStoreProvider>
        <InspectorHarness initialDocument={document} selection={selection} />
      </EditorStoreProvider>
    </StudioWorkspaceStoreProvider>
  );
}

function motionSection() {
  return document.querySelector('[data-inspector-section="Motion"]');
}

describe("motion inspector gating", () => {
  /**
   * Motion is 0.4-only. Offering an entrance control on a 0.3 document would
   * author a member the 0.3 schema rejects, so the whole section stays away
   * rather than appearing and failing validation on save.
   */
  it("offers no Motion section on a 0.3 document", () => {
    renderMotionInspector("purchase", v03Template());

    expect(motionSection()).toBeNull();
  });

  /**
   * The contract allows `loop` on a button and nowhere else, and `selection` on
   * the two components that own selection state. Gating in the inspector is the
   * only thing standing between an author and a document-rejecting combination
   * that no other surface would explain, so each gate is asserted from both
   * sides.
   */
  it("offers the pulse only on a button", () => {
    const { unmount } = renderMotionInspector("purchase", v04Template());
    expect(motionSection()).not.toBeNull();
    expect(
      document.querySelector('[data-property-address="motion.loop"]')
    ).not.toBeNull();
    unmount();

    renderMotionInspector("plans", v04Template());
    expect(
      document.querySelector('[data-property-address="motion.loop"]')
    ).toBeNull();
  });

  it("offers the selection curve only on a product selector or tabs", () => {
    const { unmount } = renderMotionInspector("plans", v04Template());
    expect(
      document.querySelector('[data-property-address="motion.selection"]')
    ).not.toBeNull();
    unmount();

    renderMotionInspector("purchase", v04Template());
    expect(
      document.querySelector('[data-property-address="motion.selection"]')
    ).toBeNull();
  });

  /** Every node may carry an entrance, so the control is always present. */
  it("offers the entrance on any node", () => {
    renderMotionInspector("plans", v04Template());

    expect(
      document.querySelector('[data-property-address="motion.appear"]')
    ).not.toBeNull();
  });
});
