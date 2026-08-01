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
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { HostedAccessBanner } from "@/features/auth/components/hosted-access-banner";
import { sessionQueryOptions } from "@/features/auth/queries/session-query";
import { safeInternalReturnTo } from "@/features/auth/types/hosted-access";
import { CloudWorkspaceShell } from "@/features/orgs/components/cloud-workspace-shell";
import { ApiError } from "@/lib/api/errors";

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
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  );
}
