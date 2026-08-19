import { CaretLeftIcon } from "@phosphor-icons/react/dist/ssr/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { CheckIcon } from "@phosphor-icons/react/dist/ssr/Check";
import type { CSSProperties, ReactNode } from "react";
import { createElement } from "react";
import {
  InlineEditor,
  NodeFrame,
} from "@/features/paywall-editor/components/canvas-preview-node-primitives";
import {
  alignmentStyle,
  appearanceStyle,
  countdownText,
  distributionStyle,
  headingElement,
  PROTOCOL_ICON_GLYPHS,
  type PreviewProductContext,
  productCardRequiresPrice,
  productPrice,
  RTL_ICON_NAMES,
  resolveProductTemplate,
  subtreeIncludesId,
  typographyStyle,
} from "@/features/paywall-editor/components/canvas-preview-node-primitives-support";
import { useEditorActions } from "@/features/paywall-editor/stores/editor-store-context";
import type {
  Marker,
  MockProductDefinition,
  MockPurchaseState,
  MosaicDocument,
  ProtocolNode,
} from "@/features/paywall-editor/types/editor";
import { getEditableCanvasText } from "@/features/paywall-editor/utils/canvas-preview-interactions";
import { resolveLocalizedText } from "@/features/paywall-editor/utils/document-tree-mutations";
import {
  resolvedFeatureListMarkerSize,
  resolvedItemMarker,
} from "@/features/paywall-editor/utils/marker";
import {
  announcementFor,
  ratingPointOffsets,
  ratingStepsPerPoint,
  resolveNodeVisibility,
  resolveSelectionStyle,
} from "@/features/paywall-editor/utils/protocol-component-rules";
import {
  resolvedBackground,
  resolvedProtocolColor,
} from "@/features/paywall-editor/utils/protocol-styles";
import {
  resolveProductBadgeStyle,
  resolveProductCardStyle,
} from "@/lib/mosaic-protocol";

export interface PreviewNodeProps {
  readonly carouselPages: Readonly<Record<string, number>>;
  readonly direction: "ltr" | "rtl";
  readonly document: MosaicDocument;
  readonly editingComponentId: string | null;
  readonly hiddenIds: ReadonlySet<string>;
  readonly hoveredComponentId: string | null;
  readonly inheritedLocked: boolean;
  readonly locale: string;
  readonly lockedIds: ReadonlySet<string>;
  readonly mockProducts: readonly MockProductDefinition[];
  readonly mockPurchaseState: MockPurchaseState;
  readonly node: ProtocolNode;
  readonly now: number;
  readonly onBeginEdit: (node: ProtocolNode) => void;
  readonly onCancelEdit: () => void;
  readonly onCarouselPageChange: (id: string, index: number) => void;
  readonly onCommitEdit: () => void;
  readonly onProductSelect: (id: string, productId: string) => void;
  readonly onSwitchChange: (id: string, value: boolean) => void;
  readonly onTabSelect: (id: string, tabId: string) => void;
  readonly onUpdateEdit: (node: ProtocolNode, value: string) => void;
  readonly productContext?: PreviewProductContext;
  readonly productLayerPreview: {
    readonly nodeId: string;
    readonly state: "default" | "selected";
  } | null;
  readonly purchaseDisabledIds: ReadonlySet<string>;
  readonly selectedComponentId: string | null;
  readonly selectedProducts: Readonly<Record<string, string>>;
  readonly switchValues: Readonly<Record<string, boolean>>;
  readonly tabSelections: Readonly<Record<string, string>>;
}

/**
 * What the per-type renderers below share: the node's own props plus the
 * selection, lock and inline-edit state derived once by PreviewNode.
 */
interface PreviewNodeContext extends PreviewNodeProps {
  readonly beginEdit: (event: {
    preventDefault: () => void;
    stopPropagation: () => void;
  }) => void;
  readonly beginEditKeyDown: (event: React.KeyboardEvent) => void;
  readonly editable: ReturnType<typeof getEditableCanvasText>;
  readonly editing: boolean;
  readonly editor: ReturnType<typeof useEditorActions>;
  readonly editTriggerProps: () => Record<string, unknown>;
  readonly hovered: boolean;
  readonly inlineEditor: (
    className: string,
    style?: CSSProperties
  ) => ReactNode;
  readonly locked: boolean;
  readonly props: PreviewNodeProps;
  readonly selected: boolean;
}

function renderStack(
  node: Extract<ProtocolNode, { type: "stack" }>,
  context: PreviewNodeContext
): ReactNode {
  const { document, locked, props } = context;
  return (
    <div
      style={{
        ...appearanceStyle(document, node.appearance),
        alignItems: alignmentStyle(node.crossAxisAlignment),
        display: "flex",
        flexDirection: node.direction === "vertical" ? "column" : "row",
        gap: node.gap,
        justifyContent: distributionStyle(node.mainAxisDistribution),
        paddingBlockEnd: node.padding.bottom,
        paddingBlockStart: node.padding.top,
        paddingInlineEnd: node.padding.end,
        paddingInlineStart: node.padding.start,
      }}
    >
      {node.children.length === 0 ? (
        <div className="w-full rounded border border-border border-dashed p-3 text-center text-muted-foreground text-xs">
          Empty Stack
        </div>
      ) : (
        node.children.map((child) => (
          <PreviewNode
            key={child.id}
            {...props}
            inheritedLocked={locked}
            node={child}
          />
        ))
      )}
    </div>
  );
}

function renderText(
  node: Extract<ProtocolNode, { type: "text" }>,
  context: PreviewNodeContext
): ReactNode {
  const { document, editTriggerProps, editing, inlineEditor, locale, props } =
    context;
  const value = resolveProductTemplate(
    resolveLocalizedText(document, node.value, locale),
    props.productContext
  );
  const style = typographyStyle(document, node.typography);
  return editing
    ? inlineEditor(
        "w-full resize-none bg-transparent px-1 py-0.5 focus:outline-none",
        style
      )
    : createElement(
        node.accessibility.role === "heading"
          ? headingElement(node.accessibility.level)
          : "p",
        {
          "aria-label": node.accessibility.label
            ? resolveProductTemplate(
                resolveLocalizedText(
                  document,
                  node.accessibility.label,
                  locale
                ),
                props.productContext
              )
            : undefined,
          className: "w-full px-1 py-0.5",
          ...editTriggerProps(),
          style: {
            ...appearanceStyle(document, node.appearance),
            ...style,
          },
        },
        value
      );
}

function renderImage(
  node: Extract<ProtocolNode, { type: "image" }>,
  context: PreviewNodeContext
): ReactNode {
  const { document, locale } = context;
  const asset = document.assets.find(
    (entry) => entry.id === node.assetId && entry.type === "image"
  );
  const imageLabel = node.accessibility.hidden
    ? undefined
    : resolveLocalizedText(document, node.accessibility.label, locale);
  return (
    <figure
      aria-hidden={node.accessibility.hidden || undefined}
      aria-label={imageLabel}
      className="flex w-full items-center justify-center overflow-hidden bg-linear-to-br from-cyan-100 to-teal-200 font-medium text-teal-900 text-xs"
      role="img"
      style={{
        ...appearanceStyle(document, node.appearance),
        aspectRatio: node.aspectRatio,
        objectFit: node.contentMode === "fit" ? "contain" : "cover",
      }}
    >
      {asset?.source.type === "remote" ? (
        // biome-ignore lint/correctness/useImageSize: the frame above already reserves the box from the node's aspectRatio, and fixed attributes would fight the size-full sizing the preview depends on
        <img
          alt=""
          className="size-full"
          src={asset.source.url}
          style={{
            objectFit: node.contentMode === "fit" ? "contain" : "cover",
          }}
        />
      ) : (
        <figcaption>{asset?.source.key ?? node.assetId}</figcaption>
      )}
    </figure>
  );
}

function renderIcon(
  node: Extract<ProtocolNode, { type: "icon" }>,
  context: PreviewNodeContext
): ReactNode {
  const { direction, document, locale } = context;
  const iconName =
    direction === "rtl" ? (RTL_ICON_NAMES[node.name] ?? node.name) : node.name;
  const glyph = PROTOCOL_ICON_GLYPHS[iconName];
  return (
    <span
      aria-hidden={node.accessibility.hidden || undefined}
      aria-label={
        node.accessibility.hidden
          ? undefined
          : resolveLocalizedText(document, node.accessibility.label, locale)
      }
      role="img"
      style={{
        ...appearanceStyle(document, node.appearance),
        color: resolvedProtocolColor(document, node.color),
        display: "inline-grid",
        fontSize: node.size,
        height: node.size,
        lineHeight: 1,
        placeItems: "center",
        width: node.size,
      }}
    >
      {glyph}
    </span>
  );
}

function renderFeatureList(
  node: Extract<ProtocolNode, { type: "featureList" }>,
  context: PreviewNodeContext
): ReactNode {
  const { document, locale } = context;
  const markerSize = resolvedFeatureListMarkerSize(node);
  return (
    <ul
      aria-label={resolveLocalizedText(
        document,
        node.accessibility.label,
        locale
      )}
      className="w-full text-left"
      style={{
        ...appearanceStyle(document, node.appearance),
        display: "grid",
        gap: node.gap,
      }}
    >
      {node.items.map((item, index) => {
        // markerColor is required on a Feature List, but resolution returns
        // undefined for a token that no longer exists; the glyph then inherits
        // the list's text colour rather than disappearing.
        const markerColor =
          resolvedProtocolColor(document, node.markerColor) ?? "currentColor";
        const marker = resolvedItemMarker(node, item);
        return (
          <li
            className="flex items-start gap-2"
            key={item.id}
            style={typographyStyle(document, node.typography)}
          >
            {marker.kind === "icon" && marker.name === "checkmark" ? (
              <CheckIcon
                aria-hidden
                className="mt-0.5 shrink-0"
                color={markerColor}
                size={markerSize}
                weight="bold"
              />
            ) : (
              <span
                className="mt-0.5 flex shrink-0 items-center justify-center"
                style={{
                  color: markerColor,
                  minWidth: markerSize,
                }}
              >
                {markerGlyph(marker, index, {
                  color: markerColor,
                  size: markerSize,
                })}
              </span>
            )}
            <span>{resolveLocalizedText(document, item.text, locale)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function renderProductSelector(
  node: Extract<ProtocolNode, { type: "productSelector" }>,
  context: PreviewNodeContext
): ReactNode {
  const {
    document,
    locale,
    locked,
    mockProducts,
    mockPurchaseState,
    productLayerPreview,
    props,
    selectedProducts,
  } = context;
  const selectorLabel = resolveLocalizedText(
    document,
    node.accessibility.label,
    locale
  );
  const selectorHint = node.accessibility.hint
    ? resolveLocalizedText(document, node.accessibility.hint, locale)
    : null;
  const availableCards = node.cards.flatMap((card) => {
    const reference = document.products.find(
      (entry) => entry.id === card.productReferenceId
    );
    const mock = mockProducts.find(
      (entry) => entry.productReferenceId === card.productReferenceId
    );
    if (
      mockPurchaseState === "productUnavailable" ||
      !reference ||
      mock?.availability !== "available" ||
      (productCardRequiresPrice(document, card, locale) &&
        !mock.localizedPrice.trim())
    ) {
      return [];
    }
    return [{ card, mock, reference }];
  });
  const requestedCardId =
    selectedProducts[node.id] ?? node.initialProductCardId;
  const chosenCardId = availableCards.some(
    ({ card }) => card.id === requestedCardId
  )
    ? requestedCardId
    : availableCards[0]?.card.id;
  return (
    <fieldset
      aria-describedby={selectorHint ? `${node.id}-hint` : undefined}
      aria-label={selectorLabel}
      className="w-full text-left"
      disabled={locked}
      style={appearanceStyle(document, node.appearance)}
    >
      <legend className="sr-only">{selectorLabel}</legend>
      {selectorHint ? (
        <span className="sr-only" id={`${node.id}-hint`}>
          {selectorHint}
        </span>
      ) : null}
      {availableCards.length === 0 ? (
        <p className="rounded border border-amber-200 bg-amber-50 p-3 text-amber-900 text-sm">
          {resolveLocalizedText(
            document,
            node.unavailableFallback.message,
            locale
          )}
        </p>
      ) : (
        <div
          style={{
            alignItems: alignmentStyle(node.crossAxisAlignment),
            display: "flex",
            flexDirection: node.direction === "vertical" ? "column" : "row",
            gap: node.gap,
          }}
        >
          {availableCards.map(({ card, mock, reference }) => {
            const chosen = card.id === chosenCardId;
            const visualSelected =
              productLayerPreview?.nodeId === card.id
                ? productLayerPreview.state === "selected"
                : chosen;
            const productContext: PreviewProductContext = {
              cardId: card.id,
              name: resolveLocalizedText(document, reference.label, locale),
              price: productPrice(mock),
              productReferenceId: reference.id,
              selected: chosen,
              visualSelected,
              selectorId: node.id,
            };
            return (
              <PreviewNode
                key={card.id}
                {...props}
                inheritedLocked={locked}
                node={card}
                productContext={productContext}
              />
            );
          })}
        </div>
      )}
    </fieldset>
  );
}

function renderProductCard(
  node: Extract<ProtocolNode, { type: "productCard" }>,
  context: PreviewNodeContext
): ReactNode {
  const { document, locale, locked, props } = context;
  const product = props.productContext;
  if (!product) {
    return null;
  }
  const style = resolveProductCardStyle(node, product.visualSelected);
  const cardBackground = resolvedBackground(document, style.background);
  const accessibleLabel = node.accessibility
    ? resolveProductTemplate(
        resolveLocalizedText(document, node.accessibility.label, locale),
        product
      )
    : undefined;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a product card is a labelled grouping per the ARIA authoring practices, and fieldset would put form semantics on preview content
    <div
      aria-label={accessibleLabel}
      className="relative flex h-full w-full cursor-pointer"
      role="group"
      style={{
        ...appearanceStyle(document, style),
        ...(cardBackground.video ? cardBackground.style : {}),
        alignItems: alignmentStyle(node.crossAxisAlignment),
        display: "flex",
        flexDirection: node.direction === "vertical" ? "column" : "row",
        gap: node.gap,
        isolation: "isolate",
        justifyContent: distributionStyle(node.mainAxisDistribution),
        overflow: node.clipContent ? "hidden" : "visible",
      }}
    >
      {cardBackground.video ? (
        <video
          aria-hidden
          autoPlay
          className={`pointer-events-none absolute inset-0 -z-1 size-full ${cardBackground.video.contentMode === "fill" ? "object-cover" : "object-contain"}`}
          loop
          muted
          playsInline
          poster={cardBackground.video.poster}
          src={cardBackground.video.src}
        />
      ) : null}
      <input
        aria-label={accessibleLabel ?? product.name}
        checked={product.selected}
        className="sr-only"
        disabled={locked}
        name={`preview-${product.selectorId}`}
        onChange={() => props.onProductSelect(product.selectorId, node.id)}
        type="radio"
        value={node.id}
      />
      {node.children.map((child) => (
        <PreviewNode
          key={child.id}
          {...props}
          inheritedLocked={locked}
          node={child}
          productContext={product}
        />
      ))}
      <span
        aria-hidden
        className={`pointer-events-none absolute end-2 top-2 z-2 grid size-4 place-items-center rounded-full border text-[10px] ${product.visualSelected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-transparent"}`}
      >
        ✓
      </span>
    </div>
  );
}

function renderProductBadge(
  node: Extract<ProtocolNode, { type: "productBadge" }>,
  context: PreviewNodeContext
): ReactNode {
  const { document, locked, productLayerPreview, props } = context;
  const product = props.productContext;
  if (!product) {
    return null;
  }
  const visualSelected =
    productLayerPreview?.nodeId === node.id
      ? productLayerPreview.state === "selected"
      : product.visualSelected;
  const style = resolveProductBadgeStyle(node, visualSelected);
  const badgeBackground = resolvedBackground(document, style.background);
  return (
    <span
      className="relative min-w-0"
      style={{
        ...appearanceStyle(document, style),
        ...(badgeBackground.video ? badgeBackground.style : {}),
        alignItems: alignmentStyle(node.crossAxisAlignment),
        display: "flex",
        flexDirection: node.direction === "vertical" ? "column" : "row",
        gap: node.gap,
        isolation: "isolate",
        justifyContent: distributionStyle(node.mainAxisDistribution),
        pointerEvents: "none",
      }}
    >
      {badgeBackground.video ? (
        <video
          aria-hidden
          autoPlay
          className={`pointer-events-none absolute inset-0 -z-1 size-full ${badgeBackground.video.contentMode === "fill" ? "object-cover" : "object-contain"}`}
          loop
          muted
          playsInline
          poster={badgeBackground.video.poster}
          src={badgeBackground.video.src}
        />
      ) : null}
      {node.children.map((child) => (
        <PreviewNode
          key={child.id}
          {...props}
          inheritedLocked={locked}
          node={child}
          productContext={product}
        />
      ))}
    </span>
  );
}

function renderButton(
  node: Extract<ProtocolNode, { type: "button" }>,
  context: PreviewNodeContext
): ReactNode {
  const {
    document,
    editingComponentId,
    locale,
    locked,
    props,
    purchaseDisabledIds,
    selectedComponentId,
  } = context;
  const purchaseUnavailable =
    node.action.type === "purchase" && purchaseDisabledIds.has(node.id);
  const previewingProgress =
    node.inProgressChildren?.some((child) =>
      subtreeIncludesId(child, selectedComponentId)
    ) ?? false;
  const children =
    previewingProgress && node.inProgressChildren
      ? node.inProgressChildren
      : node.children;
  const editingInside = children.some((child) =>
    subtreeIncludesId(child, editingComponentId)
  );
  return (
    <div
      className="relative w-full"
      style={{
        ...appearanceStyle(document, node.appearance),
      }}
    >
      <button
        aria-busy={previewingProgress || undefined}
        aria-label={resolveLocalizedText(
          document,
          node.accessibility.label,
          locale
        )}
        className="pointer-events-none absolute inset-0 size-full rounded-[inherit] border-0 bg-transparent"
        disabled={locked || purchaseUnavailable}
        tabIndex={-1}
        type="button"
      />
      {/*
        A busy Button keeps its authored name and announces the resolved
        mosaic.a11y.in_progress string as its own element. Neither `children`
        nor `inProgressChildren` are announced in either state, so the content
        below stays hidden from assistive technology.
      */}
      {previewingProgress ? (
        <AnnouncedSegments context={context} node={node} state="inProgress" />
      ) : null}
      <div
        aria-hidden={editingInside ? undefined : true}
        style={{
          alignItems: alignmentStyle(node.crossAxisAlignment),
          display: "flex",
          flexDirection: node.direction === "vertical" ? "column" : "row",
          gap: node.gap,
          justifyContent: distributionStyle(node.mainAxisDistribution),
        }}
      >
        {children.map((child) => (
          <PreviewNode
            key={child.id}
            {...props}
            inheritedLocked={locked}
            node={child}
          />
        ))}
      </div>
    </div>
  );
}

function renderSwitch(
  node: Extract<ProtocolNode, { type: "switch" }>,
  context: PreviewNodeContext
): ReactNode {
  const {
    document,
    editTriggerProps,
    editing,
    inlineEditor,
    locale,
    locked,
    props,
    switchValues,
  } = context;
  return (
    <label
      className="flex w-full cursor-pointer items-center justify-between gap-3"
      style={{
        ...appearanceStyle(document, node.appearance),
        ...typographyStyle(document, node.typography),
      }}
    >
      {editing ? (
        inlineEditor(
          "min-w-0 flex-1 resize-none bg-transparent focus:outline-none",
          typographyStyle(document, node.typography)
        )
      ) : (
        <span {...editTriggerProps()}>
          {resolveLocalizedText(document, node.label, locale)}
        </span>
      )}
      <input
        aria-label={resolveLocalizedText(
          document,
          node.accessibility.label,
          locale
        )}
        checked={switchValues[node.id] ?? node.initialValue}
        className="h-5 w-9 accent-[var(--primary)]"
        disabled={locked}
        onChange={(event) =>
          props.onSwitchChange(node.id, event.target.checked)
        }
        style={{
          accentColor: resolvedProtocolColor(document, node.onTrackColor),
        }}
        type="checkbox"
      />
    </label>
  );
}

function renderCountdown(
  node: Extract<ProtocolNode, { type: "countdown" }>,
  context: PreviewNodeContext
): ReactNode {
  const { document, locale, now } = context;
  const completed = Date.parse(node.endsAt) <= now;
  const accessible = node.accessibility.label
    ? resolveLocalizedText(document, node.accessibility.label, locale)
    : undefined;
  return (
    <time
      aria-label={accessible}
      dateTime={node.endsAt}
      role="timer"
      style={{
        ...appearanceStyle(document, node.appearance),
        ...typographyStyle(document, node.typography),
      }}
    >
      {completed
        ? resolveLocalizedText(document, node.completedText, locale)
        : countdownText(node, now)}
    </time>
  );
}

function renderCarousel(
  node: Extract<ProtocolNode, { type: "carousel" }>,
  context: PreviewNodeContext
): ReactNode {
  const { carouselPages, document, locale, locked, props } = context;
  const pageIndex = Math.min(
    node.pages.length - 1,
    carouselPages[node.id] ?? node.initialPageIndex
  );
  return (
    <section
      aria-label={resolveLocalizedText(
        document,
        node.accessibility.label,
        locale
      )}
      aria-roledescription="carousel"
      className="w-full"
      style={appearanceStyle(document, node.appearance)}
    >
      <div className="grid">
        {node.pages.map((page, index) => (
          // biome-ignore lint/a11y/useSemanticElements: a carousel slide is role="group" per the ARIA authoring practices
          <div
            aria-hidden={index !== pageIndex}
            aria-label={resolveLocalizedText(
              document,
              page.accessibilityLabel,
              locale
            )}
            aria-roledescription="slide"
            className="col-start-1 row-start-1 min-w-0"
            key={page.id}
            role="group"
            style={{
              pointerEvents: index === pageIndex ? undefined : "none",
              visibility: index === pageIndex ? "visible" : "hidden",
            }}
          >
            <PreviewNode
              {...props}
              inheritedLocked={locked}
              node={page.content}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-center gap-2">
        <button
          aria-label="Previous carousel page"
          className="grid size-7 place-items-center rounded-full border"
          disabled={locked || pageIndex === 0}
          onClick={(event) => {
            event.stopPropagation();
            props.onCarouselPageChange(node.id, pageIndex - 1);
          }}
          type="button"
        >
          <CaretLeftIcon aria-hidden />
        </button>
        {node.showsIndicators ? (
          <span aria-live="polite" className="text-muted-foreground text-xs">
            {pageIndex + 1} / {node.pages.length}
          </span>
        ) : null}
        <button
          aria-label="Next carousel page"
          className="grid size-7 place-items-center rounded-full border"
          disabled={locked || pageIndex === node.pages.length - 1}
          onClick={(event) => {
            event.stopPropagation();
            props.onCarouselPageChange(node.id, pageIndex + 1);
          }}
          type="button"
        >
          <CaretRightIcon aria-hidden />
        </button>
      </div>
    </section>
  );
}

function renderTabs(
  node: Extract<ProtocolNode, { type: "tabs" }>,
  context: PreviewNodeContext
): ReactNode {
  const { document, locale, locked, props, tabSelections } = context;
  const selectedTabId = tabSelections[node.id] ?? node.initialTabId;
  const activeTab =
    node.tabs.find((tab) => tab.id === selectedTabId) ?? node.tabs[0];
  return (
    <div
      className="w-full"
      style={{
        ...appearanceStyle(document, node.appearance),
        display: "flex",
        flexDirection: "column",
        gap: node.gap,
      }}
    >
      <div
        aria-label={resolveLocalizedText(
          document,
          node.accessibility.label,
          locale
        )}
        aria-orientation={
          node.tabBarDirection === "vertical" ? "vertical" : "horizontal"
        }
        role="tablist"
        style={{
          display: "flex",
          flexDirection: node.tabBarDirection === "vertical" ? "column" : "row",
          gap: node.tabBarGap,
          justifyContent: distributionStyle(node.tabBarDistribution),
        }}
      >
        {node.tabs.map((tab) => {
          const selected = tab.id === activeTab?.id;
          const style = resolveSelectionStyle(node, selected);
          return (
            <button
              aria-controls={`${tab.id}-panel`}
              aria-selected={selected}
              disabled={locked}
              id={`${tab.id}-tab`}
              key={tab.id}
              onClick={(event) => {
                event.stopPropagation();
                props.onTabSelect(node.id, tab.id);
              }}
              role="tab"
              style={{
                ...appearanceStyle(document, style),
                ...typographyStyle(document, node.labelTypography),
                ...(selected
                  ? {
                      color: resolvedProtocolColor(
                        document,
                        node.selectedLabelColor
                      ),
                    }
                  : {}),
              }}
              type="button"
            >
              {resolveLocalizedText(document, tab.label, locale)}
            </button>
          );
        })}
      </div>
      {node.tabs.map((tab) => (
        <div
          aria-labelledby={`${tab.id}-tab`}
          hidden={tab.id !== activeTab?.id}
          id={`${tab.id}-panel`}
          key={tab.id}
          role="tabpanel"
        >
          {tab.id === activeTab?.id ? (
            <PreviewNode
              {...props}
              inheritedLocked={locked}
              node={tab.content}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}

interface TimelineMarkerStyle {
  readonly color: string;
  readonly size: number;
}

/**
 * One marker glyph, for either component that draws one.
 *
 * Feature List and Timeline share a single marker union, so they draw through
 * a single renderer here too.
 */
function markerGlyph(
  marker: Marker,
  index: number,
  style: TimelineMarkerStyle
): ReactNode {
  if (marker.kind === "dot") {
    return (
      <span
        aria-hidden
        style={{
          background: style.color,
          borderRadius: "50%",
          display: "block",
          height: style.size / 2,
          width: style.size / 2,
        }}
      />
    );
  }
  if (marker.kind === "ordinal") {
    return <span aria-hidden>{index + 1}</span>;
  }
  return <span aria-hidden>{PROTOCOL_ICON_GLYPHS[marker.name]}</span>;
}

function timelineMarkerContent(
  entry: Extract<ProtocolNode, { type: "timeline" }>["entries"][number],
  index: number,
  marker: TimelineMarkerStyle
): ReactNode {
  if (!entry.marker) {
    return null;
  }
  return markerGlyph(entry.marker, index, marker);
}

function renderTimeline(
  node: Extract<ProtocolNode, { type: "timeline" }>,
  context: PreviewNodeContext
): ReactNode {
  const { document, locale } = context;
  // markerColor and markerSize are declared exactly when at least one entry
  // carries a marker, so either both are authored or no glyph is drawn at all.
  // Nothing is substituted for an absent value.
  const markerColor = node.markerColor
    ? resolvedProtocolColor(document, node.markerColor)
    : undefined;
  const marker: TimelineMarkerStyle | null =
    markerColor !== undefined && node.markerSize !== undefined
      ? { color: markerColor, size: node.markerSize }
      : null;
  const connectorColor = resolvedProtocolColor(document, node.connector.color);
  // With no markers anywhere the gutter only has to carry the connector rule.
  const gutterWidth = marker ? marker.size : node.connector.width;
  return (
    <ol
      aria-label={resolveLocalizedText(
        document,
        node.accessibility.label,
        locale
      )}
      className="w-full text-left"
      style={{
        ...appearanceStyle(document, node.appearance),
        display: "grid",
        gap: node.gap,
      }}
    >
      {node.entries.map((entry, index) => (
        <li className="flex items-stretch gap-3" key={entry.id}>
          <span
            aria-hidden
            className="flex shrink-0 flex-col items-center"
            style={{ width: gutterWidth }}
          >
            {marker ? (
              <span
                className="grid shrink-0 place-items-center"
                style={{
                  color: marker.color,
                  fontSize: marker.size * 0.7,
                  height: marker.size,
                  lineHeight: 1,
                  width: marker.size,
                }}
              >
                {timelineMarkerContent(entry, index, marker)}
              </span>
            ) : null}
            {index === node.entries.length - 1 ? null : (
              <span
                className="flex-1"
                style={{
                  borderInlineStartColor: connectorColor,
                  borderInlineStartStyle: node.connector.style,
                  borderInlineStartWidth: node.connector.width,
                }}
              />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span
              className="block"
              style={typographyStyle(document, node.titleTypography)}
            >
              {resolveLocalizedText(document, entry.title, locale)}
            </span>
            {entry.description && node.descriptionTypography ? (
              <span
                className="block"
                style={typographyStyle(document, node.descriptionTypography)}
              >
                {resolveLocalizedText(document, entry.description, locale)}
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

function awardEmblem(
  node: Extract<ProtocolNode, { type: "award" }>,
  context: PreviewNodeContext
): ReactNode {
  const { document } = context;
  const { emblem } = node;
  if (!emblem) {
    return null;
  }
  if (emblem.type === "icon") {
    return (
      <span
        aria-hidden
        style={{
          color: resolvedProtocolColor(document, emblem.color),
          display: "inline-grid",
          fontSize: emblem.size,
          height: emblem.size,
          lineHeight: 1,
          placeItems: "center",
          width: emblem.size,
        }}
      >
        {PROTOCOL_ICON_GLYPHS[emblem.name]}
      </span>
    );
  }
  const asset = document.assets.find(
    (entry) => entry.id === emblem.assetId && entry.type === "image"
  );
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center overflow-hidden rounded bg-linear-to-br from-cyan-100 to-teal-200 text-[9px] text-teal-900"
      style={{ height: emblem.size, width: emblem.size }}
    >
      {asset?.source.type === "remote" ? (
        // biome-ignore lint/correctness/useImageSize: the span above already reserves the authored emblem box
        <img alt="" className="size-full object-cover" src={asset.source.url} />
      ) : (
        emblem.assetId
      )}
    </span>
  );
}

function renderAward(
  node: Extract<ProtocolNode, { type: "award" }>,
  context: PreviewNodeContext
): ReactNode {
  const { document, locale } = context;
  return (
    // biome-ignore lint/a11y/useSemanticElements: an award is a labelled grouping per the ARIA authoring practices, and no HTML element carries that role
    <div
      aria-label={resolveLocalizedText(
        document,
        node.accessibility.label,
        locale
      )}
      className="w-full"
      role="group"
      style={{
        ...appearanceStyle(document, node.appearance),
        alignItems: alignmentStyle(node.crossAxisAlignment),
        display: "flex",
        flexDirection: node.direction === "vertical" ? "column" : "row",
        gap: node.gap,
      }}
    >
      {awardEmblem(node, context)}
      <span className="min-w-0">
        <span
          className="block"
          style={typographyStyle(document, node.titleTypography)}
        >
          {resolveLocalizedText(document, node.title, locale)}
        </span>
        {node.subtitle && node.subtitleTypography ? (
          <span
            className="block"
            style={typographyStyle(document, node.subtitleTypography)}
          >
            {resolveLocalizedText(document, node.subtitle, locale)}
          </span>
        ) : null}
      </span>
    </div>
  );
}

function socialProofRating(
  node: Extract<ProtocolNode, { type: "socialProof" }>,
  context: PreviewNodeContext
): ReactNode {
  const { document } = context;
  const { rating } = node;
  if (!rating) {
    return null;
  }
  const stepsPerPoint = ratingStepsPerPoint(rating.step);
  const filled = resolvedProtocolColor(document, rating.filledColor);
  const empty = resolvedProtocolColor(document, rating.emptyColor);
  return (
    <span aria-hidden className="flex items-center gap-0.5">
      {ratingPointOffsets(rating).map((point) => {
        const earned = rating.value - point * stepsPerPoint;
        const proportion = Math.min(1, Math.max(0, earned / stepsPerPoint));
        return (
          <span
            className="relative inline-block"
            key={`star-of-${rating.maximum}-${point}`}
            style={{ color: empty, fontSize: rating.size, lineHeight: 1 }}
          >
            ★
            <span
              className="absolute inset-y-0 start-0 overflow-hidden"
              style={{ color: filled, width: `${proportion * 100}%` }}
            >
              ★
            </span>
          </span>
        );
      })}
    </span>
  );
}

/**
 * The announced segments for a component, each as its own accessibility
 * element. The protocol's `separator` is null by contract: joining segments
 * would invent punctuation that is wrong in some scripts, so nothing here
 * concatenates them.
 */
function AnnouncedSegments({
  node,
  context,
  state = null,
  skipSegments = [],
}: {
  node: ProtocolNode;
  context: PreviewNodeContext;
  state?: "idle" | "inProgress" | null;
  skipSegments?: readonly string[];
}) {
  const { document, locale } = context;
  const result = announcementFor(document, node, locale, state);
  if (result.status === "unavailable") {
    return (
      <p
        className="rounded border border-destructive/40 bg-destructive/10 p-2 text-destructive text-xs"
        role="alert"
      >
        {result.message}
      </p>
    );
  }
  const skipped = new Set(skipSegments);
  return (
    <>
      {result.announcement.container.value ? (
        <span className="sr-only">{result.announcement.container.value}</span>
      ) : null}
      {result.announcement.elements.flatMap((element) =>
        skipped.has(element.segment)
          ? []
          : [
              <span
                className="sr-only"
                key={`${element.item ?? ""}.${element.segment}`}
              >
                {element.text}
              </span>,
            ]
      )}
    </>
  );
}

function renderSocialProof(
  node: Extract<ProtocolNode, { type: "socialProof" }>,
  context: PreviewNodeContext
): ReactNode {
  const { document, locale } = context;
  const avatarAsset = node.avatar
    ? document.assets.find(
        (entry) => entry.id === node.avatar?.assetId && entry.type === "image"
      )
    : undefined;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a testimonial is a labelled grouping per the ARIA authoring practices, and blockquote carries no accessible name
    <div
      aria-label={resolveLocalizedText(
        document,
        node.accessibility.label,
        locale
      )}
      className="w-full text-left"
      role="group"
      style={{
        ...appearanceStyle(document, node.appearance),
        display: "flex",
        flexDirection: "column",
        gap: node.gap,
      }}
    >
      <AnnouncedSegments
        context={context}
        node={node}
        skipSegments={["quote", "attribution"]}
      />
      {socialProofRating(node, context)}
      <span style={typographyStyle(document, node.quoteTypography)}>
        {resolveLocalizedText(document, node.quote, locale)}
      </span>
      <span className="flex items-center gap-2">
        {node.avatar ? (
          <span
            aria-hidden
            className="grid shrink-0 place-items-center overflow-hidden rounded-full bg-linear-to-br from-cyan-100 to-teal-200 text-[9px] text-teal-900"
            style={{ height: node.avatar.size, width: node.avatar.size }}
          >
            {avatarAsset?.source.type === "remote" ? (
              // biome-ignore lint/correctness/useImageSize: the span above already reserves the authored avatar box
              <img
                alt=""
                className="size-full object-cover"
                src={avatarAsset.source.url}
              />
            ) : (
              node.avatar.assetId
            )}
          </span>
        ) : null}
        <span style={typographyStyle(document, node.attributionTypography)}>
          {resolveLocalizedText(document, node.attribution, locale)}
        </span>
      </span>
    </div>
  );
}

function renderNodeContent(
  node: ProtocolNode,
  context: PreviewNodeContext
): ReactNode {
  switch (node.type) {
    case "stack":
      return renderStack(node, context);
    case "text":
      return renderText(node, context);
    case "image":
      return renderImage(node, context);
    case "icon":
      return renderIcon(node, context);
    case "featureList":
      return renderFeatureList(node, context);
    case "productSelector":
      return renderProductSelector(node, context);
    case "productCard":
      return renderProductCard(node, context);
    case "productBadge":
      return renderProductBadge(node, context);
    case "button":
      return renderButton(node, context);
    case "switch":
      return renderSwitch(node, context);
    case "countdown":
      return renderCountdown(node, context);
    case "carousel":
      return renderCarousel(node, context);
    case "tabs":
      return renderTabs(node, context);
    case "timeline":
      return renderTimeline(node, context);
    case "award":
      return renderAward(node, context);
    case "socialProof":
      return renderSocialProof(node, context);
    default: {
      const unhandled: never = node;
      throw new Error(`Unhandled node.type: ${JSON.stringify(unhandled)}`);
    }
  }
}

export function PreviewNode(props: PreviewNodeProps) {
  const {
    document,
    editingComponentId,
    hiddenIds,
    hoveredComponentId,
    inheritedLocked,
    locale,
    lockedIds,
    node,
    selectedComponentId,
    switchValues,
    tabSelections,
  } = props;
  const editor = useEditorActions();
  const visibility = "visibility" in node ? node.visibility : undefined;
  const resolvedVisibility = resolveNodeVisibility(visibility, {
    switches: switchValues,
    tabs: tabSelections,
  });
  if (resolvedVisibility.status === "unresolved") {
    // The controller this node names is not declared by the document, so the
    // preview cannot know whether the node belongs on screen. Rendering it, or
    // dropping it, would both assert an answer nobody authored; the editor
    // states the failure and the validation panel names the same defect.
    return (
      <p
        className="w-full rounded border border-destructive/40 bg-destructive/10 p-2 text-destructive text-xs"
        role="alert"
      >
        {resolvedVisibility.message}
      </p>
    );
  }
  if (hiddenIds.has(node.id) || !resolvedVisibility.visible) {
    return null;
  }
  const selected = selectedComponentId === node.id;
  const hovered = hoveredComponentId === node.id;
  const locked = inheritedLocked || lockedIds.has(node.id);
  const editing = editingComponentId === node.id;
  const editable = getEditableCanvasText(node);

  function beginEdit(event: {
    preventDefault: () => void;
    stopPropagation: () => void;
  }) {
    event.preventDefault();
    event.stopPropagation();
    if (locked || !editable) {
      return;
    }
    editor.selectComponent(node.id);
    props.onBeginEdit(node);
  }

  /**
   * Double-click is not a keyboard-reachable gesture. Enter and F2 are the
   * conventional keys for entering an inline edit, so text and switch labels
   * expose the same affordance to keyboard users.
   */
  function beginEditKeyDown(event: React.KeyboardEvent) {
    if (!editable || locked) {
      return;
    }
    if (event.key !== "Enter" && event.key !== "F2") {
      return;
    }
    beginEdit(event);
  }

  function editTriggerProps() {
    if (!editable || locked) {
      return {};
    }
    return {
      onDoubleClick: beginEdit,
      onKeyDown: beginEditKeyDown,
      tabIndex: 0,
      title: "Press Enter or F2 to edit this text",
    };
  }

  function inlineEditor(className: string, style?: CSSProperties) {
    if (!editable) {
      return null;
    }
    return (
      <InlineEditor
        ariaLabel={editable.ariaLabel}
        className={className}
        multiline={editable.multiline}
        onCancel={props.onCancelEdit}
        onCommit={props.onCommitEdit}
        onUpdate={(value) => props.onUpdateEdit(node, value)}
        style={style}
        value={resolveLocalizedText(document, editable.text, locale)}
      />
    );
  }

  const content = renderNodeContent(node, {
    ...props,
    beginEdit,
    beginEditKeyDown,
    editable,
    editing,
    editTriggerProps,
    editor,
    hovered,
    inlineEditor,
    locked,
    props,
    selected,
  });

  return (
    <NodeFrame
      document={document}
      hovered={hovered}
      inheritedLocked={inheritedLocked}
      lockedIds={lockedIds}
      node={node}
      selected={selected}
    >
      {content}
    </NodeFrame>
  );
}
