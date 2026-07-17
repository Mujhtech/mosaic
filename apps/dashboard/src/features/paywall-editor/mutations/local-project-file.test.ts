import { beforeEach, describe, expect, it } from "vitest"

import canonicalFixture from "../../../../../../protocol/fixtures/v0.1/complete-paywall.json"

import { MAX_LOCAL_PROJECT_BYTES } from "@/features/paywall-editor/constants/editor-constants"
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
  selector.initiallySelectedProductReferenceId = "missing-plan"
  return invalid
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
    const selector = importedDocument.layout.content.children.find(
      (node) => node.type === "productSelector",
    )
    if (!selector || selector.type !== "productSelector") {
      throw new Error("Canonical fixture is missing its selector")
    }
    selector.productReferenceIds = ["starter-plan", "pro-plan"]
    selector.initiallySelectedProductReferenceId = "pro-plan"

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
    window.localStorage.setItem("mosaic:local-project:v0.1", JSON.stringify(unfinished))
    expect(readLocalProjectResult()).toMatchObject({
      status: "recoverable",
      project: unfinished as LocalProjectFile,
    })

    window.localStorage.setItem("mosaic:local-project:v0.1", "not-json")
    expect(readLocalProjectResult()).toMatchObject({ status: "corrupt" })

    window.localStorage.setItem(
      "mosaic:local-project:v0.1",
      JSON.stringify({ fileFormatVersion: "0.1", document: {} }),
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
    ])
    expect(reconcileMockPurchaseState("alreadyEntitled", current)).toBe("productUnavailable")
    expect(mockCommerceState("alreadyEntitled", []).entitlement).toEqual({ status: "none" })
  })
})
