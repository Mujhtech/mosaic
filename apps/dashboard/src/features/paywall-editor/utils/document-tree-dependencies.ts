import type {
  ControlAccessibility,
  LocalizedText,
  MosaicDocument,
  ProtocolNode,
} from "@/features/paywall-editor/types/editor"
import { flattenDocument, isPassiveProductNode } from "./document-tree-traversal"

export function subtreeNodes(node: ProtocolNode): ProtocolNode[] {
  if (node.type === "stack" || node.type === "productCard" || node.type === "productBadge") {
    return [node, ...node.children.flatMap(subtreeNodes)]
  }
  if (node.type === "button") {
    return [
      node,
      ...node.children.flatMap(subtreeNodes),
      ...(node.inProgressChildren ?? []).flatMap(subtreeNodes),
    ]
  }
  if (node.type === "carousel") {
    return [node, ...node.pages.flatMap((page) => subtreeNodes(page.content))]
  }
  if (node.type === "productSelector") {
    return [node, ...node.cards.flatMap(subtreeNodes)]
  }
  return [node]
}

export function productCardBoundsAreValid(document: MosaicDocument) {
  return flattenDocument(document)
    .map((entry) => entry.node)
    .filter(
      (node): node is Extract<ProtocolNode, { type: "productCard" }> => node.type === "productCard",
    )
    .every((card) => {
      let descendantCount = 0
      let maximumStackDepth = 0
      function visit(node: ProtocolNode, stackDepth: number) {
        descendantCount += 1
        const nextDepth = node.type === "stack" ? stackDepth + 1 : stackDepth
        maximumStackDepth = Math.max(maximumStackDepth, nextDepth)
        if (node.type === "stack" || node.type === "productBadge") {
          node.children.forEach((child) => visit(child, nextDepth))
        }
      }
      card.children.forEach((child) => visit(child, 0))
      return descendantCount <= 20 && maximumStackDepth <= 4
    })
}

export function subtreeIdentifiers(node: ProtocolNode): string[] {
  const identifiers = subtreeNodes(node).flatMap((candidate) =>
    candidate.type === "featureList"
      ? [candidate.id, ...candidate.items.map((item) => item.id)]
      : candidate.type === "carousel"
        ? [candidate.id, ...candidate.pages.map((page) => page.id)]
        : [candidate.id],
  )
  return identifiers
}

export function subtreeIsStructurallyValid(node: ProtocolNode): boolean {
  if (node.type === "stack") return node.children.every(subtreeIsStructurallyValid)
  if (node.type === "button") {
    return (
      node.children.length > 0 &&
      node.children.every(isPassiveProductNode) &&
      node.inProgressChildren?.every(isPassiveProductNode) !== false &&
      (node.action.type === "purchase" || node.action.type === "restore"
        ? true
        : node.inProgressChildren === undefined)
    )
  }
  if (node.type === "productSelector") {
    return (
      node.cards.length >= 1 &&
      node.cards.length <= 20 &&
      node.cards.every(subtreeIsStructurallyValid)
    )
  }
  if (node.type === "productCard") {
    const badges = node.children.filter((child) => child.type === "productBadge")
    return (
      node.children.length > 0 &&
      badges.length <= 1 &&
      node.children.every((child) =>
        child.type === "productBadge"
          ? subtreeIsStructurallyValid(child)
          : isPassiveProductNode(child),
      )
    )
  }
  if (node.type === "productBadge") {
    return (
      node.children.length >= 1 &&
      node.children.length <= 10 &&
      node.children.every(isPassiveProductNode)
    )
  }
  if (node.type === "carousel") {
    return (
      node.pages.length >= 2 &&
      node.pages.length <= 20 &&
      node.pages.every((page) => subtreeIsStructurallyValid(page.content))
    )
  }
  return true
}

export function identifierSet(document: MosaicDocument) {
  const identifiers = new Set<string>([
    document.id,
    ...document.screens.flatMap((screen) => [
      screen.id,
      screen.layout.id,
      screen.layout.content.id,
    ]),
    ...document.assets.map((asset) => asset.id),
    ...document.products.map((product) => product.id),
  ])
  for (const entry of flattenDocument(document)) {
    identifiers.add(entry.node.id)
    if (entry.node.type === "featureList") {
      entry.node.items.forEach((item) => identifiers.add(item.id))
    } else if (entry.node.type === "carousel") {
      entry.node.pages.forEach((page) => identifiers.add(page.id))
    }
  }
  return identifiers
}

export function allocateIdentifier(identifiers: Set<string>, base: string, alwaysSequence = false) {
  let sequence = 1
  let candidate = alwaysSequence ? `${base}-${sequence}` : base
  while (identifiers.has(candidate)) {
    sequence += 1
    candidate = `${base}-${sequence}`
  }
  identifiers.add(candidate)
  return candidate
}

export function localizationKeySet(document: MosaicDocument) {
  return new Set(
    Object.values(document.localization.locales).flatMap((catalog) => Object.keys(catalog.strings)),
  )
}

export function allocateLocalizationKey(keys: Set<string>, base: string) {
  let sequence = 1
  let candidate = base
  while (keys.has(candidate)) {
    sequence += 1
    candidate = `${base}.${sequence}`
  }
  keys.add(candidate)
  return candidate
}

export function createUniqueProductReference(
  document: MosaicDocument,
  identifiers: Set<string>,
  keys: Set<string>,
) {
  const providerProductIds = new Set(document.products.map((product) => product.productId))
  let ordinal = document.products.length + 1
  while (
    identifiers.has(`product-${ordinal}`) ||
    providerProductIds.has(`mosaic_product_${ordinal}`)
  ) {
    ordinal += 1
  }
  const id = allocateIdentifier(identifiers, `product-${ordinal}`)
  return {
    id,
    productId: `mosaic_product_${ordinal}`,
    label: localized(
      `Product ${ordinal}`,
      allocateLocalizationKey(keys, `paywall.products.product_${ordinal}`),
    ),
  }
}

export function localized(defaultValue: string, key: string): LocalizedText {
  return { default: defaultValue, localizationKey: key }
}

export function controlLocalizedEntries(accessibility: ControlAccessibility): LocalizedText[] {
  return accessibility.hint ? [accessibility.label, accessibility.hint] : [accessibility.label]
}

export function textAccessibilityEntries(
  node: Extract<ProtocolNode, { type: "text" | "countdown" }>,
) {
  return node.accessibility.label ? [node.accessibility.label] : []
}

export function nodeLocalizedEntries(node: ProtocolNode): LocalizedText[] {
  switch (node.type) {
    case "stack":
      return node.children.flatMap(nodeLocalizedEntries)
    case "productCard":
      return [
        ...(node.accessibility ? [node.accessibility.label] : []),
        ...node.children.flatMap(nodeLocalizedEntries),
      ]
    case "productBadge":
      return node.children.flatMap(nodeLocalizedEntries)
    case "carousel":
      return [
        ...controlLocalizedEntries(node.accessibility),
        ...node.pages.flatMap((page) => [
          page.accessibilityLabel,
          ...nodeLocalizedEntries(page.content),
        ]),
      ]
    case "text":
      return [node.value, ...textAccessibilityEntries(node)]
    case "button":
      return [
        ...controlLocalizedEntries(node.accessibility),
        ...node.children.flatMap(nodeLocalizedEntries),
        ...(node.inProgressChildren ?? []).flatMap(nodeLocalizedEntries),
      ]
    case "featureList":
      return [
        ...controlLocalizedEntries(node.accessibility),
        ...node.items.map((item) => item.text),
      ]
    case "productSelector":
      return [
        ...controlLocalizedEntries(node.accessibility),
        node.unavailableFallback.message,
        ...node.cards.flatMap(nodeLocalizedEntries),
      ]
    case "switch":
      return [node.label, ...controlLocalizedEntries(node.accessibility)]
    case "countdown":
      return [node.completedText, ...textAccessibilityEntries(node)]
    case "image":
      return node.accessibility.hidden ? [] : [node.accessibility.label]
    case "icon":
      return node.accessibility.hidden ? [] : [node.accessibility.label]
  }
}

export function referencedLocalizedEntries(document: MosaicDocument): LocalizedText[] {
  return [
    ...document.assets.flatMap((asset) => (asset.type === "image" ? [asset.fallback.value] : [])),
    ...document.products.map((product) => product.label),
    ...document.screens.flatMap((screen) => [
      ...(screen.accessibilityLabel ? [screen.accessibilityLabel] : []),
      ...nodeLocalizedEntries(screen.layout.content),
    ]),
  ]
}

export function ensureLocalizationCatalogs(document: MosaicDocument): MosaicDocument {
  const entries = referencedLocalizedEntries(document)
  return {
    ...document,
    localization: {
      ...document.localization,
      locales: Object.fromEntries(
        Object.entries(document.localization.locales).map(([locale, catalog]) => [
          locale,
          {
            ...catalog,
            strings: Object.fromEntries([
              ...Object.entries(catalog.strings),
              ...entries
                .filter((entry) => catalog.strings[entry.localizationKey] === undefined)
                .map((entry) => [entry.localizationKey, entry.default]),
            ]),
          },
        ]),
      ),
    },
  }
}

export function ensureNodeDependencies(
  document: MosaicDocument,
  node: ProtocolNode,
): MosaicDocument {
  const nodes = subtreeNodes(node)
  const assets = [...document.assets]
  const products = [...document.products]
  const localizationKeys = localizationKeySet(document)

  for (const candidate of nodes) {
    if (candidate.type === "image" && !assets.some((asset) => asset.id === candidate.assetId)) {
      const fallbackKey = allocateLocalizationKey(
        localizationKeys,
        `paywall.${candidate.assetId.replaceAll("-", "_")}.placeholder`,
      )
      assets.push({
        type: "image",
        id: candidate.assetId,
        source: { type: "bundled", key: `mosaic.paywall.${candidate.assetId}` },
        fallback: {
          type: "placeholder",
          value: localized("Preview image unavailable", fallbackKey),
        },
      })
    }

    if (
      candidate.type === "productSelector" &&
      products.length === 0 &&
      candidate.cards.every(
        (card) =>
          card.productReferenceId === "monthly-plan" || card.productReferenceId === "yearly-plan",
      )
    ) {
      products.push(
        {
          id: "monthly-plan",
          productId: "mosaic_pro_monthly",
          label: { default: "Monthly", localizationKey: "paywall.products.monthly" },
        },
        {
          id: "yearly-plan",
          productId: "mosaic_pro_yearly",
          label: { default: "Yearly", localizationKey: "paywall.products.yearly" },
        },
      )
    }
  }

  return ensureLocalizationCatalogs({ ...document, assets, products })
}
