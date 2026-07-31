import { createFileRoute } from "@tanstack/react-router"

import { CreateOrganizationPage } from "@/features/organizations/components/create-organization-page"

export const Route = createFileRoute("/_hosted/organizations/new")({
  component: CreateOrganizationPage,
})
