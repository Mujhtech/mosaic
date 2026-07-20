import type {
  MosaicDocument,
  ProtocolNode,
  Screen,
  StackComponent,
  TreeOperationKind,
  TreeOperationRejected,
  TreeOperationRejectionReason,
} from "@/features/paywall-editor/types/editor"

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

export interface RejectionContext {
  readonly nodeId?: string
  readonly targetId?: string
}

export const ZERO_INSETS = Object.freeze({ top: 0, start: 0, bottom: 0, end: 0 })

export type NodeCollection = "children" | "inProgressChildren" | "cards"
export type ContainerNode = Extract<
  ProtocolNode,
  { type: "stack" | "button" | "productSelector" | "productCard" | "productBadge" }
>

export function isContainerNode(node: ProtocolNode): node is ContainerNode {
  return (
    node.type === "stack" ||
    node.type === "button" ||
    node.type === "productSelector" ||
    node.type === "productCard" ||
    node.type === "productBadge"
  )
}

export function containerCollections(
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

export function defaultCollection(container: ContainerNode): NodeCollection {
  return container.type === "productSelector" ? "cards" : "children"
}

export function collectionChildren(container: ContainerNode, collection: NodeCollection) {
  return containerCollections(container).find(([name]) => name === collection)?.[1] ?? null
}

export function isPassiveProductNode(child: ProtocolNode): boolean {
  return (
    !["button", "productSelector", "productCard", "productBadge", "switch", "carousel"].includes(
      child.type,
    ) &&
    (child.type !== "stack" || child.children.every(isPassiveProductNode))
  )
}

export function containerCanAccept(
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

export const REJECTION_COPY: Record<
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

export function visitContainerEntries(
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

export function visitForParent(container: ContainerNode, id: string): ParentEntry | null {
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

export function findContainer(document: MosaicDocument, id: string | null): ContainerNode | null {
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

export function isRootStack(document: MosaicDocument, stackId: string) {
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

export function mapNode(
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

export function replaceContainerChildren(
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
