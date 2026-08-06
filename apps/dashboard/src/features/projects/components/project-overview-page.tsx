import { AppWindowIcon } from "@phosphor-icons/react/dist/ssr/AppWindow";
import { ArchiveIcon } from "@phosphor-icons/react/dist/ssr/Archive";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/ssr/ArrowCounterClockwise";
import { ArrowUpRightIcon } from "@phosphor-icons/react/dist/ssr/ArrowUpRight";
import { PackageIcon } from "@phosphor-icons/react/dist/ssr/Package";
import { StackIcon } from "@phosphor-icons/react/dist/ssr/Stack";
import { StorefrontIcon } from "@phosphor-icons/react/dist/ssr/Storefront";
import { SwapIcon } from "@phosphor-icons/react/dist/ssr/Swap";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ComponentType, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ApiErrorDetails,
  HostedResourceBoundary,
  RequestIdCopy,
} from "@/features/auth/components/hosted-resource-boundary";
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state";
import { environmentsQueryOptions } from "@/features/environments/queries/environments-query";
import { ScopeMismatchRecovery } from "@/features/orgs/components/scope-mismatch-recovery";
import {
  ScopeBadge,
  WorkflowPanel,
  WorkspacePage,
} from "@/features/orgs/components/workspace-page";
import { detectNestedScopeMismatch } from "@/features/orgs/types/nested-scope";
import { projectLifecycleMutationOptions } from "@/features/projects/mutations/project-mutations";
import {
  applicationsQueryOptions,
  projectQueryOptions,
} from "@/features/projects/queries/projects-query";
import { describeApiError } from "@/lib/api/errors";
import { workspaceScopeParams } from "@/lib/routing/workspace-params";

import { ProjectOverviewMetricsSection } from "./project-overview-metrics";

interface ProjectOverviewPageProps {
  organizationId: string;
  projectId: string;
}

const OVERVIEW_ROUTES = {
  apps: "/orgs/$organizationId/projects/$projectId/env/$environmentKey/apps",
  catalog:
    "/orgs/$organizationId/projects/$projectId/env/$environmentKey/catalog/plans",
  environments:
    "/orgs/$organizationId/projects/$projectId/env/$environmentKey/settings/environments",
  migrations:
    "/orgs/$organizationId/projects/$projectId/env/$environmentKey/billing/migrations",
  monetization:
    "/orgs/$organizationId/projects/$projectId/env/$environmentKey/monetization/paywalls",
} as const;

/**
 * A destination, not a metric. These sit below the numbers now, so they carry
 * only the name and the badge that qualifies it — the sentence of explanation
 * each used to hold made the row taller than the metrics it now supports.
 */
function OverviewCard({
  icon: Icon,
  index,
  meta,
  title,
  to,
}: {
  icon: ComponentType<{ "aria-hidden"?: boolean; className?: string }>;
  index: number;
  meta?: ReactNode;
  title: string;
  to: (typeof OVERVIEW_ROUTES)[keyof typeof OVERVIEW_ROUTES];
}) {
  return (
    <Link
      className="group fade-in slide-in-from-bottom-2 flex animate-in flex-col rounded-lg border fill-mode-backwards p-3.5 transition-[border-color,background-color,transform] duration-300 ease-out hover:border-ring/40 hover:bg-muted/35 active:scale-[0.99] motion-reduce:transform-none motion-reduce:animate-none"
      params={(prev) => ({ ...prev, ...workspaceScopeParams(prev) })}
      style={{ animationDelay: `${index * 45}ms` }}
      to={to}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
          <Icon aria-hidden className="size-4" />
        </span>
        <ArrowUpRightIcon
          aria-hidden
          className="size-4 text-muted-foreground opacity-0 transition-[opacity,transform] duration-200 ease-out group-hover:translate-x-0 group-hover:opacity-100 motion-reduce:translate-x-0 motion-reduce:transition-none md:-translate-x-1"
        />
      </div>
      <span className="mt-2.5 font-semibold text-sm">{title}</span>
      {meta ? (
        <span className="mt-auto flex min-h-6 flex-wrap items-center gap-1.5 pt-2">
          {meta}
        </span>
      ) : null}
    </Link>
  );
}

function applicationsMeta(applications: {
  isPending: boolean;
  data?: { items: readonly { platform: "ios" | "android" }[] };
}): ReactNode {
  if (applications.isPending) {
    return <Skeleton className="h-5 w-24" />;
  }
  const items = applications.data?.items;
  if (!items) {
    return <ScopeBadge>Count unavailable</ScopeBadge>;
  }
  if (items.length === 0) {
    return <ScopeBadge>No apps registered yet</ScopeBadge>;
  }
  const ios = items.filter((app) => app.platform === "ios").length;
  const android = items.length - ios;
  return (
    <>
      {ios > 0 ? <ScopeBadge>{ios} iOS</ScopeBadge> : null}
      {android > 0 ? <ScopeBadge>{android} Android</ScopeBadge> : null}
    </>
  );
}

/**
 * The Environment names on the Environments card.
 *
 * A failed read says so, exactly as the Applications card does. Rendering no
 * badges would be indistinguishable from a Project with no Environments, which
 * is a state Mosaic does not allow and would therefore be read as "fine".
 */
function environmentsMeta(environments: {
  isPending: boolean;
  data?: { items: readonly { id: string; name: string }[] };
}): ReactNode {
  if (environments.isPending) {
    return <Skeleton className="h-5 w-32" />;
  }
  const items = environments.data?.items;
  if (!items) {
    return <ScopeBadge>Names unavailable</ScopeBadge>;
  }
  if (items.length === 0) {
    return <ScopeBadge>None reported</ScopeBadge>;
  }
  return items
    .slice(0, 3)
    .map((environment) => (
      <ScopeBadge key={environment.id}>{environment.name}</ScopeBadge>
    ));
}

/**
 * The Environment the Monetization card will open into.
 *
 * A failed Environments read must not delete the card. Hiding it would remove a
 * navigation target and read as "this Project has no Monetization", which is a
 * stronger claim than "Mosaic could not name the Environment". The destination
 * resolves from the address, so it stays reachable either way; only the label
 * is withheld.
 */
function monetizationMeta(
  environments: {
    isPending: boolean;
    data?: { items: readonly { name: string }[] };
  },
  environment?: { name: string }
): ReactNode {
  if (environments.isPending) {
    return <Skeleton className="h-5 w-24" />;
  }
  if (environment) {
    return <ScopeBadge>{environment.name}</ScopeBadge>;
  }
  if (!environments.data?.items) {
    return <ScopeBadge>Environment unavailable</ScopeBadge>;
  }
  return <ScopeBadge>None reported</ScopeBadge>;
}

export function ProjectOverviewPage({
  organizationId,
  projectId,
}: ProjectOverviewPageProps) {
  const queryClient = useQueryClient();
  const project = useQuery(projectQueryOptions(projectId));
  const scopeMismatch = detectNestedScopeMismatch({
    expectedOrganizationId: organizationId,
    expectedProjectId: projectId,
    project: project.data,
  });
  const applications = useQuery({
    ...applicationsQueryOptions(projectId),
    enabled: project.isSuccess && scopeMismatch === null,
  });
  const environments = useQuery({
    ...environmentsQueryOptions(projectId),
    enabled: project.isSuccess && scopeMismatch === null,
  });
  const archive = useMutation(
    projectLifecycleMutationOptions(queryClient, "archive")
  );
  const restore = useMutation(
    projectLifecycleMutationOptions(queryClient, "restore")
  );
  // Archive and restore previously rendered the raw server message, which can
  // carry database internals. Mosaic-owned copy plus the correlation ID is the
  // documented support path.
  const lifecycleError = archive.error ?? restore.error;
  const lifecycleFailure = lifecycleError
    ? describeApiError(lifecycleError, { organizationId, projectId })
    : null;
  const state = resolveHostedQueryState({
    emptyDescription: "Project data is unavailable.",
    emptyTitle: "Project not found",
    error: project.error,
    isEmpty: project.isSuccess && !project.data,
    isPending: project.isPending,
    loadingDescription: "Loading project workspace.",
    onRetry: () => {
      project.refetch();
    },
    permissionAction: (
      <Link
        className={buttonVariants({ variant: "outline" })}
        params={{ organizationId }}
        to="/orgs/$organizationId"
      >
        Return to Organization
      </Link>
    ),
    permissionDescription:
      "Organization membership is required to read this project.",
  });
  const isArchived = project.data?.status === "archived";
  const environmentItems = environments.data?.items;
  const monetizationEnvironment =
    environmentItems?.find((environment) => environment.key === "staging") ??
    environmentItems?.find(
      (environment) => environment.key === "development"
    ) ??
    environmentItems?.[0];

  if (scopeMismatch) {
    return (
      <WorkspacePage
        description="The routed Organization and loaded Project do not share the same parent scope."
        title="Project unavailable in this Organization"
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
      actions={
        isArchived ? (
          <Button
            disabled={restore.isPending}
            onClick={() => restore.mutate(projectId)}
            variant="outline"
          >
            <ArrowCounterClockwiseIcon aria-hidden size={16} />
            Restore project
          </Button>
        ) : (
          <Button
            disabled={archive.isPending}
            onClick={() => archive.mutate(projectId)}
            variant="outline"
          >
            <ArchiveIcon aria-hidden size={16} />
            Archive project
          </Button>
        )
      }
      description="Today's numbers are measured for one Environment. Applications and Catalog below are project-wide."
      eyebrow={isArchived ? "Archived project" : "Project workspace"}
      title={project.data?.name ?? "Project"}
    >
      <HostedResourceBoundary state={state}>
        <ProjectOverviewMetricsSection
          organizationId={organizationId}
          projectId={projectId}
        />
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
          <OverviewCard
            icon={AppWindowIcon}
            index={0}
            meta={applicationsMeta(applications)}
            title="Applications"
            to={OVERVIEW_ROUTES.apps}
          />
          <OverviewCard
            icon={StorefrontIcon}
            index={1}
            meta={monetizationMeta(environments, monetizationEnvironment)}
            title="Monetization"
            to={OVERVIEW_ROUTES.monetization}
          />

          <OverviewCard
            icon={PackageIcon}
            index={2}
            title="Catalog"
            to={OVERVIEW_ROUTES.catalog}
          />
          <OverviewCard
            icon={SwapIcon}
            index={3}
            title="Migration Programs"
            to={OVERVIEW_ROUTES.migrations}
          />
          <OverviewCard
            icon={StackIcon}
            index={4}
            meta={environmentsMeta(environments)}
            title="Environments"
            to={OVERVIEW_ROUTES.environments}
          />
        </div>
        {lifecycleFailure ? (
          <div
            className="space-y-2 rounded-lg border border-destructive/25 bg-destructive/5 p-4"
            role="alert"
          >
            <p className="text-destructive text-sm">
              {lifecycleFailure.description}
            </p>
            <ApiErrorDetails details={lifecycleFailure.details} />
            {lifecycleFailure.correlationId ? (
              <RequestIdCopy requestId={lifecycleFailure.correlationId} />
            ) : null}
          </div>
        ) : null}
        <WorkflowPanel title="Hosted publishing">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-2xl text-muted-foreground text-sm leading-6">
              Choose a named Environment in Monetization to create hosted
              Drafts, bind Placements, review publish readiness, and restore
              immutable Releases.
            </p>
            {/* The address, not the Environments read, resolves this route, so
                an unreadable Environment list withholds a name — never the way
                out of this page. */}
            <Link
              className={buttonVariants({ variant: "outline" })}
              params={(prev) => ({ ...prev, ...workspaceScopeParams(prev) })}
              to={OVERVIEW_ROUTES.monetization}
            >
              Open Monetization
              <ArrowUpRightIcon aria-hidden className="size-4" />
            </Link>
          </div>
        </WorkflowPanel>
      </HostedResourceBoundary>
    </WorkspacePage>
  );
}
