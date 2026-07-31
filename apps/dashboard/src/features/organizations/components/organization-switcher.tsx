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
import { Separator } from "@/components/ui/separator"
import { ArrowsLeftRightIcon } from "@phosphor-icons/react/dist/ssr/ArrowsLeftRight"
import { projectsQueryOptions } from "@/features/projects/queries/projects-query"

const AVATAR_CLASSNAMES =
  "bg-sidebar-primary text-sidebar-primary-foreground size-4 rounded data-[size=lg]:size-4 data-[size=sm]:size-4 after:rounded-none"

export function OrganizationSwitcher() {
  const { isMobile } = useSidebar()
  const { data, isLoading } = useQuery(organizationsQueryOptions())

  const organizations = React.useMemo(() => {
    return data?.items ?? []
  }, [data?.items])

  const [activeOrganization, setActiveOrganization] = React.useState(organizations[0])

  // const projects = useQuery(projectsQueryOptions(activeOrganization, "active"))

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenuGroup>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <SidebarMenuButton className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground inline-flex w-full items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1">
                      <Avatar className={AVATAR_CLASSNAMES}>
                        <AvatarFallback className="rounded! text-[10px]">M</AvatarFallback>
                      </Avatar>
                      <Separator
                        orientation="vertical"
                        className="h-4 w-[0.5px] origin-center rotate-15 data-vertical:h-4"
                      />
                      <Avatar className={AVATAR_CLASSNAMES}>
                        <AvatarFallback className="rounded! text-[10px]">M</AvatarFallback>
                      </Avatar>
                    </div>

                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate text-xs font-medium">Mosaic Example</span>
                    </div>
                  </div>
                  <CaretUpDownIcon className="ml-auto" />
                </SidebarMenuButton>
              }
            />

            <DropdownMenuContent
              className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded"
              align="start"
              side={isMobile ? "bottom" : "right"}
              sideOffset={4}
            >
              <DropdownMenuLabel className="text-muted-foreground text-xs">
                Projects
              </DropdownMenuLabel>
              {organizations.map((organization) => (
                <DropdownMenuItem
                  key={organization.id}
                  onClick={() => setActiveOrganization(organization)}
                  className="gap-2 p-2"
                >
                  <Avatar className={AVATAR_CLASSNAMES}>
                    <AvatarFallback className="rounded! text-[10px]">
                      {organization.name.charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                  {organization.name}
                  {/* <DropdownMenuShortcut>⌘{index + 1}</DropdownMenuShortcut> */}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem className="gap-2 p-2">
                <div className="flex size-4 items-center justify-center bg-transparent">
                  <PlusIcon className="size-4" />
                </div>
                <div className="text-muted-foreground text-xs leading-tight font-medium">
                  Add project
                </div>
              </DropdownMenuItem>
              <DropdownMenuSeparator />

              {organizations.length > 0 ? (
                <OrganizationDropdown isMobile={isMobile} organizations={organizations} />
              ) : (
                <DropdownMenuItem className="gap-2 p-2">
                  <div className="flex size-4 items-center justify-center bg-transparent">
                    <PlusIcon className="size-4" />
                  </div>
                  <div className="text-muted-foreground font-medium">Add organization</div>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </DropdownMenuGroup>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

const OrganizationDropdown = ({
  organizations,
  isMobile,
}: {
  organizations: { id: string; name: string }[]
  isMobile: boolean
}) => {
  return (
    <DropdownMenuGroup>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <SidebarMenuButton>
              <div className="flex items-center gap-2">
                <ArrowsLeftRightIcon className="size-4" />
                <span className="truncate text-xs leading-tight font-medium">
                  Switch Organization
                </span>
              </div>
            </SidebarMenuButton>
          }
        ></DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded"
          align="start"
          side={isMobile ? "bottom" : "right"}
          sideOffset={4}
        >
          <DropdownMenuLabel className="text-muted-foreground text-xs">
            Organizations
          </DropdownMenuLabel>
          {organizations.map((organization) => (
            <DropdownMenuItem className="gap-2 p-2">
              <Avatar className={AVATAR_CLASSNAMES}>
                <AvatarFallback className="rounded! text-[10px]">
                  {organization.name.charAt(0)}
                </AvatarFallback>
              </Avatar>
              {organization.name}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="gap-2 p-2">
            <div className="flex size-4 items-center justify-center bg-transparent">
              <PlusIcon className="size-4" />
            </div>
            <div className="text-muted-foreground text-xs leading-tight font-medium">
              Add organization
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </DropdownMenuGroup>
  )
}
