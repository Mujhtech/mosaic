import { useMemo } from "react"
import type { ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"

import { hostedDraftQueryOptions, paywallKeys } from "@/features/paywalls/queries/paywall-queries"
import type {
  HostedDraft,
  HostedPublishingAdapter,
} from "@/features/publishing/api/hosted-publishing-adapter"
import {
  HostedDraftSessionContext,
  type HostedDraftSession,
} from "@/features/paywalls/stores/use-hosted-draft-session"

export function HostedDraftSessionProvider({
  adapter,
  children,
  draft,
}: {
  adapter: HostedPublishingAdapter
  children: ReactNode
  draft: HostedDraft
}) {
  const queryClient = useQueryClient()
  const value = useMemo<HostedDraftSession>(
    () => ({
      acceptSavedDraft: (saved) =>
        queryClient.setQueryData(
          paywallKeys.draft(
            { draftId: saved.id, paywallId: saved.paywallId, projectId: saved.projectId },
            adapter,
          ),
          saved,
        ),
      draft,
      fetchLatestDraft: () =>
        queryClient.fetchQuery({
          ...hostedDraftQueryOptions(
            { draftId: draft.id, paywallId: draft.paywallId, projectId: draft.projectId },
            adapter,
          ),
          staleTime: 0,
        }),
      saveDraft: (input) =>
        adapter.saveDraft({
          ...input,
          paywallId: draft.paywallId,
          projectId: draft.projectId,
        }),
    }),
    [adapter, draft, queryClient],
  )

  return (
    <HostedDraftSessionContext.Provider value={value}>
      {children}
    </HostedDraftSessionContext.Provider>
  )
}
