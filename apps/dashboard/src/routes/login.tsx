import { createFileRoute } from "@tanstack/react-router"

import { AuthPageShell } from "@/features/auth/components/auth-page-shell"
import { LoginForm } from "@/features/auth/components/login-form"
import { safeInternalReturnTo } from "@/features/auth/types/hosted-access"

interface AuthRouteSearch {
  returnTo?: string
}

export const Route = createFileRoute("/login")({
  component: LoginRoute,
  validateSearch: (search: Record<string, unknown>): AuthRouteSearch => {
    const returnTo = safeInternalReturnTo(search.returnTo, "")
    return returnTo ? { returnTo } : {}
  },
})

function LoginRoute() {
  const { returnTo } = Route.useSearch()
  return (
    <AuthPageShell>
      <LoginForm returnTo={returnTo} />
    </AuthPageShell>
  )
}
