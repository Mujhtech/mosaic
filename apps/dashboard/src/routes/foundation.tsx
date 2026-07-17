import { createFileRoute } from "@tanstack/react-router"

import { AppShell } from "@/components/layout/app-shell"
import { FoundationOverview } from "@/features/foundation/components/foundation-overview"

export const Route = createFileRoute("/foundation")({
  component: FoundationRoute,
})

function FoundationRoute() {
  return (
    <AppShell title="Engineering status" subtitle="Local dashboard foundation checks">
      <FoundationOverview />
    </AppShell>
  )
}
