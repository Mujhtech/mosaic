import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { CreateMigrationProgramForm } from "@/features/billing-migrations/components/create-migration-program-form"
import { chooseSelectOption } from "@/test/select"
import type { Application, BillingMigrationProgram, Environment } from "@/generated/api"

const application: Application = {
  createdAt: "2026-07-29T00:00:00Z",
  id: "app_ios",
  identifier: "dev.mosaic.app",
  name: "Mosaic iOS",
  platform: "ios",
  projectId: "project_1",
  updatedAt: "2026-07-29T00:00:00Z",
}
const environment: Environment = {
  createdAt: "2026-07-29T00:00:00Z",
  id: "env_1",
  key: "production",
  mode: "production",
  name: "Production",
  projectId: "project_1",
  updatedAt: "2026-07-29T00:00:00Z",
}
const program: BillingMigrationProgram = {
  authorityEpochBefore: 0,
  programId: "program_1",
  rollbackWindowDays: 7,
  scope: {
    applications: [{ applicationId: application.id, platform: "ios" }],
    environmentId: environment.id,
    projectId: "project_1",
  },
  source: { adapter: "revenuecat", adapterVersion: "v2", credentialReference: "credential_1" },
  stabilizationDays: 7,
  state: "mapping",
  stateVersion: 1,
}

async function fillRequiredFields() {
  await chooseSelectOption(screen.getByLabelText("Environment"), environment.name)
  fireEvent.change(screen.getByLabelText("RevenueCat Project ID"), {
    target: { value: "rc_project" },
  })
  fireEvent.change(screen.getByLabelText("RevenueCat migration API key"), {
    target: { value: "rc_secret" },
  })
  fireEvent.click(screen.getByLabelText("Mosaic iOS · ios"))
}

describe("CreateMigrationProgramForm", () => {
  it("clears the secret after success and suppresses a double submission with one command key", async () => {
    let resolve!: (value: BillingMigrationProgram) => void
    const commandKeys: string[] = []
    const onCreate = vi.fn((command: { idempotencyKey: string }) => {
      commandKeys.push(command.idempotencyKey)
      return new Promise<BillingMigrationProgram>((done) => {
        resolve = done
      })
    })
    render(
      <CreateMigrationProgramForm
        applications={[application]}
        environments={[environment]}
        isPending={false}
        onCreate={onCreate}
        onCreated={vi.fn()}
        resetMutation={vi.fn()}
      />,
    )
    await fillRequiredFields()
    fireEvent.click(screen.getByRole("button", { name: "Create and check source" }))
    fireEvent.click(screen.getByRole("button", { name: "Create and check source" }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledOnce())
    expect(commandKeys).toHaveLength(1)
    expect(commandKeys[0]).toBeTruthy()
    resolve(program)
    await waitFor(() =>
      expect(screen.getByLabelText("RevenueCat migration API key")).toHaveValue(""),
    )
  })

  it("clears the secret after failure and renders Mosaic-owned recovery copy", async () => {
    render(
      <CreateMigrationProgramForm
        applications={[application]}
        environments={[environment]}
        isPending={false}
        onCreate={() => Promise.reject(new Error("raw provider stack"))}
        onCreated={vi.fn()}
        resetMutation={vi.fn()}
      />,
    )
    await fillRequiredFields()
    fireEvent.click(screen.getByRole("button", { name: "Create and check source" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Mosaic could not check this source")
    expect(screen.getByRole("alert")).not.toHaveTextContent("raw provider stack")
    expect(screen.getByLabelText("RevenueCat migration API key")).toHaveValue("")
  })
})
