import { describe, expect, it, vi } from "vitest"

import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates"
import { reconcileMockProductsForDocument } from "@/features/paywall-editor/mutations/local-project-file"
import { validateEditorDocument } from "@/features/paywall-editor/schema/editor-validation"
import { createEditorStore } from "@/features/paywall-editor/stores/editor-store"
import type { MosaicDocument } from "@/features/paywall-editor/types/editor"
import { cloneValue } from "@/features/paywall-editor/utils/clone"
import { findNode } from "@/features/paywall-editor/utils/document-tree"

function template(id: "focused" | "benefits" = "focused") {
  const match = EDITOR_TEMPLATES.find((entry) => entry.id === id)
  if (!match) throw new Error(`Missing test template ${id}`)
  return cloneValue(match.document)
}

describe("editor store", () => {
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
    expect(validateEditorDocument(removed)).toEqual([])

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

  it("creates and cleans a bundled image asset with the block", () => {
    const store = createEditorStore()
    store.loadTemplate(template())

    const imageId = store.insertComponent("image")
    expect(store.getSnapshot().document?.assets).toHaveLength(1)
    expect(findNode(store.getSnapshot().document as MosaicDocument, imageId)).toMatchObject({
      type: "image",
      assetId: "hero-image",
    })

    store.removeSelectedComponent()
    expect(store.getSnapshot().document?.assets).toEqual([])

    const reinsertedId = store.insertComponent("image")
    expect(findNode(store.getSnapshot().document as MosaicDocument, reinsertedId)).toMatchObject({
      type: "image",
      assetId: "hero-image",
    })
    expect(store.getSnapshot().document?.assets).toHaveLength(1)
    expect(validateEditorDocument(store.getSnapshot().document as MosaicDocument)).toEqual([])

    store.undo()
    expect(store.getSnapshot().document?.assets).toEqual([])
  })

  it("restores product definitions and rebinds an orphan purchase action", () => {
    const store = createEditorStore()
    store.loadTemplate(template())
    store.selectComponent("plans")
    store.removeSelectedComponent()

    expect(store.getSnapshot().document?.products).toEqual([])
    const replacementId = store.insertComponent("productSelector")
    const document = store.getSnapshot().document as MosaicDocument
    expect(document.products.map((product) => product.id)).toEqual(["monthly-plan", "yearly-plan"])
    expect(findNode(document, "purchase")).toMatchObject({
      action: { productSelectorId: replacementId },
    })
    expect(reconcileMockProductsForDocument(document, [])).toEqual([
      expect.objectContaining({ productReferenceId: "monthly-plan" }),
      expect.objectContaining({ productReferenceId: "yearly-plan" }),
    ])
    expect(validateEditorDocument(document)).toEqual([])
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
    selector.productReferenceIds = ["starter-plan", "pro-plan"]
    selector.initiallySelectedProductReferenceId = "starter-plan"

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

  it("does not remove the only child of a nested stack", () => {
    const document = template()
    const headline = document.layout.content.children.find((node) => node.id === "headline")
    if (!headline) throw new Error("Missing headline test node")
    document.layout.content.children = document.layout.content.children.filter(
      (node) => node.id !== "headline",
    )
    document.layout.content.children.unshift({
      type: "verticalStack",
      id: "nested-stack",
      spacing: 8,
      padding: { top: 0, start: 0, bottom: 0, end: 0 },
      horizontalAlignment: "stretch",
      children: [headline],
    })
    const store = createEditorStore()
    store.loadTemplate(document)
    store.selectComponent("headline")

    store.removeSelectedComponent()

    expect(findNode(store.getSnapshot().document as MosaicDocument, "headline")).not.toBeNull()
  })
})
