import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr/ArrowLeft"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { buttonVariants } from "@/components/ui/button-variants"
import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary"
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state"
import {
  BillingBoundaryNote,
  DefinitionRow,
  EnvironmentBadges,
  ProviderBadge,
  StatusPill,
} from "@/features/billing-ledger/components/billing-chrome"
import {
  credentialStatusLabel,
  formatBillingTimestamp,
  storeEnvironmentLabel,
} from "@/features/billing-ledger/types/billing-vocabulary"
import { environmentsQueryOptions } from "@/features/environments/queries/environments-query"
import { ScopeMismatchRecovery } from "@/features/orgs/components/scope-mismatch-recovery"
import { WorkspacePage, WorkflowPanel } from "@/features/orgs/components/workspace-page"
import { useValidatedProjectScope } from "@/features/projects/hooks/use-validated-project-scope"
import { applicationsQueryOptions } from "@/features/projects/queries/projects-query"
import { NotificationEndpointPanel } from "@/features/store-connections/components/notification-endpoint-panel"
import { NotificationSetupGuide } from "@/features/store-connections/components/notification-setup-guide"
import { RotateStoreCredentialSheet } from "@/features/store-connections/components/rotate-store-credential-sheet"
import {
  revokeStoreCredentialMutationOptions,
  rotateStoreCredentialMutationOptions,
  testStoreCredentialMutationOptions,
} from "@/features/store-connections/mutations/store-credential-mutations"
import {
  clearStoreCredentialSecretMutationCache,
  transferStoreCredentialEndpoint,
} from "@/features/store-connections/mutations/store-credential-secret-cache"
import { storeCredentialQueryOptions } from "@/features/store-connections/queries/store-connection-queries"
import {
  storeCredentialActions,
  storeCredentialHealthExplanation,
  storeCredentialHealthLabel,
  usesInboundNotificationEndpoint,
} from "@/features/store-connections/types/store-connection-view"
import { useOrganizationAccess } from "@/hooks/use-organization-access"
import type { StoreServerCredentialWithEndpoint } from "@/generated/api"
import { storeConnectionsHref } from "@/lib/routing/workspace-hrefs"

interface StoreConnectionDetailPageProps {
  credentialId: string
  organizationId: string
  projectId: string
}

export function StoreConnectionDetailPage({
  credentialId,
  organizationId,
  projectId,
}: StoreConnectionDetailPageProps) {
  const queryClient = useQueryClient()
  const access = useOrganizationAccess(organizationId)
  const [revealed, setRevealed] = useState<StoreServerCredentialWithEndpoint | null>(null)
  const [confirmRevoke, setConfirmRevoke] = useState(false)
  const { project, scopeMismatch, scopeReady } = useValidatedProjectScope(organizationId, projectId)
  const credential = useQuery({
    ...storeCredentialQueryOptions(projectId, credentialId),
    enabled: scopeReady,
  })
  const environments = useQuery({ ...environmentsQueryOptions(projectId), enabled: scopeReady })
  const applications = useQuery({ ...applicationsQueryOptions(projectId), enabled: scopeReady })
  const rotate = useMutation(
    rotateStoreCredentialMutationOptions(credentialId, projectId, queryClient),
  )
  const revoke = useMutation(
    revokeStoreCredentialMutationOptions(credentialId, projectId, queryClient),
  )
  const test = useMutation(testStoreCredentialMutationOptions(credentialId, projectId, queryClient))

  function sanitizeSecretMutationState() {
    rotate.reset()
    clearStoreCredentialSecretMutationCache(queryClient)
  }

  const record = credential.data
  const environmentName =
    environments.data?.items.find((item) => item.id === record?.environmentId)?.name ??
    record?.environmentId ??
    "—"
  const actions = record
    ? storeCredentialActions(record)
    : { revoke: false, rotate: false, test: false }
  const error = project.error ?? credential.error ?? environments.error ?? applications.error
  const state = resolveHostedQueryState({
    emptyDescription: "Return to Store Server Credentials and choose an existing connection.",
    emptyTitle: "Store Server Credential unavailable",
    error,
    isEmpty: credential.isSuccess && !record,
    isPending:
      project.isPending ||
      (scopeReady && (credential.isPending || environments.isPending || applications.isPending)),
    loadingDescription: "Loading Store Server Credential metadata and health.",
    onRetry: () => {
      void credential.refetch()
    },
    permissionDescription:
      "Organization owner or admin permission is required to inspect a Store Server Credential.",
    scope: { organizationId, projectId },
  })

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
    )
  }

  const listHref = storeConnectionsHref({ organizationId, projectId }) ?? "#"

  return (
    <WorkspacePage
      actions={
        <a className={buttonVariants({ size: "sm", variant: "outline" })} href={listHref}>
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
                tone={
                  record.healthStatus === "healthy"
                    ? "positive"
                    : record.healthStatus === "untested"
                      ? "neutral"
                      : "negative"
                }
              />
              {record.status === "revoked" ? <StatusPill label="Revoked" tone="negative" /> : null}
            </div>

            <WorkflowPanel
              description={storeCredentialHealthExplanation(record.healthStatus)}
              title="Credential operations"
            >
              {access.canManage ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={!actions.test || test.isPending}
                    onClick={() => test.mutate()}
                    type="button"
                  >
                    {test.isPending ? "Testing…" : "Test connection"}
                  </Button>
                  {actions.rotate ? (
                    <RotateStoreCredentialSheet
                      onRotate={async (secret) => {
                        const rotated = await rotate.mutateAsync({ secret })
                        transferStoreCredentialEndpoint(
                          queryClient,
                          rotated,
                          setRevealed,
                          sanitizeSecretMutationState,
                        )
                      }}
                      provider={record.provider}
                    />
                  ) : null}
                  {actions.revoke ? (
                    <Button
                      onClick={() => setConfirmRevoke(true)}
                      type="button"
                      variant="destructive"
                    >
                      Revoke
                    </Button>
                  ) : null}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">
                  Organization owner or admin permission is required to test, rotate, or revoke this
                  credential.{" "}
                  <a
                    className="text-primary font-semibold"
                    href={`/orgs/${encodeURIComponent(organizationId)}/members`}
                  >
                    Ask an Owner or Admin
                  </a>
                </p>
              )}
              {test.error || rotate.error ? (
                <p className="text-destructive mt-3 text-sm" role="alert">
                  {(test.error ?? rotate.error)?.message}
                </p>
              ) : null}
              {test.isSuccess ? (
                <p className="text-muted-foreground mt-3 text-sm" role="status">
                  Test completed. Health is now{" "}
                  {storeCredentialHealthLabel(test.data?.healthStatus)}. Testing reads only; it
                  changes nothing in your store account.
                </p>
              ) : null}
              {confirmRevoke ? (
                <div className="border-destructive/25 bg-destructive/5 mt-4 rounded border p-4">
                  <p className="text-sm font-semibold">Revoke this Store Server Credential?</p>
                  <p className="text-muted-foreground mt-1 text-sm leading-6">
                    Validation stops using this key and its intake token is cleared, so the
                    notification endpoint stops resolving. Everything already recorded stays: the
                    ledger is the evidence trail a revocation is usually part of investigating.
                    Inputs that arrive afterwards are not attributed to this Project.
                  </p>
                  {revoke.error ? (
                    <p className="text-destructive mt-2 text-sm" role="alert">
                      {revoke.error.message}
                    </p>
                  ) : null}
                  <div className="mt-3 flex gap-2">
                    <Button
                      disabled={revoke.isPending}
                      onClick={() =>
                        revoke.mutate(undefined, { onSuccess: () => setConfirmRevoke(false) })
                      }
                      type="button"
                      variant="destructive"
                    >
                      {revoke.isPending ? "Revoking…" : "Confirm revoke"}
                    </Button>
                    <Button
                      disabled={revoke.isPending}
                      onClick={() => setConfirmRevoke(false)}
                      type="button"
                      variant="outline"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : null}
            </WorkflowPanel>

            {usesInboundNotificationEndpoint(record) ? (
              <NotificationEndpointPanel
                {...(revealed?.notificationEndpointUrl
                  ? { endpointUrl: revealed.notificationEndpointUrl }
                  : {})}
                onDismiss={() => {
                  setRevealed(null)
                  sanitizeSecretMutationState()
                }}
              />
            ) : null}

            <NotificationSetupGuide credential={record} />

            <WorkflowPanel
              description="Everything Mosaic can show about the stored key. No ciphertext, no key material, and no way to reveal either."
              title="Credential metadata"
            >
              <dl>
                <DefinitionRow label="Status" value={credentialStatusLabel(record.status)} />
                <DefinitionRow
                  label="Store Environment"
                  value={storeEnvironmentLabel(record.storeEnvironment)}
                />
                <DefinitionRow label="Mosaic Environment" value={environmentName} />
                {record.provider === "app_store" ? (
                  <>
                    <DefinitionRow label="Issuer ID" value={record.appleIssuerId ?? "—"} />
                    <DefinitionRow label="Key ID" value={record.appleKeyId ?? "—"} />
                  </>
                ) : (
                  <>
                    <DefinitionRow
                      label="Service account"
                      value={record.googleClientEmail ?? "—"}
                    />
                    <DefinitionRow
                      label="Pub/Sub subscription"
                      value={`${record.googlePubSubProjectId ?? "—"} / ${record.googlePubSubSubscriptionId ?? "—"}`}
                    />
                  </>
                )}
                <DefinitionRow
                  label="Last error code"
                  value={record.lastErrorCode ?? "None recorded"}
                />
                <DefinitionRow
                  label="Last tested"
                  value={formatBillingTimestamp(record.lastTestedAt)}
                />
                <DefinitionRow label="Created" value={formatBillingTimestamp(record.createdAt)} />
                <DefinitionRow label="Rotated" value={formatBillingTimestamp(record.rotatedAt)} />
                <DefinitionRow label="Revoked" value={formatBillingTimestamp(record.revokedAt)} />
              </dl>
            </WorkflowPanel>

            <WorkflowPanel
              description="A verified store payload is accepted only for an Application listed here. A mismatch is quarantined rather than attributed."
              title="Application scope"
            >
              {(record.applications ?? []).length === 0 ? (
                <p className="text-sm">No Application scope is recorded for this credential.</p>
              ) : (
                <ul className="space-y-2">
                  {record.applications?.map((application) => (
                    <li
                      className="flex flex-wrap items-center justify-between gap-2 rounded border p-3 text-sm"
                      key={application.applicationId}
                    >
                      <span className="font-medium">
                        {applications.data?.items.find(
                          (item) => item.id === application.applicationId,
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
          </>
        ) : null}
      </HostedResourceBoundary>
    </WorkspacePage>
  )
}
