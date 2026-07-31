import { describe, expect, it } from "vitest"

import { organizationAccessFor } from "@/hooks/use-organization-access"
import type { Membership } from "@/generated/api"

const membership = (role: Membership["role"]): Membership => ({
  actorId: `actor_${role}`,
  createdAt: "2026-07-24T12:00:00Z",
  organizationId: "org_01",
  role,
  updatedAt: "2026-07-24T12:00:00Z",
})

describe("organization access", () => {
  it.each([
    ["owner", true],
    ["admin", true],
    ["member", false],
  ] as const)("exposes %s Purchase setup access", (role, canManage) => {
    expect(
      organizationAccessFor(`actor_${role}`, [
        membership("owner"),
        membership("admin"),
        membership("member"),
      ]),
    ).toMatchObject({ canManage, role })
  })
})
