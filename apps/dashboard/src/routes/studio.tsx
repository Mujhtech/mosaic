import { createFileRoute } from "@tanstack/react-router"

import { AppShell } from "@/components/layout/app-shell"
import { PaywallEditorWorkspace } from "@/features/paywall-editor/components/paywall-editor-workspace"

export const Route = createFileRoute("/studio")({
  component: StudioRoute,
})

function StudioRoute() {
  return (
    <AppShell title="Local paywall editor" subtitle="Edit, validate, preview, and export locally">
      <PaywallEditorWorkspace />
    </AppShell>
  )
}
