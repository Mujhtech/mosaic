import { queryOptions } from "@tanstack/react-query"

import {
  getBillingCustomerEntitlementSnapshot,
  getBillingSubscription,
  getOperatorBillingCustomer,
  listBillingCustomers,
  listBillingCustomerSubscriptions,
  listBillingSubscriptionTimeline,
} from "@/generated/api"
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client"

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
    ["billing-customers", projectId, environmentId, "customer", customerId] as const,
  entitlements: (projectId: string, environmentId: string, customerId: string) =>
    ["billing-customers", projectId, environmentId, "entitlements", customerId] as const,
  list: (projectId: string, environmentId: string, filters: Record<string, unknown>) =>
    ["billing-customers", projectId, environmentId, "customers", filters] as const,
  scope: (projectId: string, environmentId: string) =>
    ["billing-customers", projectId, environmentId] as const,
  subscription: (projectId: string, environmentId: string, instanceId: string) =>
    ["billing-customers", projectId, environmentId, "subscription", instanceId] as const,
  subscriptions: (projectId: string, environmentId: string, customerId: string) =>
    ["billing-customers", projectId, environmentId, "subscriptions", customerId] as const,
  timeline: (projectId: string, environmentId: string, instanceId: string) =>
    ["billing-customers", projectId, environmentId, "timeline", instanceId] as const,
}

export interface CustomerListFilters {
  conflictedOnly?: boolean
  cursor?: string
  identified?: boolean
  limit?: number
  status?: "active" | "anonymized" | "frozen"
}

export function billingCustomersQueryOptions(
  projectId: string,
  environmentId: string,
  filters: CustomerListFilters = {},
) {
  const query = {
    limit: filters.limit ?? 25,
    ...(filters.cursor ? { cursor: filters.cursor } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.identified === undefined ? {} : { identified: filters.identified }),
    ...(filters.conflictedOnly ? { conflictedOnly: true } : {}),
  }
  return queryOptions({
    queryKey: customerKeys.list(projectId, environmentId, query),
    queryFn: async ({ signal }) => {
      const result = await listBillingCustomers({
        client: generatedDashboardClient,
        path: { environmentId, projectId },
        query,
        signal,
        throwOnError: true,
      })
      return {
        items: result.data.data?.items ?? [],
        nextCursor: result.data.data?.nextCursor,
      }
    },
  })
}

export function billingCustomerQueryOptions(
  projectId: string,
  environmentId: string,
  customerId: string,
) {
  return queryOptions({
    queryKey: customerKeys.detail(projectId, environmentId, customerId),
    queryFn: async ({ signal }) => {
      const result = await getOperatorBillingCustomer({
        client: generatedDashboardClient,
        path: { customerId, environmentId, projectId },
        signal,
        throwOnError: true,
      })
      return result.data.data
    },
  })
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
) {
  return queryOptions({
    queryKey: customerKeys.entitlements(projectId, environmentId, customerId),
    queryFn: async ({ signal }) => {
      const result = await getBillingCustomerEntitlementSnapshot({
        client: generatedDashboardClient,
        path: { customerId, environmentId, projectId },
        signal,
        throwOnError: true,
      })
      return result.data.data
    },
  })
}

export function customerSubscriptionsQueryOptions(
  projectId: string,
  environmentId: string,
  customerId: string,
) {
  return queryOptions({
    queryKey: customerKeys.subscriptions(projectId, environmentId, customerId),
    queryFn: async ({ signal }) => {
      const result = await listBillingCustomerSubscriptions({
        client: generatedDashboardClient,
        path: { customerId, environmentId, projectId },
        query: { limit: 50 },
        signal,
        throwOnError: true,
      })
      return result.data.data?.items ?? []
    },
  })
}

export function subscriptionQueryOptions(
  projectId: string,
  environmentId: string,
  instanceId: string,
) {
  return queryOptions({
    queryKey: customerKeys.subscription(projectId, environmentId, instanceId),
    queryFn: async ({ signal }) => {
      const result = await getBillingSubscription({
        client: generatedDashboardClient,
        path: { environmentId, instanceId, projectId },
        signal,
        throwOnError: true,
      })
      return result.data.data
    },
  })
}

/**
 * The append-only explanation history for one Subscription Instance, newest
 * first. Entries are never trimmed: a superseded entry is still part of why the
 * current state is what it is.
 */
export function subscriptionTimelineQueryOptions(
  projectId: string,
  environmentId: string,
  instanceId: string,
) {
  return queryOptions({
    queryKey: customerKeys.timeline(projectId, environmentId, instanceId),
    queryFn: async ({ signal }) => {
      const result = await listBillingSubscriptionTimeline({
        client: generatedDashboardClient,
        path: { environmentId, instanceId, projectId },
        query: { limit: 100 },
        signal,
        throwOnError: true,
      })
      return result.data.data?.items ?? []
    },
  })
}
