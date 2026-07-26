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
} from "../types/analytics"

export interface AnalyticsAdapter {
  getOverview(
    scope: AnalyticsScope,
    filters: AnalyticsFilters,
    signal?: AbortSignal,
  ): Promise<AnalyticsOverview>
  getBreakdowns(
    scope: AnalyticsScope,
    filters: AnalyticsFilters,
    signal?: AbortSignal,
  ): Promise<AnalyticsBreakdown[]>
  getFunnel(
    scope: AnalyticsScope,
    funnel: "placements" | "paywalls" | "products" | "purchases",
    filters: AnalyticsFilters,
    signal?: AbortSignal,
  ): Promise<FunnelReport>
  getPaywallComparison(
    scope: AnalyticsScope,
    filters: AnalyticsFilters,
    signal?: AbortSignal,
  ): Promise<PaywallComparisonRow[]>
  getIssues(
    scope: AnalyticsScope,
    filters: AnalyticsFilters,
    signal?: AbortSignal,
  ): Promise<IssueRow[]>
  getCollectionSettings(scope: AnalyticsScope, signal?: AbortSignal): Promise<CollectionSettings>
  updateCollectionSettings(
    scope: AnalyticsScope,
    settings: Pick<CollectionSettings, "enabled" | "rawRetentionDays">,
  ): Promise<CollectionSettings>
  createEventExport(scope: AnalyticsScope, filters: AnalyticsFilters): Promise<AsyncJob>
  getJob(scope: AnalyticsScope, jobId: string, signal?: AbortSignal): Promise<AsyncJob>
  previewIdentity(scope: AnalyticsScope, request: IdentityRequest): Promise<IdentityPreview>
  createIdentityExport(scope: AnalyticsScope, request: IdentityRequest): Promise<AsyncJob>
  previewDeletion(scope: AnalyticsScope, request: IdentityRequest): Promise<IdentityPreview>
  confirmDeletion(
    scope: AnalyticsScope,
    request: IdentityRequest,
    requestDigest: string,
  ): Promise<AsyncJob>
  downloadJob(scope: AnalyticsScope, jobId: string): Promise<Blob>
}
