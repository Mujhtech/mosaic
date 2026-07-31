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
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary"
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state"
import { createPlanMutationOptions } from "@/features/catalog/mutations/catalog-mutations"
import { plansQueryOptions } from "@/features/catalog/queries/catalog-query"
import { WorkspacePage, WorkflowPanel } from "@/features/orgs/components/workspace-page"
import { ScopeMismatchRecovery } from "@/features/orgs/components/scope-mismatch-recovery"
import { useValidatedProjectScope } from "@/features/projects/hooks/use-validated-project-scope"

interface PlansPageProps {
  organizationId: string
  projectId: string
}

export function PlansPage({ organizationId, projectId }: PlansPageProps) {
  const queryClient = useQueryClient()
  const { project, scopeMismatch, scopeReady } = useValidatedProjectScope(organizationId, projectId)
  const plans = useQuery({ ...plansQueryOptions(projectId), enabled: scopeReady })
  const mutation = useMutation(createPlanMutationOptions(projectId, queryClient))
  const items = plans.data?.items ?? []
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
      "Create a Plan such as Premium, then add Monthly and Yearly Products and define the access they grant.",
    emptyTitle: "No Plans yet",
    error: project.error ?? plans.error,
    isEmpty: scopeReady && plans.isSuccess && items.length === 0,
    isPending: project.isPending || (scopeReady && plans.isPending),
    loadingDescription: "Loading project Plans.",
    onRetry: () => void plans.refetch(),
    permissionDescription:
      "Project membership is required to view Plans; owner or admin is required to change them.",
  })
  const canManagePlans = state.kind === "empty" || state.kind === "ready"

  if (scopeMismatch) {
    return (
      <WorkspacePage
        description="The routed Organization does not own this Project."
        title="Plans unavailable in this Organization"
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
      <DialogTrigger render={<Button size="sm" />}>Create Plan</DialogTrigger>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void form.handleSubmit()
          }}
        >
          <DialogHeader>
            <DialogTitle>Create Plan</DialogTitle>
            <DialogDescription>
              A Plan is what you sell; Products are its monthly, yearly, or lifetime purchase
              options.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 px-4">
            <form.Field name="name">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="plan-name">Name</FieldLabel>
                  <Input
                    id="plan-name"
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="Premium"
                    value={field.state.value}
                  />
                </Field>
              )}
            </form.Field>
            <form.Field name="key">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="plan-key">Key</FieldLabel>
                  <Input
                    id="plan-key"
                    onChange={(event) => field.handleChange(event.target.value.toLowerCase())}
                    placeholder="premium"
                    value={field.state.value}
                  />
                </Field>
              )}
            </form.Field>
            <form.Field name="description">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="plan-description">Description</FieldLabel>
                  <Input
                    id="plan-description"
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="All premium features"
                    value={field.state.value}
                  />
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
              {mutation.isPending ? "Creating…" : "Create Plan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )

  return (
    <WorkspacePage
      actions={canManagePlans ? createDialog : null}
      description="Plans group the Products a customer can choose. The Catalog is project-wide."
      eyebrow="Catalog · Project-wide"
      title="Plans"
    >
      <HostedResourceBoundary state={state}>
        <WorkflowPanel title="Plans">
          <ul className="grid gap-3 md:grid-cols-2">
            {items.map((plan) => (
              <li className="rounded border p-4" key={plan.id}>
                <p className="font-semibold">{plan.name}</p>
                <p className="text-muted-foreground mt-1 font-mono text-xs">{plan.key}</p>
                <p className="text-muted-foreground mt-2 text-sm">
                  {plan.description ?? "No description"}
                </p>
                <Link
                  className="text-primary mt-4 inline-flex text-sm font-medium hover:underline"
                  params={(prev) => ({ ...prev, planId: plan.id })}
                  to="/orgs/$organizationId/projects/$projectId/env/$environmentKey/catalog/plans/$planId"
                >
                  Manage Products
                </Link>
              </li>
            ))}
          </ul>
        </WorkflowPanel>
      </HostedResourceBoundary>
    </WorkspacePage>
  )
}
