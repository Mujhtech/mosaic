import { SquaresFourIcon } from "@phosphor-icons/react/dist/ssr/SquaresFour";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authenticateMutationOptions } from "@/features/auth/mutations/auth-mutations";
import { validatePassword } from "@/features/auth/types/credential-validation";
import { safeInternalReturnTo } from "@/features/auth/types/hosted-access";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface HostedCredentialFormProps {
  mode: "login" | "signup";
  returnTo?: string;
}

function validateEmail(value: string) {
  const email = value.trim();
  if (!email) {
    return "Enter an email address.";
  }
  if (!EMAIL_PATTERN.test(email)) {
    return "Enter a valid email address.";
  }
}

export function HostedCredentialForm({
  mode,
  returnTo,
}: HostedCredentialFormProps) {
  const isSignup = mode === "signup";
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const authenticate = useMutation(
    authenticateMutationOptions(mode, queryClient)
  );
  const form = useForm({
    defaultValues: { email: "", name: "", password: "" },
    onSubmit: async ({ value }) => {
      await authenticate.mutateAsync({
        email: value.email.trim(),
        name: value.name.trim(),
        password: value.password,
      });
      await navigate({ href: safeInternalReturnTo(returnTo), replace: true });
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          form.handleSubmit();
        }}
      >
        <FieldGroup>
          <div className="flex flex-col items-center gap-2 text-center">
            <Link
              className="flex flex-col items-center gap-2 font-medium"
              to="/studio"
            >
              <span className="grid size-9 place-items-center rounded bg-primary text-primary-foreground">
                <SquaresFourIcon aria-hidden weight="fill" />
              </span>
              <span className="sr-only">Mosaic Studio</span>
            </Link>
            <h1 className="font-bold text-xl">
              {isSignup ? "Create a Mosaic account" : "Sign in to Mosaic"}
            </h1>
            <FieldDescription>
              {isSignup ? "Already have an account? " : "Need an account? "}
              <Link
                search={
                  returnTo
                    ? { returnTo: safeInternalReturnTo(returnTo) }
                    : undefined
                }
                to={isSignup ? "/login" : "/signup"}
              >
                {isSignup ? "Sign in" : "Create one"}
              </Link>
            </FieldDescription>
          </div>

          {isSignup ? (
            <form.Field
              name="name"
              validators={{
                onBlur: ({ value }) =>
                  value.trim() ? undefined : "Enter your name.",
                onSubmit: ({ value }) =>
                  value.trim() ? undefined : "Enter your name.",
              }}
            >
              {(field) => (
                <Field
                  data-invalid={field.state.meta.errors.length > 0 || undefined}
                >
                  <FieldLabel htmlFor="signup-name">Name</FieldLabel>
                  <Input
                    aria-invalid={
                      field.state.meta.errors.length > 0 || undefined
                    }
                    autoComplete="name"
                    id="signup-name"
                    onBlur={field.handleBlur}
                    onChange={(event) =>
                      field.handleChange(event.currentTarget.value)
                    }
                    value={field.state.value}
                  />
                  <FieldError
                    errors={field.state.meta.errors.map((message) => ({
                      message,
                    }))}
                  />
                </Field>
              )}
            </form.Field>
          ) : null}

          <form.Field
            name="email"
            validators={{
              onBlur: ({ value }) => validateEmail(value),
              onSubmit: ({ value }) => validateEmail(value),
            }}
          >
            {(field) => (
              <Field
                data-invalid={field.state.meta.errors.length > 0 || undefined}
              >
                <FieldLabel htmlFor={`${mode}-email`}>Email</FieldLabel>
                <Input
                  aria-invalid={field.state.meta.errors.length > 0 || undefined}
                  autoComplete="email"
                  id={`${mode}-email`}
                  onBlur={field.handleBlur}
                  onChange={(event) =>
                    field.handleChange(event.currentTarget.value)
                  }
                  placeholder="developer@example.com"
                  type="email"
                  value={field.state.value}
                />
                <FieldError
                  errors={field.state.meta.errors.map((message) => ({
                    message,
                  }))}
                />
              </Field>
            )}
          </form.Field>

          <form.Field
            name="password"
            validators={{
              onBlur: ({ value }) => validatePassword(value, isSignup),
              onSubmit: ({ value }) => validatePassword(value, isSignup),
            }}
          >
            {(field) => (
              <Field
                data-invalid={field.state.meta.errors.length > 0 || undefined}
              >
                <FieldLabel htmlFor={`${mode}-password`}>Password</FieldLabel>
                <Input
                  aria-invalid={field.state.meta.errors.length > 0 || undefined}
                  autoComplete={isSignup ? "new-password" : "current-password"}
                  id={`${mode}-password`}
                  onBlur={field.handleBlur}
                  onChange={(event) =>
                    field.handleChange(event.currentTarget.value)
                  }
                  type="password"
                  value={field.state.value}
                />
                <FieldDescription>
                  {isSignup
                    ? "Use at least 12 characters."
                    : "Enter your account password."}
                </FieldDescription>
                <FieldError
                  errors={field.state.meta.errors.map((message) => ({
                    message,
                  }))}
                />
              </Field>
            )}
          </form.Field>

          {authenticate.error ? (
            <p className="text-destructive text-sm" role="alert">
              {authenticate.error.message}
            </p>
          ) : null}

          <Field>
            <form.Subscribe
              selector={(state) => [state.canSubmit, state.isSubmitting]}
            >
              {([canSubmit, isSubmitting]) => (
                <Button
                  disabled={
                    !canSubmit || isSubmitting || authenticate.isPending
                  }
                  type="submit"
                >
                  {(() => {
                    if (authenticate.isPending) {
                      return (() => {
                        if (isSignup) {
                          return "Creating account…";
                        }
                        return "Signing in…";
                      })();
                    }
                    if (isSignup) {
                      return "Create account";
                    }
                    return "Sign in";
                  })()}
                </Button>
              )}
            </form.Subscribe>
          </Field>
          {/* <FieldSeparator>Local development</FieldSeparator> */}
          {/* <div
            data-slot="field-separator"
            data-content="true"
            className="relative -my-2 h-5 text-sm group-data-[variant=outline]/field-group:-mb-2"
          >
            <div
              data-orientation="horizontal"
              role="none"
              data-slot="separator"
              className="bg-border absolute inset-0 top-1/2 shrink-0 data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px"
            ></div>
            <span
              className="bg-background text-muted-foreground relative mx-auto block w-fit px-2"
              data-slot="field-separator-content"
            >
              Local development
            </span>
          </div> */}
          <Field>
            <Link
              className={buttonVariants({ variant: "outline" })}
              to="/studio"
            >
              Continue without an account
            </Link>
          </Field>
        </FieldGroup>
      </form>
    </div>
  );
}
