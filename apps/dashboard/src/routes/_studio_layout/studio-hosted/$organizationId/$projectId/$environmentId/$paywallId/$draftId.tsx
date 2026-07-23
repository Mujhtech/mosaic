import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router"

const HostedPaywallEditorRoute = lazyRouteComponent(
  () => import("@/features/paywalls/components/hosted-paywall-editor-route"),
  "HostedPaywallEditorRoute",
)

export const Route = createFileRoute(
  "/_studio_layout/studio-hosted/$organizationId/$projectId/$environmentId/$paywallId/$draftId",
)({
  component: RouteComponent,
})

function RouteComponent() {
  const { draftId, environmentId, organizationId, paywallId, projectId } = Route.useParams()

  return (
    <HostedPaywallEditorRoute
      source={{
        draftId,
        environmentId,
        kind: "hosted",
        organizationId,
        paywallId,
        projectId,
      }}
    />
  )
}
