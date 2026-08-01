import { createFileRoute, Outlet } from "@tanstack/react-router";

import {
  RouteErrorState,
  RoutePendingState,
} from "@/components/feedback/route-feedback";

export const Route = createFileRoute("/_studio_layout")({
  component: RouteComponent,
  errorComponent: RouteErrorState,
  pendingComponent: RoutePendingState,
});

function RouteComponent() {
  return (
    <>
      <a
        className="fixed top-2 left-2 z-50 -translate-y-20 rounded border bg-background px-3 py-2 font-medium text-foreground text-sm focus:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        href="#studio-main"
      >
        Skip to Studio workspace
      </a>
      <main
        className="h-svh min-h-0 overflow-hidden bg-background"
        id="studio-main"
        tabIndex={-1}
      >
        <Outlet />
      </main>
    </>
  );
}
