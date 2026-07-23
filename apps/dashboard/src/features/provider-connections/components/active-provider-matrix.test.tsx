import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ActiveProviderMatrix } from "@/features/provider-connections/components/active-provider-matrix"
import { ProviderConnectionsList } from "@/features/provider-connections/components/provider-connections-list"
import type {
  ActiveProviderAssignment,
  Application,
  Environment,
  ProviderConnection,
} from "@/generated/api"

const application: Application = {
  createdAt: "2026-07-23T12:00:00Z",
  id: "app_ios",
  identifier: "com.example.ios",
  name: "Example iOS",
  platform: "ios",
  projectId: "project_01",
  updatedAt: "2026-07-23T12:00:00Z",
}

const environment: Environment = {
  createdAt: "2026-07-23T12:00:00Z",
  id: "env_staging",
  key: "staging",
  mode: "staging",
  name: "Staging",
  projectId: "project_01",
  updatedAt: "2026-07-23T12:00:00Z",
}

const connection: ProviderConnection = {
  applicationIds: [application.id],
  createdAt: "2026-07-23T12:00:00Z",
  environmentIds: [environment.id],
  healthStatus: "healthy",
  id: "connection_revenuecat",
  integrationMode: "server_connected",
  mode: "sandbox",
  name: "RevenueCat sandbox",
  projectId: "project_01",
  provider: "revenuecat",
  status: "active",
  updatedAt: "2026-07-23T12:00:00Z",
}

const assignment: ActiveProviderAssignment = {
  applicationId: application.id,
  connectionId: connection.id,
  createdAt: "2026-07-23T12:00:00Z",
  createdByActorId: "actor_01",
  environmentId: environment.id,
  platform: "ios",
  productionConnectionUseAcknowledged: false,
  projectId: "project_01",
  updatedAt: "2026-07-23T12:00:00Z",
}

describe("ActiveProviderMatrix", () => {
  it("renders a persisted assignment with explicit Environment, Application, and platform", () => {
    render(
      <ActiveProviderMatrix
        applications={[application]}
        assignments={[assignment]}
        connections={[connection]}
        environment={environment}
      />,
    )

    expect(
      screen.getByRole("table", {
        name: "Active commerce provider assignments for Staging",
      }),
    ).toBeVisible()
    expect(screen.getByRole("row", { name: /Example iOS.*IOS.*RevenueCat sandbox/i })).toBeVisible()
    expect(screen.getByText("active · healthy")).toBeVisible()
    expect(screen.getByRole("button", { name: "Review replacement" })).toBeDisabled()
  })

  it("describes persisted custom SDK-only metadata without implying hosted authorization", () => {
    render(
      <ProviderConnectionsList
        connections={[
          {
            ...connection,
            healthStatus: "untested",
            id: "connection_custom",
            integrationMode: "sdk_only",
            lastSuccessfulSyncAt: undefined,
            name: "Host commerce",
            provider: "custom",
            status: "pending",
          },
        ]}
      />,
    )

    expect(screen.getByText("Custom provider · SDK-only · sandbox")).toBeVisible()
    expect(screen.getByText("Never synchronized")).toBeVisible()
    expect(screen.getByText(/host app supplies this custom provider at runtime/i)).toBeVisible()
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
  })
})
