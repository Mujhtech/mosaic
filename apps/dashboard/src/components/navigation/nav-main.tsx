import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";

export interface NavigationItem {
  icon: ReactNode;
  subItems?: readonly NavigationItem[];
  title: string;
  to?: string;
}

interface NavMainProps {
  items: readonly NavigationItem[];
  label: string;
}

export function NavMain({ items, label }: NavMainProps) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarMenu className="gap-1">
        {items.map((item) => {
          if (item.subItems) {
            return (
              <Collapsible
                className="group/collapsible"
                // asChild
                defaultOpen={item.subItems.some(
                  (subItem) =>
                    subItem.to === pathname ||
                    (subItem.to ? pathname.startsWith(`${subItem.to}/`) : false)
                )}
                key={item.title}
              >
                <SidebarMenuItem>
                  <CollapsibleTrigger
                    render={
                      <SidebarMenuButton tooltip={item.title}>
                        {item.icon}
                        <span>{item.title}</span>
                        <CaretRightIcon className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                      </SidebarMenuButton>
                    }
                  />

                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {item.subItems?.map((subItem) => (
                        <SidebarMenuSubItem key={subItem.title}>
                          <SidebarMenuSubButton
                            render={<Link to={subItem.to} />}
                          >
                            <span>{subItem.title}</span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>
            );
          }

          return (
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
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}
