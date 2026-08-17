import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

import { routeHead } from "@/lib/routing/route-head";

interface HostedStudioSearch {
  review?: "publish";
}

const HostedPaywallEditorRoute = lazyRouteComponent(
  () => import("@/features/paywalls/components/hosted-paywall-editor-route"),
  "HostedPaywallEditorRoute"
);

export const Route = createFileRoute(
  "/_studio_layout/studio/$organizationId/$projectId/$environmentId/$paywallId/$draftId"
)({
  validateSearch: (search: Record<string, unknown>): HostedStudioSearch => ({
    review: search.review === "publish" ? "publish" : undefined,
  }),
  component: RouteComponent,
  head: () => routeHead({ title: "Paywall editor" }),
});

function RouteComponent() {
  const { draftId, environmentId, organizationId, paywallId, projectId } =
    Route.useParams();
  const { review } = Route.useSearch();

  return (
    <HostedPaywallEditorRoute
      source={{
        draftId,
        environmentId,
        kind: "hosted",
        initialReview: review,
        organizationId,
        paywallId,
        projectId,
      }}
    />
  );
}
