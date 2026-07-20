import { mutationOptions, type QueryClient } from "@tanstack/react-query"

import { addMember, type AddMemberRequest } from "@/generated/api"
import { memberKeys } from "@/features/members/queries/members-query"
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client"

export function addMemberMutationOptions(organizationId: string, queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: async (body: AddMemberRequest) => {
      const result = await addMember({
        body,
        client: generatedDashboardClient,
        path: { organizationId },
        throwOnError: true,
      })
      return result.data.data
    },
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: memberKeys.list(organizationId) }),
  })
}
