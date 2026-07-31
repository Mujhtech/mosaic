import type {
  Application,
  Environment,
  ProviderConnection,
  ProviderProductMapping,
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
  id: string
  lastErrorCode?: ProviderProductMapping["lastErrorCode"]
  platformLabel: string
  providerLabel: string
  providerOfferingIdentifier?: string
  providerPackageIdentifier?: string
  providerProductIdentifier: string
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
      return "App Store placeholder (Gate 4B)"
    case "google_play":
      return "Google Play placeholder (Gate 4B)"
  }
}

export function readinessStateLabel(state: ProductReadinessState) {
  switch (state) {
    case "archived":
      return "Archived"
    case "attentionRequired":
      return "Attention required"
    case "connected":
      return "Connected"
    case "draft":
      return "Draft"
    case "mockOnly":
      return "Mock only"
    case "unavailable":
      return "Unavailable"
  }
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
): ProviderMappingView {
  const application = applications.find((item) => item.id === mapping.applicationId)
  const environment = environments.find((item) => item.id === mapping.environmentId)
  const connection = connections.find((item) => item.id === mapping.connectionId)

  return {
    applicationLabel: application?.name ?? mapping.applicationId,
    availability: mapping.availability,
    connectionLabel: connection?.name ?? mapping.connectionId ?? "No connection assigned",
    connectionLastSuccessfulSyncAt: connection?.lastSuccessfulSyncAt,
    environmentLabel: environment?.name ?? mapping.environmentId ?? "No Environment assigned",
    id: mapping.id,
    lastErrorCode: mapping.lastErrorCode,
    platformLabel: mapping.platform.toUpperCase(),
    providerLabel: providerLabel(mapping.provider),
    providerOfferingIdentifier: mapping.providerOfferingIdentifier,
    providerPackageIdentifier: mapping.providerPackageIdentifier,
    providerProductIdentifier: mapping.providerProductIdentifier,
    status: mapping.status,
    syncState: mapping.syncState,
  }
}
