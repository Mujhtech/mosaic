import type {
  LocalizedText,
  MosaicDocument,
  ProtocolBackground,
  ProtocolColor,
  ProtocolNode,
  ValidationIssue,
} from "@/features/paywall-editor/types/editor"
import {
  findAncestorNodes,
  flattenDocument,
  screenContainingNode,
} from "@/features/paywall-editor/utils/document-tree"
import { fillAxisIsBounded } from "@/features/paywall-editor/utils/sizing"
import {
  resolveBackgroundToken,
  resolveColorToken,
  resolveProductBadgeStyle,
  resolveProductCardStyle,
} from "@/lib/mosaic-protocol"

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

function warning(
  code: string,
  message: string,
  documentPath: string,
  recovery: string,
  componentId: string,
  property: string,
): ValidationIssue {
  return {
    code,
    message,
    severity: "warning",
    componentId,
    property,
    documentPath,
    recovery,
  }
}

interface Rgba {
  readonly red: number
  readonly green: number
  readonly blue: number
  readonly alpha: number
}

interface AppearanceOption {
  readonly background?: ProtocolBackground
  readonly opacity: number
}

interface BackgroundSample {
  readonly color: Rgba | null
  readonly contentOpacity: number
}

interface ContrastField {
  readonly property: string
  readonly color: ProtocolColor
  readonly threshold: number
  readonly opacity?: number
}

function literalColor(document: MosaicDocument, color: ProtocolColor): Rgba | null {
  const resolved = resolveColorToken(document, color)
  if (!resolved) return null
  if (resolved === "transparent") return { red: 0, green: 0, blue: 0, alpha: 0 }
  if (!resolved.startsWith("#")) return null
  return {
    red: Number.parseInt(resolved.slice(1, 3), 16) / 255,
    green: Number.parseInt(resolved.slice(3, 5), 16) / 255,
    blue: Number.parseInt(resolved.slice(5, 7), 16) / 255,
    alpha: Number.parseInt(resolved.slice(7, 9), 16) / 255,
  }
}

function literalBackground(document: MosaicDocument, background: ProtocolBackground): Rgba | null {
  const resolved = resolveBackgroundToken(document, background)
  return resolved?.type === "color" ? literalColor(document, resolved.value) : null
}

function composite(foreground: Rgba, background: Rgba): Rgba {
  const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha)
  if (alpha <= 0) return { red: 0, green: 0, blue: 0, alpha: 0 }
  return {
    red:
      (foreground.red * foreground.alpha +
        background.red * background.alpha * (1 - foreground.alpha)) /
      alpha,
    green:
      (foreground.green * foreground.alpha +
        background.green * background.alpha * (1 - foreground.alpha)) /
      alpha,
    blue:
      (foreground.blue * foreground.alpha +
        background.blue * background.alpha * (1 - foreground.alpha)) /
      alpha,
    alpha,
  }
}

function luminanceChannel(value: number) {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function relativeLuminance(color: Rgba) {
  return (
    luminanceChannel(color.red) * 0.2126 +
    luminanceChannel(color.green) * 0.7152 +
    luminanceChannel(color.blue) * 0.0722
  )
}

function contrastRatio(first: Rgba, second: Rgba) {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second))
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second))
  return (lighter + 0.05) / (darker + 0.05)
}

function appearanceOptions(node: ProtocolNode): AppearanceOption[] {
  if (node.type === "productCard") {
    return [resolveProductCardStyle(node, false), resolveProductCardStyle(node, true)].map(
      (style) => ({ background: style.background, opacity: style.opacity }),
    )
  }
  if (node.type === "productBadge") {
    return [resolveProductBadgeStyle(node, false), resolveProductBadgeStyle(node, true)].map(
      (style) => ({ background: style.background, opacity: style.opacity }),
    )
  }
  const appearance = "appearance" in node ? node.appearance : undefined
  return [{ background: appearance?.background, opacity: appearance?.opacity ?? 1 }]
}

function applyAppearance(
  document: MosaicDocument,
  sample: BackgroundSample,
  appearance: AppearanceOption,
): BackgroundSample {
  const contentOpacity = sample.contentOpacity * appearance.opacity
  if (!appearance.background) return { ...sample, contentOpacity }
  const literal = literalBackground(document, appearance.background)
  if (!literal) return { color: null, contentOpacity }
  const layer = { ...literal, alpha: literal.alpha * appearance.opacity }
  if (sample.color) return { color: composite(layer, sample.color), contentOpacity }
  return {
    color: layer.alpha === 1 ? { ...layer, alpha: 1 } : null,
    contentOpacity,
  }
}

function backgroundSamples(
  document: MosaicDocument,
  node: ProtocolNode,
  includeSelf = true,
): BackgroundSample[] {
  const screen = screenContainingNode(document, node.id)
  const root = screen?.layout.background
    ? literalBackground(document, screen.layout.background)
    : null
  let samples: BackgroundSample[] = [
    {
      color: root?.alpha === 1 ? root : null,
      contentOpacity: 1,
    },
  ]
  const layers = [...findAncestorNodes(document, node.id), ...(includeSelf ? [node] : [])]
  for (const layer of layers) {
    samples = samples.flatMap((sample) =>
      appearanceOptions(layer).map((appearance) => applyAppearance(document, sample, appearance)),
    )
  }
  return samples.filter(
    (sample, index, all) =>
      all.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(sample)) === index,
  )
}

function foregroundFields(node: ProtocolNode): ContrastField[] {
  switch (node.type) {
    case "text":
    case "countdown":
      return [
        {
          property: "typography.color",
          color: node.typography.color,
          threshold:
            node.typography.fontSize >= 24 ||
            (node.typography.fontSize >= 18.66 &&
              (node.typography.weight === "semibold" || node.typography.weight === "bold"))
              ? 3
              : 4.5,
        },
      ]
    case "featureList":
      return [
        { property: "typography.color", color: node.typography.color, threshold: 4.5 },
        { property: "markerColor", color: node.markerColor, threshold: 3 },
      ]
    case "icon":
      return [{ property: "color", color: node.color, threshold: 3 }]
    case "switch":
      return [{ property: "typography.color", color: node.typography.color, threshold: 4.5 }]
    default:
      return []
  }
}

function boundaryFields(node: ProtocolNode): ContrastField[] {
  if (node.type === "productCard") {
    return [
      { property: "styles.default.border.color", style: resolveProductCardStyle(node, false) },
      { property: "styles.selected.border.color", style: resolveProductCardStyle(node, true) },
    ]
      .filter(({ style }) => style.border.width > 0)
      .map(({ property, style }) => ({
        property,
        color: style.border.color,
        opacity: style.opacity,
        threshold: 3,
      }))
  }
  if (node.type === "productBadge") {
    return [
      { property: "styles.default.border.color", style: resolveProductBadgeStyle(node, false) },
      { property: "styles.selected.border.color", style: resolveProductBadgeStyle(node, true) },
    ]
      .filter(({ style }) => style.border.width > 0)
      .map(({ property, style }) => ({
        property,
        color: style.border.color,
        opacity: style.opacity,
        threshold: 3,
      }))
  }
  if (node.type === "switch") {
    return [
      { property: "offTrackColor", color: node.offTrackColor, threshold: 3 },
      { property: "onTrackColor", color: node.onTrackColor, threshold: 3 },
    ]
  }
  const appearance = "appearance" in node ? node.appearance : undefined
  if (!appearance || !("border" in appearance) || !appearance.border?.width) return []
  return [
    {
      property: "appearance.border.color",
      color: appearance.border.color,
      opacity: appearance.opacity ?? 1,
      threshold: 3,
    },
  ]
}

function evaluateContrast(
  document: MosaicDocument,
  field: ContrastField,
  samples: readonly BackgroundSample[],
): "low" | "cannotVerify" | "sufficient" {
  const foreground = literalColor(document, field.color)
  if (!foreground) return "cannotVerify"
  let cannotVerify = false
  for (const sample of samples) {
    if (!sample.color) {
      cannotVerify = true
      continue
    }
    const alpha = foreground.alpha * sample.contentOpacity * (field.opacity ?? 1)
    const composedForeground = composite({ ...foreground, alpha }, sample.color)
    if (contrastRatio(composedForeground, sample.color) < field.threshold) return "low"
  }
  return cannotVerify ? "cannotVerify" : "sufficient"
}

function localizedValues(document: MosaicDocument, value: LocalizedText) {
  return [
    value.default,
    ...Object.values(document.localization.locales).map(
      (catalog) => catalog.strings[value.localizationKey] ?? value.default,
    ),
  ]
}

function expandedRuntimeText(value: string) {
  return value
    .replaceAll(/\{\{\s*product\.name\s*\}\}/g, "A very long subscription product name")
    .replaceAll(/\{\{\s*product\.price\s*\}\}/g, "$1,234.56 per month")
}

function estimatedTextWidthAtScale(
  document: MosaicDocument,
  node: Extract<ProtocolNode, { type: "text" }>,
  scale: number,
) {
  return (
    Math.max(
      ...localizedValues(document, node.value).map((value) => expandedRuntimeText(value).length),
    ) *
    node.typography.fontSize *
    0.55 *
    scale
  )
}

function fixedWidth(node: ProtocolNode): number | null {
  const width = "sizing" in node ? node.sizing?.width : null
  return width && typeof width === "object" && width.mode === "fixed" ? width.value : null
}

function horizontalChildren(node: ProtocolNode): readonly ProtocolNode[] | null {
  if (
    (node.type === "stack" ||
      node.type === "button" ||
      node.type === "productCard" ||
      node.type === "productBadge") &&
    node.direction === "horizontal"
  ) {
    return node.children
  }
  if (node.type === "productSelector" && node.direction === "horizontal") return node.cards
  return null
}

function childMinimumWidthAtScale(document: MosaicDocument, node: ProtocolNode, scale: number) {
  const fixed = fixedWidth(node)
  if (fixed !== null) return fixed
  if (node.type === "text") return estimatedTextWidthAtScale(document, node, scale)
  if (node.type === "icon") return node.size
  if (node.type === "countdown") return node.typography.fontSize * 18 * 0.55 * scale
  return 0
}

function horizontalMinimumWidth(
  document: MosaicDocument,
  node: ProtocolNode,
  children: readonly ProtocolNode[],
  scale: number,
) {
  const childWidths = children.reduce(
    (total, child) => total + childMinimumWidthAtScale(document, child, scale),
    0,
  )
  const gaps = "gap" in node ? node.gap * Math.max(0, children.length - 1) : 0
  const padding =
    node.type === "stack"
      ? node.padding.start + node.padding.end
      : "appearance" in node &&
          node.appearance &&
          "padding" in node.appearance &&
          node.appearance.padding
        ? node.appearance.padding.start + node.appearance.padding.end
        : 0
  return childWidths + gaps + padding
}

function localizedEntries(node: ProtocolNode): Array<{ property: string; value: LocalizedText }> {
  switch (node.type) {
    case "text":
      return [{ property: "value", value: node.value }]
    case "countdown":
      return [{ property: "completedText", value: node.completedText }]
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
    case "productCard":
      return node.accessibility
        ? [{ property: "accessibility", value: node.accessibility.label }]
        : []
    case "productBadge":
      return []
    case "button":
      return [{ property: "accessibility", value: node.accessibility.label }]
    case "switch":
      return [
        { property: "label", value: node.label },
        { property: "accessibility", value: node.accessibility.label },
      ]
    case "image":
    case "icon":
      return node.accessibility.hidden
        ? []
        : [{ property: "accessibility", value: node.accessibility.label }]
    case "carousel":
      return [
        { property: "accessibility", value: node.accessibility.label },
        ...node.pages.map((page) => ({
          property: `pages.${page.id}.accessibilityLabel`,
          value: page.accessibilityLabel,
        })),
      ]
    case "stack":
      return []
  }
}

export function validateEditorDocument(document: MosaicDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (document.schemaVersion !== "0.2") {
    issues.push(
      issue(
        "schema.unsupportedVersion",
        `Schema ${String(document.schemaVersion)} is not supported by this Studio.`,
        "/schemaVersion",
        "Import a Protocol 0.2 document.",
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
        "Rename the document using a Protocol 0.2 identifier.",
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
  let emittedCannotVerifyContrast = false

  document.screens.forEach((screen, index) => {
    if (screen.layout.content.children.length === 0) {
      issues.push(
        issue(
          "layout.empty",
          "Every paywall screen must contain at least one component.",
          `/screens/${index}/layout/content/children`,
          "Insert a supported component.",
          screen.layout.content.id,
          "children",
        ),
      )
    }
  })

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
          `Component ID ${node.id} is not a valid Protocol 0.2 identifier.`,
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

    if (
      node.type === "productCard" &&
      JSON.stringify(resolveProductCardStyle(node, false)) ===
        JSON.stringify(resolveProductCardStyle(node, true))
    ) {
      issues.push(
        warning(
          "appearance.indistinguishableProductStates",
          "Default and Selected Product Card appearance are visually identical.",
          `${path}/styles/selected`,
          "Change at least one Selected fill, stroke, radius, padding, or opacity value.",
          node.id,
          "styles.selected",
        ),
      )
    }

    for (const field of foregroundFields(node)) {
      const contrast = evaluateContrast(document, field, backgroundSamples(document, node))
      if (contrast === "low") {
        issues.push(
          warning(
            "appearance.lowContrast",
            `Text or icon contrast is below ${field.threshold}:1 after literal colour alpha and composed opacity.`,
            `${path}/${field.property.replaceAll(".", "/")}`,
            "Choose literal foreground and background colours with sufficient contrast in every authored state.",
            node.id,
            field.property,
          ),
        )
      } else if (contrast === "cannotVerify" && !emittedCannotVerifyContrast) {
        emittedCannotVerifyContrast = true
        issues.push(
          warning(
            "appearance.contrastCannotVerify",
            "Contrast cannot be verified because semantic colours are mapped by the host app theme.",
            `${path}/${field.property.replaceAll(".", "/")}`,
            "Verify this semantic colour pair in every host theme, or use literal colours for a Studio contrast result.",
            node.id,
            field.property,
          ),
        )
      }
    }

    for (const field of boundaryFields(node)) {
      const contrast = evaluateContrast(document, field, backgroundSamples(document, node, false))
      if (contrast === "low") {
        issues.push(
          warning(
            "appearance.lowBoundaryContrast",
            "Control-boundary contrast is below 3:1 after literal colour alpha and composed opacity.",
            `${path}/${field.property.replaceAll(".", "/")}`,
            "Choose a border or track colour that contrasts with the adjacent background.",
            node.id,
            field.property,
          ),
        )
      } else if (contrast === "cannotVerify" && !emittedCannotVerifyContrast) {
        emittedCannotVerifyContrast = true
        issues.push(
          warning(
            "appearance.contrastCannotVerify",
            "Control-boundary contrast cannot be verified because semantic colours are mapped by the host app theme.",
            `${path}/${field.property.replaceAll(".", "/")}`,
            "Verify this semantic colour pair in every host theme, or use literal colours for a Studio contrast result.",
            node.id,
            field.property,
          ),
        )
      }
    }

    if (
      node.type === "text" &&
      node.typography.maxLines &&
      (localizedValues(document, node.value).some((value) =>
        /\{\{\s*product\.(?:name|price)\s*\}\}/.test(value),
      ) ||
        (fixedWidth(node) !== null &&
          estimatedTextWidthAtScale(document, node, 2) >
            fixedWidth(node)! * node.typography.maxLines))
    ) {
      issues.push(
        warning(
          "typography.truncationRisk",
          "This text may truncate with long localization, live product data, or 200% text scaling.",
          `${path}/typography/maxLines`,
          "Preview long locales and product values, then increase Maximum lines or remove the limit.",
          node.id,
          "typography.maxLines",
        ),
      )
    }

    const children = horizontalChildren(node)
    const width = fixedWidth(node)
    if (children && width !== null && horizontalMinimumWidth(document, node, children, 2) > width) {
      issues.push(
        warning(
          "layout.horizontalOverflow",
          "Child content, spacing, and padding overflow this horizontal container at 200% text scaling.",
          `${path}/sizing/width`,
          "Increase the container width, reduce fixed child widths or spacing, or use vertical flow.",
          node.id,
          "sizing.width",
        ),
      )
    }

    if ("sizing" in node && node.sizing) {
      for (const axis of ["width", "height"] as const) {
        if (node.sizing[axis] !== "fill" || fillAxisIsBounded(document, node, axis)) continue
        const dimension = axis === "width" ? "Width" : "Height"
        const parentDirection = axis === "width" ? "vertically" : "horizontally"
        issues.push(
          warning(
            "layout.unboundedFill",
            `${dimension} Fill has no bounded ${axis === "width" ? "horizontal" : "vertical"} parent here, so preview and native renderers recover to Fit.`,
            `${path}/sizing/${axis}`,
            `Choose Fit or Fixed ${axis}, or move this layer into a ${parentDirection} flowing bounded container.`,
            node.id,
            `sizing.${axis}`,
          ),
        )
      }
    }

    if (node.type === "productSelector") {
      const cardIds = new Set(node.cards.map((card) => card.id))
      const productBindings = new Set<string>()
      for (const card of node.cards) {
        if (!productIds.has(card.productReferenceId)) {
          issues.push(
            issue(
              "product.missingReference",
              `Product reference ${card.productReferenceId} is not defined.`,
              `${path}/cards/${node.cards.indexOf(card)}/productReferenceId`,
              "Bind the product card to a configured product.",
              card.id,
              "productReferenceId",
            ),
          )
        }
        if (productBindings.has(card.productReferenceId)) {
          issues.push(
            issue(
              "product.duplicateBinding",
              `Product ${card.productReferenceId} is already bound in this selector.`,
              `${path}/cards/${node.cards.indexOf(card)}/productReferenceId`,
              "Choose a different product for this card.",
              card.id,
              "productReferenceId",
            ),
          )
        }
        productBindings.add(card.productReferenceId)
      }
      if (!cardIds.has(node.initialProductCardId)) {
        issues.push(
          issue(
            "product.invalidInitialSelection",
            "The default Product Card is not inside this selector.",
            `${path}/initialProductCardId`,
            "Choose one of this selector's Product Cards as the default.",
            node.id,
            "initialProductCardId",
          ),
        )
      }
    }
    if (
      node.type === "button" &&
      node.action.type === "purchase" &&
      !selectorIds.has(node.action.productSelectorId)
    ) {
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
    candidate.schemaVersion === "0.2" &&
    typeof candidate.id === "string" &&
    Number.isInteger(candidate.revision) &&
    typeof candidate.initialScreenId === "string" &&
    Array.isArray(candidate.screens) &&
    candidate.screens.length > 0 &&
    candidate.screens.every(
      (screen) =>
        screen.layout?.type === "scrollContainer" &&
        screen.layout.content?.type === "stack" &&
        Array.isArray(screen.layout.content.children),
    ) &&
    !!candidate.localization?.locales &&
    Array.isArray(candidate.products) &&
    Array.isArray(candidate.assets)
  )
}
