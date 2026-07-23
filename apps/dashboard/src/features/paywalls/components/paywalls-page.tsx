import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useEffect, useState } from "react"

import { EmptyState } from "@/components/feedback/empty-state"
import { buttonVariants } from "@/components/ui/button-variants"
import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary"
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state"
import { MonetizationWorkspace } from "@/features/environments/components/monetization-workspace"
import { WorkflowPanel } from "@/features/organizations/components/workspace-page"
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

  useEffect(() => {
    const timer = window.setTimeout(
      () => setRecoveryCount(listHostedDraftRecoveries({ environmentId, projectId }).length),
      0,
    )
    return () => window.clearTimeout(timer)
  }, [environmentId, projectId])

  const items = paywalls.data ?? []
  const state = resolveHostedQueryState({
    emptyDescription: "",
    emptyTitle: "",
    error: paywalls.error,
    isEmpty: false,
    isPending: paywalls.isPending,
    loadingDescription: "Loading hosted Paywalls.",
    onRetry: () => void paywalls.refetch(),
    permissionAction: (
      <Link
        className={buttonVariants({ variant: "outline" })}
        params={{ organizationId, projectId }}
        to="/organizations/$organizationId/projects/$projectId"
      >
        Return to project
      </Link>
    ),
    permissionDescription: "Project membership is required to manage hosted Paywalls.",
  })

  return (
    <MonetizationWorkspace
      actions={
        <a className={buttonVariants()} href="#create-paywall">
          New paywall
        </a>
      }
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
                  params={{ environmentId, organizationId, paywallId: paywall.id, projectId }}
                  to="/organizations/$organizationId/projects/$projectId/monetization/$environmentId/paywalls/$paywallId"
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
        <WorkflowPanel
          description="The local source remains unchanged. The hosted copy is scoped to the selected Environment."
          title="Create hosted Draft"
        >
          <CreatePaywallDraftForm
            environmentId={environmentId}
            organizationId={organizationId}
            projectId={projectId}
          />
        </WorkflowPanel>
      </HostedResourceBoundary>
    </MonetizationWorkspace>
  )
}
