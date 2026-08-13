import { describe, expect, it } from "vitest";

import {
  decodeFigmaBundleImageBytes,
  FIGMA_BUNDLE_FORMAT,
  type FigmaBundleImage,
  figmaBundleImagePreview,
  figmaImagesCanBeImported,
  readImportedFileSource,
} from "@/features/paywall-editor/mutations/figma-import";
import { serializeDocument } from "@/features/paywall-editor/mutations/local-project-file";
import type { MosaicDocument } from "@/features/paywall-editor/types/editor";
import { LOCAL_STUDIO_SOURCE } from "@/features/paywall-editor/types/studio-source";
import { cloneValue } from "@/features/paywall-editor/utils/clone";
import canonicalFixture from "../../../../../../protocol/fixtures/v0.4/complete-paywall.json";

const canonicalDocument = canonicalFixture as MosaicDocument;

// A one-pixel transparent PNG, so the decode path runs on real bytes.
const PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function image(overrides: Partial<FigmaBundleImage> = {}): FigmaBundleImage {
  return {
    accessibilityLabel: "Hero artwork",
    bytesBase64: PIXEL_PNG_BASE64,
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
    ...overrides,
  };
}

function bundle(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    document: canonicalDocument,
    format: FIGMA_BUNDLE_FORMAT,
    formatVersion: 1,
    images: [image()],
    report: {
      skipped: [
        {
          kind: "unsupportedNode",
          layerPath: "Page 1 / Offer / Blur",
          message: "Layer blur has no Mosaic equivalent.",
        },
      ],
      warnings: [
        {
          code: "typography.substituted",
          layerPath: "Page 1 / Offer / Headline",
          message: "Inter Tight was mapped to the body typography style.",
        },
      ],
    },
    ...overrides,
  });
}

const hostedSource = {
  draftId: "draft_1",
  environmentId: "env_1",
  kind: "hosted",
  organizationId: "org_1",
  paywallId: "paywall_1",
  projectId: "project_1",
} as const;

describe("Figma export bundle detection", () => {
  // A bundle discriminator that also matched a plain document would silently
  // reroute every existing import through code that expects images.
  it("leaves a plain protocol document on the untouched JSON import path", () => {
    const detected = readImportedFileSource(
      serializeDocument(canonicalDocument)
    );
    expect(detected.kind).toBe("paywall-json");
  });

  it("leaves unparseable input to the plain importer's own error", () => {
    expect(readImportedFileSource("{").kind).toBe("paywall-json");
  });

  it("accepts a well-formed bundle with its report and images", () => {
    const detected = readImportedFileSource(bundle());
    if (detected.kind !== "figma-bundle") {
      throw new Error("Expected the bundle to be detected");
    }
    expect(detected.bundle.document).toEqual(canonicalFixture);
    expect(detected.bundle.report.warnings).toHaveLength(1);
    expect(detected.bundle.report.skipped).toHaveLength(1);
    expect(detected.bundle.images[0]?.id).toBe("hero-shot");
  });

  // Importing a bundle written against a contract this Studio does not know
  // would apply a document built from rules it cannot honour.
  it("rejects an unknown format version and names both ways forward", () => {
    expect(() => readImportedFileSource(bundle({ formatVersion: 2 }))).toThrow(
      /format version 2/
    );
    expect(() => readImportedFileSource(bundle({ formatVersion: 2 }))).toThrow(
      /Update Studio, or re-export .* document-only/
    );
  });

  it("rejects a bundle whose format string is not the Mosaic one", () => {
    expect(
      readImportedFileSource(bundle({ format: "figma.export" })).kind
    ).toBe("paywall-json");
  });

  // The bundle path must not become a way around protocol validation.
  it("rejects a bundle carrying a document the protocol refuses", () => {
    const invalid = { ...cloneValue(canonicalDocument), unsupported: true };
    expect(() => readImportedFileSource(bundle({ document: invalid }))).toThrow(
      /not a valid Mosaic Protocol 0\.4 document/
    );
  });

  it("rejects duplicate and non-identifier image ids", () => {
    expect(() =>
      readImportedFileSource(
        bundle({ images: [image(), image({ name: "Copy" })] })
      )
    ).toThrow(/appears more than once/);
    expect(() =>
      readImportedFileSource(bundle({ images: [image({ id: "Hero Shot" })] }))
    ).toThrow(/is not a Mosaic identifier/);
  });
});

describe("Figma bundle image bytes", () => {
  // Rejecting the whole bundle because one image is corrupt would throw away a
  // good document, so base64 is only a string until something needs the bytes.
  it("parses a bundle with unreadable base64 and reports it at preview time", () => {
    const detected = readImportedFileSource(
      bundle({ images: [image({ bytesBase64: "not base64 !!" })] })
    );
    if (detected.kind !== "figma-bundle") {
      throw new Error("Expected the bundle to be detected");
    }
    const [unreadable] = detected.bundle.images;
    if (!unreadable) {
      throw new Error("Expected one image");
    }
    const preview = figmaBundleImagePreview(unreadable);
    expect(preview.readable).toBe(false);
    expect(() => decodeFigmaBundleImageBytes(unreadable)).toThrow(
      /not valid base64/
    );
  });

  it("decodes valid base64 into the bytes an upload would send", () => {
    const bytes = decodeFigmaBundleImageBytes(image());
    expect(Array.from(bytes.slice(0, 4))).toEqual([137, 80, 78, 71]);
    const preview = figmaBundleImagePreview(image());
    expect(preview.readable && preview.dataUri).toContain(
      "data:image/png;base64,"
    );
  });
});

describe("Figma image import gating", () => {
  // Local Studio has no project to upload to, so an image node there would
  // reference an Asset that never existed.
  it("allows images only where there is a project to upload them to", () => {
    expect(figmaImagesCanBeImported(LOCAL_STUDIO_SOURCE)).toBe(false);
    expect(figmaImagesCanBeImported(hostedSource)).toBe(true);
  });
});
