import { createContext, useContext, useState, useSyncExternalStore } from "react"
import type { ReactNode } from "react"

import {
  createEditorStore,
  type EditorState,
  type EditorStore,
} from "@/features/paywall-editor/stores/editor-store"

const EditorStoreContext = createContext<EditorStore | null>(null)

export function EditorStoreProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => createEditorStore())
  return <EditorStoreContext.Provider value={store}>{children}</EditorStoreContext.Provider>
}

export function useEditorStore(): EditorState {
  const store = useContext(EditorStoreContext)
  if (!store) throw new Error("useEditorStore must be used inside EditorStoreProvider")
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}

export function useEditorActions(): EditorStore {
  const store = useContext(EditorStoreContext)
  if (!store) throw new Error("useEditorActions must be used inside EditorStoreProvider")
  return store
}
