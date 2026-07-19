import { CaretLeftIcon } from "@phosphor-icons/react/dist/ssr/CaretLeft"
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr/CaretRight"
import { CheckIcon } from "@phosphor-icons/react/dist/ssr/Check"
import { createElement, useEffect, useRef } from "react"
import type { CSSProperties, ReactNode } from "react"

import { useEditorActions } from "@/features/paywall-editor/stores/editor-store-context"
import type {
  MockProductDefinition,
  MockPurchaseState,
  MosaicDocument,
  ProtocolNode,
} from "@/features/paywall-editor/types/editor"
import { getEditableCanvasText } from "@/features/paywall-editor/utils/canvas-preview-interactions"
import { resolveLocalizedText } from "@/features/paywall-editor/utils/document-tree"
import {
  axisSizingCss,
  resolvedBackground,
  resolvedProtocolColor,
  resolvedShadow,
} from "@/features/paywall-editor/utils/protocol-styles"
import { fillAxisIsBounded, fixedSizingClipsOverflow } from "@/features/paywall-editor/utils/sizing"
import {
  evaluateVisibility,
  interpolateProductText,
  resolveProductBadgeStyle,
  resolveProductCardStyle,
} from "@/lib/mosaic-protocol"

export interface PreviewNodeProps {
  readonly carouselPages: Readonly<Record<string, number>>
  readonly document: MosaicDocument
  readonly direction: "ltr" | "rtl"
  readonly editingComponentId: string | null
  readonly hiddenIds: ReadonlySet<string>
  readonly hoveredComponentId: string | null
  readonly inheritedLocked: boolean
  readonly locale: string
  readonly lockedIds: ReadonlySet<string>
  readonly mockProducts: readonly MockProductDefinition[]
  readonly mockPurchaseState: MockPurchaseState
  readonly node: ProtocolNode
  readonly productContext?: PreviewProductContext
  readonly productLayerPreview: {
    readonly nodeId: string
    readonly state: "default" | "selected"
  } | null
  readonly now: number
  readonly purchaseDisabledIds: ReadonlySet<string>
  readonly selectedComponentId: string | null
  readonly selectedProducts: Readonly<Record<string, string>>
  readonly switchValues: Readonly<Record<string, boolean>>
  readonly onBeginEdit: (node: ProtocolNode) => void
  readonly onCancelEdit: () => void
  readonly onCarouselPageChange: (id: string, index: number) => void
  readonly onCommitEdit: () => void
  readonly onProductSelect: (id: string, productId: string) => void
  readonly onSwitchChange: (id: string, value: boolean) => void
  readonly onUpdateEdit: (node: ProtocolNode, value: string) => void
}

interface PreviewProductContext {
  readonly cardId: string
  readonly name: string
  readonly price: string
  readonly productReferenceId: string
  readonly selected: boolean
  readonly visualSelected: boolean
  readonly selectorId: string
}

type ProductCardNode = Extract<ProtocolNode, { type: "productCard" }>

type IconName = Extract<ProtocolNode, { type: "icon" }>["name"]

const RTL_ICON_NAMES: Partial<Record<IconName, IconName>> = {
  arrowBackward: "arrowForward",
  arrowForward: "arrowBackward",
  chevronBackward: "chevronForward",
  chevronForward: "chevronBackward",
}

function frameStyle(document: MosaicDocument, node: ProtocolNode): CSSProperties {
  const outer = "outerInsets" in node ? node.outerInsets : undefined
  const sizing = "sizing" in node ? node.sizing : undefined
  const badgePlacement = node.type === "productBadge" ? node.placement : undefined
  return {
    width: axisSizingCss(sizing?.width, {
      axis: "width",
      bounded: fillAxisIsBounded(document, node, "width"),
      componentId: node.id,
    }),
    height: axisSizingCss(sizing?.height, {
      axis: "height",
      bounded: fillAxisIsBounded(document, node, "height"),
      componentId: node.id,
    }),
    overflow: fixedSizingClipsOverflow(node) ? "hidden" : undefined,
    marginBlockEnd: outer?.bottom,
    marginBlockStart: outer?.top,
    marginInlineEnd: outer?.end,
    marginInlineStart: outer?.start,
    ...(badgePlacement?.mode === "overlay"
      ? {
          position: "absolute",
          insetBlockEnd: badgePlacement.anchor.startsWith("bottom")
            ? badgePlacement.inset
            : undefined,
          insetBlockStart: badgePlacement.anchor.startsWith("top")
            ? badgePlacement.inset
            : undefined,
          insetInlineEnd: badgePlacement.anchor.endsWith("End") ? badgePlacement.inset : undefined,
          insetInlineStart: badgePlacement.anchor.endsWith("Start")
            ? badgePlacement.inset
            : undefined,
          zIndex: 1,
        }
      : {}),
  }
}

function resolveProductTemplate(value: string, product: PreviewProductContext | undefined) {
  if (!product) return value
  const resolved = interpolateProductText(value, {
    name: product.name,
    fallbackName: product.name,
    price: product.price,
  })
  return resolved.available ? resolved.value : ""
}

function productCardRequiresPrice(document: MosaicDocument, card: ProductCardNode, locale: string) {
  const usesPrice = (value: Parameters<typeof resolveLocalizedText>[1]) =>
    /\{\{\s*product\.price\s*\}\}/.test(resolveLocalizedText(document, value, locale))
  if (card.accessibility && usesPrice(card.accessibility.label)) return true

  function nodeRequiresPrice(node: ProtocolNode): boolean {
    if (node.type === "text") return usesPrice(node.value)
    if (node.type === "stack" || node.type === "productBadge") {
      return node.children.some(nodeRequiresPrice)
    }
    return false
  }

  return card.children.some(nodeRequiresPrice)
}

type PreviewAppearance = {
  background?: NonNullable<Extract<ProtocolNode, { type: "text" }>["appearance"]>["background"]
  border?: NonNullable<Extract<ProtocolNode, { type: "text" }>["appearance"]>["border"]
  clipContent?: boolean
  cornerRadius?: number
  opacity?: number
  padding?: { top: number; start: number; bottom: number; end: number }
  shadow?: NonNullable<Extract<ProtocolNode, { type: "text" }>["appearance"]>["shadow"]
}

function appearanceStyle(
  document: MosaicDocument,
  value: PreviewAppearance | undefined,
): CSSProperties {
  const background = resolvedBackground(document, value?.background)
  return {
    ...(background.mediaType === "video" ? {} : background.style),
    borderColor: resolvedProtocolColor(document, value?.border?.color),
    borderStyle: value?.border ? "solid" : undefined,
    borderWidth: value?.border?.width,
    borderRadius: value?.cornerRadius,
    opacity: value?.opacity,
    overflow: value?.clipContent ? "hidden" : undefined,
    paddingBlockEnd: value?.padding?.bottom,
    paddingBlockStart: value?.padding?.top,
    paddingInlineEnd: value?.padding?.end,
    paddingInlineStart: value?.padding?.start,
    boxShadow: resolvedShadow(document, value?.shadow),
  }
}

function typographyStyle(
  document: MosaicDocument,
  typography: Extract<ProtocolNode, { type: "text" }>["typography"],
): CSSProperties {
  return {
    color: resolvedProtocolColor(document, typography.color),
    fontSize: typography.fontSize,
    fontWeight: {
      regular: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
    }[typography.weight],
    lineHeight: typography.lineHeightMultiplier,
    textAlign: typography.alignment,
    ...(typography.maxLines
      ? {
          display: "-webkit-box",
          overflow: "hidden",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: typography.maxLines,
        }
      : {}),
  }
}

function productPrice(product: MockProductDefinition | undefined) {
  return product?.availability === "available" ? product.localizedPrice : ""
}

function alignmentStyle(
  alignment: Extract<ProtocolNode, { type: "stack" | "button" }>["crossAxisAlignment"],
) {
  switch (alignment) {
    case "start":
      return "flex-start"
    case "center":
      return "center"
    case "end":
      return "flex-end"
    case "stretch":
      return "stretch"
  }
}

function distributionStyle(
  distribution: Extract<ProtocolNode, { type: "stack" | "button" }>["mainAxisDistribution"],
) {
  return distribution === "spaceBetween" ? "space-between" : distribution
}

function subtreeIncludesId(node: ProtocolNode, id: string | null): boolean {
  if (!id) return false
  if (node.id === id) return true
  if (node.type === "stack") return node.children.some((child) => subtreeIncludesId(child, id))
  if (node.type === "button") {
    return [...node.children, ...(node.inProgressChildren ?? [])].some((child) =>
      subtreeIncludesId(child, id),
    )
  }
  if (node.type === "carousel") {
    return node.pages.some((page) => subtreeIncludesId(page.content, id))
  }
  if (node.type === "productSelector") {
    return node.cards.some((card) => subtreeIncludesId(card, id))
  }
  if (node.type === "productCard" || node.type === "productBadge") {
    return node.children.some((child) => subtreeIncludesId(child, id))
  }
  return false
}

function headingElement(level: number): "h1" | "h2" | "h3" | "h4" | "h5" | "h6" {
  return `h${Math.min(6, Math.max(1, level))}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6"
}

function InlineEditor({
  ariaLabel,
  className,
  multiline,
  onCancel,
  onCommit,
  onUpdate,
  style,
  value,
}: {
  ariaLabel: string
  className: string
  multiline: boolean
  onCancel: () => void
  onCommit: () => void
  onUpdate: (value: string) => void
  style?: CSSProperties
  value: string
}) {
  const fieldRef = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => fieldRef.current?.focus(), [])
  return (
    <textarea
      aria-label={ariaLabel}
      className={className}
      onBlur={onCommit}
      onChange={(event) => onUpdate(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault()
          event.stopPropagation()
          onCancel()
        } else if (event.key === "Enter" && (!multiline || !event.shiftKey)) {
          event.preventDefault()
          event.stopPropagation()
          onCommit()
        }
      }}
      ref={fieldRef}
      rows={multiline ? 3 : 1}
      style={style}
      value={value}
    />
  )
}

function NodeFrame({
  children,
  document,
  inheritedLocked,
  node,
  selected,
  hovered,
  lockedIds,
}: {
  children: ReactNode
  document: MosaicDocument
  inheritedLocked: boolean
  node: ProtocolNode
  selected: boolean
  hovered: boolean
  lockedIds: ReadonlySet<string>
}) {
  const editor = useEditorActions()
  const appearance = "appearance" in node ? node.appearance : undefined
  const background = resolvedBackground(document, appearance?.background)
  const locked = inheritedLocked || lockedIds.has(node.id)
  const stateClass = locked
    ? "cursor-not-allowed opacity-65 ring-slate-300 ring-1"
    : selected
      ? "ring-primary ring-2 ring-offset-2 ring-offset-white"
      : hovered
        ? "ring-primary/40 ring-1"
        : "hover:ring-primary/35 hover:ring-1"
  return (
    <div
      aria-disabled={locked || undefined}
      className={`relative min-w-0 rounded-lg outline-none ${stateClass}`}
      data-component-id={node.id}
      data-preview-node-type={node.type}
      onClick={(event) => {
        event.stopPropagation()
        if (!locked) editor.selectComponent(node.id)
      }}
      onKeyDown={(event) => {
        if (locked || (event.key !== "Enter" && event.key !== " ")) return
        event.preventDefault()
        event.stopPropagation()
        editor.selectComponent(node.id)
      }}
      onMouseEnter={(event) => {
        event.stopPropagation()
        editor.hoverComponent(node.id)
      }}
      onMouseLeave={(event) => {
        event.stopPropagation()
        editor.hoverComponent(null)
      }}
      style={{
        ...frameStyle(document, node),
        ...(background.video ? background.style : {}),
        isolation: "isolate",
      }}
      role="button"
      tabIndex={locked ? -1 : 0}
      title={locked ? "Locked in Studio Layers" : undefined}
    >
      {background.video ? (
        <video
          aria-hidden
          autoPlay
          className="pointer-events-none absolute inset-0 -z-10 size-full rounded-[inherit]"
          loop
          muted
          playsInline
          poster={background.video.poster}
          src={background.video.src}
          style={{ objectFit: background.video.contentMode === "fill" ? "cover" : "contain" }}
        />
      ) : null}
      {children}
    </div>
  )
}

const COUNTDOWN_UNITS = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
  ["second", 1_000],
] as const

function countdownText(node: Extract<ProtocolNode, { type: "countdown" }>, now: number) {
  let remaining = Math.max(0, Date.parse(node.endsAt) - now)
  const first = COUNTDOWN_UNITS.findIndex(([unit]) => unit === node.largestUnit)
  const last = COUNTDOWN_UNITS.findIndex(([unit]) => unit === node.smallestUnit)
  return COUNTDOWN_UNITS.slice(first, last + 1)
    .map(([unit, milliseconds]) => {
      const amount = Math.floor(remaining / milliseconds)
      remaining %= milliseconds
      return `${String(amount).padStart(2, "0")} ${unit}${amount === 1 ? "" : "s"}`
    })
    .join("  ")
}

// This is the single exhaustive Protocol-node renderer; splitting the switch would duplicate the
// shared selection, locking, editing, and product context that every native-preview node needs.
// oxlint-disable-next-line react-doctor/no-giant-component
export function PreviewNode(props: PreviewNodeProps) {
  const {
    carouselPages,
    document,
    direction,
    editingComponentId,
    hiddenIds,
    hoveredComponentId,
    inheritedLocked,
    locale,
    lockedIds,
    mockProducts,
    mockPurchaseState,
    node,
    now,
    purchaseDisabledIds,
    productLayerPreview,
    selectedComponentId,
    selectedProducts,
    switchValues,
  } = props
  const editor = useEditorActions()
  const visibility = "visibility" in node ? node.visibility : undefined
  if (hiddenIds.has(node.id) || !evaluateVisibility(visibility, switchValues)) return null
  const selected = selectedComponentId === node.id
  const hovered = hoveredComponentId === node.id
  const locked = inheritedLocked || lockedIds.has(node.id)
  const editing = editingComponentId === node.id
  const editable = getEditableCanvasText(node)

  function beginEdit(event: { preventDefault: () => void; stopPropagation: () => void }) {
    event.preventDefault()
    event.stopPropagation()
    if (locked || !editable) return
    editor.selectComponent(node.id)
    props.onBeginEdit(node)
  }

  function inlineEditor(className: string, style?: CSSProperties) {
    if (!editable) return null
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
    )
  }

  let content: ReactNode
  switch (node.type) {
    case "stack":
      content = (
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
            <div className="border-border text-muted-foreground w-full rounded-lg border border-dashed p-3 text-center text-xs">
              Empty Stack
            </div>
          ) : (
            node.children.map((child) => (
              <PreviewNode key={child.id} {...props} inheritedLocked={locked} node={child} />
            ))
          )}
        </div>
      )
      break
    case "text": {
      const value = resolveProductTemplate(
        resolveLocalizedText(document, node.value, locale),
        props.productContext,
      )
      const style = typographyStyle(document, node.typography)
      content = editing
        ? inlineEditor("w-full resize-none bg-transparent px-1 py-0.5 focus:outline-none", style)
        : createElement(
            node.accessibility.role === "heading" ? headingElement(node.accessibility.level) : "p",
            {
              "aria-label": node.accessibility.label
                ? resolveProductTemplate(
                    resolveLocalizedText(document, node.accessibility.label, locale),
                    props.productContext,
                  )
                : undefined,
              className: "w-full px-1 py-0.5",
              onDoubleClick: beginEdit,
              style: { ...appearanceStyle(document, node.appearance), ...style },
            },
            value,
          )
      break
    }
    case "image": {
      const asset = document.assets.find(
        (entry) => entry.id === node.assetId && entry.type === "image",
      )
      const imageLabel = node.accessibility.hidden
        ? undefined
        : resolveLocalizedText(document, node.accessibility.label, locale)
      content = (
        <figure
          aria-hidden={node.accessibility.hidden || undefined}
          aria-label={imageLabel}
          className="flex w-full items-center justify-center overflow-hidden bg-linear-to-br from-cyan-100 to-teal-200 text-xs font-medium text-teal-900"
          role={node.accessibility.hidden ? undefined : "img"}
          style={{
            ...appearanceStyle(document, node.appearance),
            aspectRatio: node.aspectRatio,
            objectFit: node.contentMode === "fit" ? "contain" : "cover",
          }}
        >
          {asset?.source.type === "remote" ? (
            <img
              alt=""
              className="size-full"
              src={asset.source.url}
              style={{ objectFit: node.contentMode === "fit" ? "contain" : "cover" }}
            />
          ) : (
            <figcaption>{asset?.source.key ?? node.assetId}</figcaption>
          )}
        </figure>
      )
      break
    }
    case "icon": {
      const iconName = direction === "rtl" ? (RTL_ICON_NAMES[node.name] ?? node.name) : node.name
      const glyph = {
        checkmark: "✓",
        close: "×",
        lock: "⌑",
        restore: "↺",
        externalLink: "↗",
        arrowBackward: "←",
        arrowForward: "→",
        chevronBackward: "‹",
        chevronForward: "›",
      }[iconName]
      content = (
        <span
          aria-hidden={node.accessibility.hidden || undefined}
          aria-label={
            node.accessibility.hidden
              ? undefined
              : resolveLocalizedText(document, node.accessibility.label, locale)
          }
          role={node.accessibility.hidden ? undefined : "img"}
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
      )
      break
    }
    case "featureList":
      content = (
        <ul
          aria-label={resolveLocalizedText(document, node.accessibility.label, locale)}
          className="w-full text-left"
          style={{ ...appearanceStyle(document, node.appearance), display: "grid", gap: node.gap }}
        >
          {node.items.map((item) => (
            <li
              className="flex items-start gap-2"
              key={item.id}
              style={typographyStyle(document, node.typography)}
            >
              <CheckIcon
                aria-hidden
                className="mt-0.5 shrink-0"
                color={resolvedProtocolColor(document, node.markerColor)}
                weight="bold"
              />
              <span>{resolveLocalizedText(document, item.text, locale)}</span>
            </li>
          ))}
        </ul>
      )
      break
    case "productSelector": {
      const selectorLabel = resolveLocalizedText(document, node.accessibility.label, locale)
      const selectorHint = node.accessibility.hint
        ? resolveLocalizedText(document, node.accessibility.hint, locale)
        : null
      const availableCards = node.cards.flatMap((card) => {
        const reference = document.products.find((entry) => entry.id === card.productReferenceId)
        const mock = mockProducts.find(
          (entry) => entry.productReferenceId === card.productReferenceId,
        )
        if (
          mockPurchaseState === "productUnavailable" ||
          !reference ||
          mock?.availability !== "available" ||
          (productCardRequiresPrice(document, card, locale) && !mock.localizedPrice.trim())
        ) {
          return []
        }
        return [{ card, mock, reference }]
      })
      const requestedCardId = selectedProducts[node.id] ?? node.initialProductCardId
      const chosenCardId = availableCards.some(({ card }) => card.id === requestedCardId)
        ? requestedCardId
        : availableCards[0]?.card.id
      content = (
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
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              {resolveLocalizedText(document, node.unavailableFallback.message, locale)}
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
                const chosen = card.id === chosenCardId
                const visualSelected =
                  productLayerPreview?.nodeId === card.id
                    ? productLayerPreview.state === "selected"
                    : chosen
                const productContext: PreviewProductContext = {
                  cardId: card.id,
                  name: resolveLocalizedText(document, reference.label, locale),
                  price: productPrice(mock),
                  productReferenceId: reference.id,
                  selected: chosen,
                  visualSelected,
                  selectorId: node.id,
                }
                return (
                  <PreviewNode
                    key={card.id}
                    {...props}
                    inheritedLocked={locked}
                    node={card}
                    productContext={productContext}
                  />
                )
              })}
            </div>
          )}
        </fieldset>
      )
      break
    }
    case "productCard": {
      const product = props.productContext
      if (!product) return null
      const style = resolveProductCardStyle(node, product.visualSelected)
      const cardBackground = resolvedBackground(document, style.background)
      const accessibleLabel = node.accessibility
        ? resolveProductTemplate(
            resolveLocalizedText(document, node.accessibility.label, locale),
            product,
          )
        : undefined
      content = (
        <div
          aria-label={accessibleLabel}
          className="relative flex h-full w-full cursor-pointer"
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
      )
      break
    }
    case "productBadge": {
      const product = props.productContext
      if (!product) return null
      const visualSelected =
        productLayerPreview?.nodeId === node.id
          ? productLayerPreview.state === "selected"
          : product.visualSelected
      const style = resolveProductBadgeStyle(node, visualSelected)
      const badgeBackground = resolvedBackground(document, style.background)
      content = (
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
      )
      break
    }
    case "button": {
      const purchaseUnavailable =
        node.action.type === "purchase" && purchaseDisabledIds.has(node.id)
      const previewingProgress =
        node.inProgressChildren?.some((child) => subtreeIncludesId(child, selectedComponentId)) ??
        false
      const children = previewingProgress ? node.inProgressChildren! : node.children
      const editingInside = children.some((child) => subtreeIncludesId(child, editingComponentId))
      content = (
        <div
          className="relative w-full"
          style={{
            ...appearanceStyle(document, node.appearance),
          }}
        >
          <button
            aria-busy={previewingProgress || undefined}
            aria-label={resolveLocalizedText(document, node.accessibility.label, locale)}
            className="pointer-events-none absolute inset-0 size-full rounded-[inherit] border-0 bg-transparent"
            disabled={locked || purchaseUnavailable}
            tabIndex={-1}
            type="button"
          />
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
              <PreviewNode key={child.id} {...props} inheritedLocked={locked} node={child} />
            ))}
          </div>
        </div>
      )
      break
    }
    case "switch":
      content = (
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
              typographyStyle(document, node.typography),
            )
          ) : (
            <span onDoubleClick={beginEdit}>
              {resolveLocalizedText(document, node.label, locale)}
            </span>
          )}
          <input
            aria-label={resolveLocalizedText(document, node.accessibility.label, locale)}
            checked={switchValues[node.id] ?? node.initialValue}
            className="h-5 w-9 accent-[var(--primary)]"
            disabled={locked}
            onChange={(event) => props.onSwitchChange(node.id, event.target.checked)}
            role="switch"
            style={{ accentColor: resolvedProtocolColor(document, node.onTrackColor) }}
            type="checkbox"
          />
        </label>
      )
      break
    case "countdown": {
      const completed = Date.parse(node.endsAt) <= now
      const accessible = node.accessibility.label
        ? resolveLocalizedText(document, node.accessibility.label, locale)
        : undefined
      content = (
        <time
          aria-label={accessible}
          dateTime={node.endsAt}
          style={{
            ...appearanceStyle(document, node.appearance),
            ...typographyStyle(document, node.typography),
          }}
        >
          {completed
            ? resolveLocalizedText(document, node.completedText, locale)
            : countdownText(node, now)}
        </time>
      )
      break
    }
    case "carousel": {
      const pageIndex = Math.min(
        node.pages.length - 1,
        carouselPages[node.id] ?? node.initialPageIndex,
      )
      content = (
        <section
          aria-label={resolveLocalizedText(document, node.accessibility.label, locale)}
          aria-roledescription="carousel"
          className="w-full"
          style={appearanceStyle(document, node.appearance)}
        >
          <div className="grid">
            {node.pages.map((page, index) => (
              <div
                aria-hidden={index !== pageIndex}
                aria-label={resolveLocalizedText(document, page.accessibilityLabel, locale)}
                className="col-start-1 row-start-1 min-w-0"
                key={page.id}
                style={{
                  pointerEvents: index === pageIndex ? undefined : "none",
                  visibility: index === pageIndex ? "visible" : "hidden",
                }}
              >
                <PreviewNode {...props} inheritedLocked={locked} node={page.content} />
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-center gap-2">
            <button
              aria-label="Previous carousel page"
              className="grid size-7 place-items-center rounded-full border"
              disabled={locked || pageIndex === 0}
              onClick={(event) => {
                event.stopPropagation()
                props.onCarouselPageChange(node.id, pageIndex - 1)
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
                event.stopPropagation()
                props.onCarouselPageChange(node.id, pageIndex + 1)
              }}
              type="button"
            >
              <CaretRightIcon aria-hidden />
            </button>
          </div>
        </section>
      )
      break
    }
  }

  return (
    <NodeFrame
      hovered={hovered}
      document={document}
      inheritedLocked={inheritedLocked}
      lockedIds={lockedIds}
      node={node}
      selected={selected}
    >
      {content}
    </NodeFrame>
  )
}
