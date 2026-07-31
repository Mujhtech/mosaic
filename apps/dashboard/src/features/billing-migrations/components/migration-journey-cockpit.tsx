import type { BillingMigrationProgram } from "@/generated/api"

const steps = [
  { key: "connect", label: "Connect source", tab: "overview" },
  { key: "map", label: "Map", tab: "mappings" },
  { key: "import", label: "Import", tab: "imports" },
  { key: "compare", label: "Compare", tab: "compare" },
  { key: "readiness", label: "Readiness", tab: "readiness" },
  { key: "lifecycle", label: "Cutover & operations", tab: "lifecycle" },
] as const

function activeStep(state: BillingMigrationProgram["state"]) {
  if (state === "mapping") return 1
  if (state === "importing") return 2
  if (state === "dry_run") return 3
  if (state === "shadowing") return 4
  if (["ready", "cutover_pending", "stabilizing", "completed", "rolled_back"].includes(state))
    return 5
  return 0
}

export function MigrationJourneyCockpit({
  baseHref,
  program,
}: {
  baseHref: string
  program: BillingMigrationProgram
}) {
  if (program.state === "failed" || program.state === "cancelled") {
    const failed = program.state === "failed"
    return (
      <section
        aria-labelledby="migration-journey-title"
        className="border-destructive/40 rounded border p-4"
      >
        <h2 className="font-semibold" id="migration-journey-title">
          Migration {failed ? "stopped after a failure" : "cancelled"}
        </h2>
        <p className="text-muted-foreground mt-2 text-sm">
          {failed
            ? "The Program did not advance. Its source, mappings, and evidence remain available for inspection. Review the evidence and ask an Organization owner to decide whether to create a new Program."
            : "This Program is read-only and cannot resume. Review its retained evidence, then ask an Organization owner to create a new Program when migration work should restart."}
        </p>
        <a
          className="text-primary mt-3 inline-flex text-sm font-semibold"
          href={`${baseHref}?tab=evidence`}
        >
          Review retained evidence
        </a>
      </section>
    )
  }
  const active = activeStep(program.state)
  const nextCopy = [
    "Confirm the connected source and explicit Application/platform scope.",
    "Create and freeze an exact mapping set.",
    "Import a bounded batch using the frozen mappings.",
    "Run an isolated dry run, then compare the shadow view.",
    "Create an evidence-derived readiness assessment.",
    "Use two-person authority controls, stabilization evidence, rollback, and completion operations.",
  ][active]
  return (
    <section aria-labelledby="migration-journey-title" className="rounded border p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-semibold" id="migration-journey-title">
            Migration journey
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">Next: {nextCopy}</p>
        </div>
        <span className="text-muted-foreground text-xs">
          Program state {program.state.replaceAll("_", " ")}
        </span>
      </div>
      <ol className="mt-4 grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {steps.map((step, index) => (
          <li key={step.key}>
            <a
              aria-current={index === active ? "step" : undefined}
              className={
                index === active
                  ? "border-primary bg-primary/5 block rounded border p-3 text-sm font-semibold"
                  : index < active
                    ? "bg-muted/60 block rounded border p-3 text-sm"
                    : "text-muted-foreground block rounded border p-3 text-sm"
              }
              href={`${baseHref}?tab=${step.tab}`}
            >
              <span className="block text-[11px] uppercase">
                {index < active ? "Complete" : index === active ? "Current" : "Later"}
              </span>
              {step.label}
            </a>
          </li>
        ))}
      </ol>
    </section>
  )
}
