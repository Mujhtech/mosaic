import { KeyIcon } from "@phosphor-icons/react/dist/ssr/Key"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { OneTimeSecret } from "@/components/feedback/one-time-secret"
import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary"
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state"
import {
  buildApiKeyCreationInput,
  createApiKeyMutationOptions,
  revokeApiKeyMutationOptions,
  rotateApiKeyMutationOptions,
} from "@/features/api-keys/mutations/api-key-mutations"
import {
  clearApiKeySecretMutationCache,
  transferApiKeySecret,
} from "@/features/api-keys/mutations/api-key-secret-cache"
import { apiKeysQueryOptions } from "@/features/api-keys/queries/api-keys-query"
import { environmentsQueryOptions } from "@/features/environments/queries/environments-query"
import { WorkspacePage, WorkflowPanel } from "@/features/orgs/components/workspace-page"
import { ScopeMismatchRecovery } from "@/features/orgs/components/scope-mismatch-recovery"
import { useValidatedProjectScope } from "@/features/projects/hooks/use-validated-project-scope"
import { applicationsQueryOptions } from "@/features/projects/queries/projects-query"
import type { ApiKey, ApiKeySecretResult } from "@/generated/api"

interface ApiKeysPageProps {
  environmentId?: string
  organizationId: string
  projectId: string
}

interface PendingKeyAction {
  action: "revoke" | "rotate"
  apiKey: ApiKey
}

export function ApiKeysPage({ environmentId, organizationId, projectId }: ApiKeysPageProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [revealed, setRevealed] = useState<ApiKeySecretResult | null>(null)
  const [pendingAction, setPendingAction] = useState<PendingKeyAction | null>(null)
  const [applicationId, setApplicationId] = useState("")
  const { project, scopeMismatch, scopeReady } = useValidatedProjectScope(organizationId, projectId)
  const environments = useQuery({ ...environmentsQueryOptions(projectId), enabled: scopeReady })
  const applications = useQuery({ ...applicationsQueryOptions(projectId), enabled: scopeReady })
  const selectedEnvironment =
    environments.data?.items.find((item) => item.id === environmentId) ??
    environments.data?.items.find((item) => item.key === "development") ??
    environments.data?.items[0]
  const keys = useQuery({
    ...apiKeysQueryOptions(selectedEnvironment?.id ?? ""),
    enabled: scopeReady && Boolean(selectedEnvironment),
  })
  function sanitizeSecretMutationState() {
    create.reset()
    rotate.reset()
    clearApiKeySecretMutationCache(queryClient)
  }

  function dismissSecret() {
    setRevealed(null)
    sanitizeSecretMutationState()
  }

  const create = useMutation(
    createApiKeyMutationOptions(selectedEnvironment?.id ?? "", queryClient),
  )
  const rotate = useMutation(
    rotateApiKeyMutationOptions(selectedEnvironment?.id ?? "", queryClient),
  )
  const revoke = useMutation(
    revokeApiKeyMutationOptions(selectedEnvironment?.id ?? "", queryClient),
  )
  function revealSecret(result: ApiKeySecretResult) {
    transferApiKeySecret(queryClient, result, setRevealed, sanitizeSecretMutationState)
  }
  const items = keys.data?.items ?? []
  const error = project.error ?? environments.error ?? applications.error ?? keys.error
  const state = resolveHostedQueryState({
    emptyDescription: "Create an SDK key safe for an app or a server key that must remain secret.",
    emptyTitle: "No API keys in this environment",
    error,
    isEmpty: scopeReady && environments.isSuccess && keys.isSuccess && items.length === 0,
    isPending:
      project.isPending ||
      (scopeReady &&
        (environments.isPending ||
          applications.isPending ||
          (Boolean(selectedEnvironment) && keys.isPending))),
    loadingDescription: "Loading environment-scoped API-key metadata.",
    onRetry: () => {
      void environments.refetch()
      void applications.refetch()
      void keys.refetch()
    },
    permissionDescription: "Project owner or admin permission is required to manage API keys.",
  })

  const canManageKeys = state.kind === "empty" || state.kind === "ready"

  if (scopeMismatch) {
    return (
      <WorkspacePage
        description="The routed Organization does not own this Project."
        title="API keys unavailable in this Organization"
      >
        <ScopeMismatchRecovery
          mismatch={scopeMismatch}
          organizationId={organizationId}
          projectId={projectId}
        />
      </WorkspacePage>
    )
  }

  return (
    <WorkspacePage
      description="Keys are scoped to one environment. Raw secrets appear only after creation or rotation and are never listed again."
      title="API keys"
    >
      <WorkflowPanel title="Environment">
        <label className="flex max-w-md flex-col gap-2 text-sm font-medium">
          Selected environment
          <select
            className="border-input bg-background h-9 rounded border px-3 text-sm"
            onChange={(event) => {
              dismissSecret()
              setPendingAction(null)
              void navigate({
                params: (prev) => prev,
                search: { environmentId: event.target.value },
                to: "/orgs/$organizationId/projects/$projectId/env/$environmentKey/settings/api-keys",
              })
            }}
            value={selectedEnvironment?.id ?? ""}
          >
            {environments.data?.items.map((environment) => (
              <option key={environment.id} value={environment.id}>
                {environment.name}
              </option>
            ))}
          </select>
        </label>
      </WorkflowPanel>

      {revealed ? <OneTimeSecret onDismiss={dismissSecret} secret={revealed.secret} /> : null}

      {/* Rotation and revocation are destructive and irreversible, so the
          confirmation is a modal surface: it takes focus, traps it, restores
          focus to the invoking row action, and closes on Escape. */}
      <Sheet
        onOpenChange={(open) => {
          if (!open) setPendingAction(null)
        }}
        open={pendingAction !== null}
      >
        <SheetContent className="w-full sm:max-w-md">
          {pendingAction ? (
            <>
              <SheetHeader className="border-b p-5">
                <SheetTitle>
                  {pendingAction.action === "rotate" ? "Rotate" : "Revoke"}{" "}
                  {pendingAction.apiKey.prefix}••••
                </SheetTitle>
                <SheetDescription>
                  This action applies only to{" "}
                  {selectedEnvironment?.name ?? "the selected environment"}.
                </SheetDescription>
              </SheetHeader>
              <div className="p-5">
                <p className="text-muted-foreground text-sm leading-6">
                  {pendingAction.action === "rotate"
                    ? "Rotation invalidates the previous credential and reveals its replacement once. Copy it before leaving this page."
                    : "Revocation is permanent. Clients using this credential in the selected environment will stop authenticating."}
                </p>
              </div>
              <SheetFooter className="flex-row flex-wrap gap-2 border-t p-5">
                <Button
                  disabled={rotate.isPending || revoke.isPending}
                  onClick={() => {
                    const onSuccess = () => setPendingAction(null)
                    if (pendingAction.action === "rotate") {
                      rotate.mutate(pendingAction.apiKey.id, {
                        onSuccess: (result) => {
                          revealSecret(result)
                          onSuccess()
                        },
                      })
                    } else {
                      revoke.mutate(pendingAction.apiKey.id, { onSuccess })
                    }
                  }}
                >
                  Confirm {pendingAction.action}
                </Button>
                <Button onClick={() => setPendingAction(null)} variant="ghost">
                  Cancel
                </Button>
              </SheetFooter>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      <HostedResourceBoundary state={state}>
        <WorkflowPanel title="Environment keys">
          <ul className="divide-y">
            {items.map((apiKey) => {
              const revoked = Boolean(apiKey.revokedAt)
              return (
                <li
                  className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center"
                  key={apiKey.id}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">
                      {apiKey.kind === "public_sdk"
                        ? "SDK key — safe for apps"
                        : "Server key — keep secret"}
                    </p>
                    <p className="text-muted-foreground mt-1 font-mono text-xs">
                      {apiKey.prefix}••••••••
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {revoked
                        ? "Revoked"
                        : apiKey.lastUsedAt
                          ? `Last used ${apiKey.lastUsedAt}`
                          : "Never used"}
                    </p>
                    {apiKey.kind === "public_sdk" ? (
                      <p className="text-muted-foreground mt-1 text-xs">
                        {readApiKeyApplicationId(apiKey)
                          ? `Analytics application: ${applications.data?.items.find((application) => application.id === readApiKeyApplicationId(apiKey))?.name ?? readApiKeyApplicationId(apiKey)}`
                          : "Legacy unbound key — configuration works, but analytics ingestion is rejected. Create an Application-bound SDK key to recover."}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      disabled={revoked || rotate.isPending}
                      onClick={() => setPendingAction({ action: "rotate", apiKey })}
                      size="sm"
                      variant="outline"
                    >
                      Rotate
                    </Button>
                    <Button
                      disabled={revoked || revoke.isPending}
                      onClick={() => setPendingAction({ action: "revoke", apiKey })}
                      size="sm"
                      variant="outline"
                    >
                      Revoke
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        </WorkflowPanel>
      </HostedResourceBoundary>
      {canManageKeys ? (
        <WorkflowPanel
          description="SDK keys are safe for apps. Server keys must only be used by trusted backend services."
          title="Create API key"
        >
          <div className="grid max-w-xl gap-3">
            <label className="space-y-1 text-sm font-medium">
              Application for SDK analytics
              <select
                className="border-input bg-background h-10 w-full rounded border px-3"
                onChange={(event) => setApplicationId(event.target.value)}
                value={applicationId}
              >
                <option value="">Select an Application</option>
                {applications.data?.items.map((application) => (
                  <option key={application.id} value={application.id}>
                    {application.name} · {application.platform}
                  </option>
                ))}
              </select>
              <span className="text-muted-foreground block text-xs font-normal">
                Public SDK keys must be bound to one registered Application to ingest analytics.
                Tenant scope still comes from the key; events never submit an Application ID.
              </span>
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={!applicationId || create.isPending}
                onClick={() =>
                  create.mutate(buildApiKeyCreationInput("public_sdk", applicationId), {
                    onSuccess: revealSecret,
                  })
                }
              >
                <KeyIcon aria-hidden size={16} />
                Create SDK key
              </Button>
              <Button
                onClick={() =>
                  create.mutate(buildApiKeyCreationInput("secret_server"), {
                    onSuccess: revealSecret,
                  })
                }
                variant="outline"
              >
                Create server key
              </Button>
            </div>
          </div>
          {create.error || rotate.error || revoke.error ? (
            <p className="text-destructive mt-4 text-sm" role="alert">
              {(create.error ?? rotate.error ?? revoke.error)?.message}
            </p>
          ) : null}
        </WorkflowPanel>
      ) : null}
    </WorkspacePage>
  )
}

function readApiKeyApplicationId(apiKey: ApiKey) {
  return apiKey.applicationId
}
