import type {
  LocalizedText,
  MosaicDocument,
  ProtocolNode,
} from "@/features/paywall-editor/types/editor"
import { cloneValue } from "@/features/paywall-editor/utils/clone"
import { findNode } from "@/features/paywall-editor/utils/document-tree"

export type LocalizedProperty = "value" | "label"

function localizedTextFor(node: ProtocolNode, property: LocalizedProperty): LocalizedText | null {
  if (property === "value" && node.type === "text") {
    return node.value
  }
  if (property === "label" && node.type === "switch") {
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

  return updateLocalizedTextByKey({
    document: options.document,
    locale: options.locale,
    localizationKey: target.localizationKey,
    value: options.value,
  })
}

function replaceLocalizedDefault(value: unknown, localizationKey: string, nextValue: string) {
  if (!value || typeof value !== "object") return
  if (Array.isArray(value)) {
    value.forEach((entry) => replaceLocalizedDefault(entry, localizationKey, nextValue))
    return
  }
  const record = value as Record<string, unknown>
  if (record.localizationKey === localizationKey && typeof record.default === "string") {
    record.default = nextValue
  }
  Object.values(record).forEach((entry) =>
    replaceLocalizedDefault(entry, localizationKey, nextValue),
  )
}

function replaceAllLocalizedDefaults(value: unknown, strings: Readonly<Record<string, string>>) {
  if (!value || typeof value !== "object") return
  if (Array.isArray(value)) {
    value.forEach((entry) => replaceAllLocalizedDefaults(entry, strings))
    return
  }
  const record = value as Record<string, unknown>
  if (typeof record.localizationKey === "string" && typeof record.default === "string") {
    record.default = strings[record.localizationKey] ?? record.default
  }
  Object.values(record).forEach((entry) => replaceAllLocalizedDefaults(entry, strings))
}

export function changeDocumentDefaultLocale(document: MosaicDocument, locale: string) {
  const catalog = document.localization.locales[locale]
  if (!catalog || document.localization.defaultLocale === locale) return document
  const next = cloneValue(document)
  replaceAllLocalizedDefaults(next, catalog.strings)
  next.localization.defaultLocale = locale
  return next
}

export function updateLocalizedTextByKey(options: {
  document: MosaicDocument
  locale: string
  localizationKey: string
  value: string
}): MosaicDocument {
  const catalog = options.document.localization.locales[options.locale]
  if (!catalog) return options.document
  const document = cloneValue(options.document)
  if (options.locale === document.localization.defaultLocale) {
    replaceLocalizedDefault(document, options.localizationKey, options.value)
  }
  document.localization.locales[options.locale] = {
    ...catalog,
    strings: { ...catalog.strings, [options.localizationKey]: options.value },
  }
  return document
}

export function createSeededLocalizedText(options: {
  document: MosaicDocument
  keyBase: string
  defaultValue: string
}) {
  const keys = new Set(
    Object.values(options.document.localization.locales).flatMap((catalog) =>
      Object.keys(catalog.strings),
    ),
  )
  let localizationKey = options.keyBase
  let sequence = 1
  while (keys.has(localizationKey)) {
    sequence += 1
    localizationKey = `${options.keyBase}.${sequence}`
  }
  const text: LocalizedText = { default: options.defaultValue, localizationKey }
  return {
    document: {
      ...options.document,
      localization: {
        ...options.document.localization,
        locales: Object.fromEntries(
          Object.entries(options.document.localization.locales).map(([locale, catalog]) => [
            locale,
            {
              ...catalog,
              strings: { ...catalog.strings, [localizationKey]: options.defaultValue },
            },
          ]),
        ),
      },
    },
    text,
  }
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
