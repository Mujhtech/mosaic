import { beforeEach, describe, expect, it } from "vitest";
import {
  LOCAL_PROJECT_STORAGE_KEY,
  MAX_LOCAL_PROJECT_BYTES,
  RETIRED_LOCAL_PROJECT_STORAGE_KEY,
} from "@/features/paywall-editor/constants/editor-constants";
import {
  createLocalProjectFile,
  isLocalProjectFile,
  mockCommerceState,
  parseImportedJson,
  readLocalMockPurchaseState,
  readLocalProjectResult,
  reconcileMockProductsForDocument,
  reconcileMockPurchaseState,
  serializeDocument,
  unavailableMockProductsForDocument,
  writeLocalProject,
} from "@/features/paywall-editor/mutations/local-project-file";
import type {
  LocalProjectFile,
  MockProductDefinition,
  MosaicDocument,
} from "@/features/paywall-editor/types/editor";
import { cloneValue } from "@/features/paywall-editor/utils/clone";
import { findNode } from "@/features/paywall-editor/utils/document-tree-traversal";
import { validateLocalProject } from "@/lib/mosaic-protocol";
import { required } from "@/test/required";
import canonicalFixture from "../../../../../../protocol/fixtures/v0.4/complete-paywall.json";

const canonicalDocument = canonicalFixture as MosaicDocument;

function semanticInvalidDocument(document: MosaicDocument) {
  const invalid = cloneValue(document);
  const selector = findNode(invalid, "plans");
  if (selector?.type !== "productSelector") {
    throw new Error("Canonical fixture is missing its product selector");
  }
  selector.initialProductCardId = "missing-card";
  return invalid;
}

function project(document: MosaicDocument = canonicalDocument) {
  return createLocalProjectFile({
    editableDocumentId: "document_test_project",
    document,
    locale: "en",
    textScale: 1,
    mockPurchaseState: "productAvailable",
    localRevisionSequence: 7,
  });
}

describe("local project import and export", () => {
  beforeEach(() => window.localStorage.clear());

  it("round-trips the canonical paywall fixture as portable JSON", () => {
    const exported = serializeDocument(canonicalDocument);
    expect(exported.endsWith("\n")).toBe(true);
    expect(JSON.parse(exported)).toEqual(canonicalFixture);

    const imported = parseImportedJson(exported);
    expect(imported.project).toBeNull();
    expect(imported.document).toEqual(canonicalFixture);
  });

  it("rejects the autosave-only local project wrapper as a portable import", () => {
    const localProject = project();
    expect(() => parseImportedJson(JSON.stringify(localProject))).toThrow(
      /Local autosaves can only be resumed from this browser/i
    );
  });

  it("rejects malformed JSON, schema additions, and semantic contract failures", () => {
    expect(() => parseImportedJson("{")).toThrow(/not valid JSON/i);

    const schemaInvalid = {
      ...cloneValue(canonicalDocument),
      unsupported: true,
    };
    expect(() => parseImportedJson(JSON.stringify(schemaInvalid))).toThrow(
      /not supported/i
    );

    const semanticInvalid = semanticInvalidDocument(canonicalDocument);
    expect(() => parseImportedJson(JSON.stringify(semanticInvalid))).toThrow();
    expect(() => serializeDocument(semanticInvalid)).toThrow();
  });

  it("derives safe unavailable mocks for non-template product identifiers", () => {
    const importedDocument = cloneValue(canonicalDocument);
    importedDocument.products[0] = {
      ...required(importedDocument.products[0], "importedDocument.products[0]"),
      id: "starter-plan",
    };
    importedDocument.products[1] = {
      ...required(importedDocument.products[1], "importedDocument.products[1]"),
      id: "pro-plan",
    };
    const selector = required(
      importedDocument.screens[0],
      "importedDocument.screens[0]"
    ).layout.content.children.find((node) => node.type === "productSelector");
    if (selector?.type !== "productSelector") {
      throw new Error("Canonical fixture is missing its selector");
    }
    required(selector.cards[0], "selector.cards[0]").productReferenceId =
      "starter-plan";
    required(selector.cards[1], "selector.cards[1]").productReferenceId =
      "pro-plan";
    selector.initialProductCardId = required(
      selector.cards[1],
      "selector.cards[1]"
    ).id;

    const imported = parseImportedJson(JSON.stringify(importedDocument));
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
    ]);
  });

  it("enforces the frozen one-megabyte import limit before parsing", () => {
    const oversized = `{"value":"${"x".repeat(MAX_LOCAL_PROJECT_BYTES)}"}`;
    expect(() => parseImportedJson(oversized)).toThrow(
      "Choose a Mosaic file under 1 MB."
    );
  });

  it("restores valid autosaves and distinguishes recoverable drafts from corruption", () => {
    const valid = project();
    expect(writeLocalProject(valid)).toBe(true);
    expect(readLocalProjectResult()).toEqual({
      status: "valid",
      project: valid,
    });

    const unfinished = cloneValue(valid);
    unfinished.document = semanticInvalidDocument(unfinished.document);
    window.localStorage.setItem(
      LOCAL_PROJECT_STORAGE_KEY,
      JSON.stringify(unfinished)
    );
    expect(readLocalProjectResult()).toMatchObject({
      status: "recoverable",
      project: unfinished as LocalProjectFile,
    });

    window.localStorage.setItem(LOCAL_PROJECT_STORAGE_KEY, "not-json");
    expect(readLocalProjectResult()).toMatchObject({ status: "corrupt" });

    window.localStorage.setItem(
      LOCAL_PROJECT_STORAGE_KEY,
      JSON.stringify({ fileFormatVersion: "0.4", document: {} })
    );
    expect(readLocalProjectResult()).toMatchObject({ status: "corrupt" });
  });

  it("persists explicit restore presets beside the canonical local project", () => {
    const valid = project();
    expect(writeLocalProject(valid, "restoreNoPurchases")).toBe(true);
    expect(readLocalMockPurchaseState(valid)).toBe("restoreNoPurchases");

    expect(mockCommerceState("restoreNoPurchases").restoreOutcome).toBe(
      "restoreNoPurchases"
    );
    expect(mockCommerceState("restoreFailure").restoreOutcome).toBe(
      "restoreFailed"
    );
  });

  it("reconciles mock bindings to the active document product identifiers", () => {
    const current: MockProductDefinition[] = [
      {
        productReferenceId: "imported-plan",
        availability: "unavailable",
        reason: "notConfigured",
      },
    ];
    expect(
      reconcileMockProductsForDocument(canonicalDocument, current)
    ).toEqual([
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
    ]);
    expect(reconcileMockPurchaseState("alreadyEntitled", current)).toBe(
      "productUnavailable"
    );
    expect(mockCommerceState("alreadyEntitled", []).entitlement).toEqual({
      status: "none",
    });
  });

  // Protocol 0.4 replaced 0.3 outright, so a 0.3 autosave is unreadable rather
  // than recoverable. Reporting it as empty would look like the author's work
  // was never saved, and reporting it as recoverable would promise a resume
  // that cannot happen; both hide a hard cutover behind a shrug.
  it("rejects a retired Protocol 0.3 autosave by naming the version", () => {
    window.localStorage.setItem(
      RETIRED_LOCAL_PROJECT_STORAGE_KEY,
      JSON.stringify({
        fileFormatVersion: "0.3",
        document: { schemaVersion: "0.3" },
      })
    );
    const retired = readLocalProjectResult();
    expect(retired.status).toBe("corrupt");
    expect(retired.status === "corrupt" && retired.message).toContain("0.3");
    expect(retired.status === "corrupt" && retired.message).toContain(
      "no migration path"
    );

    window.localStorage.setItem(
      LOCAL_PROJECT_STORAGE_KEY,
      JSON.stringify({
        fileFormatVersion: "0.3",
        document: { schemaVersion: "0.3" },
      })
    );
    const underCurrentKey = readLocalProjectResult();
    expect(underCurrentKey.status).toBe("corrupt");
    expect(
      underCurrentKey.status === "corrupt" && underCurrentKey.message
    ).toContain("Protocol 0.4 replaced 0.3");
  });

  it("rejects an imported Protocol 0.3 document by naming the version", () => {
    const retired = { ...cloneValue(canonicalDocument), schemaVersion: "0.3" };
    expect(() => parseImportedJson(JSON.stringify(retired))).toThrow(
      /Protocol 0\.3/
    );
  });
  /**
   * A .mosaic file's `fileFormatVersion` is the version `validateLocalProject`
   * checks, so a document saved under any other file version is refused on
   * reopen. The realistic failure is a designer saving and being unable to
   * open their own file.
   */
  it("saves a document as a 0.4 local project and reopens it", () => {
    const saved = project();

    expect(saved.fileFormatVersion).toBe("0.4");
    expect(validateLocalProject(saved).diagnostics).toEqual([]);
    expect(validateLocalProject(saved).ok).toBe(true);
    expect(isLocalProjectFile(saved)).toBe(true);
  });
});
