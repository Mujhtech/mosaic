import { useForm } from "@tanstack/react-form"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"

import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { HostedAccessBanner } from "@/features/auth/components/hosted-access-banner"
import { createOrganizationMutationOptions } from "@/features/orgs/mutations/organization-mutations"
import { WorkspacePage, WorkflowPanel } from "@/features/orgs/components/workspace-page"
import { ApiError } from "@/lib/api/errors"

export function CreateOrganizationPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const mutation = useMutation(createOrganizationMutationOptions(queryClient))
  const form = useForm({
    defaultValues: { name: "" },
    onSubmit: async ({ value }) => {
      const organization = await mutation.mutateAsync({ name: value.name.trim() })
      await navigate({
        params: { organizationId: organization.id },
        to: "/orgs/$organizationId",
      })
    },
  })

  return (
    <WorkspacePage
      description="An organization is Mosaic's tenant and membership boundary."
      title="Create organization"
    >
      {mutation.error instanceof ApiError && mutation.error.status === 401 ? (
        <HostedAccessBanner />
      ) : null}
      <WorkflowPanel title="Organization details">
        <form
          className="max-w-xl space-y-5"
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void form.handleSubmit()
          }}
        >
          <form.Field
            name="name"
            validators={{
              onBlur: ({ value }) =>
                value.trim().length === 0
                  ? "Enter an organization name."
                  : value.trim().length > 120
                    ? "Use 120 characters or fewer."
                    : undefined,
            }}
          >
            {(field) => (
              <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
                <FieldLabel htmlFor="organization-name">Organization name</FieldLabel>
                <Input
                  aria-invalid={field.state.meta.errors.length > 0 || undefined}
                  autoComplete="organization"
                  id="organization-name"
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="Acme Mobile"
                  value={field.state.value}
                />
                <FieldDescription>Visible to every member of this organization.</FieldDescription>
                <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
              </Field>
            )}
          </form.Field>
          {mutation.error &&
          !(mutation.error instanceof ApiError && mutation.error.status === 401) ? (
            <p className="text-destructive text-sm" role="alert">
              {mutation.error.message}
            </p>
          ) : null}
          <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
            {([canSubmit, isSubmitting]) => (
              <Button disabled={!canSubmit || isSubmitting || mutation.isPending} type="submit">
                {mutation.isPending ? "Creating…" : "Create organization"}
              </Button>
            )}
          </form.Subscribe>
        </form>
      </WorkflowPanel>
    </WorkspacePage>
  )
}
