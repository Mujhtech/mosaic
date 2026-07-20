import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"

import { Button } from "@/components/ui/button"
import { buttonVariants } from "@/components/ui/button-variants"
import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary"
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state"
import { CatalogTabs } from "@/features/catalog/components/catalog-tabs"
import {
  addPlanProductMutationOptions,
  removePlanProductMutationOptions,
} from "@/features/catalog/mutations/catalog-mutations"
import {
  planProductsQueryOptions,
  planQueryOptions,
  productsQueryOptions,
} from "@/features/catalog/queries/catalog-query"
import { WorkspacePage, WorkflowPanel } from "@/features/organizations/components/workspace-page"
import { ScopeMismatchRecovery } from "@/features/organizations/components/scope-mismatch-recovery"
import { detectNestedScopeMismatch } from "@/features/organizations/types/nested-scope"
import { projectQueryOptions } from "@/features/projects/queries/projects-query"

interface PlanDetailPageProps {
  organizationId: string
  planId: string
  projectId: string
}

export function PlanDetailPage({ organizationId, planId, projectId }: PlanDetailPageProps) {
  const queryClient = useQueryClient()
  const project = useQuery(projectQueryOptions(projectId))
  const plan = useQuery(planQueryOptions(planId))
  const scopeMismatch = detectNestedScopeMismatch({
    expectedOrganizationId: organizationId,
    expectedProjectId: projectId,
    expectedResourceId: planId,
    project: project.data,
    resource: plan.data,
  })
  const scopeReady = project.isSuccess && plan.isSuccess && scopeMismatch === null
  const memberships = useQuery({ ...planProductsQueryOptions(planId), enabled: scopeReady })
  const products = useQuery({ ...productsQueryOptions(projectId), enabled: scopeReady })
  const addProduct = useMutation(addPlanProductMutationOptions(planId, projectId, queryClient))
  const removeProduct = useMutation(
    removePlanProductMutationOptions(planId, projectId, queryClient),
  )
  const items = memberships.data?.items ?? []
  const state = resolveHostedQueryState({
    emptyDescription: "Add a Product to offer it through this Plan.",
    emptyTitle: "No Products in this Plan",
    error: project.error ?? plan.error ?? memberships.error,
    isEmpty: scopeReady && memberships.isSuccess && items.length === 0,
    isPending: project.isPending || plan.isPending || (scopeReady && memberships.isPending),
    loadingDescription: "Loading Plan membership.",
    onRetry: () => {
      void plan.refetch()
      void memberships.refetch()
    },
    permissionAction: (
      <Link
        className={buttonVariants({ variant: "outline" })}
        params={{ organizationId, projectId }}
        to="/organizations/$organizationId/projects/$projectId"
      >
        Return to Project
      </Link>
    ),
    permissionDescription: "Project membership is required to view this Plan.",
  })
  const canManageMembership = state.kind === "empty" || state.kind === "ready"

  if (scopeMismatch) {
    return (
      <WorkspacePage
        description="The routed parent identifiers do not match this Plan."
        title="Plan unavailable in this Project"
      >
        <ScopeMismatchRecovery
          mismatch={scopeMismatch}
          organizationId={organizationId}
          projectId={projectId}
        />
      </WorkspacePage>
    )
  }

  return (
    <WorkspacePage
      description={
        plan.data?.description ?? "Group purchasable Products under one customer-facing Plan."
      }
      eyebrow="Catalog · Plan"
      title={plan.data?.name ?? "Plan"}
    >
      <CatalogTabs organizationId={organizationId} projectId={projectId} />
      <HostedResourceBoundary state={state}>
        <WorkflowPanel title="Products in this Plan">
          <ul className="divide-y">
            {items.map((product) => (
              <li className="flex items-center justify-between gap-4 py-4" key={product.id}>
                <span>
                  <span className="block text-sm font-semibold">{product.internalName}</span>
                  <span className="text-muted-foreground mt-1 block font-mono text-xs">
                    {product.key}
                  </span>
                </span>
                <Link
                  className="text-primary text-sm font-medium hover:underline"
                  params={{ organizationId, productId: product.id, projectId }}
                  to="/organizations/$organizationId/projects/$projectId/catalog/products/$productId"
                >
                  View Product
                </Link>
                <Button
                  disabled={removeProduct.isPending}
                  onClick={() => removeProduct.mutate(product.id)}
                  size="sm"
                  variant="ghost"
                >
                  Remove from Plan
                </Button>
              </li>
            ))}
          </ul>
        </WorkflowPanel>
      </HostedResourceBoundary>
      {canManageMembership ? (
        <WorkflowPanel
          description="Only active project Products can be added. Membership does not copy or change the Product."
          title="Add Product"
        >
          <div className="flex flex-wrap gap-2">
            {products.data?.items
              .filter((product) => product.status !== "archived")
              .filter((product) => !items.some((item) => item.id === product.id))
              .map((product) => (
                <Button
                  key={product.id}
                  onClick={() => addProduct.mutate(product.id)}
                  size="sm"
                  variant="outline"
                >
                  Add {product.internalName}
                </Button>
              ))}
          </div>
          {products.isSuccess &&
          products.data.items.filter(
            (product) =>
              product.status !== "archived" && !items.some((item) => item.id === product.id),
          ).length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No additional active Products are available. Create a Product first.
            </p>
          ) : null}
          {addProduct.error || removeProduct.error ? (
            <p className="text-destructive mt-4 text-sm" role="alert">
              {(addProduct.error ?? removeProduct.error)?.message}
            </p>
          ) : null}
        </WorkflowPanel>
      ) : null}
    </WorkspacePage>
  )
}
