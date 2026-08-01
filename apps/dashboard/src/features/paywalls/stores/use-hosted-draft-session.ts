import { createContext, useContext } from "react";

import type { HostedDraft } from "@/features/publishing/api/hosted-publishing-adapter";

export interface HostedDraftSession {
  readonly acceptSavedDraft: (draft: HostedDraft) => void;
  readonly draft: HostedDraft;
  readonly fetchLatestDraft: () => Promise<HostedDraft>;
  readonly saveDraft: (input: {
    document: HostedDraft["document"];
    draftId: string;
    expectedRevision: number;
  }) => Promise<HostedDraft>;
}

export const HostedDraftSessionContext =
  createContext<HostedDraftSession | null>(null);

export function useHostedDraftSession() {
  return useContext(HostedDraftSessionContext);
}
