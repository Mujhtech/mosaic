import type { StoreServerCredential } from "@/generated/api"

/**
 * Read-side view rules for Store Server Credentials.
 *
 * Reads return metadata only: no secret material, and no notification endpoint
 * URL. The URL is itself a secret because it embeds the intake token, so this
 * module never reconstructs one — it can only redact a URL the API just handed
 * back, and only for the moment it is on screen.
 */

export type StoreCredentialHealth = NonNullable<StoreServerCredential["healthStatus"]>

const HEALTH_LABELS: Record<StoreCredentialHealth, string> = {
  degraded: "Degraded",
  healthy: "Healthy",
  revoked: "Revoked",
  unavailable: "Unavailable",
  untested: "Not tested yet",
}

const HEALTH_EXPLANATIONS: Record<StoreCredentialHealth, string> = {
  degraded:
    "The store answered, but not cleanly. Validation may be slow or intermittently failing. Test the connection to see the current code.",
  healthy: "The stored key authenticated against the store on its last test.",
  revoked: "This credential is revoked. Its notification endpoint no longer resolves.",
  unavailable:
    "The store refused this credential. Rotate it with a current key; nothing already recorded is affected.",
  untested: "Test the connection to confirm the stored key still authenticates.",
}

export function storeCredentialHealthLabel(value: string | undefined) {
  return HEALTH_LABELS[value as StoreCredentialHealth] ?? "Unknown"
}

export function storeCredentialHealthExplanation(value: string | undefined) {
  return (
    HEALTH_EXPLANATIONS[value as StoreCredentialHealth] ??
    "Mosaic has no health signal for this credential yet."
  )
}

export function storeCredentialIsUnhealthy(
  credential: Pick<StoreServerCredential, "healthStatus">,
) {
  return credential.healthStatus === "degraded" || credential.healthStatus === "unavailable"
}

export interface StoreCredentialActions {
  revoke: boolean
  rotate: boolean
  test: boolean
}

export function storeCredentialActions(
  credential: Pick<StoreServerCredential, "status">,
): StoreCredentialActions {
  const active = credential.status !== "revoked"
  return { revoke: active, rotate: active, test: active }
}

/**
 * Shows enough of a one-time endpoint URL to recognise it, and none of the
 * intake token. Used only for the on-screen "what you just copied" line; the
 * redacted form is not a recovery path, because Mosaic cannot show the URL
 * again once it leaves local state.
 */
export function redactNotificationEndpoint(url: string | undefined) {
  if (!url) return undefined
  try {
    const parsed = new URL(url)
    const segments = parsed.pathname.split("/").filter(Boolean)
    if (segments.length === 0) return `${parsed.origin}/…`
    segments[segments.length - 1] = "••••••••"
    return `${parsed.origin}/${segments.join("/")}`
  } catch {
    return "••••••••"
  }
}

/** Apple posts to an endpoint Mosaic hosts. Google is a Pub/Sub pull. */
export function usesInboundNotificationEndpoint(
  credential: Pick<StoreServerCredential, "provider">,
) {
  return credential.provider === "app_store"
}
