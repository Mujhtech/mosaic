import type * as React from "react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { CaretUpDownIcon } from "@phosphor-icons/react/dist/ssr/CaretUpDown"
import { CheckIcon } from "@phosphor-icons/react/dist/ssr/Check"
import { StackIcon } from "@phosphor-icons/react/dist/ssr/Stack"
import { Link } from "@tanstack/react-router"

import { Button } from "@/components/ui/button"
import { useActiveEnvironment } from "@/features/environments/hooks/use-active-environment"
import { describeApiError } from "@/lib/api/errors"

// Base UI exposes the trigger width as --anchor-width on positioned popups.
const DROPDOWN_CLASSNAMES = "w-(--anchor-width) min-w-56 rounded"

function SwitcherFrame({ children }: { children: React.ReactNode }) {
  return (
    <SidebarMenu>
      <SidebarMenuItem>{children}</SidebarMenuItem>
    </SidebarMenu>
  )
}

/**
 * The one place an Environment is chosen. It is present on every Project surface,
 * because the choice is now readable from anywhere through useActiveEnvironment
 * rather than only where the route spells it out.
 *
 * Selecting always records the choice. On a route that carries the Environment it
 * also moves the URL, keeping the surface and its search intact, so the link stays
 * an honest description of what is on screen.
 */
export function EnvironmentSwitcher() {
  const { isMobile } = useSidebar()
  const { active, items, pathFor, projectId, query, remember, select } = useActiveEnvironment()

  if (!projectId) return null

  if (query.isPending) {
    return (
      <SwitcherFrame>
        <SidebarMenuButton disabled>
          <StackIcon aria-hidden className="size-4" />
          <span className="text-muted-foreground truncate text-xs" role="status">
            Loading environments…
          </span>
        </SidebarMenuButton>
      </SwitcherFrame>
    )
  }

  if (query.isError) {
    return (
      <SwitcherFrame>
        <div className="space-y-2 px-2 py-1">
          <p className="text-muted-foreground text-xs">
            {describeApiError(query.error).description}
          </p>
          <Button onClick={() => void query.refetch()} size="sm" variant="outline">
            Retry loading environments
          </Button>
        </div>
      </SwitcherFrame>
    )
  }

  if (!active) return null

  return (
    <SwitcherFrame>
      <DropdownMenuGroup>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                aria-label={`Switch environment. Current environment: ${active.name}, ${active.mode}`}
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground border rounded inline-flex w-full items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  <StackIcon aria-hidden className="size-4" />
                  <div className="grid flex-1 text-left leading-tight">
                    <span className="truncate text-xs font-medium">{active.name}</span>
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
              Environments
            </DropdownMenuLabel>

            {items.map((environment) => {
              const target = pathFor(environment.id)

              return (
                <DropdownMenuItem
                  className="gap-2 p-2"
                  key={environment.id}
                  // A real anchor where the URL moves, so an operator can open a
                  // second Environment in a new tab and compare. Where it does
                  // not, there is no address to link to and only the choice is
                  // recorded.
                  onClick={target ? () => remember(environment.id) : () => select(environment.id)}
                  render={target ? <Link search={true} to={target} /> : undefined}
                >
                  <span className="flex size-4 items-center justify-center">
                    {environment.id === active.id ? (
                      <CheckIcon aria-hidden className="size-3" />
                    ) : null}
                  </span>
                  <span className="truncate">{environment.name}</span>
                  <span className="text-muted-foreground ml-auto text-[10px]">
                    {environment.mode}
                  </span>
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </DropdownMenuGroup>
    </SwitcherFrame>
  )
}
