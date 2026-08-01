import { ArchiveIcon } from "@phosphor-icons/react/dist/ssr/Archive";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/ssr/ArrowClockwise";
import { CloudArrowUpIcon } from "@phosphor-icons/react/dist/ssr/CloudArrowUp";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";

import { EmptyState } from "@/components/feedback/empty-state";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Input } from "@/components/ui/input";
import { generatedAssetAdapter } from "@/features/assets/api/generated-asset-adapter";
import {
  archiveAssetMutationOptions,
  uploadAssetMutationOptions,
} from "@/features/assets/mutations/asset-mutations";
import {
  assetsQueryOptions,
  assetUsageQueryOptions,
} from "@/features/assets/queries/asset-queries";
import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary";
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state";
import { MonetizationWorkspace } from "@/features/environments/components/monetization-workspace";
import { WorkflowPanel } from "@/features/orgs/components/workspace-page";
import type { HostedAsset } from "@/features/publishing/api/hosted-publishing-adapter";
import { workspaceScopeParams } from "@/lib/routing/workspace-params";

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AssetRow({
  asset,
  projectId,
}: {
  asset: HostedAsset;
  projectId: string;
}) {
  const handleClick4 = useCallback(() => setReviewingArchive(false), []);
  const handleClick2 = useCallback(() => setReviewingArchive(true), []);
  const handleClick = useCallback(
    () => setShowUsage((current) => !current),
    []
  );
  const queryClient = useQueryClient();
  const [showUsage, setShowUsage] = useState(false);
  const [reviewingArchive, setReviewingArchive] = useState(false);
  const usage = useQuery({
    ...assetUsageQueryOptions(
      { assetId: asset.id, projectId },
      generatedAssetAdapter
    ),
    enabled: showUsage,
  });
  const archive = useMutation(
    archiveAssetMutationOptions(
      { assetId: asset.id, projectId },
      generatedAssetAdapter,
      queryClient
    )
  );

  const handleClick3 = useCallback(
    () =>
      archive.mutate(undefined, {
        onSuccess: () => setReviewingArchive(false),
      }),
    [archive]
  );
  return (
    <li className="rounded border border-border p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-semibold" title={asset.name}>
              {asset.name}
            </p>
            <span className="rounded-full border border-border bg-muted/50 px-2 py-0.5 text-xs capitalize">
              {asset.status}
            </span>
          </div>
          <p className="mt-1 text-muted-foreground text-xs">
            {asset.kind} · {asset.mediaType} · {formatBytes(asset.byteLength)}
          </p>
          <p
            className="mt-2 truncate font-mono text-muted-foreground text-xs"
            title={asset.id}
          >
            {asset.id}
          </p>
          {(() => {
            if (asset.status === "ready") {
              return (
                <p className="mt-2 text-primary text-xs">
                  Ready to select from hosted Studio Assets.
                </p>
              );
            }
            if (asset.status === "failed") {
              return (
                <p className="mt-2 text-destructive text-xs">
                  Validation failed. Upload a corrected source file; Drafts
                  remain unchanged.
                </p>
              );
            }
            return null;
          })()}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={handleClick}
            size="sm"
            type="button"
            variant="outline"
          >
            {showUsage ? "Hide usage" : "View usage"}
          </Button>
          {asset.status !== "archived" && asset.status !== "deleted" ? (
            <Button
              onClick={handleClick2}
              size="sm"
              type="button"
              variant="ghost"
            >
              <ArchiveIcon aria-hidden /> Archive
            </Button>
          ) : null}
        </div>
      </div>

      {showUsage ? (
        <div aria-live="polite" className="mt-4 rounded bg-muted/35 p-3">
          {(() => {
            if (usage.isPending) {
              return (
                <p className="text-muted-foreground text-sm">Loading usage…</p>
              );
            }
            if (usage.error) {
              return (
                <div role="alert">
                  <p className="text-destructive text-sm">
                    {usage.error.message}
                  </p>
                  <Button
                    className="mt-2"
                    onClick={() => {
                      usage.refetch();
                    }}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <ArrowClockwiseIcon aria-hidden /> Retry usage
                  </Button>
                </div>
              );
            }
            if (usage.data) {
              return (
                <dl className="grid grid-cols-3 gap-3 text-center text-sm">
                  <div>
                    <dt className="text-muted-foreground text-xs">Drafts</dt>
                    <dd className="mt-1 font-semibold">
                      {usage.data.draftReferences}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">Versions</dt>
                    <dd className="mt-1 font-semibold">
                      {usage.data.versionReferences}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">Releases</dt>
                    <dd className="mt-1 font-semibold">
                      {usage.data.releaseReferences}
                    </dd>
                  </div>
                </dl>
              );
            }
            return null;
          })()}
        </div>
      ) : null}

      {reviewingArchive ? (
        <div className="mt-4 rounded border border-border bg-muted/35 p-3">
          <p className="font-semibold text-sm">
            Archive this Asset for new authoring?
          </p>
          <p className="mt-1 text-muted-foreground text-sm leading-6">
            Existing published bytes remain available to immutable Releases.
            This Asset will stop appearing as a selectable ready Asset.
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              disabled={archive.isPending}
              onClick={handleClick3}
              size="sm"
              type="button"
            >
              {archive.isPending ? "Archiving…" : "Confirm archive"}
            </Button>
            <Button
              onClick={handleClick4}
              size="sm"
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
          </div>
          {archive.error ? (
            <p className="mt-2 text-destructive text-sm" role="alert">
              {archive.error.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function AssetsPage({
  environmentId,
  organizationId,
  projectId,
  returnTo,
}: {
  environmentId: string;
  organizationId: string;
  projectId: string;
  returnTo?: string;
}) {
  const handleClick3 = useCallback(() => inputRef.current?.click(), []);
  const handleClick2 = useCallback(() => inputRef.current?.click(), []);
  const handleClick = useCallback(() => inputRef.current?.click(), []);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const queryClient = useQueryClient();
  const assets = useQuery(assetsQueryOptions(projectId, generatedAssetAdapter));
  const upload = useMutation(
    uploadAssetMutationOptions(projectId, generatedAssetAdapter, queryClient)
  );
  const items = assets.data ?? [];
  const state = resolveHostedQueryState({
    // Emptiness is presented inside the page body rather than replacing it.
    error: assets.error,
    isEmpty: false,
    isPending: assets.isPending,
    loadingDescription: "Loading managed Assets.",
    onRetry: () => {
      assets.refetch();
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
    permissionDescription: "Project membership is required to manage Assets.",
    scope: { environmentId, organizationId, projectId },
  });

  return (
    <MonetizationWorkspace
      actions={
        <div className="flex flex-wrap gap-2">
          {returnTo ? (
            <a
              className={buttonVariants({ variant: "outline" })}
              href={returnTo}
            >
              Return to Studio
            </a>
          ) : null}
          <Button onClick={handleClick} type="button">
            <CloudArrowUpIcon aria-hidden /> Upload Asset
          </Button>
        </div>
      }
      description="Upload managed images and videos, inspect immutable usage, and select ready identities in hosted Studio."
      environmentId={environmentId}
      organizationId={organizationId}
      projectId={projectId}
      surface="assets"
      title="Assets"
    >
      <Input
        accept="image/jpeg,image/png,image/webp,image/gif,video/mp4"
        aria-label="Upload managed Asset"
        className="sr-only"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) {
            upload.mutate(file);
          }
          event.currentTarget.value = "";
        }}
        ref={inputRef}
        type="file"
      />
      {(() => {
        if (upload.isPending) {
          return (
            <p
              className="rounded border border-border bg-muted/35 p-3 text-sm"
              role="status"
            >
              Uploading and validating Asset…
            </p>
          );
        }
        if (upload.data) {
          return (
            <p
              className="rounded border border-primary/25 bg-primary/5 p-3 text-sm"
              role="status"
            >
              {upload.data.name} uploaded with status {upload.data.status}.
            </p>
          );
        }
        return null;
      })()}
      {upload.error ? (
        <div
          className="rounded border border-destructive/25 bg-destructive/5 p-3"
          role="alert"
        >
          <p className="text-destructive text-sm">{upload.error.message}</p>
          <Button
            className="mt-2"
            onClick={handleClick2}
            size="sm"
            type="button"
            variant="outline"
          >
            Choose another file
          </Button>
        </div>
      ) : null}

      <HostedResourceBoundary state={state}>
        <WorkflowPanel
          description="Only ready Assets are selectable for new hosted authoring. Published usage keeps immutable bytes available after archive."
          title="Managed Asset library"
        >
          {items.length === 0 ? (
            <EmptyState
              action={
                <Button onClick={handleClick3} type="button">
                  Upload first Asset
                </Button>
              }
              description="Upload a supported image or MP4. Mosaic validates it before it can be selected."
              title="No managed Assets yet"
            />
          ) : (
            <ul className="space-y-3">
              {items.map((asset) => (
                <AssetRow asset={asset} key={asset.id} projectId={projectId} />
              ))}
            </ul>
          )}
        </WorkflowPanel>
      </HostedResourceBoundary>
    </MonetizationWorkspace>
  );
}
