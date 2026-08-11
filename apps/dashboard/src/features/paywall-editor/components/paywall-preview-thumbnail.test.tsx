import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PaywallPreviewThumbnail } from "@/features/paywall-editor/components/paywall-preview-thumbnail";
import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates";
import { upgradeDocumentToV04 } from "@/features/paywall-editor/mutations/upgrade-to-v04";
import type { MosaicDocument } from "@/features/paywall-editor/types/editor";
import { cloneValue } from "@/features/paywall-editor/utils/clone";
import {
  flattenDocument,
  updateNode,
} from "@/features/paywall-editor/utils/document-tree-traversal";
import { withNodeParts } from "@/features/paywall-editor/utils/document-version";
import { required } from "@/test/required";

const TEMPLATE = required(EDITOR_TEMPLATES[0], "EDITOR_TEMPLATES[0]").document;
const BENEFITS_TEMPLATE = required(
  EDITOR_TEMPLATES.find((entry) => entry.id === "benefits"),
  "benefits template"
).document;

describe("PaywallPreviewThumbnail", () => {
  it("draws the initial screen in the document's own default locale", () => {
    // The template declares en, de and ar catalogs and defaults to en. A
    // thumbnail that picked the wrong catalog would still look like a Paywall,
    // which is exactly why the assertion names both the expected and the
    // rejected string.
    const { container } = render(
      <PaywallPreviewThumbnail document={TEMPLATE} width={116} />
    );

    expect(
      screen.getByText("Build a paywall people understand")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Baue eine Paywall, die verstanden wird")
    ).not.toBeInTheDocument();
    expect(container.querySelector('[dir="ltr"]')).not.toBeNull();
  });

  it("stays decorative and inert, so a card keeps exactly one accessible name", () => {
    // Every control inside a Paywall design is a real control. Left reachable,
    // a list of twenty cards would hand a keyboard user hundreds of tab stops
    // and a screen reader twenty duplicate readings of the same Paywall.
    render(<PaywallPreviewThumbnail document={TEMPLATE} width={116} />);

    const frame = screen.getByTestId("paywall-preview-thumbnail");
    expect(frame).toHaveAttribute("aria-hidden", "true");
    expect(frame).toHaveAttribute("inert");
  });

  it("throws for a document with no screen to draw, rather than rendering an empty frame", () => {
    // The caller's boundary turns this into the "no preview" placeholder. The
    // contract worth pinning is that a screenless document is refused instead
    // of quietly producing a blank phone that reads as a real design.
    const screenless = {
      ...TEMPLATE,
      screens: [],
    } as unknown as MosaicDocument;

    expect(() =>
      render(<PaywallPreviewThumbnail document={screenless} width={116} />)
    ).toThrow();
  });
  /**
   * A 0.4 document must draw exactly what its 0.3 source drew. This is the
   * terminal-state rule made testable at the canvas: the upgrade is additive,
   * so the static rendering is the assertion that it changed nothing.
   */
  it("draws an upgraded 0.4 document exactly as its 0.3 source", () => {
    const upgraded = upgradeDocumentToV04(cloneValue(BENEFITS_TEMPLATE));

    const v03 = render(
      <PaywallPreviewThumbnail document={BENEFITS_TEMPLATE} width={116} />
    );
    const v03Text = required(v03.container.textContent, "0.3 thumbnail text");
    v03.unmount();

    const v04 = render(
      <PaywallPreviewThumbnail document={upgraded} width={116} />
    );

    expect(v04.container.textContent).toBe(v03Text);
  });

  /**
   * The marker consolidation is the one content change the upgrade makes, so a
   * 0.4 Feature List has to render through the shared marker union rather than
   * the hardcoded tick the 0.3 path used. The negated item is the case that
   * would silently keep drawing a tick if the item override were ignored --
   * which would show "not included" as included.
   */
  it("draws a 0.4 Feature List item marker override", () => {
    const upgraded = upgradeDocumentToV04(cloneValue(BENEFITS_TEMPLATE));
    const featureList = flattenDocument(upgraded).find(
      (entry) => entry.node.type === "featureList"
    );
    const list = required(featureList, "feature list").node;
    if (list.type !== "featureList") {
      throw new Error("Expected a Feature List");
    }
    const [firstItem] = list.items;
    const withOverride = updateNode(upgraded, list.id, (node) =>
      node.type === "featureList"
        ? withNodeParts(node, {
            items: node.items.map((item, index) =>
              index === 0
                ? { ...item, marker: { kind: "icon", name: "close" } }
                : item
            ),
          })
        : node
    );
    expect(firstItem).toBeDefined();

    const { container } = render(
      <PaywallPreviewThumbnail document={withOverride} width={116} />
    );

    expect(container.textContent).toContain("\u00d7");
  });
});
