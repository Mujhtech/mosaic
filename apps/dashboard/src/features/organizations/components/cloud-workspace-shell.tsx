import { BuildingsIcon } from "@phosphor-icons/react/dist/ssr/Buildings"
import { CodeIcon } from "@phosphor-icons/react/dist/ssr/Code"
import { GearSixIcon } from "@phosphor-icons/react/dist/ssr/GearSix"
import { KeyIcon } from "@phosphor-icons/react/dist/ssr/Key"
import { PackageIcon } from "@phosphor-icons/react/dist/ssr/Package"
import { StorefrontIcon } from "@phosphor-icons/react/dist/ssr/Storefront"
import { SquaresFourIcon } from "@phosphor-icons/react/dist/ssr/SquaresFour"
import { UsersThreeIcon } from "@phosphor-icons/react/dist/ssr/UsersThree"
import { Link, useNavigate, useRouterState } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ReactNode } from "react"

import { HostedAccessBanner } from "@/features/auth/components/hosted-access-banner"
import { Button } from "@/components/ui/button"
import { logoutMutationOptions } from "@/features/auth/mutations/auth-mutations"
import { sessionQueryOptions } from "@/features/auth/queries/session-query"
import {
  isEnvironmentSurface,
  isProjectWideSurface,
  readWorkspaceScope,
} from "@/features/organizations/types/workspace-navigation"
import { environmentsQueryOptions } from "@/features/environments/queries/environments-query"
import { organizationQueryOptions } from "@/features/organizations/queries/organizations-query"
import { projectQueryOptions } from "@/features/projects/queries/projects-query"
import { ApiError } from "@/lib/api/errors"

import { NotePencilIcon } from "@phosphor-icons/react/dist/ssr/NotePencil"

import type { ComponentProps } from "react"

import { NavMain, type NavigationItem } from "@/components/navigation/nav-main"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import { OrganizationSwitcher } from "./organization-switcher"

interface WorkspaceNavLinkProps {
  children: ReactNode
  icon: ReactNode
  params?: Record<string, string>
  to: string
}

export function CloudWorkspaceShell() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const scope = readWorkspaceScope(pathname)
  const showProjectNavigation = Boolean(scope.organizationId && scope.projectId)
  const session = useQuery(sessionQueryOptions())
  const signOut = useMutation({
    ...logoutMutationOptions(queryClient),
    onSuccess: async () => {
      queryClient.clear()
      await navigate({ to: "/login" })
    },
  })
  // Scope metadata is independent and begins in parallel; shared page reads are query-deduplicated.
  const organization = useQuery({
    ...organizationQueryOptions(scope.organizationId ?? "unselected"),
    enabled: Boolean(scope.organizationId),
  })
  const project = useQuery({
    ...projectQueryOptions(scope.projectId ?? "unselected"),
    enabled: Boolean(scope.projectId),
  })
  const environments = useQuery({
    ...environmentsQueryOptions(scope.projectId ?? "unselected"),
    enabled: Boolean(scope.projectId),
  })
  const environmentItems = environments.data?.items ?? []
  const selectedEnvironment = environmentItems.find((item) => item.id === scope.environmentId)
  const defaultEnvironment =
    selectedEnvironment ??
    environmentItems.find((item) => item.key === "staging") ??
    environmentItems.find((item) => item.key === "development") ??
    environmentItems[0]

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <OrganizationSwitcher />
      </SidebarHeader>
      <SidebarContent>
        {scope.projectId && (
          <NavMain
            label="Workspace"
            items={[
              {
                to: `/organizations/${scope.organizationId}/projects/${scope.projectId}`,
                icon: <SquaresFourIcon aria-hidden size={18} />,
                title: "Overview",
              },
              {
                to: `/organizations/${scope.organizationId}/projects/${scope.projectId}/monetization/${scope.environmentId}/paywalls`,
                icon: <StorefrontIcon aria-hidden size={18} />,
                title: "Monetization",
              },
              {
                to: `/organizations/${scope.organizationId}/projects/${scope.projectId}/apps`,
                icon: <CodeIcon aria-hidden size={18} />,
                title: "Apps",
              },
              {
                icon: <PackageIcon aria-hidden size={18} />,
                title: "Catalog",
                subItems: [
                  {
                    to: `/organizations/${scope.organizationId}/projects/${scope.projectId}/catalog/plans`,
                    title: "Plans",
                    icon: <></>,
                  },
                  {
                    to: `/organizations/${scope.organizationId}/projects/${scope.projectId}/catalog/products`,
                    title: "Products",
                    icon: <></>,
                  },
                  {
                    to: `/organizations/${scope.organizationId}/projects/${scope.projectId}/catalog/entitlements`,
                    title: "Entitlements",
                    icon: <></>,
                  },
                ],
              },
              {
                to: `/organizations/${scope.organizationId}/projects/${scope.projectId}/settings/environments`,
                icon: <GearSixIcon aria-hidden size={18} />,
                title: "Settings",
              },
              {
                to: `/organizations/${scope.organizationId}/projects/${scope.projectId}/settings/api-keys`,
                icon: <KeyIcon aria-hidden size={18} />,
                title: "API keys",
              },
            ]}
          />
        )}
        {scope.organizationId && (
          <NavMain
            label="Organization"
            items={[
              {
                to: `/organizations/${scope.organizationId}/members`,
                icon: <UsersThreeIcon aria-hidden size={18} />,
                title: "Members",
              },
            ]}
          />
        )}
      </SidebarContent>
      <SidebarFooter></SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
