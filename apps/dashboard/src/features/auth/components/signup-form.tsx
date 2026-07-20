import { HostedCredentialForm } from "@/features/auth/components/hosted-credential-form"
import { cn } from "@/lib/utils"

export function SignupForm({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <HostedCredentialForm mode="signup" />
    </div>
  )
}
