import { describe, expect, it } from "vitest";

import {
  analyticsCollectionSettingsHref,
  environmentSettingsHref,
} from "./workspace-hrefs";

const scope = {
  environmentKey: "prod",
  organizationId: "org_01",
  projectId: "project_01",
};

describe("environment settings href", () => {
  // The only consumer is the `analytics_collection_disabled` recovery link, and
  // it is minted outside the router, so nothing type-checks this address. The
  // helper previously built the pre-`/env` shape and produced a 404.
  it("builds the Environment-scoped settings route", () => {
    expect(environmentSettingsHref(scope)).toBe(
      "/orgs/org_01/projects/project_01/env/prod/settings/environments"
    );
  });

  it("addresses the analytics collection control, not just the page", () => {
    expect(analyticsCollectionSettingsHref(scope)).toBe(
      "/orgs/org_01/projects/project_01/env/prod/settings/environments#analytics-collection"
    );
  });

  // Sending an operator whose Production metrics are dark to Development
  // settings would show them a toggle that is already on.
  it("produces no link when the Environment is unknown", () => {
    expect(
      environmentSettingsHref({
        organizationId: "org_01",
        projectId: "project_01",
      })
    ).toBeUndefined();
    expect(
      analyticsCollectionSettingsHref({ environmentKey: "prod" })
    ).toBeUndefined();
  });
});
