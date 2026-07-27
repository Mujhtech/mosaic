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
