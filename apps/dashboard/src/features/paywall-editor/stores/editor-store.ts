import { EDITOR_HISTORY_LIMIT } from "@/features/paywall-editor/constants/editor-constants"
import { createEditableDocumentId } from "@/features/paywall-editor/mutations/local-project-file"
import type {
  InsertableBlockType,
  MosaicDocument,
  PreviewMode,
  ProtocolNode,
  TextDirection,
} from "@/features/paywall-editor/types/editor"
import { cloneValue } from "@/features/paywall-editor/utils/clone"
import {
  findNode,
  findParent,
  flattenDocument,
  insertBlock,
  removeNode,
  reorderNode,
  updateNode,
} from "@/features/paywall-editor/utils/document-tree"
import { synchronizeProtocolMetadata } from "@/features/paywall-editor/utils/protocol-document"

export interface EditorState {
  document: MosaicDocument | null
  editableDocumentId: string | null
  selectedComponentId: string | null
  hoveredComponentId: string | null
  expandedTreeNodes: ReadonlySet<string>
  undoStack: readonly MosaicDocument[]
  redoStack: readonly MosaicDocument[]
  dirty: boolean
  currentLocale: string
  previewMode: PreviewMode
  textScale: number
  forceDirection: TextDirection | "document"
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
  selectComponent: (id: string | null) => void
  hoverComponent: (id: string | null) => void
  toggleTreeNode: (id: string) => void
  insertComponent: (type: InsertableBlockType) => string | null
  removeSelectedComponent: () => void
  moveSelectedComponent: (direction: -1 | 1) => void
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
  expandedTreeNodes: new Set(["paywall-content"]),
  undoStack: [],
  redoStack: [],
  dirty: false,
  currentLocale: "en",
  previewMode: "phone",
  textScale: 1,
  forceDirection: "document",
  lastSavedRevision: null,
  localRevisionSequence: 1,
}

function documentsEqual(left: MosaicDocument, right: MosaicDocument) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function reconcileSelection(document: MosaicDocument, selectedId: string | null) {
  if (findNode(document, selectedId)) return selectedId
  return document.layout.content.children[0]?.id ?? null
}

function reconcileLocale(document: MosaicDocument, locale: string) {
  return document.localization.locales[locale] ? locale : document.localization.defaultLocale
}

export function createEditorStore(initialState: Partial<EditorState> = {}): EditorStore {
  let state: EditorState = { ...INITIAL_STATE, ...initialState }
  const listeners = new Set<() => void>()

  function emit(nextState: EditorState) {
    state = nextState
    listeners.forEach((listener) => listener())
  }

  function commitDocument(nextDocument: MosaicDocument) {
    const current = state.document
    const synchronized = synchronizeProtocolMetadata(nextDocument)
    if (!current || documentsEqual(current, synchronized)) return

    const undoStack = [...state.undoStack, cloneValue(current)].slice(-EDITOR_HISTORY_LIMIT)
    emit({
      ...state,
      document: { ...cloneValue(synchronized), revision: current.revision + 1 },
      undoStack,
      redoStack: [],
      dirty: true,
      localRevisionSequence: state.localRevisionSequence + 1,
    })
  }

  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    loadTemplate: (document) => {
      const cloned = cloneValue(document)
      emit({
        ...INITIAL_STATE,
        document: cloned,
        editableDocumentId: createEditableDocumentId(),
        selectedComponentId: cloned.layout.content.children[0]?.id ?? null,
        expandedTreeNodes: new Set([cloned.layout.content.id]),
        dirty: true,
        localRevisionSequence: 1,
      })
    },
    replaceDocument: (document) => {
      const cloned = cloneValue(document)
      emit({
        ...state,
        document: cloned,
        editableDocumentId: createEditableDocumentId(),
        selectedComponentId: cloned.layout.content.children[0]?.id ?? null,
        hoveredComponentId: null,
        undoStack: [],
        redoStack: [],
        dirty: true,
        currentLocale: cloned.localization.defaultLocale,
        lastSavedRevision: null,
        localRevisionSequence: 1,
      })
    },
    restoreProject: (document, editableDocumentId, sequence, locale, textScale) => {
      const cloned = cloneValue(document)
      emit({
        ...state,
        document: cloned,
        editableDocumentId,
        selectedComponentId: cloned.layout.content.children[0]?.id ?? null,
        hoveredComponentId: null,
        undoStack: [],
        redoStack: [],
        dirty: false,
        currentLocale: locale,
        textScale,
        lastSavedRevision: cloned.revision,
        localRevisionSequence: sequence,
      })
    },
    importDocument: (document) => {
      if (!state.document) return
      const cloned = cloneValue(document)
      emit({
        ...state,
        document: cloned,
        editableDocumentId: createEditableDocumentId(),
        selectedComponentId: cloned.layout.content.children[0]?.id ?? null,
        hoveredComponentId: null,
        undoStack: [...state.undoStack, cloneValue(state.document)].slice(-EDITOR_HISTORY_LIMIT),
        redoStack: [],
        dirty: true,
        currentLocale: cloned.localization.defaultLocale,
        lastSavedRevision: null,
        localRevisionSequence: 1,
      })
    },
    resetEditor: () => emit({ ...INITIAL_STATE }),
    updateDocument: (updater) => {
      if (!state.document) return
      commitDocument(updater(cloneValue(state.document)))
    },
    updateComponent: (id, updater) => {
      if (!state.document || !findNode(state.document, id)) return
      commitDocument(updateNode(state.document, id, updater))
    },
    selectComponent: (id) => emit({ ...state, selectedComponentId: id }),
    hoverComponent: (id) => emit({ ...state, hoveredComponentId: id }),
    toggleTreeNode: (id) => {
      const expanded = new Set(state.expandedTreeNodes)
      if (expanded.has(id)) expanded.delete(id)
      else expanded.add(id)
      emit({ ...state, expandedTreeNodes: expanded })
    },
    insertComponent: (type) => {
      if (!state.document) return null
      if (
        type === "productSelector" &&
        flattenDocument(state.document).some((entry) => entry.node.type === "productSelector")
      ) {
        return null
      }
      const result = insertBlock(state.document, type, state.selectedComponentId)
      commitDocument(result.document)
      emit({ ...state, selectedComponentId: result.node.id })
      return result.node.id
    },
    removeSelectedComponent: () => {
      const id = state.selectedComponentId
      const document = state.document
      if (!id || !document) return
      const parent = findParent(document, id)
      if (!parent || parent.parent.children.length <= 1) return
      const entries = parent.parent.children
      const index = parent.index
      const fallback =
        entries[index + 1]?.id ??
        entries[index - 1]?.id ??
        (findNode(document, parent.parent.id) ? parent.parent.id : null)
      commitDocument(removeNode(document, id))
      emit({ ...state, selectedComponentId: fallback })
    },
    moveSelectedComponent: (direction) => {
      if (!state.document || !state.selectedComponentId) return
      commitDocument(reorderNode(state.document, state.selectedComponentId, direction))
    },
    undo: () => {
      const current = state.document
      const previous = state.undoStack.at(-1)
      if (!current || !previous) return
      const restored = { ...cloneValue(previous), revision: current.revision + 1 }
      emit({
        ...state,
        document: restored,
        selectedComponentId: reconcileSelection(restored, state.selectedComponentId),
        currentLocale: reconcileLocale(restored, state.currentLocale),
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, cloneValue(current)].slice(-EDITOR_HISTORY_LIMIT),
        dirty: true,
        localRevisionSequence: state.localRevisionSequence + 1,
      })
    },
    redo: () => {
      const current = state.document
      const next = state.redoStack.at(-1)
      if (!current || !next) return
      const restored = { ...cloneValue(next), revision: current.revision + 1 }
      emit({
        ...state,
        document: restored,
        selectedComponentId: reconcileSelection(restored, state.selectedComponentId),
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
      if (state.document?.revision !== revision) return
      emit({ ...state, dirty: false, lastSavedRevision: revision })
    },
  }
}
