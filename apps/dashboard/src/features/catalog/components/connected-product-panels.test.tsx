import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ProductReadinessPanel } from "@/features/catalog/components/product-readiness-panel"
import { ProviderMappingsPanel } from "@/features/catalog/components/provider-mappings-panel"
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
    expect(screen.getByText("Connected Product details need to be synchronized.")).toBeVisible()
    expect(screen.getByRole("link", { name: "Synchronize Product details" })).toHaveAttribute(
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
