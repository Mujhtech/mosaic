import { createFileRoute, Outlet } from "@tanstack/react-router"

export const Route = createFileRoute("/_studio_layout")({
  component: RouteComponent,
})

function RouteComponent() {
  return (
    <>
      <a
        className="bg-background text-foreground focus-visible:ring-ring fixed top-2 left-2 z-50 -translate-y-20 rounded-md border px-3 py-2 text-sm font-medium focus:translate-y-0 focus-visible:ring-2 focus-visible:outline-none"
        href="#studio-main"
      >
        Skip to Studio workspace
      </a>
      <main className="bg-background h-svh min-h-0 overflow-hidden" id="studio-main" tabIndex={-1}>
        <Outlet />
      </main>
    </>
  )
}
