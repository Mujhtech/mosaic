import { HostedCredentialForm } from "@/features/auth/components/hosted-credential-form"
import { cn } from "@/lib/utils"

export function LoginForm({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <HostedCredentialForm mode="login" />
    </div>
  )
}
