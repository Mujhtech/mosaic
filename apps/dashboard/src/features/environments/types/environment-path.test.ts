import { describe, expect, it } from "vitest"

import { switchEnvironmentPath } from "@/features/environments/types/environment-path"

const base = "/orgs/org_01/projects/prj_01"

describe("switchEnvironmentPath", () => {
  it("keeps the operator on the same surface", () => {
    const cases: [string, string][] = [
      [`${base}/monetization/env_dev/paywalls`, `${base}/monetization/env_prod/paywalls`],
      [
        `${base}/monetization/env_dev/experiments/exp_01`,
        `${base}/monetization/env_prod/experiments/exp_01`,
      ],
      [`${base}/analytics/env_dev/funnel`, `${base}/analytics/env_prod/funnel`],
      [`${base}/billing/env_dev/customers/cus_01`, `${base}/billing/env_prod/customers/cus_01`],
    ]

    for (const [pathname, expected] of cases) {
      expect(switchEnvironmentPath(pathname, "env_dev", "env_prod")).toBe(expected)
    }
  })

  it("rewrites the addressed form by alias", () => {
    const addressed = "/orgs/org_01/projects/prj_01/env"

    expect(switchEnvironmentPath(`${addressed}/dev/catalog/products`, "dev", "prod")).toBe(
      `${addressed}/prod/catalog/products`,
    )
    expect(
      switchEnvironmentPath(`${addressed}/prod/billing/quarantine/rec_01`, "prod", "dev"),
    ).toBe(`${addressed}/dev/billing/quarantine/rec_01`)
    // The alias, not the id, is what the address carries, so an id must not match.
    expect(switchEnvironmentPath(`${addressed}/prod/apps`, "env_03", "env_01")).toBeNull()
  })

  it("reports nothing to switch on a surface with no Environment", () => {
    for (const pathname of [base, `${base}/apps`, `${base}/catalog/products`, "/workspace"]) {
      expect(switchEnvironmentPath(pathname, "env_dev", "env_prod")).toBeNull()
    }
  })

  it("does not mistake a literal segment for an Environment", () => {
    // Anchoring on position alone would rewrite "connections" and "migrations",
    // producing a route that does not exist.
    for (const pathname of [
      `${base}/billing/connections/cred_01`,
      `${base}/billing/migrations/prog_01`,
    ]) {
      expect(switchEnvironmentPath(pathname, "env_dev", "env_prod")).toBeNull()
    }
  })

  it("rewrites only the Environment, even when another segment repeats its id", () => {
    expect(
      switchEnvironmentPath(`${base}/billing/env_dev/subscriptions/env_dev`, "env_dev", "env_prod"),
    ).toBe(`${base}/billing/env_prod/subscriptions/env_dev`)
  })

  it("refuses an empty Environment id rather than building a path with an empty segment", () => {
    expect(switchEnvironmentPath(`${base}/analytics/env_dev/funnel`, "env_dev", "")).toBeNull()
    expect(switchEnvironmentPath(`${base}/analytics//funnel`, "", "env_prod")).toBeNull()
  })
})
