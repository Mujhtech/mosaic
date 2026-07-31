import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { buttonVariants } from "@/components/ui/button-variants"
import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary"
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state"
import {
  BillingBoundaryNote,
  StatusPill,
} from "@/features/billing-ledger/components/billing-chrome"
import {
  BILLING_OPTIONAL_NOTE,
  ENVIRONMENT_DISTINCTION_NOTE,
  formatBillingTimestamp,
  providerLabel,
  storeEnvironmentLabel,
} from "@/features/billing-ledger/types/billing-vocabulary"
import { environmentsQueryOptions } from "@/features/environments/queries/environments-query"
import { ScopeMismatchRecovery } from "@/features/organizations/components/scope-mismatch-recovery"
import { WorkspacePage, WorkflowPanel } from "@/features/organizations/components/workspace-page"
import { useValidatedProjectScope } from "@/features/projects/hooks/use-validated-project-scope"
import { applicationsQueryOptions } from "@/features/projects/queries/projects-query"
import { BillingEnablementPanel } from "@/features/store-connections/components/billing-enablement-panel"
import { ConnectStoreCredentialSheet } from "@/features/store-connections/components/connect-store-credential-sheet"
import { NotificationEndpointPanel } from "@/features/store-connections/components/notification-endpoint-panel"
import { updateBillingSettingsMutationOptions } from "@/features/store-connections/mutations/billing-settings-mutations"
import { createStoreCredentialMutationOptions } from "@/features/store-connections/mutations/store-credential-mutations"
import {
  clearStoreCredentialSecretMutationCache,
  transferStoreCredentialEndpoint,
} from "@/features/store-connections/mutations/store-credential-secret-cache"
import { billingSettingsQueryOptions } from "@/features/store-connections/queries/billing-settings-queries"
import { storeCredentialsQueryOptions } from "@/features/store-connections/queries/store-connection-queries"
import {
  storeCredentialHealthLabel,
  usesInboundNotificationEndpoint,
} from "@/features/store-connections/types/store-connection-view"
import { useOrganizationAccess } from "@/hooks/use-organization-access"
import type { StoreServerCredentialWithEndpoint } from "@/generated/api"
import { storeConnectionHref } from "@/lib/routing/workspace-hrefs"

interface StoreConnectionsPageProps {
  organizationId: string
  projectId: string
}

export function StoreConnectionsPage({ organizationId, projectId }: StoreConnectionsPageProps) {
  const queryClient = useQueryClient()
  const access = useOrganizationAccess(organizationId)
  const [revealed, setRevealed] = useState<StoreServerCredentialWithEndpoint | null>(null)
  const { project, scopeMismatch, scopeReady } = useValidatedProjectScope(organizationId, projectId)
  const credentials = useQuery({
    ...storeCredentialsQueryOptions(projectId),
    enabled: scopeReady,
  })
  const environments = useQuery({ ...environmentsQueryOptions(projectId), enabled: scopeReady })
  const applications = useQuery({ ...applicationsQueryOptions(projectId), enabled: scopeReady })
  // Billing enablement is a Project-level flag with no read endpoint of its
  // own, so it is probed through billing health on any one Environment.
  const probeEnvironmentId = environments.data?.items[0]?.id ?? ""
  const billingSettings = useQuery({
    ...billingSettingsQueryOptions(projectId, probeEnvironmentId),
    enabled: scopeReady && probeEnvironmentId.length > 0,
  })
  const create = useMutation(createStoreCredentialMutationOptions(projectId, queryClient))
  const updateSettings = useMutation(updateBillingSettingsMutationOptions(projectId, queryClient))

  function sanitizeSecretMutationState() {
    create.reset()
    clearStoreCredentialSecretMutationCache(queryClient)
  }

  function dismissEndpoint() {
    setRevealed(null)
    sanitizeSecretMutationState()
  }

  const items = credentials.data ?? []
  const activeCredentialCount = items.filter((credential) => credential.status !== "revoked").length
  const billingEnabled = billingSettings.data?.billingEnabled ?? null
  const error = project.error ?? credentials.error ?? environments.error ?? applications.error
  const state = resolveHostedQueryState({
    emptyDescription:
      billingEnabled === false
        ? `Turn Mosaic Billing on above, then add an Apple or Google Store Server Credential. ${BILLING_OPTIONAL_NOTE}`
        : `Add an Apple or Google Store Server Credential to start recording store-confirmed transaction facts. ${BILLING_OPTIONAL_NOTE}`,
    emptyTitle: "No Store Server Credential yet",
    error,
    isEmpty: scopeReady && credentials.isSuccess && items.length === 0,
    isPending:
      project.isPending ||
      (scopeReady && (credentials.isPending || environments.isPending || applications.isPending)),
    loadingDescription: "Loading Store Server Credential metadata for this Project.",
    onRetry: () => {
      void credentials.refetch()
      void environments.refetch()
      void applications.refetch()
    },
    permissionDescription:
      "Organization owner or admin permission is required to manage Store Server Credentials.",
    scope: { organizationId, projectId },
  })

  if (scopeMismatch) {
    return (
      <WorkspacePage
        description="The routed Organization does not own this Project."
        title="Mosaic Billing unavailable in this Organization"
      >
        <ScopeMismatchRecovery
          mismatch={scopeMismatch}
          organizationId={organizationId}
          projectId={projectId}
        />
      </WorkspacePage>
    )
  }

  const projectBase = `/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}`

  return (
    <WorkspacePage
      actions={
        access.canManage ? (
          <ConnectStoreCredentialSheet
            applications={applications.data?.items ?? []}
            applicationsHref={`${projectBase}/apps`}
            environments={environments.data?.items ?? []}
            environmentsHref={`${projectBase}/settings/environments`}
            onCreate={async (request) => {
              const credential = await create.mutateAsync(request)
              transferStoreCredentialEndpoint(
                queryClient,
                credential,
                setRevealed,
                sanitizeSecretMutationState,
              )
            }}
          />
        ) : null
      }
      description="Set Mosaic Billing up for this Project here: turn it on, then give Mosaic the credentials it needs to ask Apple and Google whether a transaction is authentic. Secret material is written once and never returned."
      eyebrow="Mosaic Billing · Setup"
      title="Store Server Credentials"
    >
      <BillingBoundaryNote>{ENVIRONMENT_DISTINCTION_NOTE}</BillingBoundaryNote>

      <BillingEnablementPanel
        activeCredentialCount={activeCredentialCount}
        billingEnabled={billingEnabled}
        canManage={access.canManage}
        error={updateSettings.error}
        isPending={billingSettings.isPending && probeEnvironmentId.length > 0}
        isSaving={updateSettings.isPending}
        membersHref={`/organizations/${encodeURIComponent(organizationId)}/members`}
        onChange={(nextEnabled) => updateSettings.mutate({ billingEnabled: nextEnabled })}
      />

      {revealed?.notificationEndpointUrl ? (
        <NotificationEndpointPanel
          endpointUrl={revealed.notificationEndpointUrl}
          onDismiss={dismissEndpoint}
        />
      ) : null}

      {create.error ? (
        <p className="text-destructive text-sm" role="alert">
          {create.error.message}
        </p>
      ) : null}

      <HostedResourceBoundary state={state}>
        <WorkflowPanel
          description="Sandbox and production are always separate connections. Each credential belongs to exactly one Mosaic Environment."
          title="Connections"
        >
          <ul className="divide-y">
            {items.map((credential) => (
              <li
                className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center"
                key={credential.id}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">
                    {credential.name ?? "Store Server Credential"}
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {providerLabel(credential.provider)} · Store Environment{" "}
                    {storeEnvironmentLabel(credential.storeEnvironment)} ·{" "}
                    {credential.applications?.length ?? 0} Application scope(s)
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {usesInboundNotificationEndpoint(credential)
                      ? "Apple posts notifications to a Mosaic endpoint."
                      : "Mosaic pulls notifications from Pub/Sub."}{" "}
                    Last tested {formatBillingTimestamp(credential.lastTestedAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill
                    label={storeCredentialHealthLabel(credential.healthStatus)}
                    tone={
                      credential.healthStatus === "healthy"
                        ? "positive"
                        : credential.healthStatus === "untested"
                          ? "neutral"
                          : "negative"
                    }
                  />
                  {credential.status === "revoked" ? (
                    <StatusPill label="Revoked" tone="negative" />
                  ) : null}
                  <a
                    className={buttonVariants({ size: "sm", variant: "outline" })}
                    href={
                      storeConnectionHref({ organizationId, projectId }, credential.id ?? "") ?? "#"
                    }
                  >
                    Open
                  </a>
                </div>
              </li>
            ))}
          </ul>
        </WorkflowPanel>
      </HostedResourceBoundary>
    </WorkspacePage>
  )
}
