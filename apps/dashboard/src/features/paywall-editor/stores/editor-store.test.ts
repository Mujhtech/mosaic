import { act, renderHook } from "@testing-library/react"
import { createElement, type PropsWithChildren } from "react"
import { describe, expect, it, vi } from "vitest"

import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates"
import { reconcileMockProductsForDocument } from "@/features/paywall-editor/mutations/local-project-file"
import { validateEditorDocument } from "@/features/paywall-editor/schema/editor-validation"
import { createEditorStore, type EditorStore } from "@/features/paywall-editor/stores/editor-store"
import {
  EditorStoreProvider,
  useEditorActions,
  useEditorStoreSelector,
} from "@/features/paywall-editor/stores/editor-store-context"
import type { MosaicDocument } from "@/features/paywall-editor/types/editor"
import { cloneValue } from "@/features/paywall-editor/utils/clone"
import { findNode } from "@/features/paywall-editor/utils/document-tree"

function template(id: "focused" | "benefits" = "focused") {
  const match = EDITOR_TEMPLATES.find((entry) => entry.id === id)
  if (!match) throw new Error(`Missing test template ${id}`)
  return cloneValue(match.document)
}

describe("editor store", () => {
  it("preserves the immutable Scroll Container as an inspector selection", () => {
    const document = template()
    const store = createEditorStore()
    store.loadTemplate(document)

    store.selectComponent(document.screens[0]!.layout.id)
    expect(store.getSnapshot().selectedComponentId).toBe(document.screens[0]!.layout.id)

    const beforeStructuralAttempts = store.getSnapshot().document
    expect(store.moveSelectedComponent(1).status).toBe("rejected")
    expect(store.indentSelectedComponent().status).toBe("rejected")
    expect(store.outdentSelectedComponent().status).toBe("rejected")
    expect(store.duplicateSelectedComponent().status).toBe("rejected")
    expect(store.deleteSelectedComponent().status).toBe("rejected")
    expect(
      store.insertComponentAt("text", { parentId: document.screens[0]!.layout.id, index: 0 })
        .status,
    ).toBe("rejected")
    expect(store.getSnapshot().document).toEqual(beforeStructuralAttempts)

    store.updateDocument((current) => ({
      ...current,
      layout: {
        ...current.screens[0]!.layout,
        showsIndicators: !current.screens[0]!.layout.showsIndicators,
      },
    }))
    expect(store.getSnapshot().selectedComponentId).toBe(document.screens[0]!.layout.id)
  })

  it("groups document edits into monotonic undo and redo revisions", () => {
    vi.spyOn(Date, "now").mockReturnValue(2_000_000)
    const store = createEditorStore()
    store.loadTemplate(template())
    store.selectComponent("headline")
    const initial = store.getSnapshot()
    const initialRevision = initial.document?.revision ?? 0
    const initialSequence = initial.localRevisionSequence

    store.updateComponent("headline", (node) =>
      node.type === "text"
        ? { ...node, value: { ...node.value, default: "A safer headline" } }
        : node,
    )
    expect(findNode(store.getSnapshot().document as MosaicDocument, "headline")).toMatchObject({
      value: { default: "A safer headline" },
    })

    store.undo()
    expect(findNode(store.getSnapshot().document as MosaicDocument, "headline")).toMatchObject({
      value: { default: "Build a paywall people understand" },
    })
    expect(store.getSnapshot().selectedComponentId).toBe("headline")

    store.redo()
    const final = store.getSnapshot()
    expect(findNode(final.document as MosaicDocument, "headline")).toMatchObject({
      value: { default: "A safer headline" },
    })
    expect(final.document?.revision).toBe(initialRevision + 3)
    expect(final.localRevisionSequence).toBe(initialSequence + 3)
  })

  it("commits multiple transient document updates as one undoable revision", () => {
    const store = createEditorStore()
    store.loadTemplate(template())
    const before = store.getSnapshot()
    const beforeHeadline = findNode(before.document as MosaicDocument, "headline")

    expect(store.beginDocumentTransaction()).toBe(true)
    expect(store.beginDocumentTransaction()).toBe(false)
    expect(
      store.updateComponentInTransaction("headline", (node) =>
        node.type === "text"
          ? { ...node, value: { ...node.value, default: "First transient value" } }
          : node,
      ),
    ).toBe(true)
    expect(
      store.updateComponentInTransaction("headline", (node) =>
        node.type === "text"
          ? { ...node, value: { ...node.value, default: "Final transient value" } }
          : node,
      ),
    ).toBe(true)

    const transient = store.getSnapshot()
    expect(findNode(transient.document as MosaicDocument, "headline")).toMatchObject({
      value: { default: "Final transient value" },
    })
    expect(transient).toMatchObject({
      dirty: before.dirty,
      isDocumentTransactionActive: true,
      localRevisionSequence: before.localRevisionSequence,
    })
    expect(transient.document?.revision).toBe(before.document?.revision)
    expect(transient.undoStack).toEqual(before.undoStack)
    expect(transient.redoStack).toEqual(before.redoStack)

    expect(store.commitDocumentTransaction()).toBe(true)
    const committed = store.getSnapshot()
    expect(committed).toMatchObject({
      dirty: true,
      isDocumentTransactionActive: false,
      localRevisionSequence: before.localRevisionSequence + 1,
    })
    expect(committed.document?.revision).toBe((before.document?.revision ?? 0) + 1)
    expect(committed.undoStack).toHaveLength(before.undoStack.length + 1)

    store.undo()
    expect(findNode(store.getSnapshot().document as MosaicDocument, "headline")).toEqual(
      beforeHeadline,
    )
  })

  it("cancels transient edits without rolling workspace state or clearing redo", () => {
    const store = createEditorStore()
    store.loadTemplate(template())
    store.updateComponent("headline", (node) =>
      node.type === "text" ? { ...node, value: { ...node.value, default: "Redo target" } } : node,
    )
    store.undo()
    store.markSaved(store.getSnapshot().document?.revision ?? 0)
    const before = store.getSnapshot()

    expect(before.redoStack).toHaveLength(1)
    expect(store.beginDocumentTransaction()).toBe(true)
    store.updateDocumentInTransaction((document) => ({
      ...document,
      screens: document.screens.map((screen, index) =>
        index === 0
          ? {
              ...screen,
              layout: {
                ...screen.layout,
                showsIndicators: !screen.layout.showsIndicators,
              },
            }
          : screen,
      ),
    }))
    store.selectComponent("purchase")
    store.hoverComponent("purchase")

    const transient = store.getSnapshot()
    expect(transient.document?.screens[0]?.layout.showsIndicators).not.toBe(
      before.document?.screens[0]?.layout.showsIndicators,
    )
    expect(transient.redoStack).toEqual(before.redoStack)
    expect(transient.document?.revision).toBe(before.document?.revision)
    expect(transient.localRevisionSequence).toBe(before.localRevisionSequence)

    expect(store.cancelDocumentTransaction()).toBe(true)
    const cancelled = store.getSnapshot()
    expect(cancelled.document).toEqual(before.document)
    expect(cancelled.undoStack).toEqual(before.undoStack)
    expect(cancelled.redoStack).toEqual(before.redoStack)
    expect(cancelled.dirty).toBe(before.dirty)
    expect(cancelled.lastSavedRevision).toBe(before.lastSavedRevision)
    expect(cancelled.document?.revision).toBe(before.document?.revision)
    expect(cancelled.localRevisionSequence).toBe(before.localRevisionSequence)
    expect(cancelled).toMatchObject({
      selectedComponentId: "purchase",
      hoveredComponentId: "purchase",
      isDocumentTransactionActive: false,
    })
  })

  it("leaves history and revisions unchanged when a transaction has no semantic change", () => {
    const store = createEditorStore()
    store.loadTemplate(template())
    store.updateComponent("headline", (node) =>
      node.type === "text" ? { ...node, value: { ...node.value, default: "Redo target" } } : node,
    )
    store.undo()
    const before = store.getSnapshot()
    const headline = findNode(before.document as MosaicDocument, "headline")
    if (!headline || headline.type !== "text") throw new Error("Missing headline")

    expect(store.updateDocumentInTransaction((document) => document)).toBe(false)
    expect(store.beginDocumentTransaction()).toBe(true)
    store.updateComponentInTransaction("headline", (node) =>
      node.type === "text"
        ? { ...node, value: { ...node.value, default: "Temporary value" } }
        : node,
    )
    store.updateComponentInTransaction("headline", (node) =>
      node.type === "text" ? { ...node, value: cloneValue(headline.value) } : node,
    )

    expect(store.commitDocumentTransaction()).toBe(false)
    const after = store.getSnapshot()
    expect(after.document).toEqual(before.document)
    expect(after.undoStack).toEqual(before.undoStack)
    expect(after.redoStack).toEqual(before.redoStack)
    expect(after.dirty).toBe(before.dirty)
    expect(after.document?.revision).toBe(before.document?.revision)
    expect(after.localRevisionSequence).toBe(before.localRevisionSequence)
    expect(after.isDocumentTransactionActive).toBe(false)
    expect(store.commitDocumentTransaction()).toBe(false)
    expect(store.cancelDocumentTransaction()).toBe(false)
  })

  it("rerenders a primitive selector only when its selected value changes", () => {
    let actions: EditorStore | null = null
    let renderCount = 0
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(EditorStoreProvider, null, children)
    const { result } = renderHook(
      () => {
        renderCount += 1
        actions = useEditorActions()
        return useEditorStoreSelector((state) => state.selectedComponentId)
      },
      { wrapper },
    )

    expect(result.current).toBeNull()
    act(() => actions?.loadTemplate(template()))
    expect(result.current).toBe("close")
    const initialRenderCount = renderCount

    act(() => actions?.hoverComponent("headline"))
    expect(result.current).toBe("close")
    expect(renderCount).toBe(initialRenderCount)

    act(() => actions?.selectComponent("headline"))
    expect(result.current).toBe("headline")
    expect(renderCount).toBe(initialRenderCount + 1)
  })

  it("assigns independent local identities to templates and portable imports", () => {
    const store = createEditorStore()
    const first = template()
    store.loadTemplate(first)
    const templateIdentity = store.getSnapshot().editableDocumentId
    expect(templateIdentity).toMatch(/^document_/)
    expect(store.getSnapshot().localRevisionSequence).toBe(1)

    const imported = template("benefits")
    imported.id = first.id
    imported.revision = 17
    store.importDocument(imported)

    expect(store.getSnapshot().editableDocumentId).toMatch(/^document_/)
    expect(store.getSnapshot().editableDocumentId).not.toBe(templateIdentity)
    expect(store.getSnapshot().localRevisionSequence).toBe(1)
    expect(store.getSnapshot().document?.id).toBe(first.id)
    expect(store.getSnapshot().document?.revision).toBe(17)
  })

  it("restores the editable identity and ordering state from a local autosave", () => {
    const store = createEditorStore()
    const document = template()
    store.restoreProject(document, "document_resumed_project", 42, "ar", 1.5)

    expect(store.getSnapshot()).toMatchObject({
      editableDocumentId: "document_resumed_project",
      localRevisionSequence: 42,
      currentLocale: "ar",
      textScale: 1.5,
      dirty: false,
    })
  })

  it("reconciles selection when an inserted block is undone", () => {
    const store = createEditorStore()
    store.loadTemplate(template())

    const insertedId = store.insertComponent("text")
    expect(store.getSnapshot().selectedComponentId).toBe(insertedId)

    store.undo()
    const afterUndo = store.getSnapshot()
    expect(findNode(afterUndo.document as MosaicDocument, insertedId)).toBeNull()
    expect(afterUndo.selectedComponentId).toBe("close")

    store.redo()
    const afterRedo = store.getSnapshot()
    expect(findNode(afterRedo.document as MosaicDocument, insertedId)).not.toBeNull()
    expect(
      findNode(afterRedo.document as MosaicDocument, afterRedo.selectedComponentId),
    ).not.toBeNull()
  })

  it("prunes removed localization metadata and restores it through history", () => {
    const store = createEditorStore()
    store.loadTemplate(template("benefits"))
    store.selectComponent("features")

    store.removeSelectedComponent()
    const removed = store.getSnapshot().document as MosaicDocument
    expect(findNode(removed, "features")).toBeNull()
    for (const catalog of Object.values(removed.localization.locales)) {
      expect(catalog.strings["paywall.feature.native"]).toBeUndefined()
      expect(catalog.strings["paywall.features.label"]).toBeUndefined()
    }
    expect(validateEditorDocument(removed).filter((issue) => issue.severity === "error")).toEqual(
      [],
    )

    store.undo()
    const restored = store.getSnapshot().document as MosaicDocument
    expect(findNode(restored, "features")).not.toBeNull()
    expect(restored.localization.locales.en?.strings["paywall.feature.native"]).toBe(
      "Native on every platform",
    )

    store.redo()
    expect(
      (store.getSnapshot().document as MosaicDocument).localization.locales.en?.strings[
        "paywall.feature.native"
      ],
    ).toBeUndefined()
  })

  it("creates and preserves an authored bundled image asset when its block is removed", () => {
    const store = createEditorStore()
    store.loadTemplate(template())

    const imageId = store.insertComponent("image")
    expect(store.getSnapshot().document?.assets).toHaveLength(1)
    expect(findNode(store.getSnapshot().document as MosaicDocument, imageId)).toMatchObject({
      type: "image",
      assetId: "hero-image",
    })
    const source = store.getSnapshot().document?.assets[0]?.source
    expect(source?.type === "bundled" ? source.key : null).toBe("mosaic.paywall.hero-image")

    store.removeSelectedComponent()
    expect(store.getSnapshot().document?.assets).toHaveLength(1)

    const reinsertedId = store.insertComponent("image")
    expect(findNode(store.getSnapshot().document as MosaicDocument, reinsertedId)).toMatchObject({
      type: "image",
      assetId: "hero-image",
    })
    expect(store.getSnapshot().document?.assets).toHaveLength(1)
    expect(
      validateEditorDocument(store.getSnapshot().document as MosaicDocument).filter(
        (issue) => issue.severity === "error",
      ),
    ).toEqual([])

    store.undo()
    expect(store.getSnapshot().document?.assets).toHaveLength(1)
  })

  it("restores product definitions without silently rebinding an orphan purchase action", () => {
    const store = createEditorStore()
    store.loadTemplate(template())
    store.selectComponent("plans")
    store.removeSelectedComponent()

    expect(store.getSnapshot().document?.products).toEqual([])
    const current = store.getSnapshot().document as MosaicDocument
    const replacement = store.insertComponentAt("productSelector", {
      parentId: current.screens[0]!.layout.content.id,
      index: current.screens[0]!.layout.content.children.length,
    })
    if (replacement.status === "rejected") throw new Error(replacement.message)
    const replacementId = replacement.nodeId
    const document = store.getSnapshot().document as MosaicDocument
    expect(document.products.map((product) => product.id)).toEqual(["monthly-plan", "yearly-plan"])
    expect(findNode(document, "purchase")).toMatchObject({
      action: { productSelectorId: "plans" },
    })
    expect(replacementId).not.toBe("plans")
    expect(reconcileMockProductsForDocument(document, [])).toEqual([
      expect.objectContaining({ productReferenceId: "monthly-plan" }),
      expect.objectContaining({ productReferenceId: "yearly-plan" }),
    ])
    expect(validateEditorDocument(document)).toContainEqual(
      expect.objectContaining({
        code: "purchase.missingSelector",
        componentId: "purchase",
      }),
    )
  })

  it("reconciles imported mock IDs after undo restores the prior paywall", () => {
    const store = createEditorStore()
    store.loadTemplate(template())
    const imported = template()
    imported.products = imported.products.map((product, index) => ({
      ...product,
      id: index === 0 ? "starter-plan" : "pro-plan",
    }))
    const selector = findNode(imported, "plans")
    if (!selector || selector.type !== "productSelector") throw new Error("Missing selector")
    selector.cards[0]!.productReferenceId = "starter-plan"
    selector.cards[1]!.productReferenceId = "pro-plan"
    selector.initialProductCardId = selector.cards[0]!.id

    store.importDocument(imported)
    store.undo()
    const restored = store.getSnapshot().document as MosaicDocument
    const mocks = reconcileMockProductsForDocument(restored, [
      {
        productReferenceId: "starter-plan",
        availability: "unavailable",
        reason: "notConfigured",
      },
      {
        productReferenceId: "pro-plan",
        availability: "unavailable",
        reason: "notConfigured",
      },
    ])

    expect(mocks.map((product) => product.productReferenceId)).toEqual([
      "monthly-plan",
      "yearly-plan",
    ])
  })

  it("reconciles locale when undo restores a document without the imported locale", () => {
    const store = createEditorStore()
    store.loadTemplate(template())
    const imported = template("benefits")
    imported.localization.defaultLocale = "fr"
    imported.localization.fallbackLocale = "fr"
    imported.localization.locales = {
      fr: { ...cloneValue(imported.localization.locales.en!), direction: "ltr" },
    }

    store.importDocument(imported)
    expect(store.getSnapshot().currentLocale).toBe("fr")
    store.undo()

    expect(store.getSnapshot().currentLocale).toBe("en")
    expect(store.getSnapshot().document?.localization.locales.en).toBeDefined()
  })

  it("allows removing the only child of a nested stack", () => {
    const document = template()
    const headline = document.screens[0]!.layout.content.children.find(
      (node) => node.id === "headline",
    )
    if (!headline) throw new Error("Missing headline test node")
    document.screens[0]!.layout.content.children =
      document.screens[0]!.layout.content.children.filter((node) => node.id !== "headline")
    document.screens[0]!.layout.content.children.unshift({
      type: "stack",
      id: "nested-stack",
      direction: "vertical",
      gap: 8,
      padding: { top: 0, start: 0, bottom: 0, end: 0 },
      mainAxisDistribution: "start",
      crossAxisAlignment: "stretch",
      children: [headline],
    })
    const store = createEditorStore()
    store.loadTemplate(document)
    store.selectComponent("headline")

    store.removeSelectedComponent()

    expect(findNode(store.getSnapshot().document as MosaicDocument, "headline")).toBeNull()
    expect(findNode(store.getSnapshot().document as MosaicDocument, "nested-stack")).toMatchObject({
      type: "stack",
      children: [],
    })
  })
})
