import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useId, useState } from "react";

import { ErrorState } from "@/components/feedback/error-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { WorkflowPanel } from "@/features/orgs/components/workspace-page";
import { ApiError } from "@/lib/api/errors";
import { ANALYTICS_COLLECTION_ANCHOR } from "@/lib/routing/workspace-hrefs";
import type { AnalyticsAdapter } from "../api/analytics-adapter";
import {
  analyticsKeys,
  settingsQueryOptions,
} from "../queries/analytics-queries";
import type {
  AnalyticsRole,
  AnalyticsScope,
  CollectionSettings,
} from "../types/analytics";

/**
 * What turning collection off actually costs, stated before it is turned off and
 * repeated while it stays off. The distinction that matters to an operator is
 * that this stops new events without discarding anything already recorded.
 */
const DISABLE_CONSEQUENCE =
  "Paywall metrics and the overview stop receiving events; recorded data is retained.";

const DISABLED_STATE_DESCRIPTION =
  "Paywall metrics and the overview are not receiving events; recorded data is retained.";

const updatedAtFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

function formatUpdatedAt(value: string | undefined) {
  if (!value) {
    return;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return;
  }
  return `${updatedAtFormat.format(parsed)} UTC`;
}

interface AnalyticsCollectionPanelProps {
  adapter: AnalyticsAdapter;
  /** Named so the panel states which Environment the setting applies to. */
  environmentName?: string;
  role?: AnalyticsRole;
  /** True when membership could not be read, so the role is not established. */
  roleUnknown?: boolean;
  scope: AnalyticsScope;
}

/**
 * Analytics collection for one Environment, on the page the rest of Mosaic sends
 * operators to when a metric reports that collection is off.
 *
 * Retention is read-only here on purpose: it is edited on the Analytics Data and
 * Privacy surface, which owns the retention rules and their audit copy. This
 * panel answers the narrower question that a broken metric raises — is this
 * Environment recording events at all, and since when.
 */
export function AnalyticsCollectionPanel({
  adapter,
  environmentName,
  role,
  roleUnknown,
  scope,
}: AnalyticsCollectionPanelProps) {
  const settings = useQuery(settingsQueryOptions(scope, adapter));
  const handleRetry = useCallback(() => {
    settings.refetch();
  }, [settings]);

  return (
    <div className="scroll-mt-6" id={ANALYTICS_COLLECTION_ANCHOR}>
      <WorkflowPanel
        description={`Collection is on by default${environmentName ? ` for ${environmentName}` : ""}. Mosaic records paywall presentation and purchase funnel events, and no end-user personal data beyond the documented event schema.`}
        title="Analytics"
      >
        <CollectionBody
          adapter={adapter}
          data={settings.data}
          error={settings.error}
          isPending={settings.isPending}
          onRetry={handleRetry}
          role={role}
          roleUnknown={roleUnknown}
          scope={scope}
        />
      </WorkflowPanel>
    </div>
  );
}

function CollectionBody({
  adapter,
  data,
  error,
  isPending,
  onRetry,
  role,
  roleUnknown,
  scope,
}: {
  adapter: AnalyticsAdapter;
  data?: CollectionSettings;
  error: Error | null;
  isPending: boolean;
  onRetry: () => void;
  role?: AnalyticsRole;
  roleUnknown?: boolean;
  scope: AnalyticsScope;
}) {
  if (isPending) {
    return (
      <div aria-busy="true" aria-live="polite" className="space-y-3">
        <Skeleton
          aria-label="Loading analytics collection settings"
          className="h-5 w-48"
        />
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-4 w-40" />
      </div>
    );
  }

  if (error) {
    const forbidden = error instanceof ApiError && error.status === 403;
    return (
      <ErrorState
        description={
          forbidden
            ? "Project membership with access to this Environment is required to read analytics collection settings."
            : "Mosaic could not read whether this Environment is collecting analytics. Nothing was changed."
        }
        onRetry={onRetry}
        retryLabel="Retry loading settings"
        title={
          forbidden
            ? "Analytics permission required"
            : "Analytics settings unavailable"
        }
      />
    );
  }

  // No settings and no error means the query has not resolved to anything Mosaic
  // can describe. Rendering a default here would state a collection state the
  // API never reported.
  if (!data) {
    return null;
  }

  return (
    <CollectionControls
      adapter={adapter}
      role={role}
      roleUnknown={roleUnknown}
      scope={scope}
      settings={data}
    />
  );
}

function CollectionControls({
  adapter,
  role,
  roleUnknown,
  scope,
  settings,
}: {
  adapter: AnalyticsAdapter;
  role?: AnalyticsRole;
  roleUnknown?: boolean;
  scope: AnalyticsScope;
  settings: CollectionSettings;
}) {
  const fieldId = useId();
  const queryClient = useQueryClient();
  const [confirmingDisable, setConfirmingDisable] = useState(false);
  const canManage = role === "owner" || role === "admin";

  const mutation = useMutation({
    mutationFn: (enabled: boolean) =>
      adapter.updateCollectionSettings(scope, {
        enabled,
        rawRetentionDays: settings.rawRetentionDays,
      }),
    // Invalidate rather than write optimistically: the API owns `updatedAt`,
    // and a toggle that reported a time Mosaic invented would be a claim about
    // when collection actually changed.
    onSuccess: (next) => {
      queryClient.setQueryData(
        [...analyticsKeys.settings(scope), adapter],
        next
      );
      queryClient.invalidateQueries({
        queryKey: analyticsKeys.settings(scope),
      });
      setConfirmingDisable(false);
    },
  });

  const handleCheckedChange = useCallback(
    (checked: boolean) => {
      if (checked) {
        setConfirmingDisable(false);
        mutation.mutate(true);
        return;
      }
      setConfirmingDisable(true);
    },
    [mutation]
  );

  const handleCancel = useCallback(() => setConfirmingDisable(false), []);
  const handleConfirmDisable = useCallback(
    () => mutation.mutate(false),
    [mutation]
  );

  const updatedAt = formatUpdatedAt(settings.updatedAt);
  const stateDescription = settings.enabled
    ? "This Environment is recording events."
    : DISABLED_STATE_DESCRIPTION;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <Switch
          aria-describedby={`${fieldId}-state`}
          checked={settings.enabled}
          disabled={!canManage || mutation.isPending}
          id={`${fieldId}-collection`}
          onCheckedChange={handleCheckedChange}
        />
        <div className="min-w-0 space-y-1">
          <label
            className="block font-medium text-sm"
            htmlFor={`${fieldId}-collection`}
          >
            Collect analytics events
          </label>
          <p
            className="text-muted-foreground text-sm leading-6"
            id={`${fieldId}-state`}
          >
            {stateDescription}
          </p>
        </div>
      </div>

      {confirmingDisable ? (
        <div
          aria-live="polite"
          className="space-y-3 rounded border border-destructive/25 bg-destructive/5 p-4"
        >
          <p className="text-sm leading-6">{DISABLE_CONSEQUENCE}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={mutation.isPending}
              onClick={handleConfirmDisable}
              type="button"
              variant="destructive"
            >
              {mutation.isPending ? "Turning off…" : "Turn collection off"}
            </Button>
            <Button
              disabled={mutation.isPending}
              onClick={handleCancel}
              type="button"
              variant="outline"
            >
              Keep collecting
            </Button>
          </div>
        </div>
      ) : null}

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Raw event retention</dt>
          <dd className="font-medium">
            {settings.rawRetentionDays} days · edited in Analytics · Data and
            Privacy
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Last updated</dt>
          <dd className="font-medium">
            {updatedAt ?? "Not reported by the API"}
          </dd>
        </div>
      </dl>

      {canManage ? null : (
        // Fail-closed either way, but only one of these is a statement about
        // this actor's permission. An unread membership cannot support that
        // statement, so it says what actually happened instead.
        <p className="text-muted-foreground text-sm">
          {roleUnknown
            ? "Mosaic could not read your Organization role, so this control stays disabled. Reload to try again."
            : "Owner or admin permission is required to change analytics collection."}
        </p>
      )}

      {mutation.isSuccess ? (
        <p className="text-primary text-sm" role="status">
          Analytics collection updated.
        </p>
      ) : null}
      {mutation.error ? (
        <p className="text-destructive text-sm" role="alert">
          Mosaic could not change analytics collection. Nothing was changed.
        </p>
      ) : null}
    </div>
  );
}
