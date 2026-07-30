import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router"

import { routeHead } from "@/lib/routing/route-head"

const PaywallEditorWorkspace = lazyRouteComponent(
  () => import("@/features/paywall-editor/components/paywall-editor-workspace"),
  "PaywallEditorWorkspace",
)

export const Route = createFileRoute("/_studio_layout/studio/")({
  component: PaywallEditorWorkspace,
  head: () => routeHead({ title: "Paywall editor" }),
})
