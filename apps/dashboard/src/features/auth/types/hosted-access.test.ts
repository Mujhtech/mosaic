import { describe, expect, it } from "vitest"

import { validatePassword } from "@/features/auth/types/credential-validation"
import { safeInternalReturnTo } from "@/features/auth/types/hosted-access"

describe("hosted authentication return paths", () => {
  it("preserves internal Studio routes and rejects external redirects", () => {
    const studio = "/studio-hosted/org/project/env/paywall/draft?panel=products#binding"

    expect(safeInternalReturnTo(studio)).toBe(studio)
    expect(safeInternalReturnTo("https://attacker.example/steal")).toBe("/workspace")
    expect(safeInternalReturnTo("//attacker.example/steal")).toBe("/workspace")
    expect(safeInternalReturnTo("/\\attacker.example/steal")).toBe("/workspace")
  })

  it("matches the API signup password minimum without blocking existing longer login credentials", () => {
    expect(validatePassword("elevenchars", true)).toBe("Use at least 12 characters.")
    expect(validatePassword("twelve-chars", true)).toBeUndefined()
    expect(validatePassword("short", false)).toBeUndefined()
    expect(validatePassword("", false)).toBe("Enter your password.")
  })
})
