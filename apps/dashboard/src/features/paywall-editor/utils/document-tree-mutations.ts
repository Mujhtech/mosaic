import type {
  BlockInsertionConfiguration,
  ControlAccessibility,
  InsertableBlockType,
  LocalizedText,
  MosaicDocument,
  ProtocolNode,
  TreeInsertionLocation,
  TreeMoveTarget,
  TreeOperationKind,
  TreeOperationRejected,
  TreeOperationResult,
} from "@/features/paywall-editor/types/editor"
import { cloneValue } from "@/features/paywall-editor/utils/clone"
import { isValidCountdownInstant } from "@/features/paywall-editor/utils/countdown"
import { createBlock } from "./document-tree-creation"
import {
  allocateIdentifier,
  allocateLocalizationKey,
  createUniqueProductReference,
  ensureLocalizationCatalogs,
  ensureNodeDependencies,
  identifierSet,
  localizationKeySet,
  productCardBoundsAreValid,
  subtreeIdentifiers,
  subtreeIsStructurallyValid,
  subtreeNodes,
} from "./document-tree-dependencies"
import {
  collectionChildren,
  containerCanAccept,
  ContainerNode,
  defaultCollection,
  findContainer,
  findNode,
  findNodeEntry,
  findParent,
  initialLayout,
  isContainerNode,
  isRootStack,
  parentEntryChildren,
  rejectTreeOperation,
  replaceContainerChildren,
  updateNode,
} from "./document-tree-traversal"

export function resolveInsertionParent(
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

export function resolveMoveLocation(
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

export interface DuplicatedSubtree {
  readonly node: ProtocolNode
  readonly localizationKeyCopies: readonly {
    readonly sourceKey: string
    readonly duplicateKey: string
  }[]
}

export function duplicateSubtree(
  document: MosaicDocument,
  source: ProtocolNode,
): DuplicatedSubtree {
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
