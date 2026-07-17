import type {
  InsertableBlockType,
  MosaicDocument,
  ProtocolNode,
  VerticalStackComponent,
} from "@/features/paywall-editor/types/editor"
import { cloneValue } from "@/features/paywall-editor/utils/clone"

export interface NodeEntry {
  node: ProtocolNode
  depth: number
  parentId: string | null
  index: number
  documentPath: string
}

export interface ParentEntry {
  parent: VerticalStackComponent
  index: number
}

export function flattenDocument(document: MosaicDocument): NodeEntry[] {
  const entries: NodeEntry[] = []

  function visit(container: VerticalStackComponent, depth: number, containerPath: string) {
    container.children.forEach((node, index) => {
      const documentPath = `${containerPath}/children/${index}`
      entries.push({ node, depth, parentId: container.id, index, documentPath })
      if (node.type === "verticalStack") visit(node, depth + 1, documentPath)
    })
  }

  visit(document.layout.content, 0, "/layout/content")
  return entries
}

export function findNode(document: MosaicDocument, id: string | null): ProtocolNode | null {
  if (!id) return null
  return flattenDocument(document).find((entry) => entry.node.id === id)?.node ?? null
}

export function findParent(document: MosaicDocument, id: string | null): ParentEntry | null {
  if (!id) return null
  function visit(container: VerticalStackComponent): ParentEntry | null {
    const index = container.children.findIndex((node) => node.id === id)
    if (index >= 0) return { parent: container, index }
    for (const node of container.children) {
      if (node.type === "verticalStack") {
        const result = visit(node)
        if (result) return result
      }
    }
    return null
  }
  return visit(document.layout.content)
}

function mapContainer(
  container: VerticalStackComponent,
  mapper: (node: ProtocolNode) => ProtocolNode,
): VerticalStackComponent {
  return {
    ...container,
    children: container.children.map((node) => {
      const nested = node.type === "verticalStack" ? mapContainer(node, mapper) : node
      return mapper(nested)
    }),
  }
}

export function updateNode(
  document: MosaicDocument,
  id: string,
  updater: (node: ProtocolNode) => ProtocolNode,
): MosaicDocument {
  return {
    ...document,
    layout: {
      ...document.layout,
      content: mapContainer(document.layout.content, (node) =>
        node.id === id ? updater(node) : node,
      ),
    },
  }
}

function removeFromContainer(
  container: VerticalStackComponent,
  id: string,
): VerticalStackComponent {
  return {
    ...container,
    children: container.children
      .filter((node) => node.id !== id)
      .map((node) => (node.type === "verticalStack" ? removeFromContainer(node, id) : node)),
  }
}

export function removeNode(document: MosaicDocument, id: string): MosaicDocument {
  return {
    ...document,
    layout: {
      ...document.layout,
      content: removeFromContainer(document.layout.content, id),
    },
  }
}

function reorderInContainer(
  container: VerticalStackComponent,
  id: string,
  direction: -1 | 1,
): VerticalStackComponent {
  const index = container.children.findIndex((node) => node.id === id)
  if (index >= 0) {
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= container.children.length) return container
    const children = [...container.children]
    const current = children[index]
    const target = children[targetIndex]
    if (!current || !target) return container
    children[index] = target
    children[targetIndex] = current
    return { ...container, children }
  }

  return {
    ...container,
    children: container.children.map((node) =>
      node.type === "verticalStack" ? reorderInContainer(node, id, direction) : node,
    ),
  }
}

export function reorderNode(
  document: MosaicDocument,
  id: string,
  direction: -1 | 1,
): MosaicDocument {
  return {
    ...document,
    layout: {
      ...document.layout,
      content: reorderInContainer(document.layout.content, id, direction),
    },
  }
}

function nextIdentifier(document: MosaicDocument, prefix: string) {
  const ids = new Set(flattenDocument(document).map((entry) => entry.node.id))
  let sequence = 1
  while (ids.has(`${prefix}-${sequence}`)) sequence += 1
  return `${prefix}-${sequence}`
}

function localized(defaultValue: string, key: string) {
  return { default: defaultValue, localizationKey: key }
}

export function createBlock(document: MosaicDocument, type: InsertableBlockType): ProtocolNode {
  const id = nextIdentifier(
    document,
    type.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`),
  )
  const key = `paywall.${id.replaceAll("-", "_")}`
  const selector = flattenDocument(document).find((entry) => entry.node.type === "productSelector")
    ?.node.id
  const productReferenceIds =
    document.products.length > 0
      ? document.products.map((product) => product.id)
      : ["monthly-plan", "yearly-plan"]
  const firstProduct = productReferenceIds[0] ?? "monthly-plan"

  switch (type) {
    case "text":
      return {
        type,
        id,
        value: localized("New text", key),
        style: "body",
        alignment: "center",
        accessibility: { role: "text" },
      }
    case "image": {
      const assetId = document.assets[0]?.id ?? "hero-image"
      return {
        type,
        id,
        assetId,
        width: "fill",
        aspectRatio: 1.777_777_777_8,
        contentMode: "fill",
        accessibility: { hidden: true },
      }
    }
    case "featureList":
      return {
        type,
        id,
        marker: "checkmark",
        itemSpacing: 12,
        items: [{ id: `${id}-item`, text: localized("New benefit", `${key}.item`) }],
        accessibility: { label: localized("Benefits", `${key}.label`) },
      }
    case "productSelector":
      return {
        type,
        id,
        productReferenceIds,
        initiallySelectedProductReferenceId: firstProduct,
        itemSpacing: 12,
        unavailableFallback: {
          selection: "firstAvailable",
          whenNoneAvailable: "showMessageAndDisablePurchase",
          message: localized("Plans are temporarily unavailable.", `${key}.unavailable`),
        },
        accessibility: { label: localized("Choose a plan", `${key}.label`) },
      }
    case "purchaseButton":
      return {
        type,
        id,
        label: localized("Continue", key),
        inProgressLabel: localized("Processing purchase…", `${key}.progress`),
        action: { type: "purchase", productSelectorId: selector ?? "plans" },
        accessibility: { label: localized("Continue with selected plan", `${key}.accessibility`) },
      }
    case "restoreButton":
      return {
        type,
        id,
        label: localized("Restore purchases", key),
        inProgressLabel: localized("Restoring purchases…", `${key}.progress`),
        action: { type: "restore" },
        accessibility: { label: localized("Restore previous purchases", `${key}.accessibility`) },
      }
    case "closeButton":
      return {
        type,
        id,
        label: localized("Close", key),
        action: { type: "close" },
        accessibility: { label: localized("Close paywall", `${key}.accessibility`) },
      }
    case "legalText":
      return {
        type,
        id,
        value: localized("Terms and privacy policy apply.", key),
        alignment: "center",
        accessibility: { role: "text" },
      }
  }
}

function collectLocalizedKeys(node: ProtocolNode): { key: string; value: string }[] {
  switch (node.type) {
    case "text":
    case "legalText":
      return [{ key: node.value.localizationKey, value: node.value.default }]
    case "featureList":
      return [
        { key: node.accessibility.label.localizationKey, value: node.accessibility.label.default },
        ...node.items.map((item) => ({
          key: item.text.localizationKey,
          value: item.text.default,
        })),
      ]
    case "productSelector":
      return [
        { key: node.accessibility.label.localizationKey, value: node.accessibility.label.default },
        {
          key: node.unavailableFallback.message.localizationKey,
          value: node.unavailableFallback.message.default,
        },
      ]
    case "purchaseButton":
    case "restoreButton":
      return [
        { key: node.label.localizationKey, value: node.label.default },
        { key: node.inProgressLabel.localizationKey, value: node.inProgressLabel.default },
        { key: node.accessibility.label.localizationKey, value: node.accessibility.label.default },
      ]
    case "closeButton":
      return [
        { key: node.label.localizationKey, value: node.label.default },
        { key: node.accessibility.label.localizationKey, value: node.accessibility.label.default },
      ]
    case "verticalStack":
      return node.children.flatMap(collectLocalizedKeys)
    case "image":
      return node.accessibility.hidden
        ? []
        : [
            {
              key: node.accessibility.label.localizationKey,
              value: node.accessibility.label.default,
            },
          ]
  }
}

export function insertBlock(
  document: MosaicDocument,
  type: InsertableBlockType,
  afterId: string | null,
): { document: MosaicDocument; node: ProtocolNode } {
  const node = createBlock(document, type)
  const children = [...document.layout.content.children]
  const afterIndex = afterId ? children.findIndex((candidate) => candidate.id === afterId) : -1
  children.splice(afterIndex >= 0 ? afterIndex + 1 : children.length, 0, node)

  const localization = cloneValue(document.localization)
  const assets = [...document.assets]
  const products = [...document.products]
  if (node.type === "image" && !assets.some((asset) => asset.id === node.assetId)) {
    assets.push({
      type: "image",
      id: node.assetId,
      source: { type: "bundled", key: "mosaic.paywall.hero" },
      fallback: {
        type: "placeholder",
        value: {
          default: "Preview image unavailable",
          localizationKey: "paywall.hero.placeholder",
        },
      },
    })
  }
  if (node.type === "productSelector" && products.length === 0) {
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
        badge: { default: "Best value", localizationKey: "paywall.products.yearly.badge" },
      },
    )
  }
  for (const catalog of Object.values(localization.locales)) {
    for (const entry of collectLocalizedKeys(node)) catalog.strings[entry.key] = entry.value
  }

  let nextDocument: MosaicDocument = {
    ...document,
    localization,
    assets,
    products,
    layout: {
      ...document.layout,
      content: { ...document.layout.content, children },
    },
  }

  if (node.type === "productSelector") {
    const selectorIds = new Set(
      flattenDocument(nextDocument)
        .filter((entry) => entry.node.type === "productSelector")
        .map((entry) => entry.node.id),
    )
    for (const entry of flattenDocument(nextDocument)) {
      if (
        entry.node.type === "purchaseButton" &&
        !selectorIds.has(entry.node.action.productSelectorId)
      ) {
        nextDocument = updateNode(nextDocument, entry.node.id, (current) =>
          current.type === "purchaseButton"
            ? { ...current, action: { ...current.action, productSelectorId: node.id } }
            : current,
        )
      }
    }
  }

  return {
    node,
    document: nextDocument,
  }
}

export function resolveLocalizedText(
  document: MosaicDocument,
  text: { default: string; localizationKey: string },
  locale: string,
): string {
  return (
    document.localization.locales[locale]?.strings[text.localizationKey] ??
    document.localization.locales[document.localization.fallbackLocale]?.strings[
      text.localizationKey
    ] ??
    text.default
  )
}
