import { SquaresFourIcon } from "@phosphor-icons/react/dist/ssr/SquaresFour"
import { Link } from "@tanstack/react-router"

import { Button } from "@/components/ui/button"
import { buttonVariants } from "@/components/ui/button-variants"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

export function LoginForm({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <form aria-describedby="login-local-mode">
        <FieldGroup>
          <div className="flex flex-col items-center gap-2 text-center">
            <Link className="flex flex-col items-center gap-2 font-medium" to="/">
              <span className="bg-primary text-primary-foreground grid size-9 place-items-center rounded-lg">
                <SquaresFourIcon aria-hidden weight="fill" />
              </span>
              <span className="sr-only">Mosaic Studio</span>
            </Link>
            <h1 className="text-xl font-bold">Sign in to Mosaic</h1>
            <FieldDescription>
              Need the registration scaffold? <Link to="/signup">View sign up</Link>
            </FieldDescription>
          </div>
          <Field>
            <FieldLabel htmlFor="login-email">Email</FieldLabel>
            <Input disabled id="login-email" placeholder="developer@example.com" type="email" />
          </Field>
          <Field>
            <Button disabled type="button">
              Continue with email
            </Button>
          </Field>
          <FieldSeparator>Local development</FieldSeparator>
          <Field>
            <Link className={buttonVariants({ variant: "outline" })} to="/">
              Continue without an account
            </Link>
          </Field>
        </FieldGroup>
      </form>
      <FieldDescription className="px-2 text-center" id="login-local-mode">
        Authentication is visual scaffolding only. Phase 2 Studio runs locally and never requires an
        account.
      </FieldDescription>
    </div>
  )
}
