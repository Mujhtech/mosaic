import { createContext, useContext } from "react"

import type { HostedDraft } from "@/features/publishing/api/hosted-publishing-adapter"

export interface HostedDraftSession {
  readonly draft: HostedDraft
  readonly saveDraft: (input: {
    document: HostedDraft["document"]
    draftId: string
    expectedRevision: number
  }) => Promise<HostedDraft>
  readonly acceptSavedDraft: (draft: HostedDraft) => void
  readonly fetchLatestDraft: () => Promise<HostedDraft>
}

export const HostedDraftSessionContext = createContext<HostedDraftSession | null>(null)

export function useHostedDraftSession() {
  return useContext(HostedDraftSessionContext)
}
