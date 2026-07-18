/* eslint-disable react-refresh/only-export-components -- This feature context intentionally colocates its provider and typed hooks. */
import { createContext, useContext, useMemo, useState, useSyncExternalStore } from "react"
import type { ReactNode } from "react"

import type { StudioWorkspaceStorage } from "@/features/paywall-editor/mutations/studio-workspace-persistence"
import {
  createStudioWorkspaceStore,
  type StudioWorkspaceActions,
  type StudioWorkspaceSnapshot,
  type StudioWorkspaceStore,
} from "@/features/paywall-editor/stores/studio-workspace-store"

const StudioWorkspaceStoreContext = createContext<StudioWorkspaceStore | null>(null)

function createSelectionGetter<Selection>(
  store: StudioWorkspaceStore,
  selector: (snapshot: StudioWorkspaceSnapshot) => Selection,
  isEqual: (left: Selection, right: Selection) => boolean,
) {
  let cached: { snapshot: StudioWorkspaceSnapshot; selection: Selection } | null = null

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

export function StudioWorkspaceStoreProvider({
  children,
  storage,
}: {
  children: ReactNode
  storage?: StudioWorkspaceStorage | null
}) {
  const [store] = useState(() =>
    storage === undefined ? createStudioWorkspaceStore() : createStudioWorkspaceStore({ storage }),
  )
  return (
    <StudioWorkspaceStoreContext.Provider value={store}>
      {children}
    </StudioWorkspaceStoreContext.Provider>
  )
}

export function useStudioWorkspaceSelector<Selection>(
  selector: (snapshot: StudioWorkspaceSnapshot) => Selection,
  isEqual: (left: Selection, right: Selection) => boolean = Object.is,
): Selection {
  const store = useContext(StudioWorkspaceStoreContext)
  if (!store) {
    throw new Error("useStudioWorkspaceSelector must be used inside StudioWorkspaceStoreProvider")
  }

  const getSelection = useMemo(
    () => createSelectionGetter(store, selector, isEqual),
    [isEqual, selector, store],
  )
  return useSyncExternalStore(store.subscribe, getSelection, getSelection)
}

export function useStudioWorkspaceActions(): StudioWorkspaceActions {
  const store = useContext(StudioWorkspaceStoreContext)
  if (!store) {
    throw new Error("useStudioWorkspaceActions must be used inside StudioWorkspaceStoreProvider")
  }
  return store
}
