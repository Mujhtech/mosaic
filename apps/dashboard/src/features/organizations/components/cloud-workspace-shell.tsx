import { CodeIcon } from "@phosphor-icons/react/dist/ssr/Code"
import { ChartLineUpIcon } from "@phosphor-icons/react/dist/ssr/ChartLineUp"
import { GearSixIcon } from "@phosphor-icons/react/dist/ssr/GearSix"
import { KeyIcon } from "@phosphor-icons/react/dist/ssr/Key"
import { PackageIcon } from "@phosphor-icons/react/dist/ssr/Package"
import { ReceiptIcon } from "@phosphor-icons/react/dist/ssr/Receipt"
import { StorefrontIcon } from "@phosphor-icons/react/dist/ssr/Storefront"
import { SquaresFourIcon } from "@phosphor-icons/react/dist/ssr/SquaresFour"
import { UsersThreeIcon } from "@phosphor-icons/react/dist/ssr/UsersThree"
import { Link, useRouterState } from "@tanstack/react-router"

import { NavMain } from "@/components/navigation/nav-main"
import { dashboardBuildInfo } from "@/config/environment"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar"
import { readWorkspaceScope } from "@/features/organizations/types/workspace-navigation"
import { UserMenu } from "@/features/auth/components/user-menu"
import { useOrganizationAccess } from "@/hooks/use-organization-access"
import type { NavigationItem } from "@/components/navigation/nav-main"
import { OrganizationSwitcher } from "./organization-switcher"

export function CloudWorkspaceShell() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const scope = readWorkspaceScope(pathname)
  const access = useOrganizationAccess(scope.organizationId ?? "")

  // Administrative surfaces are hidden until membership confirms management
  // rights. The API remains the authority; this only prevents dead-end links.
  const canManage = access.canManage

  function withManagement(items: NavigationItem[]) {
    return canManage ? items : []
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <OrganizationSwitcher organizationId={scope.organizationId} />
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
                to: scope.environmentId
                  ? `/organizations/${scope.organizationId}/projects/${scope.projectId}/monetization/${scope.environmentId}/paywalls`
                  : `/organizations/${scope.organizationId}/projects/${scope.projectId}`,
                icon: <StorefrontIcon aria-hidden size={18} />,
                title: "Monetization",
              },
              {
                to: scope.environmentId
                  ? `/organizations/${scope.organizationId}/projects/${scope.projectId}/analytics/${scope.environmentId}/overview`
                  : `/organizations/${scope.organizationId}/projects/${scope.projectId}`,
                icon: <ChartLineUpIcon aria-hidden size={18} />,
                title: "Analytics",
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
                    title: "Access",
                    icon: <></>,
                  },
                  {
                    to: `/organizations/${scope.organizationId}/projects/${scope.projectId}/catalog/providers`,
                    title: "Purchase setup",
                    icon: <></>,
                  },
                ],
              },
              // Mosaic Billing is per-Project opt-in and owner/admin only. The
              // group is hidden from members who could not act on it, so it is
              // never a dead end; Environment-scoped items fall back to the
              // Project overview exactly as Monetization and Analytics do.
              ...withManagement([
                {
                  icon: <ReceiptIcon aria-hidden size={18} />,
                  title: "Billing",
                  subItems: [
                    {
                      to: scope.environmentId
                        ? `/organizations/${scope.organizationId}/projects/${scope.projectId}/billing/${scope.environmentId}/transactions`
                        : `/organizations/${scope.organizationId}/projects/${scope.projectId}`,
                      title: "Transactions",
                      icon: <></>,
                    },
                    {
                      to: scope.environmentId
                        ? `/organizations/${scope.organizationId}/projects/${scope.projectId}/billing/${scope.environmentId}/quarantine`
                        : `/organizations/${scope.organizationId}/projects/${scope.projectId}`,
                      title: "Quarantine",
                      icon: <></>,
                    },
                    {
                      to: scope.environmentId
                        ? `/organizations/${scope.organizationId}/projects/${scope.projectId}/billing/${scope.environmentId}/reconciliation`
                        : `/organizations/${scope.organizationId}/projects/${scope.projectId}`,
                      title: "Reconciliation",
                      icon: <></>,
                    },
                    {
                      to: scope.environmentId
                        ? `/organizations/${scope.organizationId}/projects/${scope.projectId}/billing/${scope.environmentId}/health`
                        : `/organizations/${scope.organizationId}/projects/${scope.projectId}`,
                      title: "Billing health",
                      icon: <></>,
                    },
                    {
                      to: `/organizations/${scope.organizationId}/projects/${scope.projectId}/billing/connections`,
                      title: "Store connections",
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
              ]),
            ]}
          />
        )}
        {scope.organizationId && canManage && (
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
      <SidebarFooter>
        <UserMenu />
        <Link
          className="text-muted-foreground hover:text-foreground px-2 pb-1 text-[11px] group-data-[collapsible=icon]:hidden"
          to="/diagnostics"
        >
          Mosaic {dashboardBuildInfo.version} · diagnostics
        </Link>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
