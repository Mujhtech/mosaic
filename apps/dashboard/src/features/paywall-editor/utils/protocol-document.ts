import type {
  LocalizedText,
  MosaicDocument,
  ProtocolNode,
} from "@/features/paywall-editor/types/editor"
import { cloneValue } from "@/features/paywall-editor/utils/clone"
import { flattenDocument } from "@/features/paywall-editor/utils/document-tree"
import type { MosaicPaywallV02CapabilityName } from "@/lib/mosaic-protocol"

const CAPABILITY_BY_TYPE: Partial<
  Record<ProtocolNode["type"] | "scrollContainer", MosaicPaywallV02CapabilityName>
> = {
  scrollContainer: "layout.scrollContainer",
  stack: "layout.stack",
  text: "component.text",
  image: "component.image",
  icon: "component.icon",
  featureList: "component.featureList",
  productSelector: "component.productSelector",
  productCard: "component.productCard",
  productBadge: "component.productBadge",
  button: "component.button",
  carousel: "component.carousel",
  switch: "component.switch",
  countdown: "component.countdown",
}

const CAPABILITY_ORDER: readonly MosaicPaywallV02CapabilityName[] = [
  "layout.scrollContainer",
  "layout.stack",
  "layout.sizing",
  "layout.heightSizing",
  "layout.outerInsets",
  "navigation.screens",
  "navigation.sheets",
  "component.text",
  "component.image",
  "component.icon",
  "component.featureList",
  "component.productSelector",
  "component.productCard",
  "component.productBadge",
  "component.button",
  "component.carousel",
  "component.switch",
  "component.countdown",
  "localization.catalogs",
  "localization.rtl",
  "localization.productTemplate",
  "product.references",
  "asset.bundledImage",
  "asset.remoteImage",
  "asset.bundledVideo",
  "asset.remoteVideo",
  "action.purchase",
  "action.restore",
  "action.close",
  "action.navigateTo",
  "action.navigateBack",
  "action.openExternalUrl",
  "accessibility.metadata",
  "fallback.asset",
  "fallback.product",
  "outcome.normalized",
  "style.colors",
  "style.designTokens",
  "style.gradientBackground",
  "style.mediaBackground",
  "style.shadow",
  "style.box",
  "style.clipping",
  "style.typography",
  "style.productCardStates",
  "visibility.static",
  "condition.switchVisibility",
]

const COLOR_FIELDS = new Set([
  "background",
  "color",
  "markerColor",
  "offTrackColor",
  "onTrackColor",
  "productLabelColor",
  "runtimePriceColor",
  "textColor",
  "thumbColor",
])

function objectUsesColor(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(objectUsesColor)
  if (!value || typeof value !== "object") return false
  return Object.entries(value).some(
    ([key, entry]) =>
      (COLOR_FIELDS.has(key) &&
        (typeof entry === "string" ||
          (entry !== null && typeof entry === "object" && "type" in entry))) ||
      objectUsesColor(entry),
  )
}

function objectUsesStyleType(value: unknown, types: ReadonlySet<string>): boolean {
  if (Array.isArray(value)) return value.some((entry) => objectUsesStyleType(entry, types))
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  return Object.entries(record).some(([key, entry]) => {
    const entryRecord =
      entry && typeof entry === "object" ? (entry as Record<string, unknown>) : undefined
    return (
      ((key === "background" || key === "shadow" || key === "value") &&
        typeof entryRecord?.type === "string" &&
        types.has(entryRecord.type)) ||
      objectUsesStyleType(entry, types)
    )
  })
}

function collectLocalizedText(value: unknown, entries: LocalizedText[]) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectLocalizedText(entry, entries))
    return
  }
  if (!value || typeof value !== "object") return
  const record = value as Record<string, unknown>
  if (typeof record.default === "string" && typeof record.localizationKey === "string") {
    entries.push({ default: record.default, localizationKey: record.localizationKey })
    return
  }
  Object.values(record).forEach((entry) => collectLocalizedText(entry, entries))
}

function localizedTextUsesProductTemplate(document: MosaicDocument, value: LocalizedText) {
  return [
    value.default,
    ...Object.values(document.localization.locales)
      .map((catalog) => catalog.strings[value.localizationKey])
      .filter((text): text is string => typeof text === "string"),
  ].some((text) => /\{\{\s*product\.(?:name|price)\s*\}\}/.test(text))
}

export function expectedCapabilities(document: MosaicDocument) {
  const capabilities = new Set<MosaicPaywallV02CapabilityName>([
    "localization.catalogs",
    "layout.scrollContainer",
    "navigation.screens",
  ])
  if (Object.values(document.localization.locales).some((locale) => locale.direction === "rtl")) {
    capabilities.add("localization.rtl")
  }
  if (document.products.length > 0) capabilities.add("product.references")
  for (const asset of document.assets) {
    capabilities.add(
      asset.type === "image"
        ? asset.source.type === "remote"
          ? "asset.remoteImage"
          : "asset.bundledImage"
        : asset.source.type === "remote"
          ? "asset.remoteVideo"
          : "asset.bundledVideo",
    )
    if (asset.type === "image") capabilities.add("fallback.asset")
  }
  if (document.screens.some((screen) => screen.presentation.type === "sheet")) {
    capabilities.add("navigation.sheets")
  }
  if (
    document.designSystem.colors.length > 0 ||
    document.designSystem.backgrounds.length > 0 ||
    document.designSystem.shadows.length > 0
  ) {
    capabilities.add("style.designTokens")
  }
  if (objectUsesStyleType(document, new Set(["linearGradient", "radialGradient"]))) {
    capabilities.add("style.gradientBackground")
  }
  if (objectUsesStyleType(document, new Set(["image", "video"]))) {
    capabilities.add("style.mediaBackground")
  }
  if (objectUsesStyleType(document, new Set(["shadow", "shadowToken"]))) {
    capabilities.add("style.shadow")
  }
  if (document.screens.some((screen) => screen.layout.background)) {
    capabilities.add("style.box")
    capabilities.add("style.colors")
  }
  const nodes = [
    ...document.screens.map((screen) => screen.layout.content),
    ...flattenDocument(document).map((entry) => entry.node),
  ]
  for (const node of nodes) {
    const capability = CAPABILITY_BY_TYPE[node.type]
    if (capability) capabilities.add(capability)
    if ("accessibility" in node) capabilities.add("accessibility.metadata")
    if ("typography" in node) capabilities.add("style.typography")
    if (
      ("appearance" in node && node.appearance) ||
      node.type === "productSelector" ||
      node.type === "stack"
    ) {
      capabilities.add("style.box")
    }
    if (("sizing" in node && node.sizing) || node.type === "image") {
      capabilities.add("layout.sizing")
      capabilities.add("layout.heightSizing")
    }
    if ("outerInsets" in node && node.outerInsets) capabilities.add("layout.outerInsets")
    if ("appearance" in node && node.appearance && "clipContent" in node.appearance) {
      capabilities.add("style.clipping")
    }
    if ("visibility" in node && node.visibility?.mode === "switch") {
      capabilities.add("condition.switchVisibility")
    } else if ("visibility" in node && node.visibility) {
      capabilities.add("visibility.static")
    }
    if (objectUsesColor(node)) capabilities.add("style.colors")
    if (node.type === "productSelector") {
      capabilities.add("fallback.product")
      capabilities.add("outcome.normalized")
    }
    if (node.type === "productCard" || node.type === "productBadge") {
      capabilities.add("style.productCardStates")
    }
    if (node.type === "text" && localizedTextUsesProductTemplate(document, node.value)) {
      capabilities.add("localization.productTemplate")
    }
    if (
      node.type === "productCard" &&
      node.accessibility &&
      localizedTextUsesProductTemplate(document, node.accessibility.label)
    ) {
      capabilities.add("localization.productTemplate")
    }
    if (node.type === "button") {
      const actionCapability: MosaicPaywallV02CapabilityName = `action.${node.action.type}`
      capabilities.add(actionCapability)
      if (["purchase", "restore", "close"].includes(node.action.type)) {
        capabilities.add("outcome.normalized")
      }
    }
  }
  return new Set(CAPABILITY_ORDER.filter((capability) => capabilities.has(capability)))
}

export function synchronizeProtocolMetadata(document: MosaicDocument): MosaicDocument {
  const next = cloneValue(document)
  const entries = flattenDocument(next)

  const referencedProducts = new Set(
    entries.flatMap((entry) =>
      entry.node.type === "productCard" ? [entry.node.productReferenceId] : [],
    ),
  )
  next.products = next.products.filter((product) => referencedProducts.has(product.id))

  const localized: LocalizedText[] = []
  collectLocalizedText(next.assets, localized)
  collectLocalizedText(next.products, localized)
  collectLocalizedText(next.screens, localized)
  const defaultValues = new Map(localized.map((entry) => [entry.localizationKey, entry.default]))
  next.localization.locales = Object.fromEntries(
    Object.entries(next.localization.locales).map(([locale, catalog]) => [
      locale,
      {
        ...catalog,
        strings: Object.fromEntries(
          [...defaultValues].map(([key, defaultValue]) => [
            key,
            locale === next.localization.defaultLocale
              ? defaultValue
              : (catalog.strings[key] ?? defaultValue),
          ]),
        ),
      },
    ]),
  )

  next.compatibility.requiredCapabilities = [...expectedCapabilities(next)].map((name) => ({
    name,
    version: "0.2",
  }))
  return next
}
