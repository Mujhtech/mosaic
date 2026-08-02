import { mutationOptions, type QueryClient } from "@tanstack/react-query";
import { billingHealthKeys } from "@/features/billing-operations/queries/billing-health-queries";
import { billingSettingsKeys } from "@/features/store-connections/queries/billing-settings-queries";
import { updateBillingSettings } from "@/generated/api";
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client";

/**
 * Turning Mosaic Billing on and off for a Project.
 *
 * Disabling is refused with `409 store_credentials_still_active` while any
 * Store Server Credential is active, because disabling alone would not stop
 * Apple posting to an endpoint whose intake token still resolves — and every
 * refusal spends one of Apple's five non-renewable delivery attempts. Revoking
 * the credential is what actually stops the store. The 409 is surfaced with
 * that explanation and a link to the credentials, not swallowed.
 */
export function updateBillingSettingsMutationOptions(
  projectId: string,
  queryClient: QueryClient
) {
  return mutationOptions({
    mutationFn: async ({ billingEnabled }: { billingEnabled: boolean }) => {
      const result = await updateBillingSettings({
        body: { billingEnabled },
        client: generatedDashboardClient,
        path: { projectId },
        throwOnError: true,
      });
      return result.data.data;
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: billingSettingsKeys.scope(projectId),
        }),
        // Health reports the same flag, and every billing surface reads it to
        // decide between "not set up" and "no data yet".
        queryClient.invalidateQueries({
          queryKey: billingHealthKeys.scope(projectId),
        }),
      ]);
    },
  });
}
