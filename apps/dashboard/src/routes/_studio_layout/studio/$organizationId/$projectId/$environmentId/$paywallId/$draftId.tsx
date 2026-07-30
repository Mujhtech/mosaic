import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router"

interface HostedStudioSearch {
  review?: "publish"
}

const HostedPaywallEditorRoute = lazyRouteComponent(
  () => import("@/features/paywalls/components/hosted-paywall-editor-route"),
  "HostedPaywallEditorRoute",
)

export const Route = createFileRoute(
  "/_studio_layout/studio/$organizationId/$projectId/$environmentId/$paywallId/$draftId",
)({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>): HostedStudioSearch => ({
    review: search.review === "publish" ? "publish" : undefined,
  }),
})

function RouteComponent() {
  const { draftId, environmentId, organizationId, paywallId, projectId } = Route.useParams()
  const { review } = Route.useSearch()

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
  )
}
