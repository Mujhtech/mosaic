import type {
  MosaicDocument,
  PaywallDesignSystem,
  ProtocolBackground,
  ProtocolColor,
} from "@/features/paywall-editor/types/editor"

export type DesignCategory = keyof PaywallDesignSystem

type GradientBackground = Extract<ProtocolBackground, { type: "linearGradient" | "radialGradient" }>
export type GradientStop = GradientBackground["stops"][number]

const POSITION_STEP = 0.01

export function clampGradientAngle(angle: number) {
  if (!Number.isFinite(angle)) return 0
  return Math.min(360, Math.max(0, angle))
}

export function insertGradientStop(stops: readonly GradientStop[]): GradientStop[] {
  if (stops.length >= 8) return [...stops]

  const ordered = [...stops].sort((left, right) => left.position - right.position)
  if (ordered.length < 2) return [...ordered]

  let insertionIndex = 1
  let largestGap = -1
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]
    const current = ordered[index]
    if (!previous || !current) continue
    const gap = current.position - previous.position
    if (gap > largestGap) {
      largestGap = gap
      insertionIndex = index
    }
  }

  const previous = ordered[insertionIndex - 1]
  const next = ordered[insertionIndex]
  if (!previous || !next || largestGap <= 0) return ordered

  const inserted: GradientStop = {
    color: previous.color,
    position: previous.position + largestGap / 2,
  }
  return [...ordered.slice(0, insertionIndex), inserted, ...ordered.slice(insertionIndex)]
}

export function updateGradientStopPosition(
  stops: readonly GradientStop[],
  index: number,
  requestedPosition: number,
): GradientStop[] {
  const current = stops[index]
  if (!current || !Number.isFinite(requestedPosition)) return [...stops]

  const previous = stops[index - 1]
  const next = stops[index + 1]
  const minimum = previous ? previous.position + POSITION_STEP : 0
  const maximum = next ? next.position - POSITION_STEP : 1
  const position =
    minimum <= maximum ? Math.min(maximum, Math.max(minimum, requestedPosition)) : current.position

  return stops.map((stop, currentIndex) => (currentIndex === index ? { ...stop, position } : stop))
}

export function tokenReferenceType(category: DesignCategory) {
  if (category === "colors") return "colorToken" as const
  if (category === "backgrounds") return "backgroundToken" as const
  return "shadowToken" as const
}

function referencedTokenId(category: DesignCategory, value: unknown): string | null {
  if (!value || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  return record.type === tokenReferenceType(category) && typeof record.id === "string"
    ? record.id
    : null
}

function categoryTokens(system: PaywallDesignSystem, category: DesignCategory) {
  if (category === "colors") return system.colors
  if (category === "backgrounds") return system.backgrounds
  return system.shadows
}

export function isSafeTokenReplacement(
  system: PaywallDesignSystem,
  category: DesignCategory,
  sourceId: string,
  replacementId: string,
) {
  if (sourceId === replacementId) return false
  const tokens = categoryTokens(system, category)
  const byId = new Map(tokens.map((token) => [token.id, token]))
  if (!byId.has(replacementId)) return false

  const visited = new Set<string>()
  let currentId: string | null = replacementId
  while (currentId) {
    if (currentId === sourceId || visited.has(currentId)) return false
    visited.add(currentId)
    const current = byId.get(currentId)
    currentId = current ? referencedTokenId(category, current.value) : null
  }
  return true
}

export function appendBackgroundAsset(
  document: MosaicDocument,
  type: "image" | "video",
): { readonly assetId: string; readonly document: MosaicDocument } {
  const used = new Set(document.assets.map((asset) => asset.id))
  let ordinal = document.assets.filter((asset) => asset.type === type).length + 1
  while (used.has(`${type}-${ordinal}`)) ordinal += 1
  const assetId = `${type}-${ordinal}`
  const source = {
    type: "remote" as const,
    url: `https://example.com/${assetId}.${type === "image" ? "png" : "mp4"}`,
  }
  const asset =
    type === "image"
      ? ({
          type,
          id: assetId,
          source,
          fallback: {
            type: "placeholder" as const,
            value: {
              default: "Image placeholder",
              localizationKey: `paywall.assets.${assetId.replaceAll("-", "_")}.fallback`,
            },
          },
        } as const)
      : ({ type, id: assetId, source } as const)
  return { assetId, document: { ...document, assets: [...document.assets, asset] } }
}

export function defaultMediaBackground(
  type: "image" | "video",
  assetId: string,
): ProtocolBackground {
  return {
    type,
    assetId,
    contentMode: "fill",
    fallbackColor: "surface.default" as ProtocolColor,
  }
}
