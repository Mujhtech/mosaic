import type {
  MosaicDocument,
  ProtocolNode,
  ValidationIssue,
} from "@/features/paywall-editor/types/editor"
import { flattenDocument } from "@/features/paywall-editor/utils/document-tree"

const IDENTIFIER = /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/

function issue(
  code: string,
  message: string,
  documentPath: string,
  recovery: string,
  componentId?: string,
  property?: string,
): ValidationIssue {
  return {
    code,
    message,
    severity: "error",
    componentId,
    property,
    documentPath,
    recovery,
  }
}

function localizedEntries(node: ProtocolNode) {
  switch (node.type) {
    case "text":
    case "legalText":
      return [{ property: "value", value: node.value }]
    case "featureList":
      return [
        { property: "accessibility", value: node.accessibility.label },
        ...node.items.map((item) => ({ property: `items.${item.id}`, value: item.text })),
      ]
    case "productSelector":
      return [
        { property: "accessibility", value: node.accessibility.label },
        { property: "unavailableFallback", value: node.unavailableFallback.message },
      ]
    case "purchaseButton":
    case "restoreButton":
      return [
        { property: "label", value: node.label },
        { property: "inProgressLabel", value: node.inProgressLabel },
        { property: "accessibility", value: node.accessibility.label },
      ]
    case "closeButton":
      return [
        { property: "label", value: node.label },
        { property: "accessibility", value: node.accessibility.label },
      ]
    case "image":
      return node.accessibility.hidden
        ? []
        : [{ property: "accessibility", value: node.accessibility.label }]
    case "verticalStack":
      return []
  }
}

export function validateEditorDocument(document: MosaicDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (document.schemaVersion !== "0.1") {
    issues.push(
      issue(
        "schema.unsupportedVersion",
        `Schema ${String(document.schemaVersion)} is not supported by this Studio.`,
        "/schemaVersion",
        "Import a Protocol 0.1 document.",
        undefined,
        "schemaVersion",
      ),
    )
  }
  if (!IDENTIFIER.test(document.id)) {
    issues.push(
      issue(
        "document.invalidId",
        "The document ID must start with a lowercase letter and use letters, numbers, dashes, or underscores.",
        "/id",
        "Rename the document using a Protocol 0.1 identifier.",
        undefined,
        "id",
      ),
    )
  }
  if (!document.localization.locales[document.localization.defaultLocale]) {
    issues.push(
      issue(
        "localization.missingDefault",
        `Default locale ${document.localization.defaultLocale} has no catalog.`,
        "/localization/defaultLocale",
        "Add the locale catalog or choose an existing default locale.",
        undefined,
        "defaultLocale",
      ),
    )
  }
  if (!document.localization.locales[document.localization.fallbackLocale]) {
    issues.push(
      issue(
        "localization.missingFallback",
        `Fallback locale ${document.localization.fallbackLocale} has no catalog.`,
        "/localization/fallbackLocale",
        "Add the locale catalog or choose an existing fallback locale.",
        undefined,
        "fallbackLocale",
      ),
    )
  }

  const entries = flattenDocument(document)
  const seenIds = new Set<string>()
  const productIds = new Set(document.products.map((product) => product.id))
  const selectorIds = new Set(
    entries.filter((entry) => entry.node.type === "productSelector").map((entry) => entry.node.id),
  )
  const assetIds = new Set(document.assets.map((asset) => asset.id))

  if (entries.length === 0) {
    issues.push(
      issue(
        "layout.empty",
        "The paywall must contain at least one component.",
        "/layout/content/children",
        "Insert a supported component.",
        document.layout.content.id,
        "children",
      ),
    )
  }

  entries.forEach(({ node, documentPath: path }) => {
    if (seenIds.has(node.id)) {
      issues.push(
        issue(
          "component.duplicateId",
          `Component ID ${node.id} is used more than once.`,
          `${path}/id`,
          "Remove the duplicate component and insert it again to assign a unique ID.",
          node.id,
          "id",
        ),
      )
    }
    seenIds.add(node.id)
    if (!IDENTIFIER.test(node.id)) {
      issues.push(
        issue(
          "component.invalidId",
          `Component ID ${node.id} is not a valid Protocol 0.1 identifier.`,
          `${path}/id`,
          "Use a lowercase identifier containing letters, numbers, dashes, or underscores.",
          node.id,
          "id",
        ),
      )
    }

    for (const localized of localizedEntries(node)) {
      if (!localized.value.default.trim()) {
        issues.push(
          issue(
            "localization.emptyValue",
            "Visible text cannot be empty.",
            `${path}/${localized.property}`,
            "Enter text in the property inspector.",
            node.id,
            localized.property,
          ),
        )
      }
      for (const [locale, catalog] of Object.entries(document.localization.locales)) {
        if (!catalog.strings[localized.value.localizationKey]?.trim()) {
          issues.push(
            issue(
              "localization.missingKey",
              `${locale} is missing ${localized.value.localizationKey}.`,
              `/localization/locales/${locale}/strings/${localized.value.localizationKey.replaceAll("~", "~0").replaceAll("/", "~1")}`,
              `Add a ${locale} value in Localization controls.`,
              node.id,
              localized.property,
            ),
          )
        }
      }
    }

    if (node.type === "productSelector") {
      for (const reference of node.productReferenceIds) {
        if (!productIds.has(reference)) {
          issues.push(
            issue(
              "product.missingReference",
              `Product reference ${reference} is not defined.`,
              `${path}/productReferenceIds`,
              "Bind the selector to a configured mock product.",
              node.id,
              "productReferenceIds",
            ),
          )
        }
      }
      if (!node.productReferenceIds.includes(node.initiallySelectedProductReferenceId)) {
        issues.push(
          issue(
            "product.invalidInitialSelection",
            "The initially selected product is not bound to this selector.",
            `${path}/initiallySelectedProductReferenceId`,
            "Choose one of the selector's bound products.",
            node.id,
            "initiallySelectedProductReferenceId",
          ),
        )
      }
    }
    if (node.type === "purchaseButton" && !selectorIds.has(node.action.productSelectorId)) {
      issues.push(
        issue(
          "purchase.missingSelector",
          `Purchase button references missing selector ${node.action.productSelectorId}.`,
          `${path}/action/productSelectorId`,
          "Insert a product selector or bind this button to an existing selector.",
          node.id,
          "productSelectorId",
        ),
      )
    }
    if (node.type === "image" && !assetIds.has(node.assetId)) {
      issues.push(
        issue(
          "asset.missingReference",
          `Image references missing asset ${node.assetId}.`,
          `${path}/assetId`,
          "Choose a bundled asset that exists in this document.",
          node.id,
          "assetId",
        ),
      )
    }
  })

  return issues
}

export function isMosaicDocument(value: unknown): value is MosaicDocument {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<MosaicDocument>
  return (
    candidate.schemaVersion === "0.1" &&
    typeof candidate.id === "string" &&
    Number.isInteger(candidate.revision) &&
    candidate.layout?.type === "scrollContainer" &&
    candidate.layout.content?.type === "verticalStack" &&
    Array.isArray(candidate.layout.content.children) &&
    !!candidate.localization?.locales &&
    Array.isArray(candidate.products) &&
    Array.isArray(candidate.assets)
  )
}
