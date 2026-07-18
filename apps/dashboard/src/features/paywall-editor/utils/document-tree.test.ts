import { describe, expect, it } from "vitest"

import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates"
import { validateEditorDocument } from "@/features/paywall-editor/schema/editor-validation"
import type {
  MosaicDocument,
  DocumentNode,
  ProtocolNode,
  TreeOperationAccepted,
  TreeOperationResult,
  StackComponent,
} from "@/features/paywall-editor/types/editor"
import { cloneValue } from "@/features/paywall-editor/utils/clone"
import {
  appendProductBadge,
  appendProductCard,
  appendScreen,
  createBlock,
  deleteNode,
  duplicateNode,
  findAncestorNodeIds,
  findAncestorStackIds,
  findNode,
  findParent,
  findStack,
  flattenDocument,
  getSiblingBoundaries,
  insertBlockAtLocation,
  insertExistingNodeAtLocation,
  moveNode,
  reconcileExpandedTreeNodes,
  resolveLegacyInsertionLocation,
  revealNodeAncestors,
  screenContainingNode,
} from "@/features/paywall-editor/utils/document-tree"
import { synchronizeProtocolMetadata } from "@/features/paywall-editor/utils/protocol-document"
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

type ProductCardStack = Extract<
  Extract<ProtocolNode, { type: "productCard" }>["children"][number],
  { type: "stack" }
>

function productCardStack(id: string, children: ProductCardStack["children"]): ProductCardStack {
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

function accepted(result: TreeOperationResult): asserts result is TreeOperationAccepted {
  expect(result.status).toBe("accepted")
  if (result.status === "rejected") throw new Error(result.message)
}

function editorErrors(document: MosaicDocument) {
  return validateEditorDocument(document).filter((issue) => issue.severity === "error")
}

function rejected(result: TreeOperationResult, reason: string) {
  expect(result).toMatchObject({
    status: "rejected",
    reason,
    message: expect.any(String),
    recovery: expect.any(String),
  })
}

function allIdentifiers(document: MosaicDocument) {
  return [
    document.screens[0]!.layout.content,
    ...flattenDocument(document).map((entry) => entry.node),
  ].flatMap((node) =>
    node.type === "featureList" ? [node.id, ...node.items.map((item) => item.id)] : [node.id],
  )
}

describe("document tree transforms", () => {
  it("adds a valid localized screen with collision-safe identifiers", () => {
    const source = template()
    const result = appendScreen(source)
    const added = result.document.screens.find((screen) => screen.id === result.screenId)

    expect(source.screens).toHaveLength(1)
    expect(result.document.screens).toHaveLength(2)
    expect(added).toMatchObject({
      id: "screen-2",
      accessibilityLabel: { default: "Screen 2" },
      layout: {
        id: "screen-2-scroll",
        content: { id: "screen-2-content" },
      },
    })
    expect(findNode(result.document, result.selectionId)).toMatchObject({
      type: "text",
      value: { default: "Screen 2" },
    })
    expect(screenContainingNode(result.document, result.selectionId)?.id).toBe(result.screenId)
    for (const catalog of Object.values(result.document.localization.locales)) {
      expect(catalog.strings["paywall.screen_2.title"]).toBe("Screen 2")
    }
    expect(editorErrors(result.document)).toEqual([])
    expect(validatePaywallDocument(synchronizeProtocolMetadata(result.document)).ok).toBe(true)
  })

  it("keeps every accepted and rejected transform pure", () => {
    const document = nestedDocument()
    const before = cloneValue(document)

    accepted(
      insertBlockAtLocation(document, "text", {
        parentId: "stack-b",
        index: 1,
      }),
    )
    accepted(moveNode(document, "subtitle", { placement: "after", targetId: "stack-b" }))
    accepted(duplicateNode(document, "stack-a"))
    accepted(deleteNode(document, "subtitle"))
    rejected(
      moveNode(document, "stack-a", { placement: "inside", targetId: "stack-b" }),
      "descendant-cycle",
    )

    expect(document).toEqual(before)
  })

  it("creates an empty Stack and inserts blocks at root and nested locations", () => {
    const document = template()
    const rootId = document.screens[0]!.layout.content.id
    const created = createBlock(document, "stack")

    expect(created).toMatchObject({
      type: "stack",
      children: [],
    })
    if (created.type !== "stack") throw new Error("Expected a Stack")
    expect(created.children).toHaveLength(0)

    const rootInsert = insertBlockAtLocation(document, "stack", {
      parentId: rootId,
      index: 1,
    })
    accepted(rootInsert)
    const insertedStack = findStack(rootInsert.document, rootInsert.nodeId)
    expect(insertedStack?.children).toHaveLength(0)

    const nestedInsert = insertBlockAtLocation(rootInsert.document, "text", {
      parentId: rootInsert.nodeId,
      index: 0,
    })
    accepted(nestedInsert)
    expect(findStack(nestedInsert.document, rootInsert.nodeId)?.children).toHaveLength(1)
    expect(editorErrors(nestedInsert.document)).toEqual([])
    expect(validatePaywallDocument(nestedInsert.document).ok).toBe(true)
  })

  it("requires an explicit valid Countdown deadline and accepts an expired deadline unchanged", () => {
    const document = template()
    const location = {
      parentId: document.screens[0]!.layout.content.id,
      index: document.screens[0]!.layout.content.children.length,
    }

    rejected(insertBlockAtLocation(document, "countdown", location), "configuration-required")
    rejected(
      insertBlockAtLocation(document, "countdown", location, {
        countdownEndsAt: "2026-02-31T12:00:00Z",
      }),
      "configuration-required",
    )
    expect(() => createBlock(document, "countdown")).toThrow(/explicit valid UTC deadline/i)

    const inserted = insertBlockAtLocation(document, "countdown", location, {
      countdownEndsAt: "2000-01-01T00:00:00Z",
    })
    accepted(inserted)
    expect(findNode(inserted.document, inserted.nodeId)).toMatchObject({
      type: "countdown",
      endsAt: "2000-01-01T00:00:00Z",
    })
    expect(validatePaywallDocument(synchronizeProtocolMetadata(inserted.document)).ok).toBe(true)
  })

  it("resolves legacy insertion relative to a selected Stack, leaf, or missing selection", () => {
    const document = nestedDocument()

    expect(resolveLegacyInsertionLocation(document, "stack-b")).toEqual({
      parentId: "stack-b",
      index: 2,
    })
    expect(resolveLegacyInsertionLocation(document, "subtitle")).toEqual({
      parentId: "stack-b",
      index: 1,
    })
    expect(resolveLegacyInsertionLocation(document, "missing")).toEqual({
      parentId: document.screens[0]!.layout.content.id,
      index: document.screens[0]!.layout.content.children.length,
    })
  })

  it("allows multiple selectors and keeps an unbound purchase action validation-visible", () => {
    const document = template()
    const secondSelector = insertBlockAtLocation(document, "productSelector", {
      parentId: document.screens[0]!.layout.content.id,
      index: 4,
    })
    accepted(secondSelector)
    expect(
      flattenDocument(secondSelector.document).filter(
        (entry) => entry.node.type === "productSelector",
      ),
    ).toHaveLength(2)

    const purchase = createBlock(secondSelector.document, "button")
    if (purchase.type !== "button") throw new Error("Expected a Button")
    purchase.action = { type: "purchase", productSelectorId: "plans" }
    expect(purchase).toMatchObject({
      action: { type: "purchase", productSelectorId: "plans" },
    })

    const withoutCommerce = template()
    withoutCommerce.screens[0]!.layout.content.children =
      withoutCommerce.screens[0]!.layout.content.children.filter(
        (node) => node.type !== "productSelector" && node.id !== "purchase",
      )
    const orphanButton = createBlock(withoutCommerce, "button")
    if (orphanButton.type !== "button") throw new Error("Expected a Button")
    orphanButton.action = { type: "purchase", productSelectorId: "plans" }
    const orphan = insertExistingNodeAtLocation(withoutCommerce, orphanButton, {
      parentId: withoutCommerce.screens[0]!.layout.content.id,
      index: withoutCommerce.screens[0]!.layout.content.children.length,
    })
    accepted(orphan)
    expect(editorErrors(orphan.document)).toEqual([
      expect.objectContaining({ code: "purchase.missingSelector", componentId: orphan.nodeId }),
    ])

    const laterSelector = insertBlockAtLocation(orphan.document, "productSelector", {
      parentId: orphan.document.screens[0]!.layout.content.id,
      index: orphan.document.screens[0]!.layout.content.children.length,
    })
    accepted(laterSelector)
    expect(findNode(laterSelector.document, orphan.nodeId)).toMatchObject({
      action: { productSelectorId: "plans" },
    })
    expect(editorErrors(laterSelector.document)).toEqual([
      expect.objectContaining({ code: "purchase.missingSelector", componentId: orphan.nodeId }),
    ])
  })

  it("rejects invalid insertion parents, indexes, and all identifier collisions", () => {
    const document = template("benefits")
    const textNode = createBlock(document, "text")

    rejected(
      insertExistingNodeAtLocation(document, textNode, { parentId: "missing", index: 0 }),
      "unknown-parent",
    )
    rejected(
      insertExistingNodeAtLocation(document, textNode, { parentId: "headline", index: 0 }),
      "non-stack-parent",
    )
    rejected(
      insertExistingNodeAtLocation(document, textNode, {
        parentId: document.screens[0]!.layout.content.id,
        index: -1,
      }),
      "invalid-index",
    )
    const emptyStack = insertExistingNodeAtLocation(document, stack("empty-stack", []), {
      parentId: document.screens[0]!.layout.content.id,
      index: 0,
    })
    accepted(emptyStack)
    expect(findStack(emptyStack.document, "empty-stack")?.children).toEqual([])
    rejected(
      insertExistingNodeAtLocation(
        document,
        {
          type: "featureList",
          id: "incoming-features",
          marker: "checkmark",
          gap: 8,
          markerColor: "action.primary",
          items: [
            {
              id: "native-everywhere",
              text: { default: "Collision", localizationKey: "paywall.collision" },
            },
          ],
          typography: {
            style: "body",
            fontSize: 16,
            lineHeightMultiplier: 1.5,
            weight: "regular",
            color: "text.primary",
            alignment: "start",
          },
          accessibility: {
            label: { default: "Collision", localizationKey: "paywall.collision.label" },
          },
        },
        { parentId: document.screens[0]!.layout.content.id, index: 0 },
      ),
      "duplicate-id",
    )
  })

  it("moves before, after, and inside while normalizing same-parent indexes", () => {
    const document = template()
    const before = moveNode(document, "headline", { placement: "before", targetId: "close" })
    accepted(before)
    expect(
      before.document.screens[0]!.layout.content.children.slice(0, 2).map((node) => node.id),
    ).toEqual(["headline", "close"])

    const after = moveNode(document, "close", { placement: "after", targetId: "headline" })
    accepted(after)
    expect(
      after.document.screens[0]!.layout.content.children.slice(0, 2).map((node) => node.id),
    ).toEqual(["headline", "close"])

    const nested = nestedDocument()
    const inside = moveNode(nested, "purchase", {
      placement: "inside",
      targetId: "stack-a",
      index: 1,
    })
    accepted(inside)
    expect(findStack(inside.document, "stack-a")?.children.map((node) => node.id)).toEqual([
      "headline",
      "purchase",
      "stack-b",
    ])
    expect(
      flattenDocument(inside.document).filter((entry) => entry.node.id === "purchase"),
    ).toHaveLength(1)

    rejected(moveNode(document, "close", { placement: "before", targetId: "headline" }), "no-op")
    rejected(
      moveNode(document, "close", {
        placement: "inside",
        targetId: document.screens[0]!.layout.content.id,
        index: 0,
      }),
      "no-op",
    )
  })

  it("outdents across an ancestor without duplicating the source or emptying its old Stack", () => {
    const document = nestedDocument()
    const result = moveNode(document, "subtitle", {
      placement: "after",
      targetId: "stack-b",
    })
    accepted(result)

    expect(findStack(result.document, "stack-b")?.children.map((node) => node.id)).toEqual([
      "restore",
    ])
    expect(findStack(result.document, "stack-a")?.children.map((node) => node.id)).toEqual([
      "headline",
      "stack-b",
      "subtitle",
    ])
    expect(
      flattenDocument(result.document).filter((entry) => entry.node.id === "subtitle"),
    ).toHaveLength(1)
    expect(validatePaywallDocument(result.document).ok).toBe(true)
  })

  it("rejects cycles, invalid targets, and no-ops while allowing an empty nested source", () => {
    const document = nestedDocument()
    rejected(
      moveNode(document, "stack-a", { placement: "inside", targetId: "stack-b" }),
      "descendant-cycle",
    )
    rejected(
      moveNode(document, "stack-a", { placement: "inside", targetId: "stack-a" }),
      "self-target",
    )
    rejected(
      moveNode(document, "headline", { placement: "before", targetId: "missing" }),
      "unknown-target",
    )
    rejected(
      moveNode(document, "headline", { placement: "inside", targetId: "subtitle" }),
      "non-stack-parent",
    )
    rejected(
      moveNode(document, "headline", {
        placement: "inside",
        targetId: "stack-b",
        index: 99,
      }),
      "invalid-index",
    )
    rejected(
      moveNode(document, document.screens[0]!.layout.content.id, {
        placement: "before",
        targetId: "close",
      }),
      "root-immutable",
    )

    const soleChildDocument = template()
    const headline = takeNode(soleChildDocument, "headline")
    soleChildDocument.screens[0]!.layout.content.children.splice(
      1,
      0,
      stack("sole-stack", [headline]),
    )
    const emptying = moveNode(soleChildDocument, "headline", {
      placement: "after",
      targetId: "sole-stack",
    })
    accepted(emptying)
    expect(findStack(emptying.document, "sole-stack")?.children).toHaveLength(0)
  })

  it("duplicates a recursive commerce subtree with fresh IDs, keys, and repaired references", () => {
    const document = template("benefits")
    const features = takeNode(document, "features")
    const selector = takeNode(document, "plans")
    const purchase = takeNode(document, "purchase")
    document.screens[0]!.layout.content.children.splice(
      2,
      0,
      stack("commerce-stack", [features, selector, purchase]),
    )
    const beforeIds = new Set(allIdentifiers(document))

    const result = duplicateNode(document, "commerce-stack")
    accepted(result)
    const copy = findStack(result.document, result.nodeId)
    if (!copy) throw new Error("Missing duplicated Stack")
    const copiedSelector = copy.children.find((node) => node.type === "productSelector")
    const copiedPurchase = copy.children.find(
      (node) => node.type === "button" && node.action.type === "purchase",
    )
    if (
      !copiedSelector ||
      !copiedPurchase ||
      copiedPurchase.type !== "button" ||
      copiedPurchase.action.type !== "purchase"
    ) {
      throw new Error("Missing duplicated commerce controls")
    }

    const copiedIds = allIdentifiers(result.document).filter((id) => !beforeIds.has(id))
    expect(copiedIds.length).toBeGreaterThan(5)
    expect(new Set(allIdentifiers(result.document)).size).toBe(
      allIdentifiers(result.document).length,
    )
    expect(copiedPurchase.action.productSelectorId).toBe(copiedSelector.id)
    expect(copiedPurchase.action.productSelectorId).not.toBe("plans")
    expect(editorErrors(result.document)).toEqual([])
    expect(validatePaywallDocument(result.document).ok).toBe(true)
  })

  it("duplicates a Product Card with a unique atomic product binding", () => {
    const document = template()
    const result = duplicateNode(document, "monthly-card")
    accepted(result)

    const selector = findNode(result.document, "plans")
    if (selector?.type !== "productSelector") throw new Error("Missing Product Selector")
    expect(selector.cards).toHaveLength(3)
    expect(new Set(selector.cards.map((card) => card.productReferenceId)).size).toBe(3)
    const copy = selector.cards.find((card) => card.id === result.selectionId)
    expect(copy?.productReferenceId).toBe("product-3")
    expect(result.document.products.find((product) => product.id === "product-3")).toMatchObject({
      productId: "mosaic_product_3",
      label: { default: "Product 3" },
    })
    expect(editorErrors(result.document)).toEqual([])
    expect(validatePaywallDocument(result.document).ok).toBe(true)
  })

  it("allocates collision-safe provider product IDs for added and duplicated Product Cards", () => {
    const source = template()
    source.products[0]!.productId = "mosaic_product_3"

    const appended = appendProductCard(source, "plans")
    if (!appended) throw new Error("Product Card was not appended")
    expect(appended.document.products.at(-1)).toMatchObject({
      id: "product-4",
      productId: "mosaic_product_4",
    })

    const duplicated = duplicateNode(source, "monthly-card")
    accepted(duplicated)
    expect(duplicated.document.products.at(-1)).toMatchObject({
      id: "product-4",
      productId: "mosaic_product_4",
    })
    expect(validatePaywallDocument(duplicated.document).ok).toBe(true)
  })

  it("rejects insert, duplicate, and Badge additions beyond a Product Card's 20 descendants", () => {
    const document = template()
    const card = findNode(document, "monthly-card")
    const sourceText = findNode(document, "monthly-name")
    if (card?.type !== "productCard" || sourceText?.type !== "text") {
      throw new Error("Missing Product Card test nodes")
    }
    card.children = Array.from({ length: 20 }, (_, index) => ({
      ...cloneValue(sourceText),
      id: `bounded-card-text-${index + 1}`,
    }))

    const incoming = { ...cloneValue(sourceText), id: "bounded-card-overflow" }
    rejected(
      insertExistingNodeAtLocation(document, incoming, {
        parentId: card.id,
        index: card.children.length,
      }),
      "invalid-node",
    )
    rejected(duplicateNode(document, card.children[0]!.id), "invalid-node")
    expect(appendProductBadge(document, card.id)).toBeNull()
    expect(card.children).toHaveLength(20)
  })

  it("rejects a move that would exceed four nested Stacks inside a Product Card", () => {
    const document = template()
    const card = findNode(document, "monthly-card")
    const sourceText = findNode(document, "monthly-name")
    if (card?.type !== "productCard" || sourceText?.type !== "text") {
      throw new Error("Missing Product Card test nodes")
    }
    const deepest = productCardStack("card-stack-4", [cloneValue(sourceText)])
    card.children = [
      productCardStack("card-stack-1", [
        productCardStack("card-stack-2", [productCardStack("card-stack-3", [deepest])]),
      ]),
    ]
    const root = document.screens[0]!.layout.content
    const movingText = createBlock(document, "text")
    if (movingText.type !== "text") throw new Error("Missing moving Text")
    root.children.splice(1, 0, stack("moving-stack", [movingText]))

    rejected(
      moveNode(document, "moving-stack", {
        placement: "inside",
        targetId: deepest.id,
      }),
      "invalid-node",
    )
    expect(findNode(document, "moving-stack")).not.toBeNull()
  })

  it("copies every locale value when duplicated fields intentionally share one source key", () => {
    const document = nestedDocument()
    const headline = findNode(document, "headline")
    const subtitle = findNode(document, "subtitle")
    if (headline?.type !== "text" || subtitle?.type !== "text") {
      throw new Error("Missing shared-key text fixtures")
    }
    headline.value.localizationKey = "paywall.shared"
    subtitle.value.localizationKey = "paywall.shared"
    const sharedValues = { en: "Shared EN", de: "Shared DE", ar: "Shared AR" } as const
    for (const [locale, value] of Object.entries(sharedValues)) {
      const catalog = document.localization.locales[locale]
      if (!catalog) throw new Error(`Missing ${locale} catalog`)
      catalog.strings["paywall.shared"] = value
    }

    const result = duplicateNode(document, "stack-a")
    accepted(result)
    const copy = findStack(result.document, result.nodeId)
    if (!copy) throw new Error("Missing duplicated shared-key Stack")
    const copiedTexts = flattenDocument({
      ...result.document,
      initialScreenId: "copy-screen",
      screens: [
        {
          id: "copy-screen",
          presentation: { type: "screen" },
          layout: { ...result.document.screens[0]!.layout, content: copy },
        },
      ],
    })
      .map((entry) => entry.node)
      .filter(
        (node): node is Extract<ProtocolNode, { type: "text" }> =>
          node.type === "text" && node.value.localizationKey.startsWith("paywall.shared.copy"),
      )
    const duplicateKeys = copiedTexts.map((node) => node.value.localizationKey)

    expect(duplicateKeys).toHaveLength(2)
    expect(new Set(duplicateKeys).size).toBe(2)
    expect(duplicateKeys).not.toContain("paywall.shared")
    for (const [locale, expectedValue] of Object.entries(sharedValues)) {
      const catalog = result.document.localization.locales[locale]
      expect(duplicateKeys.map((key) => catalog?.strings[key])).toEqual([
        expectedValue,
        expectedValue,
      ])
    }
  })

  it("returns deterministic deletion recovery and permits an empty nested Stack", () => {
    const document = nestedDocument()
    const deleted = deleteNode(document, "subtitle")
    accepted(deleted)
    expect(deleted.selectionId).toBe("restore")
    expect(findStack(deleted.document, "stack-b")?.children.map((node) => node.id)).toEqual([
      "restore",
    ])

    const onlyChild = deleteNode(deleted.document, "restore")
    accepted(onlyChild)
    expect(findNode(onlyChild.document, "restore")).toBeNull()
    expect(findStack(onlyChild.document, "stack-b")?.children).toEqual([])
    rejected(deleteNode(document, document.screens[0]!.layout.content.id), "root-immutable")
  })

  it("reports ancestors and sibling capabilities and reconciles expanded Stack IDs", () => {
    const document = nestedDocument()

    expect(findAncestorStackIds(document, "subtitle")).toEqual([
      document.screens[0]!.layout.content.id,
      "stack-a",
      "stack-b",
    ])
    expect(findParent(document, "subtitle")).toMatchObject({
      parent: { id: "stack-b" },
      index: 0,
    })
    expect(getSiblingBoundaries(document, "subtitle")).toMatchObject({
      previousSibling: null,
      nextSibling: { id: "restore" },
      canMovePrevious: false,
      canMoveNext: true,
      canOutdent: true,
    })

    expect([
      ...reconcileExpandedTreeNodes(
        document,
        new Set(["missing", "headline", "stack-a", "stack-b"]),
      ),
    ]).toEqual([document.screens[0]!.layout.content.id, "stack-a", "stack-b"])
    expect([...revealNodeAncestors(document, "subtitle", new Set())]).toEqual([
      document.screens[0]!.layout.content.id,
      "stack-a",
      "stack-b",
    ])
  })

  it("includes Carousel containers when revealing and protecting nested page content", () => {
    const document = template()
    const carouselInsert = insertBlockAtLocation(document, "carousel", {
      parentId: document.screens[0]!.layout.content.id,
      index: document.screens[0]!.layout.content.children.length,
    })
    accepted(carouselInsert)
    const carousel = findNode(carouselInsert.document, carouselInsert.nodeId)
    if (!carousel || carousel.type !== "carousel") throw new Error("Missing Carousel")
    const pageStack = carousel.pages[0]?.content
    if (!pageStack) throw new Error("Missing Carousel page Stack")
    const textInsert = insertBlockAtLocation(carouselInsert.document, "text", {
      parentId: pageStack.id,
      index: 0,
    })
    accepted(textInsert)

    expect(findAncestorNodeIds(textInsert.document, textInsert.nodeId)).toEqual([
      document.screens[0]!.layout.content.id,
      carousel.id,
      pageStack.id,
    ])
    expect(findAncestorStackIds(textInsert.document, textInsert.nodeId)).toEqual([
      document.screens[0]!.layout.content.id,
      pageStack.id,
    ])
    expect([...revealNodeAncestors(textInsert.document, textInsert.nodeId, new Set())]).toEqual([
      document.screens[0]!.layout.content.id,
      carousel.id,
      pageStack.id,
    ])
  })
})
