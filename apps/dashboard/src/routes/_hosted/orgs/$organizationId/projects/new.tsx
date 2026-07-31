import { createFileRoute } from "@tanstack/react-router"

import { CreateProjectPage } from "@/features/projects/components/create-project-page"
import { routeHead } from "@/lib/routing/route-head"

export const Route = createFileRoute("/_hosted/orgs/$organizationId/projects/new")({
  component: NewProjectRoute,
  head: () => routeHead({ title: "New project" }),
})

function NewProjectRoute() {
  const { organizationId } = Route.useParams()

  return <CreateProjectPage organizationId={organizationId} />
}
