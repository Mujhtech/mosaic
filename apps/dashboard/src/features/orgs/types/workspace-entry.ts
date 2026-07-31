import { DEFAULT_ENVIRONMENT_ALIAS } from "@/features/environments/types/environment-alias";
import type {
  BootstrapOrganization,
  WorkspaceBootstrap,
} from "@/generated/api";

/**
 * Where entry sends an operator, as a router target so the decision is asserted
 * against real paths rather than against an intermediate vocabulary.
 */
export type WorkspaceEntryTarget =
  | { reason: "no-organizations"; to: "/orgs/new" }
  | {
      params: { organizationId: string };
      reason: "no-projects";
      to: "/orgs/$organizationId/projects/new";
    }
  | {
      params: { organizationId: string };
      reason: "cannot-create-project";
      to: "/orgs/$organizationId";
    }
  | {
      params: {
        environmentKey: string;
        organizationId: string;
        projectId: string;
      };
      reason: "resolved";
      to: "/orgs/$organizationId/projects/$projectId/env/$environmentKey";
    };

/**
 * The router payload for a target, without the `reason` the resolver carries for
 * the benefit of readers and tests.
 */
export function workspaceEntryNavigation(target: WorkspaceEntryTarget) {
  return target.to === "/orgs/new"
    ? { to: target.to }
    : { params: target.params, to: target.to };
}

function canCreateProject(entry: BootstrapOrganization) {
  return entry.role === "owner" || entry.role === "admin";
}

/**
 * Resolves entry from a single bootstrap read: no Organizations means create
 * one, otherwise the first Organization decides, and a first Organization
 * without Projects means create one there.
 *
 * The one place this looks past the first Organization is a member of an empty
 * Organization: only owners and admins may create a Project, so sending a member
 * to the create form would be a guaranteed 403. They fall through to an
 * Organization that does have a Project, and land on the Organization overview
 * when none does.
 */
export function resolveWorkspaceEntry(
  bootstrap: WorkspaceBootstrap
): WorkspaceEntryTarget {
  const organizations = bootstrap.organizations;
  const [first] = organizations;
  if (!first) {
    return { reason: "no-organizations", to: "/orgs/new" };
  }

  const populated = organizations.find((entry) => entry.projects.length > 0);
  const target =
    first.projects.length > 0 || canCreateProject(first)
      ? first
      : (populated ?? first);

  const [project] = target.projects;
  if (project) {
    return {
      params: {
        // Entry resolves before any Environment list is read, so it addresses the
        // one Environment every Project is guaranteed to have.
        environmentKey: DEFAULT_ENVIRONMENT_ALIAS,
        organizationId: target.organization.id,
        projectId: project.id,
      },
      reason: "resolved",
      to: "/orgs/$organizationId/projects/$projectId/env/$environmentKey",
    };
  }

  if (canCreateProject(target)) {
    return {
      params: { organizationId: target.organization.id },
      reason: "no-projects",
      to: "/orgs/$organizationId/projects/new",
    };
  }

  return {
    params: { organizationId: target.organization.id },
    reason: "cannot-create-project",
    to: "/orgs/$organizationId",
  };
}
