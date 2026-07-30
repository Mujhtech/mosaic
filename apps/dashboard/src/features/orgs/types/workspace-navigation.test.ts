import { describe, expect, it } from "vitest"

import {
  isEnvironmentSurface,
  isProjectWideSurface,
  readWorkspaceScope,
} from "@/features/orgs/types/workspace-navigation"

describe("hosted workspace route scope", () => {
  it("derives organization and project identity from the URL without a client store", () => {
    const productRoute = "/orgs/org_one/projects/project_one/catalog/products/product_one"

    expect(readWorkspaceScope(productRoute)).toEqual({
      environmentId: undefined,
      organizationId: "org_one",
      projectId: "project_one",
    })
    expect(isProjectWideSurface(productRoute)).toBe(true)
    expect(isEnvironmentSurface(productRoute)).toBe(false)
  })

  it("does not treat creation sentinels as selected scope", () => {
    expect(readWorkspaceScope("/orgs/new")).toEqual({
      environmentId: undefined,
      organizationId: undefined,
      projectId: undefined,
    })
    expect(
      isEnvironmentSurface("/orgs/org_one/projects/project_one/settings/api-keys"),
    ).toBe(true)
  })

  it("keeps monetization Environment identity URL-owned", () => {
    const route = "/orgs/org_one/projects/project_one/monetization/env_staging/paywalls"

    expect(readWorkspaceScope(route)).toEqual({
      environmentId: "env_staging",
      organizationId: "org_one",
      projectId: "project_one",
    })
    expect(isEnvironmentSurface(route)).toBe(true)
    expect(isProjectWideSurface(route)).toBe(false)
  })

  it("keeps Analytics Environment identity URL-owned", () => {
    const route = "/orgs/org_one/projects/project_one/analytics/env_production/paywalls"

    expect(readWorkspaceScope(route)).toEqual({
      environmentId: "env_production",
      organizationId: "org_one",
      projectId: "project_one",
    })
    expect(isEnvironmentSurface(route)).toBe(true)
    expect(isProjectWideSurface(route)).toBe(false)
  })

  it("keeps Billing Environment identity URL-owned", () => {
    const route =
      "/orgs/org_one/projects/project_one/billing/env_production/projection-health"

    expect(readWorkspaceScope(route)).toEqual({
      environmentId: "env_production",
      organizationId: "org_one",
      projectId: "project_one",
    })
    expect(isEnvironmentSurface(route)).toBe(true)
    expect(isProjectWideSurface(route)).toBe(false)
  })
})
