import { describe, expect, it } from "vitest";
import { validatePaywallDocument } from "../../../protocol/browser/index.js";
import { toBase64 } from "./base64.js";
import {
  assembleBundle,
  BUNDLE_FORMAT,
  BUNDLE_FORMAT_VERSION,
  IMAGE_SCALE,
  MAX_BUNDLE_BYTES,
  MAX_IMAGE_BYTES,
  pngDimensions,
  type RenderedImage,
} from "./bundle.js";
import { mapDocument, type MapResult } from "./mapper/map-document.js";
import {
  box,
  frame,
  imagePaint,
  solid,
  text,
  unsupported,
} from "./mapper/test-support.js";

/** A PNG header carrying real dimensions, followed by `padding` filler bytes. */
function png(width: number, height: number, padding = 0): Uint8Array {
  const bytes = new Uint8Array(24 + padding);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const writeUint32 = (offset: number, value: number) => {
    bytes[offset] = (value >>> 24) & 0xff;
    bytes[offset + 1] = (value >>> 16) & 0xff;
    bytes[offset + 2] = (value >>> 8) & 0xff;
    bytes[offset + 3] = value & 0xff;
  };
  writeUint32(16, width);
  writeUint32(20, height);
  return bytes;
}

function exportWithImages(): MapResult {
  return mapDocument(
    frame({
      name: "Hero Screen",
      layoutMode: "vertical",
      itemSpacing: 12,
      children: [
        unsupported({
          name: "Hero Illustration",
          figmaType: "RECTANGLE",
          reason: "image",
        }),
        text({ name: "Title", characters: "Unlock everything" }),
        unsupported({ name: "Sparkle", figmaType: "VECTOR", reason: "vector" }),
      ],
    }),
  );
}

function render(result: MapResult, bytesFor: (index: number) => Uint8Array) {
  return result.imagePlacements.map(
    (placement, index): RenderedImage => ({
      assetId: placement.assetId,
      bytes: bytesFor(index),
      width: 200,
      height: 100,
    }),
  );
}

describe("image placement", () => {
  it("records where each skipped image would have gone, in reading order", () => {
    const result = exportWithImages();
    expect(
      result.imagePlacements.map((placement) => [
        placement.name,
        placement.parentStackId,
        placement.childIndex,
      ]),
    ).toEqual([
      // The illustration comes before the only surviving child, the vector
      // after it, and both belong to the frame's own stack.
      ["Hero Illustration", "hero-screen", 0],
      ["Sparkle", "hero-screen", 1],
    ]);
    expect(result.report.imageCount).toBe(2);
  });

  it("mints a unique identifier-grammar asset id from each layer name", () => {
    const result = mapDocument(
      frame({
        name: "Root",
        children: [
          unsupported({ name: "Badge", reason: "image" }),
          unsupported({ name: "Badge", reason: "image" }),
          unsupported({ name: "✦", reason: "vector" }),
        ],
      }),
    );
    expect(result.imagePlacements.map((entry) => entry.assetId)).toEqual([
      "badge",
      "badge-2",
      "image",
    ]);
    for (const placement of result.imagePlacements) {
      expect(placement.assetId).toMatch(/^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/);
    }
  });

  it("places a frame's dropped image fill on the frame itself", () => {
    const result = mapDocument(
      frame({
        name: "Hero",
        fills: [imagePaint()],
        children: [text({ name: "Title", characters: "Hello" })],
      }),
    );
    expect(result.imagePlacements).toEqual([
      expect.objectContaining({
        parentStackId: "hero",
        childIndex: 0,
        screenId: "imported",
      }),
    ]);
  });

  it("names the screen each image belongs to across a multi-frame export", () => {
    // Each frame needs a button: the protocol rejects a screen the first one
    // cannot reach, so a buttonless frame ends the exported flow.
    const withCta = (name: string, art: string, x: number) =>
      frame({
        name,
        bounds: box(x, 0, 390, 844),
        children: [
          unsupported({ name: art, reason: "image" }),
          frame({
            name: `${name} CTA`,
            cornerRadius: 20,
            fills: [solid("#0D99FF")],
            children: [text({ name: `${name} Action`, characters: "Continue" })],
          }),
        ],
      });
    const result = mapDocument([
      withCta("Second", "Art B", 500),
      withCta("First", "Art A", 0),
    ]);
    expect(
      result.imagePlacements.map((entry) => [entry.name, entry.screenId]),
    ).toEqual([
      ["Art A", "first"],
      ["Art B", "second"],
    ]);
  });
});

describe("bundle assembly", () => {
  it("produces the frozen shape, with the document byte-identical to the plain export", () => {
    const result = exportWithImages();
    const { bundle } = assembleBundle({
      document: result.document,
      report: result.report,
      placements: result.imagePlacements,
      rendered: render(result, () => png(400, 200, 16)),
    });

    expect(bundle.format).toBe(BUNDLE_FORMAT);
    expect(bundle.formatVersion).toBe(BUNDLE_FORMAT_VERSION);
    expect(bundle.document).toEqual(result.document);
    expect(validatePaywallDocument(bundle.document).ok).toBe(true);

    // Exactly the frozen key sets, no more and no less.
    expect(Object.keys(bundle).sort()).toEqual([
      "document",
      "format",
      "formatVersion",
      "images",
      "report",
    ]);
    expect(Object.keys(bundle.report).sort()).toEqual(["skipped", "warnings"]);
    const [image] = bundle.images;
    expect(Object.keys(image ?? {}).sort()).toEqual([
      "accessibilityLabel",
      "bytesBase64",
      "height",
      "id",
      "mimeType",
      "name",
      "placement",
      "scale",
      "width",
    ]);
    expect(Object.keys(image?.placement ?? {}).sort()).toEqual([
      "childIndex",
      "parentStackId",
      "screenId",
    ]);
  });

  it("carries the pixels as bare base64, with the PNG's own dimensions", () => {
    const result = exportWithImages();
    const bytes = png(400, 200, 8);
    const { bundle } = assembleBundle({
      document: result.document,
      report: result.report,
      placements: result.imagePlacements,
      rendered: result.imagePlacements.map((placement) => ({
        assetId: placement.assetId,
        bytes,
        ...(pngDimensions(bytes) as { width: number; height: number }),
      })),
    });
    const [image] = bundle.images;
    expect(image?.mimeType).toBe("image/png");
    expect(image?.scale).toBe(IMAGE_SCALE);
    expect(image?.width).toBe(400);
    expect(image?.height).toBe(200);
    expect(image?.bytesBase64).toBe(toBase64(bytes));
    expect(image?.bytesBase64.startsWith("data:")).toBe(false);
    expect(image?.accessibilityLabel).toBe("Hero Illustration");
  });

  it("projects the report onto the frozen warning and skip shapes", () => {
    const result = exportWithImages();
    const { bundle } = assembleBundle({
      document: result.document,
      report: result.report,
      placements: result.imagePlacements,
      rendered: [],
    });
    for (const warning of bundle.report.warnings) {
      expect(Object.keys(warning).sort()).toEqual([
        "code",
        "layerPath",
        "message",
      ]);
    }
    expect(bundle.report.skipped.length).toBeGreaterThan(0);
    for (const skip of bundle.report.skipped) {
      // `kind`, not the mapper's `reason`.
      expect(Object.keys(skip).sort()).toEqual(["kind", "layerPath", "message"]);
    }
    expect(bundle.report.skipped.map((skip) => skip.kind)).toEqual([
      "image",
      "vector",
    ]);
  });

  it("leaves out an image over the per-image cap and says why", () => {
    const result = exportWithImages();
    const { bundle, dropped } = assembleBundle({
      document: result.document,
      report: result.report,
      placements: result.imagePlacements,
      rendered: render(result, (index) =>
        index === 0 ? png(4000, 4000, MAX_IMAGE_BYTES) : png(20, 20, 8),
      ),
    });
    expect(bundle.images.map((image) => image.name)).toEqual(["Sparkle"]);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]?.code).toBe("bundle.imageDropped");
    expect(dropped[0]?.layerPath).toContain("Hero Illustration");
    expect(dropped[0]?.message).toContain("per-image limit");
    // The drop is part of the bundle's own report, not only the UI's.
    expect(
      bundle.report.warnings.some((entry) => entry.code === "bundle.imageDropped"),
    ).toBe(true);
  });

  /**
   * A cap with room for exactly one of the two images. The caps are injected so
   * the test does not have to build 20 MB of fixtures to reach the real one.
   */
  function capForOneImage(result: MapResult, rendered: readonly RenderedImage[]) {
    const uncapped = assembleBundle({
      document: result.document,
      report: result.report,
      placements: result.imagePlacements,
      rendered,
    });
    expect(uncapped.bundle.images).toHaveLength(2);
    return {
      maxImageBytes: 4096,
      maxBundleBytes: JSON.stringify(uncapped.bundle).length - 1,
    };
  }

  it("stops adding images at the total cap and keeps the ones that fit", () => {
    const result = exportWithImages();
    const rendered = render(result, () => png(100, 100, 900));
    const { bundle, dropped } = assembleBundle({
      document: result.document,
      report: result.report,
      placements: result.imagePlacements,
      rendered,
      limits: capForOneImage(result, rendered),
    });
    expect(bundle.images.map((image) => image.name)).toEqual([
      "Hero Illustration",
    ]);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]?.message).toContain("limit");
  });

  it("keeps the assembled bundle inside the total cap it reports", () => {
    const result = exportWithImages();
    const rendered = render(result, () => png(100, 100, 900));
    const limits = capForOneImage(result, rendered);
    const { bundle } = assembleBundle({
      document: result.document,
      report: result.report,
      placements: result.imagePlacements,
      rendered,
      limits,
    });
    expect(JSON.stringify(bundle).length).toBeLessThanOrEqual(
      limits.maxBundleBytes,
    );
  });

  it("uses the frozen caps when none are injected", () => {
    expect(MAX_IMAGE_BYTES).toBe(4 * 1024 * 1024);
    expect(MAX_BUNDLE_BYTES).toBe(20 * 1024 * 1024);
    const result = exportWithImages();
    const { bundle, dropped } = assembleBundle({
      document: result.document,
      report: result.report,
      placements: result.imagePlacements,
      rendered: render(result, (index) =>
        index === 0 ? png(1, 1, MAX_IMAGE_BYTES) : png(20, 20, 8),
      ),
    });
    expect(dropped).toHaveLength(1);
    expect(bundle.images).toHaveLength(1);
  });

  it("skips a placement with no rendered pixels rather than emitting a hole", () => {
    const result = exportWithImages();
    const { bundle, dropped } = assembleBundle({
      document: result.document,
      report: result.report,
      placements: result.imagePlacements,
      rendered: [],
    });
    expect(bundle.images).toEqual([]);
    expect(dropped).toEqual([]);
  });
});

describe("PNG dimensions", () => {
  it("reads width and height out of the IHDR chunk", () => {
    expect(pngDimensions(png(1024, 768))).toEqual({ width: 1024, height: 768 });
  });

  it("reads a dimension past the sign bit", () => {
    expect(pngDimensions(png(70_000, 3))).toEqual({ width: 70_000, height: 3 });
  });

  it("returns null for anything that is not a PNG, rather than a lie", () => {
    expect(pngDimensions(new Uint8Array(4))).toBeNull();
    expect(pngDimensions(new Uint8Array(64))).toBeNull();
    expect(pngDimensions(png(0, 0))).toBeNull();
  });
});
