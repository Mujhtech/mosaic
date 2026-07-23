import type { MosaicDocument } from "@/features/paywall-editor/types/editor"

export interface HostedDraftListItem {
  readonly id: string
  readonly environmentId: string
  readonly projectId: string
  readonly revision: number
  readonly updatedAt: string
}

export interface HostedDraft extends HostedDraftListItem {
  readonly document: MosaicDocument
  readonly paywallId: string
}

export interface HostedPaywallVersion {
  readonly id: string
  readonly environmentId: string
  readonly versionNumber: number
  readonly protocolVersion: string
  readonly sourceDraftRevision: number
  readonly createdAt: string
}

export interface HostedPaywallListItem {
  readonly id: string
  readonly key: string
  readonly name: string
  readonly status: "active" | "archived"
  readonly updatedAt: string
}

export interface HostedPaywallDetail extends HostedPaywallListItem {
  readonly projectId: string
  readonly drafts: readonly HostedDraftListItem[]
  readonly versions: readonly HostedPaywallVersion[]
}

export interface HostedPlacement {
  readonly id: string
  readonly key: string
  readonly name: string
  readonly status: "active" | "archived"
  readonly binding?: {
    readonly environmentId: string
    readonly paywallId: string
    readonly paywallName: string
  }
}

export interface HostedPlacementBinding {
  readonly environmentId: string
  readonly paywallId: string
  readonly placementId: string
  readonly projectId: string
}

export interface HostedRelease {
  readonly id: string
  readonly number: number
  readonly publishedAt: string
  readonly publisherName?: string
  readonly isCurrent: boolean
  readonly rollbackSourceNumber?: number
}

export interface HostedAsset {
  readonly byteLength: number
  readonly contentDigest: string
  readonly id: string
  readonly kind: "image" | "video"
  readonly mediaType: string
  readonly name: string
  readonly status: "archived" | "deleted" | "failed" | "pending" | "ready"
  readonly url: string
}

export interface PublishValidationIssue {
  readonly code: string
  readonly message: string
  readonly recoveryHref?: string
  readonly severity: "error" | "warning"
}

export interface PublishValidationResult {
  readonly assets: readonly { id: string; name: string; ready: boolean }[]
  readonly issues: readonly PublishValidationIssue[]
  readonly placements: readonly { id: string; key: string; bound: boolean }[]
  readonly products: readonly { id: string; name: string; ready: boolean }[]
  readonly protocolVersion: string
}

export const MOCK_PRODUCT_ACKNOWLEDGEMENT_CODE = "product.mock_metadata_acknowledgement"

export interface HostedPublishingAdapter {
  readonly status: "available" | "contract_pending"
  bindPlacement(input: {
    environmentId: string
    paywallId: string
    placementId: string
    projectId: string
  }): Promise<HostedPlacementBinding>
  createDraftFromVersion(input: {
    environmentId: string
    paywallId: string
    projectId: string
    versionId: string
  }): Promise<HostedDraft>
  createDraft(input: {
    document: MosaicDocument
    environmentId: string
    paywallId: string
    projectId: string
  }): Promise<HostedDraft>
  createPaywall(input: {
    key: string
    name: string
    projectId: string
  }): Promise<HostedPaywallDetail>
  createPlacement(input: { key: string; name: string; projectId: string }): Promise<HostedPlacement>
  getActiveDraft(input: {
    environmentId: string
    paywallId: string
    projectId: string
  }): Promise<HostedDraft | null>
  getDraft(input: { draftId: string; paywallId: string; projectId: string }): Promise<HostedDraft>
  getPaywall(input: { paywallId: string; projectId: string }): Promise<HostedPaywallDetail>
  listPaywalls(projectId: string): Promise<readonly HostedPaywallListItem[]>
  listPlacements(input: {
    environmentId: string
    projectId: string
  }): Promise<readonly HostedPlacement[]>
  listPublishedVersions(input: {
    environmentId: string
    paywallId: string
    projectId: string
  }): Promise<readonly (HostedPaywallVersion & { paywallName: string })[]>
  listReleases(input: {
    environmentId: string
    projectId: string
  }): Promise<readonly HostedRelease[]>
  publishDraft(input: {
    acknowledgeMockProducts: boolean
    draftId: string
    environmentId: string
    expectedRevision: number
    paywallId: string
    projectId: string
  }): Promise<HostedRelease>
  rollbackRelease(input: {
    environmentId: string
    projectId: string
    releaseId: string
  }): Promise<HostedRelease>
  saveDraft(input: {
    document: MosaicDocument
    draftId: string
    expectedRevision: number
    paywallId: string
    projectId: string
  }): Promise<HostedDraft>
  validateDraftForPublish(input: {
    draftId: string
    environmentId: string
    expectedRevision: number
    paywallId: string
    projectId: string
  }): Promise<PublishValidationResult>
}

export class HostedPublishingContractPendingError extends Error {
  constructor() {
    super("Hosted publishing is unavailable because the required REST operations are missing.")
    this.name = "HostedPublishingContractPendingError"
  }
}

export class HostedDraftConflictError extends Error {
  readonly latestRevision: number
  readonly serverUpdatedAt?: string

  constructor(latestRevision: number, serverUpdatedAt?: string) {
    super(`Draft revision ${latestRevision} is newer than this editor session.`)
    this.name = "HostedDraftConflictError"
    this.latestRevision = latestRevision
    this.serverUpdatedAt = serverUpdatedAt
  }
}

export class HostedDraftOfflineError extends Error {
  constructor(cause?: unknown) {
    super("The hosted Draft could not be reached.", { cause })
    this.name = "HostedDraftOfflineError"
  }
}

const pending = () => Promise.reject(new HostedPublishingContractPendingError())

export const CONTRACT_PENDING_HOSTED_PUBLISHING_ADAPTER: HostedPublishingAdapter = Object.freeze({
  status: "contract_pending",
  bindPlacement: pending,
  createDraft: pending,
  createDraftFromVersion: pending,
  createPaywall: pending,
  createPlacement: pending,
  getActiveDraft: pending,
  getDraft: pending,
  getPaywall: pending,
  listPaywalls: pending,
  listPlacements: pending,
  listPublishedVersions: pending,
  listReleases: pending,
  publishDraft: pending,
  rollbackRelease: pending,
  saveDraft: pending,
  validateDraftForPublish: pending,
})
