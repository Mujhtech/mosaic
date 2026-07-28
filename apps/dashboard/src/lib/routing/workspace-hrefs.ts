/**
 * Workspace destinations expressed as plain strings.
 *
 * Recovery links are produced in places that are not React components (error
 * descriptors, publish validation issues), so they cannot use the typed
 * `Link` API. Centralising the construction keeps a route rename to one file
 * and keeps every identifier encoded exactly once.
 */

export interface WorkspaceScope {
  environmentId?: string
  organizationId?: string
  projectId?: string
}

/**
 * Adds search parameters to an internal href. External or relative values are
 * returned untouched so a recovery link can never be rewritten into an
 * off-origin destination.
 */
export function appendSearch(href: string, values: Record<string, string | undefined>) {
  if (!href.startsWith("/")) return href
  const url = new URL(href, "https://mosaic.local")
  for (const [key, value] of Object.entries(values)) {
    if (value) url.searchParams.set(key, value)
  }
  return `${url.pathname}${url.search}${url.hash}`
}

function projectBase(scope: WorkspaceScope) {
  if (!scope.organizationId || !scope.projectId) return undefined
  return `/organizations/${encodeURIComponent(scope.organizationId)}/projects/${encodeURIComponent(scope.projectId)}`
}

function monetizationBase(scope: WorkspaceScope) {
  const base = projectBase(scope)
  if (!base || !scope.environmentId) return undefined
  return `${base}/monetization/${encodeURIComponent(scope.environmentId)}`
}

export function placementsHref(scope: WorkspaceScope) {
  const base = monetizationBase(scope)
  return base ? `${base}/placements` : undefined
}

export function assetsHref(scope: WorkspaceScope) {
  const base = monetizationBase(scope)
  return base ? `${base}/assets` : undefined
}

export function paywallsHref(scope: WorkspaceScope) {
  const base = monetizationBase(scope)
  return base ? `${base}/paywalls` : undefined
}

export function catalogProductsHref(scope: WorkspaceScope) {
  const base = projectBase(scope)
  return base ? `${base}/catalog/products` : undefined
}

export function providersHref(scope: WorkspaceScope) {
  const base = projectBase(scope)
  return base ? `${base}/catalog/providers` : undefined
}

export function environmentSettingsHref(scope: WorkspaceScope) {
  const base = projectBase(scope)
  return base ? `${base}/settings/environments` : undefined
}

/**
 * Mosaic Billing destinations.
 *
 * Store Server Credentials are Project-scoped because one credential can serve
 * several Mosaic Environments. Everything the ingestion pipeline records is
 * Environment-owned, so those destinations carry the Environment in the path,
 * exactly as Monetization and Analytics do.
 */
function billingEnvironmentBase(scope: WorkspaceScope) {
  const base = projectBase(scope)
  if (!base || !scope.environmentId) return undefined
  return `${base}/billing/${encodeURIComponent(scope.environmentId)}`
}

export function storeConnectionsHref(scope: WorkspaceScope) {
  const base = projectBase(scope)
  return base ? `${base}/billing/connections` : undefined
}

export function storeConnectionHref(scope: WorkspaceScope, credentialId: string) {
  const base = storeConnectionsHref(scope)
  return base ? `${base}/${encodeURIComponent(credentialId)}` : undefined
}

export function billingTransactionsHref(scope: WorkspaceScope) {
  const base = billingEnvironmentBase(scope)
  return base ? `${base}/transactions` : undefined
}

export function billingQuarantineHref(scope: WorkspaceScope) {
  const base = billingEnvironmentBase(scope)
  return base ? `${base}/quarantine` : undefined
}

export function billingReconciliationHref(scope: WorkspaceScope) {
  const base = billingEnvironmentBase(scope)
  return base ? `${base}/reconciliation` : undefined
}

export function billingHealthHref(scope: WorkspaceScope) {
  const base = billingEnvironmentBase(scope)
  return base ? `${base}/health` : undefined
}

/**
 * Names the destination a `returnTo` points back to.
 *
 * A recovery round trip sends an operator from the surface that found a problem
 * to the surface that fixes it. On arrival the way back has to say where it
 * goes, and only the sending surface knows — so the label is derived from the
 * path shape rather than hard-coded by whichever page happens to render it.
 */
export function describeReturnDestination(href: string | undefined) {
  if (!href) return undefined
  if (href.includes("/billing/") && href.includes("/quarantine/")) {
    return "Return to the quarantine record"
  }
  if (href.includes("/billing/")) return "Return to Mosaic Billing"
  if (href.includes("/studio-hosted/")) return "Return to Publish review"
  return "Return to where you started"
}
