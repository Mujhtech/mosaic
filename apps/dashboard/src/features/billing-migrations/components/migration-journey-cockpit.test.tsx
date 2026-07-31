import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { MigrationJourneyCockpit } from "@/features/billing-migrations/components/migration-journey-cockpit"
import type { BillingMigrationProgram } from "@/generated/api"

function terminalProgram(state: "failed" | "cancelled"): BillingMigrationProgram {
  return {
    authorityEpochBefore: 0,
    programId: `program_${state}`,
    rollbackWindowDays: 7,
    scope: {
      applications: [{ applicationId: "app_1", platform: "ios" }],
      environmentId: "env_1",
      projectId: "project_1",
    },
    source: {
      adapter: "revenuecat",
      adapterVersion: "v2",
      credentialReference: "credential_1",
    },
    stabilizationDays: 7,
    state,
    stateVersion: 4,
  }
}

describe("MigrationJourneyCockpit terminal recovery", () => {
  it("shows failed recovery without falling back to Connect source", () => {
    render(
      <MigrationJourneyCockpit
        baseHref="/migrations/program_failed"
        program={terminalProgram("failed")}
      />,
    )
    expect(
      screen.getByRole("heading", { name: "Migration stopped after a failure" }),
    ).toBeInTheDocument()
    expect(screen.getByText(/evidence remain available/)).toBeInTheDocument()
    expect(screen.queryByText("Connect source")).not.toBeInTheDocument()
  })

  it("shows cancelled recovery without implying the Program can resume", () => {
    render(
      <MigrationJourneyCockpit
        baseHref="/migrations/program_cancelled"
        program={terminalProgram("cancelled")}
      />,
    )
    expect(screen.getByRole("heading", { name: "Migration cancelled" })).toBeInTheDocument()
    expect(screen.getByText(/read-only and cannot resume/)).toBeInTheDocument()
    expect(screen.queryByText("Connect source")).not.toBeInTheDocument()
  })
})
