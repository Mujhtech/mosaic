import { mutationOptions, type QueryClient } from "@tanstack/react-query"

import { login, logout, signUp } from "@/generated/api/sdk.gen"
import { sessionKeys } from "@/features/auth/queries/session-query"
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client"

export function authenticateMutationOptions(mode: "login" | "signup", queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: async (input: { email: string; name: string; password: string }) => {
      const result =
        mode === "signup"
          ? await signUp({
              body: { email: input.email, name: input.name, password: input.password },
              client: generatedDashboardClient,
              throwOnError: true,
            })
          : await login({
              body: { email: input.email, password: input.password },
              client: generatedDashboardClient,
              throwOnError: true,
            })
      return result.data.data
    },
    onSuccess: (user) => queryClient.setQueryData(sessionKeys.current, user),
  })
}

export function logoutMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: async () => {
      await logout({ client: generatedDashboardClient, throwOnError: true })
    },
    onSuccess: () => queryClient.removeQueries({ queryKey: sessionKeys.current }),
  })
}
