import { mutationOptions, type QueryClient } from "@tanstack/react-query"

import { paywallKeys } from "@/features/paywalls/queries/paywall-queries"
import type { MosaicDocument } from "@/features/paywall-editor/types/editor"
import type {
  HostedPaywallDetail,
  HostedPublishingAdapter,
} from "@/features/publishing/api/hosted-publishing-adapter"

export class PaywallCreatedWithoutDraftError extends Error {
  readonly document: MosaicDocument
  readonly paywall: HostedPaywallDetail

  constructor(paywall: HostedPaywallDetail, document: MosaicDocument, cause: unknown) {
    super(
      `${paywall.name} was created, but its first Draft could not be created. Retry the Draft without creating another Paywall.`,
      { cause },
    )
    this.name = "PaywallCreatedWithoutDraftError"
    this.document = document
    this.paywall = paywall
  }
}

interface CreatePaywallWithDraftRequest {
  document: MosaicDocument
  existingPaywall?: HostedPaywallDetail
  key: string
  name: string
}

export async function createPaywallWithDraft(
  request: CreatePaywallWithDraftRequest,
  input: { environmentId: string; projectId: string },
  adapter: HostedPublishingAdapter,
) {
  const paywall =
    request.existingPaywall ??
    (await adapter.createPaywall({
      key: request.key,
      name: request.name,
      projectId: input.projectId,
    }))
  try {
    const draft = await adapter.createDraft({
      document: request.document,
      environmentId: input.environmentId,
      paywallId: paywall.id,
      projectId: input.projectId,
    })
    return { draft, paywall }
  } catch (error) {
    throw new PaywallCreatedWithoutDraftError(paywall, request.document, error)
  }
}

export function createPaywallMutationOptions(
  projectId: string,
  adapter: HostedPublishingAdapter,
  queryClient: QueryClient,
) {
  return mutationOptions({
    mutationFn: (input: { key: string; name: string }) =>
      adapter.createPaywall({ ...input, projectId }),
    onSuccess: async (paywall) => {
      queryClient.setQueryData(
        paywallKeys.detail({ paywallId: paywall.id, projectId }, adapter),
        paywall,
      )
      await queryClient.invalidateQueries({ queryKey: paywallKeys.all(projectId) })
    },
  })
}

export function createHostedDraftMutationOptions(
  input: { environmentId: string; paywallId: string; projectId: string },
  adapter: HostedPublishingAdapter,
  queryClient: QueryClient,
) {
  return mutationOptions({
    mutationFn: (document: MosaicDocument) => adapter.createDraft({ ...input, document }),
    onSuccess: (draft) => {
      queryClient.setQueryData(
        paywallKeys.draft(
          { draftId: draft.id, paywallId: draft.paywallId, projectId: draft.projectId },
          adapter,
        ),
        draft,
      )
      queryClient.setQueryData(paywallKeys.activeDraft(input, adapter), draft)
    },
  })
}

export function createPaywallWithDraftMutationOptions(
  input: { environmentId: string; projectId: string },
  adapter: HostedPublishingAdapter,
  queryClient: QueryClient,
) {
  return mutationOptions({
    mutationFn: (request: CreatePaywallWithDraftRequest) =>
      createPaywallWithDraft(request, input, adapter),
    onError: async (error) => {
      if (!(error instanceof PaywallCreatedWithoutDraftError)) return
      queryClient.setQueryData(
        paywallKeys.detail({ paywallId: error.paywall.id, projectId: input.projectId }, adapter),
        error.paywall,
      )
      await queryClient.invalidateQueries({ queryKey: paywallKeys.all(input.projectId) })
    },
    onSuccess: async ({ draft, paywall }) => {
      queryClient.setQueryData(
        paywallKeys.detail({ paywallId: paywall.id, projectId: input.projectId }, adapter),
        { ...paywall, drafts: [draft] },
      )
      queryClient.setQueryData(
        paywallKeys.draft(
          { draftId: draft.id, paywallId: paywall.id, projectId: input.projectId },
          adapter,
        ),
        draft,
      )
      queryClient.setQueryData(
        paywallKeys.activeDraft({ ...input, paywallId: paywall.id }, adapter),
        draft,
      )
      await queryClient.invalidateQueries({ queryKey: paywallKeys.all(input.projectId) })
    },
  })
}

export function createDraftFromVersionMutationOptions(
  input: { environmentId: string; paywallId: string; projectId: string; versionId: string },
  adapter: HostedPublishingAdapter,
  queryClient: QueryClient,
) {
  return mutationOptions({
    mutationFn: () => adapter.createDraftFromVersion(input),
    onSuccess: async (draft) => {
      queryClient.setQueryData(
        paywallKeys.draft(
          { draftId: draft.id, paywallId: draft.paywallId, projectId: draft.projectId },
          adapter,
        ),
        draft,
      )
      queryClient.setQueryData(
        paywallKeys.activeDraft(
          {
            environmentId: input.environmentId,
            paywallId: input.paywallId,
            projectId: input.projectId,
          },
          adapter,
        ),
        draft,
      )
      await queryClient.invalidateQueries({
        queryKey: paywallKeys.detail({ paywallId: input.paywallId, projectId: input.projectId }),
      })
    },
  })
}
