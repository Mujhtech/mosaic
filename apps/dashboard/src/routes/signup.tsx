import { createFileRoute } from "@tanstack/react-router"

import { AuthPageShell } from "@/features/auth/components/auth-page-shell"
import { SignupForm } from "@/features/auth/components/signup-form"
import { safeInternalReturnTo } from "@/features/auth/types/hosted-access"

interface AuthRouteSearch {
  returnTo?: string
}

export const Route = createFileRoute("/signup")({
  component: SignupRoute,
  validateSearch: (search: Record<string, unknown>): AuthRouteSearch => {
    const returnTo = safeInternalReturnTo(search.returnTo, "")
    return returnTo ? { returnTo } : {}
  },
})

function SignupRoute() {
  const { returnTo } = Route.useSearch()
  return (
    <AuthPageShell>
      <SignupForm returnTo={returnTo} />
    </AuthPageShell>
  )
}
