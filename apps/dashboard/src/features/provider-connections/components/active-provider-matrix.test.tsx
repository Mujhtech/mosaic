import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ActiveProviderMatrix } from "@/features/provider-connections/components/active-provider-matrix"
import { ProviderConnectionsList } from "@/features/provider-connections/components/provider-connections-list"
import { providerConnectionKeys } from "@/features/provider-connections/queries/provider-connection-queries"
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
  activationKind: "provider_connection",
  applicationId: application.id,
  connectionId: connection.id,
  createdAt: "2026-07-23T12:00:00Z",
  createdByActorId: "actor_01",
  environmentId: environment.id,
  platform: "ios",
  provider: "revenuecat",
  productionConnectionUseAcknowledged: false,
  projectId: "project_01",
  updatedAt: "2026-07-23T12:00:00Z",
}

describe("ActiveProviderMatrix", () => {
  it("lets Members review impact and directs them to an Owner or Admin instead of mutating", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY } },
    })
    queryClient.setQueryData(
      providerConnectionKeys.replacementImpact(
        environment.projectId,
        connection.id,
        environment.id,
        application.id,
        "revenuecat",
        connection.id,
      ),
      { paywalls: [], products: [] },
    )

    render(
      <QueryClientProvider client={queryClient}>
        <ActiveProviderMatrix
          applications={[application]}
          assignments={[assignment]}
          canManage={false}
          connections={[connection]}
          environment={environment}
          managementEnabled
          membersHref="/orgs/org_01/members"
          organizationId="org_01"
          projectId={environment.projectId}
        />
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole("button", { name: "Clear provider" }))

    expect(screen.getByText("0 affected Products · 0 active Paywalls")).toBeVisible()
    expect(screen.queryByRole("button", { name: "Confirm clear" })).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Ask an Owner or Admin" })).toHaveAttribute(
      "href",
      "/orgs/org_01/members",
    )
  })

  it("offers a direct Register Application action when setup has no Applications", () => {
    render(
      <ActiveProviderMatrix
        applications={[]}
        applicationsHref="/orgs/org_01/projects/project_01/apps"
        assignments={[]}
        connections={[]}
        environment={environment}
      />,
    )

    expect(screen.getByRole("link", { name: "Register Application" })).toHaveAttribute(
      "href",
      "/orgs/org_01/projects/project_01/apps",
    )
  })

  it("renders StoreKit as a credential-free native assignment", () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(providerConnectionKeys.nativeProfile("app_store", "ios"), {
      adapterVersion: "2.0",
      capabilities: [
        { name: "purchase", support: "supported" },
        {
          name: "deferredPurchaseOutcome",
          reasonCode: "notExposedByTypedApi",
          support: "unsupported",
        },
      ],
      displayName: "StoreKit",
      platform: "ios",
      provider: "app_store",
    })

    render(
      <QueryClientProvider client={queryClient}>
        <ActiveProviderMatrix
          applications={[application]}
          assignments={[
            {
              ...assignment,
              activationKind: "native_store",
              connectionId: undefined,
              provider: "app_store",
            },
          ]}
          connections={[]}
          environment={environment}
        />
      </QueryClientProvider>,
    )

    expect(screen.getByText("StoreKit")).toBeVisible()
    expect(screen.getByText(/Built in · no server credentials · adapter 2.0/)).toBeVisible()
    expect(screen.getByText("1 conditional or unsupported capability")).toBeVisible()
  })

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
        organizationId="organization_01"
        projectId="project_01"
      />,
    )

    expect(screen.getByText("Custom provider · SDK-only · sandbox")).toBeVisible()
    expect(screen.getByText("Never synchronized")).toBeVisible()
    expect(screen.getByText(/host app supplies this custom provider at runtime/i)).toBeVisible()
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
  })

  it("gates clearing behind the affected Product and active Paywall impact review", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY } },
    })
    queryClient.setQueryData(
      providerConnectionKeys.replacementImpact(
        environment.projectId,
        connection.id,
        environment.id,
        application.id,
        "revenuecat",
        connection.id,
      ),
      {
        paywalls: [
          {
            createdAt: "2026-07-23T12:00:00Z",
            createdByActorId: "actor_01",
            id: "paywall_01",
            key: "upgrade",
            name: "Upgrade",
            projectId: environment.projectId,
            status: "active",
            updatedAt: "2026-07-23T12:00:00Z",
          },
        ],
        products: [
          {
            createdAt: "2026-07-23T12:00:00Z",
            id: "product_01",
            internalName: "Monthly Pro",
            key: "monthly_pro",
            metadataSource: "provider",
            projectId: environment.projectId,
            readiness: "connected",
            status: "active",
            type: "subscription",
            updatedAt: "2026-07-23T12:00:00Z",
          },
        ],
      },
    )

    render(
      <QueryClientProvider client={queryClient}>
        <ActiveProviderMatrix
          applications={[application]}
          assignments={[assignment]}
          connections={[connection]}
          environment={environment}
          managementEnabled
          organizationId="organization_01"
          projectId={environment.projectId}
        />
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole("button", { name: "Clear provider" }))

    expect(screen.getByText("1 affected Product · 1 active Paywall")).toBeVisible()
    expect(screen.getByText("Products: Monthly Pro")).toBeVisible()
    expect(screen.getByText("Paywalls: Upgrade")).toBeVisible()
    expect(screen.getByRole("link", { name: "Review affected Products" })).toHaveAttribute(
      "href",
      "/orgs/organization_01/projects/project_01/catalog/products",
    )
    expect(
      screen.getByText(/new publishing will fail readiness and SDK configuration cannot resolve/i),
    ).toBeVisible()
    expect(screen.getByRole("button", { name: "Confirm clear" })).toBeEnabled()
  })
})
