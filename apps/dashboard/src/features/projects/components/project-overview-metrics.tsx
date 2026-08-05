import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FreshnessBanner } from "@/features/analytics/components/analytics-states";
import { deriveFreshness } from "@/features/analytics/types/analytics-freshness";
import {
  ApiErrorDetails,
  RequestIdCopy,
} from "@/features/auth/components/hosted-resource-boundary";
import { environmentAlias } from "@/features/environments/types/environment-alias";
import { useOverviewEnvironment } from "@/features/projects/hooks/use-overview-environment";
import { overviewMetricsQueryOptions } from "@/features/projects/queries/overview-metrics-query";
import type { OverviewRecoveryTarget } from "@/features/projects/types/overview-metrics";
import { describeOverviewWindow } from "@/features/projects/types/overview-metrics";
import { CLIENT_OBSERVED_CAPTION } from "@/features/projects/types/overview-series";
import type { Environment, ProjectOverviewMetrics } from "@/generated/api";
import { describeApiError } from "@/lib/api/errors";
import { ANALYTICS_COLLECTION_ANCHOR } from "@/lib/routing/workspace-hrefs";
import { workspaceScopeParams } from "@/lib/routing/workspace-params";

import { OverviewMetricTile } from "./overview-metric-tile";
import { OverviewTrendChart } from "./overview-trend-chart";

const RECOVERY_ROUTES = {
  "billing-setup":
    "/orgs/$organizationId/projects/$projectId/env/$environmentKey/billing/connections",
  "environment-settings":
    "/orgs/$organizationId/projects/$projectId/env/$environmentKey/settings/environments",
} as const;

interface ProjectOverviewMetricsSectionProps {
  organizationId: string;
  projectId: string;
}

/**
 * Today at a glance for one Environment.
 *
 * It loads independently of the navigation below it: a slow or failing metrics
 * read must never keep an operator from reaching Applications or Catalog, which
 * is the page's other job and does not depend on any of these numbers.
 */
export function ProjectOverviewMetricsSection({
  organizationId,
  projectId,
}: ProjectOverviewMetricsSectionProps) {
  const environment = useOverviewEnvironment(projectId);
  const environmentId = environment.selected?.id;
  const metrics = useQuery({
    ...overviewMetricsQueryOptions(projectId, environmentId ?? ""),
    enabled: Boolean(environmentId),
  });

  const { data } = metrics;
  const isPending = metrics.isPending || !environmentId;
  const failure = metrics.error
    ? describeApiError(metrics.error, {
        environmentId,
        // The recovery link addresses the Environment the way a route does.
        ...(environment.selected
          ? { environmentKey: environmentAlias(environment.selected) }
          : {}),
        organizationId,
        projectId,
      })
    : null;
  const freshness = data?.analyticsFreshness
    ? deriveFreshness(data.analyticsFreshness)
    : null;
  const windowLabel = data ? describeOverviewWindow(data.windows.today) : null;

  // The Environment-settings recovery names the control it is sending the
  // operator to, not just the page. Landing on a settings page and hunting for
  // the analytics toggle is the dead end this link exists to remove.
  const renderRecovery = (target: OverviewRecoveryTarget, label: string) => (
    <Link
      className="self-start text-primary text-xs underline underline-offset-2 hover:no-underline"
      {...(target === "environment-settings"
        ? { hash: ANALYTICS_COLLECTION_ANCHOR }
        : {})}
      params={(prev) => ({ ...prev, ...workspaceScopeParams(prev) })}
      to={RECOVERY_ROUTES[target]}
    >
      {label}
    </Link>
  );

  const retry = () => {
    metrics.refetch();
  };

  return (
    <section aria-labelledby="overview-metrics-title" className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
        <div className="min-w-0">
          <h2 className="font-semibold text-sm" id="overview-metrics-title">
            Today · UTC
          </h2>
          <p className="mt-0.5 text-muted-foreground text-xs">
            {windowLabel ??
              "The UTC calendar day so far, measured by the Mosaic API."}
          </p>
        </div>
        <EnvironmentScopeChips
          isPending={environment.query.isPending}
          items={environment.items}
          onSelect={environment.select}
          selectedId={environmentId}
        />
      </div>

      {freshness && freshness.aggregateState !== "current" ? (
        <FreshnessBanner freshness={freshness} />
      ) : null}

      {failure ? (
        <div
          className="space-y-2 rounded-lg border border-destructive/25 bg-destructive/5 p-4"
          role="alert"
        >
          <p className="text-destructive text-sm">{failure.description}</p>
          <ApiErrorDetails details={failure.details} />
          <Button onClick={retry} size="sm" variant="outline">
            Retry loading metrics
          </Button>
          {failure.correlationId ? (
            <RequestIdCopy requestId={failure.correlationId} />
          ) : null}
        </div>
      ) : (
        <>
          <TodayTiles
            isPending={isPending}
            metrics={data?.metrics}
            onRetry={retry}
            renderRecovery={renderRecovery}
          />
          <OverviewTrendChart
            environmentId={environmentId}
            organizationId={organizationId}
            projectId={projectId}
            renderRecovery={renderRecovery}
          />
          <StandingTiles
            isPending={isPending}
            metrics={data?.metrics}
            onRetry={retry}
            renderRecovery={renderRecovery}
          />
        </>
      )}
    </section>
  );
}

interface TileGroupProps {
  isPending: boolean;
  metrics?: ProjectOverviewMetrics["metrics"];
  onRetry: () => void;
  renderRecovery: (target: OverviewRecoveryTarget, label: string) => ReactNode;
}

function TodayTiles({
  isPending,
  metrics,
  onRetry,
  renderRecovery,
}: TileGroupProps) {
  const shared = { isPending, onRetry, renderRecovery };

  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <OverviewMetricTile
        {...shared}
        comparison={metrics?.customers.newYesterday}
        label="New customers"
        metric={metrics?.customers.newToday}
      />
      <OverviewMetricTile
        {...shared}
        comparison={metrics?.subscriptions.newYesterday}
        label="New subscriptions"
        metric={metrics?.subscriptions.newToday}
      />
      <OverviewMetricTile
        {...shared}
        comparison={metrics?.trials.startedYesterday}
        label="Trials started"
        metric={metrics?.trials.startedToday}
      />
      <OverviewMetricTile
        {...shared}
        comparison={metrics?.paywallViews.yesterday}
        label="Paywall views"
        metric={metrics?.paywallViews.today}
      />
      <OverviewMetricTile
        {...shared}
        comparison={metrics?.purchaseStarts.yesterday}
        label="Purchase starts"
        metric={metrics?.purchaseStarts.today}
      />
      <OverviewMetricTile
        {...shared}
        caption={CLIENT_OBSERVED_CAPTION}
        comparison={metrics?.purchases.yesterday}
        label="Purchases"
        metric={metrics?.purchases.today}
      />
      <OverviewMetricTile
        {...shared}
        caption={CLIENT_OBSERVED_CAPTION}
        comparison={metrics?.conversionRate.yesterday}
        kind="rate"
        label="Conversion rate"
        metric={metrics?.conversionRate.today}
      />
    </dl>
  );
}

/**
 * Standing totals, which describe the Environment right now rather than today.
 * They carry no delta because the API reports no yesterday counterpart for
 * them, and inventing one from a window they were not measured over would be a
 * different number wearing the same label.
 */
function StandingTiles({
  isPending,
  metrics,
  onRetry,
  renderRecovery,
}: TileGroupProps) {
  const shared = { isPending, onRetry, renderRecovery };

  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <OverviewMetricTile
        {...shared}
        label="Total customers"
        metric={metrics?.customers.total}
      />
      <OverviewMetricTile
        {...shared}
        label="Active subscriptions"
        metric={metrics?.subscriptions.active}
      />
      <OverviewMetricTile
        {...shared}
        label="Active trials"
        metric={metrics?.trials.active}
      />
      <OverviewMetricTile
        {...shared}
        label="Billing retry"
        metric={metrics?.billingRetry.active}
      />
      <OverviewMetricTile
        {...shared}
        label="Grace period"
        metric={metrics?.gracePeriod.active}
      />
    </dl>
  );
}

/**
 * The Environment these numbers describe.
 *
 * The overview is otherwise a Project-level page, so the scope of the metrics
 * has to be visible and changeable next to them rather than inferred from the
 * sidebar. Selecting moves the address too, keeping a shared link honest.
 */
function EnvironmentScopeChips({
  isPending,
  items,
  onSelect,
  selectedId,
}: {
  isPending: boolean;
  items: readonly Environment[];
  onSelect: (environmentId: string) => void;
  selectedId?: string;
}) {
  if (isPending) {
    return <Skeleton aria-label="Loading environments" className="h-7 w-40" />;
  }
  if (items.length === 0) {
    return null;
  }

  return (
    <fieldset className="flex flex-wrap items-center gap-1.5">
      <legend className="sr-only">Environment for these metrics</legend>
      {items.map((environment) => {
        const selected = environment.id === selectedId;
        return (
          <button
            aria-pressed={selected}
            className={`rounded-full border px-2.5 py-1 font-medium text-xs transition-colors ${
              selected
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border bg-muted/40 text-muted-foreground hover:bg-muted"
            }`}
            key={environment.id}
            onClick={() => onSelect(environment.id)}
            type="button"
          >
            {environment.name}
          </button>
        );
      })}
    </fieldset>
  );
}
