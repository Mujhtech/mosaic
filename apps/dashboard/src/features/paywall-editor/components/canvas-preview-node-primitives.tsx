/* eslint-disable react-refresh/only-export-components -- renderer primitives and their pure style functions form one internal module. */
import { useEffect, useRef } from "react"
import type { CSSProperties, ReactNode } from "react"

import { useEditorActions } from "@/features/paywall-editor/stores/editor-store-context"
import type {
  MockProductDefinition,
  MosaicDocument,
  ProtocolNode,
} from "@/features/paywall-editor/types/editor"
import { resolveLocalizedText } from "@/features/paywall-editor/utils/document-tree"
import {
  axisSizingCss,
  resolvedBackground,
  resolvedProtocolColor,
  resolvedShadow,
} from "@/features/paywall-editor/utils/protocol-styles"
import { fillAxisIsBounded, fixedSizingClipsOverflow } from "@/features/paywall-editor/utils/sizing"
import { interpolateProductText } from "@/lib/mosaic-protocol"

export interface PreviewProductContext {
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

export const RTL_ICON_NAMES: Partial<Record<IconName, IconName>> = {
  arrowBackward: "arrowForward",
  arrowForward: "arrowBackward",
  chevronBackward: "chevronForward",
  chevronForward: "chevronBackward",
}

export function frameStyle(document: MosaicDocument, node: ProtocolNode): CSSProperties {
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

export function resolveProductTemplate(value: string, product: PreviewProductContext | undefined) {
  if (!product) return value
  const resolved = interpolateProductText(value, {
    name: product.name,
    fallbackName: product.name,
    price: product.price,
  })
  return resolved.available ? resolved.value : ""
}

export function productCardRequiresPrice(
  document: MosaicDocument,
  card: ProductCardNode,
  locale: string,
) {
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

export function appearanceStyle(
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

export function typographyStyle(
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

export function productPrice(product: MockProductDefinition | undefined) {
  return product?.availability === "available" ? product.localizedPrice : ""
}

export function alignmentStyle(
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

export function distributionStyle(
  distribution: Extract<ProtocolNode, { type: "stack" | "button" }>["mainAxisDistribution"],
) {
  return distribution === "spaceBetween" ? "space-between" : distribution
}

export function subtreeIncludesId(node: ProtocolNode, id: string | null): boolean {
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

export function headingElement(level: number): "h1" | "h2" | "h3" | "h4" | "h5" | "h6" {
  return `h${Math.min(6, Math.max(1, level))}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6"
}

export function InlineEditor({
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

export function NodeFrame({
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

export function countdownText(node: Extract<ProtocolNode, { type: "countdown" }>, now: number) {
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
