import { Link, useRouterState } from "@tanstack/react-router"
import type { ReactNode } from "react"

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

export interface NavigationItem {
  icon: ReactNode
  title: string
  to: "/foundation" | "/studio"
}

interface NavMainProps {
  items: readonly NavigationItem[]
}

export function NavMain({ items }: NavMainProps) {
  const pathname = useRouterState({ select: (state) => state.location.pathname })

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Workspace</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => (
          <SidebarMenuItem key={item.to}>
            <SidebarMenuButton
              isActive={pathname === item.to}
              render={<Link to={item.to} />}
              tooltip={item.title}
            >
              {item.icon}
              <span>{item.title}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}
