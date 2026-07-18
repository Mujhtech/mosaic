import { createContext, useContext, useMemo, useState, useSyncExternalStore } from "react"
import type { ReactNode } from "react"

import {
  createEditorStore,
  type EditorState,
  type EditorStore,
} from "@/features/paywall-editor/stores/editor-store"

const EditorStoreContext = createContext<EditorStore | null>(null)

function createSelectionGetter<Selection>(
  store: EditorStore,
  selector: (state: EditorState) => Selection,
  isEqual: (left: Selection, right: Selection) => boolean,
) {
  let cached: { snapshot: EditorState; selection: Selection } | null = null
  return () => {
    const snapshot = store.getSnapshot()
    if (cached?.snapshot === snapshot) return cached.selection

    const selection = selector(snapshot)
    if (cached && isEqual(cached.selection, selection)) {
      cached = { snapshot, selection: cached.selection }
      return cached.selection
    }

    cached = { snapshot, selection }
    return selection
  }
}

export function EditorStoreProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => createEditorStore())
  return <EditorStoreContext.Provider value={store}>{children}</EditorStoreContext.Provider>
}

export function useEditorStore(): EditorState {
  const store = useContext(EditorStoreContext)
  if (!store) throw new Error("useEditorStore must be used inside EditorStoreProvider")
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}

export function useEditorStoreSelector<Selection>(
  selector: (state: EditorState) => Selection,
  isEqual: (left: Selection, right: Selection) => boolean = Object.is,
): Selection {
  const store = useContext(EditorStoreContext)
  if (!store) throw new Error("useEditorStoreSelector must be used inside EditorStoreProvider")

  const getSelection = useMemo(
    () => createSelectionGetter(store, selector, isEqual),
    [isEqual, selector, store],
  )

  return useSyncExternalStore(store.subscribe, getSelection, getSelection)
}

export function useEditorActions(): EditorStore {
  const store = useContext(EditorStoreContext)
  if (!store) throw new Error("useEditorActions must be used inside EditorStoreProvider")
  return store
}
