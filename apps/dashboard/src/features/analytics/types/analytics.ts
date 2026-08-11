export const analyticsSurfaces = [
  "overview",
  "placements",
  "paywalls",
  "products",
  "purchases",
  "data-privacy",
] as const;

export type AnalyticsSurface = (typeof analyticsSurfaces)[number];
export type MetricBasis = "event_count";
export type AnalyticsRole = "owner" | "admin" | "member";

export interface AnalyticsFilters {
  applicationVersion?: string;
  basis: MetricBasis;
  from: string;
  locale?: string;
  platform?: "ios" | "android";
  timezone: string;
  to: string;
}

export interface Freshness {
  aggregateState: "current" | "delayed" | "unavailable";
  lateEventPolicy: string;
  latestAggregatedAt?: string;
  latestReceivedAt?: string;
  rawIngestionLagSeconds?: number;
}

export interface MetricValue {
  attributionWindow?: string;
  authority: "client_observed" | "trusted_server" | "provider_confirmed";
  available: boolean;
  basis?: string;
  definition?: string;
  denominator?: number;
  metricId: string;
  numerator: number;
  timezone?: string;
  value?: number;
  warnings: string[];
}

export interface AnalyticsBreakdown {
  dimension: "platform" | "locale";
  rows: Array<{ label: string; count: number }>;
}

export interface FunnelStep {
  authority: "client_observed" | "trusted_server" | "provider_confirmed";
  available: boolean;
  count: number;
  dropOff?: number;
  eventName: string;
  id: string;
  label: string;
  warnings: string[];
}

export interface FunnelReport {
  correlationKey: string;
  freshness: Freshness;
  sampleSize: number;
  steps: FunnelStep[];
  title: string;
  warnings: string[];
}

export interface AnalyticsOverview {
  freshness: Freshness;
  metrics: MetricValue[];
  warnings: string[];
}

export interface PaywallComparisonRow {
  metric: MetricValue;
  paywallId: string;
  paywallName: string;
  paywallVersionId: string;
  presentations: number;
  versionNumber: number;
}

export interface IssueRow {
  count: number;
  id: string;
  kind: "product" | "provider" | "placement";
  label: string;
  rate?: number;
  recoveryId?: string;
  safeCode: string;
}

export interface CollectionSettings {
  enabled: boolean;
  rawRetentionDays: number;
  updatedAt?: string;
}

export type JobState = "queued" | "leased" | "completed" | "failed";

export interface AsyncJob {
  auditSummary?: string;
  completedAt?: string;
  createdAt: string;
  downloadAvailable?: boolean;
  expiresAt?: string;
  id: string;
  safeErrorCode?: string;
  state: JobState;
  type: "event_export" | "identity_export" | "identity_deletion" | "retention";
}

export interface IdentityRequest {
  scope: "application_user" | "installation";
  value: string;
}

export interface IdentityPreview {
  affectedEnvironments: Array<{ id: string; name: string; eventCount: number }>;
  eventCount: number;
  expiresAt: string;
  relationshipCount: number;
  requestToken: string;
  scope: IdentityRequest["scope"];
  sessionCount: number;
}

export interface AnalyticsScope {
  environmentId: string;
  /**
   * The Environment as an address names it — `prod`, `staging`, `dev`. Carried
   * beside the id because every Environment-scoped recovery link is built from
   * the alias: without it `analytics_collection_disabled` describes the fix and
   * then offers no way to reach it.
   */
  environmentKey: string;
  organizationId: string;
  projectId: string;
}
