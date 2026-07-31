import { NotePencilIcon } from "@phosphor-icons/react/dist/ssr/NotePencil";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { createDraftFromVersionMutationOptions } from "@/features/paywalls/mutations/paywall-mutations";
import type { HostedDraft } from "@/features/publishing/api/hosted-publishing-adapter";
import { useHostedPublishingAdapter } from "@/features/publishing/api/use-hosted-publishing-adapter";

export function EditPublishedVersionAction({
  environmentId,
  onDraftCreated,
  paywallId,
  projectId,
  versionId,
}: {
  environmentId: string;
  onDraftCreated: (draft: HostedDraft) => void;
  paywallId: string;
  projectId: string;
  versionId: string;
}) {
  const adapter = useHostedPublishingAdapter();
  const queryClient = useQueryClient();
  const createDraft = useMutation(
    createDraftFromVersionMutationOptions(
      { environmentId, paywallId, projectId, versionId },
      adapter,
      queryClient
    )
  );

  return (
    <div>
      <Button
        disabled={createDraft.isPending || adapter.status !== "available"}
        onClick={() =>
          createDraft.mutate(undefined, {
            onSuccess: (draft) => onDraftCreated(draft),
          })
        }
        size="sm"
        type="button"
        variant="outline"
      >
        <NotePencilIcon aria-hidden />
        {createDraft.isPending ? "Creating Draft…" : "Edit as new Draft"}
      </Button>
      {createDraft.error ? (
        <p className="mt-2 text-destructive text-sm" role="alert">
          {createDraft.error.message}
        </p>
      ) : null}
    </div>
  );
}
