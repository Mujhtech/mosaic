import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary";
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state";
import { createProductMutationOptions } from "@/features/catalog/mutations/catalog-mutations";
import {
  type ProductFilters,
  productsQueryOptions,
} from "@/features/catalog/queries/catalog-query";
import { ScopeMismatchRecovery } from "@/features/orgs/components/scope-mismatch-recovery";
import {
  WorkflowPanel,
  WorkspacePage,
} from "@/features/orgs/components/workspace-page";
import { useValidatedProjectScope } from "@/features/projects/hooks/use-validated-project-scope";
import { describeReturnDestination } from "@/lib/routing/workspace-hrefs";
import { workspaceScopeParams } from "@/lib/routing/workspace-params";

const PRODUCT_TYPE_OPTIONS = [
  { label: "Subscription", value: "subscription" },
  { label: "One-time non-consumable", value: "one_time_non_consumable" },
];

const STATUS_FILTER_OPTIONS = [
  { label: "All statuses", value: "" },
  { label: "Draft", value: "draft" },
  { label: "Connected", value: "connected" },
  { label: "Attention required", value: "attention_required" },
  { label: "Archived", value: "archived" },
];

const TYPE_FILTER_OPTIONS = [
  { label: "All types", value: "" },
  { label: "Subscription", value: "subscription" },
  { label: "One-time", value: "one_time_non_consumable" },
];

interface ProductsPageProps {
  filters: ProductFilters;
  onFiltersChange: (filters: ProductFilters) => void;
  organizationId: string;
  projectId: string;
  /**
   * Where a recovery round trip came from. Mosaic Billing sends operators here
   * from a quarantine record to map a store Product, and the way back has to
   * survive the trip or the repair loop cannot be walked.
   */
  returnTo?: string;
}

export function ProductsPage({
  filters,
  onFiltersChange,
  organizationId,
  projectId,
  returnTo,
}: ProductsPageProps) {
  const fieldIds = useId();
  const queryClient = useQueryClient();
  const { project, scopeMismatch, scopeReady } = useValidatedProjectScope(
    organizationId,
    projectId
  );
  const products = useQuery({
    ...productsQueryOptions(projectId, filters),
    enabled: scopeReady,
  });
  const mutation = useMutation(
    createProductMutationOptions(projectId, queryClient)
  );
  const items = products.data?.items ?? [];
  const [createOpen, setCreateOpen] = useState(false);
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
      });
      form.reset();
      setCreateOpen(false);
    },
  });
  const state = resolveHostedQueryState({
    emptyDescription:
      filters.search || filters.status || filters.type
        ? "Adjust the project-wide filters or create a Product."
        : "Create a Monthly, Yearly, or one-time Product with mock metadata.",
    emptyTitle:
      filters.search || filters.status || filters.type
        ? "No Products match"
        : "No Products yet",
    error: project.error ?? products.error,
    isEmpty: scopeReady && products.isSuccess && items.length === 0,
    isPending: project.isPending || (scopeReady && products.isPending),
    loadingDescription: "Loading project Products.",
    onRetry: () => {
      products.refetch();
    },
    permissionDescription:
      "Project membership is required to view Products; owner or admin is required to change them.",
    scope: { organizationId, projectId },
  });
  const canManageProducts = state.kind === "empty" || state.kind === "ready";

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
    );
  }

  const createDialog = (
    <Dialog
      onOpenChange={(open) => {
        setCreateOpen(open);
        if (!open) {
          form.reset();
          mutation.reset();
        }
      }}
      open={createOpen}
    >
      <DialogTrigger render={<Button size="sm" />}>
        Create Product
      </DialogTrigger>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            form.handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Create Product</DialogTitle>
            <DialogDescription>
              Create a provider-neutral Product manually or import synchronized
              provider metadata from Purchase setup.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 px-4">
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
                    onChange={(event) =>
                      field.handleChange(event.target.value.toLowerCase())
                    }
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
                  <Select
                    items={PRODUCT_TYPE_OPTIONS}
                    onValueChange={(value) =>
                      field.handleChange(
                        value as "one_time_non_consumable" | "subscription"
                      )
                    }
                    value={field.state.value}
                  >
                    <SelectTrigger id="product-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PRODUCT_TYPE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            </form.Field>
            <form.Field name="description">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="product-description">
                    Description
                  </FieldLabel>
                  <Input
                    id="product-description"
                    onChange={(event) => field.handleChange(event.target.value)}
                    value={field.state.value}
                  />
                  <FieldDescription>
                    Optional Mosaic-owned metadata.
                  </FieldDescription>
                </Field>
              )}
            </form.Field>
            {mutation.error ? (
              <p className="text-destructive text-sm" role="alert">
                {mutation.error.message}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              Cancel
            </DialogClose>
            <Button disabled={mutation.isPending} type="submit">
              {mutation.isPending ? "Creating…" : "Create Product"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );

  return (
    <WorkspacePage
      actions={canManageProducts ? createDialog : null}
      description="Products are stable provider-neutral purchase options. Mock metadata remains explicit until a billing provider is connected."
      eyebrow="Catalog · Project-wide"
      title="Products"
    >
      {returnTo ? (
        <a
          className="inline-flex font-semibold text-primary text-sm"
          href={returnTo}
        >
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
            params={(prev) => ({
              ...prev,
              ...workspaceScopeParams(prev),
            })}
            to="/orgs/$organizationId/projects/$projectId/env/$environmentKey/catalog/providers"
          >
            Review Purchase setup
          </Link>
          <p className="text-muted-foreground text-xs">
            Provider catalog IDs stay behind mappings; Paywalls continue
            referencing stable Mosaic Product IDs.
          </p>
        </div>
      </WorkflowPanel>
      <WorkflowPanel title="Filters">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="font-medium text-sm" htmlFor={`${fieldIds}-search`}>
            Search
            <Input
              className="mt-2"
              id={`${fieldIds}-search`}
              onChange={(event) =>
                onFiltersChange({
                  ...filters,
                  search: event.target.value || undefined,
                })
              }
              placeholder="Search Products"
              value={filters.search ?? ""}
            />
          </label>
          <div className="font-medium text-sm">
            <label htmlFor="product-status-filter">Status</label>
            <Select
              items={STATUS_FILTER_OPTIONS}
              onValueChange={(value) =>
                onFiltersChange({
                  ...filters,
                  status: (value || undefined) as ProductFilters["status"],
                })
              }
              value={filters.status ?? ""}
            >
              <SelectTrigger className="mt-2" id="product-status-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_FILTER_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="font-medium text-sm">
            <label htmlFor="product-type-filter">Type</label>
            <Select
              items={TYPE_FILTER_OPTIONS}
              onValueChange={(value) =>
                onFiltersChange({
                  ...filters,
                  type: (value || undefined) as ProductFilters["type"],
                })
              }
              value={filters.type ?? ""}
            >
              <SelectTrigger className="mt-2" id="product-type-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPE_FILTER_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </WorkflowPanel>
      <HostedResourceBoundary state={state}>
        <WorkflowPanel title="Products">
          <ul className="divide-y">
            {items.map((product) => (
              <li
                className="flex items-center justify-between gap-4 py-4"
                key={product.id}
              >
                <span>
                  <span className="block font-semibold text-sm">
                    {product.internalName}
                  </span>
                  <span className="mt-1 block text-muted-foreground text-xs">
                    {product.type === "subscription"
                      ? "Subscription"
                      : "One-time"}{" "}
                    ·{" "}
                    {product.metadataSource === "mock"
                      ? "Mock metadata"
                      : "Provider metadata"}{" "}
                    · {product.status.replaceAll("_", " ")}
                  </span>
                </span>
                <Link
                  className="font-medium text-primary text-sm hover:underline"
                  params={(prev) => ({
                    ...prev,
                    ...workspaceScopeParams(prev),
                    productId: product.id,
                  })}
                  search={returnTo ? { returnTo } : {}}
                  to="/orgs/$organizationId/projects/$projectId/env/$environmentKey/catalog/products/$productId"
                >
                  {returnTo ? "Open mappings" : "View usage"}
                </Link>
              </li>
            ))}
          </ul>
        </WorkflowPanel>
      </HostedResourceBoundary>
    </WorkspacePage>
  );
}
