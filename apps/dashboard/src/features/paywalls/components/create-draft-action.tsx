import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates";
import { parseImportedJson } from "@/features/paywall-editor/mutations/local-project-file";
import type { MosaicDocument } from "@/features/paywall-editor/types/editor";
import { cloneValue } from "@/features/paywall-editor/utils/clone";
import { createHostedDraftMutationOptions } from "@/features/paywalls/mutations/paywall-mutations";
import { useHostedPublishingAdapter } from "@/features/publishing/api/use-hosted-publishing-adapter";
import { studioScopeParams } from "@/lib/routing/workspace-params";

export function CreateDraftAction({
  environmentId,
  paywallId,
  projectId,
}: {
  environmentId: string;
  organizationId: string;
  paywallId: string;
  projectId: string;
}) {
  const handleClick2 = useCallback(() => inputRef.current?.click(), []);
  const adapter = useHostedPublishingAdapter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const createDraft = useMutation(
    createHostedDraftMutationOptions(
      { environmentId, paywallId, projectId },
      adapter,
      queryClient
    )
  );

  async function create(document: MosaicDocument) {
    const draft = await createDraft.mutateAsync(cloneValue(document));
    await navigate({
      params: (prev) => ({
        ...prev,
        ...studioScopeParams(prev),
        environmentId,
        draftId: draft.id,
        paywallId,
      }),
      to: "/studio/$organizationId/$projectId/$environmentId/$paywallId/$draftId",
    });
  }

  const handleClick = useCallback(() => {
    create(EDITOR_TEMPLATES[0]!.document);
  }, [create]);
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={createDraft.isPending}
          onClick={handleClick}
          size="sm"
          type="button"
        >
          {createDraft.isPending
            ? "Creating Draft…"
            : "Create Draft from starter"}
        </Button>
        <Button
          disabled={createDraft.isPending}
          onClick={handleClick2}
          size="sm"
          type="button"
          variant="outline"
        >
          Import JSON as Draft
        </Button>
      </div>
      <Input
        accept="application/json,.json"
        aria-label="Import Mosaic JSON as a hosted Draft"
        className="sr-only"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (!file) {
            return;
          }
          file
            .text()
            .then((contents) => parseImportedJson(contents).document)
            .then(create)
            .catch((caught: unknown) =>
              setError(
                caught instanceof Error
                  ? caught.message
                  : "The file could not be imported."
              )
            );
          event.currentTarget.value = "";
        }}
        ref={inputRef}
        type="file"
      />
      {error || createDraft.error ? (
        <p className="mt-2 text-destructive text-sm" role="alert">
          {error ?? createDraft.error?.message}
        </p>
      ) : null}
    </div>
  );
}
