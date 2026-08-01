import { ArrowsLeftRightIcon } from "@phosphor-icons/react/dist/ssr/ArrowsLeftRight";
import { CaretUpDownIcon } from "@phosphor-icons/react/dist/ssr/CaretUpDown";
import { PlusIcon } from "@phosphor-icons/react/dist/ssr/Plus";
import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { useMemo } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { describeApiError } from "@/lib/api/errors";
import { workspaceScopeParamsWithDefault } from "@/lib/routing/workspace-params";
import { workspaceBootstrapQueryOptions } from "../queries/workspace-bootstrap-query";
import { readWorkspaceScope } from "../types/workspace-navigation";

const AVATAR_CLASSNAMES =
  "bg-sidebar-primary text-sidebar-primary-foreground size-4 rounded data-[size=lg]:size-4 data-[size=sm]:size-4 after:rounded-none";

// Base UI exposes the trigger width as --anchor-width on positioned popups.
const DROPDOWN_CLASSNAMES = "w-(--anchor-width) min-w-56 rounded";

function Initial({ value }: { value: string }) {
  return (
    <Avatar className={AVATAR_CLASSNAMES}>
      <AvatarFallback aria-hidden className="rounded! text-[10px]">
        {value.charAt(0).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}

/**
 * The switcher is where an operator moves between Projects, which is the unit of
 * daily work; changing Organization is the rarer move and lives one level in.
 * Both read the single bootstrap snapshot entry already fetched, so opening the
 * menu costs no request.
 */
export function OrganizationSwitcher({
  organizationId,
}: {
  organizationId?: string;
}) {
  const { isMobile } = useSidebar();
  const bootstrap = useQuery(workspaceBootstrapQueryOptions());
  // The shell passes the Organization it read from the path; the Project comes
  // from the same place, so the switcher does not need a second prop threaded
  // through every caller.
  const projectId = useRouterState({
    select: (state) => readWorkspaceScope(state.location.pathname).projectId,
  });

  const organizations = useMemo(
    () => bootstrap.data?.organizations ?? [],
    [bootstrap.data?.organizations]
  );

  const current = useMemo(
    () =>
      organizations.find((entry) => entry.organization.id === organizationId),
    [organizations, organizationId]
  );

  const currentProject = useMemo(
    () => current?.projects.find((project) => project.id === projectId),
    [current, projectId]
  );

  const organizationLabel = (() => {
    if (current) {
      return current.organization.name;
    }
    if (bootstrap.isPending) {
      return "Loading organizations";
    }
    return "Select organization";
  })();
  const triggerLabel = currentProject ? currentProject.name : organizationLabel;
  const canCreateProject =
    current?.role === "owner" || current?.role === "admin";

  const failure = bootstrap.isError ? (
    <div className="space-y-2 p-2">
      <p className="text-muted-foreground text-xs">
        {describeApiError(bootstrap.error).description}
      </p>
      <Button
        onClick={() => {
          bootstrap.refetch();
        }}
        size="sm"
        variant="outline"
      >
        Retry loading organizations
      </Button>
    </div>
  ) : null;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenuGroup>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <SidebarMenuButton
                  aria-label={
                    currentProject
                      ? `Switch project or organization. Current organization: ${organizationLabel}. Current project: ${currentProject.name}`
                      : `Switch project or organization. Current organization: ${organizationLabel}`
                  }
                  className="inline-flex w-full items-center justify-between data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <div className="flex items-center gap-2">
                    <Initial value={triggerLabel} />
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-medium text-xs">
                        {triggerLabel}
                      </span>
                      {currentProject ? (
                        <span className="truncate text-[10px] text-muted-foreground">
                          {organizationLabel}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <CaretUpDownIcon aria-hidden className="ml-auto" />
                </SidebarMenuButton>
              }
            />

            <DropdownMenuContent
              align="start"
              className={DROPDOWN_CLASSNAMES}
              side={isMobile ? "bottom" : "right"}
              sideOffset={4}
            >
              <DropdownMenuLabel className="text-muted-foreground text-xs">
                Projects
              </DropdownMenuLabel>

              {bootstrap.isPending ? (
                <p className="p-2 text-muted-foreground text-xs" role="status">
                  Loading projects…
                </p>
              ) : (
                (failure ??
                (() => {
                  if (current) {
                    return (() => {
                      if (current.projects.length === 0) {
                        return (
                          <p className="p-2 text-muted-foreground text-xs">
                            {current.organization.name} has no projects yet.
                          </p>
                        );
                      }
                      return (
                        <>
                          {current.projects.map((project) => (
                            <DropdownMenuItem
                              className="gap-2 p-2"
                              key={project.id}
                              render={
                                <Link
                                  params={(prev) => ({
                                    ...prev,
                                    ...workspaceScopeParamsWithDefault(prev),
                                    // Each entry names its own Project; inheriting
                                    // it from the address pointed every row at
                                    // whichever Project was already in scope.
                                    organizationId: current.organization.id,
                                    projectId: project.id,
                                  })}
                                  to="/orgs/$organizationId/projects/$projectId/env/$environmentKey"
                                />
                              }
                            >
                              <Initial value={project.name} />
                              <span className="truncate">{project.name}</span>
                            </DropdownMenuItem>
                          ))}
                          {current.projectsTruncated ? (
                            // Presenting a capped list as the whole list would hide
                            // Projects the operator owns.
                            <DropdownMenuItem
                              className="gap-2 p-2"
                              render={
                                <Link
                                  params={{
                                    organizationId: current.organization.id,
                                  }}
                                  to="/orgs/$organizationId"
                                />
                              }
                            >
                              <span className="truncate text-muted-foreground text-xs">
                                View all {current.projectCount} projects
                              </span>
                            </DropdownMenuItem>
                          ) : null}
                        </>
                      );
                    })();
                  }
                  return (
                    <p className="p-2 text-muted-foreground text-xs">
                      Choose an organization to see its projects.
                    </p>
                  );
                })())
              )}

              {/* Only owners and admins may create a Project, so offering the
                  form to a member would be a guaranteed refusal. */}
              {current && canCreateProject ? (
                <DropdownMenuItem
                  className="gap-2 p-2"
                  render={
                    <Link
                      params={{ organizationId: current.organization.id }}
                      to="/orgs/$organizationId/projects/new"
                    />
                  }
                >
                  <div className="flex size-4 items-center justify-center bg-transparent">
                    <PlusIcon aria-hidden className="size-4" />
                  </div>
                  <div className="font-medium text-muted-foreground text-xs leading-tight">
                    Add project
                  </div>
                </DropdownMenuItem>
              ) : null}

              <DropdownMenuSeparator />

              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="gap-2 p-2">
                  <ArrowsLeftRightIcon aria-hidden className="size-4" />
                  <span className="truncate font-medium text-xs leading-tight">
                    Switch organization
                  </span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="min-w-56">
                  <DropdownMenuLabel className="text-muted-foreground text-xs">
                    Organizations
                  </DropdownMenuLabel>

                  {bootstrap.isPending ? (
                    <p
                      className="p-2 text-muted-foreground text-xs"
                      role="status"
                    >
                      Loading organizations…
                    </p>
                  ) : (
                    (failure ??
                    (organizations.length === 0 ? (
                      <p className="p-2 text-muted-foreground text-xs">
                        You do not belong to an organization yet.
                      </p>
                    ) : (
                      organizations.map((entry) => (
                        <DropdownMenuItem
                          className="gap-2 p-2"
                          key={entry.organization.id}
                          render={
                            <Link
                              params={{ organizationId: entry.organization.id }}
                              to="/orgs/$organizationId"
                            />
                          }
                        >
                          <Initial value={entry.organization.name} />
                          <span className="truncate">
                            {entry.organization.name}
                          </span>
                        </DropdownMenuItem>
                      ))
                    )))
                  )}

                  <DropdownMenuSeparator />

                  <DropdownMenuItem
                    className="gap-2 p-2"
                    render={<Link to="/orgs/new" />}
                  >
                    <div className="flex size-4 items-center justify-center bg-transparent">
                      <PlusIcon aria-hidden className="size-4" />
                    </div>
                    <div className="font-medium text-muted-foreground text-xs leading-tight">
                      Add organization
                    </div>
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuContent>
          </DropdownMenu>
        </DropdownMenuGroup>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
