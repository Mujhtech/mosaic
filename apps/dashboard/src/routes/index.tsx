import { createFileRoute } from "@tanstack/react-router"

import { FoundationOverview } from "@/features/foundation/components/foundation-overview"

export const Route = createFileRoute("/")({
  component: FoundationRoute,
})

function FoundationRoute() {
  return <FoundationOverview />
}
