import { describe, expect, it } from "vitest"

import {
  PROVIDER_RECOVERY_ACTIONS,
  providerRecoveryDescriptor,
  providerRecoveryHref,
} from "@/features/catalog/types/provider-recovery"

describe("provider recovery actions", () => {
  it.each(PROVIDER_RECOVERY_ACTIONS)(
    "maps %s to typed copy and one exact Product recovery destination",
    (action) => {
      const descriptor = providerRecoveryDescriptor(action)
      const href = providerRecoveryHref(action, {
        access: "#access-grants-title",
        applications: "/apps",
        lifecycle: "#lifecycle-title",
        mapping: "#provider-mappings-title",
        providers: "/catalog/providers?environmentId=env_01",
      })

      expect(descriptor.label).not.toMatch(/^[a-z]+[A-Z]/)
      expect(descriptor.message.length).toBeGreaterThan(20)
      expect(href).toBe(
        {
          access: "#access-grants-title",
          applications: "/apps",
          lifecycle: "#lifecycle-title",
          mapping: "#provider-mappings-title",
          providers: "/catalog/providers?environmentId=env_01",
        }[descriptor.destination],
      )
    },
  )

  it("keeps native observation recovery distinct from server synchronization", () => {
    expect(providerRecoveryDescriptor("runNativeProviderTest").message).toMatch(
      /test-client observation/i,
    )
    expect(providerRecoveryDescriptor("rerunNativeProviderTest").message).toMatch(
      /test-client observation/i,
    )
    expect(providerRecoveryDescriptor("runNativeProviderTest").message).not.toMatch(/synchroniz/i)
  })
})
