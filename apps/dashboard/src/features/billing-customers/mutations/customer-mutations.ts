import { mutationOptions, type QueryClient } from "@tanstack/react-query";
import { customerKeys } from "@/features/billing-customers/queries/customer-queries";
import {
  type BillingCustomerLookupRequest,
  createBillingCustomerSyncRequest,
  lookupBillingCustomer,
} from "@/generated/api";
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client";

/**
 * The typed-identifier lookup is a mutation, not a query.
 *
 * Not because it changes anything — it does not — but because a query would
 * have to key the cache on the raw identifier the operator typed, and that is
 * the one value this whole surface is arranged to keep out of stored state. It
 * travels in a POST body so it also stays out of URLs, access logs, and browser
 * history.
 */
export function lookupBillingCustomerMutationOptions(
  projectId: string,
  environmentId: string
) {
  return mutationOptions({
    mutationFn: async (request: BillingCustomerLookupRequest) => {
      const result = await lookupBillingCustomer({
        body: request,
        client: generatedDashboardClient,
        path: { environmentId, projectId },
        throwOnError: true,
      });
      // A miss answers 200 with `found: false`. It is a result, not an error,
      // and the caller renders it as one.
      return result.data.data;
    },
  });
}

/**
 * Queue a projection recomputation for one customer.
 *
 * This is emphatically not a device restore: no operator action can make a
 * store replay a person's purchases. It recomputes committed access from the
 * facts Mosaic already holds, which is what fixes a stale or failed projection
 * and does nothing at all for a customer whose purchases were never ingested.
 *
 * The answer is "this has been queued". Triggers coalesce onto the customer
 * scope, so an impatient operator clicking twice produces one projection rather
 * than two.
 */
export function requestCustomerSyncMutationOptions(
  projectId: string,
  environmentId: string,
  customerId: string,
  queryClient: QueryClient
) {
  return mutationOptions({
    mutationFn: async () => {
      const result = await createBillingCustomerSyncRequest({
        client: generatedDashboardClient,
        path: { customerId, environmentId, projectId },
        throwOnError: true,
      });
      return result.data.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: customerKeys.detail(projectId, environmentId, customerId),
      });
      await queryClient.invalidateQueries({
        queryKey: customerKeys.entitlements(
          projectId,
          environmentId,
          customerId
        ),
      });
    },
  });
}
