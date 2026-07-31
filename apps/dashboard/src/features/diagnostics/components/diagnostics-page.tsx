import { Link } from "@tanstack/react-router"

import { buttonVariants } from "@/components/ui/button-variants"
import { DiagnosticsPanel } from "@/features/diagnostics/components/diagnostics-panel"

/**
 * Diagnostics answers "which dashboard is this, what is it configured to talk
 * to, and can it reach it". None of that is tenant data, and all of it is most
 * needed exactly when sign-in is failing, so the page renders outside the
 * hosted authentication guard and outside the workspace shell.
 */
export function DiagnosticsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-5 py-10">
      <header>
        <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
          Mosaic dashboard
        </p>
        <h1 className="mt-1 text-xl font-semibold">Diagnostics</h1>
        <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-6">
          Build identity, runtime configuration, and connectivity for this browser session. No
          Organization or Project data is read on this page, so it stays available while you are
          signed out.
        </p>
      </header>

      <DiagnosticsPanel />

      <nav aria-label="Leave diagnostics" className="flex flex-wrap gap-2">
        <Link className={buttonVariants({ variant: "outline" })} to="/workspace">
          Cloud workspace
        </Link>
        <Link className={buttonVariants({ variant: "outline" })} to="/studio">
          Studio
        </Link>
      </nav>
    </main>
  )
}
