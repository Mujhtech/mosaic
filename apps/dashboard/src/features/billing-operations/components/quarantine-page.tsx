import { useQuery } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
  quarantineSeverityLabel,
  quarantineStatusLabel,
  storeEnvironmentLabel,
} from "@/features/billing-ledger/types/billing-vocabulary"
import {
  quarantineRecordsQueryOptions,
  type QuarantineListFilters,
} from "@/features/billing-operations/queries/quarantine-queries"
import { environmentsQueryOptions } from "@/features/environments/queries/environments-query"
import { ScopeMismatchRecovery } from "@/features/orgs/components/scope-mismatch-recovery"
import { WorkspacePage, WorkflowPanel } from "@/features/orgs/components/workspace-page"
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

const QUARANTINE_STATUS_OPTIONS = [
  { label: "Any status", value: "" },
  { label: "Open", value: "open" },
  { label: "Retrying", value: "retrying" },
  { label: "Closed after a successful attempt", value: "closed_after_success" },
  { label: "Closed as superseded", value: "closed_superseded" },
]

const quarantineProviderOptions = [
  { label: "Any store", value: "" },
  { label: providerLabel("app_store"), value: "app_store" },
  { label: providerLabel("google_play"), value: "google_play" },
]

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
  const items = records.data?.items ?? []
  const nextCursor = records.data?.nextCursor
  const { cursor: _cursor, ...activeFilters } = filters
  void _cursor
  const filtered = Object.values(activeFilters).some(Boolean)

  // Any filter change invalidates the cursor: a cursor is only meaningful for
  // the query that produced it.
  function updateFilters(patch: Partial<QuarantineListFilters>) {
    onFiltersChange({ ...activeFilters, ...patch })
  }

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

  const base = `/orgs/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/billing/${encodeURIComponent(environmentId)}`

  return (
    <WorkspacePage
      description="Inputs a store confirmed but Mosaic could not safely turn into a fact. They are held as evidence, never discarded, and never marked valid by hand."
      eyebrow="Mosaic Billing · Quarantine"
      title="Quarantine"
    >
      <BillingBoundaryNote />

      <WorkflowPanel title="Filters">
        <div className="flex flex-wrap gap-4">
          <div className="space-y-1 text-sm font-medium">
            <label htmlFor="quarantine-status">Status</label>
            <Select
              items={QUARANTINE_STATUS_OPTIONS}
              onValueChange={(value) =>
                updateFilters({
                  status: (value || undefined) as QuarantineListFilters["status"],
                })
              }
              value={filters.status ?? ""}
            >
              <SelectTrigger id="quarantine-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {QUARANTINE_STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 text-sm font-medium">
            <label htmlFor="quarantine-store">Store</label>
            <Select
              items={quarantineProviderOptions}
              onValueChange={(value) =>
                updateFilters({
                  provider: (value || undefined) as QuarantineListFilters["provider"],
                })
              }
              value={filters.provider ?? ""}
            >
              <SelectTrigger id="quarantine-store">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {quarantineProviderOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {/* A reason-code filter can arrive from a health or ledger recovery
              link. Without a visible control it would filter invisibly. */}
          {filters.reasonCode ? (
            <label className="space-y-1 text-sm font-medium">
              Reason
              <input
                className={`${fieldClass} text-muted-foreground block`}
                disabled
                readOnly
                value={quarantineReasonLabel(filters.reasonCode)}
              />
            </label>
          ) : null}
          <label className="space-y-1 text-sm font-medium">
            Mosaic Environment
            <input
              className={`${fieldClass} text-muted-foreground block`}
              disabled
              readOnly
              value={environmentName}
            />
            <span className="text-muted-foreground block text-xs font-normal">
              Fixed by the address. It is the tenant boundary, never a filter.
            </span>
          </label>
        </div>
        {filtered ? (
          <Button
            className="mt-4"
            onClick={() => onFiltersChange({})}
            size="sm"
            type="button"
            variant="outline"
          >
            Clear filters
          </Button>
        ) : null}
      </WorkflowPanel>

      <HostedResourceBoundary state={state}>
        {items.length === 0 ? (
          <>
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
                  <a
                    className={buttonVariants({ variant: "outline" })}
                    href={`${base}/transactions`}
                  >
                    Open the transaction ledger
                  </a>
                )
              }
              description={
                filters.cursor
                  ? "This page of the quarantine history is empty. Return to the first page, or continue forward."
                  : filtered
                    ? "Quarantine records exist in this Mosaic Environment, but none matches the current filters."
                    : "Every input Mosaic has accepted in this Mosaic Environment either produced a fact or is still being validated."
              }
              title={
                filtered ? "No quarantine records match these filters" : "Nothing is quarantined"
              }
            />
            <QuarantinePaging
              cursor={filters.cursor}
              nextCursor={nextCursor}
              onCursorChange={(cursor) => onFiltersChange({ ...activeFilters, cursor })}
            />
          </>
        ) : (
          <WorkflowPanel
            description="Every record names the reason it could not proceed and keeps the attempts that led there."
            title={
              nextCursor || filters.cursor
                ? `${items.length} quarantine record(s) on this page`
                : `${items.length} quarantine record(s)`
            }
          >
            <Table>
              <TableCaption>
                Quarantine records in the {environmentName} Mosaic Environment.
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Reason</TableHead>
                  <TableHead scope="col">Store</TableHead>
                  <TableHead scope="col">Store Environment</TableHead>
                  <TableHead scope="col">Store Product</TableHead>
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
                    <TableCell>{storeEnvironmentLabel(record.storeEnvironment)}</TableCell>
                    <TableCell>
                      {record.providerProductIdentifier ?? (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusPill
                        label={quarantineSeverityLabel(record.severity)}
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
            <QuarantinePaging
              cursor={filters.cursor}
              nextCursor={nextCursor}
              onCursorChange={(cursor) => onFiltersChange({ ...activeFilters, cursor })}
            />
          </WorkflowPanel>
        )}
      </HostedResourceBoundary>
    </WorkspacePage>
  )
}

/**
 * Forward paging over the quarantine history.
 *
 * A page is never presented as a total. Without this control an Environment
 * with more open records than one page holds would report the page size as the
 * count, on the surface whose entire job is "what needs attention".
 */
function QuarantinePaging({
  cursor,
  nextCursor,
  onCursorChange,
}: {
  cursor: string | undefined
  nextCursor: string | undefined
  onCursorChange: (cursor: string | undefined) => void
}) {
  if (!cursor && !nextCursor) return null

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {cursor ? (
        <Button onClick={() => onCursorChange(undefined)} size="sm" type="button" variant="outline">
          First page
        </Button>
      ) : null}
      {nextCursor ? (
        <Button
          onClick={() => onCursorChange(nextCursor)}
          size="sm"
          type="button"
          variant="outline"
        >
          Next page
        </Button>
      ) : (
        <p className="text-muted-foreground text-xs">End of the quarantine history.</p>
      )}
    </div>
  )
}
