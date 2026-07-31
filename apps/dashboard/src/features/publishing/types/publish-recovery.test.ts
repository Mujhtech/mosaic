import { describe, expect, it } from "vitest"

import {
  publishRecoveryHref,
  publishRecoveryLabel,
} from "@/features/publishing/types/publish-recovery"

const context = {
  assetsHref: "/assets",
  catalogHref: "/products",
  environmentId: "env_staging",
  organizationId: "org_01",
  placementsHref: "/placements",
  projectId: "project_01",
  providersHref: "/providers",
}

describe("publish recovery routing", () => {
  it("routes provider and scoped Product blockers to their exact recovery surfaces", () => {
    const connectionIssue = {
      code: "connectionRevoked",
      environmentId: "env_production",
      message: "The active connection was revoked.",
      resourceType: "provider_connection",
      severity: "error" as const,
    }
    const mappingIssue = {
      applicationId: "app_ios",
      code: "mappingMissing",
      environmentId: "env_staging",
      message: "Monthly has no iOS mapping.",
      productId: "product_monthly",
      resourceType: "provider_mapping",
      severity: "error" as const,
    }

    expect(publishRecoveryHref(connectionIssue, context)).toBe(
      "/providers?environmentId=env_production",
    )
    expect(publishRecoveryLabel(connectionIssue)).toBe("Review Commerce providers")
    expect(publishRecoveryHref(mappingIssue, context)).toBe(
      "/organizations/org_01/projects/project_01/catalog/products/product_monthly?environmentId=env_staging&applicationId=app_ios",
    )
    expect(publishRecoveryLabel(mappingIssue)).toBe("Review Product mapping")
  })
})
