import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary"
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state"
import { WorkspacePage, WorkflowPanel } from "@/features/organizations/components/workspace-page"
import { ScopeMismatchRecovery } from "@/features/organizations/components/scope-mismatch-recovery"
import { useValidatedProjectScope } from "@/features/projects/hooks/use-validated-project-scope"
import { createApplicationMutationOptions } from "@/features/projects/mutations/project-mutations"
import { applicationsQueryOptions } from "@/features/projects/queries/projects-query"

interface ApplicationsPageProps {
  organizationId: string
  projectId: string
}

export function ApplicationsPage({ organizationId, projectId }: ApplicationsPageProps) {
  const queryClient = useQueryClient()
  const { project, scopeMismatch, scopeReady } = useValidatedProjectScope(organizationId, projectId)
  const applications = useQuery({ ...applicationsQueryOptions(projectId), enabled: scopeReady })
  const mutation = useMutation(createApplicationMutationOptions(projectId, queryClient))
  const items = applications.data?.items ?? []
  const form = useForm({
    defaultValues: { identifier: "", name: "", platform: "ios" as "android" | "ios" },
    onSubmit: async ({ value }) => {
      await mutation.mutateAsync({
        identifier: value.identifier.trim(),
        name: value.name.trim(),
        platform: value.platform,
      })
      form.reset()
    },
  })
  const state = resolveHostedQueryState({
    emptyDescription:
      "Register an iOS bundle ID or Android package identifier. Framework is intentionally not collected.",
    emptyTitle: "No applications registered",
    error: project.error ?? applications.error,
    isEmpty: scopeReady && applications.isSuccess && items.length === 0,
    isPending: project.isPending || (scopeReady && applications.isPending),
    loadingDescription: "Loading project applications.",
    onRetry: () => void applications.refetch(),
    permissionDescription:
      "Project membership is required to view applications; owner or admin is required to register one.",
  })
  const canManageApplications = state.kind === "empty" || state.kind === "ready"

  if (scopeMismatch) {
    return (
      <WorkspacePage
        description="The routed Organization does not own this Project."
        title="Applications unavailable in this Organization"
      >
        <ScopeMismatchRecovery
          mismatch={scopeMismatch}
          organizationId={organizationId}
          projectId={projectId}
        />
      </WorkspacePage>
    )
  }

  return (
    <WorkspacePage
      description="Applications are concrete iOS or Android identities and remain project-wide."
      eyebrow="Project-wide"
      title="Applications"
    >
      <HostedResourceBoundary state={state}>
        <WorkflowPanel title="Registered applications">
          <ul className="divide-y">
            {items.map((application) => (
              <li className="flex items-start justify-between gap-4 py-4" key={application.id}>
                <span>
                  <span className="block text-sm font-semibold">{application.name}</span>
                  <span className="text-muted-foreground mt-1 block font-mono text-xs">
                    {application.identifier}
                  </span>
                </span>
                <span className="bg-muted rounded-full px-2.5 py-1 text-xs font-medium uppercase">
                  {application.platform}
                </span>
              </li>
            ))}
          </ul>
        </WorkflowPanel>
      </HostedResourceBoundary>
      {canManageApplications ? (
        <WorkflowPanel title="Register application">
          <form
            className="grid gap-4 md:grid-cols-3"
            onSubmit={(event) => {
              event.preventDefault()
              event.stopPropagation()
              void form.handleSubmit()
            }}
          >
            <form.Field name="name">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="app-name">Name</FieldLabel>
                  <Input
                    id="app-name"
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="Acme iOS"
                    value={field.state.value}
                  />
                </Field>
              )}
            </form.Field>
            <form.Field name="platform">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="app-platform">Platform</FieldLabel>
                  <select
                    className="border-input bg-background h-9 rounded-md border px-3 text-sm"
                    id="app-platform"
                    onChange={(event) =>
                      field.handleChange(event.target.value as "android" | "ios")
                    }
                    value={field.state.value}
                  >
                    <option value="ios">iOS</option>
                    <option value="android">Android</option>
                  </select>
                  <FieldDescription>No framework field.</FieldDescription>
                </Field>
              )}
            </form.Field>
            <form.Field name="identifier">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="app-identifier">Bundle or package identifier</FieldLabel>
                  <Input
                    id="app-identifier"
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder={
                      field.form.getFieldValue("platform") === "ios"
                        ? "com.example.app"
                        : "dev.example.app"
                    }
                    value={field.state.value}
                  />
                </Field>
              )}
            </form.Field>
            <Button className="md:col-start-3" disabled={mutation.isPending} type="submit">
              {mutation.isPending ? "Registering…" : "Register application"}
            </Button>
          </form>
          {mutation.error ? (
            <p className="text-destructive mt-4 text-sm" role="alert">
              {mutation.error.message}
            </p>
          ) : null}
        </WorkflowPanel>
      ) : null}
    </WorkspacePage>
  )
}
