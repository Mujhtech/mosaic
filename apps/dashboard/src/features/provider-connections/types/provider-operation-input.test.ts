import { describe, expect, it } from "vitest"

import { environmentMatchesConnectionMode } from "@/features/provider-connections/types/provider-operation-input"

describe("provider connection mode scopes", () => {
  it("keeps sandbox and production Environment scopes separate", () => {
    expect(environmentMatchesConnectionMode("development", "sandbox")).toBe(true)
    expect(environmentMatchesConnectionMode("staging", "sandbox")).toBe(true)
    expect(environmentMatchesConnectionMode("production", "sandbox")).toBe(false)

    expect(environmentMatchesConnectionMode("production", "production")).toBe(true)
    expect(environmentMatchesConnectionMode("development", "production")).toBe(false)
    expect(environmentMatchesConnectionMode("staging", "production")).toBe(false)
  })
})
