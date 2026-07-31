import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary"
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state"
import {
  DefinitionRow,
  EnvironmentBadges,
  StatusPill,
} from "@/features/billing-ledger/components/billing-chrome"
import { providerLabel } from "@/features/billing-ledger/types/billing-vocabulary"
import { ConflictResolutionForm } from "@/features/billing-customers/components/conflict-resolution-form"
import { resolveIdentityConflictMutationOptions } from "@/features/billing-customers/mutations/conflict-mutations"
import { identityConflictQueryOptions } from "@/features/billing-customers/queries/conflict-queries"
import {
  CONFLICT_FREEZE_NOTE,
  conflictActionLabel,
  conflictDiagnosticExplanation,
} from "@/features/billing-customers/types/conflict-resolution"
import {
  aliasTypeLabel,
  formatEntitlementInstant,
  lineageDiagnosticLabel,
  PROJECTION_FROZEN_NOTE,
} from "@/features/billing-customers/types/entitlement-vocabulary"
import { environmentsQueryOptions } from "@/features/environments/queries/environments-query"
import { ScopeMismatchRecovery } from "@/features/orgs/components/scope-mismatch-recovery"
import { WorkflowPanel, WorkspacePage } from "@/features/orgs/components/workspace-page"
import { useValidatedProjectScope } from "@/features/projects/hooks/use-validated-project-scope"
import { useOrganizationAccess } from "@/hooks/use-organization-access"
import { billingCustomerHref, billingIdentityConflictsHref } from "@/lib/routing/workspace-hrefs"

interface IdentityConflictDetailPageProps {
  conflictId: string
  environmentId: string
  organizationId: string
  projectId: string
}

/**
 * One identity conflict and its resolution.
 *
 * The page states the frozen safety posture before it offers any action, and
 * the candidates are presented side by side without a recommended winner:
 * Mosaic has deliberately not chosen, and a UI that visually favours one
 * candidate would reintroduce the automatic merge the design refuses.
 */
export function IdentityConflictDetailPage({
  conflictId,
  environmentId,
  organizationId,
  projectId,
}: IdentityConflictDetailPageProps) {
  const { project, scopeMismatch, scopeReady } = useValidatedProjectScope(organizationId, projectId)
  const access = useOrganizationAccess(organizationId)
  const queryClient = useQueryClient()
  const environments = useQuery({ ...environmentsQueryOptions(projectId), enabled: scopeReady })
  const detail = useQuery({
    ...identityConflictQueryOptions(projectId, conflictId),
    enabled: scopeReady,
  })
  const resolve = useMutation(
    resolveIdentityConflictMutationOptions(projectId, conflictId, queryClient),
  )

  const conflict = detail.data?.conflict
  const lineage = detail.data?.lineage
  const environmentName =
    environments.data?.items.find((item) => item.id === (lineage?.environmentId ?? environmentId))
      ?.name ??
    lineage?.environmentId ??
    environmentId

  const error = project.error ?? detail.error
  const state = resolveHostedQueryState({
    error,
    isEmpty: false,
    isPending: project.isPending || (scopeReady && detail.isPending),
    loadingDescription: "Loading this identity conflict.",
    onRetry: () => {
      void detail.refetch()
    },
    permissionDescription:
      "Organization owner or admin permission is required to read an identity conflict.",
    scope: { environmentId, organizationId, projectId },
  })

  if (scopeMismatch) {
    return (
      <WorkspacePage
        description="The routed Organization does not own this Project."
        title="Identity conflict unavailable in this Organization"
      >
        <ScopeMismatchRecovery
          mismatch={scopeMismatch}
          organizationId={organizationId}
          projectId={projectId}
        />
      </WorkspacePage>
    )
  }

  const scope = { environmentId, organizationId, projectId }
  const isOpen = conflict?.status === "open"

  return (
    <WorkspacePage
      description="Two Billing Customers hold a claim on the same subject. Mosaic has frozen it rather than pick one, because picking wrong hands a person someone else's purchases."
      eyebrow="Mosaic Billing · Identity conflict"
      title={conflictId}
    >
      <a
        className="text-primary text-sm font-semibold"
        href={billingIdentityConflictsHref(scope) ?? "#"}
      >
        Back to identity conflicts
      </a>

      <HostedResourceBoundary state={state}>
        <WorkflowPanel title="Safety state">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill
              label={isOpen ? "Projection frozen" : "Resolved"}
              tone={isOpen ? "attention" : "neutral"}
            />
            <StatusPill
              label={conflict?.scope === "alias" ? "Alias-scoped" : "Purchase Lineage-scoped"}
              tone="neutral"
            />
          </div>
          <p className="mt-2 text-sm leading-6">{CONFLICT_FREEZE_NOTE}</p>
          <p className="mt-2 text-sm leading-6">
            {conflictDiagnosticExplanation(conflict?.diagnosticCode)}
          </p>
          <dl className="mt-3">
            <DefinitionRow label="Opened" value={formatEntitlementInstant(conflict?.openedAt)} />
            {conflict?.resolvedAt ? (
              <>
                <DefinitionRow
                  label="Resolved"
                  value={formatEntitlementInstant(conflict.resolvedAt)}
                />
                <DefinitionRow
                  label="Resolution"
                  value={conflictActionLabel(conflict.resolutionAction)}
                />
                <DefinitionRow label="Reason" value={conflict.resolutionReason ?? "—"} />
              </>
            ) : null}
            {/* The disputed alias *type* is reported. Its digest is not rendered
                under any scope: a digest is still a stable per-person key. */}
            {conflict?.aliasType ? (
              <DefinitionRow
                label="Disputed alias type"
                value={aliasTypeLabel(conflict.aliasType)}
              />
            ) : null}
          </dl>
        </WorkflowPanel>

        <WorkflowPanel
          description="Presented without a recommended winner. Mosaic has deliberately not chosen, and the evidence below is what an operator decides on."
          title="Candidate customers"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <CandidateCard
              caption="Held the association before this evidence arrived."
              customerId={conflict?.firstCustomerId}
              href={billingCustomerHref(scope, conflict?.firstCustomerId ?? "") ?? "#"}
              title="Incumbent"
            />
            <CandidateCard
              caption="Proposed by the new evidence."
              customerId={conflict?.secondCustomerId}
              href={billingCustomerHref(scope, conflict?.secondCustomerId ?? "") ?? "#"}
              title="Challenger"
            />
          </div>
        </WorkflowPanel>

        {lineage ? (
          <WorkflowPanel
            description="The disputed Purchase Lineage. Nothing about it changes while the conflict is open."
            title="Disputed Purchase Lineage"
          >
            <dl>
              <DefinitionRow
                label="Purchase Lineage"
                value={<span className="font-mono">{lineage.purchaseLineageId}</span>}
              />
              <DefinitionRow label="Store" value={providerLabel(lineage.provider)} />
              <DefinitionRow label="Type" value={lineage.lineageType ?? "—"} />
              <DefinitionRow
                label="Diagnostic"
                value={lineageDiagnosticLabel(lineage.diagnosticStatus)}
              />
            </dl>
            <div className="mt-3">
              <EnvironmentBadges
                mosaicEnvironmentName={environmentName}
                storeEnvironment={lineage.storeEnvironment}
              />
            </div>
            {lineage.projectionFrozen ? (
              <p className="text-muted-foreground mt-3 text-xs leading-5">
                {PROJECTION_FROZEN_NOTE}
              </p>
            ) : null}
          </WorkflowPanel>
        ) : null}

        {isOpen ? (
          <WorkflowPanel
            description="There is no one-click merge. Automatic merge stays an architecture checkpoint, not a dashboard button, because a wrong merge silently gives one person another person's purchases."
            title="Resolve this conflict"
          >
            <ConflictResolutionForm
              canManage={access.canManage}
              firstCustomerId={conflict?.firstCustomerId}
              membersHref={`/orgs/${encodeURIComponent(organizationId)}/members`}
              onResolve={async (request) => {
                await resolve.mutateAsync(request)
              }}
              secondCustomerId={conflict?.secondCustomerId}
            />
          </WorkflowPanel>
        ) : (
          <WorkflowPanel title="Already resolved">
            <p className="text-sm leading-6">
              This conflict was resolved as &ldquo;{conflictActionLabel(conflict?.resolutionAction)}
              &rdquo;. Both customers were unfrozen and reprojected. A resolution is recorded, not
              reversed: if it was wrong, the correction is a new association, not an edit to this
              record.
            </p>
          </WorkflowPanel>
        )}
      </HostedResourceBoundary>
    </WorkspacePage>
  )
}

function CandidateCard({
  caption,
  customerId,
  href,
  title,
}: {
  caption: string
  customerId: string | undefined
  href: string
  title: string
}) {
  return (
    <div className="rounded border p-4">
      <p className="text-sm font-semibold">{title}</p>
      <p className="text-muted-foreground mt-1 text-xs leading-5">{caption}</p>
      {customerId ? (
        <a className="text-primary mt-2 inline-flex font-mono text-xs break-all" href={href}>
          {customerId}
        </a>
      ) : (
        <p className="text-muted-foreground mt-2 text-xs">Not recorded.</p>
      )}
    </div>
  )
}
