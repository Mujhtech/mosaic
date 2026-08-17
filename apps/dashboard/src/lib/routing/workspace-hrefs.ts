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
  /**
   * The Environment as an address names it — `prod`, `staging`, `dev` — which is
   * what every route under `/env` carries. It is deliberately separate from
   * `environmentId`: `environmentForAlias` refuses to resolve an id, so a link
   * built from one would not land.
   */
  environmentKey?: string;
  organizationId?: string;
  projectId?: string;
}

/**
 * The fragment the analytics-collection control on Environment settings answers
 * to. Both `analytics_collection_disabled` recovery paths — the coded API error
 * and the tri-state overview metric — point at that one control, so the anchor
 * is named once here and consumed by the panel that renders it.
 */
export const ANALYTICS_COLLECTION_ANCHOR = "analytics-collection";

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

/**
 * Environment settings, which is where analytics collection is turned on and
 * off. Settings moved under `/env/$environmentKey` with the rest of the
 * Environment-scoped workspace; this helper kept building the pre-move shape and
 * produced an address that no longer resolves.
 *
 * The Environment segment is required rather than defaulted. Defaulting would
 * send an operator whose Production metrics are dark to the Development
 * Environment's settings, where the toggle they are looking for is already on.
 */
export function environmentSettingsHref(scope: WorkspaceScope) {
  const base = projectBase(scope);
  if (!(base && scope.environmentKey)) {
    return;
  }
  return `${base}/env/${encodeURIComponent(scope.environmentKey)}/settings/environments`;
}

/**
 * Environment settings, addressed at the analytics-collection control rather
 * than at the top of the page. A recovery link that lands an operator on a page
 * containing the fix, without saying which control it is, is only half a
 * recovery.
 */
export function analyticsCollectionSettingsHref(scope: WorkspaceScope) {
  const base = environmentSettingsHref(scope);
  return base ? `${base}#${ANALYTICS_COLLECTION_ANCHOR}` : undefined;
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
