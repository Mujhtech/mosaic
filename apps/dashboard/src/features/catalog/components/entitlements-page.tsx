import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"

import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary"
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state"
import { createEntitlementMutationOptions } from "@/features/catalog/mutations/catalog-mutations"
import { entitlementsQueryOptions } from "@/features/catalog/queries/catalog-query"
import { WorkspacePage, WorkflowPanel } from "@/features/organizations/components/workspace-page"
import { ScopeMismatchRecovery } from "@/features/organizations/components/scope-mismatch-recovery"
import { useValidatedProjectScope } from "@/features/projects/hooks/use-validated-project-scope"

interface EntitlementsPageProps {
  organizationId: string
  projectId: string
}

export function EntitlementsPage({ organizationId, projectId }: EntitlementsPageProps) {
  const queryClient = useQueryClient()
  const { project, scopeMismatch, scopeReady } = useValidatedProjectScope(organizationId, projectId)
  const entitlements = useQuery({ ...entitlementsQueryOptions(projectId), enabled: scopeReady })
  const mutation = useMutation(createEntitlementMutationOptions(projectId, queryClient))
  const items = entitlements.data?.items ?? []
  const form = useForm({
    defaultValues: { description: "", key: "", name: "" },
    onSubmit: async ({ value }) => {
      await mutation.mutateAsync({
        description: value.description.trim() || undefined,
        key: value.key.trim(),
        name: value.name.trim(),
      })
      form.reset()
    },
  })
  const state = resolveHostedQueryState({
    emptyDescription:
      "Create an Entitlement definition such as Pro Access, then grant it from one or more Products.",
    emptyTitle: "No Entitlement definitions",
    error: project.error ?? entitlements.error,
    isEmpty: scopeReady && entitlements.isSuccess && items.length === 0,
    isPending: project.isPending || (scopeReady && entitlements.isPending),
    loadingDescription: "Loading Entitlement definitions.",
    onRetry: () => void entitlements.refetch(),
    permissionDescription:
      "Project membership is required to view Entitlements; owner or admin is required to change them.",
  })
  const canManageEntitlements = state.kind === "empty" || state.kind === "ready"

  if (scopeMismatch) {
    return (
      <WorkspacePage
        description="The routed Organization does not own this Project."
        title="Entitlements unavailable in this Organization"
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
      description="Entitlements define access Products unlock. Mosaic does not calculate or assert customer subscription state here."
      eyebrow="Catalog · Project-wide"
      title="Entitlements"
    >
      <HostedResourceBoundary state={state}>
        <WorkflowPanel title="Entitlement definitions">
          <ul className="divide-y">
            {items.map((entitlement) => (
              <li className="flex items-center justify-between gap-4 py-4" key={entitlement.id}>
                <span>
                  <span className="block text-sm font-semibold">{entitlement.name}</span>
                  <span className="text-muted-foreground mt-1 block font-mono text-xs">
                    {entitlement.key}
                  </span>
                </span>
                <Link
                  className="text-primary text-sm font-medium hover:underline"
                  params={{ entitlementId: entitlement.id, organizationId, projectId }}
                  to="/organizations/$organizationId/projects/$projectId/catalog/entitlements/$entitlementId"
                >
                  View definition
                </Link>
              </li>
            ))}
          </ul>
        </WorkflowPanel>
      </HostedResourceBoundary>
      {canManageEntitlements ? (
        <WorkflowPanel title="Create Entitlement">
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
                  <FieldLabel htmlFor="entitlement-name">Name</FieldLabel>
                  <Input
                    id="entitlement-name"
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="Pro Access"
                    value={field.state.value}
                  />
                </Field>
              )}
            </form.Field>
            <form.Field name="key">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="entitlement-key">Key</FieldLabel>
                  <Input
                    id="entitlement-key"
                    onChange={(event) => field.handleChange(event.target.value.toLowerCase())}
                    placeholder="pro"
                    value={field.state.value}
                  />
                </Field>
              )}
            </form.Field>
            <form.Field name="description">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="entitlement-description">Description</FieldLabel>
                  <Input
                    id="entitlement-description"
                    onChange={(event) => field.handleChange(event.target.value)}
                    value={field.state.value}
                  />
                  <FieldDescription>Definition only, not customer access.</FieldDescription>
                </Field>
              )}
            </form.Field>
            <Button className="md:col-start-3" disabled={mutation.isPending} type="submit">
              Create Entitlement
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
