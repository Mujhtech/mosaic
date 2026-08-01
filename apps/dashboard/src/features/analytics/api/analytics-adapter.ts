import type {
  AnalyticsBreakdown,
  AnalyticsFilters,
  AnalyticsOverview,
  AnalyticsScope,
  AsyncJob,
  CollectionSettings,
  FunnelReport,
  IdentityPreview,
  IdentityRequest,
  IssueRow,
  PaywallComparisonRow,
} from "../types/analytics";

export interface AnalyticsAdapter {
  confirmDeletion: (
    scope: AnalyticsScope,
    request: IdentityRequest,
    requestDigest: string
  ) => Promise<AsyncJob>;
  createEventExport: (
    scope: AnalyticsScope,
    filters: AnalyticsFilters
  ) => Promise<AsyncJob>;
  createIdentityExport: (
    scope: AnalyticsScope,
    request: IdentityRequest
  ) => Promise<AsyncJob>;
  downloadJob: (scope: AnalyticsScope, jobId: string) => Promise<Blob>;
  getBreakdowns: (
    scope: AnalyticsScope,
    filters: AnalyticsFilters,
    signal?: AbortSignal
  ) => Promise<AnalyticsBreakdown[]>;
  getCollectionSettings: (
    scope: AnalyticsScope,
    signal?: AbortSignal
  ) => Promise<CollectionSettings>;
  getFunnel: (
    scope: AnalyticsScope,
    funnel: "placements" | "paywalls" | "products" | "purchases",
    filters: AnalyticsFilters,
    signal?: AbortSignal
  ) => Promise<FunnelReport>;
  getIssues: (
    scope: AnalyticsScope,
    filters: AnalyticsFilters,
    signal?: AbortSignal
  ) => Promise<IssueRow[]>;
  getJob: (
    scope: AnalyticsScope,
    jobId: string,
    signal?: AbortSignal
  ) => Promise<AsyncJob>;
  getOverview: (
    scope: AnalyticsScope,
    filters: AnalyticsFilters,
    signal?: AbortSignal
  ) => Promise<AnalyticsOverview>;
  getPaywallComparison: (
    scope: AnalyticsScope,
    filters: AnalyticsFilters,
    signal?: AbortSignal
  ) => Promise<PaywallComparisonRow[]>;
  previewDeletion: (
    scope: AnalyticsScope,
    request: IdentityRequest
  ) => Promise<IdentityPreview>;
  previewIdentity: (
    scope: AnalyticsScope,
    request: IdentityRequest
  ) => Promise<IdentityPreview>;
  updateCollectionSettings: (
    scope: AnalyticsScope,
    settings: Pick<CollectionSettings, "enabled" | "rawRetentionDays">
  ) => Promise<CollectionSettings>;
}
