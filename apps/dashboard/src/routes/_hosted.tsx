import { useQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  Outlet,
  redirect,
  useRouterState,
} from "@tanstack/react-router";

import {
  RouteErrorState,
  RoutePendingState,
} from "@/components/feedback/route-feedback";
import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { HostedAccessBanner } from "@/features/auth/components/hosted-access-banner";
import { sessionQueryOptions } from "@/features/auth/queries/session-query";
import { safeInternalReturnTo } from "@/features/auth/types/hosted-access";
import { CloudWorkspaceShell } from "@/features/orgs/components/cloud-workspace-shell";
import { ApiError, describeApiError } from "@/lib/api/errors";

export const Route = createFileRoute("/_hosted")({
  beforeLoad: async ({ context, location }) => {
    // The Mosaic session lives in an HttpOnly cookie that the SSR pass cannot
    // read (see docs/dashboard/operations.md, "SSR cookie caveat"), so the
    // guard is a client-side concern only. Server rendering stays anonymous.
    if (import.meta.env.SSR) {
      return;
    }

    try {
      await context.queryClient.ensureQueryData(sessionQueryOptions());
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        const returnTo = safeInternalReturnTo(location.href, "");
        throw redirect({
          search: returnTo ? { returnTo } : {},
          to: "/login",
        });
      }
      // Any other failure (offline, 5xx) must not lock the operator out of the
      // shell: the per-resource boundaries render the degraded state instead.
    }
  },
  component: HostedLayout,
  errorComponent: RouteErrorState,
  pendingComponent: RoutePendingState,
});

function HostedLayout() {
  const session = useQuery(sessionQueryOptions());
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const sessionExpired =
    session.error instanceof ApiError && session.error.status === 401;
  // The route guard deliberately lets a non-401 session failure through rather
  // than locking an operator out of the shell during an outage. That degrade is
  // right, but it was silent: the shell rendered exactly as it does for a
  // verified session, so nothing distinguished "you are signed in" from "Mosaic
  // could not check". Deliberate degrade, stated.
  const sessionUnverified = Boolean(session.error) && !sessionExpired;

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 55)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <a
        className="fixed top-2 left-2 z-50 -translate-y-20 rounded border bg-background px-3 py-2 font-medium text-foreground text-sm focus:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        href="#main-content"
      >
        Skip to main content
      </a>
      <CloudWorkspaceShell />
      <SidebarInset id="main-content" tabIndex={-1}>
        {sessionExpired ? (
          <div className="px-5 pt-5 sm:px-8">
            <HostedAccessBanner
              compact
              returnTo={safeInternalReturnTo(pathname, "")}
            />
          </div>
        ) : null}
        {sessionUnverified ? (
          <div className="px-5 pt-5 sm:px-8">
            <section
              aria-live="polite"
              className="rounded border border-border bg-muted/40 p-4"
              role="status"
            >
              <h2 className="font-semibold text-sm">
                Your session could not be verified
              </h2>
              <p className="mt-1 text-muted-foreground text-sm leading-6">
                {describeApiError(session.error).description} Mosaic kept the
                workspace open rather than signing you out, so what you see may
                be from before the failure and some actions may be refused.
                Reload once the connection recovers.
              </p>
              <Button
                className="mt-3"
                disabled={session.isFetching}
                onClick={() => {
                  session.refetch();
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                {session.isFetching ? "Checking…" : "Check again"}
              </Button>
            </section>
          </div>
        ) : null}
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  );
}
