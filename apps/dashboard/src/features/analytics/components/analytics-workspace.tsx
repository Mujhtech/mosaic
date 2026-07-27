import { ChartLineUpIcon } from "@phosphor-icons/react/dist/ssr/ChartLineUp"
import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"

import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary"
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state"
import { environmentsQueryOptions } from "@/features/environments/queries/environments-query"
import { WorkspacePage, WorkflowPanel } from "@/features/organizations/components/workspace-page"
import { projectQueryOptions } from "@/features/projects/queries/projects-query"
import { cn } from "@/lib/utils"
import { restAnalyticsAdapter } from "../api/rest-analytics-adapter"
import { useAnalyticsRole } from "../hooks/use-analytics-role"
import type { AnalyticsFilters, AnalyticsScope, AnalyticsSurface } from "../types/analytics"
import { AnalyticsFilters as FilterBar } from "./analytics-filters"
import { DataPrivacyPanel } from "./data-privacy-panel"
import { EventExportAction } from "./event-export-action"
import { FunnelPanel } from "./funnel-panel"
import { IssuesPanel } from "./issues-panel"
import { OverviewPanel } from "./overview-panel"
import { PaywallComparison } from "./paywall-comparison"

const tabs: Array<{ surface: AnalyticsSurface; label: string }> = [
  { surface: "overview", label: "Overview" },
  { surface: "placements", label: "Placements" },
  { surface: "paywalls", label: "Paywalls" },
  { surface: "products", label: "Products" },
  { surface: "purchases", label: "Purchases" },
  { surface: "data-privacy", label: "Data and Privacy" },
]

export function AnalyticsWorkspace({
  environmentId,
  filters,
  organizationId,
  projectId,
  surface,
}: AnalyticsScope & { filters: AnalyticsFilters; surface: AnalyticsSurface }) {
  const navigate = useNavigate()
  const project = useQuery(projectQueryOptions(projectId))
  const environments = useQuery(environmentsQueryOptions(projectId))
  const role = useAnalyticsRole(organizationId)
  const environment = environments.data?.items.find((item) => item.id === environmentId)
  const scope = { environmentId, organizationId, projectId }
  const state = resolveHostedQueryState({
    emptyDescription: "Choose a valid Environment before inspecting analytics.",
    emptyTitle: "Environment unavailable",
    error: project.error ?? environments.error,
    isEmpty: environments.isSuccess && !environment,
    isPending: project.isPending || environments.isPending,
    loadingDescription: "Loading the selected Analytics Environment.",
    onRetry: () => {
      void project.refetch()
      void environments.refetch()
    },
    permissionDescription: "Project membership is required to read analytics.",
    scope: { environmentId, organizationId, projectId },
  })

  return (
    <WorkspacePage
      actions={
        surface !== "data-privacy" ? (
          <EventExportAction
            adapter={restAnalyticsAdapter}
            filters={filters}
            role={role}
            scope={scope}
          />
        ) : undefined
      }
      description="Trace the monetization journey with accepted, deduplicated event counts and exact correlation. Product analytics never controls placement, rendering, or commerce outcomes."
      eyebrow={`${project.data?.name ?? "Project"} · ${environment?.name ?? "Environment"}`}
      title="Analytics"
    >
      <HostedResourceBoundary state={state}>
        <div className="border-border bg-muted/20 rounded border p-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <label className="flex items-center gap-3 text-sm font-medium">
              Environment
              <select
                aria-label="Analytics Environment"
                className="border-input bg-background focus-visible:ring-ring h-9 min-w-48 rounded border px-3 focus-visible:ring-2"
                onChange={(event) =>
                  void navigate({
                    params: {
                      environmentId: event.target.value,
                      organizationId,
                      projectId,
                      surface,
                    },
                    search: filters,
                    to: "/organizations/$organizationId/projects/$projectId/analytics/$environmentId/$surface",
                  })
                }
                value={environmentId}
              >
                {environments.data?.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <span className="text-muted-foreground flex items-center gap-2 text-xs">
              <ChartLineUpIcon aria-hidden size={16} /> Single-Environment reporting · event-count
              basis
            </span>
          </div>
          <nav aria-label="Analytics" className="mt-3 flex flex-wrap gap-1 border-t pt-3">
            {tabs.map((tab) => (
              <Link
                className={cn(
                  "focus-visible:ring-ring rounded px-3 py-2 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none",
                  tab.surface === surface
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
                key={tab.surface}
                params={{ environmentId, organizationId, projectId, surface: tab.surface }}
                search={filters}
                to="/organizations/$organizationId/projects/$projectId/analytics/$environmentId/$surface"
              >
                {tab.label}
              </Link>
            ))}
          </nav>
        </div>
        {surface !== "data-privacy" ? (
          <FilterBar
            filters={filters}
            onChange={(next) =>
              void navigate({
                params: { environmentId, organizationId, projectId, surface },
                replace: true,
                search: next,
                to: "/organizations/$organizationId/projects/$projectId/analytics/$environmentId/$surface",
              })
            }
          />
        ) : null}
        <AnalyticsSurfaceContent filters={filters} role={role} scope={scope} surface={surface} />
      </HostedResourceBoundary>
    </WorkspacePage>
  )
}

function AnalyticsSurfaceContent({
  filters,
  role,
  scope,
  surface,
}: {
  filters: AnalyticsFilters
  role?: "owner" | "admin" | "member"
  scope: AnalyticsScope
  surface: AnalyticsSurface
}) {
  if (surface === "overview")
    return <OverviewPanel adapter={restAnalyticsAdapter} filters={filters} scope={scope} />
  if (surface === "data-privacy")
    return <DataPrivacyPanel adapter={restAnalyticsAdapter} role={role} scope={scope} />
  if (surface === "paywalls")
    return (
      <div className="space-y-5">
        <WorkflowPanel
          description="From presentation through selection and purchase start, correlated by presentation and attempt identifiers."
          title="Paywall funnel"
        >
          <FunnelPanel
            adapter={restAnalyticsAdapter}
            filters={filters}
            funnel="paywalls"
            scope={scope}
          />
        </WorkflowPanel>
        <WorkflowPanel
          description="Compare immutable versions without mixing metric definitions or attribution windows."
          title="Immutable Paywall comparison"
        >
          <PaywallComparison adapter={restAnalyticsAdapter} filters={filters} scope={scope} />
        </WorkflowPanel>
      </div>
    )
  if (surface === "products")
    return (
      <div className="space-y-5">
        <WorkflowPanel
          description="Product load, availability, selection, and purchase-start correlation."
          title="Product funnel"
        >
          <FunnelPanel
            adapter={restAnalyticsAdapter}
            filters={filters}
            funnel="products"
            scope={scope}
          />
        </WorkflowPanel>
        <WorkflowPanel
          description="Safe failure codes with direct recovery paths. Provider payloads and credentials are never shown."
          title="Product and provider issues"
        >
          <IssuesPanel adapter={restAnalyticsAdapter} filters={filters} scope={scope} />
        </WorkflowPanel>
      </div>
    )
  if (surface === "purchases")
    return (
      <div className="space-y-4">
        <div className="border-primary/20 bg-primary/5 rounded border p-3 text-sm" role="status">
          <strong>Authority stays separate.</strong> Client-observed completions include purchased
          outcomes only; already-entitled is separate. Provider-confirmed completion is unavailable
          until a trusted server or provider source is configured—it is never displayed as zero.
        </div>
        <FunnelPanel
          adapter={restAnalyticsAdapter}
          filters={filters}
          funnel="purchases"
          scope={scope}
        />
      </div>
    )
  return (
    <FunnelPanel
      adapter={restAnalyticsAdapter}
      filters={filters}
      funnel="placements"
      scope={scope}
    />
  )
}
