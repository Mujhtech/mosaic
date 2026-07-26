export const analyticsSurfaces = [
  "overview",
  "placements",
  "paywalls",
  "products",
  "purchases",
  "data-privacy",
] as const

export type AnalyticsSurface = (typeof analyticsSurfaces)[number]
export type MetricBasis = "event_count"
export type AnalyticsRole = "owner" | "admin" | "member"

export interface AnalyticsFilters {
  from: string
  to: string
  timezone: string
  basis: MetricBasis
  platform?: "ios" | "android"
  locale?: string
  applicationVersion?: string
}

export interface Freshness {
  latestReceivedAt?: string
  latestAggregatedAt?: string
  rawIngestionLagSeconds?: number
  lateEventPolicy: string
  aggregateState: "current" | "delayed" | "unavailable"
}

export interface MetricValue {
  metricId: string
  value?: number
  numerator: number
  denominator?: number
  authority: "client_observed" | "trusted_server" | "provider_confirmed"
  available: boolean
  warnings: string[]
  basis?: string
  attributionWindow?: string
  timezone?: string
  definition?: string
}

export interface AnalyticsBreakdown {
  dimension: "platform" | "locale"
  rows: Array<{ label: string; count: number }>
}

export interface FunnelStep {
  id: string
  label: string
  eventName: string
  count: number
  available: boolean
  authority: "client_observed" | "trusted_server" | "provider_confirmed"
  warnings: string[]
  dropOff?: number
}

export interface FunnelReport {
  title: string
  correlationKey: string
  sampleSize: number
  steps: FunnelStep[]
  warnings: string[]
  freshness: Freshness
}

export interface AnalyticsOverview {
  metrics: MetricValue[]
  freshness: Freshness
  warnings: string[]
}

export interface PaywallComparisonRow {
  paywallId: string
  paywallVersionId: string
  paywallName: string
  versionNumber: number
  metric: MetricValue
  presentations: number
}

export interface IssueRow {
  id: string
  kind: "product" | "provider" | "placement"
  label: string
  safeCode: string
  count: number
  rate?: number
  recoveryId?: string
}

export interface CollectionSettings {
  enabled: boolean
  rawRetentionDays: number
  updatedAt?: string
}

export type JobState = "queued" | "leased" | "completed" | "failed"

export interface AsyncJob {
  id: string
  type: "event_export" | "identity_export" | "identity_deletion" | "retention"
  state: JobState
  createdAt: string
  completedAt?: string
  expiresAt?: string
  downloadAvailable?: boolean
  safeErrorCode?: string
  auditSummary?: string
}

export interface IdentityRequest {
  scope: "application_user" | "installation"
  value: string
}

export interface IdentityPreview {
  requestToken: string
  scope: IdentityRequest["scope"]
  affectedEnvironments: Array<{ id: string; name: string; eventCount: number }>
  eventCount: number
  sessionCount: number
  relationshipCount: number
  expiresAt: string
}

export interface AnalyticsScope {
  organizationId: string
  projectId: string
  environmentId: string
}
