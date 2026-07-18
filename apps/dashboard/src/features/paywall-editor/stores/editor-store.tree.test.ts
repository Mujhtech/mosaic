import { describe, expect, it } from "vitest"

import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates"
import { validateEditorDocument } from "@/features/paywall-editor/schema/editor-validation"
import { createEditorStore, type EditorStore } from "@/features/paywall-editor/stores/editor-store"
import { createStudioWorkspaceStore } from "@/features/paywall-editor/stores/studio-workspace-store"
import type {
  MosaicDocument,
  DocumentNode,
  TreeOperationAccepted,
  TreeOperationResult,
  StackComponent,
} from "@/features/paywall-editor/types/editor"
import { cloneValue } from "@/features/paywall-editor/utils/clone"
import { findNode, findStack, flattenDocument } from "@/features/paywall-editor/utils/document-tree"
import { validatePaywallDocument } from "@/lib/mosaic-protocol"

function template(id: "focused" | "benefits" = "focused") {
  const match = EDITOR_TEMPLATES.find((entry) => entry.id === id)
  if (!match) throw new Error(`Missing test template ${id}`)
  return cloneValue(match.document)
}

function takeNode(document: MosaicDocument, id: string) {
  const node = document.screens[0]!.layout.content.children.find((candidate) => candidate.id === id)
  if (!node) throw new Error(`Missing test node ${id}`)
  document.screens[0]!.layout.content.children =
    document.screens[0]!.layout.content.children.filter((candidate) => candidate.id !== id)
  return node
}

function stack(id: string, children: DocumentNode[]): StackComponent {
  return {
    type: "stack",
    id,
    direction: "vertical",
    gap: 8,
    padding: { top: 0, start: 0, bottom: 0, end: 0 },
    mainAxisDistribution: "start",
    crossAxisAlignment: "stretch",
    children,
  }
}

function nestedDocument() {
  const document = template()
  const headline = takeNode(document, "headline")
  const subtitle = takeNode(document, "subtitle")
  const restore = takeNode(document, "restore")
  document.screens[0]!.layout.content.children.splice(
    1,
    0,
    stack("stack-a", [headline, stack("stack-b", [subtitle, restore])]),
  )
  return document
}

function commerceDocument() {
  const document = template("benefits")
  const features = takeNode(document, "features")
  const selector = takeNode(document, "plans")
  const purchase = takeNode(document, "purchase")
  document.screens[0]!.layout.content.children.splice(
    2,
    0,
    stack("commerce-stack", [features, selector, purchase]),
  )
  return document
}

function expectAccepted(result: TreeOperationResult): TreeOperationAccepted {
  expect(result.status).toBe("accepted")
  if (result.status === "rejected") throw new Error(result.message)
  return result
}

function expectOneCommit(store: EditorStore, operation: () => TreeOperationResult) {
  const before = store.getSnapshot()
  let emissions = 0
  const unsubscribe = store.subscribe(() => {
    emissions += 1
  })
  const result = operation()
  unsubscribe()
  const after = store.getSnapshot()

  const acceptedResult = expectAccepted(result)
  expect(emissions).toBe(1)
  expect(after.undoStack).toHaveLength(before.undoStack.length + 1)
  expect(after.redoStack).toHaveLength(0)
  expect(after.document?.revision).toBe((before.document?.revision ?? 0) + 1)
  expect(after.localRevisionSequence).toBe(before.localRevisionSequence + 1)
  return acceptedResult
}

function expectNoCommit(store: EditorStore, operation: () => TreeOperationResult, reason: string) {
  const before = store.getSnapshot()
  let emissions = 0
  const unsubscribe = store.subscribe(() => {
    emissions += 1
  })
  const result = operation()
  unsubscribe()
  const after = store.getSnapshot()

  expect(result).toMatchObject({
    status: "rejected",
    reason,
    message: expect.any(String),
    recovery: expect.any(String),
  })
  expect(emissions).toBe(0)
  expect(after.document).toEqual(before.document)
  expect(after.undoStack).toEqual(before.undoStack)
  expect(after.redoStack).toEqual(before.redoStack)
  expect(after.document?.revision).toBe(before.document?.revision)
  expect(after.localRevisionSequence).toBe(before.localRevisionSequence)
}

function expectExpandedIdsValid(store: EditorStore) {
  const snapshot = store.getSnapshot()
  const document = snapshot.document
  if (!document) throw new Error("Missing editor document")
  for (const id of snapshot.expandedTreeNodes) {
    expect(findStack(document, id), `Expected expanded ${id} to be a current Stack`).not.toBeNull()
  }
}

describe("editor store tree commands", () => {
  it("commits every accepted operation exactly once", () => {
    const insertStore = createEditorStore()
    insertStore.loadTemplate(template())
    expectOneCommit(insertStore, () =>
      insertStore.insertComponentAt("text", {
        parentId: insertStore.getSnapshot().document!.screens[0]!.layout.content.id,
        index: 0,
      }),
    )

    const moveStore = createEditorStore()
    moveStore.loadTemplate(template())
    expectOneCommit(moveStore, () =>
      moveStore.moveComponent("close", { placement: "after", targetId: "headline" }),
    )

    const duplicateStore = createEditorStore()
    duplicateStore.loadTemplate(template())
    duplicateStore.selectComponent("headline")
    expectOneCommit(duplicateStore, duplicateStore.duplicateSelectedComponent)

    const deleteStore = createEditorStore()
    deleteStore.loadTemplate(template())
    deleteStore.selectComponent("headline")
    expectOneCommit(deleteStore, deleteStore.deleteSelectedComponent)
  })

  it("does not mutate history, revisions, or subscriptions for rejected operations", () => {
    const insertion = createEditorStore()
    insertion.loadTemplate(template())
    expectNoCommit(
      insertion,
      () => insertion.insertComponentAt("text", { parentId: "missing", index: 0 }),
      "unknown-parent",
    )

    const noOp = createEditorStore()
    noOp.loadTemplate(template())
    expectNoCommit(
      noOp,
      () => noOp.moveComponent("close", { placement: "before", targetId: "headline" }),
      "no-op",
    )

    const sibling = createEditorStore()
    sibling.loadTemplate(template())
    sibling.selectComponent("close")
    expectNoCommit(sibling, () => sibling.moveSelectedComponent(-1), "sibling-boundary")

    const indent = createEditorStore()
    indent.loadTemplate(template())
    indent.selectComponent("headline")
    expectNoCommit(indent, indent.indentSelectedComponent, "indent-target-unavailable")
    expectNoCommit(indent, indent.outdentSelectedComponent, "outdent-boundary")

    const deletion = createEditorStore()
    const soleChildDocument = template()
    soleChildDocument.screens[0]!.layout.content.children = [
      takeNode(soleChildDocument, "headline"),
    ]
    deletion.loadTemplate(soleChildDocument)
    deletion.selectComponent("headline")
    expectNoCommit(deletion, deletion.deleteSelectedComponent, "empty-source-stack")
  })

  it("supports explicit root and nested insertion targets and multiple selectors", () => {
    const store = createEditorStore()
    store.loadTemplate(nestedDocument())
    const root = store.getSnapshot().document!.screens[0]!.layout.content

    const rootInsert = expectOneCommit(store, () =>
      store.insertComponentAt("stack", { parentId: root.id, index: 0 }),
    )
    const nestedInsert = expectOneCommit(store, () =>
      store.insertComponentAt("text", { parentId: "stack-b", index: 1 }),
    )
    expect(findStack(store.getSnapshot().document!, rootInsert.nodeId)?.children).toHaveLength(0)
    expect(
      findStack(store.getSnapshot().document!, "stack-b")?.children.map((node) => node.id),
    ).toEqual(["subtitle", nestedInsert.nodeId, "restore"])

    const secondSelector = expectOneCommit(store, () =>
      store.insertComponentAt("productSelector", {
        parentId: root.id,
        index: store.getSnapshot().document!.screens[0]!.layout.content.children.length,
      }),
    )
    expect(secondSelector.nodeId).not.toBe("plans")
    expect(
      flattenDocument(store.getSnapshot().document!).filter(
        (entry) => entry.node.type === "productSelector",
      ),
    ).toHaveLength(2)
    const secondPurchase = expectOneCommit(store, () =>
      store.insertComponentAt("button", {
        parentId: root.id,
        index: store.getSnapshot().document!.screens[0]!.layout.content.children.length,
      }),
    )
    store.updateComponent(secondPurchase.nodeId, (node) =>
      node.type === "button"
        ? {
            ...node,
            action: { type: "purchase", productSelectorId: secondSelector.nodeId },
          }
        : node,
    )
    expect(
      validateEditorDocument(store.getSnapshot().document!).filter(
        (issue) => issue.severity === "error",
      ),
    ).toEqual([])
    expect(validatePaywallDocument(store.getSnapshot().document!).diagnostics).toEqual([])
  })

  it("keeps a purchase inserted without a selector explicitly invalid after a selector is added", () => {
    const document = template()
    document.screens[0]!.layout.content.children =
      document.screens[0]!.layout.content.children.filter(
        (node) => node.type !== "productSelector" && node.id !== "purchase",
      )
    const store = createEditorStore()
    store.loadTemplate(document)

    const purchase = expectOneCommit(store, () =>
      store.insertComponentAt("button", {
        parentId: document.screens[0]!.layout.content.id,
        index: store.getSnapshot().document!.screens[0]!.layout.content.children.length,
      }),
    )
    store.updateComponent(purchase.nodeId, (node) =>
      node.type === "button"
        ? { ...node, action: { type: "purchase", productSelectorId: "plans" } }
        : node,
    )
    expect(validateEditorDocument(store.getSnapshot().document!)).toContainEqual(
      expect.objectContaining({ code: "purchase.missingSelector", componentId: purchase.nodeId }),
    )

    const selector = expectOneCommit(store, () =>
      store.insertComponentAt("productSelector", {
        parentId: document.screens[0]!.layout.content.id,
        index: store.getSnapshot().document!.screens[0]!.layout.content.children.length,
      }),
    )
    expect(selector.nodeId).not.toBe("plans")
    expect(findNode(store.getSnapshot().document!, purchase.nodeId)).toMatchObject({
      action: { productSelectorId: "plans" },
    })
    expect(validateEditorDocument(store.getSnapshot().document!)).toContainEqual(
      expect.objectContaining({ code: "purchase.missingSelector", componentId: purchase.nodeId }),
    )
  })

  it("moves siblings, indents, and outdents without duplicating nested nodes", () => {
    const siblingStore = createEditorStore()
    siblingStore.loadTemplate(template())
    siblingStore.selectComponent("close")
    expectOneCommit(siblingStore, () => siblingStore.moveSelectedComponent(1))
    expect(
      siblingStore
        .getSnapshot()
        .document!.screens[0]!.layout.content.children.slice(0, 2)
        .map((node) => node.id),
    ).toEqual(["headline", "close"])

    const store = createEditorStore()
    store.loadTemplate(nestedDocument())
    store.selectComponent("plans")
    expectOneCommit(store, store.indentSelectedComponent)
    expect(
      findStack(store.getSnapshot().document!, "stack-a")?.children.map((node) => node.id),
    ).toEqual(["headline", "stack-b", "plans"])

    expectOneCommit(store, store.outdentSelectedComponent)
    expect(
      findStack(store.getSnapshot().document!, "stack-a")?.children.map((node) => node.id),
    ).toEqual(["headline", "stack-b"])
    expect(
      flattenDocument(store.getSnapshot().document!).filter((entry) => entry.node.id === "plans"),
    ).toHaveLength(1)
    expect(
      store.getSnapshot().document!.screens[0]!.layout.content.children.map((node) => node.id),
    ).toEqual(["close", "stack-a", "plans", "purchase", "legal"])
  })

  it("duplicates and deletes recursive subtrees with stable undo and redo integrity", () => {
    const store = createEditorStore()
    store.loadTemplate(commerceDocument())
    store.selectComponent("commerce-stack")
    const duplicated = expectOneCommit(store, store.duplicateSelectedComponent)
    const duplicatedDocument = store.getSnapshot().document!
    const duplicatedStack = findStack(duplicatedDocument, duplicated.nodeId)
    if (!duplicatedStack) throw new Error("Missing duplicated commerce Stack")
    const copiedSelector = duplicatedStack.children.find((node) => node.type === "productSelector")
    const copiedPurchase = duplicatedStack.children.find(
      (node) => node.type === "button" && node.action.type === "purchase",
    )
    if (
      !copiedSelector ||
      !copiedPurchase ||
      copiedPurchase.type !== "button" ||
      copiedPurchase.action.type !== "purchase"
    ) {
      throw new Error("Missing copied commerce controls")
    }
    const copiedIds = flattenDocument(duplicatedDocument)
      .filter((entry) =>
        [duplicated.nodeId, ...duplicatedStack.children.map((node) => node.id)].includes(
          entry.node.id,
        ),
      )
      .map((entry) => entry.node.id)

    expect(copiedPurchase.action.productSelectorId).toBe(copiedSelector.id)
    expect(new Set(copiedIds).size).toBe(copiedIds.length)

    store.undo()
    expect(findNode(store.getSnapshot().document!, duplicated.nodeId)).toBeNull()
    expectExpandedIdsValid(store)

    store.redo()
    expect(findStack(store.getSnapshot().document!, duplicated.nodeId)?.children).toEqual(
      duplicatedStack.children,
    )
    expect(
      validateEditorDocument(store.getSnapshot().document!).filter(
        (issue) => issue.severity === "error",
      ),
    ).toEqual([])
    expect(validatePaywallDocument(store.getSnapshot().document!).ok).toBe(true)

    store.selectComponent(duplicated.nodeId)
    expectOneCommit(store, store.deleteSelectedComponent)
    expect(findNode(store.getSnapshot().document!, duplicated.nodeId)).toBeNull()
    store.undo()
    expect(findNode(store.getSnapshot().document!, duplicated.nodeId)).not.toBeNull()
  })

  it("reveals every selected nested ancestor in one emission without touching history", () => {
    const store = createEditorStore()
    store.loadTemplate(nestedDocument())
    const before = store.getSnapshot()
    let emissions = 0
    const unsubscribe = store.subscribe(() => {
      emissions += 1
    })

    store.selectComponent("subtitle")
    unsubscribe()
    const after = store.getSnapshot()

    expect(emissions).toBe(1)
    expect(after.selectedComponentId).toBe("subtitle")
    expect([...after.expandedTreeNodes]).toEqual([
      after.document!.screens[0]!.layout.content.id,
      "stack-a",
      "stack-b",
    ])
    expect(after.undoStack).toEqual(before.undoStack)
    expect(after.redoStack).toEqual(before.redoStack)
    expect(after.document?.revision).toBe(before.document?.revision)
    expect(after.localRevisionSequence).toBe(before.localRevisionSequence)
  })

  it("reconciles selection, hover, and expanded IDs after delete, replace, import, undo, and redo", () => {
    const store = createEditorStore()
    store.loadTemplate(nestedDocument())
    store.selectComponent("subtitle")
    store.hoverComponent("stack-b")
    store.selectComponent("stack-b")

    expectOneCommit(store, store.deleteSelectedComponent)
    expect(store.getSnapshot()).toMatchObject({
      selectedComponentId: "headline",
      hoveredComponentId: null,
    })
    expect(store.getSnapshot().expandedTreeNodes.has("stack-b")).toBe(false)
    expectExpandedIdsValid(store)

    store.undo()
    expect(findStack(store.getSnapshot().document!, "stack-b")).not.toBeNull()
    expectExpandedIdsValid(store)
    store.redo()
    expect(findStack(store.getSnapshot().document!, "stack-b")).toBeNull()
    expectExpandedIdsValid(store)

    store.replaceDocument(nestedDocument())
    store.selectComponent("subtitle")
    store.hoverComponent("subtitle")
    store.replaceDocument(template())
    expect(store.getSnapshot()).toMatchObject({
      selectedComponentId: "close",
      hoveredComponentId: null,
    })
    expect([...store.getSnapshot().expandedTreeNodes]).toEqual([
      store.getSnapshot().document!.screens[0]!.layout.content.id,
    ])

    store.replaceDocument(nestedDocument())
    store.selectComponent("subtitle")
    store.hoverComponent("subtitle")
    store.importDocument(template())
    expect(store.getSnapshot()).toMatchObject({
      selectedComponentId: "close",
      hoveredComponentId: null,
    })
    expectExpandedIdsValid(store)
    store.undo()
    expect(findStack(store.getSnapshot().document!, "stack-b")).not.toBeNull()
    expectExpandedIdsValid(store)
    store.redo()
    expect(findStack(store.getSnapshot().document!, "stack-b")).toBeNull()
    expectExpandedIdsValid(store)
  })

  it("does not change workspace preferences while applying document operations", () => {
    const workspace = createStudioWorkspaceStore({ storage: null })
    const before = cloneValue(workspace.getSnapshot().preferences)
    const store = createEditorStore()
    store.loadTemplate(nestedDocument())
    store.selectComponent("plans")

    expectAccepted(store.indentSelectedComponent())
    expectAccepted(store.outdentSelectedComponent())
    expectAccepted(store.duplicateSelectedComponent())
    expectAccepted(store.deleteSelectedComponent())

    expect(workspace.getSnapshot().preferences).toEqual(before)
  })
})
