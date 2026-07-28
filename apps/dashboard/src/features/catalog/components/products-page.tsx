import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"

import { Button } from "@/components/ui/button"
import { buttonVariants } from "@/components/ui/button-variants"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary"
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state"
import { createProductMutationOptions } from "@/features/catalog/mutations/catalog-mutations"
import { productsQueryOptions, type ProductFilters } from "@/features/catalog/queries/catalog-query"
import { WorkspacePage, WorkflowPanel } from "@/features/organizations/components/workspace-page"
import { ScopeMismatchRecovery } from "@/features/organizations/components/scope-mismatch-recovery"
import { useValidatedProjectScope } from "@/features/projects/hooks/use-validated-project-scope"
import { describeReturnDestination } from "@/lib/routing/workspace-hrefs"

interface ProductsPageProps {
  filters: ProductFilters
  onFiltersChange: (filters: ProductFilters) => void
  organizationId: string
  projectId: string
  /**
   * Where a recovery round trip came from. Mosaic Billing sends operators here
   * from a quarantine record to map a store Product, and the way back has to
   * survive the trip or the repair loop cannot be walked.
   */
  returnTo?: string
}

export function ProductsPage({
  filters,
  onFiltersChange,
  organizationId,
  projectId,
  returnTo,
}: ProductsPageProps) {
  const queryClient = useQueryClient()
  const { project, scopeMismatch, scopeReady } = useValidatedProjectScope(organizationId, projectId)
  const products = useQuery({ ...productsQueryOptions(projectId, filters), enabled: scopeReady })
  const mutation = useMutation(createProductMutationOptions(projectId, queryClient))
  const items = products.data?.items ?? []
  const form = useForm({
    defaultValues: {
      description: "",
      internalName: "",
      key: "",
      type: "subscription" as "one_time_non_consumable" | "subscription",
    },
    onSubmit: async ({ value }) => {
      await mutation.mutateAsync({
        description: value.description.trim() || undefined,
        internalName: value.internalName.trim(),
        key: value.key.trim(),
        type: value.type,
      })
      form.reset()
    },
  })
  const state = resolveHostedQueryState({
    emptyDescription:
      filters.search || filters.status || filters.type
        ? "Adjust the project-wide filters or create a Product."
        : "Create a Monthly, Yearly, or one-time Product with mock metadata.",
    emptyTitle:
      filters.search || filters.status || filters.type ? "No Products match" : "No Products yet",
    error: project.error ?? products.error,
    isEmpty: scopeReady && products.isSuccess && items.length === 0,
    isPending: project.isPending || (scopeReady && products.isPending),
    loadingDescription: "Loading project Products.",
    onRetry: () => void products.refetch(),
    permissionDescription:
      "Project membership is required to view Products; owner or admin is required to change them.",
    scope: { organizationId, projectId },
  })
  const canManageProducts = state.kind === "empty" || state.kind === "ready"

  if (scopeMismatch) {
    return (
      <WorkspacePage
        description="The routed Organization does not own this Project."
        title="Products unavailable in this Organization"
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
      description="Products are stable provider-neutral purchase options. Mock metadata remains explicit until a billing provider is connected."
      eyebrow="Catalog · Project-wide"
      title="Products"
    >
      {returnTo ? (
        <a className="text-primary inline-flex text-sm font-semibold" href={returnTo}>
          {describeReturnDestination(returnTo)}
        </a>
      ) : null}
      <WorkflowPanel
        description="Import and synchronization begin from one explicit, tested Provider Connection."
        title="Connected Catalog"
      >
        <div className="flex flex-wrap items-center gap-3">
          <Link
            className={buttonVariants({ variant: "outline" })}
            params={{ organizationId, projectId }}
            to="/organizations/$organizationId/projects/$projectId/catalog/providers"
          >
            Review Purchase setup
          </Link>
          <p className="text-muted-foreground text-xs">
            Provider catalog IDs stay behind mappings; Paywalls continue referencing stable Mosaic
            Product IDs.
          </p>
        </div>
      </WorkflowPanel>
      <WorkflowPanel title="Filters">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm font-medium">
            Search
            <Input
              className="mt-2"
              onChange={(event) =>
                onFiltersChange({ ...filters, search: event.target.value || undefined })
              }
              placeholder="Search Products"
              value={filters.search ?? ""}
            />
          </label>
          <label className="text-sm font-medium">
            Status
            <select
              className="border-input bg-background mt-2 h-9 w-full rounded border px-3"
              onChange={(event) =>
                onFiltersChange({
                  ...filters,
                  status: (event.target.value || undefined) as ProductFilters["status"],
                })
              }
              value={filters.status ?? ""}
            >
              <option value="">All statuses</option>
              <option value="draft">Draft</option>
              <option value="connected">Connected</option>
              <option value="attention_required">Attention required</option>
              <option value="archived">Archived</option>
            </select>
          </label>
          <label className="text-sm font-medium">
            Type
            <select
              className="border-input bg-background mt-2 h-9 w-full rounded border px-3"
              onChange={(event) =>
                onFiltersChange({
                  ...filters,
                  type: (event.target.value || undefined) as ProductFilters["type"],
                })
              }
              value={filters.type ?? ""}
            >
              <option value="">All types</option>
              <option value="subscription">Subscription</option>
              <option value="one_time_non_consumable">One-time</option>
            </select>
          </label>
        </div>
      </WorkflowPanel>
      <HostedResourceBoundary state={state}>
        <WorkflowPanel title="Products">
          <ul className="divide-y">
            {items.map((product) => (
              <li className="flex items-center justify-between gap-4 py-4" key={product.id}>
                <span>
                  <span className="block text-sm font-semibold">{product.internalName}</span>
                  <span className="text-muted-foreground mt-1 block text-xs">
                    {product.type === "subscription" ? "Subscription" : "One-time"} ·{" "}
                    {product.metadataSource === "mock" ? "Mock metadata" : "Provider metadata"} ·{" "}
                    {product.status.replaceAll("_", " ")}
                  </span>
                </span>
                <Link
                  className="text-primary text-sm font-medium hover:underline"
                  params={{ organizationId, productId: product.id, projectId }}
                  search={returnTo ? { returnTo } : {}}
                  to="/organizations/$organizationId/projects/$projectId/catalog/products/$productId"
                >
                  {returnTo ? "Open mappings" : "View usage"}
                </Link>
              </li>
            ))}
          </ul>
        </WorkflowPanel>
      </HostedResourceBoundary>
      {canManageProducts ? (
        <WorkflowPanel
          description="Create a provider-neutral Product manually or import synchronized provider metadata from Purchase setup."
          title="Create Product"
        >
          <form
            className="grid gap-4 md:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault()
              event.stopPropagation()
              void form.handleSubmit()
            }}
          >
            <form.Field name="internalName">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="product-name">Internal name</FieldLabel>
                  <Input
                    id="product-name"
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="Monthly"
                    value={field.state.value}
                  />
                </Field>
              )}
            </form.Field>
            <form.Field name="key">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="product-key">Key</FieldLabel>
                  <Input
                    id="product-key"
                    onChange={(event) => field.handleChange(event.target.value.toLowerCase())}
                    placeholder="monthly"
                    value={field.state.value}
                  />
                </Field>
              )}
            </form.Field>
            <form.Field name="type">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="product-type">Type</FieldLabel>
                  <select
                    className="border-input bg-background h-9 rounded border px-3"
                    id="product-type"
                    onChange={(event) =>
                      field.handleChange(
                        event.target.value as "one_time_non_consumable" | "subscription",
                      )
                    }
                    value={field.state.value}
                  >
                    <option value="subscription">Subscription</option>
                    <option value="one_time_non_consumable">One-time non-consumable</option>
                  </select>
                </Field>
              )}
            </form.Field>
            <form.Field name="description">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="product-description">Description</FieldLabel>
                  <Input
                    id="product-description"
                    onChange={(event) => field.handleChange(event.target.value)}
                    value={field.state.value}
                  />
                  <FieldDescription>Optional Mosaic-owned metadata.</FieldDescription>
                </Field>
              )}
            </form.Field>
            <Button className="md:col-start-2" disabled={mutation.isPending} type="submit">
              {mutation.isPending ? "Creating…" : "Create Product"}
            </Button>
          </form>
          {mutation.error ? (
            <p className="text-destructive mt-4 text-sm" role="alert">
              {mutation.error.message}
            </p>
          ) : null}
        </WorkflowPanel>
      ) : null}
    </WorkspacePage>
  )
}
