/**
 * The Studio export bundle.
 *
 * The plain export is a protocol document and nothing else, which means every
 * image in the design is a line in the report rather than a pixel in the file.
 * The bundle carries those pixels alongside the document, plus enough placement
 * information for Studio to upload each one as an asset and insert the node
 * where the designer drew it.
 *
 * **The shape below is a frozen contract.** A Studio-side importer is written
 * against it; changing a field name here breaks that importer, so any change is
 * a new `formatVersion`, not an edit.
 *
 * Assembly is pure: the bytes are injected by the caller, because
 * `exportAsync` is the one part of this that needs Figma.
 */

import type { MosaicPaywallV03Document } from "../../../protocol/browser/index.js";
import { toBase64 } from "./base64.js";
import type { ImagePlacement } from "./mapper/map-document.js";
import type { ExportReport, ExportWarning } from "./mapper/report.js";

export const BUNDLE_FORMAT = "mosaic.figma-export";
export const BUNDLE_FORMAT_VERSION = 1;

/** Every image is exported at 2x, so it survives a retina paywall. */
export const IMAGE_SCALE = 2;

/** One image may not exceed this. A 4 MB PNG in a paywall is a mistake. */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/**
 * Nor may the whole bundle. Studio has to parse this as one JSON document, and
 * a browser that runs out of memory mid-import loses the export entirely.
 */
export const MAX_BUNDLE_BYTES = 20 * 1024 * 1024;

export type BundleWarning = {
  readonly code: string;
  readonly message: string;
  readonly layerPath: string;
};

export type BundleSkip = {
  readonly kind: string;
  readonly message: string;
  readonly layerPath: string;
};

export type BundleImagePlacement = {
  readonly screenId: string;
  readonly parentStackId: string;
  readonly childIndex: number;
};

export type BundleImage = {
  readonly id: string;
  readonly name: string;
  readonly mimeType: "image/png";
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  /** Raw base64, with no `data:` prefix. */
  readonly bytesBase64: string;
  readonly placement: BundleImagePlacement;
  readonly accessibilityLabel: string;
};

export type FigmaExportBundle = {
  readonly format: typeof BUNDLE_FORMAT;
  readonly formatVersion: typeof BUNDLE_FORMAT_VERSION;
  readonly document: MosaicPaywallV03Document;
  readonly report: {
    readonly warnings: readonly BundleWarning[];
    readonly skipped: readonly BundleSkip[];
  };
  readonly images: readonly BundleImage[];
};

/** A layer's pixels, as `exportAsync` produced them. */
export type RenderedImage = {
  /** Matches `ImagePlacement.assetId`. */
  readonly assetId: string;
  readonly bytes: Uint8Array;
  /** The PNG's own pixel dimensions, which are `scale` times the layer's. */
  readonly width: number;
  readonly height: number;
};

export type AssembleResult = {
  readonly bundle: FigmaExportBundle;
  /** Images the caps excluded, as report entries the UI can show. */
  readonly dropped: readonly ExportWarning[];
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * A PNG's dimensions, read straight out of its IHDR chunk.
 *
 * The alternative -- multiplying the layer's logical size by the scale -- is
 * off by a pixel whenever Figma rounds differently than we would, and the
 * bundle promises pixel dimensions. Returns null for anything that is not a
 * PNG, so a caller can fall back rather than emit a lie.
 */
export function pngDimensions(
  bytes: Uint8Array,
): { readonly width: number; readonly height: number } | null {
  if (bytes.length < 24) return null;
  for (const [index, byte] of PNG_SIGNATURE.entries()) {
    if (bytes[index] !== byte) return null;
  }
  const readUint32 = (offset: number): number =>
    ((bytes[offset] as number) << 24 >>> 0) +
    ((bytes[offset + 1] as number) << 16) +
    ((bytes[offset + 2] as number) << 8) +
    (bytes[offset + 3] as number);
  const width = readUint32(16);
  const height = readUint32(20);
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

function bundleReport(report: ExportReport, extra: readonly ExportWarning[]): {
  warnings: BundleWarning[];
  skipped: BundleSkip[];
} {
  return {
    warnings: [...report.warnings, ...extra].map((warning) => ({
      code: warning.code,
      message: warning.message,
      layerPath: warning.layerPath,
    })),
    skipped: report.skipped.map((skip) => ({
      kind: skip.reason,
      message: skip.message,
      layerPath: skip.layerPath,
    })),
  };
}

function accessibilityLabelFor(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : "Image";
}

/**
 * Builds the bundle, dropping whatever does not fit.
 *
 * Images are added in reading order and measured as serialised JSON, so the
 * total is the real file size rather than an estimate of it. An image over
 * either cap is dropped and reported; the document itself is never trimmed,
 * because a bundle without its document is not an export.
 */
export function assembleBundle(input: {
  readonly document: MosaicPaywallV03Document;
  readonly report: ExportReport;
  readonly placements: readonly ImagePlacement[];
  readonly rendered: readonly RenderedImage[];
  /** Overrides for the caps. Tests use them; the plugin never does. */
  readonly limits?: {
    readonly maxImageBytes?: number;
    readonly maxBundleBytes?: number;
  };
}): AssembleResult {
  const maxImageBytes = input.limits?.maxImageBytes ?? MAX_IMAGE_BYTES;
  const maxBundleBytes = input.limits?.maxBundleBytes ?? MAX_BUNDLE_BYTES;
  const byAssetId = new Map(
    input.rendered.map((image) => [image.assetId, image] as const),
  );
  const dropped: ExportWarning[] = [];
  const images: BundleImage[] = [];

  // Everything that is not an image, measured once. The images then have to fit
  // in what is left of the cap.
  let budget =
    maxBundleBytes -
    JSON.stringify({
      format: BUNDLE_FORMAT,
      formatVersion: BUNDLE_FORMAT_VERSION,
      document: input.document,
      report: bundleReport(input.report, []),
      images: [],
    }).length;

  for (const placement of input.placements) {
    const rendered = byAssetId.get(placement.assetId);
    if (!rendered) continue;
    if (rendered.bytes.length > maxImageBytes) {
      dropped.push({
        code: "bundle.imageDropped",
        layerPath: placement.layerPath,
        figmaId: placement.figmaId,
        message: `The rendered image is ${formatMegabytes(rendered.bytes.length)}, over the ${formatMegabytes(maxImageBytes)} per-image limit, so it was left out of the bundle. Shrink the layer in Figma, or add the asset in Studio.`,
      });
      continue;
    }

    const image: BundleImage = {
      id: placement.assetId,
      name: placement.name,
      mimeType: "image/png",
      width: rendered.width,
      height: rendered.height,
      scale: IMAGE_SCALE,
      bytesBase64: toBase64(rendered.bytes),
      placement: {
        screenId: placement.screenId,
        parentStackId: placement.parentStackId,
        childIndex: placement.childIndex,
      },
      accessibilityLabel: accessibilityLabelFor(placement.name),
    };
    // `+ 1` for the comma that joins it to the previous entry.
    const cost = JSON.stringify(image).length + 1;
    if (cost > budget) {
      dropped.push({
        code: "bundle.imageDropped",
        layerPath: placement.layerPath,
        figmaId: placement.figmaId,
        message: `The bundle reached its ${formatMegabytes(maxBundleBytes)} limit, so this image was left out. Export fewer frames at once, or add the asset in Studio.`,
      });
      continue;
    }
    budget -= cost;
    images.push(image);
  }

  const build = (): FigmaExportBundle => ({
    format: BUNDLE_FORMAT,
    formatVersion: BUNDLE_FORMAT_VERSION,
    document: input.document,
    report: bundleReport(input.report, dropped),
    images,
  });

  // Each drop adds a warning, which adds bytes the running budget did not know
  // about when it was set. One exact pass settles it, so the cap is a promise
  // about the file rather than an estimate of it.
  const byId = new Map(
    input.placements.map((placement) => [placement.assetId, placement] as const),
  );
  while (images.length > 0 && JSON.stringify(build()).length > maxBundleBytes) {
    const last = images.pop() as BundleImage;
    const placement = byId.get(last.id);
    dropped.push({
      code: "bundle.imageDropped",
      layerPath: placement?.layerPath ?? last.name,
      figmaId: placement?.figmaId ?? "",
      message: `The bundle reached its ${formatMegabytes(maxBundleBytes)} limit, so this image was left out. Export fewer frames at once, or add the asset in Studio.`,
    });
  }

  return { bundle: build(), dropped };
}

function formatMegabytes(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  return `${megabytes >= 10 ? Math.round(megabytes) : Math.round(megabytes * 10) / 10} MB`;
}
