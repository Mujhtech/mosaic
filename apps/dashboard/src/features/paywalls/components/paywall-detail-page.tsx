import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { buttonVariants } from "@/components/ui/button-variants";
import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary";
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state";
import { MonetizationWorkspace } from "@/features/environments/components/monetization-workspace";
import { WorkflowPanel } from "@/features/orgs/components/workspace-page";
import { CreateDraftAction } from "@/features/paywalls/components/create-draft-action";
import { EditPublishedVersionAction } from "@/features/paywalls/components/edit-published-version-action";
import {
  type HostedDraftRecoveryRecord,
  listHostedDraftRecoveries,
  serializeHostedRecoveryDocument,
} from "@/features/paywalls/mutations/hosted-draft-recovery";
import {
  activeHostedDraftQueryOptions,
  paywallQueryOptions,
} from "@/features/paywalls/queries/paywall-queries";
import { useHostedPublishingAdapter } from "@/features/publishing/api/use-hosted-publishing-adapter";
import {
  studioScopeParams,
  workspaceScopeParams,
} from "@/lib/routing/workspace-params";

function downloadRecovery(record: HostedDraftRecoveryRecord) {
  const url = URL.createObjectURL(
    new Blob([serializeHostedRecoveryDocument(record)], {
      type: "application/json",
    })
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${record.document.id}-recovery.mosaic.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function PaywallDetailPage({
  environmentId,
  organizationId,
  paywallId,
  projectId,
}: {
  environmentId: string;
  organizationId: string;
  paywallId: string;
  projectId: string;
}) {
  const adapter = useHostedPublishingAdapter();
  const navigate = useNavigate();
  const paywall = useQuery(
    paywallQueryOptions({ paywallId, projectId }, adapter)
  );
  const activeDraft = useQuery(
    activeHostedDraftQueryOptions(
      { environmentId, paywallId, projectId },
      adapter
    )
  );
  const [recoveries, setRecoveries] = useState<
    readonly HostedDraftRecoveryRecord[]
  >([]);

  useEffect(() => {
    const timer = window.setTimeout(
      () =>
        setRecoveries(
          listHostedDraftRecoveries({ environmentId, paywallId, projectId })
        ),
      0
    );
    return () => window.clearTimeout(timer);
  }, [environmentId, paywallId, projectId]);

  const versions =
    paywall.data?.versions.filter(
      (version) => version.environmentId === environmentId
    ) ?? [];
  const state = resolveHostedQueryState({
    emptyDescription: "This Paywall may have been archived or removed.",
    emptyTitle: "Paywall unavailable",
    error: paywall.error ?? activeDraft.error,
    isEmpty: paywall.isSuccess && !paywall.data,
    isPending: paywall.isPending || activeDraft.isPending,
    loadingDescription: "Loading Paywall Draft and version history.",
    onRetry: () => {
      Promise.all([paywall.refetch(), activeDraft.refetch()]);
    },
    permissionAction: (
      <Link
        className={buttonVariants({ variant: "outline" })}
        params={(prev) => ({
          ...prev,
          ...workspaceScopeParams(prev),
        })}
        to="/orgs/$organizationId/projects/$projectId/env/$environmentKey/monetization/paywalls"
      >
        Return to Paywalls
      </Link>
    ),
    permissionDescription:
      "Project membership is required to open this Paywall.",
    scope: { environmentId, organizationId, projectId },
  });

  return (
    <MonetizationWorkspace
      actions={
        <Link
          className={buttonVariants({ variant: "outline" })}
          params={(prev) => ({
            ...prev,
            ...workspaceScopeParams(prev),
          })}
          to="/orgs/$organizationId/projects/$projectId/env/$environmentKey/monetization/paywalls"
        >
          Back to Paywalls
        </Link>
      }
      description="Create a new hosted Draft or continue from an immutable published version."
      environmentId={environmentId}
      organizationId={organizationId}
      projectId={projectId}
      surface="paywalls"
      title={paywall.data?.name ?? "Paywall"}
    >
      <HostedResourceBoundary state={state}>
        {paywall.data ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.7fr)]">
            <WorkflowPanel
              description={
                activeDraft.data
                  ? "This Environment already has an active hosted Draft. Continue without losing its server revision."
                  : "Creating a Draft never changes an immutable published version."
              }
              title={
                activeDraft.data ? "Continue active Draft" : "Open in Studio"
              }
            >
              {activeDraft.data ? (
                <div className="space-y-3">
                  <p className="text-muted-foreground text-sm">
                    Revision {activeDraft.data.revision} · saved{" "}
                    {new Date(activeDraft.data.updatedAt).toLocaleString()}
                  </p>
                  <Link
                    className={buttonVariants()}
                    params={(prev) => ({
                      ...prev,
                      ...studioScopeParams(prev),
                      environmentId,
                      draftId: activeDraft.data?.id ?? "",
                      paywallId,
                    })}
                    to="/studio/$organizationId/$projectId/$environmentId/$paywallId/$draftId"
                  >
                    Continue in Studio
                  </Link>
                </div>
              ) : (
                <CreateDraftAction
                  environmentId={environmentId}
                  organizationId={organizationId}
                  paywallId={paywallId}
                  projectId={projectId}
                />
              )}
            </WorkflowPanel>
            <WorkflowPanel title="Paywall identity">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Key</dt>
                <dd className="font-mono">{paywall.data.key}</dd>
                <dt className="text-muted-foreground">Status</dt>
                <dd className="capitalize">{paywall.data.status}</dd>
              </dl>
            </WorkflowPanel>
          </div>
        ) : null}

        {recoveries.length > 0 ? (
          <WorkflowPanel
            description="These bounded copies were saved in this browser when hosted autosave could not finish."
            title="Browser recovery"
          >
            <ul className="space-y-3">
              {recoveries.map((record) => (
                <li
                  className="flex flex-col gap-3 rounded border p-4 sm:flex-row sm:items-center"
                  key={record.draftId}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-sm">
                      Draft revision {record.expectedRevision}
                    </p>
                    <p className="mt-1 text-muted-foreground text-xs">
                      Saved {new Date(record.savedAt).toLocaleString()} after{" "}
                      {record.reason}.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      className={buttonVariants({ size: "sm" })}
                      params={(prev) => ({
                        ...prev,
                        ...studioScopeParams(prev),
                        environmentId,
                        draftId: record.draftId,
                        paywallId,
                      })}
                      to="/studio/$organizationId/$projectId/$environmentId/$paywallId/$draftId"
                    >
                      Open recovery in Studio
                    </Link>
                    <button
                      className={buttonVariants({
                        size: "sm",
                        variant: "outline",
                      })}
                      onClick={() => downloadRecovery(record)}
                      type="button"
                    >
                      Download copy
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </WorkflowPanel>
        ) : null}

        <WorkflowPanel
          description="Published versions stay immutable. Editing creates a new hosted Draft in this Environment."
          title="Published versions"
        >
          {versions.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No published version exists in this Environment yet. Create a
              Draft, bind a Placement, and publish from Studio.
            </p>
          ) : (
            <ul className="space-y-3">
              {versions.map((version) => (
                <li
                  className="flex flex-col gap-3 rounded border p-4 sm:flex-row sm:items-center"
                  key={version.id}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      Version {version.versionNumber}
                    </p>
                    <p className="mt-1 text-muted-foreground text-xs">
                      Protocol {version.protocolVersion} · Draft revision{" "}
                      {version.sourceDraftRevision}·{" "}
                      {new Date(version.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <EditPublishedVersionAction
                    environmentId={environmentId}
                    onDraftCreated={(draft) =>
                      navigate({
                        params: (prev) => ({
                          ...prev,
                          ...studioScopeParams(prev),
                          draftId: draft.id,
                          paywallId,
                          environmentId,
                        }),
                        to: "/studio/$organizationId/$projectId/$environmentId/$paywallId/$draftId",
                      })
                    }
                    paywallId={paywallId}
                    projectId={projectId}
                    versionId={version.id}
                  />
                </li>
              ))}
            </ul>
          )}
        </WorkflowPanel>
      </HostedResourceBoundary>
    </MonetizationWorkspace>
  );
}
