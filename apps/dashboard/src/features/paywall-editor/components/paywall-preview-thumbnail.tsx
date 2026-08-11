import type { CSSProperties } from "react";
import { memo, useMemo, useState } from "react";
import { PreviewNode } from "@/features/paywall-editor/components/canvas-preview-node";
import { DEFAULT_MOCK_PRODUCTS } from "@/features/paywall-editor/constants/editor-constants";
import { paywallThumbnailGeometry } from "@/features/paywall-editor/constants/paywall-thumbnail";
import { reconcileMockProductsForDocument } from "@/features/paywall-editor/mutations/local-project-file";
import { EditorStoreProvider } from "@/features/paywall-editor/stores/editor-store-context";
import type {
  MosaicDocument,
  Screen,
} from "@/features/paywall-editor/types/editor";
import { initialScreen } from "@/features/paywall-editor/utils/document-tree-traversal";
import { documentRuntimeState } from "@/features/paywall-editor/utils/document-version";
import {
  previewScreenSurface,
  resolvedScreenSafeArea,
} from "@/features/paywall-editor/utils/preview-screen-surface";

const NO_IDS: ReadonlySet<string> = new Set<string>();

function noop() {
  // A thumbnail is a picture of a Paywall, not a second canvas.
}

/**
 * A still frame stands in for a video background.
 *
 * The canvas plays the real video because one Paywall is being authored there.
 * A gallery would be playing one per card, so the poster is used when the
 * document supplies one and the authored fallback colour when it does not.
 */
function stillFrameStyle(
  base: CSSProperties,
  video: { readonly contentMode: "fit" | "fill"; readonly poster?: string }
): CSSProperties {
  if (!video.poster) {
    return base;
  }
  return {
    ...base,
    backgroundImage: `url(${JSON.stringify(video.poster)})`,
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
    backgroundSize: video.contentMode === "fill" ? "cover" : "contain",
  };
}

function screenPresentation(screen: Screen) {
  return (
    (screen as Screen & { presentation?: { type: "screen" | "sheet" } })
      .presentation?.type ?? "screen"
  );
}

/**
 * A non-interactive picture of a document's initial screen, scaled to fit a
 * card.
 *
 * It draws through the same renderer the Studio canvas uses, so what a gallery
 * card shows and what opening the Paywall shows cannot drift apart. Everything
 * the canvas adds for authoring — device chrome, selection, hover, inline
 * editing, playing video — is left out: at this size it would be noise, and at
 * this quantity it would be expensive.
 *
 * The whole frame is `aria-hidden` and `inert`. The card around it already
 * names the Paywall, and a screen-reader user gaining a second, wordier copy of
 * that name plus every button inside the design would be worse off, not better.
 *
 * Rendering a document that cannot be drawn — no screens, an unresolvable
 * reference — throws, which is why callers wrap this in a boundary that shows a
 * placeholder rather than letting one bad document empty the list.
 */
function PaywallPreviewThumbnailContent({
  document,
  width,
}: {
  document: MosaicDocument;
  width: number;
}) {
  // Countdown content needs an instant. It is fixed for the thumbnail's
  // lifetime so a gallery does not re-render every card every second.
  const [now] = useState(() => Date.now());

  const frame = useMemo(() => {
    const geometry = paywallThumbnailGeometry();
    const screen = initialScreen(document);
    const presentation = screenPresentation(screen);
    const safeArea = resolvedScreenSafeArea(screen.layout, geometry.safeArea);
    const surface = previewScreenSurface(
      document,
      screen.layout,
      presentation === "sheet" ? { ...safeArea, top: 0 } : safeArea
    );
    // Studio opens a document at its default locale, and a gallery card is a
    // picture of the same thing; the fallback catalog is used only when the
    // document declares a default it never authored.
    const { defaultLocale, fallbackLocale, locales } = document.localization;
    const locale = locales[defaultLocale] ? defaultLocale : fallbackLocale;
    const direction = locales[locale]?.direction ?? "ltr";
    const runtime = documentRuntimeState(document);

    return {
      children: surface.root.children.map((node) => (
        <PreviewNode
          carouselPages={runtime.carousels}
          direction={direction}
          document={document}
          editingComponentId={null}
          hiddenIds={NO_IDS}
          hoveredComponentId={null}
          inheritedLocked={false}
          key={node.id}
          locale={locale}
          lockedIds={NO_IDS}
          mockProducts={reconcileMockProductsForDocument(document, [
            ...DEFAULT_MOCK_PRODUCTS,
          ])}
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
          selectedProducts={runtime.selectedProducts}
          switchValues={runtime.switches}
          tabSelections={runtime.tabs}
        />
      )),
      direction,
      geometry,
      presentation,
      surface,
    };
  }, [document, now]);

  const { geometry, presentation, surface } = frame;
  const scale = width / geometry.width;
  const screenStyle = surface.layoutBackground.video
    ? stillFrameStyle(
        surface.layoutBackground.style,
        surface.layoutBackground.video
      )
    : surface.layoutBackground.style;
  const rootStyle = surface.rootBackground.video
    ? stillFrameStyle(surface.rootStyle, surface.rootBackground.video)
    : surface.rootStyle;

  return (
    // The canvas renderer reaches for the editor store to report selection.
    // A thumbnail is inert, so nothing ever calls it — but it is given its own
    // empty store rather than the page's, because a picture in a list must not
    // be able to reach into an editing session, and the list has no session to
    // reach into anyway.
    <EditorStoreProvider>
      <div
        aria-hidden="true"
        className="pointer-events-none overflow-hidden bg-white"
        data-testid="paywall-preview-thumbnail"
        inert
        style={{ height: geometry.height * scale, width }}
      >
        <div
          className="relative origin-top-left overflow-hidden text-slate-950"
          dir={frame.direction}
          style={{
            ...screenStyle,
            fontSize: "16px",
            height: geometry.height,
            transform: `scale(${scale})`,
            width: geometry.width,
          }}
        >
          {presentation === "sheet" ? (
            <div className="absolute inset-0 z-[8] bg-slate-950/45" />
          ) : null}
          <div
            className={`z-10 flex flex-col ${
              presentation === "sheet"
                ? "absolute inset-x-0 bottom-0 max-h-[88%] min-h-[36%] overflow-hidden rounded-t-[28px]"
                : "relative min-h-full"
            }`}
            style={{
              ...rootStyle,
              backgroundColor:
                rootStyle.backgroundColor ??
                (presentation === "sheet" && !rootStyle.background
                  ? "#ffffff"
                  : undefined),
              borderRadius:
                presentation === "sheet"
                  ? `${Math.max(28, surface.root.appearance?.cornerRadius ?? 0)}px ${Math.max(28, surface.root.appearance?.cornerRadius ?? 0)}px 0 0`
                  : rootStyle.borderRadius,
            }}
          >
            {frame.children}
          </div>
        </div>
      </div>
    </EditorStoreProvider>
  );
}

export const PaywallPreviewThumbnail = memo(PaywallPreviewThumbnailContent);
