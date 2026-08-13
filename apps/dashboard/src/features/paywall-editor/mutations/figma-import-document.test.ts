import { describe, expect, it } from "vitest";

import type { FigmaBundleImage } from "@/features/paywall-editor/mutations/figma-import";
import {
  insertFigmaBundleImages,
  resolveFigmaImagePlacement,
} from "@/features/paywall-editor/mutations/figma-import-document";
import type { MosaicDocument } from "@/features/paywall-editor/types/editor";
import { findNode } from "@/features/paywall-editor/utils/document-tree-traversal";
import { validatePaywallDocument } from "@/lib/mosaic-protocol";
import { required } from "@/test/required";
import canonicalFixture from "../../../../../../protocol/fixtures/v0.3/complete-paywall.json";

const canonicalDocument = canonicalFixture as MosaicDocument;
const ASSET_URL = "https://assets.example.com/mosaic/hero-shot.png";

function image(overrides: Partial<FigmaBundleImage> = {}): FigmaBundleImage {
  return {
    accessibilityLabel: "Hero artwork",
    bytesBase64: "",
    height: 600,
    id: "figma-hero",
    mimeType: "image/png",
    name: "Hero shot",
    placement: {
      childIndex: 1,
      parentStackId: "paywall-content",
      screenId: "offer",
    },
    scale: 2,
    width: 1200,
    ...overrides,
  };
}

function applied(uploads: { assetUrl: string; image: FigmaBundleImage }[]) {
  const result = insertFigmaBundleImages(canonicalDocument, uploads);
  if (!result.ok) {
    throw new Error(
      `Expected the insertion to apply: ${result.diagnostics[0]?.message}`
    );
  }
  return result;
}

describe("Figma image placement", () => {
  // Figma records where a layer sat; the paywall may have moved on. Dropping
  // the image, or trusting a stale index, both lose the author's work.
  it("clamps a child index past the end of the recorded parent", () => {
    const placement = resolveFigmaImagePlacement(canonicalDocument, {
      childIndex: 999,
      parentStackId: "paywall-content",
      screenId: "offer",
    });
    const parent = findNode(canonicalDocument, "paywall-content");
    if (parent?.type !== "stack") {
      throw new Error("Canonical fixture is missing its root stack");
    }
    expect(placement.location).toEqual({
      index: parent.children.length,
      parentId: "paywall-content",
    });
    expect(placement.notes[0]).toMatch(/outside "paywall-content"/);
  });

  it("appends to the screen root Stack when the recorded parent is gone", () => {
    const placement = resolveFigmaImagePlacement(canonicalDocument, {
      childIndex: 0,
      parentStackId: "deleted-stack",
      screenId: "details",
    });
    expect(placement.location.parentId).toBe("details-content");
    expect(placement.notes[0]).toMatch(/no longer in screen "details"/);
  });

  // A parent that still exists but on another screen would move the image to a
  // screen the designer never placed it on.
  it("refuses a parent that lives on a different screen than the placement", () => {
    const placement = resolveFigmaImagePlacement(canonicalDocument, {
      childIndex: 0,
      parentStackId: "details-content",
      screenId: "offer",
    });
    expect(placement.location.parentId).toBe("paywall-content");
    expect(placement.notes[0]).toMatch(/no longer in screen "offer"/);
  });

  it("falls back to the initial screen when the recorded screen is gone", () => {
    const placement = resolveFigmaImagePlacement(canonicalDocument, {
      childIndex: 0,
      parentStackId: "paywall-content",
      screenId: "deleted-screen",
    });
    expect(placement.location.parentId).toBe("paywall-content");
    expect(placement.notes[0]).toMatch(/is not in this paywall/);
  });
});

describe("Figma image insertion", () => {
  // The whole point of the hosted path: the paywall must still be publishable
  // after Studio has rewritten its assets, nodes, and catalogs.
  it("keeps the document valid after adding an Asset and an image node", () => {
    const result = applied([{ assetUrl: ASSET_URL, image: image() }]);
    expect(validatePaywallDocument(result.document).ok).toBe(true);

    const insertion = required(result.inserted[0], "result.inserted[0]");
    const asset = result.document.assets.find(
      (entry) => entry.id === insertion.assetId
    );
    expect(asset).toMatchObject({
      source: { type: "remote", url: ASSET_URL },
      type: "image",
    });

    const node = findNode(result.document, insertion.nodeId);
    if (node?.type !== "image") {
      throw new Error("Expected an inserted image node");
    }
    expect(node.assetId).toBe(insertion.assetId);
    expect(node.accessibility).toEqual({
      hidden: false,
      label: {
        default: "Hero artwork",
        localizationKey: expect.stringContaining("accessibility_label"),
      },
    });

    // Every locale must carry the new strings, or the document stops validating
    // the moment it is rendered in German.
    const labelKey = node.accessibility.hidden
      ? null
      : node.accessibility.label.localizationKey;
    expect(labelKey).not.toBeNull();
    for (const catalog of Object.values(result.document.localization.locales)) {
      expect(catalog.strings[String(labelKey)]).toBeDefined();
    }
  });

  it("marks an image with no accessibility label as decorative", () => {
    const result = applied([
      { assetUrl: ASSET_URL, image: image({ accessibilityLabel: "  " }) },
    ]);
    const node = findNode(
      result.document,
      required(result.inserted[0], "result.inserted[0]").nodeId
    );
    if (node?.type !== "image") {
      throw new Error("Expected an inserted image node");
    }
    expect(node.accessibility).toEqual({ hidden: true });
    expect(validatePaywallDocument(result.document).ok).toBe(true);
  });

  // A document-only import must be byte-identical to a plain JSON import, so
  // choosing no images cannot quietly normalise the author's paywall.
  it("applies a document-only import without rebuilding its metadata", () => {
    const result = applied([]);
    expect(result.document).toEqual(canonicalFixture);
    expect(result.inserted).toHaveLength(0);
  });

  // The one thing that must never happen: replacing a working paywall with one
  // that no longer validates.
  it("refuses to apply when the resulting document would not validate", () => {
    const result = insertFigmaBundleImages(canonicalDocument, [
      { assetUrl: "/uploads/hero-shot.png", image: image() },
    ]);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.diagnostics.length).toBeGreaterThan(0);
  });

  it("gives colliding image identifiers their own Asset and node ids", () => {
    const result = applied([
      { assetUrl: ASSET_URL, image: image({ id: "hero-image" }) },
      {
        assetUrl: "https://assets.example.com/mosaic/second.png",
        image: image({ id: "hero-image", name: "Second" }),
      },
    ]);
    const [first, second] = result.inserted;
    expect(first?.assetId).not.toBe(second?.assetId);
    expect(first?.nodeId).not.toBe(second?.nodeId);
    expect(validatePaywallDocument(result.document).ok).toBe(true);
  });
});
