import { describe, expect, it } from "vitest"

import { detectNestedScopeMismatch } from "@/features/orgs/types/nested-scope"

describe("nested hosted-route scope", () => {
  it("enables a project-scoped list only when the Project belongs to the routed Organization", () => {
    expect(
      detectNestedScopeMismatch({
        expectedOrganizationId: "organization_one",
        expectedProjectId: "project_one",
        project: { id: "project_one", organizationId: "organization_one" },
      }),
    ).toBeNull()
  })

  it("rejects a Project that does not belong to the routed Organization", () => {
    expect(
      detectNestedScopeMismatch({
        expectedOrganizationId: "organization_route",
        expectedProjectId: "project_one",
        project: {
          id: "project_one",
          organizationId: "organization_other",
        },
      }),
    ).toBe("project")
  })

  it("rejects a resource that does not belong to the routed Project", () => {
    expect(
      detectNestedScopeMismatch({
        expectedOrganizationId: "organization_one",
        expectedProjectId: "project_route",
        expectedResourceId: "product_one",
        project: {
          id: "project_route",
          organizationId: "organization_one",
        },
        resource: { id: "product_one", projectId: "project_other" },
      }),
    ).toBe("resource")
  })
})
