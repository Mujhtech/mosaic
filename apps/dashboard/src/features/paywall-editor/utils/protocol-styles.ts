import type { CSSProperties } from "react"

import type {
  AxisSizing,
  MosaicDocument,
  ProtocolBackground,
  ProtocolColor,
  ProtocolShadow,
} from "@/features/paywall-editor/types/editor"
import {
  resolveAxisSizing,
  resolveBackgroundToken,
  resolveColorToken,
  resolveShadowToken,
} from "@/lib/mosaic-protocol"

const SEMANTIC_COLORS: Readonly<Record<string, string>> = {
  "text.primary": "var(--foreground)",
  "text.secondary": "var(--muted-foreground)",
  "surface.default": "var(--background)",
  "surface.elevated": "var(--card)",
  "action.primary": "var(--primary)",
  "action.onPrimary": "var(--primary-foreground)",
  "border.default": "var(--border)",
  transparent: "transparent",
}

export function isColorTokenReference(
  color: ProtocolColor,
): color is Extract<ProtocolColor, { type: "colorToken" }> {
  return typeof color === "object"
}

export function protocolColorLabel(document: MosaicDocument, color: ProtocolColor) {
  if (!isColorTokenReference(color)) return color
  return document.designSystem.colors.find((token) => token.id === color.id)?.name ?? color.id
}

export function resolvedProtocolColor(document: MosaicDocument, color: ProtocolColor | undefined) {
  if (!color) return undefined
  const resolved = resolveColorToken(document, color)
  if (!resolved) return undefined
  if (!resolved.startsWith("#")) return SEMANTIC_COLORS[resolved]
  const red = Number.parseInt(resolved.slice(1, 3), 16)
  const green = Number.parseInt(resolved.slice(3, 5), 16)
  const blue = Number.parseInt(resolved.slice(5, 7), 16)
  const alpha = Number.parseInt(resolved.slice(7, 9), 16) / 255
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

function remoteAssetUrl(document: MosaicDocument, assetId: string, type?: "image" | "video") {
  const asset = document.assets.find(
    (candidate) => candidate.id === assetId && (!type || candidate.type === type),
  )
  return asset?.source.type === "remote" ? asset.source.url : undefined
}

export interface ResolvedPreviewBackground {
  readonly mediaType?: "image" | "video"
  readonly style: CSSProperties
  readonly video?: {
    readonly contentMode: "fit" | "fill"
    readonly poster?: string
    readonly src: string
  }
  readonly diagnostic?: string
}

export function protocolGradientAngleToCss(angle: number) {
  return (((angle + 90) % 360) + 360) % 360
}

export function resolvedBackground(
  document: MosaicDocument,
  background: ProtocolBackground | undefined,
): ResolvedPreviewBackground {
  if (!background) return { style: {} }
  const resolved = resolveBackgroundToken(document, background)
  if (!resolved) {
    return {
      style: {},
      diagnostic: `Design-system background ${background.type === "backgroundToken" ? background.id : ""} is missing.`,
    }
  }
  switch (resolved.type) {
    case "color":
      return { style: { background: resolvedProtocolColor(document, resolved.value) } }
    case "linearGradient": {
      const stops = resolved.stops
        .map(
          (stop) =>
            `${resolvedProtocolColor(document, stop.color) ?? "transparent"} ${stop.position * 100}%`,
        )
        .join(", ")
      return {
        style: {
          backgroundImage: `linear-gradient(${protocolGradientAngleToCss(resolved.angle)}deg, ${stops})`,
        },
      }
    }
    case "radialGradient": {
      const stops = resolved.stops
        .map(
          (stop) =>
            `${resolvedProtocolColor(document, stop.color) ?? "transparent"} ${stop.position * 100}%`,
        )
        .join(", ")
      return {
        style: {
          backgroundImage: `radial-gradient(circle ${resolved.radius * 100}% at ${resolved.center.x * 100}% ${resolved.center.y * 100}%, ${stops})`,
        },
      }
    }
    case "image": {
      const src = remoteAssetUrl(document, resolved.assetId, "image")
      const fallback = resolvedProtocolColor(document, resolved.fallbackColor)
      return {
        mediaType: "image",
        style: {
          backgroundColor: fallback,
          backgroundImage: src ? `url(${JSON.stringify(src)})` : undefined,
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          backgroundSize: resolved.contentMode === "fill" ? "cover" : "contain",
        },
        diagnostic: src
          ? undefined
          : `Image background ${resolved.assetId} is unavailable in the browser; showing its fallback colour.`,
      }
    }
    case "video": {
      const src = remoteAssetUrl(document, resolved.assetId, "video")
      const poster = resolved.posterAssetId
        ? remoteAssetUrl(document, resolved.posterAssetId, "image")
        : undefined
      return {
        mediaType: "video",
        style: { background: resolvedProtocolColor(document, resolved.fallbackColor) },
        video: src ? { src, poster, contentMode: resolved.contentMode } : undefined,
        diagnostic: src
          ? undefined
          : `Video background ${resolved.assetId} is unavailable in the browser; showing its fallback colour.`,
      }
    }
  }
}

export function resolvedShadow(document: MosaicDocument, shadow: ProtocolShadow | undefined) {
  if (!shadow) return undefined
  const value = resolveShadowToken(document, shadow)
  if (!value) return undefined
  return `${value.offsetX}px ${value.offsetY}px ${value.blurRadius}px ${resolvedProtocolColor(document, value.color) ?? "transparent"}`
}

export function axisSizingCss(
  value: AxisSizing | undefined,
  options?: {
    readonly axis?: "width" | "height"
    readonly bounded?: boolean
    readonly componentId?: string
  },
) {
  if (!value || value === "fit") return undefined
  const resolved = resolveAxisSizing(value, options).value
  if (resolved === "fit") return undefined
  return resolved === "fill" ? "100%" : resolved.value
}

export function sizingMode(value: AxisSizing | undefined): "fit" | "fill" | "fixed" {
  if (!value) return "fit"
  return typeof value === "string" ? value : "fixed"
}
