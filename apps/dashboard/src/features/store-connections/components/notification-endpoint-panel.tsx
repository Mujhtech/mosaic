import { useState } from "react"

import { OneTimeSecret } from "@/components/feedback/one-time-secret"
import { WorkflowPanel } from "@/features/organizations/components/workspace-page"
import { redactNotificationEndpoint } from "@/features/store-connections/types/store-connection-view"

interface NotificationEndpointPanelProps {
  /**
   * Present only for the moment after a create or rotate response. Held in the
   * caller's local state and never in the Query cache.
   */
  endpointUrl?: string
  onDismiss: () => void
  rotateAction?: React.ReactNode
  writeToClipboard?: (value: string) => Promise<void>
}

/**
 * The Store Notification intake endpoint.
 *
 * The URL embeds the per-credential intake token, so the URL *is* a secret: it
 * is one of the two factors that authenticate an inbound Apple notification.
 * The API returns it only from create and rotate, and no read ever returns it.
 *
 * Dismissal is final. This component deliberately drops the value from its own
 * render path rather than merely hiding it, so a dismissed endpoint cannot be
 * recovered by re-rendering, and the panel falls back to copy that names
 * rotation as the only way to obtain a new URL.
 */
export function NotificationEndpointPanel({
  endpointUrl,
  onDismiss,
  rotateAction,
  writeToClipboard,
}: NotificationEndpointPanelProps) {
  const [dismissed, setDismissed] = useState(false)
  const revealed = endpointUrl !== undefined && !dismissed

  return (
    <WorkflowPanel
      description="Apple posts App Store Server Notifications to an address that contains an unguessable intake token. Mosaic stores only its SHA-256 digest."
      title="Store Notification endpoint"
    >
      {revealed ? (
        <div className="space-y-3">
          <OneTimeSecret
            copyLabel="Copy endpoint URL"
            description="Paste it into App Store Connect now. Mosaic cannot show this address again — rotating the intake token is the only way to obtain a new one, and rotation stops the previous address working immediately."
            dismissLabel="Dismiss the one-time notification endpoint"
            eyebrow="Shown once"
            onDismiss={() => {
              setDismissed(true)
              onDismiss()
            }}
            secret={endpointUrl}
            title="Copy this notification endpoint now"
            {...(writeToClipboard ? { writeToClipboard } : {})}
          />
          <p className="text-muted-foreground text-xs">
            After dismissal only this shortened form remains:{" "}
            <code className="bg-muted rounded px-1 py-0.5 font-mono">
              {redactNotificationEndpoint(endpointUrl)}
            </code>
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm leading-6">
            The notification endpoint for this credential was shown once, when the credential was
            created or last rotated. Mosaic cannot display it again.
          </p>
          <p className="text-muted-foreground text-sm leading-6">
            If the address was lost or may have leaked, rotate the intake token to mint a new one.
            The previous address stops resolving immediately, so Apple must be reconfigured or
            notifications stop arriving.
          </p>
          {rotateAction}
        </div>
      )}
      <p className="text-muted-foreground mt-4 text-xs leading-5">
        Mosaic never sends a test notification of its own. Inbound intake is store-originated, and a
        synthetic delivery would put a record in the append-only ledger that no store ever sent.
        Confirm delivery from the billing health view instead.
      </p>
    </WorkflowPanel>
  )
}
