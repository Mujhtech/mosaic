import { useForm, useStore } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { useCallback, useState } from "react";
import { EmptyState } from "@/components/feedback/empty-state";
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
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
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
import { MonetizationWorkspace } from "@/features/environments/components/monetization-workspace";
import { WorkflowPanel } from "@/features/orgs/components/workspace-page";
import { paywallsQueryOptions } from "@/features/paywalls/queries/paywall-queries";
import {
  bindPlacementMutationOptions,
  createPlacementAndBindMutationOptions,
  PlacementCreatedWithoutBindingError,
} from "@/features/placements/mutations/placement-mutations";
import { placementsQueryOptions } from "@/features/placements/queries/placement-queries";
import type {
  HostedPaywallListItem,
  HostedPlacement,
} from "@/features/publishing/api/hosted-publishing-adapter";
import { useHostedPublishingAdapter } from "@/features/publishing/api/use-hosted-publishing-adapter";
import { workspaceScopeParams } from "@/lib/routing/workspace-params";

const KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

function BindPlacementAction({
  environmentId,
  paywalls,
  placement,
  projectId,
}: {
  environmentId: string;
  paywalls: readonly HostedPaywallListItem[];
  placement: HostedPlacement;
  projectId: string;
}) {
  const adapter = useHostedPublishingAdapter();
  const queryClient = useQueryClient();
  const mutation = useMutation(
    bindPlacementMutationOptions(
      { environmentId, placement, projectId },
      adapter,
      queryClient
    )
  );
  const paywallOptions = paywalls.map((paywall) => ({
    label: paywall.name,
    value: paywall.id,
  }));
  const form = useForm({
    defaultValues: {
      // An unbound Placement starts empty. Pre-selecting the first Paywall in
      // the list made "Bind" a one-click action that silently chose whichever
      // Paywall happened to sort first — a choice the operator never made, on
      // the control that decides what real users see.
      paywallId: placement.binding?.paywallId ?? "",
    },
    onSubmit: async ({ value }) => {
      const paywall = paywalls.find((item) => item.id === value.paywallId);
      if (paywall) {
        await mutation.mutateAsync(paywall);
      }
    },
  });
  const selectedPaywallId = useStore(
    form.store,
    (state) => state.values.paywallId
  );

  return (
    // Client-rendered authenticated SPA: no server actions in this stack,
    // and nothing here works without JS.
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        form.handleSubmit();
      }}
    >
      <form.Field name="paywallId">
        {(field) => (
          <div className="grid gap-1 font-medium text-xs">
            <span>Bound paywall</span>
            <Select
              items={paywallOptions}
              onValueChange={(value) => field.handleChange(value)}
              value={field.state.value}
            >
              <SelectTrigger
                aria-label={`Paywall for ${placement.name}`}
                className="min-w-48"
                size="sm"
              >
                <SelectValue placeholder="Select a Paywall" />
              </SelectTrigger>
              <SelectContent>
                {paywallOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </form.Field>
      <Button
        disabled={
          mutation.isPending || paywalls.length === 0 || !selectedPaywallId
        }
        size="sm"
        type="submit"
      >
        {(() => {
          if (mutation.isPending) {
            return "Binding…";
          }
          if (placement.binding) {
            return "Change binding";
          }
          return "Bind";
        })()}
      </Button>
      {mutation.error ? (
        <p className="basis-full text-destructive text-sm" role="alert">
          {mutation.error.message}
        </p>
      ) : null}
    </form>
  );
}

function CreatePlacementForm({
  environmentId,
  onCreated,
  paywalls,
  projectId,
}: {
  environmentId: string;
  onCreated: () => void;
  paywalls: readonly HostedPaywallListItem[];
  projectId: string;
}) {
  const adapter = useHostedPublishingAdapter();
  const queryClient = useQueryClient();
  const mutation = useMutation(
    createPlacementAndBindMutationOptions(
      { environmentId, projectId },
      adapter,
      queryClient
    )
  );
  const paywallOptions = [
    { label: "No Paywall yet", value: "" },
    ...paywalls.map((paywall) => ({ label: paywall.name, value: paywall.id })),
  ];
  const form = useForm({
    defaultValues: { key: "", name: "", paywallId: paywalls[0]?.id ?? "" },
    onSubmit: async ({ value, formApi }) => {
      const paywall = paywalls.find((item) => item.id === value.paywallId);
      try {
        const partial =
          mutation.error instanceof PlacementCreatedWithoutBindingError
            ? mutation.error
            : null;
        await mutation.mutateAsync({
          existingPlacement: partial?.placement,
          key: value.key.trim(),
          name: value.name.trim(),
          paywall,
        });
        formApi.reset();
        onCreated();
      } catch {
        // The form keeps its values and exposes a safe retry for the missing binding below.
      }
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        form.handleSubmit();
      }}
    >
      <DialogHeader>
        <DialogTitle>Create Placement</DialogTitle>
        <DialogDescription>
          This creates the stable key. An optional active Paywall preserves the
          simple default binding.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 px-4">
        <form.Field
          name="name"
          validators={{
            onBlur: ({ value }) =>
              value.trim() ? undefined : "Enter a Placement name.",
            onSubmit: ({ value }) =>
              value.trim() ? undefined : "Enter a Placement name.",
          }}
        >
          {(field) => (
            <Field
              data-invalid={field.state.meta.errors.length > 0 || undefined}
            >
              <FieldLabel htmlFor="placement-name">Placement name</FieldLabel>
              <Input
                id="placement-name"
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.currentTarget.value)
                }
                placeholder="Onboarding complete"
                value={field.state.value}
              />
              <FieldError
                errors={field.state.meta.errors.map((message) => ({ message }))}
              />
            </Field>
          )}
        </form.Field>
        <form.Field
          name="key"
          validators={{
            onBlur: ({ value }) =>
              KEY_PATTERN.test(value.trim())
                ? undefined
                : "Enter a valid Placement key.",
            onSubmit: ({ value }) =>
              KEY_PATTERN.test(value.trim())
                ? undefined
                : "Enter a valid Placement key.",
          }}
        >
          {(field) => (
            <Field
              data-invalid={field.state.meta.errors.length > 0 || undefined}
            >
              <FieldLabel htmlFor="placement-key">Placement key</FieldLabel>
              <Input
                id="placement-key"
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.currentTarget.value.toLowerCase())
                }
                placeholder="onboarding_complete"
                value={field.state.value}
              />
              <FieldError
                errors={field.state.meta.errors.map((message) => ({ message }))}
              />
            </Field>
          )}
        </form.Field>
        <form.Field name="paywallId">
          {(field) => (
            <Field>
              <FieldLabel htmlFor="placement-paywall">
                Default Paywall (optional)
              </FieldLabel>
              <Select
                items={paywallOptions}
                onValueChange={(value) => field.handleChange(value)}
                value={field.state.value}
              >
                <SelectTrigger id="placement-paywall">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {paywallOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        </form.Field>
        {mutation.error ? (
          <div
            className="rounded border border-destructive/25 bg-destructive/5 p-3"
            role="alert"
          >
            <p className="text-destructive text-sm">{mutation.error.message}</p>
            {mutation.error instanceof PlacementCreatedWithoutBindingError ? (
              <p className="mt-1 text-muted-foreground text-xs">
                The Placement is safe and appears in Environment bindings after
                refresh. Submit again to retry only its Environment binding.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>
          Cancel
        </DialogClose>
        <Button disabled={mutation.isPending} type="submit">
          {(() => {
            if (mutation.isPending) {
              return "Creating…";
            }
            if (mutation.error instanceof PlacementCreatedWithoutBindingError) {
              return "Retry binding";
            }
            return "Create Placement";
          })()}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function PlacementsPage({
  environmentId,
  organizationId,
  projectId,
}: {
  environmentId: string;
  organizationId: string;
  projectId: string;
}) {
  const handleCreated = useCallback(() => setCreateOpen(false), []);
  const adapter = useHostedPublishingAdapter();
  const [createOpen, setCreateOpen] = useState(false);
  // These resources are independent and begin together; TanStack Query deduplicates shared reads.
  const placements = useQuery(
    placementsQueryOptions({ environmentId, projectId }, adapter)
  );
  const paywalls = useQuery(paywallsQueryOptions(projectId, adapter));
  const items = placements.data ?? [];
  const availablePaywalls =
    paywalls.data?.filter((paywall) => paywall.status === "active") ?? [];
  const state = resolveHostedQueryState({
    // Emptiness is presented inside the page body rather than replacing it.
    error: placements.error ?? paywalls.error,
    // Emptiness is handled inside the page, not by the boundary: the create
    // form is the recovery action and must stay reachable with zero Placements.
    isEmpty: false,
    isPending: placements.isPending || paywalls.isPending,
    loadingDescription: "Loading Placements and Paywalls together.",
    onRetry: () => {
      placements.refetch();
      paywalls.refetch();
    },
    permissionAction: (
      <Link
        className={buttonVariants({ variant: "outline" })}
        params={(prev) => ({
          ...prev,
          ...workspaceScopeParams(prev),
        })}
        to="/orgs/$organizationId/projects/$projectId/env/$environmentKey/monetization/paywalls"
      >
        Return to Paywalls
      </Link>
    ),
    permissionDescription:
      "Project membership is required to manage Placement bindings.",
    scope: { environmentId, organizationId, projectId },
  });

  const createDialog = (
    <Dialog onOpenChange={setCreateOpen} open={createOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        Create Placement
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100vh-4rem)] overflow-y-auto">
        <CreatePlacementForm
          environmentId={environmentId}
          onCreated={handleCreated}
          paywalls={availablePaywalls}
          projectId={projectId}
        />
      </DialogContent>
    </Dialog>
  );

  return (
    <MonetizationWorkspace
      actions={createDialog}
      description="Use stable app intent keys with a compatible default decision, then add deterministic Rules when needed."
      environmentId={environmentId}
      organizationId={organizationId}
      projectId={projectId}
      surface="placements"
      title="Placements"
    >
      <HostedResourceBoundary state={state}>
        <WorkflowPanel title="Environment bindings">
          {items.length === 0 ? (
            <EmptyState
              description="Create the first app intent from Create Placement to bind a Paywall to this Environment."
              title="No Placements yet"
            />
          ) : (
            <ul className="space-y-3">
              {items.map((placement) => (
                <li className="rounded border p-4" key={placement.id}>
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-center">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{placement.name}</p>
                      <p className="mt-1 font-mono text-muted-foreground text-xs">
                        {placement.key}
                      </p>
                      <p
                        className={
                          placement.bindingState === "unknown"
                            ? "mt-2 text-destructive text-xs"
                            : "mt-2 text-muted-foreground text-xs"
                        }
                      >
                        {(() => {
                          // "Could not be read" is not "not bound". Binding on
                          // top of a binding nobody could see is exactly the
                          // mistake this branch exists to prevent.
                          if (placement.bindingState === "unknown") {
                            return "The current binding could not be read. Reload before changing it — this Placement may already be bound.";
                          }
                          return placement.binding
                            ? `Bound to ${placement.binding.paywallName}`
                            : "Binding is not confirmed in this browser session.";
                        })()}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      {(() => {
                        if (placement.bindingState === "unknown") {
                          return (
                            <span className="text-muted-foreground text-xs">
                              Binding is unavailable until the current one can
                              be read.
                            </span>
                          );
                        }
                        return availablePaywalls.length > 0 ? (
                          <BindPlacementAction
                            environmentId={environmentId}
                            paywalls={availablePaywalls}
                            placement={placement}
                            projectId={projectId}
                          />
                        ) : (
                          <span className="text-muted-foreground text-xs">
                            Create a Paywall to select a compatible default.
                          </span>
                        );
                      })()}
                      <Link
                        className={buttonVariants({
                          size: "sm",
                          variant: "outline",
                        })}
                        params={(prev) => ({
                          ...prev,
                          ...workspaceScopeParams(prev),
                          placementId: placement.id,
                        })}
                        to="/orgs/$organizationId/projects/$projectId/env/$environmentKey/monetization/placements/$placementId"
                      >
                        Open decision
                      </Link>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </WorkflowPanel>
      </HostedResourceBoundary>
    </MonetizationWorkspace>
  );
}
