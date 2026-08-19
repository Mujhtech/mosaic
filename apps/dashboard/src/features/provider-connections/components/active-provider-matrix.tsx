import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr/WarningCircle";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScopeBadge } from "@/features/orgs/components/workspace-page";
import {
  clearActiveProviderMutationOptions,
  setActiveProviderMutationOptions,
} from "@/features/provider-connections/mutations/provider-connection-mutations";
import {
  nativeProviderProfileQueryOptions,
  providerAssignmentImpactQueryOptions,
} from "@/features/provider-connections/queries/provider-connection-queries";
import {
  activeProviderScopes,
  providerConnectionLabel,
  purchaseProviderChoices,
} from "@/features/provider-connections/types/provider-connection-view";
import type {
  ActiveProviderAssignment,
  Application,
  Environment,
  Paywall,
  Product,
  ProviderConnection,
} from "@/generated/api";

export function ActiveProviderMatrix({
  applicationsHref,
  applications,
  assignments,
  canManage = true,
  connections,
  environment,
  managementEnabled = false,
  membersHref,
  organizationId,
  projectId,
}: {
  applicationsHref?: string;
  applications: readonly Application[];
  assignments: readonly ActiveProviderAssignment[];
  canManage?: boolean;
  connections: readonly ProviderConnection[];
  environment: Environment;
  managementEnabled?: boolean;
  membersHref?: string;
  organizationId?: string;
  projectId?: string;
}) {
  const scopes = activeProviderScopes(
    applications,
    environment,
    assignments,
    connections
  );

  if (scopes.length === 0) {
    return (
      <div className="rounded border border-border border-dashed p-5">
        <p className="font-semibold text-sm">Register an Application first</p>
        <p className="mt-1 text-muted-foreground text-sm leading-6">
          Active providers are selected for one Environment and one concrete iOS
          or Android Application. Mosaic never guesses a provider from Product
          identifiers.
        </p>
        {applicationsHref ? (
          <a
            className="mt-3 inline-flex font-semibold text-primary text-sm"
            href={applicationsHref}
          >
            Register Application
          </a>
        ) : null}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-2xl border-separate border-spacing-0 text-left text-sm">
        <caption className="sr-only">
          Active commerce provider assignments for {environment.name}
        </caption>
        <thead>
          <tr className="text-muted-foreground">
            <th className="border-b px-3 py-2 font-medium" scope="col">
              Application
            </th>
            <th className="border-b px-3 py-2 font-medium" scope="col">
              Platform
            </th>
            <th className="border-b px-3 py-2 font-medium" scope="col">
              Active provider
            </th>
            <th className="border-b px-3 py-2 font-medium" scope="col">
              Connection state
            </th>
            <th
              className="border-b px-3 py-2 text-right font-medium"
              scope="col"
            >
              Action
            </th>
          </tr>
        </thead>
        <tbody>
          {scopes.map(({ application, assignment: assignmentView }) => (
            <tr key={application.id}>
              <th className="border-b px-3 py-3 font-medium" scope="row">
                <span className="block">{application.name}</span>
                <span className="mt-0.5 block font-mono text-muted-foreground text-xs">
                  {application.identifier}
                </span>
              </th>
              <td className="border-b px-3 py-3">
                <ScopeBadge>{application.platform.toUpperCase()}</ScopeBadge>
              </td>
              <td className="border-b px-3 py-3">
                {assignmentView ? (
                  <AssignmentSummary assignmentView={assignmentView} />
                ) : (
                  <p className="flex items-center gap-1.5 font-medium">
                    <WarningCircleIcon
                      aria-hidden
                      className="text-destructive"
                      size={16}
                    />
                    Not selected
                  </p>
                )}
              </td>
              <td className="border-b px-3 py-3 text-muted-foreground text-xs">
                {(() => {
                  if (assignmentView?.connection) {
                    return `${assignmentView.connection.status} · ${assignmentView.connection.healthStatus}`;
                  }
                  if (
                    assignmentView?.assignment.activationKind === "native_store"
                  ) {
                    return "Built in · no server credentials";
                  }
                  if (assignmentView) {
                    return "Assignment references an unavailable connection";
                  }
                  return "No active assignment";
                })()}
              </td>
              <td className="border-b px-3 py-3 text-right">
                {managementEnabled ? (
                  <ProviderAssignmentControl
                    application={application}
                    canManage={canManage}
                    connections={connections}
                    currentAssignment={assignmentView?.assignment}
                    environment={environment}
                    membersHref={membersHref}
                    organizationId={organizationId ?? ""}
                    projectId={projectId ?? environment.projectId}
                  />
                ) : (
                  <Button disabled size="sm" type="button" variant="outline">
                    {assignmentView ? "Review replacement" : "Select provider"}
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {managementEnabled ? null : (
        <p className="mt-3 text-muted-foreground text-xs leading-5">
          Assignment changes remain disabled in this package. Persisted
          assignments are shown read-only; replacement will require an explicit
          impact review.
        </p>
      )}
    </div>
  );
}

function AssignmentSummary({
  assignmentView,
}: {
  assignmentView: ReturnType<typeof activeProviderScopes>[number]["assignment"];
}) {
  const assignment = assignmentView?.assignment;
  const isNative = assignment?.activationKind === "native_store";
  if (!(assignmentView && assignment)) {
    return null;
  }
  if (!isNative) {
    return (
      <div>
        <p className="font-medium">
          {assignmentView.connection?.name ??
            assignment.connectionId ??
            "Unavailable connection"}
        </p>
        <p className="mt-0.5 text-muted-foreground text-xs">
          {assignmentView.connection
            ? `${providerConnectionLabel(assignmentView.connection.provider)} · ${assignmentView.connection.integrationMode === "sdk_only" ? "SDK-only" : "Server-connected"} · ${assignmentView.connection.mode}`
            : "Connection metadata unavailable"}
        </p>
      </div>
    );
  }
  if (
    assignment.provider !== "app_store" &&
    assignment.provider !== "google_play"
  ) {
    return null;
  }
  return (
    <NativeAssignmentSummary
      platform={assignment.platform}
      provider={assignment.provider}
    />
  );
}

function NativeAssignmentSummary({
  platform,
  provider,
}: {
  platform: "android" | "ios";
  provider: "app_store" | "google_play";
}) {
  const profile = useQuery(
    nativeProviderProfileQueryOptions(provider, platform)
  );
  const label = provider === "app_store" ? "StoreKit" : "Google Play Billing";
  const warnings = profile.data?.capabilities.filter(
    (capability) => capability.support !== "supported"
  );
  return (
    <div>
      <p className="font-medium">{profile.data?.displayName ?? label}</p>
      <p className="mt-0.5 text-muted-foreground text-xs">
        Built in · no server credentials
        {profile.data ? ` · adapter ${profile.data.adapterVersion}` : ""}
      </p>
      {warnings?.length ? (
        <p className="mt-1 text-warning text-xs">
          {warnings.length} conditional or unsupported{" "}
          {warnings.length === 1 ? "capability" : "capabilities"}
        </p>
      ) : null}
    </div>
  );
}

function ProviderAssignmentControl({
  application,
  canManage,
  connections,
  currentAssignment,
  environment,
  membersHref,
  organizationId,
  projectId,
}: {
  application: Application;
  canManage: boolean;
  connections: readonly ProviderConnection[];
  currentAssignment?: ActiveProviderAssignment;
  environment: Environment;
  membersHref?: string;
  organizationId: string;
  projectId: string;
}) {
  const handleClick3 = useCallback(() => setReviewAction("clear"), []);
  const handleClick2 = useCallback(() => setReviewAction("set"), []);
  const handleClick = useCallback(() => setReviewAction(null), []);
  const queryClient = useQueryClient();
  const currentChoiceId = (() => {
    if (currentAssignment) {
      return (() => {
        if (currentAssignment.activationKind === "native_store") {
          return `native:${currentAssignment.provider}`;
        }
        return `connection:${currentAssignment.connectionId}`;
      })();
    }
    return "";
  })();
  const [selectedChoiceId, setSelectedChoiceId] = useState(currentChoiceId);
  const [reviewAction, setReviewAction] = useState<"clear" | "set" | null>(
    null
  );
  const setProvider = useMutation(
    setActiveProviderMutationOptions(
      application.id,
      environment.id,
      projectId,
      queryClient
    )
  );
  const clearProvider = useMutation(
    clearActiveProviderMutationOptions(
      application.id,
      environment.id,
      projectId,
      queryClient
    )
  );
  const choices = purchaseProviderChoices(
    application,
    environment,
    connections
  );
  const selected = choices.find((choice) => choice.id === selectedChoiceId);
  const choiceOptions = [
    { label: "Select provider", value: "" },
    ...choices.map((choice) => ({
      label: `${choice.label}${choice.kind === "native" ? " · Built in" : ""}`,
      value: choice.id,
    })),
  ];
  const availableConnectionCount = choices.filter(
    (choice) => choice.kind === "connection"
  ).length;
  const unavailableCount = connections.length - availableConnectionCount;
  const current = connections.find(
    (connection) => connection.id === currentAssignment?.connectionId
  );
  const impact = useQuery({
    ...providerAssignmentImpactQueryOptions({
      applicationId: application.id,
      assignmentKey:
        currentAssignment?.connectionId ??
        `native:${currentAssignment?.provider}`,
      connectionId: currentAssignment?.connectionId,
      environmentId: environment.id,
      provider: currentAssignment?.provider ?? "custom",
      projectId,
    }),
    enabled: Boolean(reviewAction && currentAssignment),
  });
  const mutation = reviewAction === "clear" ? clearProvider : setProvider;
  const impactRequired = Boolean(currentAssignment);
  const canConfirmImpact = !impactRequired || impact.isSuccess;
  const catalogHref = `/orgs/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/catalog/products`;
  const providersHref = `/orgs/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/catalog/providers`;

  if (reviewAction && (reviewAction === "clear" || selected)) {
    const isClearing = reviewAction === "clear";
    return (
      <ProviderAssignmentReview
        application={application}
        canConfirm={canConfirmImpact}
        canManage={canManage}
        catalogHref={catalogHref}
        currentAssignment={currentAssignment}
        currentConnection={current}
        environment={environment}
        impact={impact.data}
        impactFailed={impact.isError}
        impactPending={impact.isPending}
        impactRequired={impactRequired}
        isClearing={isClearing}
        membersHref={membersHref}
        mutationError={mutation.error}
        mutationPending={mutation.isPending}
        onCancel={handleClick}
        onConfirm={() => {
          if (isClearing) {
            clearProvider.mutate(undefined, {
              onSuccess: () => setReviewAction(null),
            });
            return;
          }
          if (!selected) {
            return;
          }
          setProvider.mutate(
            selected.kind === "native"
              ? {
                  activationKind: "native_store",
                  provider: selected.provider,
                }
              : {
                  acknowledgeProductionConnectionUse: false,
                  activationKind: "provider_connection",
                  connectionId: selected.connection.id,
                  provider: selected.provider,
                },
            { onSuccess: () => setReviewAction(null) }
          );
        }}
        onRetryImpact={() => {
          impact.refetch();
        }}
        selectedLabel={selected?.label}
      />
    );
  }

  return (
    <div className="ml-auto max-w-xs text-right">
      <div className="flex items-center justify-end gap-2">
        <Select
          items={choiceOptions}
          onValueChange={(value) => setSelectedChoiceId(value)}
          value={selectedChoiceId}
        >
          <SelectTrigger
            aria-label={`Provider for ${application.name}`}
            className="min-w-36 text-xs"
            size="sm"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {choiceOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          disabled={!selected || selected.id === currentChoiceId}
          onClick={handleClick2}
          size="sm"
          type="button"
          variant="outline"
        >
          Review impact
        </Button>
        {currentAssignment ? (
          <Button
            onClick={handleClick3}
            size="sm"
            type="button"
            variant="outline"
          >
            Clear provider
          </Button>
        ) : null}
      </div>
      {unavailableCount > 0 ? (
        <p className="mt-2 text-muted-foreground text-xs">
          {unavailableCount} connection(s) are hidden because their mode, scope,
          health, or status is incompatible.{" "}
          <a className="font-semibold text-primary" href={providersHref}>
            Review and recover connections
          </a>
        </p>
      ) : null}
    </div>
  );
}

/**
 * The impact review an assignment change is confirmed from.
 *
 * Confirmation stays disabled until the impact read succeeds, because replacing
 * a provider without knowing which Products and Paywalls it touches is the one
 * mistake this surface exists to prevent.
 */
function ProviderAssignmentReview({
  application,
  canConfirm,
  canManage,
  catalogHref,
  currentAssignment,
  currentConnection,
  environment,
  impact,
  impactFailed,
  impactPending,
  impactRequired,
  isClearing,
  membersHref,
  mutationError,
  mutationPending,
  onCancel,
  onConfirm,
  onRetryImpact,
  selectedLabel,
}: {
  application: Application;
  canConfirm: boolean;
  canManage: boolean;
  catalogHref: string;
  currentAssignment?: ActiveProviderAssignment;
  currentConnection?: ProviderConnection;
  environment: Environment;
  impact:
    | {
        paywalls: readonly Paywall[];
        products: readonly Product[];
        uncheckedPaywalls: readonly Paywall[];
      }
    | undefined;
  impactFailed: boolean;
  impactPending: boolean;
  impactRequired: boolean;
  isClearing: boolean;
  membersHref?: string;
  mutationError: Error | null;
  mutationPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  onRetryImpact: () => void;
  selectedLabel?: string;
}) {
  return (
    <div className="ml-auto max-w-xs rounded border p-3 text-left">
      <p className="font-semibold text-xs">
        {(() => {
          if (isClearing) {
            return `Clear ${providerChoiceLabel(currentAssignment, currentConnection)}`;
          }
          if (currentAssignment) {
            return `Replace ${providerChoiceLabel(currentAssignment, currentConnection)}`;
          }
          return "Select active provider";
        })()}
      </p>
      <p className="mt-1 text-muted-foreground text-xs leading-5">
        {isClearing
          ? `Clearing this assignment leaves ${application.name} without a commerce provider in ${environment.name}. New publishing will fail readiness and SDK configuration cannot resolve connected Product metadata until another healthy provider is selected.`
          : `${currentAssignment ? `${providerChoiceLabel(currentAssignment, currentConnection)} → ${selectedLabel}. ` : ""}This changes provider resolution for ${application.name} in ${environment.name}. Published history remains immutable; new publishing readiness and SDK configuration use this explicit assignment.`}
      </p>
      {impactRequired && impactPending ? (
        <p className="mt-2 text-muted-foreground text-xs" role="status">
          Calculating affected Products and active Paywalls…
        </p>
      ) : null}
      {impactRequired && impactFailed ? (
        <div className="mt-2 rounded border border-destructive/40 p-2">
          <p className="text-destructive text-xs" role="alert">
            Impact could not be loaded. Confirmation remains disabled.
          </p>
          <Button
            className="mt-2"
            onClick={onRetryImpact}
            size="sm"
            type="button"
            variant="outline"
          >
            Retry impact
          </Button>
        </div>
      ) : null}
      {impact ? (
        <ProviderAssignmentImpactSummary
          catalogHref={catalogHref}
          impact={impact}
        />
      ) : null}
      {mutationError ? (
        <p className="mt-2 text-destructive text-xs" role="alert">
          {mutationError.message}
        </p>
      ) : null}
      {canManage ? null : (
        <div className="mt-3 rounded border border-border bg-background p-3 text-xs">
          <p className="font-medium">Owner or Admin approval required</p>
          <p className="mt-1 text-muted-foreground">
            Members can review this impact but cannot change Purchase setup.
          </p>
          {membersHref ? (
            <a
              className="mt-2 inline-flex font-semibold text-primary"
              href={membersHref}
            >
              Ask an Owner or Admin
            </a>
          ) : null}
        </div>
      )}
      <div className="mt-3 flex gap-2">
        {canManage ? (
          <Button
            disabled={mutationPending || !canConfirm}
            onClick={onConfirm}
            size="sm"
            type="button"
          >
            {(() => {
              if (mutationPending) {
                return "Saving…";
              }
              if (isClearing) {
                return "Confirm clear";
              }
              return "Confirm selection";
            })()}
          </Button>
        ) : null}
        <Button
          disabled={mutationPending}
          onClick={onCancel}
          size="sm"
          type="button"
          variant="outline"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * The Products and Paywalls a change would touch, including the Paywalls Mosaic
 * could not inspect.
 */
function ProviderAssignmentImpactSummary({
  catalogHref,
  impact,
}: {
  catalogHref: string;
  impact: {
    paywalls: readonly Paywall[];
    products: readonly Product[];
    uncheckedPaywalls: readonly Paywall[];
  };
}) {
  return (
    <div className="mt-2 rounded bg-muted/50 p-2 text-xs leading-5">
      <p className="font-medium">
        {impact.products.length} affected Product
        {impact.products.length === 1 ? "" : "s"} · {impact.paywalls.length}{" "}
        active Paywall
        {impact.paywalls.length === 1 ? "" : "s"}
      </p>
      {impact.products.length > 0 ? (
        <p className="text-muted-foreground">
          Products:{" "}
          {impact.products.map((product) => product.internalName).join(", ")}
        </p>
      ) : null}
      {impact.paywalls.length > 0 ? (
        <p className="text-muted-foreground">
          Paywalls: {impact.paywalls.map((paywall) => paywall.name).join(", ")}
        </p>
      ) : null}
      {impact.uncheckedPaywalls.length > 0 ? (
        // Stated, not omitted: these are the Paywalls whose content
        // Mosaic could not inspect, so the count above is a floor.
        <p className="mt-1 text-destructive">
          {impact.uncheckedPaywalls.length} Paywall
          {impact.uncheckedPaywalls.length === 1 ? "" : "s"} could not be
          checked — no active Draft exists in this Environment, so Mosaic cannot
          tell whether their published content cites these Products. Treat the
          count above as a minimum.
        </p>
      ) : null}
      <a
        className="font-medium text-primary hover:underline"
        href={catalogHref}
      >
        Review affected Products
      </a>
    </div>
  );
}

function providerChoiceLabel(
  assignment?: ActiveProviderAssignment,
  connection?: ProviderConnection
) {
  if (connection) {
    return connection.name;
  }
  if (assignment?.provider === "app_store") {
    return "StoreKit";
  }
  if (assignment?.provider === "google_play") {
    return "Google Play Billing";
  }
  return "active provider";
}
