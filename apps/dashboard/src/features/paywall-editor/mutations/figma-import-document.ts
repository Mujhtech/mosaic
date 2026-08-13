import type { FigmaBundleImage } from "@/features/paywall-editor/mutations/figma-import";
import type {
  MosaicDocument,
  ProtocolNode,
  TreeInsertionLocation,
} from "@/features/paywall-editor/types/editor";
import { cloneValue } from "@/features/paywall-editor/utils/clone";
import {
  allocateIdentifier,
  allocateLocalizationKey,
  identifierSet,
  localizationKeySet,
  localized,
} from "@/features/paywall-editor/utils/document-tree-dependencies";
import { insertExistingNodeAtLocation } from "@/features/paywall-editor/utils/document-tree-mutations";
import {
  findNode,
  initialScreen,
  screenContainingNode,
} from "@/features/paywall-editor/utils/document-tree-traversal";
import { synchronizeProtocolMetadata } from "@/features/paywall-editor/utils/protocol-document";
import { validatePaywallDocument } from "@/lib/mosaic-protocol";

/** The protocol caps `imageComponent.aspectRatio` at 10. */
const MAX_ASPECT_RATIO = 10;

export interface FigmaImageUpload {
  /** The `https://` Asset URL returned by the Mosaic Asset endpoint. */
  readonly assetUrl: string;
  readonly image: FigmaBundleImage;
}

export interface FigmaImageInsertion {
  readonly assetId: string;
  readonly imageId: string;
  readonly nodeId: string;
}

export interface FigmaImageFailure {
  readonly imageId: string;
  readonly message: string;
}

export interface FigmaPlacementNote {
  readonly imageId: string;
  readonly message: string;
}

export interface FigmaImportDiagnostic {
  readonly message: string;
  readonly recovery: string;
}

export type FigmaImageInsertionResult =
  | {
      readonly document: MosaicDocument;
      readonly failed: readonly FigmaImageFailure[];
      readonly inserted: readonly FigmaImageInsertion[];
      readonly notes: readonly FigmaPlacementNote[];
      readonly ok: true;
    }
  | {
      readonly diagnostics: readonly FigmaImportDiagnostic[];
      readonly ok: false;
    };

function aspectRatioFor(image: FigmaBundleImage): number | null {
  const ratio = image.width / image.height;
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return null;
  }
  return Math.min(ratio, MAX_ASPECT_RATIO);
}

interface ResolvedPlacement {
  readonly location: TreeInsertionLocation;
  readonly notes: readonly string[];
}

/**
 * Maps a plugin-recorded placement onto the document as it actually is.
 *
 * Figma exports describe where a layer sat in the design, and the paywall may
 * have moved on since. Rather than dropping the image, the placement degrades
 * to the screen's root Stack and says so, so the author can see where each
 * image landed and why.
 */
export function resolveFigmaImagePlacement(
  document: MosaicDocument,
  placement: FigmaBundleImage["placement"]
): ResolvedPlacement {
  const notes: string[] = [];
  const requested = document.screens.find(
    (candidate) => candidate.id === placement.screenId
  );
  const screen = requested ?? initialScreen(document);
  if (!requested) {
    notes.push(
      `Screen "${placement.screenId}" is not in this paywall, so the image went to screen "${screen.id}".`
    );
  }

  const root = screen.layout.content;
  const parent = findNode(document, placement.parentStackId);
  const parentScreen = screenContainingNode(document, placement.parentStackId);
  if (parent?.type !== "stack" || parentScreen?.id !== screen.id) {
    notes.push(
      `Stack "${placement.parentStackId}" is no longer in screen "${screen.id}", so the image was appended to that screen's root Stack.`
    );
    return {
      location: { index: root.children.length, parentId: root.id },
      notes,
    };
  }

  const index = Math.min(
    Math.max(placement.childIndex, 0),
    parent.children.length
  );
  if (index !== placement.childIndex) {
    notes.push(
      `Child index ${placement.childIndex} is outside "${parent.id}", so the image was placed at index ${index}.`
    );
  }
  return { location: { index, parentId: parent.id }, notes };
}

function insertOne(
  document: MosaicDocument,
  upload: FigmaImageUpload
):
  | { readonly status: "failed"; readonly message: string }
  | {
      readonly document: MosaicDocument;
      readonly insertion: FigmaImageInsertion;
      readonly notes: readonly string[];
      readonly status: "inserted";
    } {
  const { assetUrl, image } = upload;
  const assetId = allocateIdentifier(
    new Set(document.assets.map((asset) => asset.id)),
    image.id
  );
  const keys = localizationKeySet(document);
  const fallbackKey = allocateLocalizationKey(
    keys,
    `paywall.assets.${assetId.replaceAll("-", "_")}.fallback`
  );

  // The Asset must exist before the node is inserted. `ensureNodeDependencies`
  // invents a *bundled* placeholder Asset for an image node whose assetId it
  // cannot find, which would silently discard the upload.
  const withAsset: MosaicDocument = {
    ...document,
    assets: [
      ...document.assets,
      {
        fallback: {
          type: "placeholder",
          value: localized(`${image.name} unavailable`, fallbackKey),
        },
        id: assetId,
        source: { type: "remote", url: assetUrl },
        type: "image",
      },
    ],
  };

  const nodeId = allocateIdentifier(identifierSet(withAsset), image.id);
  const label = image.accessibilityLabel.trim();
  const aspectRatio = aspectRatioFor(image);
  const node: ProtocolNode = {
    accessibility: label
      ? {
          hidden: false,
          label: localized(
            label,
            allocateLocalizationKey(
              keys,
              `paywall.${nodeId.replaceAll("-", "_")}.accessibility_label`
            )
          ),
        }
      : { hidden: true },
    assetId,
    ...(aspectRatio === null ? {} : { aspectRatio }),
    contentMode: "fit",
    id: nodeId,
    sizing: { height: "fit", width: "fill" },
    type: "image",
  };

  const placement = resolveFigmaImagePlacement(withAsset, image.placement);
  const result = insertExistingNodeAtLocation(
    withAsset,
    node,
    placement.location
  );
  if (result.status === "rejected") {
    return {
      message: `"${image.name}" could not be placed. ${result.message} ${result.recovery}`,
      status: "failed",
    };
  }
  return {
    document: result.document,
    insertion: { assetId, imageId: image.id, nodeId },
    notes: placement.notes,
    status: "inserted",
  };
}

/**
 * Adds an uploaded image to the document as an `imageAsset` plus an image node
 * at its recorded placement.
 *
 * The result is only returned when the whole document still validates, so a
 * partially applied import can never replace the author's paywall with a
 * broken one.
 */
export function insertFigmaBundleImages(
  document: MosaicDocument,
  uploads: readonly FigmaImageUpload[]
): FigmaImageInsertionResult {
  if (uploads.length === 0) {
    // A document-only import must be identical to a plain JSON import, so it
    // skips the metadata rebuild entirely.
    return {
      document: cloneValue(document),
      failed: [],
      inserted: [],
      notes: [],
      ok: true,
    };
  }

  let working = cloneValue(document);
  const inserted: FigmaImageInsertion[] = [];
  const failed: FigmaImageFailure[] = [];
  const notes: FigmaPlacementNote[] = [];

  for (const upload of uploads) {
    const outcome = insertOne(working, upload);
    if (outcome.status === "failed") {
      failed.push({ imageId: upload.image.id, message: outcome.message });
      continue;
    }
    working = outcome.document;
    inserted.push(outcome.insertion);
    for (const message of outcome.notes) {
      notes.push({ imageId: upload.image.id, message });
    }
  }

  // Inserting an image can introduce capabilities the exported document never
  // declared, such as `asset.remoteImage`.
  const synchronized = synchronizeProtocolMetadata(working);
  const validated = validatePaywallDocument(synchronized);
  if (!validated.ok) {
    return {
      diagnostics: validated.diagnostics.map((diagnostic) => ({
        message: diagnostic.message,
        recovery: diagnostic.recovery.message,
      })),
      ok: false,
    };
  }

  return { document: synchronized, failed, inserted, notes, ok: true };
}
