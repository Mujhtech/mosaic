import { queryOptions } from "@tanstack/react-query";

import {
  getBillingCustomerEntitlementSnapshot,
  getBillingSubscription,
  getOperatorBillingCustomer,
  listBillingCustomerSubscriptions,
  listBillingCustomers,
  listBillingSubscriptionTimeline,
} from "@/generated/api";
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client";

/**
 * Authoritative customer reads.
 *
 * No query key here carries a raw identifier a person could be recognised by:
 * the list and detail keys hold Mosaic identifiers only. The typed-identifier
 * lookup is deliberately absent from this module — it is a POST whose body must
 * not be cached under a key, so it lives as a mutation.
 */
export const customerKeys = {
  detail: (projectId: string, environmentId: string, customerId: string) =>
    [
      "billing-customers",
      projectId,
      environmentId,
      "customer",
      customerId,
    ] as const,
  entitlements: (
    projectId: string,
    environmentId: string,
    customerId: string
  ) =>
    [
      "billing-customers",
      projectId,
      environmentId,
      "entitlements",
      customerId,
    ] as const,
  list: (
    projectId: string,
    environmentId: string,
    filters: Record<string, unknown>
  ) =>
    [
      "billing-customers",
      projectId,
      environmentId,
      "customers",
      filters,
    ] as const,
  scope: (projectId: string, environmentId: string) =>
    ["billing-customers", projectId, environmentId] as const,
  subscription: (
    projectId: string,
    environmentId: string,
    instanceId: string
  ) =>
    [
      "billing-customers",
      projectId,
      environmentId,
      "subscription",
      instanceId,
    ] as const,
  subscriptions: (
    projectId: string,
    environmentId: string,
    customerId: string,
    cursor?: string
  ) =>
    [
      "billing-customers",
      projectId,
      environmentId,
      "subscriptions",
      customerId,
      cursor ?? null,
    ] as const,
  timeline: (
    projectId: string,
    environmentId: string,
    instanceId: string,
    cursor?: string
  ) =>
    [
      "billing-customers",
      projectId,
      environmentId,
      "timeline",
      instanceId,
      cursor ?? null,
    ] as const,
};

/** The page size every paged customer surface asks for. */
export const CUSTOMER_PAGE_SIZE = 50;

export interface CustomerListFilters {
  conflictedOnly?: boolean;
  cursor?: string;
  identified?: boolean;
  limit?: number;
  status?: "absorbed" | "active" | "anonymized" | "frozen";
}

export function billingCustomersQueryOptions(
  projectId: string,
  environmentId: string,
  filters: CustomerListFilters = {}
) {
  const query = {
    limit: filters.limit ?? 25,
    ...(filters.cursor ? { cursor: filters.cursor } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.identified === undefined
      ? {}
      : { identified: filters.identified }),
    ...(filters.conflictedOnly ? { conflictedOnly: true } : {}),
  };
  return queryOptions({
    queryKey: customerKeys.list(projectId, environmentId, query),
    queryFn: async ({ signal }) => {
      const result = await listBillingCustomers({
        client: generatedDashboardClient,
        path: { environmentId, projectId },
        query,
        signal,
        throwOnError: true,
      });
      return {
        items: result.data.data?.items ?? [],
        nextCursor: result.data.data?.nextCursor,
      };
    },
  });
}

/** How often a customer surface re-reads while a projection is outstanding. */
export const PROJECTION_POLL_INTERVAL_MS = 5000;

/**
 * Poll only while something is genuinely expected to move, and stop the moment
 * it has.
 *
 * A projection runs on a worker, so `pending` is a state the page leaves on its
 * own — without polling an operator watches a stale answer and reaches for the
 * refresh button, or worse, believes it. `current` is terminal and ends the
 * polling; nothing else does, because a `failed` or `stale` projection will not
 * resolve itself and repeating the read forever would be an idle page making
 * requests until the tab closes. This is the same terminal-state shape the
 * restore list uses.
 *
 * `recomputeQueued` covers the gap between an operator queueing a recomputation
 * and the status catching up: the request is accepted before the worker marks
 * anything pending, so without it the page would sit still for exactly the
 * interval where the operator is watching hardest.
 */
export function projectionRefetchInterval(
  state: string | undefined,
  recomputeQueued: boolean
): number | false {
  if (state === "current") {
    return false;
  }
  if (state === "pending" || recomputeQueued) {
    return PROJECTION_POLL_INTERVAL_MS;
  }
  return false;
}

export function billingCustomerQueryOptions(
  projectId: string,
  environmentId: string,
  customerId: string,
  recomputeQueued = false
) {
  return queryOptions({
    queryKey: customerKeys.detail(projectId, environmentId, customerId),
    queryFn: async ({ signal }) => {
      const result = await getOperatorBillingCustomer({
        client: generatedDashboardClient,
        path: { customerId, environmentId, projectId },
        signal,
        throwOnError: true,
      });
      return result.data.data;
    },
    refetchInterval: (query) =>
      projectionRefetchInterval(
        query.state.data?.projectionStatus?.state,
        recomputeQueued
      ),
  });
}

/**
 * The current Customer Entitlement Snapshot, read separately from the customer
 * detail so a projection that moves refreshes the entitlement panel without
 * refetching aliases and lineages that did not.
 */
export function customerEntitlementSnapshotQueryOptions(
  projectId: string,
  environmentId: string,
  customerId: string,
  recomputeQueued = false
) {
  return queryOptions({
    queryKey: customerKeys.entitlements(projectId, environmentId, customerId),
    queryFn: async ({ signal }) => {
      const result = await getBillingCustomerEntitlementSnapshot({
        client: generatedDashboardClient,
        path: { customerId, environmentId, projectId },
        signal,
        throwOnError: true,
      });
      return result.data.data;
    },
    refetchInterval: (query) =>
      projectionRefetchInterval(
        query.state.data?.projectionStatus?.state,
        recomputeQueued
      ),
  });
}

/**
 * Every Subscription Instance for one customer, paged.
 *
 * The customer detail read embeds a bounded first slice so the page is one
 * request. This is the surface an operator reaches for when that slice is not
 * all of them, so it pages properly rather than repeating the same cap under a
 * different name.
 */
export function customerSubscriptionsQueryOptions(
  projectId: string,
  environmentId: string,
  customerId: string,
  cursor?: string
) {
  return queryOptions({
    queryKey: customerKeys.subscriptions(
      projectId,
      environmentId,
      customerId,
      cursor
    ),
    queryFn: async ({ signal }) => {
      const result = await listBillingCustomerSubscriptions({
        client: generatedDashboardClient,
        path: { customerId, environmentId, projectId },
        query: { limit: CUSTOMER_PAGE_SIZE, ...(cursor ? { cursor } : {}) },
        signal,
        throwOnError: true,
      });
      return {
        items: result.data.data?.items ?? [],
        nextCursor: result.data.data?.nextCursor,
      };
    },
  });
}

export function subscriptionQueryOptions(
  projectId: string,
  environmentId: string,
  instanceId: string
) {
  return queryOptions({
    queryKey: customerKeys.subscription(projectId, environmentId, instanceId),
    queryFn: async ({ signal }) => {
      const result = await getBillingSubscription({
        client: generatedDashboardClient,
        path: { environmentId, instanceId, projectId },
        signal,
        throwOnError: true,
      });
      return result.data.data;
    },
  });
}

/**
 * The append-only explanation history for one Subscription Instance, newest
 * first.
 *
 * Nothing is ever *deleted* from this history — a superseded entry is still
 * part of why the current state is what it is — but one response is a page, not
 * the history. The distinction matters because the two claims are easy to
 * conflate into "you are looking at everything", and a long-lived subscription
 * with a year of renewals and retries has far more than one page. The cursor is
 * therefore carried through to the caller rather than discarded.
 */
export function subscriptionTimelineQueryOptions(
  projectId: string,
  environmentId: string,
  instanceId: string,
  cursor?: string
) {
  return queryOptions({
    queryKey: customerKeys.timeline(
      projectId,
      environmentId,
      instanceId,
      cursor
    ),
    queryFn: async ({ signal }) => {
      const result = await listBillingSubscriptionTimeline({
        client: generatedDashboardClient,
        path: { environmentId, instanceId, projectId },
        query: { limit: CUSTOMER_PAGE_SIZE, ...(cursor ? { cursor } : {}) },
        signal,
        throwOnError: true,
      });
      return {
        items: result.data.data?.items ?? [],
        nextCursor: result.data.data?.nextCursor,
      };
    },
  });
}
