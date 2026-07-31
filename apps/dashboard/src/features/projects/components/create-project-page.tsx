import { useForm } from "@tanstack/react-form"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"

import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { createProjectMutationOptions } from "@/features/projects/mutations/project-mutations"
import { WorkspacePage, WorkflowPanel } from "@/features/organizations/components/workspace-page"

const KEY_PATTERN = /^[a-z][a-z0-9_-]{1,62}$/

export function CreateProjectPage({ organizationId }: { organizationId: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const mutation = useMutation(createProjectMutationOptions(queryClient))
  const form = useForm({
    defaultValues: { key: "", name: "" },
    onSubmit: async ({ value }) => {
      const project = await mutation.mutateAsync({
        key: value.key.trim(),
        name: value.name.trim(),
        organizationId,
      })
      await navigate({
        params: { organizationId, projectId: project.id },
        to: "/organizations/$organizationId/projects/$projectId",
      })
    },
  })

  return (
    <WorkspacePage
      description="Projects group a product's iOS and Android apps, three isolated environments, and one project-wide Catalog."
      title="Create project"
    >
      <WorkflowPanel title="Project details">
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
              onBlur: ({ value }) => (value.trim() ? undefined : "Enter a project name."),
            }}
          >
            {(field) => (
              <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
                <FieldLabel htmlFor="project-name">Project name</FieldLabel>
                <Input
                  id="project-name"
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="Acme Pro"
                  value={field.state.value}
                />
                <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
              </Field>
            )}
          </form.Field>
          <form.Field
            name="key"
            validators={{
              onBlur: ({ value }) =>
                KEY_PATTERN.test(value.trim())
                  ? undefined
                  : "Start with a letter and use lowercase letters, numbers, underscores, or hyphens.",
            }}
          >
            {(field) => (
              <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
                <FieldLabel htmlFor="project-key">Project key</FieldLabel>
                <Input
                  id="project-key"
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value.toLowerCase())}
                  placeholder="acme_pro"
                  value={field.state.value}
                />
                <FieldDescription>Unique within the organization.</FieldDescription>
                <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
              </Field>
            )}
          </form.Field>
          <p className="text-muted-foreground text-sm leading-6">
            Development, Staging, and Production are created automatically. Environment keys are
            immutable.
          </p>
          {mutation.error ? (
            <p className="text-destructive text-sm" role="alert">
              {mutation.error.message}
            </p>
          ) : null}
          <Button disabled={mutation.isPending} type="submit">
            {mutation.isPending ? "Creating…" : "Create project"}
          </Button>
        </form>
      </WorkflowPanel>
    </WorkspacePage>
  )
}
