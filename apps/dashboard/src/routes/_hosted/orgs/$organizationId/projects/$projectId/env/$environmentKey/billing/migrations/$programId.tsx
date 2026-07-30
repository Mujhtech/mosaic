import { createFileRoute, useNavigate } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"
import { MigrationProgramDetailPage } from "@/features/billing-migrations/components/migration-program-detail-page"
import { routeHead } from "@/lib/routing/route-head"

const tabs = [
  "overview",
  "evidence",
  "mappings",
  "imports",
  "compare",
  "readiness",
  "lifecycle",
] as const
type Tab = (typeof tabs)[number]

interface MigrationSearch {
  batchId?: string
  classification: string
  runJobId?: string
  tab: Tab
}

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/billing/migrations/$programId",
)({
  component: MigrationProgramRoute,
  head: () => routeHead({ title: "Migration program" }),
  pendingComponent: RoutePendingState,
  validateSearch: (search: Record<string, unknown>): MigrationSearch => ({
    batchId: typeof search.batchId === "string" ? search.batchId : undefined,
    classification: typeof search.classification === "string" ? search.classification : "all",
    runJobId: typeof search.runJobId === "string" ? search.runJobId : undefined,
    tab: tabs.includes(search.tab as Tab) ? (search.tab as Tab) : "overview",
  }),
})

function MigrationProgramRoute() {
  const navigate = useNavigate({ from: Route.fullPath })
  const { organizationId, programId, projectId } = Route.useParams()
  const search = Route.useSearch()
  return (
    <MigrationProgramDetailPage
      {...search}
      onSearchChange={(next) =>
        void navigate({ search: (previous) => ({ ...previous, ...next }), replace: true })
      }
      organizationId={organizationId}
      programId={programId}
      projectId={projectId}
    />
  )
}
