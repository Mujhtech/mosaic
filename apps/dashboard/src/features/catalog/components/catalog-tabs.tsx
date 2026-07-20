import { Link, useRouterState } from "@tanstack/react-router"

interface CatalogTabsProps {
  organizationId: string
  projectId: string
}

const tabs = [
  {
    label: "Plans",
    segment: "/plans",
    to: "/organizations/$organizationId/projects/$projectId/catalog/plans",
  },
  {
    label: "Products",
    segment: "/products",
    to: "/organizations/$organizationId/projects/$projectId/catalog/products",
  },
  {
    label: "Entitlements",
    segment: "/entitlements",
    to: "/organizations/$organizationId/projects/$projectId/catalog/entitlements",
  },
] as const

export function CatalogTabs({ organizationId, projectId }: CatalogTabsProps) {
  const pathname = useRouterState({ select: (state) => state.location.pathname })

  return (
    <nav aria-label="Catalog" className="border-b">
      <div className="flex gap-6">
        {tabs.map((tab) => (
          <Link
            aria-current={pathname.includes(tab.segment) ? "page" : undefined}
            className="text-muted-foreground hover:text-foreground aria-[current=page]:border-primary aria-[current=page]:text-foreground border-b-2 border-transparent px-1 py-3 text-sm font-medium"
            key={tab.label}
            params={{ organizationId, projectId }}
            to={tab.to}
          >
            {tab.label}
          </Link>
        ))}
      </div>
    </nav>
  )
}
