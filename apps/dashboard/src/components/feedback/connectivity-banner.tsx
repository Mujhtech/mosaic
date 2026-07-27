import { WifiSlashIcon } from "@phosphor-icons/react/dist/ssr/WifiSlash"

import { useConnectivityStatus } from "@/hooks/use-connectivity-status"

/**
 * Always-mounted status region. It stays in the tree so assistive technology
 * announces the transition rather than a region appearing from nowhere.
 */
export function ConnectivityBanner() {
  const { isDegraded, isOffline } = useConnectivityStatus()
  const visible = isDegraded || isOffline

  return (
    <div
      aria-live="polite"
      className={
        visible
          ? "bg-destructive/10 border-destructive/30 text-foreground fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 border-b px-4 py-2 text-sm"
          : "sr-only"
      }
      data-slot="connectivity-banner"
      role="status"
    >
      {visible ? (
        <>
          <WifiSlashIcon aria-hidden size={16} />
          <span>
            {isOffline
              ? "You are offline. Mosaic will keep showing the last loaded data and retry automatically."
              : "Mosaic cannot reach the API. Displayed data may be stale; retries continue in the background."}
          </span>
        </>
      ) : null}
    </div>
  )
}
