import type { ReactElement, ReactNode } from "react";
import { Component, useMemo, useState } from "react";

import {
  PreviewCard,
  PreviewCardContent,
  PreviewCardTrigger,
} from "@/components/ui/preview-card";
import { PreviewNode } from "@/features/paywall-editor/components/canvas-preview-node";
import type { ComponentCatalogEntry } from "@/features/paywall-editor/components/component-catalog";
import { constraintSentences } from "@/features/paywall-editor/constants/component-constraints";
import { DEFAULT_MOCK_PRODUCTS } from "@/features/paywall-editor/constants/editor-constants";
import { reconcileMockProductsForDocument } from "@/features/paywall-editor/mutations/local-project-file";
import type {
  MosaicDocument,
  ProtocolNode,
} from "@/features/paywall-editor/types/editor";
import {
  dryRunInsertion,
  type InsertionBlocker,
  type InsertionEnvironment,
} from "@/features/paywall-editor/utils/component-insertion-outcome";
import { findNode } from "@/features/paywall-editor/utils/document-tree-traversal";

const NO_IDS: ReadonlySet<string> = new Set<string>();
const NO_RECORD: Readonly<Record<string, never>> = Object.freeze({});
const HOVER_OPEN_DELAY_MS = 350;
const HOVER_CLOSE_DELAY_MS = 120;
/** Starting content is authored for a phone-width canvas. */
const PREVIEW_CONTENT_WIDTH = 320;
const PREVIEW_SCALE = 0.7;

function noop() {
  // The card previews starting content; it is inert by construction.
}

type PreviewOutcome =
  | { readonly status: "blocked"; readonly blocker: InsertionBlocker }
  | { readonly status: "failed"; readonly reason: string }
  | {
      /** The document the node would be inserted into, with its dependencies. */
      readonly document: MosaicDocument;
      readonly node: ProtocolNode;
      readonly now: number;
      readonly status: "ready";
    };

/**
 * Builds exactly what insertion would build, by running the insertion and
 * throwing the result away. That is the point of the whole card: a hand-drawn
 * thumbnail drifts from what pressing Insert actually produces, and the real
 * starting node rendered against the real resulting document cannot.
 */
function buildPreviewOutcome(
  environment: InsertionEnvironment,
  entry: ComponentCatalogEntry
): PreviewOutcome {
  try {
    const dryRun = dryRunInsertion(environment, entry.type);
    if (dryRun.status === "blocked") {
      return { status: "blocked", blocker: dryRun.blocker };
    }
    const node = findNode(dryRun.document, dryRun.nodeId);
    if (!node) {
      return {
        status: "failed",
        reason: `Studio inserted ${entry.label} into the preview document but could not find it again.`,
      };
    }
    return {
      status: "ready",
      node,
      document: dryRun.document,
      now: Date.now(),
    };
  } catch (error) {
    return {
      status: "failed",
      reason:
        error instanceof Error && error.message
          ? `Studio could not build ${entry.label} starting content: ${error.message}`
          : `Studio could not build ${entry.label} starting content in this document.`,
    };
  }
}

interface PreviewFailureBoundaryState {
  failed: boolean;
}

/**
 * A renderer failure inside the card must not take the library or the editor
 * with it, and must not leave an empty frame pretending to be a preview.
 */
// biome-ignore lint/style/useReactFunctionComponents: React implements error boundaries only via a class
class PreviewFailureBoundary extends Component<
  { children: ReactNode; label: string },
  PreviewFailureBoundaryState
> {
  state: PreviewFailureBoundaryState = { failed: false };

  static getDerivedStateFromError(): PreviewFailureBoundaryState {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <PreviewUnavailable
          reason={`Studio could not render ${this.props.label} starting content in this document.`}
        />
      );
    }
    return this.props.children;
  }
}

function PreviewUnavailable({ reason }: { reason: string }) {
  return (
    <p className="rounded border border-border border-dashed bg-muted/30 p-3 text-muted-foreground text-xs leading-4">
      {reason}
    </p>
  );
}

function DetachedPreview({
  document,
  node,
  now,
}: {
  document: MosaicDocument;
  node: ProtocolNode;
  now: number;
}) {
  const locale = document.localization.fallbackLocale;
  const mockProducts = reconcileMockProductsForDocument(document, [
    ...DEFAULT_MOCK_PRODUCTS,
  ]);

  return (
    <div
      className="max-h-64 overflow-hidden rounded border border-border bg-background p-2"
      // `zoom` scales and reflows, so the card's height follows the preview
      // instead of a guessed fixed frame.
      style={{ zoom: PREVIEW_SCALE }}
    >
      {/*
       * `inert` is what keeps this a picture rather than a second canvas: no tab
       * stops inside the card, no hover or selection events reaching the editor
       * store for a node that does not exist in the document, and nothing for a
       * screen reader to walk. The card's text carries the meaning.
       */}
      <div inert style={{ width: PREVIEW_CONTENT_WIDTH }}>
        <PreviewNode
          carouselPages={NO_RECORD}
          direction={document.localization.locales[locale]?.direction ?? "ltr"}
          document={document}
          editingComponentId={null}
          hiddenIds={NO_IDS}
          hoveredComponentId={null}
          // Not locked: a locked frame renders dimmed, which would misreport
          // what the inserted component looks like.
          inheritedLocked={false}
          locale={locale}
          lockedIds={NO_IDS}
          mockProducts={mockProducts}
          mockPurchaseState="productAvailable"
          node={node}
          now={now}
          onBeginEdit={noop}
          onCancelEdit={noop}
          onCarouselPageChange={noop}
          onCommitEdit={noop}
          onProductSelect={noop}
          onSwitchChange={noop}
          onTabSelect={noop}
          onUpdateEdit={noop}
          productLayerPreview={null}
          purchaseDisabledIds={NO_IDS}
          selectedComponentId={null}
          selectedProducts={NO_RECORD}
          switchValues={NO_RECORD}
          tabSelections={NO_RECORD}
        />
      </div>
    </div>
  );
}

function PreviewBody({
  entry,
  outcome,
}: {
  entry: ComponentCatalogEntry;
  outcome: PreviewOutcome;
}) {
  if (outcome.status === "blocked") {
    return (
      <div className="rounded border border-destructive/25 bg-destructive/5 p-3">
        <p className="font-medium text-xs">{outcome.blocker.title}</p>
        <p className="mt-1 text-muted-foreground text-xs leading-4">
          {outcome.blocker.detail}
        </p>
      </div>
    );
  }
  if (outcome.status === "failed") {
    return <PreviewUnavailable reason={outcome.reason} />;
  }
  return (
    <PreviewFailureBoundary label={entry.label}>
      <DetachedPreview
        document={outcome.document}
        node={outcome.node}
        now={outcome.now}
      />
    </PreviewFailureBoundary>
  );
}

/**
 * Hover and focus preview for one component library entry.
 *
 * Opens after a short delay on pointer hover so sweeping the list does not
 * strobe, and immediately on keyboard focus so the library stays usable without
 * a mouse. Escape dismisses it, focus is never trapped, and the trigger's own
 * click, double-click and drag behaviour is untouched.
 */
export function ComponentPreviewCard({
  children,
  entry,
  environment,
}: {
  children: ReactElement;
  entry: ComponentCatalogEntry;
  environment: InsertionEnvironment;
}) {
  const [open, setOpen] = useState(false);
  const {
    countdownEndsAt,
    document,
    isDocumentTransactionActive,
    lockedIds,
    selectedComponentId,
  } = environment;
  const outcome = useMemo(
    () =>
      open
        ? buildPreviewOutcome(
            {
              countdownEndsAt,
              document,
              isDocumentTransactionActive,
              lockedIds,
              selectedComponentId,
            },
            entry
          )
        : null,
    [
      countdownEndsAt,
      document,
      entry,
      isDocumentTransactionActive,
      lockedIds,
      open,
      selectedComponentId,
    ]
  );
  const sentences = constraintSentences(entry.type);

  return (
    <PreviewCard onOpenChange={setOpen} open={open}>
      <PreviewCardTrigger
        closeDelay={HOVER_CLOSE_DELAY_MS}
        delay={HOVER_OPEN_DELAY_MS}
        // Base UI applies `delay` to focus as well as hover. The delay exists
        // so sweeping the mouse down the list does not strobe; making a
        // keyboard user wait for it would make the preview feel broken, so
        // keyboard focus opens the controlled card directly. `:focus-visible`
        // keeps a mouse click on the entry from opening it twice over.
        onFocus={(event) => {
          if (event.currentTarget.matches(":focus-visible")) {
            setOpen(true);
          }
        }}
        render={children}
      />
      <PreviewCardContent aria-label={`${entry.label} preview`}>
        <div className="space-y-2">
          <div>
            <p className="font-semibold text-sm">{entry.label}</p>
            <p className="text-muted-foreground text-xs leading-4">
              {entry.category} · {entry.description}
            </p>
          </div>
          {outcome ? <PreviewBody entry={entry} outcome={outcome} /> : null}
          {sentences.length > 0 ? (
            <ul className="space-y-0.5 text-muted-foreground text-xs leading-4">
              {sentences.map((sentence) => (
                <li key={sentence}>{sentence}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </PreviewCardContent>
    </PreviewCard>
  );
}
