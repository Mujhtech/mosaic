import { createFileRoute } from "@tanstack/react-router"

import { AuthPageShell } from "@/features/auth/components/auth-page-shell"
import { LoginForm } from "@/features/auth/components/login-form"

export const Route = createFileRoute("/login")({
  component: LoginRoute,
})

function LoginRoute() {
  return (
    <AuthPageShell>
      <LoginForm />
    </AuthPageShell>
  )
}
