import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ProductReadinessPanel } from "@/features/catalog/components/product-readiness-panel"
import { ProviderMappingsPanel } from "@/features/catalog/components/provider-mappings-panel"
import { ProductPlatformCoverage } from "@/features/catalog/components/product-platform-coverage"
import {
  productReadinessView,
  providerMappingView,
} from "@/features/catalog/types/connected-product-view"
import type {
  Application,
  Environment,
  Product,
  ProviderConnection,
  ProviderProductMapping,
  ProviderReadiness,
} from "@/generated/api"

describe("connected Product panels", () => {
  it("lets Members inspect mapping impact but routes changes to an Owner or Admin", () => {
    render(
      <ProviderMappingsPanel
        canManage={false}
        manageProvidersHref="/catalog/providers"
        membersHref="/organizations/org_01/members"
        mappings={[
          {
            applicationLabel: "Example iOS",
            availability: "unknown",
            connectionLabel: "Built in · no server credentials",
            environmentLabel: "Staging",
            id: "mapping_member",
            platformLabel: "IOS",
            provider: "app_store",
            providerLabel: "StoreKit",
            providerProductIdentifier: "com.example.pro",
            status: "draft",
            syncState: "never_synced",
          },
        ]}
        onArchive={async () => undefined}
        onLoadUsage={() => new Promise(() => undefined)}
        onReplace={async () => undefined}
        productType="subscription"
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Review mapping change" }))

    expect(screen.queryByRole("button", { name: "Replace mapping" })).not.toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Ask an Owner or Admin to change this mapping" }),
    ).toHaveAttribute("href", "/organizations/org_01/members")
  })

  it("uses provider- and Product-type-aware native replacement fields", () => {
    const { rerender } = render(
      <ProviderMappingsPanel
        manageProvidersHref="/catalog/providers"
        mappings={[
          {
            applicationLabel: "Example iOS",
            availability: "unknown",
            connectionLabel: "Built in · no server credentials",
            environmentLabel: "Staging",
            id: "mapping_storekit",
            platformLabel: "IOS",
            provider: "app_store",
            providerLabel: "StoreKit",
            providerProductIdentifier: "com.example.pro",
            status: "draft",
            syncState: "never_synced",
          },
        ]}
        onArchive={async () => undefined}
        onLoadUsage={() => new Promise(() => undefined)}
        onReplace={async () => undefined}
        productType="subscription"
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Review mapping change" }))
    expect(screen.getByLabelText("StoreKit Product ID")).toBeVisible()
    expect(screen.queryByLabelText("Base plan ID")).not.toBeInTheDocument()
    expect(screen.queryByText("Offering lookup key")).not.toBeInTheDocument()

    rerender(
      <ProviderMappingsPanel
        manageProvidersHref="/catalog/providers"
        mappings={[
          {
            applicationLabel: "Example Android",
            availability: "unknown",
            connectionLabel: "Built in · no server credentials",
            environmentLabel: "Staging",
            id: "mapping_google",
            platformLabel: "ANDROID",
            provider: "google_play",
            providerBasePlanIdentifier: "monthly",
            providerLabel: "Google Play Billing",
            providerProductIdentifier: "pro_subscription",
            status: "draft",
            syncState: "never_synced",
          },
        ]}
        onArchive={async () => undefined}
        onLoadUsage={() => new Promise(() => undefined)}
        onReplace={async () => undefined}
        productType="subscription"
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Review mapping change" }))
    expect(screen.getByLabelText("Google Play Product ID")).toBeVisible()
    expect(screen.getByLabelText("Base plan ID")).toBeVisible()
    expect(screen.getByRole("radio", { name: "No offer" })).toBeChecked()
    fireEvent.click(screen.getByRole("radio", { name: "Use a specific offer" }))
    expect(screen.getByLabelText("Offer ID")).toBeVisible()
  })

  it("does not require base-plan or offer fields for a Google non-consumable", () => {
    render(
      <ProviderMappingsPanel
        manageProvidersHref="/catalog/providers"
        mappings={[
          {
            applicationLabel: "Example Android",
            availability: "unknown",
            connectionLabel: "Built in · no server credentials",
            environmentLabel: "Staging",
            id: "mapping_google_once",
            platformLabel: "ANDROID",
            provider: "google_play",
            providerLabel: "Google Play Billing",
            providerProductIdentifier: "pro_lifetime",
            status: "draft",
            syncState: "never_synced",
          },
        ]}
        onArchive={async () => undefined}
        onLoadUsage={() => new Promise(() => undefined)}
        onReplace={async () => undefined}
        productType="one_time_non_consumable"
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Review mapping change" }))
    expect(screen.getByLabelText("Google Play Product ID")).toBeVisible()
    expect(screen.queryByLabelText("Base plan ID")).not.toBeInTheDocument()
    expect(screen.queryByRole("radio", { name: "No offer" })).not.toBeInTheDocument()
  })

  it("keeps mapping replacement disabled until mapping-specific usage loads", () => {
    render(
      <ProviderMappingsPanel
        manageProvidersHref="/catalog/providers"
        mappings={[
          {
            applicationLabel: "Example Android",
            availability: "unknown",
            connectionLabel: "Built in · no server credentials",
            environmentLabel: "Staging",
            id: "mapping_google",
            platformLabel: "ANDROID",
            provider: "google_play",
            providerBasePlanIdentifier: "monthly",
            providerLabel: "Google Play Billing",
            providerProductIdentifier: "pro_subscription",
            status: "draft",
            syncState: "never_synced",
          },
        ]}
        onArchive={async () => undefined}
        onLoadUsage={() => new Promise(() => undefined)}
        onReplace={async () => undefined}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Review mapping change" }))

    expect(screen.getByText(/loading affected Product, Plans, Access grants/i)).toBeVisible()
    expect(screen.getByRole("button", { name: "Replace mapping" })).toBeDisabled()
  })

  it("shows explicit cross-platform coverage without inventing a store mapping", () => {
    const environment = {
      createdAt: "2026-07-22T10:00:00Z",
      id: "env_01",
      key: "staging",
      mode: "staging",
      name: "Staging",
      projectId: "project_01",
      updatedAt: "2026-07-22T10:00:00Z",
    } satisfies Environment
    const iosApplication = {
      createdAt: "2026-07-22T10:00:00Z",
      id: "app_ios",
      identifier: "com.example.ios",
      name: "Example iOS",
      platform: "ios",
      projectId: "project_01",
      updatedAt: "2026-07-22T10:00:00Z",
    } satisfies Application
    const androidApplication = {
      ...iosApplication,
      id: "app_android",
      identifier: "com.example.android",
      name: "Example Android",
      platform: "android",
    } satisfies Application

    render(
      <ProductPlatformCoverage
        connections={[]}
        environment={environment}
        isLoading={false}
        onInspect={() => undefined}
        rows={[{ application: iosApplication }, { application: androidApplication }]}
      />,
    )

    expect(
      screen.getByRole("table", { name: "Product platform coverage for Staging" }),
    ).toBeVisible()
    expect(
      screen.getByRole("row", { name: /Example iOS.*IOS.*Not selected.*Missing/i }),
    ).toBeVisible()
    expect(
      screen.getByRole("row", { name: /Example Android.*ANDROID.*Not selected.*Missing/i }),
    ).toBeVisible()
    expect(screen.getAllByRole("button", { name: "Add mapping" })).toHaveLength(2)
  })

  it("uses only generated mapping state and keeps unavailable metadata read-only", () => {
    const product = {
      createdAt: "2026-07-22T10:00:00Z",
      id: "product_01",
      internalName: "Monthly",
      key: "monthly",
      metadataSource: "provider",
      projectId: "project_01",
      readiness: {
        metadataSource: "provider",
        ready: false,
        reasons: ["Provider synchronization has not completed."],
      },
      status: "attention_required",
      type: "subscription",
      updatedAt: "2026-07-22T10:00:00Z",
    } satisfies Product
    const application = {
      createdAt: "2026-07-22T10:00:00Z",
      id: "app_01",
      identifier: "com.example.ios",
      name: "Example iOS",
      platform: "ios",
      projectId: "project_01",
      updatedAt: "2026-07-22T10:00:00Z",
    } satisfies Application
    const environment = {
      createdAt: "2026-07-22T10:00:00Z",
      id: "env_01",
      key: "staging",
      mode: "staging",
      name: "Staging",
      projectId: "project_01",
      updatedAt: "2026-07-22T10:00:00Z",
    } satisfies Environment
    const connection = {
      applicationIds: [application.id],
      createdAt: "2026-07-22T10:00:00Z",
      environmentIds: [environment.id],
      healthStatus: "untested",
      id: "connection_01",
      integrationMode: "server_connected",
      mode: "sandbox",
      name: "RevenueCat sandbox",
      projectId: "project_01",
      provider: "revenuecat",
      status: "pending",
      updatedAt: "2026-07-22T10:00:00Z",
    } satisfies ProviderConnection
    const mapping = {
      applicationId: application.id,
      availability: "unknown",
      connectionId: connection.id,
      createdAt: "2026-07-22T10:00:00Z",
      environmentId: environment.id,
      id: "mapping_01",
      platform: "ios",
      productId: product.id,
      projectId: "project_01",
      provider: "revenuecat",
      providerProductIdentifier: "rc_monthly",
      status: "draft",
      syncState: "never_synced",
      updatedAt: "2026-07-22T10:00:00Z",
    } satisfies ProviderProductMapping
    const readiness = {
      applicationId: application.id,
      blockers: [
        {
          code: "metadataStale",
          recoveryAction: "syncProviderMetadata",
          resourceId: mapping.id,
          resourceType: "provider_mapping",
        },
      ],
      connectionId: connection.id,
      environmentId: environment.id,
      evaluatedAt: "2026-07-22T10:05:00Z",
      mappingId: mapping.id,
      platform: application.platform,
      productId: product.id,
      state: "attentionRequired",
      warnings: [],
    } satisfies ProviderReadiness

    render(
      <>
        <section id="used-in-title">Used in 2 Paywalls</section>
        <ProductReadinessPanel
          accessHref="#entitlement-grants-title"
          applicationsHref="/apps"
          manageProvidersHref="/providers"
          readiness={productReadinessView(readiness)}
        />
        <ProviderMappingsPanel
          manageProvidersHref="/catalog/providers"
          mappings={[providerMappingView(mapping, [application], [environment], [connection])]}
        />
      </>,
    )

    expect(screen.getByText(/env_01 · app_01 · IOS/)).toBeVisible()
    expect(screen.getByText("Connected-provider catalog metadata is stale.")).toBeVisible()
    expect(screen.getByRole("link", { name: "Refresh provider metadata" })).toHaveAttribute(
      "href",
      "/providers",
    )
    expect(screen.getByText("Never synchronized")).toBeVisible()
    expect(screen.getByText("unknown")).toBeVisible()
    expect(screen.getByText("rc_monthly")).toBeVisible()
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "View usage" })).toHaveAttribute(
      "href",
      "#used-in-title",
    )
  })
})
