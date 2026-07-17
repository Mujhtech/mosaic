import type {
  LocalizedText,
  MosaicDocument,
  ProtocolNode,
} from "@/features/paywall-editor/types/editor"
import { findNode, updateNode } from "@/features/paywall-editor/utils/document-tree"

export type LocalizedProperty = "value" | "label"

function localizedTextFor(node: ProtocolNode, property: LocalizedProperty): LocalizedText | null {
  if (property === "value" && (node.type === "text" || node.type === "legalText")) {
    return node.value
  }
  if (
    property === "label" &&
    (node.type === "purchaseButton" || node.type === "restoreButton" || node.type === "closeButton")
  ) {
    return node.label
  }
  return null
}

export function updateLocalizedProperty(options: {
  document: MosaicDocument
  componentId: string
  property: LocalizedProperty
  locale: string
  value: string
}): MosaicDocument {
  const node = findNode(options.document, options.componentId)
  const target = node ? localizedTextFor(node, options.property) : null
  if (!target) return options.document

  const localization = {
    ...options.document.localization,
    locales: Object.fromEntries(
      Object.entries(options.document.localization.locales).map(([locale, catalog]) => [
        locale,
        locale === options.locale
          ? {
              ...catalog,
              strings: { ...catalog.strings, [target.localizationKey]: options.value },
            }
          : catalog,
      ]),
    ),
  }

  const document = updateNode(options.document, options.componentId, (node) => {
    const text = localizedTextFor(node, options.property)
    if (!text || options.locale !== options.document.localization.defaultLocale) return node
    if (options.property === "value" && (node.type === "text" || node.type === "legalText")) {
      return { ...node, value: { ...node.value, default: options.value } }
    }
    if (
      options.property === "label" &&
      (node.type === "purchaseButton" ||
        node.type === "restoreButton" ||
        node.type === "closeButton")
    ) {
      return { ...node, label: { ...node.label, default: options.value } }
    }
    return node
  })

  return { ...document, localization }
}

export function updateCatalogString(options: {
  document: MosaicDocument
  locale: string
  localizationKey: string
  value: string
}): MosaicDocument {
  const catalog = options.document.localization.locales[options.locale]
  if (!catalog) return options.document
  return {
    ...options.document,
    localization: {
      ...options.document.localization,
      locales: {
        ...options.document.localization.locales,
        [options.locale]: {
          ...catalog,
          strings: { ...catalog.strings, [options.localizationKey]: options.value },
        },
      },
    },
  }
}
