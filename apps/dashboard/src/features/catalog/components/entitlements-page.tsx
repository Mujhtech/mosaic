import { useState } from "react"
import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary"
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state"
import { createEntitlementMutationOptions } from "@/features/catalog/mutations/catalog-mutations"
import { entitlementsQueryOptions } from "@/features/catalog/queries/catalog-query"
import { WorkspacePage, WorkflowPanel } from "@/features/orgs/components/workspace-page"
import { ScopeMismatchRecovery } from "@/features/orgs/components/scope-mismatch-recovery"
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
  const [createOpen, setCreateOpen] = useState(false)
  const form = useForm({
    defaultValues: { description: "", key: "", name: "" },
    onSubmit: async ({ value }) => {
      await mutation.mutateAsync({
        description: value.description.trim() || undefined,
        key: value.key.trim(),
        name: value.name.trim(),
      })
      form.reset()
      setCreateOpen(false)
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
        title="Access unavailable in this Organization"
      >
        <ScopeMismatchRecovery
          mismatch={scopeMismatch}
          organizationId={organizationId}
          projectId={projectId}
        />
      </WorkspacePage>
    )
  }

  const createDialog = (
    <Dialog
      onOpenChange={(open) => {
        setCreateOpen(open)
        if (!open) {
          form.reset()
          mutation.reset()
        }
      }}
      open={createOpen}
    >
      <DialogTrigger render={<Button size="sm" />}>Create Entitlement</DialogTrigger>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void form.handleSubmit()
          }}
        >
          <DialogHeader>
            <DialogTitle>Create Entitlement</DialogTitle>
            <DialogDescription>
              An Entitlement is a named capability that Products unlock. This defines it only; it
              does not grant customer access.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 px-4">
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
            {mutation.error ? (
              <p className="text-destructive text-sm" role="alert">
                {mutation.error.message}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button disabled={mutation.isPending} type="submit">
              {mutation.isPending ? "Creating…" : "Create Entitlement"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )

  return (
    <WorkspacePage
      actions={canManageEntitlements ? createDialog : null}
      description="Access is defined by Entitlements: named capabilities that Products unlock. Mosaic does not calculate or assert customer subscription state here."
      eyebrow="Catalog · Project-wide"
      title="Access"
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
                  params={(prev) => ({ ...prev, entitlementId: entitlement.id })}
                  to="/orgs/$organizationId/projects/$projectId/env/$environmentKey/catalog/entitlements/$entitlementId"
                >
                  View definition
                </Link>
              </li>
            ))}
          </ul>
        </WorkflowPanel>
      </HostedResourceBoundary>
    </WorkspacePage>
  )
}
