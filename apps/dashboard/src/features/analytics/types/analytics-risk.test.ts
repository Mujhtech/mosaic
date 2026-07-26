import { describe, expect, it } from "vitest"

import { analyticsKeys } from "../queries/analytics-queries"
import type { AnalyticsScope } from "./analytics"
import { parseAnalyticsFilters } from "./analytics-filters"

const scope: AnalyticsScope = {
  organizationId: "org_01",
  projectId: "project_01",
  environmentId: "environment_01",
}

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
    })

    expect(filters).toEqual({
      from: "2026-07-01",
      to: "2026-07-26",
      timezone: "Africa/Lagos",
      platform: "ios",
      locale: "en-NG",
      applicationVersion: "2.1.0",
      basis: "event_count",
    })
    expect(analyticsKeys.overview(scope, filters)).not.toEqual(
      analyticsKeys.overview({ ...scope, environmentId: "environment_02" }, filters),
    )
  })
})
