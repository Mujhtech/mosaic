import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useEffect, useState } from "react"

import { EmptyState } from "@/components/feedback/empty-state"
import { Button } from "@/components/ui/button"
import { buttonVariants } from "@/components/ui/button-variants"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary"
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state"
import { MonetizationWorkspace } from "@/features/environments/components/monetization-workspace"
import { CreatePaywallDraftForm } from "@/features/paywalls/components/create-paywall-draft-form"
import { listHostedDraftRecoveries } from "@/features/paywalls/mutations/hosted-draft-recovery"
import { paywallsQueryOptions } from "@/features/paywalls/queries/paywall-queries"
import { useHostedPublishingAdapter } from "@/features/publishing/api/use-hosted-publishing-adapter"

export function PaywallsPage({
  environmentId,
  organizationId,
  projectId,
}: {
  environmentId: string
  organizationId: string
  projectId: string
}) {
  const adapter = useHostedPublishingAdapter()
  const paywalls = useQuery({
    ...paywallsQueryOptions(projectId, adapter),
    enabled: adapter.status === "available",
  })
  const [recoveryCount, setRecoveryCount] = useState(0)
  const [createOpen, setCreateOpen] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(
      () => setRecoveryCount(listHostedDraftRecoveries({ environmentId, projectId }).length),
      0,
    )
    return () => window.clearTimeout(timer)
  }, [environmentId, projectId])

  const items = paywalls.data ?? []
  const state = resolveHostedQueryState({
    // Emptiness is presented inside the page body, next to the create form,
    // rather than replacing the whole view.
    error: paywalls.error,
    isEmpty: false,
    isPending: paywalls.isPending,
    loadingDescription: "Loading hosted Paywalls.",
    onRetry: () => void paywalls.refetch(),
    permissionAction: (
      <Link
        className={buttonVariants({ variant: "outline" })}
        params={(prev) => ({
          ...prev,
          environmentKey: prev.environmentKey!,
          organizationId: prev.organizationId!,
          projectId: prev.projectId!,
        })}
        to="/orgs/$organizationId/projects/$projectId/env/$environmentKey"
      >
        Return to project
      </Link>
    ),
    permissionDescription: "Project membership is required to manage hosted Paywalls.",
    scope: { environmentId, organizationId, projectId },
  })

  const createDialog = (
    <Dialog onOpenChange={setCreateOpen} open={createOpen}>
      <DialogTrigger render={<Button size="sm" />}>New paywall</DialogTrigger>
      <DialogContent className="max-h-[calc(100vh-4rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create hosted Draft</DialogTitle>
          <DialogDescription>
            The local source remains unchanged. The hosted copy is scoped to the selected
            Environment.
          </DialogDescription>
        </DialogHeader>
        <div className="px-4 pb-4">
          <CreatePaywallDraftForm environmentId={environmentId} projectId={projectId} />
        </div>
      </DialogContent>
    </Dialog>
  )

  return (
    <MonetizationWorkspace
      actions={createDialog}
      description="Create hosted Drafts, open Studio, and continue from immutable published versions."
      environmentId={environmentId}
      organizationId={organizationId}
      projectId={projectId}
      surface="paywalls"
      title="Paywalls"
    >
      <HostedResourceBoundary state={state}>
        {recoveryCount > 0 ? (
          <p className="border-border bg-muted/35 rounded border px-4 py-3 text-sm" role="status">
            {recoveryCount} browser recovery {recoveryCount === 1 ? "copy is" : "copies are"}
            available in this Environment. Open the matching Paywall to restore or download it.
          </p>
        ) : null}
        {items.length === 0 ? (
          <EmptyState
            description="Create a Paywall and copy a starter, local, or imported document into its first hosted Draft."
            title="No hosted Paywalls yet"
          />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {items.map((paywall) => (
              <li key={paywall.id}>
                <Link
                  className="hover:bg-muted/35 focus-visible:ring-ring block rounded border p-5 focus-visible:ring-2 focus-visible:outline-none"
                  params={(prev) => ({
                    ...prev,
                    paywallId: paywall.id,
                    environmentKey: prev.environmentKey!,
                    organizationId: prev.organizationId!,
                    projectId: prev.projectId!,
                  })}
                  to="/orgs/$organizationId/projects/$projectId/env/$environmentKey/monetization/paywalls/$paywallId"
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="font-semibold">{paywall.name}</span>
                    <span className="border-border bg-muted/50 text-muted-foreground rounded-full border px-2 py-0.5 text-xs">
                      {paywall.status}
                    </span>
                  </span>
                  <span className="text-muted-foreground mt-2 block font-mono text-xs">
                    {paywall.key}
                  </span>
                  <span className="text-muted-foreground mt-4 block text-xs">
                    Updated {new Date(paywall.updatedAt).toLocaleString()}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </HostedResourceBoundary>
    </MonetizationWorkspace>
  )
}
