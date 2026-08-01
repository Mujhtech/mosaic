import { describe, expect, it } from "vitest";

import {
  isEnvironmentSurface,
  isProjectWideSurface,
  readWorkspaceScope,
} from "@/features/orgs/types/workspace-navigation";

describe("hosted workspace route scope", () => {
  it("derives organization and project identity from the URL without a client store", () => {
    const productRoute =
      "/orgs/org_one/projects/project_one/catalog/products/product_one";

    expect(readWorkspaceScope(productRoute)).toEqual({
      environmentSegment: undefined,
      organizationId: "org_one",
      projectId: "project_one",
    });
    expect(isProjectWideSurface(productRoute)).toBe(true);
    expect(isEnvironmentSurface(productRoute)).toBe(false);
  });

  it("does not treat creation sentinels as selected scope", () => {
    expect(readWorkspaceScope("/orgs/new")).toEqual({
      environmentSegment: undefined,
      organizationId: undefined,
      projectId: undefined,
    });
    expect(
      isEnvironmentSurface(
        "/orgs/org_one/projects/project_one/env/prod/settings/api-keys"
      )
    ).toBe(true);
  });

  it("keeps monetization Environment identity URL-owned", () => {
    const route =
      "/orgs/org_one/projects/project_one/env/staging/monetization/paywalls";

    expect(readWorkspaceScope(route)).toEqual({
      environmentSegment: "staging",
      organizationId: "org_one",
      projectId: "project_one",
    });
    expect(isEnvironmentSurface(route)).toBe(true);
    expect(isProjectWideSurface(route)).toBe(false);
  });

  it("keeps Analytics Environment identity URL-owned", () => {
    const route =
      "/orgs/org_one/projects/project_one/env/prod/analytics/funnel";

    expect(readWorkspaceScope(route)).toEqual({
      environmentSegment: "prod",
      organizationId: "org_one",
      projectId: "project_one",
    });
    expect(isEnvironmentSurface(route)).toBe(true);
    expect(isProjectWideSurface(route)).toBe(false);
  });

  it("keeps Billing Environment identity URL-owned", () => {
    const route =
      "/orgs/org_one/projects/project_one/env/prod/billing/projection-health";

    expect(readWorkspaceScope(route)).toEqual({
      environmentSegment: "prod",
      organizationId: "org_one",
      projectId: "project_one",
    });
    expect(isEnvironmentSurface(route)).toBe(true);
    expect(isProjectWideSurface(route)).toBe(false);
  });
});
