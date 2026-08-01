/**
 * Workspace destinations expressed as plain strings.
 *
 * Recovery links are produced in places that are not React components (error
 * descriptors, publish validation issues), so they cannot use the typed
 * `Link` API. Centralising the construction keeps a route rename to one file
 * and keeps every identifier encoded exactly once.
 */

export interface WorkspaceScope {
  environmentId?: string;
  organizationId?: string;
  projectId?: string;
}

/**
 * Adds search parameters to an internal href. External or relative values are
 * returned untouched so a recovery link can never be rewritten into an
 * off-origin destination.
 */
export function appendSearch(
  href: string,
  values: Record<string, string | undefined>
) {
  if (!href.startsWith("/")) {
    return href;
  }
  const url = new URL(href, "https://mosaic.local");
  for (const [key, value] of Object.entries(values)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

function projectBase(scope: WorkspaceScope) {
  if (!(scope.organizationId && scope.projectId)) {
    return;
  }
  return `/orgs/${encodeURIComponent(scope.organizationId)}/projects/${encodeURIComponent(scope.projectId)}`;
}

function monetizationBase(scope: WorkspaceScope) {
  const base = projectBase(scope);
  if (!(base && scope.environmentId)) {
    return;
  }
  return `${base}/monetization/${encodeURIComponent(scope.environmentId)}`;
}

export function placementsHref(scope: WorkspaceScope) {
  const base = monetizationBase(scope);
  return base ? `${base}/placements` : undefined;
}

export function assetsHref(scope: WorkspaceScope) {
  const base = monetizationBase(scope);
  return base ? `${base}/assets` : undefined;
}

export function paywallsHref(scope: WorkspaceScope) {
  const base = monetizationBase(scope);
  return base ? `${base}/paywalls` : undefined;
}

export function catalogProductsHref(scope: WorkspaceScope) {
  const base = projectBase(scope);
  return base ? `${base}/catalog/products` : undefined;
}

export function catalogProductHref(scope: WorkspaceScope, productId: string) {
  const base = catalogProductsHref(scope);
  return base ? `${base}/${encodeURIComponent(productId)}` : undefined;
}

export function providersHref(scope: WorkspaceScope) {
  const base = projectBase(scope);
  return base ? `${base}/catalog/providers` : undefined;
}

export function environmentSettingsHref(scope: WorkspaceScope) {
  const base = projectBase(scope);
  return base ? `${base}/settings/environments` : undefined;
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
  const base = projectBase(scope);
  if (!(base && scope.environmentId)) {
    return;
  }
  return `${base}/billing/${encodeURIComponent(scope.environmentId)}`;
}

export function storeConnectionsHref(scope: WorkspaceScope) {
  const base = projectBase(scope);
  return base ? `${base}/billing/connections` : undefined;
}

export function storeConnectionHref(
  scope: WorkspaceScope,
  credentialId: string
) {
  const base = storeConnectionsHref(scope);
  return base ? `${base}/${encodeURIComponent(credentialId)}` : undefined;
}

export function billingTransactionsHref(scope: WorkspaceScope) {
  const base = billingEnvironmentBase(scope);
  return base ? `${base}/transactions` : undefined;
}

export function billingQuarantineHref(scope: WorkspaceScope) {
  const base = billingEnvironmentBase(scope);
  return base ? `${base}/quarantine` : undefined;
}

export function billingReconciliationHref(scope: WorkspaceScope) {
  const base = billingEnvironmentBase(scope);
  return base ? `${base}/reconciliation` : undefined;
}

export function billingHealthHref(scope: WorkspaceScope) {
  const base = billingEnvironmentBase(scope);
  return base ? `${base}/health` : undefined;
}

/**
 * Authoritative customer access.
 *
 * Environment-scoped like every other billing destination, even though a
 * Billing Customer's *identity* is Project-scoped: everything Mosaic computes
 * about their access — snapshots, subscriptions, entitlements — belongs to one
 * Environment, and the customer header states the Project scope explicitly so
 * the two are not confused.
 */
export function billingCustomersHref(scope: WorkspaceScope) {
  const base = billingEnvironmentBase(scope);
  return base ? `${base}/customers` : undefined;
}

export function billingCustomerHref(scope: WorkspaceScope, customerId: string) {
  const base = billingCustomersHref(scope);
  return base ? `${base}/${encodeURIComponent(customerId)}` : undefined;
}

export function billingSubscriptionHref(
  scope: WorkspaceScope,
  instanceId: string
) {
  const base = billingEnvironmentBase(scope);
  return base
    ? `${base}/subscriptions/${encodeURIComponent(instanceId)}`
    : undefined;
}

export function billingRestoresHref(scope: WorkspaceScope) {
  const base = billingEnvironmentBase(scope);
  return base ? `${base}/restores` : undefined;
}

/**
 * Identity conflicts are Project-scoped data reached through an
 * Environment-scoped route, for consistency with the rest of the Billing nav.
 * The page itself says so rather than pretending to be filtered.
 */
export function billingIdentityConflictsHref(scope: WorkspaceScope) {
  const base = billingEnvironmentBase(scope);
  return base ? `${base}/identity-conflicts` : undefined;
}

export function billingIdentityConflictHref(
  scope: WorkspaceScope,
  conflictId: string
) {
  const base = billingIdentityConflictsHref(scope);
  return base ? `${base}/${encodeURIComponent(conflictId)}` : undefined;
}

/**
 * Projection health is a sibling of billing health, not a tab inside it. The
 * two answer different questions — "is store input still becoming facts?" and
 * "is the access answer still current?" — and either can be red while the other
 * is green.
 */
export function billingProjectionHealthHref(scope: WorkspaceScope) {
  const base = billingEnvironmentBase(scope);
  return base ? `${base}/projection-health` : undefined;
}

/**
 * Grant versions are Project-scoped, like the Products and Entitlements they
 * relate, so they live in Catalog rather than under an Environment.
 */
export function grantVersionsHref(
  scope: WorkspaceScope,
  filters: { entitlementId?: string; productId?: string } = {}
) {
  const base = projectBase(scope);
  if (!base) {
    return;
  }
  return appendSearch(`${base}/catalog/grant-versions`, filters);
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
  if (!href) {
    return;
  }
  if (href.includes("/billing/") && href.includes("/quarantine/")) {
    return "Return to the quarantine record";
  }
  if (href.includes("/billing/") && href.includes("/projection-health")) {
    return "Return to projection health";
  }
  if (href.includes("/billing/")) {
    return "Return to Mosaic Billing";
  }
  if (href.includes("/catalog/grant-versions")) {
    return "Return to grant versions";
  }
  if (href.includes("/studio/")) {
    return "Return to Publish review";
  }
  return "Return to where you started";
}
