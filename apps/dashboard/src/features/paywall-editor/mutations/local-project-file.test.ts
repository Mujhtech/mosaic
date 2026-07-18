import { beforeEach, describe, expect, it } from "vitest"

import canonicalFixture from "../../../../../../protocol/fixtures/v0.2/complete-paywall.json"

import {
  LOCAL_PROJECT_STORAGE_KEY,
  MAX_LOCAL_PROJECT_BYTES,
} from "@/features/paywall-editor/constants/editor-constants"
import {
  createLocalProjectFile,
  mockCommerceState,
  parseImportedJson,
  readLocalMockPurchaseState,
  readLocalProjectResult,
  reconcileMockPurchaseState,
  reconcileMockProductsForDocument,
  serializeDocument,
  unavailableMockProductsForDocument,
  writeLocalProject,
} from "@/features/paywall-editor/mutations/local-project-file"
import type {
  LocalProjectFile,
  MockProductDefinition,
  MosaicDocument,
} from "@/features/paywall-editor/types/editor"
import { cloneValue } from "@/features/paywall-editor/utils/clone"
import { findNode } from "@/features/paywall-editor/utils/document-tree"

const canonicalDocument = canonicalFixture as MosaicDocument

function semanticInvalidDocument(document: MosaicDocument) {
  const invalid = cloneValue(document)
  const selector = findNode(invalid, "plans")
  if (!selector || selector.type !== "productSelector") {
    throw new Error("Canonical fixture is missing its product selector")
  }
  selector.initialProductCardId = "missing-card"
  return invalid
}

function rc2CandidateDocument(document: MosaicDocument) {
  const candidate = cloneValue(document)
  const selector = findNode(candidate, "plans")
  if (!selector || selector.type !== "productSelector") {
    throw new Error("Canonical fixture is missing its product selector")
  }
  const initialCard = selector.cards.find((card) => card.id === selector.initialProductCardId)
  if (!initialCard) throw new Error("Canonical fixture is missing its initial Product Card")

  const rc2Selector = selector as unknown as Record<string, unknown>
  const yearlyProduct = candidate.products.find((product) => product.id === "yearly-plan")
  const lifetimeProduct = candidate.products.find((product) => product.id === "lifetime-plan")
  if (!yearlyProduct || !lifetimeProduct) {
    throw new Error("Canonical fixture is missing its badged products")
  }
  ;(yearlyProduct as unknown as Record<string, unknown>).badge = {
    default: "Best value",
    localizationKey: "paywall.products.best_value",
  }
  ;(lifetimeProduct as unknown as Record<string, unknown>).badge = {
    default: "Own it forever",
    localizationKey: "paywall.products.lifetime_badge",
  }
  for (const locale of Object.values(candidate.localization.locales)) {
    for (const key of Object.keys(locale.strings)) {
      if (
        key.startsWith("mosaic.migration.product_card_") ||
        key.endsWith("_name_template") ||
        key.endsWith("_price_template") ||
        key.endsWith("_accessibility_template")
      ) {
        delete locale.strings[key]
      }
    }
  }
  rc2Selector.productReferenceIds = selector.cards.map((card) => card.productReferenceId)
  rc2Selector.initiallySelectedProductReferenceId = initialCard.productReferenceId
  rc2Selector.cardStyles = {
    default: {
      background: "surface.elevated",
      border: { color: "border.default", width: 1 },
      cornerRadius: 12,
      padding: { top: 12, start: 12, bottom: 12, end: 12 },
      contentGap: 8,
      contentAlignment: "spaceBetween",
      productLabelColor: "text.primary",
      runtimePriceColor: "text.secondary",
      badge: {
        background: "surface.default",
        textColor: "text.primary",
        border: { color: "border.default", width: 1 },
        cornerRadius: 999,
        padding: { top: 4, start: 8, bottom: 4, end: 8 },
      },
    },
    selected: {
      background: "surface.default",
      border: { color: "action.primary", width: 2 },
    },
  }
  delete rc2Selector.cards
  delete rc2Selector.initialProductCardId
  delete rc2Selector.crossAxisAlignment
  return candidate as unknown
}

function project(document: MosaicDocument = canonicalDocument) {
  return createLocalProjectFile({
    editableDocumentId: "document_test_project",
    document,
    locale: "en",
    textScale: 1,
    mockPurchaseState: "productAvailable",
    localRevisionSequence: 7,
  })
}

describe("local project import and export", () => {
  beforeEach(() => window.localStorage.clear())

  it("round-trips the canonical paywall fixture as portable JSON", () => {
    const exported = serializeDocument(canonicalDocument)
    expect(exported.endsWith("\n")).toBe(true)
    expect(JSON.parse(exported)).toEqual(canonicalFixture)

    const imported = parseImportedJson(exported)
    expect(imported.project).toBeNull()
    expect(imported.document).toEqual(canonicalFixture)
  })

  it("recovers superseded RC2 Product Selectors in raw imports and local autosaves", () => {
    const candidate = rc2CandidateDocument(canonicalDocument)
    const imported = parseImportedJson(JSON.stringify(candidate))
    const importedSelector = findNode(imported.document, "plans")
    expect(importedSelector?.type).toBe("productSelector")
    if (!importedSelector || importedSelector.type !== "productSelector") return
    expect(importedSelector.cards.map((card) => card.productReferenceId)).toEqual([
      "monthly-plan",
      "yearly-plan",
      "lifetime-plan",
    ])
    expect(
      importedSelector.cards.find((card) => card.id === importedSelector.initialProductCardId)
        ?.productReferenceId,
    ).toBe("yearly-plan")

    const autosave = project()
    ;(autosave as unknown as Record<string, unknown>).document = candidate
    window.localStorage.setItem(LOCAL_PROJECT_STORAGE_KEY, JSON.stringify(autosave))
    expect(readLocalProjectResult()).toMatchObject({
      status: "valid",
      project: { document: imported.document },
    })
  })

  it("rejects the autosave-only local project wrapper as a portable import", () => {
    const localProject = project()
    expect(() => parseImportedJson(JSON.stringify(localProject))).toThrow(
      /Local autosaves can only be resumed from this browser/i,
    )
  })

  it("rejects malformed JSON, schema additions, and semantic contract failures", () => {
    expect(() => parseImportedJson("{")).toThrow(/not valid JSON/i)

    const schemaInvalid = { ...cloneValue(canonicalDocument), unsupported: true }
    expect(() => parseImportedJson(JSON.stringify(schemaInvalid))).toThrow(/not supported/i)

    const semanticInvalid = semanticInvalidDocument(canonicalDocument)
    expect(() => parseImportedJson(JSON.stringify(semanticInvalid))).toThrow()
    expect(() => serializeDocument(semanticInvalid)).toThrow()
  })

  it("derives safe unavailable mocks for non-template product identifiers", () => {
    const importedDocument = cloneValue(canonicalDocument)
    importedDocument.products[0] = {
      ...importedDocument.products[0]!,
      id: "starter-plan",
    }
    importedDocument.products[1] = {
      ...importedDocument.products[1]!,
      id: "pro-plan",
    }
    const selector = importedDocument.screens[0]!.layout.content.children.find(
      (node) => node.type === "productSelector",
    )
    if (!selector || selector.type !== "productSelector") {
      throw new Error("Canonical fixture is missing its selector")
    }
    selector.cards[0]!.productReferenceId = "starter-plan"
    selector.cards[1]!.productReferenceId = "pro-plan"
    selector.initialProductCardId = selector.cards[1]!.id

    const imported = parseImportedJson(JSON.stringify(importedDocument))
    expect(unavailableMockProductsForDocument(imported.document)).toEqual([
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
      {
        productReferenceId: "lifetime-plan",
        availability: "unavailable",
        reason: "notConfigured",
      },
    ])
  })

  it("enforces the frozen one-megabyte import limit before parsing", () => {
    const oversized = `{"value":"${"x".repeat(MAX_LOCAL_PROJECT_BYTES)}"}`
    expect(() => parseImportedJson(oversized)).toThrow("Choose a Mosaic file under 1 MB.")
  })

  it("restores valid autosaves and distinguishes recoverable drafts from corruption", () => {
    const valid = project()
    expect(writeLocalProject(valid)).toBe(true)
    expect(readLocalProjectResult()).toEqual({ status: "valid", project: valid })

    const unfinished = cloneValue(valid)
    unfinished.document = semanticInvalidDocument(unfinished.document)
    window.localStorage.setItem(LOCAL_PROJECT_STORAGE_KEY, JSON.stringify(unfinished))
    expect(readLocalProjectResult()).toMatchObject({
      status: "recoverable",
      project: unfinished as LocalProjectFile,
    })

    window.localStorage.setItem(LOCAL_PROJECT_STORAGE_KEY, "not-json")
    expect(readLocalProjectResult()).toMatchObject({ status: "corrupt" })

    window.localStorage.setItem(
      LOCAL_PROJECT_STORAGE_KEY,
      JSON.stringify({ fileFormatVersion: "0.2", document: {} }),
    )
    expect(readLocalProjectResult()).toMatchObject({ status: "corrupt" })
  })

  it("persists explicit restore presets beside the canonical local project", () => {
    const valid = project()
    expect(writeLocalProject(valid, "restoreNoPurchases")).toBe(true)
    expect(readLocalMockPurchaseState(valid)).toBe("restoreNoPurchases")

    expect(mockCommerceState("restoreNoPurchases").restoreOutcome).toBe("restoreNoPurchases")
    expect(mockCommerceState("restoreFailure").restoreOutcome).toBe("restoreFailed")
  })

  it("reconciles mock bindings to the active document product identifiers", () => {
    const current: MockProductDefinition[] = [
      {
        productReferenceId: "imported-plan",
        availability: "unavailable",
        reason: "notConfigured",
      },
    ]
    expect(reconcileMockProductsForDocument(canonicalDocument, current)).toEqual([
      {
        productReferenceId: "monthly-plan",
        availability: "unavailable",
        reason: "notConfigured",
      },
      {
        productReferenceId: "yearly-plan",
        availability: "unavailable",
        reason: "notConfigured",
      },
      {
        productReferenceId: "lifetime-plan",
        availability: "unavailable",
        reason: "notConfigured",
      },
    ])
    expect(reconcileMockPurchaseState("alreadyEntitled", current)).toBe("productUnavailable")
    expect(mockCommerceState("alreadyEntitled", []).entitlement).toEqual({ status: "none" })
  })
})
