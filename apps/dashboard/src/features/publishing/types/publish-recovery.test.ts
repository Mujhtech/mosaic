import { describe, expect, it } from "vitest";

import {
  publishRecoveryHref,
  publishRecoveryLabel,
} from "@/features/publishing/types/publish-recovery";

const context = {
  assetsHref: "/assets",
  catalogHref: "/products",
  environmentId: "env_staging",
  organizationId: "org_01",
  placementsHref: "/placements",
  projectId: "project_01",
  providersHref: "/providers",
  returnTo:
    "/studio/org_01/project_01/env_staging/paywall_01/draft_01?review=publish",
};

describe("publish recovery routing", () => {
  it("routes provider and scoped Product blockers to their exact recovery surfaces", () => {
    const connectionIssue = {
      code: "connectionRevoked",
      environmentId: "env_production",
      message: "The active connection was revoked.",
      resourceType: "provider_connection",
      severity: "error" as const,
    };
    const mappingIssue = {
      applicationId: "app_ios",
      code: "mappingMissing",
      environmentId: "env_staging",
      message: "Monthly has no iOS mapping.",
      productId: "product_monthly",
      resourceType: "provider_mapping",
      severity: "error" as const,
    };
    const basePlanIssue = {
      applicationId: "app_android",
      code: "commerce.mapping.basePlanMissing",
      environmentId: "env_staging",
      message: "Monthly has no Google Play base plan.",
      productId: "product_monthly",
      recoveryAction: "addGoogleBasePlan",
      resourceType: "provider_mapping",
      severity: "error" as const,
    };

    expect(publishRecoveryHref(connectionIssue, context)).toBe(
      "/providers?environmentId=env_production&returnTo=%2Fstudio%2Forg_01%2Fproject_01%2Fenv_staging%2Fpaywall_01%2Fdraft_01%3Freview%3Dpublish"
    );
    expect(publishRecoveryLabel(connectionIssue)).toBe("Review Purchase setup");
    expect(publishRecoveryHref(mappingIssue, context)).toBe(
      "/orgs/org_01/projects/project_01/catalog/products/product_monthly?environmentId=env_staging&applicationId=app_ios&returnTo=%2Fstudio%2Forg_01%2Fproject_01%2Fenv_staging%2Fpaywall_01%2Fdraft_01%3Freview%3Dpublish"
    );
    expect(publishRecoveryLabel(mappingIssue)).toBe("Review Product mapping");
    expect(publishRecoveryHref(basePlanIssue, context)).toBe(
      "/orgs/org_01/projects/project_01/catalog/products/product_monthly?environmentId=env_staging&applicationId=app_android&returnTo=%2Fstudio%2Forg_01%2Fproject_01%2Fenv_staging%2Fpaywall_01%2Fdraft_01%3Freview%3Dpublish#provider-mappings-title"
    );
    expect(publishRecoveryLabel(basePlanIssue)).toBe("Add Google base plan");
  });
});
