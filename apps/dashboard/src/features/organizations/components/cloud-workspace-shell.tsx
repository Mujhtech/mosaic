import { CodeIcon } from "@phosphor-icons/react/dist/ssr/Code"
import { GearSixIcon } from "@phosphor-icons/react/dist/ssr/GearSix"
import { KeyIcon } from "@phosphor-icons/react/dist/ssr/Key"
import { PackageIcon } from "@phosphor-icons/react/dist/ssr/Package"
import { StorefrontIcon } from "@phosphor-icons/react/dist/ssr/Storefront"
import { SquaresFourIcon } from "@phosphor-icons/react/dist/ssr/SquaresFour"
import { UsersThreeIcon } from "@phosphor-icons/react/dist/ssr/UsersThree"
import { useRouterState } from "@tanstack/react-router"

import { NavMain } from "@/components/navigation/nav-main"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar"
import { readWorkspaceScope } from "@/features/organizations/types/workspace-navigation"
import { OrganizationSwitcher } from "./organization-switcher"

export function CloudWorkspaceShell() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const scope = readWorkspaceScope(pathname)

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
                  {
                    to: `/organizations/${scope.organizationId}/projects/${scope.projectId}/catalog/providers`,
                    title: "Commerce providers",
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
