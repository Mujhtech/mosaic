import { EmptyState } from "@/components/feedback/empty-state"

const foundationCapabilities = [
  {
    description: "TanStack Start file routes provide a typed, server-capable application boundary.",
    label: "Typed route shell",
  },
  {
    description: "TanStack Query owns remote data, request deduplication, and future invalidation.",
    label: "Server state",
  },
  {
    description: "shadcn/ui source is configured for Base UI primitives and Tailwind CSS tokens.",
    label: "Accessible UI",
  },
] as const

export function FoundationOverview() {
  return (
    <div className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[32rem] bg-[radial-gradient(circle_at_20%_0%,color-mix(in_oklab,var(--primary)_12%,transparent),transparent_43%),radial-gradient(circle_at_82%_12%,color-mix(in_oklab,var(--accent)_75%,transparent),transparent_36%)]"
      />
      <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8 sm:py-20">
        <section aria-labelledby="foundation-title" className="max-w-3xl">
          <p className="text-primary text-xs font-semibold tracking-[0.18em] uppercase">
            Dashboard foundation
          </p>
          <h1
            className="mt-4 text-4xl leading-[1.05] font-semibold tracking-[-0.045em] text-balance sm:text-6xl"
            id="foundation-title"
          >
            A focused shell for the Mosaic Studio.
          </h1>
          <p className="text-muted-foreground mt-5 max-w-2xl text-base leading-7 sm:text-lg">
            Phase 0 establishes routing, server-state ownership, accessible primitives, and a safe
            REST boundary. Product workflows arrive only after their contracts are reviewed.
          </p>
        </section>

        <section aria-labelledby="capabilities-title" className="mt-12">
          <h2 className="sr-only" id="capabilities-title">
            Foundation capabilities
          </h2>
          <div className="grid gap-3 md:grid-cols-3">
            {foundationCapabilities.map((capability, index) => (
              <article
                className="border-border/75 bg-card/80 rounded-2xl border p-5 shadow-[0_1px_2px_color-mix(in_oklab,var(--foreground)_5%,transparent)] backdrop-blur"
                key={capability.label}
              >
                <span className="text-muted-foreground text-xs font-medium">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-8 text-base font-semibold tracking-tight">{capability.label}</h3>
                <p className="text-muted-foreground mt-2 text-sm leading-6">
                  {capability.description}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section aria-labelledby="workspace-title" className="mt-8">
          <h2 className="sr-only" id="workspace-title">
            Workspace state
          </h2>
          <EmptyState
            description="Project data will appear here after the dashboard API and product contracts are approved in a later phase."
            title="No workspace loaded"
          />
        </section>
      </div>
    </div>
  )
}
