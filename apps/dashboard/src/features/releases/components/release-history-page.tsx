import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"

import { EmptyState } from "@/components/feedback/empty-state"
import { buttonVariants } from "@/components/ui/button-variants"
import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary"
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state"
import { MonetizationWorkspace } from "@/features/environments/components/monetization-workspace"
import { RollbackReleaseAction } from "@/features/releases/components/rollback-release-action"
import { releasesQueryOptions } from "@/features/releases/queries/release-queries"
import { useHostedPublishingAdapter } from "@/features/publishing/api/use-hosted-publishing-adapter"

export function ReleaseHistoryPage({
  environmentId,
  organizationId,
  projectId,
}: {
  environmentId: string
  organizationId: string
  projectId: string
}) {
  const adapter = useHostedPublishingAdapter()
  const releases = useQuery(releasesQueryOptions({ environmentId, projectId }, adapter))
  const items = releases.data ?? []
  const state = resolveHostedQueryState({
    // Emptiness is presented inside the page body rather than replacing it.
    error: releases.error,
    isEmpty: false,
    isPending: releases.isPending,
    loadingDescription: "Loading immutable Release history.",
    onRetry: () => void releases.refetch(),
    permissionAction: (
      <Link
        className={buttonVariants({ variant: "outline" })}
        params={(prev) => prev}
        to="/orgs/$organizationId/projects/$projectId/env/$environmentKey/monetization/paywalls"
      >
        Return to Paywalls
      </Link>
    ),
    permissionDescription: "Project membership with publishing access is required to view history.",
    scope: { environmentId, organizationId, projectId },
  })

  return (
    <MonetizationWorkspace
      description="Inspect immutable configuration snapshots and restore an earlier snapshot by creating a new Release."
      environmentId={environmentId}
      organizationId={organizationId}
      projectId={projectId}
      surface="releases"
      title="Publish history"
    >
      <HostedResourceBoundary state={state}>
        {items.length === 0 ? (
          <EmptyState
            action={
              <Link
                className={buttonVariants()}
                params={(prev) => prev}
                to="/orgs/$organizationId/projects/$projectId/env/$environmentKey/monetization/paywalls"
              >
                Open Paywalls
              </Link>
            }
            description="Open a hosted Draft, complete readiness, and Publish to create Release 1."
            title="No Releases in this Environment"
          />
        ) : (
          <ol className="space-y-3">
            {items.map((release) => (
              <li className="border-border rounded border p-5" key={release.id}>
                <div className="flex flex-col gap-4 md:flex-row md:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold">Release {release.number}</h2>
                      {release.isCurrent ? (
                        <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs font-medium">
                          Current
                        </span>
                      ) : null}
                      {release.rollbackSourceNumber ? (
                        <span className="border-border text-muted-foreground rounded-full border px-2 py-0.5 text-xs">
                          Restored from {release.rollbackSourceNumber}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-muted-foreground mt-2 text-sm">
                      Published {new Date(release.publishedAt).toLocaleString()}
                      {release.publisherName ? ` by ${release.publisherName}` : ""}
                    </p>
                  </div>
                  {!release.isCurrent ? (
                    <RollbackReleaseAction
                      environmentId={environmentId}
                      organizationId={organizationId}
                      projectId={projectId}
                      release={release}
                    />
                  ) : (
                    <Link
                      className={buttonVariants({ size: "sm", variant: "outline" })}
                      params={(prev) => prev}
                      to="/orgs/$organizationId/projects/$projectId/env/$environmentKey/monetization/paywalls"
                    >
                      Edit a published Paywall
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </HostedResourceBoundary>
    </MonetizationWorkspace>
  )
}
