import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr/ArrowLeft";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary";
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state";
import {
  BillingBoundaryNote,
  DefinitionRow,
  EnvironmentBadges,
  ProviderBadge,
  StatusPill,
} from "@/features/billing-ledger/components/billing-chrome";
import {
  credentialStatusLabel,
  formatBillingTimestamp,
  storeEnvironmentLabel,
} from "@/features/billing-ledger/types/billing-vocabulary";
import { environmentsQueryOptions } from "@/features/environments/queries/environments-query";
import { ScopeMismatchRecovery } from "@/features/orgs/components/scope-mismatch-recovery";
import {
  WorkflowPanel,
  WorkspacePage,
} from "@/features/orgs/components/workspace-page";
import { useValidatedProjectScope } from "@/features/projects/hooks/use-validated-project-scope";
import { applicationsQueryOptions } from "@/features/projects/queries/projects-query";
import { NotificationEndpointPanel } from "@/features/store-connections/components/notification-endpoint-panel";
import { NotificationSetupGuide } from "@/features/store-connections/components/notification-setup-guide";
import { RotateStoreCredentialSheet } from "@/features/store-connections/components/rotate-store-credential-sheet";
import {
  revokeStoreCredentialMutationOptions,
  rotateStoreCredentialMutationOptions,
  testStoreCredentialMutationOptions,
} from "@/features/store-connections/mutations/store-credential-mutations";
import {
  clearStoreCredentialSecretMutationCache,
  transferStoreCredentialEndpoint,
} from "@/features/store-connections/mutations/store-credential-secret-cache";
import { storeCredentialQueryOptions } from "@/features/store-connections/queries/store-connection-queries";
import {
  storeCredentialActions,
  storeCredentialHealthExplanation,
  storeCredentialHealthLabel,
  usesInboundNotificationEndpoint,
} from "@/features/store-connections/types/store-connection-view";
import type {
  Application,
  StoreServerCredential,
  StoreServerCredentialWithEndpoint,
} from "@/generated/api";
import { useOrganizationAccess } from "@/hooks/use-organization-access";
import { storeConnectionsHref } from "@/lib/routing/workspace-hrefs";

interface StoreConnectionDetailPageProps {
  credentialId: string;
  organizationId: string;
  projectId: string;
}

export function StoreConnectionDetailPage({
  credentialId,
  organizationId,
  projectId,
}: StoreConnectionDetailPageProps) {
  const handleClick4 = useCallback(() => setConfirmRevoke(false), []);
  const handleClick2 = useCallback(() => setConfirmRevoke(true), []);
  const queryClient = useQueryClient();
  const access = useOrganizationAccess(organizationId);
  const [revealed, setRevealed] =
    useState<StoreServerCredentialWithEndpoint | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const { project, scopeMismatch, scopeReady } = useValidatedProjectScope(
    organizationId,
    projectId
  );
  const credential = useQuery({
    ...storeCredentialQueryOptions(projectId, credentialId),
    enabled: scopeReady,
  });
  const environments = useQuery({
    ...environmentsQueryOptions(projectId),
    enabled: scopeReady,
  });
  const applications = useQuery({
    ...applicationsQueryOptions(projectId),
    enabled: scopeReady,
  });
  const rotate = useMutation(
    rotateStoreCredentialMutationOptions(credentialId, projectId, queryClient)
  );
  const revoke = useMutation(
    revokeStoreCredentialMutationOptions(credentialId, projectId, queryClient)
  );
  const handleClick3 = useCallback(
    () =>
      revoke.mutate(undefined, {
        onSuccess: () => setConfirmRevoke(false),
      }),
    [revoke]
  );
  const test = useMutation(
    testStoreCredentialMutationOptions(credentialId, projectId, queryClient)
  );

  const handleClick = useCallback(() => test.mutate(), [test]);
  const sanitizeSecretMutationState = useCallback(() => {
    rotate.reset();
    clearStoreCredentialSecretMutationCache(queryClient);
  }, [queryClient, rotate]);

  const handleDismiss = useCallback(() => {
    setRevealed(null);
    sanitizeSecretMutationState();
  }, [sanitizeSecretMutationState]);
  const record = credential.data;
  const environmentName =
    environments.data?.items.find((item) => item.id === record?.environmentId)
      ?.name ??
    record?.environmentId ??
    "—";
  const actions = record
    ? storeCredentialActions(record)
    : { revoke: false, rotate: false, test: false };
  const error =
    project.error ??
    credential.error ??
    environments.error ??
    applications.error;
  const state = resolveHostedQueryState({
    emptyDescription:
      "Return to Store Server Credentials and choose an existing connection.",
    emptyTitle: "Store Server Credential unavailable",
    error,
    isEmpty: credential.isSuccess && !record,
    isPending:
      project.isPending ||
      (scopeReady &&
        (credential.isPending ||
          environments.isPending ||
          applications.isPending)),
    loadingDescription: "Loading Store Server Credential metadata and health.",
    onRetry: () => {
      credential.refetch();
    },
    permissionDescription:
      "Organization owner or admin permission is required to inspect a Store Server Credential.",
    scope: { organizationId, projectId },
  });

  if (scopeMismatch) {
    return (
      <WorkspacePage
        description="The routed Organization does not own this Project."
        title="Store Server Credential unavailable in this Organization"
      >
        <ScopeMismatchRecovery
          mismatch={scopeMismatch}
          organizationId={organizationId}
          projectId={projectId}
        />
      </WorkspacePage>
    );
  }

  const listHref = storeConnectionsHref({ organizationId, projectId }) ?? "#";

  return (
    <WorkspacePage
      actions={
        <a
          className={buttonVariants({ size: "sm", variant: "outline" })}
          href={listHref}
        >
          <ArrowLeftIcon aria-hidden /> All credentials
        </a>
      }
      description="Metadata only. The stored key is never returned, and neither is the notification endpoint address."
      eyebrow="Mosaic Billing · Store Server Credential"
      title={record?.name ?? "Store Server Credential"}
    >
      <BillingBoundaryNote />

      <HostedResourceBoundary state={state}>
        {record ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <ProviderBadge provider={record.provider} />
              <EnvironmentBadges
                mosaicEnvironmentName={environmentName}
                storeEnvironment={record.storeEnvironment}
              />
              <StatusPill
                label={storeCredentialHealthLabel(record.healthStatus)}
                tone={(() => {
                  if (record.healthStatus === "healthy") {
                    return "positive";
                  }
                  if (record.healthStatus === "untested") {
                    return "neutral";
                  }
                  return "negative";
                })()}
              />
              {record.status === "revoked" ? (
                <StatusPill label="Revoked" tone="negative" />
              ) : null}
            </div>

            <CredentialOperationsPanel
              actions={actions}
              canManage={access.canManage}
              confirmRevoke={confirmRevoke}
              credential={record}
              membersHref={`/orgs/${encodeURIComponent(organizationId)}/members`}
              onCancelRevoke={handleClick4}
              onConfirmRevoke={handleClick3}
              onRequestRevoke={handleClick2}
              onRotate={async (secret) => {
                const rotated = await rotate.mutateAsync({ secret });
                transferStoreCredentialEndpoint(
                  queryClient,
                  rotated,
                  setRevealed,
                  sanitizeSecretMutationState
                );
              }}
              onTest={handleClick}
              revokeError={revoke.error}
              revokePending={revoke.isPending}
              rotateError={rotate.error}
              testError={test.error}
              testedHealthStatus={test.data?.healthStatus}
              testPending={test.isPending}
              testSuccess={test.isSuccess}
            />

            {usesInboundNotificationEndpoint(record) ? (
              <NotificationEndpointPanel
                {...(revealed?.notificationEndpointUrl
                  ? { endpointUrl: revealed.notificationEndpointUrl }
                  : {})}
                onDismiss={handleDismiss}
              />
            ) : null}

            <NotificationSetupGuide credential={record} />

            <CredentialMetadataPanel
              credential={record}
              environmentName={environmentName}
            />

            <CredentialApplicationScopePanel
              applications={applications.data?.items ?? []}
              credential={record}
            />
          </>
        ) : null}
      </HostedResourceBoundary>
    </WorkspacePage>
  );
}

/**
 * Test, rotate, and revoke, with revocation confirmed in place because what it
 * stops and what it keeps are not obvious from the word alone.
 */
function CredentialOperationsPanel({
  actions,
  canManage,
  confirmRevoke,
  credential,
  membersHref,
  onCancelRevoke,
  onConfirmRevoke,
  onRequestRevoke,
  onRotate,
  onTest,
  revokeError,
  revokePending,
  rotateError,
  testError,
  testPending,
  testSuccess,
  testedHealthStatus,
}: {
  actions: { revoke: boolean; rotate: boolean; test: boolean };
  canManage: boolean;
  confirmRevoke: boolean;
  credential: StoreServerCredential;
  membersHref: string;
  onCancelRevoke: () => void;
  onConfirmRevoke: () => void;
  onRequestRevoke: () => void;
  onRotate: (secret: string) => Promise<void>;
  onTest: () => void;
  revokeError: Error | null;
  revokePending: boolean;
  rotateError: Error | null;
  testError: Error | null;
  testPending: boolean;
  testSuccess: boolean;
  testedHealthStatus: StoreServerCredential["healthStatus"];
}) {
  return (
    <WorkflowPanel
      description={storeCredentialHealthExplanation(credential.healthStatus)}
      title="Credential operations"
    >
      {canManage ? (
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!actions.test || testPending}
            onClick={onTest}
            type="button"
          >
            {testPending ? "Testing…" : "Test connection"}
          </Button>
          {actions.rotate ? (
            <RotateStoreCredentialSheet
              onRotate={onRotate}
              provider={credential.provider}
            />
          ) : null}
          {actions.revoke ? (
            <Button
              onClick={onRequestRevoke}
              type="button"
              variant="destructive"
            >
              Revoke
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          Organization owner or admin permission is required to test, rotate, or
          revoke this credential.{" "}
          <a className="font-semibold text-primary" href={membersHref}>
            Ask an Owner or Admin
          </a>
        </p>
      )}
      {testError || rotateError ? (
        <p className="mt-3 text-destructive text-sm" role="alert">
          {(testError ?? rotateError)?.message}
        </p>
      ) : null}
      {testSuccess ? (
        <p className="mt-3 text-muted-foreground text-sm" role="status">
          Test completed. Health is now{" "}
          {storeCredentialHealthLabel(testedHealthStatus)}. Testing reads only;
          it changes nothing in your store account.
        </p>
      ) : null}
      {confirmRevoke ? (
        <div className="mt-4 rounded border border-destructive/25 bg-destructive/5 p-4">
          <p className="font-semibold text-sm">
            Revoke this Store Server Credential?
          </p>
          <p className="mt-1 text-muted-foreground text-sm leading-6">
            Validation stops using this key and its intake token is cleared, so
            the notification endpoint stops resolving. Everything already
            recorded stays: the ledger is the evidence trail a revocation is
            usually part of investigating. Inputs that arrive afterwards are not
            attributed to this Project.
          </p>
          {revokeError ? (
            <p className="mt-2 text-destructive text-sm" role="alert">
              {revokeError.message}
            </p>
          ) : null}
          <div className="mt-3 flex gap-2">
            <Button
              disabled={revokePending}
              onClick={onConfirmRevoke}
              type="button"
              variant="destructive"
            >
              {revokePending ? "Revoking…" : "Confirm revoke"}
            </Button>
            <Button
              disabled={revokePending}
              onClick={onCancelRevoke}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </WorkflowPanel>
  );
}

/**
 * Everything Mosaic can state about the stored key, and nothing derived from
 * the key material itself.
 */
function CredentialMetadataPanel({
  credential,
  environmentName,
}: {
  credential: StoreServerCredential;
  environmentName: string;
}) {
  return (
    <WorkflowPanel
      description="Everything Mosaic can show about the stored key. No ciphertext, no key material, and no way to reveal either."
      title="Credential metadata"
    >
      <dl>
        <DefinitionRow
          label="Status"
          value={credentialStatusLabel(credential.status)}
        />
        <DefinitionRow
          label="Store Environment"
          value={storeEnvironmentLabel(credential.storeEnvironment)}
        />
        <DefinitionRow label="Mosaic Environment" value={environmentName} />
        {credential.provider === "app_store" ? (
          <>
            <DefinitionRow
              label="Issuer ID"
              value={credential.appleIssuerId ?? "—"}
            />
            <DefinitionRow
              label="Key ID"
              value={credential.appleKeyId ?? "—"}
            />
          </>
        ) : (
          <>
            <DefinitionRow
              label="Service account"
              value={credential.googleClientEmail ?? "—"}
            />
            <DefinitionRow
              label="Pub/Sub subscription"
              value={`${credential.googlePubSubProjectId ?? "—"} / ${credential.googlePubSubSubscriptionId ?? "—"}`}
            />
          </>
        )}
        <DefinitionRow
          label="Last error code"
          value={credential.lastErrorCode ?? "None recorded"}
        />
        <DefinitionRow
          label="Last tested"
          value={formatBillingTimestamp(credential.lastTestedAt)}
        />
        <DefinitionRow
          label="Created"
          value={formatBillingTimestamp(credential.createdAt)}
        />
        <DefinitionRow
          label="Rotated"
          value={formatBillingTimestamp(credential.rotatedAt)}
        />
        <DefinitionRow
          label="Revoked"
          value={formatBillingTimestamp(credential.revokedAt)}
        />
      </dl>
    </WorkflowPanel>
  );
}

/**
 * The Applications a verified store payload may be attributed to.
 */
function CredentialApplicationScopePanel({
  applications,
  credential,
}: {
  applications: readonly Application[];
  credential: StoreServerCredential;
}) {
  return (
    <WorkflowPanel
      description="A verified store payload is accepted only for an Application listed here. A mismatch is quarantined rather than attributed."
      title="Application scope"
    >
      {(credential.applications ?? []).length === 0 ? (
        <p className="text-sm">
          No Application scope is recorded for this credential.
        </p>
      ) : (
        <ul className="space-y-2">
          {credential.applications?.map((application) => (
            <li
              className="flex flex-wrap items-center justify-between gap-2 rounded border p-3 text-sm"
              key={application.applicationId}
            >
              <span className="font-medium">
                {applications.find(
                  (item) => item.id === application.applicationId
                )?.name ?? application.applicationId}
              </span>
              <span className="text-muted-foreground text-xs">
                {application.platform?.toUpperCase()} ·{" "}
                {application.providerApplicationIdentifier}
              </span>
            </li>
          ))}
        </ul>
      )}
    </WorkflowPanel>
  );
}
