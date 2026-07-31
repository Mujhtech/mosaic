import { describe, expect, it } from "vitest"

import {
  dryRunAuthorityNotice,
  isStaleMigrationConflict,
  migrationCommandJourney,
  migrationCompletionBlockers,
  migrationRequiresDistinctApprover,
  migrationRunPollingInterval,
  normalizeMigrationProgramDetail,
} from "@/features/billing-migrations/types/migration-operations"
import type { BillingMigrationProgramDetail } from "@/generated/api"
import { ApiError } from "@/lib/api/errors"

describe("billing migration operational safety", () => {
  const detail = (operatorCapabilities?: unknown) =>
    normalizeMigrationProgramDetail({
      operatorCapabilities,
      program: {
        authorityEpochBefore: 0,
        programId: "migration_1",
        rollbackWindowDays: 7,
        scope: { applications: [], environmentId: "env_1", projectId: "project_1" },
        source: { adapter: "revenuecat", adapterVersion: "v2", credentialReference: "redacted" },
        stabilizationDays: 7,
        state: "mapping",
        stateVersion: 4,
      },
    } as BillingMigrationProgramDetail)

  it("fails closed and uses only server-returned command capabilities", () => {
    expect(detail().commandCapabilities.size).toBe(0)
    expect(detail(["manage-mappings", "unknown", "run-import"]).commandCapabilities).toEqual(
      new Set(["manage-mappings", "run-import"]),
    )
  })

  it("recognizes stale state conflicts so the UI can refetch before retry", () => {
    const stale = new ApiError("conflict", {
      code: "migration_state_conflict",
      correlationId: "request-1",
      retryable: false,
      status: 409,
    })
    expect(isStaleMigrationConflict(stale)).toBe(true)
    expect(isStaleMigrationConflict(new Error("conflict"))).toBe(false)
  })

  it("states that dry and shadow runs confer no billing authority", () => {
    expect(dryRunAuthorityNotice("dry_run")).toContain("does not change billing authority")
    expect(dryRunAuthorityNotice("shadow")).toContain("does not change billing authority")
  })

  it("polls pending jobs and stops after every terminal outcome", () => {
    expect(migrationRunPollingInterval({ status: "pending" })).toBe(4000)
    expect(migrationRunPollingInterval({ status: "completed" })).toBe(false)
    expect(migrationRunPollingInterval({ status: "failed" })).toBe(false)
    expect(migrationRunPollingInterval({ status: "pending" }, 30)).toBe(false)
  })

  it("protects the critical journey by state and server capability", () => {
    expect(migrationCommandJourney("mapping", detail(["manage-mappings"]))).toMatchObject({
      canCreateMapping: true,
      canImport: false,
      canQueueDryRun: false,
    })
    expect(migrationCommandJourney("importing", detail(["run-import"]))).toMatchObject({
      canCreateMapping: false,
      canImport: true,
      canQueueDryRun: true,
    })
    expect(migrationCommandJourney("shadowing", detail([])).canAssess).toBe(false)
    expect(migrationCommandJourney("shadowing", detail(["assess-readiness"])).canAssess).toBe(true)
  })

  it("keeps production authority and retention commands two-person", () => {
    expect(migrationRequiresDistinctApprover("cutover")).toBe(true)
    expect(migrationRequiresDistinctApprover("rollback")).toBe(true)
    expect(migrationRequiresDistinctApprover("legal_hold")).toBe(true)
  })

  it("fails completion closed and exposes server blockers", () => {
    expect(migrationCompletionBlockers(undefined)).toEqual(["Completion evidence is unavailable."])
    const prerequisites = {
      authorityDigest: `sha256:${"a".repeat(64)}`,
      authorityStable: false,
      credentialRemoved: false,
      eligible: false,
      policyDigest: `sha256:${"b".repeat(64)}`,
      programId: "program_one",
      rollbackWindowEndsAt: "2020-01-01T00:00:00Z",
      stabilizationEndsAt: "2020-01-01T00:00:00Z",
      stabilityEvidenceDigest: `sha256:${"c".repeat(64)}`,
      state: "stabilizing",
      stateVersion: 7,
      unresolvedCriticalBlocking: 2,
      webhookReady: false,
    }
    expect(migrationCompletionBlockers(prerequisites)).toEqual([
      "migration credential is still active",
      "2 critical or blocking cases remain",
      "authority is not stable",
      "webhook delivery is not ready",
    ])
    expect(
      migrationCompletionBlockers({
        ...prerequisites,
        authorityStable: true,
        credentialRemoved: true,
        eligible: true,
        unresolvedCriticalBlocking: 0,
        webhookReady: true,
      }),
    ).toEqual([])
  })
})
