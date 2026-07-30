import { createFileRoute } from "@tanstack/react-router"

import { CreateProjectPage } from "@/features/projects/components/create-project-page"

export const Route = createFileRoute("/_hosted/orgs/$organizationId/projects/new")({
  component: NewProjectRoute,
})

function NewProjectRoute() {
  const { organizationId } = Route.useParams()

  return <CreateProjectPage organizationId={organizationId} />
}
