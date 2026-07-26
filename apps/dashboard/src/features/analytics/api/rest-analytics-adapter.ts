import {
  compareAnalyticsPaywallVersions,
  createAnalyticsEventExport,
  createAnalyticsPrivacyDeletion,
  createAnalyticsPrivacyExport,
  downloadAnalyticsJob,
  getAnalyticsBreakdown,
  getAnalyticsFunnel,
  getAnalyticsJob,
  getAnalyticsOverview,
  getAnalyticsProductAvailabilityFailures,
  getAnalyticsProviderErrors,
  getAnalyticsSettings,
  previewAnalyticsPrivacyRequest,
  updateAnalyticsSettings,
  type AnalyticsFreshness,
  type AnalyticsJob,
  type AnalyticsMetric,
  type AnalyticsPrivacyPreview,
  type AnalyticsResult,
  type AnalyticsSettings,
} from "@/generated/api"
import {
  createGeneratedDashboardClient,
  generatedDashboardClient as defaultGeneratedDashboardClient,
} from "@/lib/api/generated-dashboard-client"
import type { AnalyticsAdapter } from "./analytics-adapter"
import type {
  AnalyticsFilters,
  AsyncJob,
  Freshness,
  IdentityPreview,
  IssueRow,
  MetricValue,
  PaywallComparisonRow,
} from "../types/analytics"

function query(filters: AnalyticsFilters) {
  return {
    from: `${filters.from}T00:00:00.000Z`,
    to: exclusiveDayEnd(filters.to),
    timezone: filters.timezone,
    metricBasis: filters.basis,
    platform: filters.platform,
    locale: filters.locale,
    applicationVersion: filters.applicationVersion,
  }
}

function exclusiveDayEnd(date: string) {
  const end = new Date(`${date}T00:00:00.000Z`)
  end.setUTCDate(end.getUTCDate() + 1)
  return end.toISOString()
}

function normalizeSettings(settings: AnalyticsSettings) {
  return {
    enabled: settings.collectionEnabled,
    rawRetentionDays: settings.rawRetentionDays,
    updatedAt: settings.updatedAt,
  }
}

function normalizeFreshness(freshness: AnalyticsFreshness): Freshness {
  const latestReceived = freshness.latestReceivedAt
    ? new Date(freshness.latestReceivedAt).getTime()
    : undefined
  const latestAggregated = freshness.latestAggregatedAt
    ? new Date(freshness.latestAggregatedAt).getTime()
    : undefined
  return {
    latestReceivedAt: freshness.latestReceivedAt,
    latestAggregatedAt: freshness.latestAggregatedAt,
    lateEventPolicy: freshness.lateEventPolicy,
    aggregateState:
      latestAggregated === undefined
        ? "unavailable"
        : latestReceived !== undefined && latestReceived > latestAggregated
          ? "delayed"
          : "current",
  }
}

function normalizeMetric(metric: AnalyticsMetric): MetricValue {
  return {
    metricId: metric.id,
    value: metric.value,
    numerator: metric.numerator,
    denominator: metric.denominator,
    authority: metric.authority,
    available: metric.value !== undefined,
    warnings: metric.warnings ?? [],
    basis: metric.basis,
    attributionWindow: metric.attributionWindow,
    timezone: metric.timezone,
    definition: metric.definition,
  }
}

function normalizeJob(job: AnalyticsJob): AsyncJob {
  const type =
    job.kind === "events" ? "event_export" : job.format ? "identity_export" : "identity_deletion"
  const state =
    job.status === "recomputing" ? "leased" : job.status === "expired" ? "failed" : job.status
  return {
    id: job.id,
    type,
    state,
    createdAt: job.createdAt,
    completedAt: job.status === "completed" ? job.updatedAt : undefined,
    expiresAt: job.expiresAt,
    downloadAvailable: job.status === "completed" && Boolean(job.format),
    safeErrorCode: job.status === "expired" ? "export_expired" : undefined,
    auditSummary:
      job.status === "completed"
        ? `${job.affectedEventCount ?? job.rowCount ?? 0} events and ${job.affectedSessionCount ?? 0} sessions affected.`
        : undefined,
  }
}

function normalizePreview(response: AnalyticsPrivacyPreview): IdentityPreview {
  return {
    requestToken: response.requestDigest,
    scope: response.kind,
    affectedEnvironments: response.affectedEnvironmentIds.map((id) => ({
      id,
      name: id,
      eventCount: 0,
    })),
    eventCount: response.affectedEvents,
    sessionCount: response.affectedSessions,
    relationshipCount: 0,
    expiresAt: "",
  }
}

function funnelReport(
  funnel: "placements" | "paywalls" | "products" | "purchases",
  response: AnalyticsResult,
) {
  const steps = response.metrics.map((metric, index, metrics) => {
    const previous = metrics[index - 1]
    const available = metric.value !== undefined
    return {
      id: metric.id,
      label: metric.id.replaceAll("_", " "),
      eventName: metric.definition,
      count: metric.numerator,
      available,
      authority: metric.authority,
      warnings: metric.warnings ?? [],
      dropOff:
        available &&
        previous?.value !== undefined &&
        previous.numerator > 0 &&
        previous.numerator >= metric.numerator
          ? (previous.numerator - metric.numerator) / previous.numerator
          : undefined,
    }
  })
  return {
    title: `${funnel[0]?.toUpperCase()}${funnel.slice(1)} funnel`,
    correlationKey: "Exact contract correlation identifiers within 24 hours",
    sampleSize:
      response.metrics.find((metric) => metric.id === "paywall_presentations")?.numerator ??
      response.metrics[0]?.denominator ??
      0,
    steps,
    warnings: response.metrics.flatMap((metric) => metric.warnings ?? []),
    freshness: normalizeFreshness(response.freshness),
  }
}

function comparisonRows(response: AnalyticsResult) {
  const grouped = new Map<string, AnalyticsMetric[]>()
  for (const metric of response.metrics) {
    const versionId = metric.dimensions?.paywall_version_id
    if (!versionId) continue
    grouped.set(versionId, [...(grouped.get(versionId) ?? []), metric])
  }
  const rows: PaywallComparisonRow[] = []
  for (const [paywallVersionId, metrics] of grouped) {
    const selected =
      metrics.find((metric) => metric.id === "presentation_to_client_completed_purchase_rate") ??
      metrics[0]
    if (!selected) continue
    rows.push({
      paywallId: "",
      paywallVersionId,
      paywallName: "Paywall Version",
      versionNumber: 0,
      metric: normalizeMetric(selected),
      presentations:
        metrics.find((metric) => metric.id === "paywall_presentations")?.numerator ??
        selected.denominator ??
        0,
    })
  }
  return rows
}

function issueRows(providerErrors: AnalyticsResult, productFailures: AnalyticsResult) {
  return [...providerErrors.metrics, ...productFailures.metrics].map((metric): IssueRow => {
    const provider = metric.dimensions?.provider
    const product = metric.dimensions?.product_id
    const safeCode = metric.dimensions?.diagnostic_code ?? metric.dimensions?.reason ?? metric.id
    return {
      id: `${provider ?? product ?? "issue"}:${safeCode}:${metric.dimensions?.platform ?? "all"}`,
      kind: provider ? "provider" : "product",
      label: provider ?? product ?? metric.id.replaceAll("_", " "),
      safeCode,
      count: metric.numerator,
      rate: metric.denominator ? metric.numerator / metric.denominator : undefined,
      recoveryId: product ?? provider,
    }
  })
}

export function createGeneratedAnalyticsAdapter(
  generatedDashboardClient: ReturnType<
    typeof createGeneratedDashboardClient
  > = defaultGeneratedDashboardClient,
): AnalyticsAdapter {
  return {
    getOverview: async (scope, filters, signal) => {
      const result = await getAnalyticsOverview({
        client: generatedDashboardClient,
        path: scope,
        query: query(filters),
        signal,
        throwOnError: true,
      })
      const response = result.data.data
      return {
        metrics: response.metrics.map(normalizeMetric),
        freshness: normalizeFreshness(response.freshness),
        warnings: response.metrics.flatMap((metric) => metric.warnings ?? []),
      }
    },
    getBreakdowns: async (scope, filters, signal) => {
      const breakdownQuery = query(filters)
      const dimensions = ["platforms", "locales"] as const
      const results = await Promise.all(
        dimensions.map((dimension) =>
          getAnalyticsBreakdown({
            client: generatedDashboardClient,
            path: { ...scope, dimension },
            query: breakdownQuery,
            signal,
            throwOnError: true,
          }),
        ),
      )
      return results.map((result, index) => {
        const dimension = dimensions[index] === "platforms" ? "platform" : "locale"
        return {
          dimension,
          rows: result.data.data.metrics.map((metric) => ({
            label: metric.dimensions?.[dimension] ?? "Unavailable",
            count: metric.numerator,
          })),
        }
      })
    },
    getFunnel: async (scope, funnel, filters, signal) => {
      const result = await getAnalyticsFunnel({
        client: generatedDashboardClient,
        path: { ...scope, funnel },
        query: query(filters),
        signal,
        throwOnError: true,
      })
      return funnelReport(funnel, result.data.data)
    },
    getPaywallComparison: async (scope, filters, signal) => {
      const result = await compareAnalyticsPaywallVersions({
        client: generatedDashboardClient,
        path: scope,
        query: query(filters),
        signal,
        throwOnError: true,
      })
      return comparisonRows(result.data.data)
    },
    getIssues: async (scope, filters, signal) => {
      const options = {
        client: generatedDashboardClient,
        path: scope,
        query: query(filters),
        signal,
        throwOnError: true as const,
      }
      const [providerErrors, productFailures] = await Promise.all([
        getAnalyticsProviderErrors(options),
        getAnalyticsProductAvailabilityFailures(options),
      ])
      return issueRows(providerErrors.data.data, productFailures.data.data)
    },
    getCollectionSettings: async (scope, signal) => {
      const result = await getAnalyticsSettings({
        client: generatedDashboardClient,
        path: scope,
        signal,
        throwOnError: true,
      })
      return normalizeSettings(result.data.data)
    },
    updateCollectionSettings: async (scope, settings) => {
      const result = await updateAnalyticsSettings({
        body: {
          collectionEnabled: settings.enabled,
          rawRetentionDays: settings.rawRetentionDays,
        },
        client: generatedDashboardClient,
        path: scope,
        throwOnError: true,
      })
      return normalizeSettings(result.data.data)
    },
    createEventExport: async (scope, filters) => {
      const result = await createAnalyticsEventExport({
        body: {
          from: `${filters.from}T00:00:00.000Z`,
          to: exclusiveDayEnd(filters.to),
          format: "ndjson",
        },
        client: generatedDashboardClient,
        path: scope,
        throwOnError: true,
      })
      return normalizeJob(result.data.data)
    },
    getJob: async (scope, jobId, signal) => {
      const result = await getAnalyticsJob({
        client: generatedDashboardClient,
        path: { jobId, projectId: scope.projectId },
        signal,
        throwOnError: true,
      })
      return normalizeJob(result.data.data)
    },
    previewIdentity: async (scope, identity) => {
      const result = await previewAnalyticsPrivacyRequest({
        body: { identity: identity.value, kind: identity.scope },
        client: generatedDashboardClient,
        path: { projectId: scope.projectId },
        throwOnError: true,
      })
      return normalizePreview(result.data.data)
    },
    createIdentityExport: async (scope, identity) => {
      const result = await createAnalyticsPrivacyExport({
        body: { format: "ndjson", identity: identity.value, kind: identity.scope },
        client: generatedDashboardClient,
        path: { projectId: scope.projectId },
        throwOnError: true,
      })
      return normalizeJob(result.data.data)
    },
    previewDeletion: async (scope, identity) => {
      const result = await previewAnalyticsPrivacyRequest({
        body: { identity: identity.value, kind: identity.scope },
        client: generatedDashboardClient,
        path: { projectId: scope.projectId },
        throwOnError: true,
      })
      return normalizePreview(result.data.data)
    },
    confirmDeletion: async (scope, identity, requestDigest) => {
      const result = await createAnalyticsPrivacyDeletion({
        body: {
          confirm: true,
          identity: identity.value,
          kind: identity.scope,
          requestDigest,
        },
        client: generatedDashboardClient,
        path: { projectId: scope.projectId },
        throwOnError: true,
      })
      return normalizeJob(result.data.data)
    },
    downloadJob: async (scope, jobId) => {
      const result = await downloadAnalyticsJob({
        client: generatedDashboardClient,
        path: { jobId, projectId: scope.projectId },
        throwOnError: true,
      })
      return result.data
    },
  }
}

export const restAnalyticsAdapter = createGeneratedAnalyticsAdapter()
