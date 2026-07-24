import { describe, expect, it } from "vitest"

import {
  explicitPurchaseSetupEnvironment,
  purchaseProviderChoices,
  providerCredentialActions,
} from "@/features/provider-connections/types/provider-connection-view"

describe("Purchase setup scope", () => {
  it("does not silently default to Staging or the first Environment", () => {
    const environments = [
      {
        createdAt: "2026-07-24T12:00:00Z",
        id: "env_staging",
        key: "staging",
        mode: "staging",
        name: "Staging",
        projectId: "project_01",
        updatedAt: "2026-07-24T12:00:00Z",
      },
    ] as const

    expect(explicitPurchaseSetupEnvironment(environments)).toBeUndefined()
    expect(explicitPurchaseSetupEnvironment(environments, "missing")).toBeUndefined()
    expect(explicitPurchaseSetupEnvironment(environments, "env_staging")).toBe(environments[0])
  })

  it("offers only the platform-compatible built-in provider without a Connection", () => {
    const environment = {
      createdAt: "2026-07-24T12:00:00Z",
      id: "env_staging",
      key: "staging",
      mode: "staging",
      name: "Staging",
      projectId: "project_01",
      updatedAt: "2026-07-24T12:00:00Z",
    } as const
    const iosChoices = purchaseProviderChoices(
      {
        createdAt: "2026-07-24T12:00:00Z",
        id: "app_ios",
        identifier: "com.example.ios",
        name: "Example iOS",
        platform: "ios",
        projectId: "project_01",
        updatedAt: "2026-07-24T12:00:00Z",
      },
      environment,
      [],
    )
    const androidChoices = purchaseProviderChoices(
      {
        createdAt: "2026-07-24T12:00:00Z",
        id: "app_android",
        identifier: "com.example.android",
        name: "Example Android",
        platform: "android",
        projectId: "project_01",
        updatedAt: "2026-07-24T12:00:00Z",
      },
      environment,
      [],
    )

    expect(iosChoices).toEqual([
      {
        id: "native:app_store",
        kind: "native",
        label: "StoreKit",
        provider: "app_store",
      },
    ])
    expect(androidChoices).toEqual([
      {
        id: "native:google_play",
        kind: "native",
        label: "Google Play Billing",
        provider: "google_play",
      },
    ])
  })
})

describe("provider credential recovery actions", () => {
  it("never offers rotation for revoked connections and exposes reconnect for recoverable health", () => {
    expect(providerCredentialActions({ status: "revoked" }, "revoked")).toEqual({
      reconnect: true,
      rotate: false,
    })
    expect(
      providerCredentialActions(
        { lastErrorCode: "permissionDenied", status: "active" },
        "degraded",
      ),
    ).toEqual({ reconnect: true, rotate: true })
    expect(providerCredentialActions({ status: "active" }, "healthy")).toEqual({
      reconnect: false,
      rotate: true,
    })
  })
})
