import { createFileRoute } from "@tanstack/react-router"

import { CreateOrganizationPage } from "@/features/orgs/components/create-organization-page"
import { routeHead } from "@/lib/routing/route-head"

export const Route = createFileRoute("/_hosted/orgs/new")({
  component: CreateOrganizationPage,
  head: () => routeHead({ title: "New organization" }),
})
