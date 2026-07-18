import type {
  BlockInsertionConfiguration,
  ControlAccessibility,
  InsertableBlockType,
  LocalizedText,
  MosaicDocument,
  ProtocolNode,
  Screen,
  StackComponent,
  TreeInsertionLocation,
  TreeMoveTarget,
  TreeOperationKind,
  TreeOperationRejected,
  TreeOperationRejectionReason,
  TreeOperationResult,
} from "@/features/paywall-editor/types/editor"
import { cloneValue } from "@/features/paywall-editor/utils/clone"
import { isValidCountdownInstant } from "@/features/paywall-editor/utils/countdown"

export interface NodeEntry {
  readonly node: ProtocolNode
  readonly depth: number
  readonly parentId: string | null
  readonly index: number
  readonly collection: NodeCollection
  readonly documentPath: string
}

export interface ParentEntry {
  readonly parent: ContainerNode
  readonly index: number
  readonly collection: NodeCollection
}

export interface SiblingBoundaries {
  readonly entry: NodeEntry
  readonly parent: ContainerNode
  readonly previousSibling: ProtocolNode | null
  readonly nextSibling: ProtocolNode | null
  readonly canMovePrevious: boolean
  readonly canMoveNext: boolean
  readonly canIndentIntoPrevious: boolean
  readonly canOutdent: boolean
}

export interface AppendScreenResult {
  readonly document: MosaicDocument
  readonly screenId: string
  readonly selectionId: string
}

export interface AppendScreenOptions {
  readonly presentation?: "screen" | "sheet"
  readonly sourceScreenId?: string
}

export interface AppendProductLayerResult {
  readonly document: MosaicDocument
  readonly selectionId: string
}

interface RejectionContext {
  readonly nodeId?: string
  readonly targetId?: string
}

const ZERO_INSETS = Object.freeze({ top: 0, start: 0, bottom: 0, end: 0 })

type NodeCollection = "children" | "inProgressChildren" | "cards"
type ContainerNode = Extract<
  ProtocolNode,
  { type: "stack" | "button" | "productSelector" | "productCard" | "productBadge" }
>

function isContainerNode(node: ProtocolNode): node is ContainerNode {
  return (
    node.type === "stack" ||
    node.type === "button" ||
    node.type === "productSelector" ||
    node.type === "productCard" ||
    node.type === "productBadge"
  )
}

function containerCollections(
  container: ContainerNode,
): readonly (readonly [NodeCollection, readonly ProtocolNode[]])[] {
  if (container.type === "productSelector") return [["cards", container.cards]]
  if (container.type === "button" && container.inProgressChildren) {
    return [
      ["children", container.children],
      ["inProgressChildren", container.inProgressChildren],
    ]
  }
  return [["children", container.children]]
}

function defaultCollection(container: ContainerNode): NodeCollection {
  return container.type === "productSelector" ? "cards" : "children"
}

function collectionChildren(container: ContainerNode, collection: NodeCollection) {
  return containerCollections(container).find(([name]) => name === collection)?.[1] ?? null
}

function isPassiveProductNode(child: ProtocolNode): boolean {
  return (
    !["button", "productSelector", "productCard", "productBadge", "switch", "carousel"].includes(
      child.type,
    ) &&
    (child.type !== "stack" || child.children.every(isPassiveProductNode))
  )
}

function containerCanAccept(
  parent: ContainerNode,
  collection: NodeCollection,
  node: ProtocolNode,
): boolean {
  if (parent.type === "productSelector") {
    return collection === "cards" && node.type === "productCard" && parent.cards.length < 20
  }
  if (collection === "cards" || (collection === "inProgressChildren" && parent.type !== "button")) {
    return false
  }
  if (parent.type === "button") return isPassiveProductNode(node)
  if (parent.type === "productBadge")
    return parent.children.length < 10 && isPassiveProductNode(node)
  if (parent.type === "productCard") {
    return node.type === "productBadge"
      ? !parent.children.some((child) => child.type === "productBadge")
      : isPassiveProductNode(node)
  }
  return node.type !== "productCard" && node.type !== "productBadge"
}

const REJECTION_COPY: Record<
  TreeOperationRejectionReason,
  { readonly message: string; readonly recovery: string }
> = {
  "document-unavailable": {
    message: "No paywall document is open.",
    recovery: "Open a template or import a Mosaic paywall, then try again.",
  },
  "transaction-active": {
    message: "A text or property edit is still in progress.",
    recovery: "Commit or cancel the active edit before changing the component tree.",
  },
  "selection-unavailable": {
    message: "No component is selected.",
    recovery: "Select a component in Layers or on the canvas, then try again.",
  },
  "unknown-node": {
    message: "The component no longer exists in this paywall.",
    recovery: "Refresh the current Layers selection and retry the operation.",
  },
  "unknown-target": {
    message: "The requested move target no longer exists.",
    recovery: "Choose a visible component or Stack as the move target.",
  },
  "unknown-parent": {
    message: "The requested insertion parent does not exist.",
    recovery: "Choose the root content Stack or another visible Stack.",
  },
  "non-stack-parent": {
    message: "Only a Stack can contain child components.",
    recovery: "Insert inside a Stack, or place the component before or after a leaf.",
  },
  "invalid-index": {
    message: "The requested child position is outside the target Stack.",
    recovery: "Choose an index from zero through the Stack's current child count.",
  },
  "configuration-required": {
    message: "Countdown needs an explicit valid UTC deadline.",
    recovery: "Enter the deadline in Add content before inserting or dragging Countdown.",
  },
  "invalid-node": {
    message: "The component subtree is not a valid Protocol 0.2 tree.",
    recovery: "Use supported components and keep every Carousel between two and twenty pages.",
  },
  "duplicate-id": {
    message: "The component subtree contains an ID already used by the paywall.",
    recovery: "Duplicate through Studio or assign fresh component IDs before insertion.",
  },
  "root-immutable": {
    message: "The root content Stack and Carousel page roots cannot be moved or deleted.",
    recovery: "Move or delete a child component instead.",
  },
  "self-target": {
    message: "A component cannot be moved relative to or inside itself.",
    recovery: "Choose a different component or Stack as the target.",
  },
  "descendant-cycle": {
    message: "A container cannot be moved into one of its own descendants.",
    recovery: "Choose a Stack outside the moving component's subtree.",
  },
  "empty-source-stack": {
    message: "The operation would leave the root content Stack empty.",
    recovery: "Keep at least one component in the root content Stack.",
  },
  "no-op": {
    message: "The component is already at the requested location.",
    recovery: "Choose a different insertion position.",
  },
  "sibling-boundary": {
    message: "The selected component is already at that sibling boundary.",
    recovery: "Move it in the opposite direction or choose an explicit target.",
  },
  "indent-target-unavailable": {
    message: "The previous sibling is not a Stack that can contain this component.",
    recovery: "Place a Stack immediately before the component, then indent again.",
  },
  "outdent-boundary": {
    message: "The selected component is already in the root content Stack.",
    recovery: "Use sibling movement or move it inside another Stack instead.",
  },
}

export function rejectTreeOperation(
  operation: TreeOperationKind,
  reason: TreeOperationRejectionReason,
  context: RejectionContext = {},
): TreeOperationRejected {
  return {
    status: "rejected",
    operation,
    reason,
    ...REJECTION_COPY[reason],
    ...context,
  }
}

export function initialScreen(document: MosaicDocument): Screen {
  return (
    document.screens.find((screen) => screen.id === document.initialScreenId) ??
    document.screens[0]!
  )
}

export function initialLayout(document: MosaicDocument) {
  return initialScreen(document).layout
}

function visitContainerEntries(
  container: ContainerNode,
  depth: number,
  containerPath: string,
  entries: NodeEntry[],
) {
  function visitCollection(children: readonly ProtocolNode[], collection: NodeCollection) {
    children.forEach((node, index) => {
      const documentPath = `${containerPath}/${collection}/${index}`
      entries.push({
        node,
        depth,
        parentId: container.id,
        index,
        collection,
        documentPath,
      })
      if (isContainerNode(node)) {
        visitContainerEntries(node, depth + 1, documentPath, entries)
      } else if (node.type === "carousel") {
        node.pages.forEach((page, pageIndex) => {
          const pagePath = `${documentPath}/pages/${pageIndex}/content`
          entries.push({
            node: page.content,
            depth: depth + 1,
            parentId: null,
            index: pageIndex,
            collection: "children",
            documentPath: pagePath,
          })
          visitContainerEntries(page.content, depth + 2, pagePath, entries)
        })
      }
    })
  }

  containerCollections(container).forEach(([collection, children]) =>
    visitCollection(children, collection),
  )
}

export function flattenDocument(document: MosaicDocument): NodeEntry[] {
  const entries: NodeEntry[] = []
  document.screens.forEach((screen, screenIndex) => {
    visitContainerEntries(
      screen.layout.content,
      0,
      `/screens/${screenIndex}/layout/content`,
      entries,
    )
  })
  return entries
}

export function findNode(document: MosaicDocument, id: string | null): ProtocolNode | null {
  if (!id) return null
  const root = document.screens.find((screen) => screen.layout.content.id === id)?.layout.content
  if (root) return root
  return flattenDocument(document).find((entry) => entry.node.id === id)?.node ?? null
}

export function findNodeEntry(document: MosaicDocument, id: string | null): NodeEntry | null {
  if (!id) return null
  const screenIndex = document.screens.findIndex((screen) => screen.layout.content.id === id)
  if (screenIndex >= 0) {
    const root = document.screens[screenIndex]!.layout.content
    return {
      node: root,
      depth: -1,
      parentId: null,
      index: 0,
      collection: "children",
      documentPath: `/screens/${screenIndex}/layout/content`,
    }
  }
  return flattenDocument(document).find((entry) => entry.node.id === id) ?? null
}

export function screenContainingNode(document: MosaicDocument, id: string | null): Screen | null {
  if (!id) return null
  const direct = document.screens.find(
    (screen) => screen.id === id || screen.layout.id === id || screen.layout.content.id === id,
  )
  if (direct) return direct
  const entry = findNodeEntry(document, id)
  const screenIndex = entry?.documentPath.match(/^\/screens\/(\d+)/)?.[1]
  return screenIndex === undefined ? null : (document.screens[Number(screenIndex)] ?? null)
}

function visitForParent(container: ContainerNode, id: string): ParentEntry | null {
  const collections = containerCollections(container)
  for (const [collection, children] of collections) {
    const index = children.findIndex((node) => node.id === id)
    if (index >= 0) return { parent: container, index, collection }
    for (const node of children) {
      if (isContainerNode(node)) {
        const result = visitForParent(node, id)
        if (result) return result
      } else if (node.type === "carousel") {
        for (const page of node.pages) {
          const result = visitForParent(page.content, id)
          if (result) return result
        }
      }
    }
  }
  return null
}

export function findParent(document: MosaicDocument, id: string | null): ParentEntry | null {
  if (!id || document.screens.some((screen) => id === screen.layout.content.id)) return null
  for (const screen of document.screens) {
    const parent = visitForParent(screen.layout.content, id)
    if (parent) return parent
  }
  return null
}

export function findStack(document: MosaicDocument, id: string | null): StackComponent | null {
  const node = findNode(document, id)
  return node?.type === "stack" ? node : null
}

function findContainer(document: MosaicDocument, id: string | null): ContainerNode | null {
  const node = findNode(document, id)
  return node && isContainerNode(node) ? node : null
}

export function findAncestorNodes(document: MosaicDocument, id: string | null): ProtocolNode[] {
  if (!id || document.screens.some((screen) => id === screen.layout.content.id)) return []

  function visit(container: ContainerNode, ancestors: ProtocolNode[]): ProtocolNode[] | null {
    const children = containerCollections(container).flatMap(([, collection]) => collection)
    for (const node of children) {
      if (node.id === id) return [...ancestors, container]
      if (isContainerNode(node)) {
        const result = visit(node, [...ancestors, container])
        if (result) return result
      } else if (node.type === "carousel") {
        for (const page of node.pages) {
          if (page.content.id === id) return [...ancestors, container, node]
          const result = visit(page.content, [...ancestors, container, node])
          if (result) return result
        }
      }
    }
    return null
  }

  for (const screen of document.screens) {
    const result = visit(screen.layout.content, [])
    if (result) return result
  }
  return []
}

export function findAncestorStacks(document: MosaicDocument, id: string | null): StackComponent[] {
  return findAncestorNodes(document, id).filter(
    (node): node is StackComponent => node.type === "stack",
  )
}

export function findAncestorNodeIds(document: MosaicDocument, id: string | null): string[] {
  return findAncestorNodes(document, id).map((node) => node.id)
}

export function findAncestorStackIds(document: MosaicDocument, id: string | null): string[] {
  return findAncestorStacks(document, id).map((stack) => stack.id)
}

function isRootStack(document: MosaicDocument, stackId: string) {
  return document.screens.some((screen) => stackId === screen.layout.content.id)
}

export function parentEntryChildren(entry: ParentEntry): readonly ProtocolNode[] {
  return (
    containerCollections(entry.parent).find(
      ([collection]) => collection === entry.collection,
    )?.[1] ?? []
  )
}

export function getSiblingBoundaries(
  document: MosaicDocument,
  id: string | null,
): SiblingBoundaries | null {
  const entry = findNodeEntry(document, id)
  const parent = findParent(document, id)
  if (!entry || !parent) return null
  const siblings = parentEntryChildren(parent)
  const previousSibling = siblings[parent.index - 1] ?? null
  const nextSibling = siblings[parent.index + 1] ?? null
  const sourceCanLoseChild =
    parent.collection === "inProgressChildren" ||
    !isRootStack(document, parent.parent.id) ||
    siblings.length > 1
  const grandparent = findParent(document, parent.parent.id)
  return {
    entry,
    parent: parent.parent,
    previousSibling,
    nextSibling,
    canMovePrevious: previousSibling !== null,
    canMoveNext: nextSibling !== null,
    canIndentIntoPrevious:
      sourceCanLoseChild &&
      entry.node.type !== "productCard" &&
      entry.node.type !== "productBadge" &&
      (previousSibling?.type === "stack" ||
        previousSibling?.type === "productCard" ||
        previousSibling?.type === "productBadge"),
    canOutdent:
      sourceCanLoseChild &&
      Boolean(
        grandparent && containerCanAccept(grandparent.parent, grandparent.collection, entry.node),
      ),
  }
}

export function reconcileExpandedTreeNodes(
  document: MosaicDocument,
  expandedIds: ReadonlySet<string>,
): ReadonlySet<string> {
  const validContainerIds = new Set([
    ...document.screens.map((screen) => screen.layout.content.id),
    ...flattenDocument(document).flatMap((entry) =>
      isContainerNode(entry.node) || entry.node.type === "carousel" ? [entry.node.id] : [],
    ),
  ])
  return new Set(
    [...document.screens.map((screen) => screen.layout.content.id), ...expandedIds].filter((id) =>
      validContainerIds.has(id),
    ),
  )
}

export function revealNodeAncestors(
  document: MosaicDocument,
  id: string | null,
  expandedIds: ReadonlySet<string>,
): ReadonlySet<string> {
  const expanded = new Set(reconcileExpandedTreeNodes(document, expandedIds))
  document.screens.forEach((screen) => expanded.add(screen.layout.content.id))
  for (const ancestorId of findAncestorNodeIds(document, id)) expanded.add(ancestorId)
  return expanded
}

function mapNode(
  node: ProtocolNode,
  id: string,
  updater: (node: ProtocolNode) => ProtocolNode,
): ProtocolNode {
  let nested: ProtocolNode = node
  if (node.type === "stack") {
    nested = {
      ...node,
      children: node.children.map((child) => mapNode(child, id, updater)) as typeof node.children,
    }
  } else if (node.type === "productCard") {
    nested = {
      ...node,
      children: node.children.map((child) => mapNode(child, id, updater)) as typeof node.children,
    }
  } else if (node.type === "productBadge") {
    nested = {
      ...node,
      children: node.children.map((child) => mapNode(child, id, updater)) as typeof node.children,
    }
  } else if (node.type === "button") {
    nested = {
      ...node,
      children: node.children.map((child) => mapNode(child, id, updater)) as typeof node.children,
      ...(node.inProgressChildren
        ? {
            inProgressChildren: node.inProgressChildren.map((child) =>
              mapNode(child, id, updater),
            ) as typeof node.inProgressChildren,
          }
        : {}),
    }
  } else if (node.type === "carousel") {
    nested = {
      ...node,
      pages: node.pages.map((page) => {
        const content: ProtocolNode = mapNode(page.content, id, updater)
        return { ...page, content: content.type === "stack" ? content : page.content }
      }),
    }
  } else if (node.type === "productSelector") {
    nested = {
      ...node,
      cards: node.cards.map((card) => {
        const mapped = mapNode(card, id, updater)
        return mapped.type === "productCard" ? mapped : card
      }),
    }
  }
  return nested.id === id ? updater(nested) : nested
}

export function updateNode(
  document: MosaicDocument,
  id: string,
  updater: (node: ProtocolNode) => ProtocolNode,
): MosaicDocument {
  let changed = false
  const screens = document.screens.map((screen) => {
    const content = mapNode(screen.layout.content, id, updater)
    if (content.type !== "stack" || content === screen.layout.content) return screen
    changed = true
    return { ...screen, layout: { ...screen.layout, content } }
  })
  return changed ? { ...document, screens } : document
}

function replaceContainerChildren(
  document: MosaicDocument,
  parentId: string,
  children: readonly ProtocolNode[],
  collection: NodeCollection = "children",
) {
  return updateNode(document, parentId, (node) => {
    if (collection === "inProgressChildren") {
      if (node.type !== "button") return node
      const next = { ...node }
      if (children.length === 0) delete next.inProgressChildren
      else next.inProgressChildren = [...children] as typeof next.inProgressChildren
      return next
    }
    if (collection === "cards") {
      return node.type === "productSelector" &&
        children.every((child) => child.type === "productCard")
        ? { ...node, cards: [...children] as typeof node.cards }
        : node
    }
    if (node.type === "stack") return { ...node, children: [...children] as typeof node.children }
    if (node.type === "button") return { ...node, children: [...children] as typeof node.children }
    if (node.type === "productCard")
      return { ...node, children: [...children] as typeof node.children }
    if (node.type === "productBadge")
      return { ...node, children: [...children] as typeof node.children }
    return node
  })
}

function subtreeNodes(node: ProtocolNode): ProtocolNode[] {
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

function productCardBoundsAreValid(document: MosaicDocument) {
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

function subtreeIdentifiers(node: ProtocolNode): string[] {
  const identifiers = subtreeNodes(node).flatMap((candidate) =>
    candidate.type === "featureList"
      ? [candidate.id, ...candidate.items.map((item) => item.id)]
      : candidate.type === "carousel"
        ? [candidate.id, ...candidate.pages.map((page) => page.id)]
        : [candidate.id],
  )
  return identifiers
}

function subtreeIsStructurallyValid(node: ProtocolNode): boolean {
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

function identifierSet(document: MosaicDocument) {
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

function allocateIdentifier(identifiers: Set<string>, base: string, alwaysSequence = false) {
  let sequence = 1
  let candidate = alwaysSequence ? `${base}-${sequence}` : base
  while (identifiers.has(candidate)) {
    sequence += 1
    candidate = `${base}-${sequence}`
  }
  identifiers.add(candidate)
  return candidate
}

function localizationKeySet(document: MosaicDocument) {
  return new Set(
    Object.values(document.localization.locales).flatMap((catalog) => Object.keys(catalog.strings)),
  )
}

function allocateLocalizationKey(keys: Set<string>, base: string) {
  let sequence = 1
  let candidate = base
  while (keys.has(candidate)) {
    sequence += 1
    candidate = `${base}.${sequence}`
  }
  keys.add(candidate)
  return candidate
}

function createUniqueProductReference(
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

function localized(defaultValue: string, key: string): LocalizedText {
  return { default: defaultValue, localizationKey: key }
}

function controlLocalizedEntries(accessibility: ControlAccessibility): LocalizedText[] {
  return accessibility.hint ? [accessibility.label, accessibility.hint] : [accessibility.label]
}

function textAccessibilityEntries(node: Extract<ProtocolNode, { type: "text" | "countdown" }>) {
  return node.accessibility.label ? [node.accessibility.label] : []
}

function nodeLocalizedEntries(node: ProtocolNode): LocalizedText[] {
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

function referencedLocalizedEntries(document: MosaicDocument): LocalizedText[] {
  return [
    ...document.assets.flatMap((asset) => (asset.type === "image" ? [asset.fallback.value] : [])),
    ...document.products.map((product) => product.label),
    ...document.screens.flatMap((screen) => [
      ...(screen.accessibilityLabel ? [screen.accessibilityLabel] : []),
      ...nodeLocalizedEntries(screen.layout.content),
    ]),
  ]
}

function ensureLocalizationCatalogs(document: MosaicDocument): MosaicDocument {
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

function ensureNodeDependencies(document: MosaicDocument, node: ProtocolNode): MosaicDocument {
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

function typography(
  style: "display" | "title" | "heading" | "body" | "label" | "caption",
  alignment: "start" | "center" | "end" = "start",
) {
  const presets = {
    display: { fontSize: 40, lineHeightMultiplier: 1.1, weight: "bold" as const },
    title: { fontSize: 32, lineHeightMultiplier: 1.2, weight: "bold" as const },
    heading: { fontSize: 24, lineHeightMultiplier: 1.25, weight: "semibold" as const },
    body: { fontSize: 16, lineHeightMultiplier: 1.5, weight: "regular" as const },
    label: { fontSize: 16, lineHeightMultiplier: 1.25, weight: "semibold" as const },
    caption: { fontSize: 13, lineHeightMultiplier: 1.4, weight: "regular" as const },
  }
  return {
    style,
    ...presets[style],
    color: style === "caption" ? ("text.secondary" as const) : ("text.primary" as const),
    alignment,
  }
}

function productCardStyles() {
  return {
    default: {
      background: { type: "color" as const, value: "surface.default" as const },
      border: { color: "border.default" as const, width: 1 },
      cornerRadius: 12,
      padding: { top: 14, start: 16, bottom: 14, end: 16 },
      opacity: 1,
    },
    selected: {
      background: { type: "color" as const, value: "surface.elevated" as const },
      border: { color: "action.primary" as const, width: 2 },
    },
  }
}

function createProductCard(
  identifiers: Set<string>,
  keys: Set<string>,
  selectorId: string,
  productReferenceId: string,
): Extract<ProtocolNode, { type: "productCard" }> {
  const id = allocateIdentifier(identifiers, `${selectorId}-${productReferenceId}-card`)
  const nameId = allocateIdentifier(identifiers, `${id}-name`)
  const priceId = allocateIdentifier(identifiers, `${id}-price`)
  const key = `paywall.${id.replaceAll("-", "_")}`
  return {
    type: "productCard",
    id,
    productReferenceId,
    direction: "vertical",
    gap: 4,
    mainAxisDistribution: "start",
    crossAxisAlignment: "stretch",
    children: [
      {
        type: "text",
        id: nameId,
        value: localized("{{ product.name }}", allocateLocalizationKey(keys, `${key}.name`)),
        typography: typography("caption", "start"),
        accessibility: { role: "text" },
      },
      {
        type: "text",
        id: priceId,
        value: localized("{{ product.price }}", allocateLocalizationKey(keys, `${key}.price`)),
        typography: { ...typography("label", "start"), color: "text.primary" },
        accessibility: { role: "text" },
      },
    ],
    styles: productCardStyles(),
    accessibility: {
      label: localized(
        "{{ product.name }}, {{ product.price }}",
        allocateLocalizationKey(keys, `${key}.accessibility`),
      ),
    },
  }
}

function productBadgeStyles() {
  return {
    default: {
      background: { type: "color" as const, value: "surface.elevated" as const },
      border: { color: "border.default" as const, width: 0 },
      cornerRadius: 999,
      padding: { top: 3, start: 8, bottom: 3, end: 8 },
      opacity: 1,
    },
    selected: {},
  }
}

export function appendProductCard(
  document: MosaicDocument,
  selectorId: string,
): AppendProductLayerResult | null {
  const selector = findNode(document, selectorId)
  if (selector?.type !== "productSelector" || selector.cards.length >= 20) return null
  const identifiers = identifierSet(document)
  const keys = localizationKeySet(document)
  const usedReferences = new Set(selector.cards.map((card) => card.productReferenceId))
  let products = [...document.products]
  let reference = products.find((product) => !usedReferences.has(product.id))

  if (!reference) {
    reference = createUniqueProductReference(document, identifiers, keys)
    products = [...products, reference]
  }

  const card = createProductCard(identifiers, keys, selector.id, reference.id)
  const next = updateNode({ ...document, products }, selector.id, (node) =>
    node.type === "productSelector" ? { ...node, cards: [...node.cards, card] } : node,
  )
  return { document: ensureLocalizationCatalogs(next), selectionId: card.id }
}

export function appendProductBadge(
  document: MosaicDocument,
  cardId: string,
): AppendProductLayerResult | null {
  const card = findNode(document, cardId)
  if (
    card?.type !== "productCard" ||
    card.children.some((child) => child.type === "productBadge")
  ) {
    return null
  }
  const identifiers = identifierSet(document)
  const keys = localizationKeySet(document)
  const id = allocateIdentifier(identifiers, `${card.id}-badge`)
  const textId = allocateIdentifier(identifiers, `${id}-text`)
  const badge: Extract<ProtocolNode, { type: "productBadge" }> = {
    type: "productBadge",
    id,
    placement: { mode: "nested" },
    direction: "horizontal",
    gap: 4,
    mainAxisDistribution: "center",
    crossAxisAlignment: "center",
    children: [
      {
        type: "text",
        id: textId,
        value: localized(
          "Best value",
          allocateLocalizationKey(keys, `paywall.${id.replaceAll("-", "_")}.text`),
        ),
        typography: typography("caption", "center"),
        accessibility: { role: "text" },
      },
    ],
    styles: productBadgeStyles(),
  }
  const next = ensureLocalizationCatalogs(
    updateNode(document, card.id, (node) =>
      node.type === "productCard" ? { ...node, children: [...node.children, badge] } : node,
    ),
  )
  if (!productCardBoundsAreValid(next)) return null
  return { document: next, selectionId: badge.id }
}

function emptyStack(id: string): StackComponent {
  return {
    type: "stack",
    id,
    direction: "vertical",
    gap: 12,
    padding: { ...ZERO_INSETS },
    mainAxisDistribution: "start",
    crossAxisAlignment: "stretch",
    children: [],
  }
}

export function createBlock(
  document: MosaicDocument,
  type: InsertableBlockType,
  configuration: BlockInsertionConfiguration = {},
): ProtocolNode {
  const identifiers = identifierSet(document)
  const keys = localizationKeySet(document)
  const prefix = type.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)
  const id = allocateIdentifier(identifiers, prefix, true)
  const key = allocateLocalizationKey(keys, `paywall.${id.replaceAll("-", "_")}`)
  const productReferenceIds =
    document.products.length > 0
      ? document.products.map((product) => product.id)
      : ["monthly-plan", "yearly-plan"]
  const firstProduct = productReferenceIds[0] ?? "monthly-plan"

  switch (type) {
    case "stack":
      return emptyStack(id)
    case "text":
      return {
        type,
        id,
        value: localized("New text", key),
        typography: typography("body", "center"),
        sizing: { width: "fill", height: "fit" },
        accessibility: { role: "text" },
      }
    case "image":
      return {
        type,
        id,
        assetId: document.assets[0]?.id ?? "hero-image",
        sizing: { width: "fill", height: "fit" },
        aspectRatio: 1.777_777_777_8,
        contentMode: "fill",
        accessibility: { hidden: true },
      }
    case "icon":
      return {
        type,
        id,
        name: "checkmark",
        size: 20,
        color: "text.primary",
        accessibility: { hidden: true },
      }
    case "featureList":
      return {
        type,
        id,
        marker: "checkmark",
        gap: 12,
        markerColor: "action.primary",
        items: [
          {
            id: allocateIdentifier(identifiers, `${id}-item`),
            text: localized("New benefit", allocateLocalizationKey(keys, `${key}.item`)),
          },
        ],
        typography: typography("body", "start"),
        accessibility: {
          label: localized("Benefits", allocateLocalizationKey(keys, `${key}.label`)),
        },
      }
    case "productSelector": {
      const cards = productReferenceIds.map((referenceId) =>
        createProductCard(identifiers, keys, id, referenceId),
      )
      return {
        type,
        id,
        direction: "vertical",
        gap: 12,
        crossAxisAlignment: "stretch",
        initialProductCardId:
          cards.find((card) => card.productReferenceId === firstProduct)?.id ?? cards[0]!.id,
        cards,
        sizing: { width: "fill", height: "fit" },
        unavailableFallback: {
          selection: "firstAvailable",
          whenNoneAvailable: "showMessageAndDisablePurchase",
          message: localized(
            "Plans are temporarily unavailable.",
            allocateLocalizationKey(keys, `${key}.unavailable`),
          ),
        },
        accessibility: {
          label: localized("Choose a plan", allocateLocalizationKey(keys, `${key}.label`)),
        },
      }
    }
    case "button": {
      const labelId = allocateIdentifier(identifiers, `${id}-label`)
      return {
        type,
        id,
        direction: "horizontal",
        gap: 8,
        mainAxisDistribution: "center",
        crossAxisAlignment: "center",
        children: [
          {
            type: "text",
            id: labelId,
            value: localized("Button", key),
            typography: { ...typography("label", "center"), color: "action.onPrimary" },
            accessibility: { role: "text" },
          },
        ],
        appearance: {
          background: { type: "color", value: "action.primary" },
          cornerRadius: 12,
          padding: { top: 12, start: 16, bottom: 12, end: 16 },
        },
        sizing: { width: "fill", height: "fit" },
        action: { type: "close" },
        accessibility: {
          label: localized("Button", allocateLocalizationKey(keys, `${key}.accessibility`)),
        },
      }
    }
    case "carousel": {
      const pages = [0, 1].map((index) => {
        const pageNumber = index + 1
        const pageId = allocateIdentifier(identifiers, `${id}-page-${pageNumber}`)
        return {
          id: pageId,
          accessibilityLabel: localized(
            `Page ${pageNumber}`,
            allocateLocalizationKey(keys, `${key}.page_${pageNumber}.label`),
          ),
          content: emptyStack(allocateIdentifier(identifiers, `${pageId}-content`)),
        }
      })
      return {
        type,
        id,
        initialPageIndex: 0,
        showsIndicators: true,
        pages,
        sizing: { width: "fill", height: "fit" },
        accessibility: {
          label: localized("Offer highlights", allocateLocalizationKey(keys, `${key}.label`)),
        },
      }
    }
    case "switch":
      return {
        type,
        id,
        label: localized("Include this option", key),
        initialValue: false,
        typography: typography("body", "start"),
        offTrackColor: "border.default",
        onTrackColor: "action.primary",
        thumbColor: "surface.default",
        accessibility: {
          label: localized(
            "Include this option",
            allocateLocalizationKey(keys, `${key}.accessibility`),
          ),
        },
      }
    case "countdown": {
      const endsAt = configuration.countdownEndsAt
      if (!isValidCountdownInstant(endsAt)) {
        throw new Error("Countdown creation requires an explicit valid UTC deadline.")
      }
      return {
        type,
        id,
        endsAt,
        largestUnit: "day",
        smallestUnit: "second",
        completedText: localized("Offer ended", allocateLocalizationKey(keys, `${key}.completed`)),
        typography: typography("heading", "center"),
        sizing: { width: "fill", height: "fit" },
        accessibility: { role: "text" },
      }
    }
  }
}

export function appendScreen(
  document: MosaicDocument,
  options: AppendScreenOptions = {},
): AppendScreenResult {
  const identifiers = identifierSet(document)
  const keys = localizationKeySet(document)
  const ordinal = document.screens.length + 1
  const presentation = options.presentation ?? "screen"
  const sourceScreen =
    document.screens.find((candidate) => candidate.id === options.sourceScreenId) ??
    document.screens.find((candidate) => candidate.id === document.initialScreenId) ??
    document.screens[0]!
  const screenId = allocateIdentifier(identifiers, `screen-${ordinal}`)
  const layoutId = allocateIdentifier(identifiers, `${screenId}-scroll`)
  const contentId = allocateIdentifier(identifiers, `${screenId}-content`)
  const titleId = allocateIdentifier(identifiers, `${screenId}-title`)
  const linkId = allocateIdentifier(identifiers, `${screenId}-link`)
  const linkLabelId = allocateIdentifier(identifiers, `${linkId}-label`)
  const backId = allocateIdentifier(identifiers, `${screenId}-back`)
  const backLabelId = allocateIdentifier(identifiers, `${backId}-label`)
  const label = `${presentation === "sheet" ? "Sheet" : "Screen"} ${ordinal}`
  const screenLabelKey = allocateLocalizationKey(
    keys,
    `paywall.${screenId.replaceAll("-", "_")}.accessibility`,
  )
  const titleKey = allocateLocalizationKey(keys, `paywall.${screenId.replaceAll("-", "_")}.title`)
  const linkKey = allocateLocalizationKey(keys, `paywall.${screenId.replaceAll("-", "_")}.link`)
  const backKey = allocateLocalizationKey(keys, `paywall.${screenId.replaceAll("-", "_")}.back`)
  const sourceLayout = sourceScreen.layout
  const sourceContent = sourceLayout.content
  const linkLabel = `Go to ${label}`
  const navigationButton: Extract<ProtocolNode, { type: "button" }> = {
    type: "button",
    id: linkId,
    direction: "horizontal",
    gap: 8,
    mainAxisDistribution: "center",
    crossAxisAlignment: "center",
    children: [
      {
        type: "text",
        id: linkLabelId,
        value: localized(linkLabel, linkKey),
        typography: { ...typography("label", "center"), color: "action.onPrimary" },
        accessibility: { role: "text" },
      },
    ],
    appearance: {
      background: { type: "color", value: "action.primary" },
      cornerRadius: 12,
      padding: { top: 12, start: 16, bottom: 12, end: 16 },
    },
    sizing: { width: "fill", height: "fit" },
    action: { type: "navigateTo", screenId },
    accessibility: { label: localized(linkLabel, linkKey) },
  }
  const existingScreens = document.screens.map((existingScreen, index) => {
    const accessibilityLabel =
      existingScreen.accessibilityLabel ??
      localized(
        `Screen ${index + 1}`,
        allocateLocalizationKey(
          keys,
          `paywall.${existingScreen.id.replaceAll("-", "_")}.accessibility`,
        ),
      )
    if (existingScreen.id === sourceScreen.id) {
      return {
        ...existingScreen,
        accessibilityLabel,
        layout: {
          ...existingScreen.layout,
          content: {
            ...existingScreen.layout.content,
            children: [...existingScreen.layout.content.children, navigationButton],
          },
        },
      }
    }
    if (existingScreen.accessibilityLabel) return existingScreen
    const existingLabel = `Screen ${index + 1}`
    return {
      ...existingScreen,
      accessibilityLabel: { ...accessibilityLabel, default: existingLabel },
    }
  })
  const screen = {
    id: screenId,
    presentation: { type: presentation },
    accessibilityLabel: localized(label, screenLabelKey),
    layout: {
      ...cloneValue(sourceLayout),
      id: layoutId,
      content: {
        ...emptyStack(contentId),
        gap: sourceContent.gap,
        padding: cloneValue(sourceContent.padding),
        mainAxisDistribution: sourceContent.mainAxisDistribution,
        crossAxisAlignment: sourceContent.crossAxisAlignment,
        children: [
          {
            type: "button",
            id: backId,
            direction: "horizontal",
            gap: 8,
            mainAxisDistribution: "start",
            crossAxisAlignment: "center",
            children: [
              {
                type: "text",
                id: backLabelId,
                value: localized("Back", backKey),
                typography: typography("label", "start"),
                accessibility: { role: "text" },
              },
            ],
            action: { type: "navigateBack" },
            accessibility: { label: localized("Back", backKey) },
          },
          {
            type: "text",
            id: titleId,
            value: localized(label, titleKey),
            typography: typography("title", "center"),
            sizing: { width: "fill", height: "fit" },
            accessibility: { role: "heading", level: 1 },
          },
        ],
      },
    },
  } as Screen
  const nextDocument = ensureLocalizationCatalogs({
    ...document,
    screens: [...existingScreens, screen],
  })
  return { document: nextDocument, screenId, selectionId: titleId }
}

function resolveInsertionParent(
  document: MosaicDocument,
  location: TreeInsertionLocation,
  operation: TreeOperationKind,
  nodeId?: string,
): ContainerNode | TreeOperationRejected {
  const parent = findNode(document, location.parentId)
  if (!parent) {
    return rejectTreeOperation(operation, "unknown-parent", { nodeId, targetId: location.parentId })
  }
  if (!isContainerNode(parent)) {
    return rejectTreeOperation(operation, "non-stack-parent", {
      nodeId,
      targetId: location.parentId,
    })
  }
  const collection = location.collection ?? defaultCollection(parent)
  const children = collectionChildren(parent, collection)
  if (!children) {
    return rejectTreeOperation(operation, "non-stack-parent", {
      nodeId,
      targetId: location.parentId,
    })
  }
  if (!Number.isInteger(location.index) || location.index < 0 || location.index > children.length) {
    return rejectTreeOperation(operation, "invalid-index", { nodeId, targetId: location.parentId })
  }
  return parent
}

export function insertExistingNodeAtLocation(
  document: MosaicDocument,
  node: ProtocolNode,
  location: TreeInsertionLocation,
): TreeOperationResult {
  const parent = resolveInsertionParent(document, location, "insert", node.id)
  if ("status" in parent) return parent
  const collection = location.collection ?? defaultCollection(parent)
  if (!containerCanAccept(parent, collection, node)) {
    return rejectTreeOperation("insert", "invalid-node", { nodeId: node.id })
  }
  if (!subtreeIsStructurallyValid(node)) {
    return rejectTreeOperation("insert", "invalid-node", { nodeId: node.id })
  }
  const incomingIds = subtreeIdentifiers(node)
  if (new Set(incomingIds).size !== incomingIds.length) {
    return rejectTreeOperation("insert", "duplicate-id", { nodeId: node.id })
  }
  const existingIds = identifierSet(document)
  if (incomingIds.some((id) => existingIds.has(id))) {
    return rejectTreeOperation("insert", "duplicate-id", { nodeId: node.id })
  }
  const children = [...(collectionChildren(parent, collection) ?? [])]
  const insertedNode = cloneValue(node)
  children.splice(location.index, 0, insertedNode)
  const nextDocument = ensureNodeDependencies(
    replaceContainerChildren(document, parent.id, children, collection),
    insertedNode,
  )
  if (!productCardBoundsAreValid(nextDocument)) {
    return rejectTreeOperation("insert", "invalid-node", { nodeId: node.id })
  }
  return {
    status: "accepted",
    operation: "insert",
    document: nextDocument,
    nodeId: insertedNode.id,
    parentId: parent.id,
    index: location.index,
    selectionId: insertedNode.id,
  }
}

export function insertBlockAtLocation(
  document: MosaicDocument,
  type: InsertableBlockType,
  location: TreeInsertionLocation,
  configuration: BlockInsertionConfiguration = {},
): TreeOperationResult {
  if (type === "countdown" && !isValidCountdownInstant(configuration.countdownEndsAt)) {
    return rejectTreeOperation("insert", "configuration-required")
  }
  return insertExistingNodeAtLocation(
    document,
    createBlock(document, type, configuration),
    location,
  )
}

export function resolveLegacyInsertionLocation(
  document: MosaicDocument,
  selectedId: string | null,
  incomingType?: InsertableBlockType,
): TreeInsertionLocation {
  const selected = findNode(document, selectedId)
  if (
    selected?.type === "stack" ||
    selected?.type === "productCard" ||
    selected?.type === "productBadge"
  ) {
    return { parentId: selected.id, index: selected.children.length }
  }
  if (selected?.type === "button") {
    const interactiveTypes = new Set<InsertableBlockType>([
      "button",
      "productSelector",
      "switch",
      "carousel",
    ])
    if (!incomingType || !interactiveTypes.has(incomingType)) {
      return { parentId: selected.id, index: selected.children.length }
    }
  }
  const parent = findParent(document, selectedId)
  if (parent) {
    return {
      parentId: parent.parent.id,
      index: parent.index + 1,
      ...(parent.collection === "children" ? {} : { collection: parent.collection }),
    }
  }
  const root = initialLayout(document).content
  return { parentId: root.id, index: root.children.length }
}

function resolveMoveLocation(
  document: MosaicDocument,
  nodeId: string,
  target: TreeMoveTarget,
): TreeInsertionLocation | TreeOperationRejected {
  if (target.targetId === nodeId) {
    return rejectTreeOperation("move", "self-target", { nodeId, targetId: target.targetId })
  }
  const targetNode = findNode(document, target.targetId)
  if (!targetNode) {
    return rejectTreeOperation("move", "unknown-target", { nodeId, targetId: target.targetId })
  }
  if (target.placement === "inside") {
    if (!isContainerNode(targetNode)) {
      return rejectTreeOperation("move", "non-stack-parent", {
        nodeId,
        targetId: target.targetId,
      })
    }
    const collection = defaultCollection(targetNode)
    const children = collectionChildren(targetNode, collection) ?? []
    const index = target.index ?? children.length
    if (!Number.isInteger(index) || index < 0 || index > children.length) {
      return rejectTreeOperation("move", "invalid-index", { nodeId, targetId: target.targetId })
    }
    return {
      parentId: targetNode.id,
      index,
      ...(collection === "children" ? {} : { collection }),
    }
  }
  const targetEntry = findNodeEntry(document, target.targetId)
  if (!targetEntry?.parentId) {
    return rejectTreeOperation("move", "root-immutable", {
      nodeId,
      targetId: target.targetId,
    })
  }
  return {
    parentId: targetEntry.parentId,
    index: targetEntry.index + (target.placement === "after" ? 1 : 0),
    ...(targetEntry.collection === "children" ? {} : { collection: targetEntry.collection }),
  }
}

export function moveNode(
  document: MosaicDocument,
  nodeId: string,
  target: TreeMoveTarget,
): TreeOperationResult {
  const sourceEntry = findNodeEntry(document, nodeId)
  if (!sourceEntry) return rejectTreeOperation("move", "unknown-node", { nodeId })
  if (!sourceEntry.parentId) return rejectTreeOperation("move", "root-immutable", { nodeId })
  const sourceParentEntry = findParent(document, nodeId)
  const sourceParent = sourceParentEntry?.parent
  if (!sourceParentEntry || !sourceParent) {
    return rejectTreeOperation("move", "unknown-parent", { nodeId })
  }
  const location = resolveMoveLocation(document, nodeId, target)
  if ("status" in location) return location

  const sourceSubtreeIds = new Set(subtreeNodes(sourceEntry.node).map((node) => node.id))
  if (sourceSubtreeIds.has(location.parentId)) {
    return rejectTreeOperation("move", "descendant-cycle", {
      nodeId,
      targetId: target.targetId,
    })
  }
  const destinationParent = findContainer(document, location.parentId)
  if (!destinationParent) {
    return rejectTreeOperation("move", "unknown-parent", {
      nodeId,
      targetId: location.parentId,
    })
  }
  const destinationCollection = location.collection ?? defaultCollection(destinationParent)
  const sameParent =
    sourceParent.id === destinationParent.id &&
    sourceParentEntry.collection === destinationCollection
  if (
    (!sameParent &&
      !containerCanAccept(destinationParent, destinationCollection, sourceEntry.node)) ||
    (sourceEntry.node.type === "productCard" && sourceParent.id !== destinationParent.id)
  ) {
    return rejectTreeOperation("move", "invalid-node", {
      nodeId,
      targetId: destinationParent.id,
    })
  }
  const sourceChildren = parentEntryChildren(sourceParentEntry)
  if (
    !sameParent &&
    sourceParentEntry.collection !== "inProgressChildren" &&
    (isRootStack(document, sourceParent.id) ||
      sourceParent.type === "button" ||
      sourceParent.type === "productSelector" ||
      sourceParent.type === "productCard" ||
      sourceParent.type === "productBadge") &&
    sourceChildren.length <= 1
  ) {
    return rejectTreeOperation("move", "empty-source-stack", {
      nodeId,
      targetId: target.targetId,
    })
  }

  if (sameParent) {
    const normalizedIndex = location.index > sourceEntry.index ? location.index - 1 : location.index
    if (normalizedIndex === sourceEntry.index) {
      return rejectTreeOperation("move", "no-op", { nodeId, targetId: target.targetId })
    }
    const children = [...sourceChildren]
    const [movingNode] = children.splice(sourceEntry.index, 1)
    if (!movingNode) return rejectTreeOperation("move", "unknown-node", { nodeId })
    children.splice(normalizedIndex, 0, cloneValue(movingNode))
    const nextDocument = replaceContainerChildren(
      document,
      sourceParent.id,
      children,
      sourceParentEntry.collection,
    )
    if (!productCardBoundsAreValid(nextDocument)) {
      return rejectTreeOperation("move", "invalid-node", {
        nodeId,
        targetId: destinationParent.id,
      })
    }
    return {
      status: "accepted",
      operation: "move",
      document: nextDocument,
      nodeId,
      parentId: sourceParent.id,
      index: normalizedIndex,
      selectionId: nodeId,
    }
  }

  const remainingSourceChildren = sourceChildren.filter((node) => node.id !== nodeId)
  const withoutSource = replaceContainerChildren(
    document,
    sourceParent.id,
    remainingSourceChildren,
    sourceParentEntry.collection,
  )
  const updatedDestinationParent = findContainer(withoutSource, destinationParent.id)
  if (!updatedDestinationParent) {
    return rejectTreeOperation("move", "unknown-parent", {
      nodeId,
      targetId: destinationParent.id,
    })
  }
  const destinationChildren = [
    ...(collectionChildren(updatedDestinationParent, destinationCollection) ?? []),
  ]
  destinationChildren.splice(location.index, 0, cloneValue(sourceEntry.node))
  const nextDocument = replaceContainerChildren(
    withoutSource,
    updatedDestinationParent.id,
    destinationChildren,
    destinationCollection,
  )
  if (!productCardBoundsAreValid(nextDocument)) {
    return rejectTreeOperation("move", "invalid-node", {
      nodeId,
      targetId: destinationParent.id,
    })
  }
  return {
    status: "accepted",
    operation: "move",
    document: nextDocument,
    nodeId,
    parentId: destinationParent.id,
    index: location.index,
    selectionId: nodeId,
  }
}

interface DuplicatedSubtree {
  readonly node: ProtocolNode
  readonly localizationKeyCopies: readonly {
    readonly sourceKey: string
    readonly duplicateKey: string
  }[]
}

function duplicateSubtree(document: MosaicDocument, source: ProtocolNode): DuplicatedSubtree {
  const identifiers = identifierSet(document)
  const keys = localizationKeySet(document)
  const nodeIdMap = new Map<string, string>()
  const localizationKeyCopies: Array<{ sourceKey: string; duplicateKey: string }> = []

  function duplicateText(text: LocalizedText): LocalizedText {
    const localizationKey = allocateLocalizationKey(keys, `${text.localizationKey}.copy`)
    localizationKeyCopies.push({ sourceKey: text.localizationKey, duplicateKey: localizationKey })
    return { ...cloneValue(text), localizationKey }
  }

  function duplicateControl(accessibility: ControlAccessibility): ControlAccessibility {
    return {
      ...cloneValue(accessibility),
      label: duplicateText(accessibility.label),
      ...(accessibility.hint ? { hint: duplicateText(accessibility.hint) } : {}),
    }
  }

  function duplicateTreeNode(node: ProtocolNode): ProtocolNode {
    const id = allocateIdentifier(identifiers, `${node.id}-copy`)
    nodeIdMap.set(node.id, id)
    switch (node.type) {
      case "stack":
        return {
          ...cloneValue(node),
          id,
          children: node.children.map(duplicateTreeNode) as typeof node.children,
        }
      case "productCard":
        return {
          ...cloneValue(node),
          id,
          children: node.children.map(duplicateTreeNode) as typeof node.children,
          accessibility: node.accessibility
            ? { label: duplicateText(node.accessibility.label) }
            : undefined,
        }
      case "productBadge":
        return {
          ...cloneValue(node),
          id,
          children: node.children.map(duplicateTreeNode) as typeof node.children,
        }
      case "carousel":
        return {
          ...cloneValue(node),
          id,
          pages: node.pages.map((page) => {
            const content = duplicateTreeNode(page.content)
            return {
              ...cloneValue(page),
              id: allocateIdentifier(identifiers, `${page.id}-copy`),
              accessibilityLabel: duplicateText(page.accessibilityLabel),
              content: content.type === "stack" ? content : page.content,
            }
          }),
          accessibility: duplicateControl(node.accessibility),
        }
      case "text":
        return {
          ...cloneValue(node),
          id,
          value: duplicateText(node.value),
          accessibility: node.accessibility.label
            ? { ...node.accessibility, label: duplicateText(node.accessibility.label) }
            : cloneValue(node.accessibility),
        }
      case "countdown":
        return {
          ...cloneValue(node),
          id,
          completedText: duplicateText(node.completedText),
          accessibility: node.accessibility.label
            ? { ...node.accessibility, label: duplicateText(node.accessibility.label) }
            : cloneValue(node.accessibility),
        }
      case "image":
        return {
          ...cloneValue(node),
          id,
          accessibility: node.accessibility.hidden
            ? { hidden: true }
            : { hidden: false, label: duplicateText(node.accessibility.label) },
        }
      case "icon":
        return {
          ...cloneValue(node),
          id,
          accessibility: node.accessibility.hidden
            ? { hidden: true }
            : { hidden: false, label: duplicateText(node.accessibility.label) },
        }
      case "featureList":
        return {
          ...cloneValue(node),
          id,
          items: node.items.map((item) => ({
            ...cloneValue(item),
            id: allocateIdentifier(identifiers, `${item.id}-copy`),
            text: duplicateText(item.text),
          })),
          accessibility: duplicateControl(node.accessibility),
        }
      case "productSelector": {
        const cards = node.cards.map(
          (card) => duplicateTreeNode(card) as Extract<ProtocolNode, { type: "productCard" }>,
        )
        return {
          ...cloneValue(node),
          id,
          cards,
          initialProductCardId: nodeIdMap.get(node.initialProductCardId) ?? cards[0]!.id,
          unavailableFallback: {
            ...cloneValue(node.unavailableFallback),
            message: duplicateText(node.unavailableFallback.message),
          },
          accessibility: duplicateControl(node.accessibility),
        }
      }
      case "button":
        return {
          ...cloneValue(node),
          id,
          children: node.children.map(duplicateTreeNode) as typeof node.children,
          ...(node.inProgressChildren
            ? {
                inProgressChildren: node.inProgressChildren.map(
                  duplicateTreeNode,
                ) as typeof node.inProgressChildren,
              }
            : {}),
          accessibility: duplicateControl(node.accessibility),
        }
      case "switch":
        return {
          ...cloneValue(node),
          id,
          label: duplicateText(node.label),
          accessibility: duplicateControl(node.accessibility),
        }
    }
  }

  function repairInternalReferences(node: ProtocolNode): ProtocolNode {
    let repaired = node
    if (node.type === "stack") {
      repaired = {
        ...node,
        children: node.children.map(repairInternalReferences) as typeof node.children,
      }
    } else if (node.type === "productCard") {
      repaired = {
        ...node,
        children: node.children.map(repairInternalReferences) as typeof node.children,
      }
    } else if (node.type === "productBadge") {
      repaired = {
        ...node,
        children: node.children.map(repairInternalReferences) as typeof node.children,
      }
    } else if (node.type === "button") {
      repaired = {
        ...node,
        children: node.children.map(repairInternalReferences) as typeof node.children,
        ...(node.inProgressChildren
          ? {
              inProgressChildren: node.inProgressChildren.map(
                repairInternalReferences,
              ) as typeof node.inProgressChildren,
            }
          : {}),
      }
    } else if (node.type === "carousel") {
      repaired = {
        ...node,
        pages: node.pages.map((page) => {
          const content = repairInternalReferences(page.content)
          return { ...page, content: content.type === "stack" ? content : page.content }
        }),
      }
    } else if (node.type === "productSelector") {
      repaired = {
        ...node,
        cards: node.cards.map(
          (card) =>
            repairInternalReferences(card) as Extract<ProtocolNode, { type: "productCard" }>,
        ),
        initialProductCardId: nodeIdMap.get(node.initialProductCardId) ?? node.initialProductCardId,
      }
    }
    if (repaired.type === "button" && repaired.action.type === "purchase") {
      const selectorId = nodeIdMap.get(repaired.action.productSelectorId)
      if (selectorId)
        repaired = {
          ...repaired,
          action: { ...repaired.action, productSelectorId: selectorId },
        }
    }
    if ("visibility" in repaired && repaired.visibility?.mode === "switch") {
      const switchId = nodeIdMap.get(repaired.visibility.switchId)
      if (switchId) repaired = { ...repaired, visibility: { ...repaired.visibility, switchId } }
    }
    return repaired
  }

  return {
    node: repairInternalReferences(duplicateTreeNode(source)),
    localizationKeyCopies,
  }
}

export function duplicateNode(
  document: MosaicDocument,
  nodeId: string,
  location?: TreeInsertionLocation,
): TreeOperationResult {
  const sourceEntry = findNodeEntry(document, nodeId)
  if (!sourceEntry) return rejectTreeOperation("duplicate", "unknown-node", { nodeId })
  if (!sourceEntry.parentId) return rejectTreeOperation("duplicate", "root-immutable", { nodeId })
  const destination = location ?? {
    parentId: sourceEntry.parentId,
    index: sourceEntry.index + 1,
    ...(sourceEntry.collection === "children" ? {} : { collection: sourceEntry.collection }),
  }
  const duplicated = duplicateSubtree(document, sourceEntry.node)
  let insertionDocument = document
  let duplicatedNode = duplicated.node
  const sourceParent = findParent(document, nodeId)
  if (
    sourceEntry.node.type === "productCard" &&
    duplicatedNode.type === "productCard" &&
    sourceParent?.parent.type === "productSelector"
  ) {
    const usedReferences = new Set(sourceParent.parent.cards.map((card) => card.productReferenceId))
    let products = [...document.products]
    let reference = products.find((product) => !usedReferences.has(product.id))
    if (!reference) {
      const identifiers = identifierSet(document)
      const keys = localizationKeySet(document)
      reference = createUniqueProductReference(document, identifiers, keys)
      products = [...products, reference]
    }
    insertionDocument = ensureLocalizationCatalogs({ ...document, products })
    duplicatedNode = { ...duplicatedNode, productReferenceId: reference.id }
  }
  const inserted = insertExistingNodeAtLocation(insertionDocument, duplicatedNode, destination)
  if (inserted.status === "rejected") return { ...inserted, operation: "duplicate", nodeId }

  const localization = cloneValue(inserted.document.localization)
  for (const [locale, catalog] of Object.entries(localization.locales)) {
    const sourceCatalog = document.localization.locales[locale]
    for (const { sourceKey, duplicateKey } of duplicated.localizationKeyCopies) {
      catalog.strings[duplicateKey] =
        sourceCatalog?.strings[sourceKey] ?? catalog.strings[duplicateKey] ?? ""
    }
  }
  return {
    ...inserted,
    operation: "duplicate",
    document: { ...inserted.document, localization },
    selectionId: duplicated.node.id,
  }
}

export function deleteNode(document: MosaicDocument, nodeId: string): TreeOperationResult {
  const sourceEntry = findNodeEntry(document, nodeId)
  if (!sourceEntry) return rejectTreeOperation("delete", "unknown-node", { nodeId })
  if (!sourceEntry.parentId) return rejectTreeOperation("delete", "root-immutable", { nodeId })
  const parentEntry = findParent(document, nodeId)
  const parent = parentEntry?.parent
  if (!parentEntry || !parent) return rejectTreeOperation("delete", "unknown-parent", { nodeId })
  const siblings = parentEntryChildren(parentEntry)
  if (
    parentEntry.collection !== "inProgressChildren" &&
    (isRootStack(document, parent.id) ||
      parent.type === "button" ||
      parent.type === "productSelector" ||
      parent.type === "productCard" ||
      parent.type === "productBadge") &&
    siblings.length <= 1
  ) {
    return rejectTreeOperation("delete", "empty-source-stack", { nodeId })
  }
  const fallbackId =
    siblings[sourceEntry.index + 1]?.id ?? siblings[sourceEntry.index - 1]?.id ?? parent.id
  const children = siblings.filter((node) => node.id !== nodeId)
  let nextDocument = replaceContainerChildren(document, parent.id, children, parentEntry.collection)
  if (
    parent.type === "productSelector" &&
    parent.initialProductCardId === nodeId &&
    fallbackId !== parent.id
  ) {
    nextDocument = updateNode(nextDocument, parent.id, (current) =>
      current.type === "productSelector"
        ? { ...current, initialProductCardId: fallbackId }
        : current,
    )
  }
  return {
    status: "accepted",
    operation: "delete",
    document: nextDocument,
    nodeId,
    parentId: parent.id,
    index: sourceEntry.index,
    selectionId: fallbackId,
  }
}

export function resolveLocalizedText(
  document: MosaicDocument,
  text: LocalizedText,
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
