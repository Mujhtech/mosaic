import { createFileRoute } from "@tanstack/react-router";

import { RoutePendingState } from "@/components/feedback/route-feedback";
import { DiagnosticsPage } from "@/features/diagnostics/components/diagnostics-page";
import { routeHead } from "@/lib/routing/route-head";

/**
 * Deliberately outside `_hosted`: this page holds no tenant data and is most
 * useful when authentication itself is the problem being diagnosed.
 */
export const Route = createFileRoute("/diagnostics")({
  component: DiagnosticsPage,
  head: () =>
    routeHead({
      description: "Inspect dashboard build, session, and API connectivity.",
      title: "Diagnostics",
    }),
  pendingComponent: RoutePendingState,
});
