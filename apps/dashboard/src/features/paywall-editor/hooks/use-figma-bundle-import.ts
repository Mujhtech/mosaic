import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import type { AssetAdapter } from "@/features/assets/api/asset-adapter";
import { generatedAssetAdapter } from "@/features/assets/api/generated-asset-adapter";
import { assetKeys } from "@/features/assets/queries/asset-queries";
import {
  decodeFigmaBundleImageBytes,
  type FigmaBundleImage,
  type FigmaExportBundle,
  figmaImagesCanBeImported,
} from "@/features/paywall-editor/mutations/figma-import";
import {
  type FigmaImageFailure,
  type FigmaImageInsertion,
  type FigmaImageUpload,
  type FigmaImportDiagnostic,
  type FigmaPlacementNote,
  insertFigmaBundleImages,
} from "@/features/paywall-editor/mutations/figma-import-document";
import type { MosaicDocument } from "@/features/paywall-editor/types/editor";
import type { StudioSource } from "@/features/paywall-editor/types/studio-source";
import { publishingKeys } from "@/features/publishing/queries/publish-validation-query";

const MEDIA_TYPE_EXTENSIONS: Record<string, string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * A document that would not validate after insertion is never applied, so the
 * diagnostics travel out as an error the review dialog can render.
 */
export class FigmaImportValidationError extends Error {
  readonly diagnostics: readonly FigmaImportDiagnostic[];

  constructor(diagnostics: readonly FigmaImportDiagnostic[]) {
    super(
      "The imported paywall would not be valid once these images are added."
    );
    this.name = "FigmaImportValidationError";
    this.diagnostics = diagnostics;
  }
}

export function figmaImageFileName(image: FigmaBundleImage): string {
  const extension = MEDIA_TYPE_EXTENSIONS[image.mimeType] ?? "png";
  const base =
    image.name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") ||
    image.id;
  return base.toLowerCase().endsWith(`.${extension}`)
    ? base
    : `${base}.${extension}`;
}

export interface FigmaBundleImportOutcome {
  readonly document: MosaicDocument;
  readonly failed: readonly FigmaImageFailure[];
  readonly inserted: readonly FigmaImageInsertion[];
  readonly notes: readonly FigmaPlacementNote[];
}

export interface FigmaBundleImportProgress {
  readonly completed: number;
  readonly total: number;
}

/**
 * Uploads a bundle's included images as managed Assets, then rebuilds the
 * document around them.
 *
 * Uploads are the only server state here; the resulting document belongs to the
 * editor store, so it is returned rather than cached.
 */
export function useFigmaBundleImport({
  adapter = generatedAssetAdapter,
  onApplied,
  source,
}: {
  adapter?: AssetAdapter;
  onApplied: (outcome: FigmaBundleImportOutcome) => void;
  source: StudioSource;
}) {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<FigmaBundleImportProgress | null>(
    null
  );

  const mutation = useMutation({
    mutationFn: async ({
      bundle,
      imageIds,
    }: {
      bundle: FigmaExportBundle;
      imageIds: readonly string[];
    }): Promise<FigmaBundleImportOutcome> => {
      const included =
        figmaImagesCanBeImported(source) && source.kind === "hosted"
          ? bundle.images.filter((image) => imageIds.includes(image.id))
          : [];
      const uploads: FigmaImageUpload[] = [];
      const failed: FigmaImageFailure[] = [];

      if (included.length > 0 && source.kind === "hosted") {
        setProgress({ completed: 0, total: included.length });
        let completed = 0;
        for (const image of included) {
          try {
            const bytes = decodeFigmaBundleImageBytes(image);
            const file = new File([bytes], figmaImageFileName(image), {
              type: image.mimeType,
            });
            // biome-ignore lint/performance/noAwaitInLoops: uploads run in sequence so a twenty-image bundle does not open twenty concurrent uploads
            const asset = await adapter.uploadAsset({
              file,
              projectId: source.projectId,
            });
            if (asset.url.startsWith("https://")) {
              uploads.push({ assetUrl: asset.url, image });
            } else {
              failed.push({
                imageId: image.id,
                message: `"${image.name}" was uploaded, but Mosaic returned an Asset URL that is not HTTPS. Protocol 0.3 accepts only HTTPS Asset sources.`,
              });
            }
          } catch (error) {
            failed.push({
              imageId: image.id,
              message:
                error instanceof Error
                  ? error.message
                  : `"${image.name}" could not be uploaded.`,
            });
          }
          completed += 1;
          setProgress({ completed, total: included.length });
        }
      }

      const result = insertFigmaBundleImages(bundle.document, uploads);
      if (!result.ok) {
        throw new FigmaImportValidationError(result.diagnostics);
      }
      return {
        document: result.document,
        failed: [...failed, ...result.failed],
        inserted: result.inserted,
        notes: result.notes,
      };
    },
    onSettled: () => setProgress(null),
    onSuccess: async (outcome) => {
      onApplied(outcome);
      if (source.kind !== "hosted") {
        return;
      }
      await queryClient.invalidateQueries({
        queryKey: assetKeys.all(source.projectId),
      });
      await queryClient.invalidateQueries({ queryKey: publishingKeys.all });
    },
  });

  const reset = useCallback(() => {
    setProgress(null);
    mutation.reset();
  }, [mutation]);

  return {
    apply: mutation.mutate,
    error: mutation.error,
    isPending: mutation.isPending,
    progress,
    reset,
  };
}
