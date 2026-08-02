import { describe, expect, it } from "vitest";
import { DEFAULT_ENVIRONMENT_ALIAS } from "@/features/environments/types/environment-alias";
import { resolveWorkspaceEntry } from "@/features/orgs/types/workspace-entry";
import type { BootstrapOrganization, Project, Role } from "@/generated/api";

const timestamps = {
  createdAt: "2026-07-30T00:00:00Z",
  updatedAt: "2026-07-30T00:00:00Z",
};

function project(id: string, organizationId: string): Project {
  return {
    ...timestamps,
    id,
    key: id,
    name: id,
    organizationId,
    status: "active",
  };
}

function organization(
  id: string,
  {
    projects = [],
    role = "owner" as Role,
  }: { projects?: Project[]; role?: Role } = {}
): BootstrapOrganization {
  return {
    organization: { ...timestamps, id, name: id },
    projectCount: projects.length,
    projects,
    projectsTruncated: false,
    role,
  };
}

describe("resolveWorkspaceEntry", () => {
  it("sends an operator with no Organizations to create one", () => {
    expect(resolveWorkspaceEntry({ organizations: [] })).toEqual({
      reason: "no-organizations",
      to: "/orgs/new",
    });
  });

  it("lands in the first Project of the first Organization", () => {
    const entry = resolveWorkspaceEntry({
      organizations: [
        organization("org_01", {
          projects: [project("prj_01", "org_01"), project("prj_02", "org_01")],
        }),
        organization("org_02", { projects: [project("prj_03", "org_02")] }),
      ],
    });

    expect(entry).toEqual({
      params: {
        environmentKey: DEFAULT_ENVIRONMENT_ALIAS,
        organizationId: "org_01",
        projectId: "prj_01",
      },
      reason: "resolved",
      to: "/orgs/$organizationId/projects/$projectId/env/$environmentKey",
    });
  });

  it("sends an owner of an empty first Organization to create a Project there", () => {
    // The first Organization decides even though a later one already has a
    // Project: entry must not silently move an owner off the Organization they
    // created.
    const entry = resolveWorkspaceEntry({
      organizations: [
        organization("org_01"),
        organization("org_02", { projects: [project("prj_01", "org_02")] }),
      ],
    });

    expect(entry).toEqual({
      params: { organizationId: "org_01" },
      reason: "no-projects",
      to: "/orgs/$organizationId/projects/new",
    });
  });

  it("routes a member of an empty Organization past a create form they cannot submit", () => {
    const entry = resolveWorkspaceEntry({
      organizations: [
        organization("org_01", { role: "member" }),
        organization("org_02", {
          projects: [project("prj_01", "org_02")],
          role: "member",
        }),
      ],
    });

    expect(entry).toEqual({
      params: {
        environmentKey: DEFAULT_ENVIRONMENT_ALIAS,
        organizationId: "org_02",
        projectId: "prj_01",
      },
      reason: "resolved",
      to: "/orgs/$organizationId/projects/$projectId/env/$environmentKey",
    });
  });

  it("stops at the Organization overview when a member has nowhere to land", () => {
    const entry = resolveWorkspaceEntry({
      organizations: [organization("org_01", { role: "member" })],
    });

    expect(entry).toEqual({
      params: { organizationId: "org_01" },
      reason: "cannot-create-project",
      to: "/orgs/$organizationId",
    });
  });
});
