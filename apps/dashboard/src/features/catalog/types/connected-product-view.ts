import type {
  Application,
  Environment,
  ProviderConnection,
  ProviderMappingObservation,
  ProviderProductMapping,
  ProviderProductMetadataSnapshot,
  ProviderReadiness,
} from "@/generated/api"

export type ProductReadinessState = ProviderReadiness["state"]

export interface ProductReadinessIssueView {
  code: string
  recoveryAction: string
  resourceId: string
  resourceType: string
  severity: "blocker" | "warning"
}

export interface ProductReadinessView {
  applicationId: string
  connectionId?: string
  environmentId: string
  evaluatedAt: string
  issues: readonly ProductReadinessIssueView[]
  platform: ProviderReadiness["platform"]
  state: ProductReadinessState
}

export interface ProviderMappingView {
  applicationLabel: string
  availability: ProviderProductMapping["availability"]
  connectionLabel: string
  connectionLastSuccessfulSyncAt?: string
  environmentLabel: string
  expectedStoreProductId?: string
  id: string
  lastErrorCode?: ProviderProductMapping["lastErrorCode"]
  platformLabel: string
  provider: ProviderProductMapping["provider"]
  providerLabel: string
  providerOfferingIdentifier?: string
  providerPackageIdentifier?: string
  providerBasePlanIdentifier?: string
  providerOfferIdentifier?: string
  providerProductIdentifier: string
  providerDisplayName?: string
  providerProductState?: string
  providerProductType?: string
  snapshotId?: string
  snapshotSource?: string
  snapshotExpiresAt?: string
  snapshotObservedAt?: string
  snapshotStaleAt?: string
  snapshotSyncedAt?: string
  latestObservation?: ProviderMappingObservation
  status: ProviderProductMapping["status"]
  syncState: ProviderProductMapping["syncState"]
}

function providerLabel(provider: ProviderProductMapping["provider"]) {
  switch (provider) {
    case "revenuecat":
      return "RevenueCat"
    case "custom":
      return "Custom provider"
    case "app_store":
      return "StoreKit"
    case "google_play":
      return "Google Play Billing"
  }
}

export function readinessStateLabel(state: ProductReadinessState) {
  switch (state as string) {
    case "archived":
      return "Archived"
    case "attentionRequired":
      return "Attention required"
    case "configured":
      return "Configured"
    case "verifiedInTest":
      return "Verified in test"
    case "connected":
      return "Connected"
    case "draft":
      return "Draft"
    case "mockOnly":
      return "Mock only"
    case "unavailable":
      return "Unavailable"
  }
  return state
}

export function productReadinessView(readiness: ProviderReadiness): ProductReadinessView {
  return {
    applicationId: readiness.applicationId,
    connectionId: readiness.connectionId,
    environmentId: readiness.environmentId,
    evaluatedAt: readiness.evaluatedAt,
    issues: [
      ...readiness.blockers.map((issue) => ({ ...issue, severity: "blocker" as const })),
      ...readiness.warnings.map((issue) => ({ ...issue, severity: "warning" as const })),
    ],
    platform: readiness.platform,
    state: readiness.state,
  }
}

export function providerMappingView(
  mapping: ProviderProductMapping,
  applications: readonly Application[],
  environments: readonly Environment[],
  connections: readonly ProviderConnection[],
  snapshot?: ProviderProductMetadataSnapshot,
  observations: readonly ProviderMappingObservation[] = [],
): ProviderMappingView {
  const application = applications.find((item) => item.id === mapping.applicationId)
  const environment = environments.find((item) => item.id === mapping.environmentId)
  const connection = connections.find((item) => item.id === mapping.connectionId)
  const metadata = snapshot?.metadata
  const metadataString = (key: string) =>
    typeof metadata?.[key] === "string" ? metadata[key] : undefined

  return {
    applicationLabel: application?.name ?? mapping.applicationId,
    availability: mapping.availability,
    connectionLabel: connection?.name ?? mapping.connectionId ?? "No connection assigned",
    connectionLastSuccessfulSyncAt: connection?.lastSuccessfulSyncAt,
    environmentLabel: environment?.name ?? mapping.environmentId ?? "No Environment assigned",
    expectedStoreProductId: mapping.expectedStoreProductId,
    id: mapping.id,
    lastErrorCode: mapping.lastErrorCode,
    platformLabel: mapping.platform.toUpperCase(),
    provider: mapping.provider,
    providerLabel: providerLabel(mapping.provider),
    providerOfferingIdentifier: mapping.providerOfferingIdentifier,
    providerPackageIdentifier: mapping.providerPackageIdentifier,
    providerBasePlanIdentifier: mapping.providerBasePlanIdentifier,
    providerOfferIdentifier: mapping.providerOfferIdentifier,
    providerDisplayName: metadataString("displayName"),
    providerProductState: metadataString("state"),
    providerProductType: metadataString("type"),
    providerProductIdentifier: mapping.providerProductIdentifier,
    snapshotId: mapping.currentSnapshotId,
    snapshotSource: snapshot?.source,
    snapshotExpiresAt: snapshot?.expiresAt,
    snapshotObservedAt: snapshot?.observedAt,
    snapshotStaleAt: snapshot?.staleAt,
    snapshotSyncedAt: snapshot?.syncedAt,
    latestObservation: [...observations].sort((left, right) =>
      right.observedAt.localeCompare(left.observedAt),
    )[0],
    status: mapping.status,
    syncState: mapping.syncState,
  }
}
