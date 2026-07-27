import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"
import { DiagnosticsPanel } from "@/features/diagnostics/components/diagnostics-panel"
import { WorkspacePage } from "@/features/organizations/components/workspace-page"

export const Route = createFileRoute("/_hosted/diagnostics")({
  component: DiagnosticsRoute,
  pendingComponent: RoutePendingState,
})

function DiagnosticsRoute() {
  return (
    <WorkspacePage
      description="Build identity, runtime configuration, and connectivity for this browser session."
      title="Diagnostics"
    >
      <DiagnosticsPanel />
    </WorkspacePage>
  )
}
