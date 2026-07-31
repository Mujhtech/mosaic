import { describe, expect, it } from "vitest"

import { providerCredentialActions } from "@/features/provider-connections/types/provider-connection-view"

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
