import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/feedback/empty-state";
import { LocalDateTime } from "@/components/feedback/local-date-time";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary";
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state";
import { MonetizationWorkspace } from "@/features/environments/components/monetization-workspace";
import { CreatePaywallDraftForm } from "@/features/paywalls/components/create-paywall-draft-form";
import { PaywallCardPreview } from "@/features/paywalls/components/paywall-card-preview";
import { listHostedDraftRecoveries } from "@/features/paywalls/mutations/hosted-draft-recovery";
import { paywallsQueryOptions } from "@/features/paywalls/queries/paywall-queries";
import { useHostedPublishingAdapter } from "@/features/publishing/api/use-hosted-publishing-adapter";
import { workspaceScopeParams } from "@/lib/routing/workspace-params";

export function PaywallsPage({
  environmentId,
  organizationId,
  projectId,
}: {
  environmentId: string;
  organizationId: string;
  projectId: string;
}) {
  const adapter = useHostedPublishingAdapter();
  const paywalls = useQuery({
    ...paywallsQueryOptions(projectId, adapter),
    enabled: adapter.status === "available",
  });
  const [recoveryCount, setRecoveryCount] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(
      () =>
        setRecoveryCount(
          listHostedDraftRecoveries({ environmentId, projectId }).length
        ),
      0
    );
    return () => window.clearTimeout(timer);
  }, [environmentId, projectId]);

  const items = paywalls.data ?? [];
  const state = resolveHostedQueryState({
    // Emptiness is presented inside the page body, next to the create form,
    // rather than replacing the whole view.
    error: paywalls.error,
    isEmpty: false,
    isPending: paywalls.isPending,
    loadingDescription: "Loading hosted Paywalls.",
    onRetry: () => {
      paywalls.refetch();
    },
    permissionAction: (
      <Link
        className={buttonVariants({ variant: "outline" })}
        params={(prev) => ({
          ...prev,
          ...workspaceScopeParams(prev),
        })}
        to="/orgs/$organizationId/projects/$projectId/env/$environmentKey"
      >
        Return to project
      </Link>
    ),
    permissionDescription:
      "Project membership is required to manage hosted Paywalls.",
    scope: { environmentId, organizationId, projectId },
  });

  const createDialog = (
    <Dialog onOpenChange={setCreateOpen} open={createOpen}>
      <DialogTrigger render={<Button size="sm" />}>New paywall</DialogTrigger>
      <DialogContent className="max-h-[calc(100vh-4rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create hosted Draft</DialogTitle>
          <DialogDescription>
            The local source remains unchanged. The hosted copy is scoped to the
            selected Environment.
          </DialogDescription>
        </DialogHeader>
        <div className="px-4 pb-4">
          <CreatePaywallDraftForm
            environmentId={environmentId}
            projectId={projectId}
          />
        </div>
      </DialogContent>
    </Dialog>
  );

  return (
    <MonetizationWorkspace
      actions={createDialog}
      description="Create hosted Drafts, open Studio, and continue from immutable published versions."
      environmentId={environmentId}
      organizationId={organizationId}
      projectId={projectId}
      surface="paywalls"
      title="Paywalls"
    >
      <HostedResourceBoundary state={state}>
        {recoveryCount > 0 ? (
          <p
            className="rounded border border-border bg-muted/35 px-4 py-3 text-sm"
            role="status"
          >
            {recoveryCount} browser recovery{" "}
            {recoveryCount === 1 ? "copy is" : "copies are"}
            available in this Environment. Open the matching Paywall to restore
            or download it.
          </p>
        ) : null}
        {items.length === 0 ? (
          <EmptyState
            description="Create a Paywall and copy a starter, local, or imported document into its first hosted Draft."
            title="No hosted Paywalls yet"
          />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {items.map((paywall) => (
              // The card is a link with a picture beside it, not a link
              // wrapping one: the thumbnail renders the Paywall's own
              // controls, and an anchor may not contain them. The link is
              // stretched across the card instead, so the whole card stays
              // clickable while its accessible name remains the Paywall's
              // name, status, key and update time.
              <li
                className="relative flex gap-4 rounded border p-5 has-[a:hover]:bg-muted/35 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring"
                key={paywall.id}
              >
                <PaywallCardPreview
                  environmentId={environmentId}
                  paywallId={paywall.id}
                  projectId={projectId}
                />
                <Link
                  className="min-w-0 flex-1 after:absolute after:inset-0 focus-visible:outline-none"
                  params={(prev) => ({
                    ...prev,
                    paywallId: paywall.id,
                    ...workspaceScopeParams(prev),
                  })}
                  to="/orgs/$organizationId/projects/$projectId/env/$environmentKey/monetization/paywalls/$paywallId"
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="font-semibold">{paywall.name}</span>
                    <span className="rounded-full border border-border bg-muted/50 px-2 py-0.5 text-muted-foreground text-xs">
                      {paywall.status}
                    </span>
                  </span>
                  <span className="mt-2 block font-mono text-muted-foreground text-xs">
                    {paywall.key}
                  </span>
                  <span className="mt-4 block text-muted-foreground text-xs">
                    Updated <LocalDateTime value={paywall.updatedAt} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </HostedResourceBoundary>
    </MonetizationWorkspace>
  );
}
