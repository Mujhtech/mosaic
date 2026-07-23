import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr/ArrowRight"
import { PlusIcon } from "@phosphor-icons/react/dist/ssr/Plus"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"

import { buttonVariants } from "@/components/ui/button-variants"
import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary"
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state"
import { organizationsQueryOptions } from "@/features/organizations/queries/organizations-query"
import { WorkspacePage, WorkflowPanel } from "@/features/organizations/components/workspace-page"

export function WorkspaceHome() {
  const organizations = useQuery(organizationsQueryOptions())
  const items = organizations.data?.items ?? []
  const state = resolveHostedQueryState({
    emptyAction: (
      <Link className={buttonVariants()} to="/organizations/new">
        Create organization
      </Link>
    ),
    emptyDescription: "Create an organization to establish the tenant and membership boundary.",
    emptyTitle: "No organizations yet",
    error: organizations.error,
    isEmpty: organizations.isSuccess && items.length === 0,
    isPending: organizations.isPending,
    loadingDescription: "Loading organizations from the hosted workspace.",
    onRetry: () => void organizations.refetch(),
    permissionDescription: "Organization membership is required to view this workspace.",
  })

  return (
    <WorkspacePage
      actions={
        <Link className={buttonVariants()} to="/organizations/new">
          <PlusIcon aria-hidden size={16} />
          New organization
        </Link>
      }
      description="Organizations isolate members, projects, and audit context. Local Studio remains independent."
      title="Organizations"
    >
      <HostedResourceBoundary state={state}>
        <WorkflowPanel
          description="Choose an organization to see its projects and members."
          title="Your organizations"
        >
          <ul className="divide-y">
            {items.map((organization) => (
              <li key={organization.id}>
                <Link
                  className="hover:bg-muted/45 focus-visible:ring-ring flex items-center justify-between gap-4 rounded px-3 py-4 focus-visible:ring-2 focus-visible:outline-none"
                  params={{ organizationId: organization.id }}
                  to="/organizations/$organizationId"
                >
                  <span>
                    <span className="block text-sm font-semibold">{organization.name}</span>
                    <span className="text-muted-foreground mt-1 block text-xs">
                      {organization.id}
                    </span>
                  </span>
                  <ArrowRightIcon aria-hidden size={18} />
                </Link>
              </li>
            ))}
          </ul>
        </WorkflowPanel>
      </HostedResourceBoundary>
    </WorkspacePage>
  )
}
