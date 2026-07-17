import type {
  LocalizedText,
  MosaicDocument,
  ProtocolNode,
} from "@/features/paywall-editor/types/editor"
import { cloneValue } from "@/features/paywall-editor/utils/clone"
import { flattenDocument } from "@/features/paywall-editor/utils/document-tree"
import type { MosaicPaywallCapabilityName } from "@/lib/mosaic-protocol"

const CAPABILITY_BY_TYPE: Partial<
  Record<ProtocolNode["type"] | "scrollContainer", MosaicPaywallCapabilityName>
> = {
  scrollContainer: "layout.scrollContainer",
  verticalStack: "layout.verticalStack",
  text: "component.text",
  image: "component.image",
  featureList: "component.featureList",
  productSelector: "component.productSelector",
  purchaseButton: "component.purchaseButton",
  restoreButton: "component.restoreButton",
  closeButton: "component.closeButton",
  legalText: "component.legalText",
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

export function expectedCapabilities(document: MosaicDocument) {
  const capabilities = new Set<MosaicPaywallCapabilityName>([
    "localization.catalogs",
    "layout.scrollContainer",
  ])
  if (Object.values(document.localization.locales).some((locale) => locale.direction === "rtl")) {
    capabilities.add("localization.rtl")
  }
  if (document.products.length > 0) capabilities.add("product.references")
  if (document.assets.length > 0) {
    capabilities.add("asset.bundledImage")
    capabilities.add("fallback.asset")
  }
  const nodes = [document.layout.content, ...flattenDocument(document).map((entry) => entry.node)]
  for (const node of nodes) {
    const capability = CAPABILITY_BY_TYPE[node.type]
    if (capability) capabilities.add(capability)
    if ("accessibility" in node) capabilities.add("accessibility.metadata")
    if (node.type === "productSelector") {
      capabilities.add("fallback.product")
      capabilities.add("outcome.normalized")
    }
    if (
      node.type === "purchaseButton" ||
      node.type === "restoreButton" ||
      node.type === "closeButton"
    ) {
      const actionCapability: MosaicPaywallCapabilityName = `action.${node.action.type}`
      capabilities.add(actionCapability)
      capabilities.add("outcome.normalized")
    }
  }
  return capabilities
}

export function synchronizeProtocolMetadata(document: MosaicDocument): MosaicDocument {
  const next = cloneValue(document)
  const entries = flattenDocument(next)
  const referencedAssets = new Set(
    entries.flatMap((entry) => (entry.node.type === "image" ? [entry.node.assetId] : [])),
  )
  next.assets = next.assets.filter((asset) => referencedAssets.has(asset.id))

  const hasProductSelector = entries.some((entry) => entry.node.type === "productSelector")
  if (!hasProductSelector) next.products = []

  const localized: LocalizedText[] = []
  collectLocalizedText(next.assets, localized)
  collectLocalizedText(next.products, localized)
  collectLocalizedText(next.layout, localized)
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
    version: "0.1",
  }))
  return next
}

export function referencedLocalizationKeys(document: MosaicDocument) {
  const localized: LocalizedText[] = []
  collectLocalizedText(document.assets, localized)
  collectLocalizedText(document.products, localized)
  collectLocalizedText(document.layout, localized)
  return new Map(localized.map((entry) => [entry.localizationKey, entry.default]))
}
