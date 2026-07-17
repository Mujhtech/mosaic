import type { ReactNode } from "react"

import { AppSidebar } from "@/components/navigation/app-sidebar"
import { Separator } from "@/components/ui/separator"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"

interface AppShellProps {
  children: ReactNode
  title?: string
  subtitle?: string
}

export function AppShell({
  children,
  title = "Mosaic Studio",
  subtitle = "Local development workspace",
}: AppShellProps) {
  return (
    <SidebarProvider>
      <a
        className="bg-primary text-primary-foreground sr-only z-50 rounded-md px-3 py-2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        href="#main-content"
      >
        Skip to content
      </a>
      <AppSidebar />
      <SidebarInset id="main-content">
        <header className="border-border/70 bg-background/90 sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b px-4 backdrop-blur">
          <SidebarTrigger />
          <Separator className="h-4" orientation="vertical" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{title}</p>
            <p className="text-muted-foreground truncate text-xs">{subtitle}</p>
          </div>
          <span className="border-border bg-muted/55 text-muted-foreground rounded-full border px-2.5 py-1 text-xs font-medium">
            Local only
          </span>
        </header>
        <div className="flex-1">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}
