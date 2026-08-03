import { describe, expect, it } from "vitest";

import { analyticsKeys } from "../queries/analytics-queries";
import type { AnalyticsScope } from "./analytics";
import { parseAnalyticsFilters } from "./analytics-filters";
import { formatAnalyticsMetric } from "./format-analytics-metric";

const scope: AnalyticsScope = {
  organizationId: "org_01",
  projectId: "project_01",
  environmentId: "environment_01",
};

describe("analytics URL and cache scope", () => {
  it("bounds URL-owned filters and isolates query keys by Environment and metric basis", () => {
    const filters = parseAnalyticsFilters({
      from: "2026-07-01",
      to: "2026-07-26",
      timezone: "Africa/Lagos",
      platform: "ios",
      locale: "en-NG",
      applicationVersion: "2.1.0",
      basis: "unique_users",
    });

    expect(filters).toEqual({
      from: "2026-07-01",
      to: "2026-07-26",
      timezone: "Africa/Lagos",
      platform: "ios",
      locale: "en-NG",
      applicationVersion: "2.1.0",
      basis: "event_count",
    });
    expect(analyticsKeys.overview(scope, filters)).not.toEqual(
      analyticsKeys.overview(
        { ...scope, environmentId: "environment_02" },
        filters
      )
    );
  });
});

/**
 * Protects: a metric that is available but carries no value is never rendered
 * as a measured number.
 *
 * The failure this catches is a conversion rate printing "0.0%" for a value the
 * API did not send. That is not a neutral rendering mistake — it is the
 * strongest possible negative statement about a paywall, and it drives
 * decisions to rebuild or roll back something that may be converting fine.
 */
describe("analytics metric formatting", () => {
  it("distinguishes an unreported value from a measured zero", () => {
    expect(
      formatAnalyticsMetric({
        authority: "trusted_server",
        available: true,
        metricId: "purchase_rate",
        numerator: 0,
        warnings: [],
      })
    ).toBe("Not reported");

    expect(
      formatAnalyticsMetric({
        authority: "trusted_server",
        available: true,
        metricId: "purchase_rate",
        numerator: 0,
        value: 0,
        warnings: [],
      })
    ).toBe("0.0%");

    // A metric that is not produced at all keeps its own distinct wording.
    expect(
      formatAnalyticsMetric({
        authority: "trusted_server",
        available: false,
        metricId: "purchase_rate",
        numerator: 0,
        warnings: [],
      })
    ).toBe("Unavailable");
  });
});
