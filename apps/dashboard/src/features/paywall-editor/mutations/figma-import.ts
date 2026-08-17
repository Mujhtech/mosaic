import { MAX_FIGMA_BUNDLE_BYTES } from "@/features/paywall-editor/constants/editor-constants";
import type { MosaicDocument } from "@/features/paywall-editor/types/editor";
import type { StudioSource } from "@/features/paywall-editor/types/studio-source";
import { cloneValue } from "@/features/paywall-editor/utils/clone";
import {
  parsePortablePaywallJson,
  validatePaywallDocument,
} from "@/lib/mosaic-protocol";

/**
 * The `format` discriminator written by `packages/figma-plugin`. Studio routes
 * on this value alone, so a plain protocol document — which has no `format`
 * field — never reaches the bundle path.
 */
export const FIGMA_BUNDLE_FORMAT = "mosaic.figma-export";
export const FIGMA_BUNDLE_FORMAT_VERSION = 1;

/**
 * Local Studio has no project to upload Assets to, so a bundle's images cannot
 * become protocol Assets. Naming that is better than importing an image node
 * pointing at nothing.
 */
export const LOCAL_STUDIO_IMAGE_SKIP_REASON =
  "Local Studio has no project to upload images to. Open a hosted Draft to import images.";

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/;

/**
 * The image media types the Mosaic Asset endpoint accepts. The plugin emits
 * PNG today; validating against the system's contract rather than today's
 * single value keeps a future export format from being rejected here for no
 * safety benefit.
 */
const SUPPORTED_IMAGE_MEDIA_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export interface FigmaBundleWarning {
  readonly code: string;
  readonly layerPath: string;
  readonly message: string;
}

export interface FigmaBundleSkipped {
  readonly kind: string;
  readonly layerPath: string;
  readonly message: string;
}

export interface FigmaBundleReport {
  readonly skipped: readonly FigmaBundleSkipped[];
  readonly warnings: readonly FigmaBundleWarning[];
}

export interface FigmaBundleImagePlacement {
  readonly childIndex: number;
  readonly parentStackId: string;
  readonly screenId: string;
}

export interface FigmaBundleImage {
  readonly accessibilityLabel: string;
  readonly bytesBase64: string;
  readonly height: number;
  readonly id: string;
  readonly mimeType: string;
  readonly name: string;
  readonly placement: FigmaBundleImagePlacement;
  readonly scale: number;
  readonly width: number;
}

export interface FigmaExportBundle {
  readonly document: MosaicDocument;
  readonly format: typeof FIGMA_BUNDLE_FORMAT;
  readonly formatVersion: typeof FIGMA_BUNDLE_FORMAT_VERSION;
  readonly images: readonly FigmaBundleImage[];
  readonly report: FigmaBundleReport;
}

export type ImportedFileSource =
  | { readonly bundle: FigmaExportBundle; readonly kind: "figma-bundle" }
  | { readonly kind: "paywall-json" };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(
      `This Figma export bundle is malformed: ${field} must be a string.`
    );
  }
  return value;
}

function requiredPositiveNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(
      `This Figma export bundle is malformed: ${field} must be a positive number.`
    );
  }
  return value;
}

function optionalArray(value: unknown, field: string): unknown[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(
      `This Figma export bundle is malformed: ${field} must be an array.`
    );
  }
  return value;
}

function parseReport(value: unknown): FigmaBundleReport {
  const source = value === undefined ? {} : record(value);
  if (!source) {
    throw new Error(
      "This Figma export bundle is malformed: report must be an object."
    );
  }
  return {
    skipped: optionalArray(source.skipped, "report.skipped").map(
      (entry, index) => {
        const skipped = record(entry);
        if (!skipped) {
          throw new Error(
            `This Figma export bundle is malformed: report.skipped[${index}] must be an object.`
          );
        }
        return {
          kind: requiredString(skipped.kind, `report.skipped[${index}].kind`),
          layerPath: requiredString(
            skipped.layerPath,
            `report.skipped[${index}].layerPath`
          ),
          message: requiredString(
            skipped.message,
            `report.skipped[${index}].message`
          ),
        };
      }
    ),
    warnings: optionalArray(source.warnings, "report.warnings").map(
      (entry, index) => {
        const warning = record(entry);
        if (!warning) {
          throw new Error(
            `This Figma export bundle is malformed: report.warnings[${index}] must be an object.`
          );
        }
        return {
          code: requiredString(warning.code, `report.warnings[${index}].code`),
          layerPath: requiredString(
            warning.layerPath,
            `report.warnings[${index}].layerPath`
          ),
          message: requiredString(
            warning.message,
            `report.warnings[${index}].message`
          ),
        };
      }
    ),
  };
}

function parsePlacement(
  value: unknown,
  field: string
): FigmaBundleImagePlacement {
  const placement = record(value);
  if (!placement) {
    throw new Error(
      `This Figma export bundle is malformed: ${field} must be an object.`
    );
  }
  const { childIndex } = placement;
  if (!Number.isInteger(childIndex) || (childIndex as number) < 0) {
    throw new Error(
      `This Figma export bundle is malformed: ${field}.childIndex must be a non-negative integer.`
    );
  }
  return {
    childIndex: childIndex as number,
    parentStackId: requiredString(
      placement.parentStackId,
      `${field}.parentStackId`
    ),
    screenId: requiredString(placement.screenId, `${field}.screenId`),
  };
}

function parseImages(value: unknown): FigmaBundleImage[] {
  const seen = new Set<string>();
  return optionalArray(value, "images").map((entry, index) => {
    const image = record(entry);
    if (!image) {
      throw new Error(
        `This Figma export bundle is malformed: images[${index}] must be an object.`
      );
    }
    const id = requiredString(image.id, `images[${index}].id`);
    if (!IDENTIFIER_PATTERN.test(id)) {
      throw new Error(
        `This Figma export bundle is malformed: images[${index}].id "${id}" is not a Mosaic identifier.`
      );
    }
    if (seen.has(id)) {
      throw new Error(
        `This Figma export bundle is malformed: image id "${id}" appears more than once.`
      );
    }
    seen.add(id);

    const mimeType = requiredString(
      image.mimeType,
      `images[${index}].mimeType`
    );
    if (!SUPPORTED_IMAGE_MEDIA_TYPES.has(mimeType)) {
      throw new Error(
        `This Figma export bundle contains an unsupported image type "${mimeType}" for "${id}". Mosaic accepts PNG, JPEG, WebP, and GIF.`
      );
    }

    return {
      accessibilityLabel:
        image.accessibilityLabel === undefined
          ? ""
          : requiredString(
              image.accessibilityLabel,
              `images[${index}].accessibilityLabel`
            ),
      // Base64 is only checked for being a string here. Decoding is deferred to
      // the moment the bytes are needed, so one unreadable image reports itself
      // instead of rejecting an otherwise importable bundle.
      bytesBase64: requiredString(
        image.bytesBase64,
        `images[${index}].bytesBase64`
      ),
      height: requiredPositiveNumber(image.height, `images[${index}].height`),
      id,
      mimeType,
      name: requiredString(image.name, `images[${index}].name`),
      placement: parsePlacement(image.placement, `images[${index}].placement`),
      // `scale` is display metadata only. A future 3x export should not be
      // rejected by Studio, so any positive scale is accepted.
      scale:
        image.scale === undefined
          ? 2
          : requiredPositiveNumber(image.scale, `images[${index}].scale`),
      width: requiredPositiveNumber(image.width, `images[${index}].width`),
    };
  });
}

function parseBundleDocument(value: unknown): MosaicDocument {
  if (value === undefined) {
    throw new Error(
      "This Figma export bundle is malformed: it declares no document."
    );
  }
  // The bundle's document goes through exactly the same gate as a plain import,
  // so a bundle can never introduce a document Studio would otherwise refuse.
  const parsed = parsePortablePaywallJson(JSON.stringify(value), {
    maxDocumentBytes: MAX_FIGMA_BUNDLE_BYTES,
  });
  if (!parsed.ok) {
    throw new Error(bundleDocumentFailure(parsed.diagnostics));
  }
  const document = parsed.value as MosaicDocument;
  const validated = validatePaywallDocument(document);
  if (!validated.ok) {
    throw new Error(bundleDocumentFailure(validated.diagnostics));
  }
  return cloneValue(document);
}

function bundleDocumentFailure(
  diagnostics: readonly {
    message: string;
    recovery: { message: string };
  }[]
): string {
  const [first] = diagnostics;
  return first
    ? `The paywall inside this Figma export bundle is not a valid Mosaic Protocol 0.4 document. ${first.message} ${first.recovery.message}`
    : "The paywall inside this Figma export bundle is not a valid Mosaic Protocol 0.4 document.";
}

/**
 * Parses an already-JSON-parsed value that has declared itself a Mosaic Figma
 * export bundle. Throws an actionable message for every rejection.
 */
export function parseFigmaExportBundle(value: unknown): FigmaExportBundle {
  const source = record(value);
  if (!source || source.format !== FIGMA_BUNDLE_FORMAT) {
    throw new Error(
      `This file is not a Mosaic Figma export bundle. Expected format "${FIGMA_BUNDLE_FORMAT}".`
    );
  }
  if (source.formatVersion !== FIGMA_BUNDLE_FORMAT_VERSION) {
    const declared =
      typeof source.formatVersion === "number" ||
      typeof source.formatVersion === "string"
        ? `${source.formatVersion}`
        : "an unreadable value";
    throw new Error(
      `This Figma export bundle declares format version ${declared}, and this Studio supports version ${FIGMA_BUNDLE_FORMAT_VERSION}. Update Studio, or re-export from the Figma plugin as a document-only paywall.`
    );
  }

  return {
    document: parseBundleDocument(source.document),
    format: FIGMA_BUNDLE_FORMAT,
    formatVersion: FIGMA_BUNDLE_FORMAT_VERSION,
    images: parseImages(source.images),
    report: parseReport(source.report),
  };
}

/**
 * Decides which import path a selected file takes.
 *
 * Unparseable JSON and any object without the bundle discriminator fall through
 * to the plain-JSON path untouched, so the existing importer keeps owning its
 * own error messages.
 */
export function readImportedFileSource(json: string): ImportedFileSource {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { kind: "paywall-json" };
  }
  const source = record(parsed);
  if (!source || source.format !== FIGMA_BUNDLE_FORMAT) {
    return { kind: "paywall-json" };
  }
  return { bundle: parseFigmaExportBundle(source), kind: "figma-bundle" };
}

export function decodeFigmaBundleImageBytes(
  image: FigmaBundleImage
): Uint8Array<ArrayBuffer> {
  let binary: string;
  try {
    binary = atob(image.bytesBase64);
  } catch (error) {
    throw new Error(
      `"${image.name}" could not be decoded because its image data is not valid base64.`,
      { cause: error }
    );
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export type FigmaBundleImagePreview =
  | { readonly dataUri: string; readonly readable: true }
  | { readonly message: string; readonly readable: false };

/**
 * Builds the preview source for the review dialog, and reports an unreadable
 * image as unreadable rather than rendering a broken thumbnail.
 */
export function figmaBundleImagePreview(
  image: FigmaBundleImage
): FigmaBundleImagePreview {
  try {
    decodeFigmaBundleImageBytes(image);
  } catch (error) {
    return {
      message:
        error instanceof Error
          ? error.message
          : `"${image.name}" could not be decoded.`,
      readable: false,
    };
  }
  return {
    dataUri: `data:${image.mimeType};base64,${image.bytesBase64}`,
    readable: true,
  };
}

/**
 * Images become protocol Assets only where there is a project to upload them
 * to, which is the hosted Studio.
 */
export function figmaImagesCanBeImported(source: StudioSource): boolean {
  return source.kind === "hosted";
}
