import { createFileRoute } from "@tanstack/react-router"

import { AuthPageShell } from "@/features/auth/components/auth-page-shell"
import { SignupForm } from "@/features/auth/components/signup-form"

export const Route = createFileRoute("/signup")({
  component: SignupRoute,
})

function SignupRoute() {
  return (
    <AuthPageShell>
      <SignupForm />
    </AuthPageShell>
  )
}
