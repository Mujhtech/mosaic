import { FigmaImportDialog } from "@/features/paywall-editor/components/figma-import-dialog";
import {
  type FigmaBundleImportOutcome,
  useFigmaBundleImport,
} from "@/features/paywall-editor/hooks/use-figma-bundle-import";
import type { FigmaExportBundle } from "@/features/paywall-editor/mutations/figma-import";
import {
  LOCAL_STUDIO_SOURCE,
  type StudioSource,
} from "@/features/paywall-editor/types/studio-source";
import { cloneValue } from "@/features/paywall-editor/utils/clone";

interface FigmaImportReviewProps {
  readonly bundle: FigmaExportBundle;
  readonly onApplied: (outcome: FigmaBundleImportOutcome) => void;
  readonly onClose: () => void;
  readonly replacesOpenPaywall: boolean;
}

/**
 * Local Studio imports the document alone.
 *
 * It deliberately owns no TanStack Query client: local Studio runs without a
 * server, and reaching for one here would make an offline editor depend on
 * hosted infrastructure it never calls.
 */
function LocalFigmaImportReview({
  bundle,
  onApplied,
  onClose,
  replacesOpenPaywall,
}: FigmaImportReviewProps) {
  return (
    <FigmaImportDialog
      bundle={bundle}
      error={null}
      isPending={false}
      onApply={() =>
        onApplied({
          document: cloneValue(bundle.document),
          failed: [],
          inserted: [],
          notes: [],
        })
      }
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
      progress={null}
      replacesOpenPaywall={replacesOpenPaywall}
      source={LOCAL_STUDIO_SOURCE}
    />
  );
}

function HostedFigmaImportReview({
  bundle,
  onApplied,
  onClose,
  replacesOpenPaywall,
  source,
}: FigmaImportReviewProps & {
  readonly source: Extract<StudioSource, { kind: "hosted" }>;
}) {
  const bundleImport = useFigmaBundleImport({ onApplied, source });
  return (
    <FigmaImportDialog
      bundle={bundle}
      error={bundleImport.error}
      isPending={bundleImport.isPending}
      onApply={(imageIds) => bundleImport.apply({ bundle, imageIds })}
      onOpenChange={(next) => {
        if (!(next || bundleImport.isPending)) {
          bundleImport.reset();
          onClose();
        }
      }}
      progress={bundleImport.progress}
      replacesOpenPaywall={replacesOpenPaywall}
      source={source}
    />
  );
}

export function FigmaImportReview({
  source,
  ...props
}: FigmaImportReviewProps & { readonly source: StudioSource }) {
  return source.kind === "hosted" ? (
    <HostedFigmaImportReview {...props} source={source} />
  ) : (
    <LocalFigmaImportReview {...props} />
  );
}
