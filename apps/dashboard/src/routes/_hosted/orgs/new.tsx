import { createFileRoute } from "@tanstack/react-router"

import { CreateOrganizationPage } from "@/features/orgs/components/create-organization-page"

export const Route = createFileRoute("/_hosted/orgs/new")({
  component: CreateOrganizationPage,
})
