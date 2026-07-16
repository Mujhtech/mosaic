import type { ReactNode } from "react"

interface AppShellProps {
  children: ReactNode
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="bg-background text-foreground min-h-svh">
      <a
        className="bg-primary text-primary-foreground sr-only z-50 rounded-md px-3 py-2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        href="#main-content"
      >
        Skip to content
      </a>
      <header className="border-border/70 bg-background/90 border-b backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
          <div className="flex items-center gap-3" aria-label="Mosaic Studio">
            <span
              aria-hidden="true"
              className="bg-primary text-primary-foreground grid size-8 place-items-center rounded-lg text-xs font-bold shadow-sm"
            >
              M
            </span>
            <span>
              <span className="block text-sm leading-none font-semibold tracking-tight">
                Mosaic
              </span>
              <span className="text-muted-foreground mt-1 block text-[0.68rem] leading-none tracking-[0.14em] uppercase">
                Studio
              </span>
            </span>
          </div>
          <span className="border-border bg-muted/55 text-muted-foreground rounded-full border px-3 py-1 text-xs font-medium">
            Phase 0 · Foundation
          </span>
        </div>
      </header>
      <main id="main-content">{children}</main>
    </div>
  )
}
