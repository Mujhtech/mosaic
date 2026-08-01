import { ChartLineUpIcon } from "@phosphor-icons/react/dist/ssr/ChartLineUp";
import { CodeIcon } from "@phosphor-icons/react/dist/ssr/Code";
import { GearSixIcon } from "@phosphor-icons/react/dist/ssr/GearSix";
import { KeyIcon } from "@phosphor-icons/react/dist/ssr/Key";
import { PackageIcon } from "@phosphor-icons/react/dist/ssr/Package";
import { ReceiptIcon } from "@phosphor-icons/react/dist/ssr/Receipt";
import { SquaresFourIcon } from "@phosphor-icons/react/dist/ssr/SquaresFour";
import { StorefrontIcon } from "@phosphor-icons/react/dist/ssr/Storefront";
import { UsersThreeIcon } from "@phosphor-icons/react/dist/ssr/UsersThree";
import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import type { NavigationItem } from "@/components/navigation/nav-main";
import { NavMain } from "@/components/navigation/nav-main";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar";
import { dashboardBuildInfo } from "@/config/environment";
import { UserMenu } from "@/features/auth/components/user-menu";
import { EnvironmentSwitcher } from "@/features/environments/components/environment-switcher";
import { useActiveEnvironment } from "@/features/environments/hooks/use-active-environment";
import { readWorkspaceScope } from "@/features/orgs/types/workspace-navigation";
import { billingSettingsQueryOptions } from "@/features/store-connections/queries/billing-settings-queries";
import { useOrganizationAccess } from "@/hooks/use-organization-access";
import { OrganizationSwitcher } from "./organization-switcher";

export function CloudWorkspaceShell() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const scope = readWorkspaceScope(pathname);
  const access = useOrganizationAccess(scope.organizationId ?? "");
  // The address names the Environment by alias; the id stays internal.
  const { activeId, alias } = useActiveEnvironment();
  const projectBase = `/orgs/${scope.organizationId}/projects/${scope.projectId}/env/${alias}`;

  // Administrative surfaces are hidden until membership confirms management
  // rights. The API remains the authority; this only prevents dead-end links.
  const { canManage } = access;

  // Mosaic Billing is per-Project opt-in. While it is off, its Environment
  // surfaces have nothing to show, so the group collapses to the one page that
  // can turn it on. Hiding the group outright would make billing unreachable.
  // const environments = useQuery({
  //   ...environmentsQueryOptions(scope.projectId ?? ""),
  //   enabled: canManage && Boolean(scope.projectId),
  // })
  const probeEnvironmentId = activeId ?? "";
  const billingSettings = useQuery({
    ...billingSettingsQueryOptions(scope.projectId ?? "", probeEnvironmentId),
    enabled:
      canManage && Boolean(scope.projectId) && probeEnvironmentId.length > 0,
  });
  // Unknown state shows the full group: a nav that hides itself because a probe
  // failed is worse than one item too many.
  const billingEnabled = billingSettings.data?.billingEnabled !== false;

  function withManagement(items: NavigationItem[]) {
    return canManage ? items : [];
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <OrganizationSwitcher organizationId={scope.organizationId} />
        <EnvironmentSwitcher />
      </SidebarHeader>
      <SidebarContent className="scrollbar-thin scrollbar-gutter-stable">
        {scope.projectId ? (
          <NavMain
            items={[
              {
                to: `${projectBase}`,
                icon: <SquaresFourIcon aria-hidden size={18} />,
                title: "Overview",
              },
              {
                icon: <StorefrontIcon aria-hidden size={18} />,
                title: "Monetization",
                subItems: [
                  {
                    to: `${projectBase}/monetization/paywalls`,
                    title: "Paywalls",
                    icon: <></>,
                  },
                  {
                    to: `${projectBase}/monetization/experiments`,
                    title: "Experiments",
                    icon: <></>,
                  },
                  {
                    to: `${projectBase}/monetization/placements`,
                    title: "Placements",
                    icon: <></>,
                  },
                  {
                    to: `${projectBase}/monetization/assets`,
                    title: "Assets",
                    icon: <></>,
                  },
                  {
                    to: `${projectBase}/monetization/releases`,
                    title: "Publish history",
                    icon: <></>,
                  },
                ],
              },
              {
                to: `${projectBase}/analytics/overview`,
                icon: <ChartLineUpIcon aria-hidden size={18} />,
                title: "Analytics",
              },
              {
                to: `${projectBase}/apps`,
                icon: <CodeIcon aria-hidden size={18} />,
                title: "Apps",
              },
              {
                icon: <PackageIcon aria-hidden size={18} />,
                title: "Catalog",
                subItems: [
                  {
                    to: `${projectBase}/catalog/plans`,
                    title: "Plans",
                    icon: <></>,
                  },
                  {
                    to: `${projectBase}/catalog/products`,
                    title: "Products",
                    icon: <></>,
                  },
                  {
                    to: `${projectBase}/catalog/entitlements`,
                    title: "Entitlements",
                    icon: <></>,
                  },
                  // What a Product grants is versioned and immutable, so it is
                  // its own surface rather than a set of buttons on Product
                  // detail. It sits in Catalog because grant versions relate two
                  // Project-scoped things, Products and Entitlements.
                  {
                    to: `${projectBase}/catalog/grant-versions`,
                    title: "Grant versions",
                    icon: <></>,
                  },
                  {
                    to: `${projectBase}/catalog/providers`,
                    title: "Purchase setup",
                    icon: <></>,
                  },
                ],
              },
              // Mosaic Billing is per-Project opt-in and owner/admin only. The
              // group is hidden from members who could not act on it, so it is
              // never a dead end; Environment-scoped items fall back to the
              // Project overview exactly as Monetization and Analytics do.
              // "Store Server Credentials" is the frozen term, and every
              // recovery link in billing uses it, so the nav does too.
              ...(access.membership
                ? [
                    {
                      icon: <ReceiptIcon aria-hidden size={18} />,
                      title: "Billing",
                      subItems: [
                        {
                          to: `${projectBase}/billing/migrations`,
                          title: "Migration Programs",
                          icon: <></>,
                        },
                        ...(billingEnabled && canManage
                          ? [
                              // Customers leads the group. It answers the question
                              // operators actually arrive with — "does this person
                              // have access?" — which the ledger deliberately
                              // cannot.
                              {
                                to: `${projectBase}/billing/customers`,
                                title: "Customers",
                                icon: <></>,
                              },
                              {
                                to: `${projectBase}/billing/identity-conflicts`,
                                title: "Identity conflicts",
                                icon: <></>,
                              },
                              {
                                to: `${projectBase}/billing/restores`,
                                title: "Restores",
                                icon: <></>,
                              },
                              {
                                to: `${projectBase}/billing/transactions`,
                                title: "Transactions",
                                icon: <></>,
                              },
                              {
                                to: `${projectBase}/billing/quarantine`,
                                title: "Quarantine",
                                icon: <></>,
                              },
                              {
                                to: `${projectBase}/billing/reconciliation`,
                                title: "Reconciliation",
                                icon: <></>,
                              },
                              {
                                to: `${projectBase}/billing/health`,
                                title: "Billing health",
                                icon: <></>,
                              },
                              // A sibling of billing health, never a tab inside it:
                              // store input can be arriving perfectly while every
                              // customer is being told the wrong thing.
                              {
                                to: `${projectBase}/billing/projection-health`,
                                title: "Projection health",
                                icon: <></>,
                              },
                            ]
                          : []),
                        ...(canManage
                          ? [
                              {
                                to: `${projectBase}/billing/connections`,
                                title: billingEnabled
                                  ? "Store Server Credentials"
                                  : "Set up Mosaic Billing",
                                icon: <></>,
                              },
                            ]
                          : []),
                      ],
                    },
                  ]
                : []),
              ...withManagement([
                {
                  to: `${projectBase}/settings/environments`,
                  icon: <GearSixIcon aria-hidden size={18} />,
                  title: "Settings",
                },
                {
                  to: `${projectBase}/settings/api-keys`,
                  icon: <KeyIcon aria-hidden size={18} />,
                  title: "API keys",
                },
              ]),
            ]}
            label="Workspace"
          />
        ) : null}
        {scope.organizationId && canManage ? (
          <NavMain
            items={[
              {
                to: `/orgs/${scope.organizationId}/members`,
                icon: <UsersThreeIcon aria-hidden size={18} />,
                title: "Members",
              },
            ]}
            label="Organization"
          />
        ) : null}
      </SidebarContent>
      <SidebarFooter>
        <UserMenu />
        <Link
          className="px-2 pb-1 text-[11px] text-muted-foreground hover:text-foreground group-data-[collapsible=icon]:hidden"
          to="/diagnostics"
        >
          Mosaic {dashboardBuildInfo.version} · diagnostics
        </Link>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
