import { useEffect, useMemo, useState } from "react"

import { EditorShell } from "@/features/paywall-editor/components/editor-shell"
import { TemplateSelection } from "@/features/paywall-editor/components/template-selection"
import { DEFAULT_MOCK_PRODUCTS } from "@/features/paywall-editor/constants/editor-constants"
import { MAX_LOCAL_PROJECT_BYTES } from "@/features/paywall-editor/constants/editor-constants"
import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates"
import {
  createLocalProjectFile,
  parseImportedJson,
  readLocalMockPurchaseState,
  readLocalProjectResult,
  reconcileMockPurchaseState,
  reconcileMockProductsForDocument,
  type LocalProjectReadResult,
  unavailableMockProductsForDocument,
  writeLocalProject,
} from "@/features/paywall-editor/mutations/local-project-file"
import {
  EditorStoreProvider,
  useEditorActions,
  useEditorStore,
} from "@/features/paywall-editor/stores/editor-store-context"
import type {
  LocalProjectFile,
  MockProductDefinition,
  MockPurchaseState,
} from "@/features/paywall-editor/types/editor"
import { cloneValue } from "@/features/paywall-editor/utils/clone"

function presetForProject(project: LocalProjectFile): MockPurchaseState {
  if (
    project.mockCommerce.state.products.every((product) => product.availability === "unavailable")
  ) {
    return "productUnavailable"
  }
  switch (project.mockCommerce.state.purchaseOutcome) {
    case "alreadyEntitled":
      return "alreadyEntitled"
    case "cancelled":
      return "purchaseCancellation"
    case "purchaseFailed":
      return "purchaseFailure"
    case "purchased":
      return project.mockCommerce.state.restoreOutcome === "restored"
        ? "restoreSuccess"
        : project.mockCommerce.state.restoreOutcome === "restoreFailed"
          ? "restoreFailure"
          : "purchaseSuccess"
  }
}

function WorkspaceContent() {
  const { document, editableDocumentId, currentLocale, localRevisionSequence, textScale } =
    useEditorStore()
  const { loadTemplate, replaceDocument, restoreProject, importDocument, resetEditor } =
    useEditorActions()
  const [autosave, setAutosave] = useState<LocalProjectReadResult>({ status: "empty" })
  const [importError, setImportError] = useState<string | null>(null)
  const [mockProducts, setMockProducts] = useState<MockProductDefinition[]>(() =>
    cloneValue([...DEFAULT_MOCK_PRODUCTS]),
  )
  const [mockPurchaseState, setMockPurchaseState] = useState<MockPurchaseState>("productAvailable")
  const activeMockProducts = useMemo(
    () => (document ? reconcileMockProductsForDocument(document, mockProducts) : mockProducts),
    [document, mockProducts],
  )
  const activeMockPurchaseState = reconcileMockPurchaseState(mockPurchaseState, activeMockProducts)

  useEffect(() => {
    const timer = window.setTimeout(() => setAutosave(readLocalProjectResult()), 0)
    return () => window.clearTimeout(timer)
  }, [])

  function applyProject(project: LocalProjectFile) {
    restoreProject(
      project.document,
      project.editableDocumentId,
      project.revision.sequence,
      project.preview.locale,
      project.preview.textScale,
    )
    setMockProducts(cloneValue(project.mockCommerce.state.products))
    setMockPurchaseState(readLocalMockPurchaseState(project) ?? presetForProject(project))
  }

  async function importFile(file: File) {
    try {
      if (file.size > MAX_LOCAL_PROJECT_BYTES) {
        throw new Error("Choose a Mosaic file under 1 MB.")
      }
      const imported = parseImportedJson(await file.text())
      if (
        document &&
        !window.confirm(
          "Replace the open paywall with this file? You can undo once after import to restore the current paywall.",
        )
      ) {
        return
      }
      if (document) {
        importDocument(imported.document)
      } else replaceDocument(imported.document)
      setMockProducts(unavailableMockProductsForDocument(imported.document))
      setMockPurchaseState("productUnavailable")
      setImportError(null)
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "The file could not be imported.")
    }
  }

  if (!document) {
    return (
      <TemplateSelection
        autosave={autosave}
        importError={importError}
        onSelectTemplate={(templateId) => {
          const template = EDITOR_TEMPLATES.find((entry) => entry.id === templateId)
          if (template) loadTemplate(template.document)
        }}
        onResume={() => {
          if (autosave.status === "valid" || autosave.status === "recoverable") {
            applyProject(autosave.project)
          }
        }}
        onImport={importFile}
      />
    )
  }

  return (
    <EditorShell
      mockProducts={activeMockProducts}
      mockPurchaseState={activeMockPurchaseState}
      importError={importError}
      onProductsChange={setMockProducts}
      onPurchaseStateChange={setMockPurchaseState}
      onImport={importFile}
      onChooseTemplate={() => {
        const safeToLeave = window.confirm(
          "Choose another template? Studio will keep this draft in browser autosave. Export it first if you want a separate file.",
        )
        if (!safeToLeave) return
        const project = createLocalProjectFile({
          editableDocumentId: editableDocumentId!,
          document,
          locale: currentLocale,
          textScale,
          mockPurchaseState: activeMockPurchaseState,
          mockProducts: activeMockProducts,
          localRevisionSequence,
        })
        if (
          !writeLocalProject(project, activeMockPurchaseState) &&
          !window.confirm(
            "Browser autosave failed. Continue only if you already exported a copy of this paywall.",
          )
        ) {
          return
        }
        setAutosave(readLocalProjectResult())
        setMockProducts(cloneValue([...DEFAULT_MOCK_PRODUCTS]))
        setMockPurchaseState("productAvailable")
        setImportError(null)
        resetEditor()
      }}
    />
  )
}

export function PaywallEditorWorkspace() {
  return (
    <EditorStoreProvider>
      <WorkspaceContent />
    </EditorStoreProvider>
  )
}
