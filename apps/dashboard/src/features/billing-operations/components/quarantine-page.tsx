import { useQuery } from "@tanstack/react-query"

import { buttonVariants } from "@/components/ui/button-variants"
import { EmptyState } from "@/components/feedback/empty-state"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary"
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state"
import {
  BillingBoundaryNote,
  StatusPill,
} from "@/features/billing-ledger/components/billing-chrome"
import {
  formatBillingTimestamp,
  providerLabel,
  quarantineReasonLabel,
  quarantineStatusLabel,
} from "@/features/billing-ledger/types/billing-vocabulary"
import {
  quarantineRecordsQueryOptions,
  type QuarantineListFilters,
} from "@/features/billing-operations/queries/quarantine-queries"
import { environmentsQueryOptions } from "@/features/environments/queries/environments-query"
import { ScopeMismatchRecovery } from "@/features/organizations/components/scope-mismatch-recovery"
import { WorkspacePage, WorkflowPanel } from "@/features/organizations/components/workspace-page"
import { useValidatedProjectScope } from "@/features/projects/hooks/use-validated-project-scope"

const fieldClass =
  "border-input bg-background focus-visible:border-ring focus-visible:ring-ring/40 h-9 rounded border px-3 text-sm outline-none focus-visible:ring-3"

interface QuarantinePageProps {
  environmentId: string
  filters: QuarantineListFilters
  onFiltersChange: (filters: QuarantineListFilters) => void
  organizationId: string
  projectId: string
}

export function QuarantinePage({
  environmentId,
  filters,
  onFiltersChange,
  organizationId,
  projectId,
}: QuarantinePageProps) {
  const { project, scopeMismatch, scopeReady } = useValidatedProjectScope(organizationId, projectId)
  const environments = useQuery({ ...environmentsQueryOptions(projectId), enabled: scopeReady })
  const records = useQuery({
    ...quarantineRecordsQueryOptions(projectId, environmentId, filters),
    enabled: scopeReady,
  })

  const environmentName =
    environments.data?.items.find((item) => item.id === environmentId)?.name ?? environmentId
  const items = records.data ?? []
  const filtered = Object.values(filters).some(Boolean)

  const error = project.error ?? environments.error ?? records.error
  const state = resolveHostedQueryState({
    error,
    isEmpty: false,
    isPending: project.isPending || (scopeReady && (environments.isPending || records.isPending)),
    loadingDescription: `Loading quarantine records for the ${environmentName} Mosaic Environment.`,
    onRetry: () => {
      void records.refetch()
    },
    permissionDescription:
      "Organization owner or admin permission is required to read quarantine records.",
    scope: { environmentId, organizationId, projectId },
  })

  if (scopeMismatch) {
    return (
      <WorkspacePage
        description="The routed Organization does not own this Project."
        title="Quarantine unavailable in this Organization"
      >
        <ScopeMismatchRecovery
          mismatch={scopeMismatch}
          organizationId={organizationId}
          projectId={projectId}
        />
      </WorkspacePage>
    )
  }

  const base = `/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/billing/${encodeURIComponent(environmentId)}`

  return (
    <WorkspacePage
      description="Inputs a store confirmed but Mosaic could not safely turn into a fact. They are held as evidence, never discarded, and never marked valid by hand."
      eyebrow="Mosaic Billing · Quarantine"
      title="Quarantine"
    >
      <BillingBoundaryNote />

      <WorkflowPanel title="Filters">
        <div className="flex flex-wrap gap-4">
          <label className="space-y-1 text-sm font-medium">
            Status
            <select
              className={`${fieldClass} block`}
              onChange={(event) =>
                onFiltersChange({
                  ...filters,
                  status:
                    event.currentTarget.value === ""
                      ? undefined
                      : (event.currentTarget.value as QuarantineListFilters["status"]),
                })
              }
              value={filters.status ?? ""}
            >
              <option value="">Any status</option>
              <option value="open">Open</option>
              <option value="retrying">Retrying</option>
              <option value="closed_after_success">Closed after a successful attempt</option>
              <option value="closed_superseded">Closed as superseded</option>
            </select>
          </label>
          <label className="space-y-1 text-sm font-medium">
            Store
            <select
              className={`${fieldClass} block`}
              onChange={(event) =>
                onFiltersChange({
                  ...filters,
                  provider:
                    event.currentTarget.value === ""
                      ? undefined
                      : (event.currentTarget.value as QuarantineListFilters["provider"]),
                })
              }
              value={filters.provider ?? ""}
            >
              <option value="">Any store</option>
              <option value="app_store">{providerLabel("app_store")}</option>
              <option value="google_play">{providerLabel("google_play")}</option>
            </select>
          </label>
          <label className="space-y-1 text-sm font-medium">
            Mosaic Environment
            <input
              className={`${fieldClass} text-muted-foreground block`}
              disabled
              readOnly
              value={environmentName}
            />
          </label>
        </div>
      </WorkflowPanel>

      <HostedResourceBoundary state={state}>
        {items.length === 0 ? (
          <EmptyState
            action={
              filtered ? (
                <button
                  className={buttonVariants({ variant: "outline" })}
                  onClick={() => onFiltersChange({})}
                  type="button"
                >
                  Clear filters
                </button>
              ) : (
                <a className={buttonVariants({ variant: "outline" })} href={`${base}/transactions`}>
                  Open the transaction ledger
                </a>
              )
            }
            description={
              filtered
                ? "Quarantine records exist in this Mosaic Environment, but none matches the current filters."
                : "Every input Mosaic has accepted in this Mosaic Environment either produced a fact or is still being validated."
            }
            title={
              filtered ? "No quarantine records match these filters" : "Nothing is quarantined"
            }
          />
        ) : (
          <WorkflowPanel
            description="Every record names the reason it could not proceed and keeps the attempts that led there."
            title={`${items.length} quarantine record(s)`}
          >
            <Table>
              <TableCaption>
                Quarantine records in the {environmentName} Mosaic Environment.
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Reason</TableHead>
                  <TableHead scope="col">Store</TableHead>
                  <TableHead scope="col">Severity</TableHead>
                  <TableHead scope="col">Status</TableHead>
                  <TableHead scope="col">Attempts</TableHead>
                  <TableHead scope="col">First seen</TableHead>
                  <TableHead scope="col">Last attempt</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell>
                      <a
                        className="text-primary font-medium"
                        href={`${base}/quarantine/${encodeURIComponent(record.id ?? "")}`}
                      >
                        {quarantineReasonLabel(record.reasonCode)}
                      </a>
                    </TableCell>
                    <TableCell>{providerLabel(record.provider)}</TableCell>
                    <TableCell>
                      <StatusPill
                        label={record.severity ?? "warning"}
                        tone={
                          record.severity === "security"
                            ? "negative"
                            : record.severity === "error"
                              ? "attention"
                              : "neutral"
                        }
                      />
                    </TableCell>
                    <TableCell>{quarantineStatusLabel(record.status)}</TableCell>
                    <TableCell>{record.attemptCount ?? 0}</TableCell>
                    <TableCell title={record.firstSeenAt}>
                      {formatBillingTimestamp(record.firstSeenAt)}
                    </TableCell>
                    <TableCell title={record.lastAttemptAt}>
                      {formatBillingTimestamp(record.lastAttemptAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </WorkflowPanel>
        )}
      </HostedResourceBoundary>
    </WorkspacePage>
  )
}
