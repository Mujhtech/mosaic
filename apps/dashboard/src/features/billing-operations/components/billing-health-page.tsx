import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { buttonVariants } from "@/components/ui/button-variants";
import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary";
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state";
import {
  BillingBoundaryNote,
  StatusPill,
} from "@/features/billing-ledger/components/billing-chrome";
import {
  BILLING_OPTIONAL_NOTE,
  formatBillingTimestamp,
  formatDurationSeconds,
  providerLabel,
  storeEnvironmentLabel,
} from "@/features/billing-ledger/types/billing-vocabulary";
import { billingHealthQueryOptions } from "@/features/billing-operations/queries/billing-health-queries";
import { environmentsQueryOptions } from "@/features/environments/queries/environments-query";
import { ScopeMismatchRecovery } from "@/features/orgs/components/scope-mismatch-recovery";
import {
  WorkflowPanel,
  WorkspacePage,
} from "@/features/orgs/components/workspace-page";
import { useValidatedProjectScope } from "@/features/projects/hooks/use-validated-project-scope";
import { storeCredentialsQueryOptions } from "@/features/store-connections/queries/store-connection-queries";
import {
  storeCredentialHealthExplanation,
  storeCredentialHealthLabel,
  storeCredentialIsUnhealthy,
} from "@/features/store-connections/types/store-connection-view";
import {
  storeConnectionHref,
  storeConnectionsHref,
} from "@/lib/routing/workspace-hrefs";

interface BillingHealthPageProps {
  environmentId: string;
  organizationId: string;
  projectId: string;
}

/**
 * Operational billing health.
 *
 * Every unhealthy signal names exactly one next step and links to it. A metric
 * an operator cannot act on is worse than no metric, because it costs attention
 * without buying a decision.
 */
export function BillingHealthPage({
  environmentId,
  organizationId,
  projectId,
}: BillingHealthPageProps) {
  const { project, scopeMismatch, scopeReady } = useValidatedProjectScope(
    organizationId,
    projectId
  );
  const environments = useQuery({
    ...environmentsQueryOptions(projectId),
    enabled: scopeReady,
  });
  const health = useQuery({
    ...billingHealthQueryOptions(projectId, environmentId),
    enabled: scopeReady,
  });
  const credentials = useQuery({
    ...storeCredentialsQueryOptions(projectId),
    enabled: scopeReady,
  });

  const environmentName =
    environments.data?.items.find((item) => item.id === environmentId)?.name ??
    environmentId;
  const { data } = health;
  const environmentCredentials = (credentials.data ?? []).filter(
    (credential) => credential.environmentId === environmentId
  );

  const error =
    project.error ?? environments.error ?? health.error ?? credentials.error;
  const state = resolveHostedQueryState({
    error,
    isEmpty: false,
    isPending:
      project.isPending ||
      (scopeReady &&
        (environments.isPending || health.isPending || credentials.isPending)),
    loadingDescription: `Loading Mosaic Billing health for the ${environmentName} Mosaic Environment.`,
    onRetry: () => {
      health.refetch();
      credentials.refetch();
    },
    permissionDescription:
      "Organization owner or admin permission is required to read Mosaic Billing health.",
    scope: { environmentId, organizationId, projectId },
  });

  if (scopeMismatch) {
    return (
      <WorkspacePage
        description="The routed Organization does not own this Project."
        title="Mosaic Billing health unavailable in this Organization"
      >
        <ScopeMismatchRecovery
          mismatch={scopeMismatch}
          organizationId={organizationId}
          projectId={projectId}
        />
      </WorkspacePage>
    );
  }

  const base = `/orgs/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/billing/${encodeURIComponent(environmentId)}`;
  const connectionsHref =
    storeConnectionsHref({ organizationId, projectId }) ?? "#";
  const backlogSeconds = data?.oldestQueuedAgeSeconds;
  const backlogUnhealthy =
    typeof backlogSeconds === "number" && backlogSeconds > 900;
  const quarantineOpen = data?.openQuarantineCount ?? 0;
  const unhealthyCredentials = data?.unhealthyCredentials ?? 0;

  return (
    <WorkspacePage
      description="Whether Mosaic is receiving store input, keeping up with validation, and holding valid credentials for this Mosaic Environment."
      eyebrow="Mosaic Billing · Health"
      title="Billing health"
    >
      <BillingBoundaryNote />

      <HostedResourceBoundary state={state}>
        {data?.billingEnabled === false ? (
          <WorkflowPanel title="Mosaic Billing is turned off for this Project">
            <p className="text-sm leading-6">
              No store input is accepted or recorded while billing is off.
              Observations from SDKs are permanently rejected so their queues
              drain rather than retrying forever.
            </p>
            <p className="mt-2 text-muted-foreground text-sm leading-6">
              {BILLING_OPTIONAL_NOTE}
            </p>
            <a className={`${buttonVariants()} mt-4`} href={connectionsHref}>
              Open Mosaic Billing setup
            </a>
          </WorkflowPanel>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label="Validation backlog"
            recovery={
              backlogUnhealthy ? (
                <span>
                  The oldest queued input has waited{" "}
                  {formatDurationSeconds(backlogSeconds)}. Validation is falling
                  behind or a worker is stalled.
                </span>
              ) : undefined
            }
            tone={backlogUnhealthy ? "attention" : "neutral"}
            value={`${data?.queueDepth ?? 0} queued`}
          />
          <Metric
            label="Oldest queued input"
            tone={backlogUnhealthy ? "attention" : "neutral"}
            value={formatDurationSeconds(backlogSeconds)}
          />
          <Metric
            href={`${base}/quarantine?status=open`}
            hrefLabel="Open quarantine"
            label="Open quarantine records"
            tone={quarantineOpen > 0 ? "attention" : "positive"}
            value={String(quarantineOpen)}
          />
          <Metric
            href={connectionsHref}
            hrefLabel="Review credentials"
            label="Unhealthy credentials"
            tone={unhealthyCredentials > 0 ? "negative" : "positive"}
            value={`${unhealthyCredentials} of ${data?.credentialCount ?? 0}`}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Metric
            label="Recorded facts"
            tone="neutral"
            value={String(data?.factCount ?? 0)}
          />
          <Metric
            label="Last fact recorded"
            tone="neutral"
            value={formatBillingTimestamp(data?.lastFactRecordedAt)}
          />
          <Metric
            href={`${base}/reconciliation`}
            hrefLabel="Start reconciliation"
            label="Last reconciliation"
            recovery={
              data?.lastReconciliationAt
                ? undefined
                : "No reconciliation pass has run, so a missed Store Notification would still be missing."
            }
            tone={data?.lastReconciliationAt ? "neutral" : "attention"}
            value={formatBillingTimestamp(data?.lastReconciliationAt)}
          />
        </div>

        <WorkflowPanel
          description="Sandbox and production credentials are always separate, and their health is reported separately. A healthy production credential says nothing about sandbox."
          title="Store Server Credentials in this Mosaic Environment"
        >
          {environmentCredentials.length === 0 ? (
            <div className="text-sm leading-6">
              <p>
                No Store Server Credential is registered for the{" "}
                {environmentName} Environment.
              </p>
              <a
                className="mt-2 inline-flex font-semibold text-primary"
                href={connectionsHref}
              >
                Add a Store Server Credential
              </a>
            </div>
          ) : (
            <ul className="space-y-2">
              {environmentCredentials.map((credential) => (
                <li className="rounded border p-4" key={credential.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-sm">{credential.name}</p>
                    <StatusPill
                      label={storeCredentialHealthLabel(
                        credential.healthStatus
                      )}
                      tone={
                        credential.healthStatus === "healthy"
                          ? "positive"
                          : credential.healthStatus === "untested"
                            ? "neutral"
                            : "negative"
                      }
                    />
                  </div>
                  <p className="mt-1 text-muted-foreground text-xs">
                    {providerLabel(credential.provider)} · Store Environment{" "}
                    {storeEnvironmentLabel(credential.storeEnvironment)} · last
                    tested {formatBillingTimestamp(credential.lastTestedAt)}
                  </p>
                  <p className="mt-2 text-muted-foreground text-sm leading-6">
                    {storeCredentialHealthExplanation(credential.healthStatus)}
                  </p>
                  {storeCredentialIsUnhealthy(credential) ||
                  credential.status === "revoked" ? (
                    <a
                      className="mt-2 inline-flex font-semibold text-primary text-sm"
                      href={
                        storeConnectionHref(
                          { organizationId, projectId },
                          credential.id ?? ""
                        ) ?? "#"
                      }
                    >
                      Test or rotate this credential
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </WorkflowPanel>

        {/* Projection health is a sibling, not a section here. This page can be
            entirely green while every customer is being told the wrong thing,
            so the link states the difference rather than just offering a jump. */}
        <WorkflowPanel title="Is the access answer still current?">
          <p className="text-sm leading-6">
            This page answers whether store input is still becoming facts.
            Whether the authoritative answer Mosaic gives about a
            customer&rsquo;s access is still current is a separate question with
            a separate queue: a healthy intake pipeline and a stalled projection
            queue look identical from here.
          </p>
          <a
            className={`${buttonVariants({ variant: "outline" })} mt-3`}
            href={`${base}/projection-health`}
          >
            Open projection health
          </a>
        </WorkflowPanel>

        <WorkflowPanel title="What this view cannot tell you yet">
          <ul className="list-disc space-y-2 pl-5 text-muted-foreground text-sm leading-6">
            <li>
              Per-credential intake counts, the timestamp of the last accepted
              Store Notification, and signature-verification failure counts are
              recorded as server telemetry and are not exposed by the billing
              health resource. Use the deployment&rsquo;s metrics for those
              until the contract carries them.
            </li>
            <li>
              A validation failure rate is not published; the queue depth, the
              open quarantine count, and the attempt history on each fact are
              the signals available here.
            </li>
          </ul>
        </WorkflowPanel>
      </HostedResourceBoundary>
    </WorkspacePage>
  );
}

function Metric({
  href,
  hrefLabel,
  label,
  recovery,
  tone,
  value,
}: {
  href?: string;
  hrefLabel?: string;
  label: string;
  recovery?: ReactNode;
  tone: "attention" | "negative" | "neutral" | "positive";
  value: string;
}) {
  return (
    <div className="rounded border p-4">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1 font-semibold text-sm">{value}</p>
      {tone !== "neutral" && tone !== "positive" ? (
        <div className="mt-2">
          <StatusPill
            label={tone === "negative" ? "Needs attention" : "Watch"}
            tone={tone}
          />
        </div>
      ) : null}
      {recovery ? (
        <p className="mt-2 text-muted-foreground text-xs leading-5">
          {recovery}
        </p>
      ) : null}
      {href && hrefLabel ? (
        <a
          className="mt-2 inline-flex font-semibold text-primary text-xs"
          href={href}
        >
          {hrefLabel}
        </a>
      ) : null}
    </div>
  );
}
