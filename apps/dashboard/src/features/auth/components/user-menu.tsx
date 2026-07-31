import { CaretUpDownIcon } from "@phosphor-icons/react/dist/ssr/CaretUpDown"
import { SignOutIcon } from "@phosphor-icons/react/dist/ssr/SignOut"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { logoutMutationOptions } from "@/features/auth/mutations/auth-mutations"
import { sessionQueryOptions } from "@/features/auth/queries/session-query"
import { describeApiError } from "@/lib/api/errors"

export function UserMenu() {
  const { isMobile } = useSidebar()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const session = useQuery(sessionQueryOptions())
  const logout = useMutation({
    ...logoutMutationOptions(queryClient),
    onSuccess: async () => {
      // Every cached tenant response belongs to the session that just ended.
      queryClient.clear()
      await navigate({ to: "/login" })
    },
  })

  const displayName = session.data?.name ?? session.data?.email ?? "Signed-out session"

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenuGroup>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                aria-label={`Account menu for ${displayName}`}
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                <Avatar className="bg-sidebar-primary text-sidebar-primary-foreground size-5 rounded">
                  <AvatarFallback aria-hidden className="rounded! text-[10px]">
                    {displayName.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate text-xs font-medium">{displayName}</span>
                <CaretUpDownIcon aria-hidden className="ml-auto" />
              </SidebarMenuButton>
            }
          />
          <DropdownMenuContent
            align="end"
            className="w-(--anchor-width) min-w-56 rounded"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-muted-foreground text-xs">
              {session.data?.email ?? "No active session"}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="gap-2 p-2"
              disabled={logout.isPending}
              onClick={() => logout.mutate()}
            >
              <SignOutIcon aria-hidden className="size-4" />
              {logout.isPending ? "Signing out…" : "Sign out"}
            </DropdownMenuItem>
            <p aria-live="polite" className="text-destructive px-2 text-xs empty:hidden">
              {logout.isError ? describeApiError(logout.error).description : ""}
            </p>
          </DropdownMenuContent>
          </DropdownMenu>
        </DropdownMenuGroup>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
