import { ArrowUDownLeftIcon } from "@phosphor-icons/react/dist/ssr/ArrowUDownLeft";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  ApiErrorDetails,
  ApiErrorRecoveryAction,
  RequestIdCopy,
} from "@/features/auth/components/hosted-resource-boundary";
import type { HostedRelease } from "@/features/publishing/api/hosted-publishing-adapter";
import { useHostedPublishingAdapter } from "@/features/publishing/api/use-hosted-publishing-adapter";
import { rollbackReleaseMutationOptions } from "@/features/releases/mutations/rollback-mutation";
import { describeApiError } from "@/lib/api/errors";
import type { WorkspaceScope } from "@/lib/routing/workspace-hrefs";

export function RollbackReleaseAction({
  environmentId,
  organizationId,
  projectId,
  release,
}: {
  environmentId: string;
  organizationId?: string;
  projectId: string;
  release: HostedRelease;
}) {
  const handleClick2 = useCallback(() => setReviewing(false), []);
  const handleClick = useCallback(() => setReviewing(true), []);
  const adapter = useHostedPublishingAdapter();
  const scope = { environmentId, organizationId, projectId };
  const queryClient = useQueryClient();
  const [reviewing, setReviewing] = useState(false);
  const rollback = useMutation(
    rollbackReleaseMutationOptions(
      { environmentId, projectId, releaseId: release.id },
      adapter,
      queryClient
    )
  );

  if (rollback.data) {
    return (
      <RollbackSuccessMessage
        currentNumber={rollback.data.number}
        rolledBackNumber={release.number}
      />
    );
  }

  if (!reviewing) {
    return (
      <Button onClick={handleClick} size="sm" type="button" variant="outline">
        <ArrowUDownLeftIcon aria-hidden />
        Roll back to Release {release.number}
      </Button>
    );
  }

  return (
    <div className="rounded border border-border bg-muted/40 p-3">
      <p className="font-semibold text-sm">Create a new rollback Release?</p>
      <p className="mt-1 text-muted-foreground text-sm leading-6">
        Mosaic will copy Release {release.number} into a new immutable Release
        and make that new Release current. Existing history will not be
        rewritten.
      </p>
      <div className="mt-3 flex gap-2">
        <Button
          disabled={rollback.isPending || adapter.status !== "available"}
          onClick={() => rollback.mutate()}
          size="sm"
          type="button"
        >
          {rollback.isPending
            ? "Rolling back…"
            : "Confirm new rollback Release"}
        </Button>
        <Button onClick={handleClick2} size="sm" type="button" variant="ghost">
          Cancel
        </Button>
      </div>
      {rollback.error ? (
        <RollbackError error={rollback.error} scope={scope} />
      ) : null}
    </div>
  );
}

/**
 * A failed rollback previously rendered the raw server message. Mosaic-owned
 * copy explains the coded condition and, where one exists, offers the page
 * that resolves it.
 */
function RollbackError({
  error,
  scope,
}: {
  error: unknown;
  scope: WorkspaceScope;
}) {
  const described = describeApiError(error, scope);

  return (
    <div className="mt-2 space-y-2">
      <p className="text-destructive text-sm" role="alert">
        {described.description}
      </p>
      <ApiErrorDetails details={described.details} />
      {described.recovery ? (
        <ApiErrorRecoveryAction recovery={described.recovery} />
      ) : null}
      {described.correlationId ? (
        <RequestIdCopy requestId={described.correlationId} />
      ) : null}
    </div>
  );
}

/**
 * The confirm button unmounts on success, so keyboard focus would land on the
 * document body. Focusing the confirmation keeps the operator's position in
 * the release list and makes the outcome announced exactly once.
 */
function RollbackSuccessMessage({
  currentNumber,
  rolledBackNumber,
}: {
  currentNumber: number;
  rolledBackNumber: number;
}) {
  const messageRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    messageRef.current?.focus();
  }, []);

  return (
    <p
      className="font-medium text-primary text-sm"
      ref={messageRef}
      role="status"
      tabIndex={-1}
    >
      Release {currentNumber} is now current. Release {rolledBackNumber} remains
      in history.
    </p>
  );
}
