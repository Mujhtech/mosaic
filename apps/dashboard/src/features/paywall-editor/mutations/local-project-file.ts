import Ajv2020 from "ajv/dist/2020.js";

import {
  DEFAULT_MOCK_PRODUCTS,
  LOCAL_EDITOR_UI_STORAGE_KEY,
  LOCAL_PROJECT_STORAGE_KEY,
  MAX_LOCAL_PROJECT_BYTES,
  RETIRED_LOCAL_PROJECT_STORAGE_KEY,
} from "@/features/paywall-editor/constants/editor-constants";
import type {
  LocalProjectFile,
  MockCommerceState,
  MockProductDefinition,
  MockPurchaseState,
  MosaicDocument,
} from "@/features/paywall-editor/types/editor";
import { cloneValue } from "@/features/paywall-editor/utils/clone";
import { documentSchemaVersion } from "@/features/paywall-editor/utils/document-version";
import {
  canonicalSchemasByVersion,
  localPreviewContractVersion,
  localPreviewContractVersions,
  localPreviewV04ContractVersion,
  parsePortablePaywallJson,
  serializePortablePaywallJson,
  validateLocalProject,
  validatePaywallDocument,
} from "@/lib/mosaic-protocol";

const recoverableProjectValidators = new Map<
  string,
  ReturnType<Ajv2020["compile"]>
>();

/**
 * Whether a value is shaped like a local project, ignoring semantic rules.
 *
 * This is the "recoverable draft" check: a file that matches the schema but
 * fails a semantic rule is offered back to the author rather than discarded.
 * It has to compile the schema for the version the file claims -- validating a
 * 0.4 file against the 0.3 local-project schema fails on the document's
 * `schemaVersion` const, which would report a recoverable 0.4 draft as
 * corruption and lose it.
 */
function isRecoverableLocalProject(value: unknown): value is LocalProjectFile {
  const version =
    isRecord(value) &&
    value.fileFormatVersion === localPreviewV04ContractVersion
      ? localPreviewV04ContractVersion
      : localPreviewContractVersion;
  let validate = recoverableProjectValidators.get(version);
  if (!validate) {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const schemas = canonicalSchemasByVersion[version];
    ajv.addSchema(schemas.paywall);
    ajv.addSchema(schemas.previewMessage);
    validate = ajv.compile(schemas.localProject);
    recoverableProjectValidators.set(version, validate);
  }
  return validate(value) as boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function localRevision(document: MosaicDocument, sequence = document.revision) {
  return {
    revisionId: `revision_${document.id}_${sequence}`,
    sequence,
  };
}

export function createEditableDocumentId() {
  const random = globalThis.crypto?.randomUUID?.().replaceAll("-", "_");
  return `document_${random ?? `${Date.now()}_${Math.round(Math.random() * 1_000_000)}`}`;
}

export function unavailableMockProductsForDocument(
  document: MosaicDocument
): MockProductDefinition[] {
  return document.products.map((product) => ({
    productReferenceId: product.id,
    availability: "unavailable",
    reason: "notConfigured",
  }));
}

export function reconcileMockProductsForDocument(
  document: MosaicDocument,
  products: readonly MockProductDefinition[]
): MockProductDefinition[] {
  return document.products.map(
    (reference) =>
      products.find(
        (product) => product.productReferenceId === reference.id
      ) ?? {
        productReferenceId: reference.id,
        availability: "unavailable",
        reason: "notConfigured",
      }
  );
}

export function reconcileMockPurchaseState(
  preset: MockPurchaseState,
  products: readonly MockProductDefinition[]
): MockPurchaseState {
  return preset === "alreadyEntitled" &&
    !products.some((product) => product.availability === "available")
    ? "productUnavailable"
    : preset;
}

export function mockCommerceState(
  preset: MockPurchaseState,
  products: readonly MockProductDefinition[] = DEFAULT_MOCK_PRODUCTS
): MockCommerceState {
  const selectedProduct = products.find(
    (product) => product.availability === "available"
  );
  const selectedId =
    selectedProduct?.productReferenceId ?? products[0]?.productReferenceId;
  const unavailableProducts: MockProductDefinition[] = products.map(
    (product) => ({
      productReferenceId: product.productReferenceId,
      availability: "unavailable",
      reason: "temporarilyUnavailable",
    })
  );

  return {
    products:
      preset === "productUnavailable"
        ? unavailableProducts
        : cloneValue([...products]),
    purchaseOutcome: (() => {
      if (preset === "alreadyEntitled") {
        return "alreadyEntitled";
      }
      if (preset === "purchaseCancellation") {
        return "cancelled";
      }
      if (preset === "purchaseFailure") {
        return "purchaseFailed";
      }
      return "purchased";
    })(),
    restoreOutcome: (() => {
      if (preset === "alreadyEntitled") {
        return "alreadyEntitled";
      }
      if (preset === "restoreSuccess") {
        return "restored";
      }
      if (preset === "restoreFailure") {
        return "restoreFailed";
      }
      return "restoreNoPurchases";
    })(),
    entitlement:
      preset === "alreadyEntitled" && selectedId
        ? { status: "active", productReferenceId: selectedId }
        : { status: "none" },
  };
}

export function createLocalProjectFile(options: {
  editableDocumentId: string;
  document: MosaicDocument;
  locale: string;
  textScale: number;
  mockPurchaseState: MockPurchaseState;
  mockProducts?: readonly MockProductDefinition[];
  localRevisionSequence?: number;
}): LocalProjectFile {
  const revision = localRevision(
    options.document,
    options.localRevisionSequence
  );
  const products = reconcileMockProductsForDocument(
    options.document,
    options.mockProducts ?? DEFAULT_MOCK_PRODUCTS
  );
  // The local project file version tracks the document it carries: a 0.4 draft
  // is only readable by a Local Preview 0.4 client, and `validateLocalProject`
  // dispatches on exactly this member. `LocalProjectFile` is discriminated on
  // it, and the pairing of a computed version with a union-typed document is
  // the correlation TypeScript cannot follow, so the branch is named once here.
  return {
    fileFormatVersion: documentSchemaVersion(options.document),
    editableDocumentId: options.editableDocumentId,
    revision,
    document: cloneValue(options.document),
    preview: { locale: options.locale, textScale: options.textScale },
    mockCommerce: {
      revision,
      state: mockCommerceState(options.mockPurchaseState, products),
    },
  } as LocalProjectFile;
}

export function isLocalProjectFile(value: unknown): value is LocalProjectFile {
  const result = validateLocalProject(value);
  return (
    result.ok &&
    (localPreviewContractVersions as readonly string[]).includes(
      result.value.fileFormatVersion
    )
  );
}

function importFailure(
  diagnostics: readonly {
    message: string;
    recovery: { message: string };
  }[]
) {
  const [first] = diagnostics;
  return first
    ? `${first.message} ${first.recovery.message}`
    : "Import a valid Mosaic Protocol document or local project file.";
}

export function parseImportedJson(json: string): {
  document: MosaicDocument;
  project: null;
} {
  const documentResult = parsePortablePaywallJson(json, {
    maxDocumentBytes: MAX_LOCAL_PROJECT_BYTES,
  });
  if (documentResult.ok) {
    const document = documentResult.value as MosaicDocument;
    const validatedResult = validatePaywallDocument(document);
    if (!validatedResult.ok) {
      throw new Error(importFailure(validatedResult.diagnostics));
    }
    return {
      document: cloneValue(document),
      project: null,
    };
  }
  const documentCode = documentResult.diagnostics[0]?.code;
  if (
    documentCode === "validation.documentTooLarge" ||
    documentCode === "validation.invalidJson"
  ) {
    throw new Error(
      documentCode === "validation.documentTooLarge"
        ? "Choose a Mosaic file under 1 MB."
        : importFailure(documentResult.diagnostics)
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error("The selected file is not valid JSON.", { cause: error });
  }

  if (validateLocalProject(parsed).ok) {
    throw new Error(
      "Import a raw Mosaic paywall JSON file. Local autosaves can only be resumed from this browser."
    );
  }
  const retiredVersion = retiredAutosaveVersion(
    parsed && typeof parsed === "object" && "schemaVersion" in parsed
      ? { document: parsed }
      : parsed
  );
  if (retiredVersion) {
    throw new Error(
      `This file declares Mosaic Paywall Protocol ${retiredVersion}, which this Studio does not support. Protocol 0.3 replaced ${retiredVersion} and there is no migration path. Export the paywall again from a Protocol 0.3 Studio.`
    );
  }
  throw new Error(importFailure(documentResult.diagnostics));
}

export function writeLocalProject(
  project: LocalProjectFile,
  preset?: MockPurchaseState
) {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    window.localStorage.setItem(
      LOCAL_PROJECT_STORAGE_KEY,
      JSON.stringify(project)
    );
    if (preset) {
      window.localStorage.setItem(
        LOCAL_EDITOR_UI_STORAGE_KEY,
        JSON.stringify({
          editableDocumentId: project.editableDocumentId,
          mockPurchaseState: preset,
        })
      );
    }
    return true;
  } catch {
    return false;
  }
}

const MOCK_PURCHASE_PRESETS = new Set<MockPurchaseState>([
  "productAvailable",
  "productUnavailable",
  "purchaseSuccess",
  "purchaseCancellation",
  "purchaseFailure",
  "restoreSuccess",
  "restoreNoPurchases",
  "restoreFailure",
  "alreadyEntitled",
]);

export function readLocalMockPurchaseState(
  project: LocalProjectFile
): MockPurchaseState | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const stored = window.localStorage.getItem(LOCAL_EDITOR_UI_STORAGE_KEY);
    if (!stored) {
      return null;
    }
    const parsed = JSON.parse(stored) as Record<string, unknown>;
    return parsed.editableDocumentId === project.editableDocumentId &&
      typeof parsed.mockPurchaseState === "string" &&
      MOCK_PURCHASE_PRESETS.has(parsed.mockPurchaseState as MockPurchaseState)
      ? (parsed.mockPurchaseState as MockPurchaseState)
      : null;
  } catch {
    return null;
  }
}

/**
 * The 0.3 storage key is deliberately distinct from the retired 0.2 one, so a
 * 0.2 autosave is not read as an empty editor. It is reported, then left in
 * place: this read path does not delete an author's only copy of their work.
 */
function readRetiredLocalProject(): LocalProjectReadResult | null {
  const stored = window.localStorage.getItem(RETIRED_LOCAL_PROJECT_STORAGE_KEY);
  if (!stored) {
    return null;
  }
  let version = "0.2";
  try {
    version = retiredAutosaveVersion(JSON.parse(stored) as unknown) ?? version;
  } catch {
    // An unparseable retired autosave is still a retired autosave; the key it
    // was written under already names the protocol version.
  }
  return {
    status: "corrupt",
    message: retiredProtocolAutosaveMessage(version),
  };
}

export type LocalProjectReadResult =
  | { status: "empty" }
  | { status: "valid"; project: LocalProjectFile }
  | { status: "recoverable"; project: LocalProjectFile; message: string }
  | { status: "corrupt"; message: string };

/**
 * Protocol 0.3 replaces 0.2 outright: there is no migration path and no
 * compatibility shim, so a 0.2 autosave is an unreadable document rather than
 * a recoverable one. Studio names the version it found instead of discarding
 * the entry quietly or presenting it as recoverable, because an author whose
 * work vanished is owed the reason.
 */
export function retiredProtocolAutosaveMessage(version: string) {
  return `This autosave was written for Mosaic Paywall Protocol ${version}, which this Studio does not support. Protocol 0.3 replaced ${version} and there is no migration path. Your current editor remains unchanged; start from a template or import a Protocol 0.3 file.`;
}

function retiredAutosaveVersion(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const { document, fileFormatVersion } = value as Record<string, unknown>;
  if (typeof fileFormatVersion === "string" && fileFormatVersion !== "0.3") {
    return fileFormatVersion;
  }
  if (document && typeof document === "object") {
    const { schemaVersion } = document as Record<string, unknown>;
    if (typeof schemaVersion === "string" && schemaVersion !== "0.3") {
      return schemaVersion;
    }
  }
  return null;
}

export function readLocalProjectResult(): LocalProjectReadResult {
  if (typeof window === "undefined") {
    return { status: "empty" };
  }
  try {
    const stored = window.localStorage.getItem(LOCAL_PROJECT_STORAGE_KEY);
    const retired = readRetiredLocalProject();
    if (!stored) {
      return retired ?? { status: "empty" };
    }
    const parsed: unknown = JSON.parse(stored);
    if (isLocalProjectFile(parsed)) {
      return { status: "valid", project: parsed };
    }
    const retiredVersion = retiredAutosaveVersion(parsed);
    if (retiredVersion) {
      return {
        status: "corrupt",
        message: retiredProtocolAutosaveMessage(retiredVersion),
      };
    }
    if (isRecoverableLocalProject(parsed)) {
      return {
        status: "recoverable",
        project: parsed,
        message:
          "This autosave contains unfinished validation issues. Resume it to keep editing; native preview and export stay paused until those issues are fixed.",
      };
    }
    return {
      status: "corrupt",
      message:
        "The autosave does not match the Mosaic local-project 0.3 contract. Your current editor remains unchanged.",
    };
  } catch {
    return {
      status: "corrupt",
      message:
        "The autosave could not be read. Your current editor remains unchanged; import a known-good file or start from a template.",
    };
  }
}

export function serializeDocument(document: MosaicDocument) {
  const result = serializePortablePaywallJson(document);
  if (!result.ok) {
    throw new Error(importFailure(result.diagnostics));
  }
  return result.value;
}
