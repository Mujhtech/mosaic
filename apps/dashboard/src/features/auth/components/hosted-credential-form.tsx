import { SquaresFourIcon } from "@phosphor-icons/react/dist/ssr/SquaresFour"
import { useForm } from "@tanstack/react-form"
import { Link } from "@tanstack/react-router"

import { Button } from "@/components/ui/button"
import { buttonVariants } from "@/components/ui/button-variants"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"

interface HostedCredentialFormProps {
  mode: "login" | "signup"
}

function validateEmail(value: string) {
  const email = value.trim()
  if (!email) return "Enter an email address."
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email address."
  return undefined
}

export function HostedCredentialForm({ mode }: HostedCredentialFormProps) {
  const isSignup = mode === "signup"
  const form = useForm({
    defaultValues: { email: "" },
    onSubmit: async () => undefined,
  })

  return (
    <div className="flex flex-col gap-6">
      <form
        aria-describedby="hosted-auth-decision"
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
      >
        <FieldGroup>
          <div className="flex flex-col items-center gap-2 text-center">
            <Link className="flex flex-col items-center gap-2 font-medium" to="/studio">
              <span className="bg-primary text-primary-foreground grid size-9 place-items-center rounded-lg">
                <SquaresFourIcon aria-hidden weight="fill" />
              </span>
              <span className="sr-only">Mosaic Studio</span>
            </Link>
            <h1 className="text-xl font-bold">
              {isSignup ? "Create a Mosaic account" : "Sign in to Mosaic"}
            </h1>
            <FieldDescription>
              {isSignup ? "Already have an account? " : "Need an account? "}
              <Link to={isSignup ? "/login" : "/signup"}>
                {isSignup ? "View sign in" : "View sign up"}
              </Link>
            </FieldDescription>
          </div>

          <form.Field name="email" validators={{ onBlur: ({ value }) => validateEmail(value) }}>
            {(field) => (
              <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
                <FieldLabel htmlFor={`${mode}-email`}>Email</FieldLabel>
                <Input
                  aria-invalid={field.state.meta.errors.length > 0 || undefined}
                  autoComplete="email"
                  id={`${mode}-email`}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="developer@example.com"
                  type="email"
                  value={field.state.value}
                />
                <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
              </Field>
            )}
          </form.Field>

          <Field>
            <Button aria-describedby="hosted-auth-decision" disabled type="submit">
              {isSignup ? "Create account" : "Continue with email"}
            </Button>
          </Field>
          <FieldSeparator>Local development</FieldSeparator>
          <Field>
            <Link className={buttonVariants({ variant: "outline" })} to="/studio">
              Continue without an account
            </Link>
          </Field>
        </FieldGroup>
      </form>
      <div
        className="border-border bg-muted/40 rounded-lg border p-4 text-sm leading-6"
        id="hosted-auth-decision"
        role="status"
      >
        <p className="font-medium">Hosted authentication is awaiting an owner decision.</p>
        <p className="text-muted-foreground mt-1">
          No identity provider, credential scheme, or browser session mechanism has been selected.
          This form validates locally but cannot create a session. Local Studio remains available.
        </p>
      </div>
    </div>
  )
}
