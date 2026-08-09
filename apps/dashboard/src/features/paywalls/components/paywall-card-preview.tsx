import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Component, lazy, Suspense } from "react";

import {
  PAYWALL_THUMBNAIL_WIDTH,
  paywallThumbnailGeometry,
} from "@/features/paywall-editor/constants/paywall-thumbnail";
import { paywallPreviewDocumentQueryOptions } from "@/features/paywalls/queries/paywall-queries";
import { useHostedPublishingAdapter } from "@/features/publishing/api/use-hosted-publishing-adapter";
import { useHasBeenVisible } from "@/hooks/use-has-been-visible";
import { cn } from "@/lib/utils";

/**
 * The canvas renderer is a large chunk that exists for Studio. The Paywall list
 * borrows it, so it is fetched only once a card actually has a document to
 * draw — a list showing nothing but placeholders never downloads it at all.
 */
const PaywallPreviewThumbnail = lazy(() =>
  import("@/features/paywall-editor/components/paywall-preview-thumbnail").then(
    (module) => ({ default: module.PaywallPreviewThumbnail })
  )
);

/** The Studio canvas aspect, so a card reads as a phone at a glance. */
const THUMBNAIL_GEOMETRY = paywallThumbnailGeometry();
/** Cards just below the fold start fetching before they are scrolled to. */
const PREFETCH_MARGIN = "200px";

/**
 * A render failure inside one thumbnail must not empty the Paywall list.
 *
 * Documents reach this component straight from the API, and a document that
 * parses is not necessarily one that draws: a design-system reference the
 * renderer cannot resolve throws mid-tree. That is a broken picture, not a
 * broken page, so it degrades to the same placeholder an absent document gets.
 */
// biome-ignore lint/style/useReactFunctionComponents: React implements error boundaries only via a class
class ThumbnailFailureBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function ThumbnailFrame({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "shrink-0 overflow-hidden rounded border border-border bg-muted/40",
        className
      )}
      style={{
        aspectRatio: `${THUMBNAIL_GEOMETRY.width} / ${THUMBNAIL_GEOMETRY.height}`,
        width: PAYWALL_THUMBNAIL_WIDTH,
      }}
    >
      {children}
    </div>
  );
}

/**
 * Shown when there is nothing to draw: no published Version, no Draft, or a
 * document this browser could not read. It stays silent to assistive
 * technology, because the card's own text already says what the Paywall is —
 * and a missing picture is not a missing Paywall.
 */
function ThumbnailPlaceholder() {
  return (
    <ThumbnailFrame className="border-dashed">
      <div
        className="flex h-full w-full items-center justify-center px-2 text-center text-[10px] text-muted-foreground leading-3"
        data-testid="paywall-preview-placeholder"
      >
        No preview
      </div>
    </ThumbnailFrame>
  );
}

/**
 * One Paywall card's visual preview.
 *
 * The document is fetched only once the card has been scrolled into view, and
 * only ever once: a Project with fifty Paywalls would otherwise open by
 * downloading fifty documents nobody has looked at. The list itself never waits
 * for any of this — the frame reserves its space immediately and fills in
 * afterwards.
 */
export function PaywallCardPreview({
  environmentId,
  paywallId,
  projectId,
}: {
  environmentId: string;
  paywallId: string;
  projectId: string;
}) {
  const adapter = useHostedPublishingAdapter();
  const { ref, visible } = useHasBeenVisible({ rootMargin: PREFETCH_MARGIN });
  const preview = useQuery({
    ...paywallPreviewDocumentQueryOptions(
      { environmentId, paywallId, projectId },
      adapter
    ),
    enabled: visible && adapter.status === "available",
  });

  const content = (() => {
    if (!(visible && adapter.status === "available")) {
      return <ThumbnailFrame />;
    }
    if (preview.isPending) {
      return <ThumbnailFrame className="animate-pulse" />;
    }
    if (preview.isError || !preview.data) {
      return <ThumbnailPlaceholder />;
    }
    return (
      <ThumbnailFailureBoundary fallback={<ThumbnailPlaceholder />}>
        <Suspense fallback={<ThumbnailFrame className="animate-pulse" />}>
          <ThumbnailFrame>
            <PaywallPreviewThumbnail
              document={preview.data.document}
              width={PAYWALL_THUMBNAIL_WIDTH}
            />
          </ThumbnailFrame>
        </Suspense>
      </ThumbnailFailureBoundary>
    );
  })();

  return (
    <div className="shrink-0" ref={ref}>
      {content}
    </div>
  );
}
