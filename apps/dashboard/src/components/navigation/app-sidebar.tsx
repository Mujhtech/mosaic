import { SquaresFourIcon } from "@phosphor-icons/react/dist/ssr/SquaresFour"
import { NotePencilIcon } from "@phosphor-icons/react/dist/ssr/NotePencil"
import { Link } from "@tanstack/react-router"
import type { ComponentProps } from "react"

import { NavMain, type NavigationItem } from "@/components/navigation/nav-main"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"

const navigationItems = [
  {
    icon: <NotePencilIcon aria-hidden weight="regular" />,
    title: "Studio",
    to: "/studio",
  },
] as const satisfies readonly NavigationItem[]

export function AppSidebar(props: ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton render={<Link to="/studio" />} size="lg" tooltip="Mosaic Studio">
              <span className="bg-sidebar-primary text-sidebar-primary-foreground grid size-8 shrink-0 place-items-center rounded-lg">
                <SquaresFourIcon aria-hidden weight="fill" />
              </span>
              <span className="grid flex-1 text-left leading-tight">
                <span className="truncate font-semibold">Mosaic</span>
                <span className="text-sidebar-foreground/65 truncate text-xs">Local Studio</span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navigationItems} />
      </SidebarContent>
      <SidebarFooter>
        <p className="text-sidebar-foreground/65 px-2 text-xs group-data-[collapsible=icon]:sr-only">
          Local mode · no account required
        </p>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
