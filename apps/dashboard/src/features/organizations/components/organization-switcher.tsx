import * as React from "react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { CaretUpDownIcon } from "@phosphor-icons/react/dist/ssr/CaretUpDown"
import { PlusIcon } from "@phosphor-icons/react/dist/ssr/Plus"
import { organizationsQueryOptions } from "../queries/organizations-query"
import { useQuery } from "@tanstack/react-query"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Link } from "@tanstack/react-router"
import { describeApiError } from "@/lib/api/errors"

const AVATAR_CLASSNAMES =
  "bg-sidebar-primary text-sidebar-primary-foreground size-4 rounded data-[size=lg]:size-4 data-[size=sm]:size-4 after:rounded-none"

// Base UI exposes the trigger width as --anchor-width on positioned popups.
const DROPDOWN_CLASSNAMES = "w-(--anchor-width) min-w-56 rounded"

export function OrganizationSwitcher({ organizationId }: { organizationId?: string }) {
  const { isMobile } = useSidebar()
  const organizationsQuery = useQuery(organizationsQueryOptions())

  const organizations = React.useMemo(
    () => organizationsQuery.data?.items ?? [],
    [organizationsQuery.data?.items],
  )

  const currentOrganization = React.useMemo(
    () => organizations.find((organization) => organization.id === organizationId),
    [organizations, organizationId],
  )

  const triggerLabel = currentOrganization
    ? currentOrganization.name
    : organizationsQuery.isPending
      ? "Loading organizations"
      : "Select organization"

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenuGroup>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <SidebarMenuButton
                  aria-label={`Switch organization. Current organization: ${triggerLabel}`}
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground inline-flex w-full items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <Avatar className={AVATAR_CLASSNAMES}>
                      <AvatarFallback aria-hidden className="rounded! text-[10px]">
                        {triggerLabel.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate text-xs font-medium">{triggerLabel}</span>
                    </div>
                  </div>
                  <CaretUpDownIcon aria-hidden className="ml-auto" />
                </SidebarMenuButton>
              }
            />

            <DropdownMenuContent
              className={DROPDOWN_CLASSNAMES}
              align="start"
              side={isMobile ? "bottom" : "right"}
              sideOffset={4}
            >
              <DropdownMenuLabel className="text-muted-foreground text-xs">
                Organizations
              </DropdownMenuLabel>

              {organizationsQuery.isPending ? (
                <p className="text-muted-foreground p-2 text-xs" role="status">
                  Loading organizations…
                </p>
              ) : organizationsQuery.isError ? (
                <div className="space-y-2 p-2">
                  <p className="text-muted-foreground text-xs">
                    {describeApiError(organizationsQuery.error).description}
                  </p>
                  <Button
                    onClick={() => void organizationsQuery.refetch()}
                    size="sm"
                    variant="outline"
                  >
                    Retry loading organizations
                  </Button>
                </div>
              ) : organizations.length === 0 ? (
                <p className="text-muted-foreground p-2 text-xs">
                  You do not belong to an organization yet.
                </p>
              ) : (
                organizations.map((organization) => (
                  <DropdownMenuItem
                    className="gap-2 p-2"
                    key={organization.id}
                    render={
                      <Link
                        params={{ organizationId: organization.id }}
                        to="/organizations/$organizationId"
                      />
                    }
                  >
                    <Avatar className={AVATAR_CLASSNAMES}>
                      <AvatarFallback aria-hidden className="rounded! text-[10px]">
                        {organization.name.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="truncate">{organization.name}</span>
                  </DropdownMenuItem>
                ))
              )}

              <DropdownMenuSeparator />

              {organizationId ? (
                <DropdownMenuItem
                  className="gap-2 p-2"
                  render={
                    <Link
                      params={{ organizationId }}
                      to="/organizations/$organizationId/projects/new"
                    />
                  }
                >
                  <div className="flex size-4 items-center justify-center bg-transparent">
                    <PlusIcon aria-hidden className="size-4" />
                  </div>
                  <div className="text-muted-foreground text-xs leading-tight font-medium">
                    Add project
                  </div>
                </DropdownMenuItem>
              ) : null}

              <DropdownMenuItem className="gap-2 p-2" render={<Link to="/organizations/new" />}>
                <div className="flex size-4 items-center justify-center bg-transparent">
                  <PlusIcon aria-hidden className="size-4" />
                </div>
                <div className="text-muted-foreground text-xs leading-tight font-medium">
                  Add organization
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </DropdownMenuGroup>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
