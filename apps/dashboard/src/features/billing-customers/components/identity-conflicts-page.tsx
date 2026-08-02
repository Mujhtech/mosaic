import { useQuery } from "@tanstack/react-query";

import { EmptyState } from "@/components/feedback/empty-state";
import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary";
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state";
import { identityConflictsQueryOptions } from "@/features/billing-customers/queries/conflict-queries";
import {
  CONFLICT_FREEZE_NOTE,
  CONFLICT_PROJECT_SCOPE_NOTE,
  conflictActionLabel,
  conflictDiagnosticExplanation,
} from "@/features/billing-customers/types/conflict-resolution";
import { formatEntitlementInstant } from "@/features/billing-customers/types/entitlement-vocabulary";
import { StatusPill } from "@/features/billing-ledger/components/billing-chrome";
import { ScopeMismatchRecovery } from "@/features/orgs/components/scope-mismatch-recovery";
import {
  WorkflowPanel,
  WorkspacePage,
} from "@/features/orgs/components/workspace-page";
import { useValidatedProjectScope } from "@/features/projects/hooks/use-validated-project-scope";
import { billingIdentityConflictHref } from "@/lib/routing/workspace-hrefs";

interface IdentityConflictsPageProps {
  environmentId: string;
  onStatusChange: (status: "open" | "resolved") => void;
  organizationId: string;
  projectId: string;
  status: "open" | "resolved";
}

/**
 * Identity conflicts awaiting an operator.
 *
 * Project-wide, and the page says so. A Billing Customer's identity belongs to
 * the Project while its purchases belong to an Environment, so silently
 * filtering this list to the Environment in the address would let an operator
 * conclude a conflict had been resolved when it merely concerned a sibling
 * Environment — and a conflict left open keeps a real customer frozen.
 */
export function IdentityConflictsPage({
  environmentId,
  onStatusChange,
  organizationId,
  projectId,
  status,
}: IdentityConflictsPageProps) {
  const { project, scopeMismatch, scopeReady } = useValidatedProjectScope(
    organizationId,
    projectId
  );
  const conflicts = useQuery({
    ...identityConflictsQueryOptions(projectId, status),
    enabled: scopeReady,
  });

  const error = project.error ?? conflicts.error;
  const state = resolveHostedQueryState({
    error,
    isEmpty: false,
    isPending: project.isPending || (scopeReady && conflicts.isPending),
    loadingDescription: "Loading identity conflicts for this Project.",
    onRetry: () => {
      conflicts.refetch();
    },
    permissionDescription:
      "Organization owner or admin permission is required to read identity conflicts.",
    scope: { environmentId, organizationId, projectId },
  });

  if (scopeMismatch) {
    return (
      <WorkspacePage
        description="The routed Organization does not own this Project."
        title="Identity conflicts unavailable in this Organization"
      >
        <ScopeMismatchRecovery
          mismatch={scopeMismatch}
          organizationId={organizationId}
          projectId={projectId}
        />
      </WorkspacePage>
    );
  }

  const scope = { environmentId, organizationId, projectId };
  const items = conflicts.data ?? [];

  return (
    <WorkspacePage
      description="Disputed associations Mosaic has frozen rather than guessed at. Each one is two Billing Customers with a claim on the same purchase or alias, and at most one claim is right."
      eyebrow="Mosaic Billing · Identity"
      title="Identity conflicts"
    >
      <p className="text-muted-foreground text-xs leading-5">
        {CONFLICT_PROJECT_SCOPE_NOTE}
      </p>
      <p className="text-muted-foreground text-xs leading-5">
        {CONFLICT_FREEZE_NOTE}
      </p>

      <HostedResourceBoundary state={state}>
        <WorkflowPanel title="Status">
          <div className="flex flex-wrap gap-4 text-sm">
            {(["open", "resolved"] as const).map((candidate) => (
              <label className="flex items-center gap-2" key={candidate}>
                <input
                  checked={status === candidate}
                  name="conflict-status"
                  onChange={() => onStatusChange(candidate)}
                  type="radio"
                />
                {candidate === "open" ? "Open" : "Resolved"}
              </label>
            ))}
          </div>
        </WorkflowPanel>

        {items.length === 0 ? (
          <EmptyState
            description={
              status === "open"
                ? "No identity conflict is open in this Project. That is the healthy state: every purchase Mosaic holds has exactly one customer with a claim on it."
                : "No identity conflict has been resolved in this Project yet."
            }
            title={
              status === "open"
                ? "No open identity conflicts"
                : "No resolved conflicts"
            }
          />
        ) : (
          <WorkflowPanel title={`${items.length} ${status} conflict(s)`}>
            <ul className="space-y-2">
              {items.map((conflict) => (
                <li className="rounded border p-4" key={conflict.conflictId}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <a
                      className="break-all font-mono font-semibold text-primary text-sm"
                      href={
                        billingIdentityConflictHref(
                          scope,
                          conflict.conflictId ?? ""
                        ) ?? "#"
                      }
                    >
                      {conflict.conflictId}
                    </a>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill
                        label={
                          conflict.scope === "alias"
                            ? "Alias"
                            : "Purchase Lineage"
                        }
                        tone="neutral"
                      />
                      <StatusPill
                        label={
                          conflict.status === "open"
                            ? "Frozen · awaiting an operator"
                            : "Resolved"
                        }
                        tone={
                          conflict.status === "open" ? "attention" : "neutral"
                        }
                      />
                    </div>
                  </div>

                  <p className="mt-2 text-sm leading-6">
                    {conflictDiagnosticExplanation(conflict.diagnosticCode)}
                  </p>

                  <p className="mt-2 text-muted-foreground text-xs">
                    Opened {formatEntitlementInstant(conflict.openedAt)}
                    {conflict.resolvedAt
                      ? ` · resolved ${formatEntitlementInstant(conflict.resolvedAt)} as “${conflictActionLabel(conflict.resolutionAction)}”`
                      : ""}
                  </p>
                </li>
              ))}
            </ul>
          </WorkflowPanel>
        )}
      </HostedResourceBoundary>
    </WorkspacePage>
  );
}
