import { StatusMessage } from "@mosaic/design-system";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { FigmaBundleImportProgress } from "@/features/paywall-editor/hooks/use-figma-bundle-import";
import { FigmaImportValidationError } from "@/features/paywall-editor/hooks/use-figma-bundle-import";
import {
  type FigmaBundleImage,
  type FigmaExportBundle,
  figmaBundleImagePreview,
  figmaImagesCanBeImported,
  LOCAL_STUDIO_IMAGE_SKIP_REASON,
} from "@/features/paywall-editor/mutations/figma-import";
import type { StudioSource } from "@/features/paywall-editor/types/studio-source";

function dimensions(image: FigmaBundleImage) {
  return `${image.width} × ${image.height} px at ${image.scale}×`;
}

function ImageRow({
  checkboxId,
  image,
  onToggle,
  readable,
  selectable,
  selected,
}: {
  checkboxId: string;
  image: FigmaBundleImage;
  onToggle: () => void;
  readable: { readonly dataUri: string } | null;
  selectable: boolean;
  selected: boolean;
}) {
  return (
    <li className="flex items-start gap-3 rounded border border-border p-2">
      {readable ? (
        <img
          alt=""
          className="size-14 shrink-0 rounded border border-border object-cover"
          height={56}
          src={readable.dataUri}
          width={56}
        />
      ) : (
        <span
          aria-hidden
          className="flex size-14 shrink-0 items-center justify-center rounded border border-border border-dashed text-[10px] text-muted-foreground"
        >
          No preview
        </span>
      )}
      <div className="min-w-0 flex-1">
        {selectable ? (
          <div className="flex items-center gap-2">
            <input
              checked={selected}
              className="size-4 accent-teal-700"
              disabled={!readable}
              id={checkboxId}
              onChange={onToggle}
              type="checkbox"
            />
            <label className="truncate font-medium" htmlFor={checkboxId}>
              {image.name}
            </label>
          </div>
        ) : (
          <p className="truncate font-medium">{image.name}</p>
        )}
        <p className="text-muted-foreground text-xs">{dimensions(image)}</p>
        {readable ? null : (
          <p className="mt-1 text-destructive text-xs">
            This image cannot be read from the bundle, so it will not be
            imported. Re-export it from the Figma plugin.
          </p>
        )}
      </div>
    </li>
  );
}

/**
 * Review step for a Figma export bundle.
 *
 * A bundle carries the plugin's own account of what it could not translate,
 * plus image bytes that become managed Assets. Applying that unseen would let
 * a silent conversion loss land in the author's paywall, so nothing is applied
 * until the author has read the report and chosen the images.
 */
export function FigmaImportDialog({
  bundle,
  error,
  isPending,
  onApply,
  onOpenChange,
  progress,
  replacesOpenPaywall,
  source,
}: {
  bundle: FigmaExportBundle;
  error: Error | null;
  isPending: boolean;
  onApply: (imageIds: readonly string[]) => void;
  onOpenChange: (open: boolean) => void;
  progress: FigmaBundleImportProgress | null;
  replacesOpenPaywall: boolean;
  source: StudioSource;
}) {
  const headingId = useId();
  const imagesImportable = figmaImagesCanBeImported(source);
  const previews = bundle.images.map((image) => ({
    image,
    preview: figmaBundleImagePreview(image),
  }));
  const [selected, setSelected] = useState<readonly string[]>(() =>
    previews
      .filter((entry) => entry.preview.readable)
      .map((entry) => entry.image.id)
  );

  const selectedCount = imagesImportable ? selected.length : 0;
  const { skipped, warnings } = bundle.report;

  const documentSentence = replacesOpenPaywall
    ? "Importing replaces the paywall open in Studio with the exported document. One undo restores it."
    : "Importing opens the exported document in Studio.";
  const imageSentence = (() => {
    if (bundle.images.length === 0) {
      return "This bundle contains no images.";
    }
    if (!imagesImportable) {
      return LOCAL_STUDIO_IMAGE_SKIP_REASON;
    }
    return `${selectedCount} of ${bundle.images.length} ${bundle.images.length === 1 ? "image" : "images"} will be uploaded to this project as managed Assets and placed where the plugin recorded them.`;
  })();

  return (
    <Dialog onOpenChange={onOpenChange} open>
      <DialogContent className="max-h-[calc(100vh-4rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Review Figma import</DialogTitle>
          <DialogDescription>
            {documentSentence} {imageSentence}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-4 text-sm">
          {warnings.length > 0 ? (
            <section aria-labelledby={`${headingId}-warnings`}>
              <h3 className="font-semibold" id={`${headingId}-warnings`}>
                Converted with changes ({warnings.length})
              </h3>
              <ul className="mt-1 space-y-1">
                {warnings.map((warning) => (
                  <li
                    className="rounded border border-border bg-muted/35 p-2"
                    key={`${warning.code}:${warning.layerPath}:${warning.message}`}
                  >
                    <p>{warning.message}</p>
                    <p className="text-muted-foreground text-xs">
                      {warning.layerPath} · {warning.code}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {skipped.length > 0 ? (
            <section aria-labelledby={`${headingId}-skipped`}>
              <h3 className="font-semibold" id={`${headingId}-skipped`}>
                Not converted ({skipped.length})
              </h3>
              <ul className="mt-1 space-y-1">
                {skipped.map((entry) => (
                  <li
                    className="rounded border border-border bg-muted/35 p-2"
                    key={`${entry.kind}:${entry.layerPath}:${entry.message}`}
                  >
                    <p>{entry.message}</p>
                    <p className="text-muted-foreground text-xs">
                      {entry.layerPath} · {entry.kind}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {bundle.images.length > 0 ? (
            <section aria-labelledby={`${headingId}-images`}>
              <h3 className="font-semibold" id={`${headingId}-images`}>
                {imagesImportable
                  ? `Images (${bundle.images.length})`
                  : `Images not imported (${bundle.images.length})`}
              </h3>
              {imagesImportable ? null : (
                <p className="mt-1 text-muted-foreground text-xs">
                  {LOCAL_STUDIO_IMAGE_SKIP_REASON}
                </p>
              )}
              <ul className="mt-2 space-y-2">
                {previews.map(({ image, preview }) => (
                  <ImageRow
                    checkboxId={`${headingId}-image-${image.id}`}
                    image={image}
                    key={image.id}
                    onToggle={() =>
                      setSelected((current) =>
                        current.includes(image.id)
                          ? current.filter((id) => id !== image.id)
                          : [...current, image.id]
                      )
                    }
                    readable={preview.readable ? preview : null}
                    selectable={imagesImportable}
                    selected={selected.includes(image.id)}
                  />
                ))}
              </ul>
            </section>
          ) : null}

          {progress ? (
            <StatusMessage tone="info">
              Uploading image {progress.completed} of {progress.total}…
            </StatusMessage>
          ) : null}

          {error ? (
            <StatusMessage
              className="rounded border border-destructive/30 p-2"
              tone="danger"
            >
              <p className="font-semibold">Import was not applied</p>
              <p className="mt-1">{error.message}</p>
              {error instanceof FigmaImportValidationError ? (
                <ul className="mt-1 space-y-1 text-xs">
                  {error.diagnostics.map((diagnostic) => (
                    <li key={`${diagnostic.message}:${diagnostic.recovery}`}>
                      {diagnostic.message} {diagnostic.recovery}
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="mt-1 text-xs">
                Clear the images above and import the document on its own, or
                cancel and re-export from Figma.
              </p>
            </StatusMessage>
          ) : null}
        </div>

        <DialogFooter>
          <DialogClose
            render={
              <Button disabled={isPending} type="button" variant="outline" />
            }
          >
            Cancel
          </DialogClose>
          <Button
            aria-busy={isPending}
            disabled={isPending}
            onClick={() => onApply(imagesImportable ? selected : [])}
            type="button"
          >
            {(() => {
              if (isPending) {
                return "Importing…";
              }
              return selectedCount > 0
                ? `Import paywall and ${selectedCount} ${selectedCount === 1 ? "image" : "images"}`
                : "Import paywall only";
            })()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
