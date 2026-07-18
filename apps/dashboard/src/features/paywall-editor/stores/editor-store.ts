import { EDITOR_HISTORY_LIMIT } from "@/features/paywall-editor/constants/editor-constants"
import { createEditableDocumentId } from "@/features/paywall-editor/mutations/local-project-file"
import type {
  BlockInsertionConfiguration,
  InsertableBlockType,
  MosaicDocument,
  PreviewMode,
  ProtocolNode,
  TextDirection,
  TreeInsertionLocation,
  TreeMoveTarget,
  TreeOperationKind,
  TreeOperationResult,
} from "@/features/paywall-editor/types/editor"
import { cloneValue } from "@/features/paywall-editor/utils/clone"
import {
  deleteNode,
  duplicateNode,
  findNode,
  findParent,
  getSiblingBoundaries,
  initialLayout,
  insertBlockAtLocation,
  moveNode,
  reconcileExpandedTreeNodes,
  rejectTreeOperation,
  resolveLegacyInsertionLocation,
  revealNodeAncestors,
  updateNode,
} from "@/features/paywall-editor/utils/document-tree"
import { synchronizeProtocolMetadata } from "@/features/paywall-editor/utils/protocol-document"

export interface EditorState {
  document: MosaicDocument | null
  editableDocumentId: string | null
  selectedComponentId: string | null
  hoveredComponentId: string | null
  productLayerPreview: { readonly nodeId: string; readonly state: "default" | "selected" } | null
  expandedTreeNodes: ReadonlySet<string>
  undoStack: readonly MosaicDocument[]
  redoStack: readonly MosaicDocument[]
  dirty: boolean
  currentLocale: string
  previewMode: PreviewMode
  textScale: number
  forceDirection: TextDirection | "document"
  isDocumentTransactionActive: boolean
  lastSavedRevision: number | null
  localRevisionSequence: number
}

export interface EditorStore {
  getSnapshot: () => EditorState
  subscribe: (listener: () => void) => () => void
  loadTemplate: (document: MosaicDocument) => void
  replaceDocument: (document: MosaicDocument) => void
  restoreProject: (
    document: MosaicDocument,
    editableDocumentId: string,
    sequence: number,
    locale: string,
    textScale: number,
  ) => void
  importDocument: (document: MosaicDocument) => void
  resetEditor: () => void
  updateDocument: (updater: (document: MosaicDocument) => MosaicDocument) => void
  updateComponent: (id: string, updater: (node: ProtocolNode) => ProtocolNode) => void
  beginDocumentTransaction: () => boolean
  updateDocumentInTransaction: (updater: (document: MosaicDocument) => MosaicDocument) => boolean
  updateComponentInTransaction: (
    id: string,
    updater: (node: ProtocolNode) => ProtocolNode,
  ) => boolean
  commitDocumentTransaction: () => boolean
  cancelDocumentTransaction: () => boolean
  selectComponent: (id: string | null) => void
  hoverComponent: (id: string | null) => void
  setProductLayerPreview: (
    preview: { readonly nodeId: string; readonly state: "default" | "selected" } | null,
  ) => void
  toggleTreeNode: (id: string) => void
  insertComponent: (type: InsertableBlockType) => string | null
  insertComponentAt: (
    type: InsertableBlockType,
    location: TreeInsertionLocation,
    configuration?: BlockInsertionConfiguration,
  ) => TreeOperationResult
  moveComponent: (nodeId: string, target: TreeMoveTarget) => TreeOperationResult
  moveSelectedComponent: (direction: -1 | 1) => TreeOperationResult
  indentSelectedComponent: () => TreeOperationResult
  outdentSelectedComponent: () => TreeOperationResult
  duplicateSelectedComponent: () => TreeOperationResult
  deleteSelectedComponent: () => TreeOperationResult
  removeSelectedComponent: () => TreeOperationResult
  undo: () => void
  redo: () => void
  setLocale: (locale: string) => void
  setPreviewMode: (mode: PreviewMode) => void
  setTextScale: (scale: number) => void
  setForceDirection: (direction: TextDirection | "document") => void
  setLocalRevisionSequence: (sequence: number) => void
  markSaved: (revision: number) => void
}

const INITIAL_STATE: EditorState = {
  document: null,
  editableDocumentId: null,
  selectedComponentId: null,
  hoveredComponentId: null,
  productLayerPreview: null,
  expandedTreeNodes: new Set(["paywall-content"]),
  undoStack: [],
  redoStack: [],
  dirty: false,
  currentLocale: "en",
  previewMode: "phone",
  textScale: 1,
  forceDirection: "document",
  isDocumentTransactionActive: false,
  lastSavedRevision: null,
  localRevisionSequence: 1,
}

function documentsEqual(left: MosaicDocument, right: MosaicDocument) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function reconcileSelection(document: MosaicDocument, selectedId: string | null) {
  if (selectedId === null) return null
  if (document.screens.some((screen) => screen.layout.id === selectedId)) return selectedId
  if (findNode(document, selectedId)) return selectedId
  return initialLayout(document).content.children[0]?.id ?? null
}

function reconcileLocale(document: MosaicDocument, locale: string) {
  return document.localization.locales[locale] ? locale : document.localization.defaultLocale
}

interface DocumentTransaction {
  document: MosaicDocument
  undoStack: readonly MosaicDocument[]
  redoStack: readonly MosaicDocument[]
  dirty: boolean
  lastSavedRevision: number | null
}

interface CommitDocumentOptions {
  selectedComponentId?: string | null
}

function reconcileTreeState(
  document: MosaicDocument,
  selectedComponentId: string | null,
  expandedTreeNodes: ReadonlySet<string>,
) {
  const selection = reconcileSelection(document, selectedComponentId)
  return {
    selectedComponentId: selection,
    expandedTreeNodes: revealNodeAncestors(
      document,
      selection,
      reconcileExpandedTreeNodes(document, expandedTreeNodes),
    ),
  }
}

export function createEditorStore(initialState: Partial<EditorState> = {}): EditorStore {
  let state: EditorState = {
    ...INITIAL_STATE,
    ...initialState,
    isDocumentTransactionActive: false,
  }
  if (state.document) {
    state = {
      ...state,
      ...reconcileTreeState(state.document, state.selectedComponentId, state.expandedTreeNodes),
    }
  }
  let documentTransaction: DocumentTransaction | null = null
  const listeners = new Set<() => void>()

  function emit(nextState: EditorState) {
    state = nextState
    listeners.forEach((listener) => listener())
  }

  function commitDocument(nextDocument: MosaicDocument, options: CommitDocumentOptions = {}) {
    if (documentTransaction) return false
    const current = state.document
    const synchronized = synchronizeProtocolMetadata(nextDocument)
    if (!current || documentsEqual(current, synchronized)) return false

    const undoStack = [...state.undoStack, cloneValue(current)].slice(-EDITOR_HISTORY_LIMIT)
    const revisedDocument = { ...cloneValue(synchronized), revision: current.revision + 1 }
    const requestedSelection = Object.hasOwn(options, "selectedComponentId")
      ? (options.selectedComponentId ?? null)
      : state.selectedComponentId
    emit({
      ...state,
      document: revisedDocument,
      ...reconcileTreeState(revisedDocument, requestedSelection, state.expandedTreeNodes),
      hoveredComponentId: findNode(revisedDocument, state.hoveredComponentId)
        ? state.hoveredComponentId
        : null,
      productLayerPreview: findNode(revisedDocument, state.productLayerPreview?.nodeId ?? null)
        ? state.productLayerPreview
        : null,
      undoStack,
      redoStack: [],
      dirty: true,
      localRevisionSequence: state.localRevisionSequence + 1,
    })
    return true
  }

  function unavailableOperation(operation: TreeOperationKind): TreeOperationResult {
    if (!state.document) return rejectTreeOperation(operation, "document-unavailable")
    if (documentTransaction) return rejectTreeOperation(operation, "transaction-active")
    return rejectTreeOperation(operation, "selection-unavailable")
  }

  function applyTreeOperation(result: TreeOperationResult): TreeOperationResult {
    if (result.status === "rejected") return result
    if (!commitDocument(result.document, { selectedComponentId: result.selectionId })) {
      return rejectTreeOperation(result.operation, "no-op", { nodeId: result.nodeId })
    }
    return {
      ...result,
      document: state.document as MosaicDocument,
      selectionId: state.selectedComponentId,
    }
  }

  function insertComponentAt(
    type: InsertableBlockType,
    location: TreeInsertionLocation,
    configuration: BlockInsertionConfiguration = {},
  ): TreeOperationResult {
    if (!state.document || documentTransaction) return unavailableOperation("insert")
    return applyTreeOperation(insertBlockAtLocation(state.document, type, location, configuration))
  }

  function moveComponent(nodeId: string, target: TreeMoveTarget): TreeOperationResult {
    if (!state.document || documentTransaction) return unavailableOperation("move")
    return applyTreeOperation(moveNode(state.document, nodeId, target))
  }

  function moveSelectedComponent(direction: -1 | 1): TreeOperationResult {
    const document = state.document
    const selectedId = state.selectedComponentId
    if (!document || documentTransaction || !selectedId) return unavailableOperation("move")
    const boundaries = getSiblingBoundaries(document, selectedId)
    const target = direction === -1 ? boundaries?.previousSibling : boundaries?.nextSibling
    if (!target) {
      return rejectTreeOperation("move", "sibling-boundary", { nodeId: selectedId })
    }
    return moveComponent(selectedId, {
      placement: direction === -1 ? "before" : "after",
      targetId: target.id,
    })
  }

  function indentSelectedComponent(): TreeOperationResult {
    const document = state.document
    const selectedId = state.selectedComponentId
    if (!document || documentTransaction || !selectedId) return unavailableOperation("move")
    const boundaries = getSiblingBoundaries(document, selectedId)
    const previous = boundaries?.previousSibling
    if (!boundaries?.canIndentIntoPrevious || previous?.type !== "stack") {
      return rejectTreeOperation("move", "indent-target-unavailable", { nodeId: selectedId })
    }
    return moveComponent(selectedId, {
      placement: "inside",
      targetId: previous.id,
      index: previous.children.length,
    })
  }

  function outdentSelectedComponent(): TreeOperationResult {
    const document = state.document
    const selectedId = state.selectedComponentId
    if (!document || documentTransaction || !selectedId) return unavailableOperation("move")
    const parent = findParent(document, selectedId)
    if (
      !parent ||
      document.screens.some((screen) => parent.parent.id === screen.layout.content.id)
    ) {
      return rejectTreeOperation("move", "outdent-boundary", { nodeId: selectedId })
    }
    return moveComponent(selectedId, { placement: "after", targetId: parent.parent.id })
  }

  function duplicateSelectedComponent(): TreeOperationResult {
    const document = state.document
    const selectedId = state.selectedComponentId
    if (!document || documentTransaction || !selectedId) return unavailableOperation("duplicate")
    return applyTreeOperation(duplicateNode(document, selectedId))
  }

  function deleteSelectedComponent(): TreeOperationResult {
    const document = state.document
    const selectedId = state.selectedComponentId
    if (!document || documentTransaction || !selectedId) return unavailableOperation("delete")
    return applyTreeOperation(deleteNode(document, selectedId))
  }

  function updateDocumentInActiveTransaction(
    updater: (document: MosaicDocument) => MosaicDocument,
  ) {
    if (!documentTransaction || !state.document) return false
    const synchronized = synchronizeProtocolMetadata(updater(cloneValue(state.document)))
    const nextDocument = {
      ...cloneValue(synchronized),
      revision: documentTransaction.document.revision,
    }
    if (documentsEqual(state.document, nextDocument)) return false
    emit({
      ...state,
      document: nextDocument,
      ...reconcileTreeState(nextDocument, state.selectedComponentId, state.expandedTreeNodes),
    })
    return true
  }

  function updateComponentInActiveTransaction(
    id: string,
    updater: (node: ProtocolNode) => ProtocolNode,
  ) {
    if (!documentTransaction || !state.document || !findNode(state.document, id)) return false
    const synchronized = synchronizeProtocolMetadata(
      updateNode(cloneValue(state.document), id, updater),
    )
    const nextDocument = {
      ...cloneValue(synchronized),
      revision: documentTransaction.document.revision,
    }
    if (documentsEqual(state.document, nextDocument)) return false
    emit({
      ...state,
      document: nextDocument,
      ...reconcileTreeState(nextDocument, state.selectedComponentId, state.expandedTreeNodes),
    })
    return true
  }

  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    loadTemplate: (document) => {
      documentTransaction = null
      const cloned = cloneValue(document)
      const root = initialLayout(cloned).content
      const selectedComponentId = root.children[0]?.id ?? null
      emit({
        ...INITIAL_STATE,
        document: cloned,
        editableDocumentId: createEditableDocumentId(),
        ...reconcileTreeState(cloned, selectedComponentId, new Set([root.id])),
        dirty: true,
        localRevisionSequence: 1,
      })
    },
    replaceDocument: (document) => {
      documentTransaction = null
      const cloned = cloneValue(document)
      const selectedComponentId = initialLayout(cloned).content.children[0]?.id ?? null
      emit({
        ...state,
        document: cloned,
        editableDocumentId: createEditableDocumentId(),
        ...reconcileTreeState(cloned, selectedComponentId, state.expandedTreeNodes),
        hoveredComponentId: null,
        productLayerPreview: null,
        undoStack: [],
        redoStack: [],
        dirty: true,
        currentLocale: cloned.localization.defaultLocale,
        isDocumentTransactionActive: false,
        lastSavedRevision: null,
        localRevisionSequence: 1,
      })
    },
    restoreProject: (document, editableDocumentId, sequence, locale, textScale) => {
      documentTransaction = null
      const cloned = cloneValue(document)
      const selectedComponentId = initialLayout(cloned).content.children[0]?.id ?? null
      emit({
        ...state,
        document: cloned,
        editableDocumentId,
        ...reconcileTreeState(cloned, selectedComponentId, state.expandedTreeNodes),
        hoveredComponentId: null,
        productLayerPreview: null,
        undoStack: [],
        redoStack: [],
        dirty: false,
        currentLocale: locale,
        textScale,
        isDocumentTransactionActive: false,
        lastSavedRevision: cloned.revision,
        localRevisionSequence: sequence,
      })
    },
    importDocument: (document) => {
      if (!state.document) return
      documentTransaction = null
      const cloned = cloneValue(document)
      const selectedComponentId = initialLayout(cloned).content.children[0]?.id ?? null
      emit({
        ...state,
        document: cloned,
        editableDocumentId: createEditableDocumentId(),
        ...reconcileTreeState(cloned, selectedComponentId, state.expandedTreeNodes),
        hoveredComponentId: null,
        productLayerPreview: null,
        undoStack: [...state.undoStack, cloneValue(state.document)].slice(-EDITOR_HISTORY_LIMIT),
        redoStack: [],
        dirty: true,
        currentLocale: cloned.localization.defaultLocale,
        isDocumentTransactionActive: false,
        lastSavedRevision: null,
        localRevisionSequence: 1,
      })
    },
    resetEditor: () => {
      documentTransaction = null
      emit({ ...INITIAL_STATE })
    },
    updateDocument: (updater) => {
      if (!state.document) return
      if (documentTransaction) {
        updateDocumentInActiveTransaction(updater)
        return
      }
      commitDocument(updater(cloneValue(state.document)))
    },
    updateComponent: (id, updater) => {
      if (!state.document || !findNode(state.document, id)) return
      if (documentTransaction) {
        updateComponentInActiveTransaction(id, updater)
        return
      }
      commitDocument(updateNode(state.document, id, updater))
    },
    beginDocumentTransaction: () => {
      if (!state.document || documentTransaction) return false
      documentTransaction = {
        document: state.document,
        undoStack: state.undoStack,
        redoStack: state.redoStack,
        dirty: state.dirty,
        lastSavedRevision: state.lastSavedRevision,
      }
      emit({ ...state, isDocumentTransactionActive: true })
      return true
    },
    updateDocumentInTransaction: (updater) => {
      return updateDocumentInActiveTransaction(updater)
    },
    updateComponentInTransaction: (id, updater) => {
      return updateComponentInActiveTransaction(id, updater)
    },
    commitDocumentTransaction: () => {
      const transaction = documentTransaction
      const current = state.document
      if (!transaction || !current) return false
      documentTransaction = null

      if (documentsEqual(transaction.document, current)) {
        emit({
          ...state,
          document: transaction.document,
          ...reconcileTreeState(
            transaction.document,
            state.selectedComponentId,
            state.expandedTreeNodes,
          ),
          undoStack: transaction.undoStack,
          redoStack: transaction.redoStack,
          dirty: transaction.dirty,
          isDocumentTransactionActive: false,
          lastSavedRevision: transaction.lastSavedRevision,
        })
        return false
      }

      const committedDocument = {
        ...cloneValue(current),
        revision: transaction.document.revision + 1,
      }
      emit({
        ...state,
        document: committedDocument,
        ...reconcileTreeState(
          committedDocument,
          state.selectedComponentId,
          state.expandedTreeNodes,
        ),
        undoStack: [...transaction.undoStack, cloneValue(transaction.document)].slice(
          -EDITOR_HISTORY_LIMIT,
        ),
        redoStack: [],
        dirty: true,
        isDocumentTransactionActive: false,
        localRevisionSequence: state.localRevisionSequence + 1,
      })
      return true
    },
    cancelDocumentTransaction: () => {
      const transaction = documentTransaction
      if (!transaction) return false
      documentTransaction = null
      const treeState = reconcileTreeState(
        transaction.document,
        state.selectedComponentId,
        state.expandedTreeNodes,
      )
      emit({
        ...state,
        document: transaction.document,
        ...treeState,
        undoStack: transaction.undoStack,
        redoStack: transaction.redoStack,
        dirty: transaction.dirty,
        isDocumentTransactionActive: false,
        lastSavedRevision: transaction.lastSavedRevision,
      })
      return true
    },
    selectComponent: (id) => {
      const document = state.document
      if (!document) {
        emit({ ...state, selectedComponentId: null })
        return
      }
      const selectedComponentId =
        id && (document.screens.some((screen) => id === screen.layout.id) || findNode(document, id))
          ? id
          : null
      emit({
        ...state,
        selectedComponentId,
        productLayerPreview:
          state.productLayerPreview?.nodeId === selectedComponentId
            ? state.productLayerPreview
            : null,
        expandedTreeNodes: revealNodeAncestors(
          document,
          selectedComponentId,
          state.expandedTreeNodes,
        ),
      })
    },
    hoverComponent: (id) => emit({ ...state, hoveredComponentId: id }),
    setProductLayerPreview: (preview) => {
      if (preview) {
        if (!state.document) return
        const node = findNode(state.document, preview.nodeId)
        if (
          (node?.type !== "productCard" && node?.type !== "productBadge") ||
          state.selectedComponentId !== preview.nodeId
        ) {
          return
        }
      }
      if (
        state.productLayerPreview?.nodeId === preview?.nodeId &&
        state.productLayerPreview?.state === preview?.state
      ) {
        return
      }
      emit({ ...state, productLayerPreview: preview })
    },
    toggleTreeNode: (id) => {
      if (!state.document) return
      const node = findNode(state.document, id)
      if (
        node?.type !== "stack" &&
        node?.type !== "button" &&
        node?.type !== "carousel" &&
        node?.type !== "productSelector" &&
        node?.type !== "productCard" &&
        node?.type !== "productBadge"
      )
        return
      const expanded = new Set(state.expandedTreeNodes)
      if (expanded.has(id)) expanded.delete(id)
      else expanded.add(id)
      emit({ ...state, expandedTreeNodes: expanded })
    },
    insertComponent: (type) => {
      if (!state.document || documentTransaction) return null
      const result = insertComponentAt(
        type,
        resolveLegacyInsertionLocation(state.document, state.selectedComponentId, type),
      )
      return result.status === "accepted" ? result.nodeId : null
    },
    insertComponentAt,
    moveComponent,
    moveSelectedComponent,
    indentSelectedComponent,
    outdentSelectedComponent,
    duplicateSelectedComponent,
    deleteSelectedComponent,
    removeSelectedComponent: deleteSelectedComponent,
    undo: () => {
      if (documentTransaction) return
      const current = state.document
      const previous = state.undoStack.at(-1)
      if (!current || !previous) return
      const restored = { ...cloneValue(previous), revision: current.revision + 1 }
      const treeState = reconcileTreeState(
        restored,
        state.selectedComponentId,
        state.expandedTreeNodes,
      )
      emit({
        ...state,
        document: restored,
        ...treeState,
        hoveredComponentId: findNode(restored, state.hoveredComponentId)
          ? state.hoveredComponentId
          : null,
        currentLocale: reconcileLocale(restored, state.currentLocale),
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, cloneValue(current)].slice(-EDITOR_HISTORY_LIMIT),
        dirty: true,
        localRevisionSequence: state.localRevisionSequence + 1,
      })
    },
    redo: () => {
      if (documentTransaction) return
      const current = state.document
      const next = state.redoStack.at(-1)
      if (!current || !next) return
      const restored = { ...cloneValue(next), revision: current.revision + 1 }
      const treeState = reconcileTreeState(
        restored,
        state.selectedComponentId,
        state.expandedTreeNodes,
      )
      emit({
        ...state,
        document: restored,
        ...treeState,
        hoveredComponentId: findNode(restored, state.hoveredComponentId)
          ? state.hoveredComponentId
          : null,
        currentLocale: reconcileLocale(restored, state.currentLocale),
        undoStack: [...state.undoStack, cloneValue(current)].slice(-EDITOR_HISTORY_LIMIT),
        redoStack: state.redoStack.slice(0, -1),
        dirty: true,
        localRevisionSequence: state.localRevisionSequence + 1,
      })
    },
    setLocale: (locale) =>
      emit({
        ...state,
        currentLocale: locale,
        localRevisionSequence: state.localRevisionSequence + 1,
      }),
    setPreviewMode: (previewMode) => emit({ ...state, previewMode }),
    setTextScale: (textScale) =>
      emit({
        ...state,
        textScale,
        localRevisionSequence: state.localRevisionSequence + 1,
      }),
    setForceDirection: (forceDirection) => emit({ ...state, forceDirection }),
    setLocalRevisionSequence: (sequence) => {
      if (!Number.isInteger(sequence) || sequence <= state.localRevisionSequence) return
      emit({ ...state, localRevisionSequence: sequence })
    },
    markSaved: (revision) => {
      if (documentTransaction || state.document?.revision !== revision) return
      emit({ ...state, dirty: false, lastSavedRevision: revision })
    },
  }
}
