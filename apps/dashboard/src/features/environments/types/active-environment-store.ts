/**
 * The remembered Environment per Project, held in memory so every reader sees one
 * value, and mirrored to localStorage so a reload does not lose the choice.
 *
 * This is deliberately not the source of truth. A route that carries an
 * Environment outranks it (see useActiveEnvironment), which is what keeps a shared
 * link unambiguous: the recipient sees the Environment in the URL, not whichever
 * one their own browser happens to remember.
 */

const STORAGE_PREFIX = "mosaic.activeEnvironment."

const remembered = new Map<string, string>()
const listeners = new Set<() => void>()

let hydrated = false

function storageKey(projectId: string) {
  return `${STORAGE_PREFIX}${projectId}`
}

function notify() {
  for (const listener of listeners) listener()
}

/**
 * Reads persisted choices once, on the first subscription. Subscription happens in
 * an effect, so this never runs during render or hydration: a getSnapshot that
 * touched storage would report a value the server-rendered HTML did not have.
 */
function hydrateOnce() {
  if (hydrated) return
  hydrated = true
  if (typeof window === "undefined") return

  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (!key?.startsWith(STORAGE_PREFIX)) continue
      const value = window.localStorage.getItem(key)
      if (value) remembered.set(key.slice(STORAGE_PREFIX.length), value)
    }
  } catch {
    // Storage can be unavailable or full. The in-memory value still works for
    // the session; only persistence across reloads is lost.
  }
}

export function subscribeToActiveEnvironment(listener: () => void) {
  hydrateOnce()
  listeners.add(listener)
  if (remembered.size > 0) listener()
  return () => listeners.delete(listener)
}

/** A primitive snapshot, so useSyncExternalStore never sees a new identity. */
export function rememberedEnvironmentId(projectId: string) {
  return projectId ? remembered.get(projectId) : undefined
}

export function rememberEnvironmentId(projectId: string, environmentId: string) {
  if (!projectId || !environmentId) return
  if (remembered.get(projectId) === environmentId) return

  remembered.set(projectId, environmentId)
  try {
    window.localStorage.setItem(storageKey(projectId), environmentId)
  } catch {
    // See hydrateOnce: persistence is best effort.
  }
  notify()
}

/** Test seam. Production code has no reason to discard the choice. */
export function resetActiveEnvironmentStore() {
  remembered.clear()
  hydrated = false
  notify()
  listeners.clear()
}
