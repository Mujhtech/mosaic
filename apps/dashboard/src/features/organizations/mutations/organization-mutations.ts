import { mutationOptions, type QueryClient } from "@tanstack/react-query"

import { createOrganization, type CreateOrganizationRequest } from "@/generated/api"
import { organizationKeys } from "@/features/organizations/queries/organizations-query"
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client"

export function createOrganizationMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: async (body: CreateOrganizationRequest) => {
      const result = await createOrganization({
        body,
        client: generatedDashboardClient,
        throwOnError: true,
      })
      return result.data.data
    },
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: organizationKeys.all }),
  })
}
