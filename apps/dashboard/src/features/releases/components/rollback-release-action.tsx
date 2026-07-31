import { ArrowUDownLeftIcon } from "@phosphor-icons/react/dist/ssr/ArrowUDownLeft"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { rollbackReleaseMutationOptions } from "@/features/releases/mutations/rollback-mutation"
import type { HostedRelease } from "@/features/publishing/api/hosted-publishing-adapter"
import { useHostedPublishingAdapter } from "@/features/publishing/api/use-hosted-publishing-adapter"

export function RollbackReleaseAction({
  environmentId,
  projectId,
  release,
}: {
  environmentId: string
  projectId: string
  release: HostedRelease
}) {
  const adapter = useHostedPublishingAdapter()
  const queryClient = useQueryClient()
  const [reviewing, setReviewing] = useState(false)
  const rollback = useMutation(
    rollbackReleaseMutationOptions(
      { environmentId, projectId, releaseId: release.id },
      adapter,
      queryClient,
    ),
  )

  if (rollback.data) {
    return (
      <p className="text-primary text-sm font-medium" role="status">
        Release {rollback.data.number} is now current. Release {release.number} remains in history.
      </p>
    )
  }

  if (!reviewing) {
    return (
      <Button onClick={() => setReviewing(true)} size="sm" type="button" variant="outline">
        <ArrowUDownLeftIcon aria-hidden />
        Roll back to Release {release.number}
      </Button>
    )
  }

  return (
    <div className="border-border bg-muted/40 rounded border p-3">
      <p className="text-sm font-semibold">Create a new rollback Release?</p>
      <p className="text-muted-foreground mt-1 text-sm leading-6">
        Mosaic will copy Release {release.number} into a new immutable Release and make that new
        Release current. Existing history will not be rewritten.
      </p>
      <div className="mt-3 flex gap-2">
        <Button
          disabled={rollback.isPending || adapter.status !== "available"}
          onClick={() => rollback.mutate()}
          size="sm"
          type="button"
        >
          {rollback.isPending ? "Rolling back…" : "Confirm new rollback Release"}
        </Button>
        <Button onClick={() => setReviewing(false)} size="sm" type="button" variant="ghost">
          Cancel
        </Button>
      </div>
      {rollback.error ? (
        <p className="text-destructive mt-2 text-sm" role="alert">
          {rollback.error.message}
        </p>
      ) : null}
    </div>
  )
}
