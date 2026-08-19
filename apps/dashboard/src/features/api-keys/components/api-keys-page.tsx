import { KeyIcon } from "@phosphor-icons/react/dist/ssr/Key";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { OneTimeSecret } from "@/components/feedback/one-time-secret";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  buildApiKeyCreationInput,
  createApiKeyMutationOptions,
  revokeApiKeyMutationOptions,
  rotateApiKeyMutationOptions,
} from "@/features/api-keys/mutations/api-key-mutations";
import {
  clearApiKeySecretMutationCache,
  transferApiKeySecret,
} from "@/features/api-keys/mutations/api-key-secret-cache";
import { apiKeysQueryOptions } from "@/features/api-keys/queries/api-keys-query";
import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary";
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state";
import { environmentsQueryOptions } from "@/features/environments/queries/environments-query";
import { ScopeMismatchRecovery } from "@/features/orgs/components/scope-mismatch-recovery";
import {
  WorkflowPanel,
  WorkspacePage,
} from "@/features/orgs/components/workspace-page";
import { useValidatedProjectScope } from "@/features/projects/hooks/use-validated-project-scope";
import { applicationsQueryOptions } from "@/features/projects/queries/projects-query";
import type { ApiKey, ApiKeySecretResult, Application } from "@/generated/api";
import { workspaceScopeParams } from "@/lib/routing/workspace-params";

interface ApiKeysPageProps {
  environmentId?: string;
  organizationId: string;
  projectId: string;
}

interface PendingKeyAction {
  action: "revoke" | "rotate";
  apiKey: ApiKey;
}

interface SelectOption {
  label: string;
  value: string;
}

export function ApiKeysPage({
  environmentId,
  organizationId,
  projectId,
}: ApiKeysPageProps) {
  const handleClick = useCallback(() => setPendingAction(null), []);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [revealed, setRevealed] = useState<ApiKeySecretResult | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingKeyAction | null>(
    null
  );
  const [applicationId, setApplicationId] = useState("");
  const { project, scopeMismatch, scopeReady } = useValidatedProjectScope(
    organizationId,
    projectId
  );
  const environments = useQuery({
    ...environmentsQueryOptions(projectId),
    enabled: scopeReady,
  });
  const applications = useQuery({
    ...applicationsQueryOptions(projectId),
    enabled: scopeReady,
  });
  const selectedEnvironment =
    environments.data?.items.find((item) => item.id === environmentId) ??
    environments.data?.items.find((item) => item.key === "development") ??
    environments.data?.items[0];
  const environmentOptions = (environments.data?.items ?? []).map(
    (environment) => ({
      label: environment.name,
      value: environment.id,
    })
  );
  const applicationOptions = [
    { label: "Select an Application", value: "" },
    ...(applications.data?.items ?? []).map((application) => ({
      label: `${application.name} · ${application.platform}`,
      value: application.id,
    })),
  ];
  const keys = useQuery({
    ...apiKeysQueryOptions(selectedEnvironment?.id ?? ""),
    enabled: scopeReady && Boolean(selectedEnvironment),
  });
  const create = useMutation(
    createApiKeyMutationOptions(selectedEnvironment?.id ?? "", queryClient)
  );
  const rotate = useMutation(
    rotateApiKeyMutationOptions(selectedEnvironment?.id ?? "", queryClient)
  );
  const revoke = useMutation(
    revokeApiKeyMutationOptions(selectedEnvironment?.id ?? "", queryClient)
  );
  const sanitizeSecretMutationState = useCallback(() => {
    create.reset();
    rotate.reset();
    clearApiKeySecretMutationCache(queryClient);
  }, [create, queryClient, rotate]);

  const dismissSecret = useCallback(() => {
    setRevealed(null);
    sanitizeSecretMutationState();
  }, [sanitizeSecretMutationState]);
  const revealSecret = useCallback(
    (result: ApiKeySecretResult) => {
      transferApiKeySecret(
        queryClient,
        result,
        setRevealed,
        sanitizeSecretMutationState
      );
    },
    [queryClient, sanitizeSecretMutationState]
  );
  const handleClick3 = useCallback(
    () =>
      create.mutate(buildApiKeyCreationInput("secret_server"), {
        onSuccess: revealSecret,
      }),
    [create, revealSecret]
  );
  const handleClick2 = useCallback(
    () =>
      create.mutate(buildApiKeyCreationInput("public_sdk", applicationId), {
        onSuccess: revealSecret,
      }),
    [applicationId, create, revealSecret]
  );
  const items = keys.data?.items ?? [];
  const error =
    project.error ?? environments.error ?? applications.error ?? keys.error;
  const state = resolveHostedQueryState({
    emptyDescription:
      "Create an SDK key safe for an app or a server key that must remain secret.",
    emptyTitle: "No API keys in this environment",
    error,
    isEmpty:
      scopeReady &&
      environments.isSuccess &&
      keys.isSuccess &&
      items.length === 0,
    isPending:
      project.isPending ||
      (scopeReady &&
        (environments.isPending ||
          applications.isPending ||
          (Boolean(selectedEnvironment) && keys.isPending))),
    loadingDescription: "Loading environment-scoped API-key metadata.",
    onRetry: () => {
      environments.refetch();
      applications.refetch();
      keys.refetch();
    },
    permissionDescription:
      "Project owner or admin permission is required to manage API keys.",
  });

  const canManageKeys = state.kind === "empty" || state.kind === "ready";

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
    );
  }

  return (
    <WorkspacePage
      description="Keys are scoped to one environment. Raw secrets appear only after creation or rotation and are never listed again."
      title="API keys"
    >
      <EnvironmentSelectPanel
        onChange={(value) => {
          dismissSecret();
          setPendingAction(null);
          navigate({
            params: (prev) => ({
              ...prev,
              ...workspaceScopeParams(prev),
            }),
            search: { environmentId: value },
            to: "/orgs/$organizationId/projects/$projectId/env/$environmentKey/settings/api-keys",
          });
        }}
        options={environmentOptions}
        value={selectedEnvironment?.id ?? ""}
      />

      {revealed ? (
        <OneTimeSecret onDismiss={dismissSecret} secret={revealed.secret} />
      ) : null}

      <PendingActionSheet
        environmentName={selectedEnvironment?.name}
        isPending={rotate.isPending || revoke.isPending}
        onCancel={handleClick}
        onConfirm={(action) => {
          const onSuccess = () => setPendingAction(null);
          if (action.action === "rotate") {
            rotate.mutate(action.apiKey.id, {
              onSuccess: (result) => {
                revealSecret(result);
                onSuccess();
              },
            });
          } else {
            revoke.mutate(action.apiKey.id, { onSuccess });
          }
        }}
        pendingAction={pendingAction}
      />

      <HostedResourceBoundary state={state}>
        <WorkflowPanel title="Environment keys">
          <ul className="divide-y">
            {items.map((apiKey) => (
              <ApiKeyRow
                apiKey={apiKey}
                applications={applications.data?.items}
                key={apiKey.id}
                onRequestAction={setPendingAction}
                revokePending={revoke.isPending}
                rotatePending={rotate.isPending}
              />
            ))}
          </ul>
        </WorkflowPanel>
      </HostedResourceBoundary>
      {canManageKeys ? (
        <CreateApiKeyPanel
          applicationId={applicationId}
          applicationOptions={applicationOptions}
          createPending={create.isPending}
          error={create.error ?? rotate.error ?? revoke.error}
          onApplicationChange={setApplicationId}
          onCreateSdkKey={handleClick2}
          onCreateServerKey={handleClick3}
        />
      ) : null}
    </WorkspacePage>
  );
}

function EnvironmentSelectPanel({
  onChange,
  options,
  value,
}: {
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  value: string;
}) {
  return (
    <WorkflowPanel title="Environment">
      <div className="flex max-w-md flex-col gap-2 font-medium text-sm">
        <label htmlFor="api-key-environment">Selected environment</label>
        <Select items={options} onValueChange={onChange} value={value}>
          <SelectTrigger id="api-key-environment">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </WorkflowPanel>
  );
}

/**
 * Rotation and revocation are destructive and irreversible, so the confirmation
 * is a modal surface: it takes focus, traps it, restores focus to the invoking
 * row action, and closes on Escape.
 */
function PendingActionSheet({
  environmentName,
  isPending,
  onCancel,
  onConfirm,
  pendingAction,
}: {
  environmentName: string | undefined;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: (action: PendingKeyAction) => void;
  pendingAction: PendingKeyAction | null;
}) {
  return (
    <Sheet
      onOpenChange={(open) => {
        if (!open) {
          onCancel();
        }
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
                {environmentName ?? "the selected environment"}.
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
                disabled={isPending}
                onClick={() => onConfirm(pendingAction)}
              >
                Confirm {pendingAction.action}
              </Button>
              <Button onClick={onCancel} variant="ghost">
                Cancel
              </Button>
            </SheetFooter>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function ApiKeyRow({
  apiKey,
  applications,
  onRequestAction,
  revokePending,
  rotatePending,
}: {
  apiKey: ApiKey;
  applications: readonly Application[] | undefined;
  onRequestAction: (action: PendingKeyAction) => void;
  revokePending: boolean;
  rotatePending: boolean;
}) {
  const revoked = Boolean(apiKey.revokedAt);
  return (
    <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-sm">
          {apiKey.kind === "public_sdk"
            ? "SDK key — safe for apps"
            : "Server key — keep secret"}
        </p>
        <p className="mt-1 font-mono text-muted-foreground text-xs">
          {apiKey.prefix}••••••••
        </p>
        <p className="mt-1 text-muted-foreground text-xs">
          {(() => {
            if (revoked) {
              return "Revoked";
            }
            if (apiKey.lastUsedAt) {
              return `Last used ${apiKey.lastUsedAt}`;
            }
            return "Never used";
          })()}
        </p>
        {apiKey.kind === "public_sdk" ? (
          <p className="mt-1 text-muted-foreground text-xs">
            {readApiKeyApplicationId(apiKey)
              ? `Analytics application: ${applications?.find((application) => application.id === readApiKeyApplicationId(apiKey))?.name ?? readApiKeyApplicationId(apiKey)}`
              : "Legacy unbound key — configuration works, but analytics ingestion is rejected. Create an Application-bound SDK key to recover."}
          </p>
        ) : null}
      </div>
      <div className="flex gap-2">
        <Button
          disabled={revoked || rotatePending}
          onClick={() => onRequestAction({ action: "rotate", apiKey })}
          size="sm"
          variant="outline"
        >
          Rotate
        </Button>
        <Button
          disabled={revoked || revokePending}
          onClick={() => onRequestAction({ action: "revoke", apiKey })}
          size="sm"
          variant="outline"
        >
          Revoke
        </Button>
      </div>
    </li>
  );
}

function CreateApiKeyPanel({
  applicationId,
  applicationOptions,
  createPending,
  error,
  onApplicationChange,
  onCreateSdkKey,
  onCreateServerKey,
}: {
  applicationId: string;
  applicationOptions: readonly SelectOption[];
  createPending: boolean;
  error: Error | null;
  onApplicationChange: (applicationId: string) => void;
  onCreateSdkKey: () => void;
  onCreateServerKey: () => void;
}) {
  return (
    <WorkflowPanel
      description="SDK keys are safe for apps. Server keys must only be used by trusted backend services."
      title="Create API key"
    >
      <div className="grid max-w-xl gap-3">
        <div className="space-y-1 font-medium text-sm">
          <label htmlFor="api-key-application">
            Application for SDK analytics
          </label>
          <Select
            items={applicationOptions}
            onValueChange={(value) => onApplicationChange(value)}
            value={applicationId}
          >
            <SelectTrigger id="api-key-application">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {applicationOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="block font-normal text-muted-foreground text-xs">
            Public SDK keys must be bound to one registered Application to
            ingest analytics. Tenant scope still comes from the key; events
            never submit an Application ID.
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!applicationId || createPending}
            onClick={onCreateSdkKey}
          >
            <KeyIcon aria-hidden size={16} />
            Create SDK key
          </Button>
          <Button onClick={onCreateServerKey} variant="outline">
            Create server key
          </Button>
        </div>
      </div>
      {error ? (
        <p className="mt-4 text-destructive text-sm" role="alert">
          {error.message}
        </p>
      ) : null}
    </WorkflowPanel>
  );
}

function readApiKeyApplicationId(apiKey: ApiKey) {
  return apiKey.applicationId;
}
