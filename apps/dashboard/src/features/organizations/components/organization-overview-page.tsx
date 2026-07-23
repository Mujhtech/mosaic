import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"

import { buttonVariants } from "@/components/ui/button-variants"
import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary"
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state"
import { organizationQueryOptions } from "@/features/organizations/queries/organizations-query"
import { WorkspacePage, WorkflowPanel } from "@/features/organizations/components/workspace-page"
import { projectsQueryOptions } from "@/features/projects/queries/projects-query"

interface OrganizationOverviewPageProps {
  onProjectStatusChange: (status: "active" | "archived") => void
  organizationId: string
  projectStatus: "active" | "archived"
}

export function OrganizationOverviewPage({
  onProjectStatusChange,
  organizationId,
  projectStatus,
}: OrganizationOverviewPageProps) {
  const organization = useQuery(organizationQueryOptions(organizationId))
  const projects = useQuery(projectsQueryOptions(organizationId, projectStatus))
  const projectItems = projects.data?.items ?? []
  const error = organization.error ?? projects.error
  const state = resolveHostedQueryState({
    emptyAction:
      projectStatus === "active" ? (
        <Link
          className={buttonVariants()}
          params={{ organizationId }}
          to="/organizations/$organizationId/projects/new"
        >
          Create project
        </Link>
      ) : undefined,
    emptyDescription:
      projectStatus === "active"
        ? "Create a project to group apps, environments, and the project-wide Catalog."
        : "Archived Projects appear here and can be opened to restore them.",
    emptyTitle: projectStatus === "active" ? "No active projects" : "No archived projects",
    error,
    isEmpty: organization.isSuccess && projects.isSuccess && projectItems.length === 0,
    isPending: organization.isPending || projects.isPending,
    loadingDescription: "Loading organization and projects.",
    onRetry: () => {
      void organization.refetch()
      void projects.refetch()
    },
    permissionDescription: "You must be a member of this organization to view its projects.",
  })

  return (
    <WorkspacePage
      actions={
        <>
          <Link
            className={buttonVariants({ variant: "outline" })}
            params={{ organizationId }}
            to="/organizations/$organizationId/members"
          >
            Members
          </Link>
          <Link
            className={buttonVariants()}
            params={{ organizationId }}
            to="/organizations/$organizationId/projects/new"
          >
            New project
          </Link>
        </>
      }
      description="Projects contain registered apps, isolated environments, API keys, and one project-wide Catalog."
      title={organization.data?.name ?? "Organization"}
    >
      <div aria-label="Project status" className="flex gap-2" role="group">
        <button
          aria-pressed={projectStatus === "active"}
          className={buttonVariants({
            variant: projectStatus === "active" ? "default" : "outline",
          })}
          onClick={() => onProjectStatusChange("active")}
          type="button"
        >
          Active Projects
        </button>
        <button
          aria-pressed={projectStatus === "archived"}
          className={buttonVariants({
            variant: projectStatus === "archived" ? "default" : "outline",
          })}
          onClick={() => onProjectStatusChange("archived")}
          type="button"
        >
          Archived Projects
        </button>
      </div>
      <HostedResourceBoundary state={state}>
        <WorkflowPanel title={projectStatus === "active" ? "Active Projects" : "Archived Projects"}>
          <ul className="grid gap-3 md:grid-cols-2">
            {projectItems.map((project) => (
              <li className="rounded border p-4" key={project.id}>
                <p className="font-semibold">{project.name}</p>
                <p className="text-muted-foreground mt-1 font-mono text-xs">{project.key}</p>
                <Link
                  className="text-primary mt-5 inline-flex text-sm font-medium hover:underline"
                  params={{ organizationId, projectId: project.id }}
                  to="/organizations/$organizationId/projects/$projectId"
                >
                  Open project
                </Link>
              </li>
            ))}
          </ul>
        </WorkflowPanel>
      </HostedResourceBoundary>
    </WorkspacePage>
  )
}
