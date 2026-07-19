import Ajv2020 from "ajv/dist/2020.js"

import {
  DEFAULT_MOCK_PRODUCTS,
  LOCAL_EDITOR_UI_STORAGE_KEY,
  LOCAL_PROJECT_STORAGE_KEY,
  MAX_LOCAL_PROJECT_BYTES,
} from "@/features/paywall-editor/constants/editor-constants"
import type {
  LocalProjectFile,
  MockCommerceState,
  MockProductDefinition,
  MockPurchaseState,
  MosaicDocument,
} from "@/features/paywall-editor/types/editor"
import { cloneValue } from "@/features/paywall-editor/utils/clone"
import {
  canonicalSchemasByVersion,
  migrateV02RC2CandidateToRC3,
  migrateV02RC3CandidateToRC4,
  parsePortablePaywallJson,
  serializePortablePaywallJson,
  validateLocalProject,
  validatePaywallDocument,
} from "@/lib/mosaic-protocol"
import type {
  MosaicPaywallV02RC2Candidate,
  MosaicPaywallV02RC3Candidate,
} from "@/lib/mosaic-protocol"

function containsRC2ProductSelector(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsRC2ProductSelector)
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  if (
    record.type === "productSelector" &&
    Array.isArray(record.productReferenceIds) &&
    record.cardStyles !== undefined
  ) {
    return true
  }
  return Object.values(record).some(containsRC2ProductSelector)
}

function migrateLegacyV02Document(value: unknown): MosaicDocument | null {
  if (
    !value ||
    typeof value !== "object" ||
    (value as Record<string, unknown>).schemaVersion !== "0.2"
  ) {
    return null
  }
  try {
    const rc3 = containsRC2ProductSelector(value)
      ? migrateV02RC2CandidateToRC3(value as MosaicPaywallV02RC2Candidate).document
      : value
    const migrated = migrateV02RC3CandidateToRC4(rc3 as MosaicPaywallV02RC3Candidate).document
    const validation = validatePaywallDocument(migrated)
    return validation.ok ? (cloneValue(validation.value) as MosaicDocument) : null
  } catch {
    return null
  }
}

let validateRecoverableProject: ReturnType<Ajv2020["compile"]> | null = null

function isRecoverableLocalProject(value: unknown): value is LocalProjectFile {
  if (!validateRecoverableProject) {
    const ajv = new Ajv2020({ allErrors: true, strict: true })
    const schemas = canonicalSchemasByVersion["0.2"]
    ajv.addSchema(schemas.paywall)
    ajv.addSchema(schemas.previewMessage)
    validateRecoverableProject = ajv.compile(schemas.localProject)
  }
  return validateRecoverableProject(value) as boolean
}

function localRevision(document: MosaicDocument, sequence = document.revision) {
  return {
    revisionId: `revision_${document.id}_${sequence}`,
    sequence,
  }
}

export function createEditableDocumentId() {
  const random = globalThis.crypto?.randomUUID?.().replaceAll("-", "_")
  return `document_${random ?? `${Date.now()}_${Math.round(Math.random() * 1_000_000)}`}`
}

export function unavailableMockProductsForDocument(
  document: MosaicDocument,
): MockProductDefinition[] {
  return document.products.map((product) => ({
    productReferenceId: product.id,
    availability: "unavailable",
    reason: "notConfigured",
  }))
}

export function reconcileMockProductsForDocument(
  document: MosaicDocument,
  products: readonly MockProductDefinition[],
): MockProductDefinition[] {
  return document.products.map(
    (reference) =>
      products.find((product) => product.productReferenceId === reference.id) ?? {
        productReferenceId: reference.id,
        availability: "unavailable",
        reason: "notConfigured",
      },
  )
}

export function reconcileMockPurchaseState(
  preset: MockPurchaseState,
  products: readonly MockProductDefinition[],
): MockPurchaseState {
  return preset === "alreadyEntitled" &&
    !products.some((product) => product.availability === "available")
    ? "productUnavailable"
    : preset
}

export function mockCommerceState(
  preset: MockPurchaseState,
  products: readonly MockProductDefinition[] = DEFAULT_MOCK_PRODUCTS,
): MockCommerceState {
  const selectedProduct = products.find((product) => product.availability === "available")
  const selectedId = selectedProduct?.productReferenceId ?? products[0]?.productReferenceId
  const unavailableProducts: MockProductDefinition[] = products.map((product) => ({
    productReferenceId: product.productReferenceId,
    availability: "unavailable",
    reason: "temporarilyUnavailable",
  }))

  return {
    products: preset === "productUnavailable" ? unavailableProducts : cloneValue([...products]),
    purchaseOutcome:
      preset === "alreadyEntitled"
        ? "alreadyEntitled"
        : preset === "purchaseCancellation"
          ? "cancelled"
          : preset === "purchaseFailure"
            ? "purchaseFailed"
            : "purchased",
    restoreOutcome:
      preset === "alreadyEntitled"
        ? "alreadyEntitled"
        : preset === "restoreSuccess"
          ? "restored"
          : preset === "restoreFailure"
            ? "restoreFailed"
            : "restoreNoPurchases",
    entitlement:
      preset === "alreadyEntitled" && selectedId
        ? { status: "active", productReferenceId: selectedId }
        : { status: "none" },
  }
}

export function createLocalProjectFile(options: {
  editableDocumentId: string
  document: MosaicDocument
  locale: string
  textScale: number
  mockPurchaseState: MockPurchaseState
  mockProducts?: readonly MockProductDefinition[]
  localRevisionSequence?: number
}): LocalProjectFile {
  const revision = localRevision(options.document, options.localRevisionSequence)
  const products = reconcileMockProductsForDocument(
    options.document,
    options.mockProducts ?? DEFAULT_MOCK_PRODUCTS,
  )
  return {
    fileFormatVersion: "0.2",
    editableDocumentId: options.editableDocumentId,
    revision,
    document: cloneValue(options.document),
    preview: { locale: options.locale, textScale: options.textScale },
    mockCommerce: {
      revision,
      state: mockCommerceState(options.mockPurchaseState, products),
    },
  }
}

export function isLocalProjectFile(value: unknown): value is LocalProjectFile {
  const result = validateLocalProject(value)
  return result.ok && result.value.fileFormatVersion === "0.2"
}

function importFailure(
  diagnostics: readonly {
    message: string
    recovery: { message: string }
  }[],
) {
  const first = diagnostics[0]
  return first
    ? `${first.message} ${first.recovery.message}`
    : "Import a valid Mosaic Protocol document or local project file."
}

export function parseImportedJson(json: string): {
  document: MosaicDocument
  project: null
} {
  const documentResult = parsePortablePaywallJson(json, {
    maxDocumentBytes: MAX_LOCAL_PROJECT_BYTES,
  })
  if (documentResult.ok) {
    const document = documentResult.value as MosaicDocument
    const validatedResult = validatePaywallDocument(document)
    if (!validatedResult.ok) throw new Error(importFailure(validatedResult.diagnostics))
    return {
      document: cloneValue(document),
      project: null,
    }
  }
  const documentCode = documentResult.diagnostics[0]?.code
  if (documentCode === "validation.documentTooLarge" || documentCode === "validation.invalidJson") {
    throw new Error(
      documentCode === "validation.documentTooLarge"
        ? "Choose a Mosaic file under 1 MB."
        : importFailure(documentResult.diagnostics),
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error("The selected file is not valid JSON.")
  }

  if (validateLocalProject(parsed).ok) {
    throw new Error(
      "Import a raw Mosaic paywall JSON file. Local autosaves can only be resumed from this browser.",
    )
  }
  const migratedV02 = migrateLegacyV02Document(parsed)
  if (migratedV02) return { document: migratedV02, project: null }
  throw new Error(importFailure(documentResult.diagnostics))
}

export function writeLocalProject(project: LocalProjectFile, preset?: MockPurchaseState) {
  if (typeof window === "undefined") return false
  try {
    window.localStorage.setItem(LOCAL_PROJECT_STORAGE_KEY, JSON.stringify(project))
    if (preset) {
      window.localStorage.setItem(
        LOCAL_EDITOR_UI_STORAGE_KEY,
        JSON.stringify({
          editableDocumentId: project.editableDocumentId,
          mockPurchaseState: preset,
        }),
      )
    }
    return true
  } catch {
    return false
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
])

export function readLocalMockPurchaseState(project: LocalProjectFile): MockPurchaseState | null {
  if (typeof window === "undefined") return null
  try {
    const stored = window.localStorage.getItem(LOCAL_EDITOR_UI_STORAGE_KEY)
    if (!stored) return null
    const parsed = JSON.parse(stored) as Record<string, unknown>
    return parsed.editableDocumentId === project.editableDocumentId &&
      typeof parsed.mockPurchaseState === "string" &&
      MOCK_PURCHASE_PRESETS.has(parsed.mockPurchaseState as MockPurchaseState)
      ? (parsed.mockPurchaseState as MockPurchaseState)
      : null
  } catch {
    return null
  }
}

export type LocalProjectReadResult =
  | { status: "empty" }
  | { status: "valid"; project: LocalProjectFile }
  | { status: "recoverable"; project: LocalProjectFile; message: string }
  | { status: "corrupt"; message: string }

export function readLocalProjectResult(): LocalProjectReadResult {
  if (typeof window === "undefined") return { status: "empty" }
  try {
    const stored = window.localStorage.getItem(LOCAL_PROJECT_STORAGE_KEY)
    if (!stored) return { status: "empty" }
    const parsed: unknown = JSON.parse(stored)
    if (isLocalProjectFile(parsed)) return { status: "valid", project: parsed }
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>
      const migratedDocument = migrateLegacyV02Document(record.document)
      if (record.fileFormatVersion === "0.2" && migratedDocument) {
        const migratedProject = { ...record, document: migratedDocument }
        const validation = validateLocalProject(migratedProject)
        if (validation.ok) {
          return {
            status: "valid",
            project: cloneValue(validation.value) as LocalProjectFile,
          }
        }
      }
    }
    if (isRecoverableLocalProject(parsed)) {
      return {
        status: "recoverable",
        project: parsed,
        message:
          "This autosave contains unfinished validation issues. Resume it to keep editing; native preview and export stay paused until those issues are fixed.",
      }
    }
    return {
      status: "corrupt",
      message:
        "The autosave does not match the Mosaic local-project 0.2 contract. Your current editor remains unchanged.",
    }
  } catch {
    return {
      status: "corrupt",
      message:
        "The autosave could not be read. Your current editor remains unchanged; import a known-good file or start from a template.",
    }
  }
}

export function serializeDocument(document: MosaicDocument) {
  const result = serializePortablePaywallJson(document)
  if (!result.ok) throw new Error(importFailure(result.diagnostics))
  return result.value
}
