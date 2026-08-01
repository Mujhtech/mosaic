import { HostedCredentialForm } from "@/features/auth/components/hosted-credential-form";
import { cn } from "@/lib/utils";

export function SignupForm({
  className,
  returnTo,
  ...props
}: React.ComponentProps<"div"> & { returnTo?: string }) {
  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <HostedCredentialForm mode="signup" returnTo={returnTo} />
    </div>
  );
}
