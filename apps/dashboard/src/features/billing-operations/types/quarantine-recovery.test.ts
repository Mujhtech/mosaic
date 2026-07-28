import { describe, expect, it } from "vitest"

import {
  QUARANTINE_RECOVERY_ACTION_KINDS,
  quarantineRecoveryActions,
} from "@/features/billing-operations/types/quarantine-recovery"
import type { QuarantineRecord } from "@/generated/api"

/**
 * Risk: a future edit adds a "mark as valid", "force resolve", or "accept
 * anyway" path, which would record a validated Transaction Fact from an
 * operator's judgement rather than a store round-trip. That is the single
 * data-integrity rule Phase 9A is built around, and this module is the only
 * place the offered action set is derived.
 */

const REASON_CODES = [
  "application_mismatch",
  "credential_revoked",
  "credential_unavailable",
  "cross_environment_mismatch",
  "environment_mismatch",
  "input_content_conflict",
  "malformed_reference",
  "missing_validation_credential",
  "product_ambiguous",
  "product_unknown",
  "provider_permanently_failed",
  "replay_conflict",
  "signature_invalid",
  "store_environment_mismatch",
  "unsupported_product_type",
  "unsupported_transaction_type",
  "validation_exhausted",
] as const satisfies readonly NonNullable<QuarantineRecord["reasonCode"]>[]

const STATUSES = [
  "open",
  "retrying",
  "closed_after_success",
  "closed_superseded",
] as const satisfies readonly NonNullable<QuarantineRecord["status"]>[]

/** Wording that would signal an operator declaring an input authentic. */
const ASSERTION_LANGUAGE = /mark|accept|force|ignore|override|approve|declare|trust/i

const every = REASON_CODES.flatMap((reasonCode) =>
  STATUSES.map((status) => ({ reasonCode, status })),
)

describe("quarantine recovery actions", () => {
  it("offers no action that asserts an input is valid", () => {
    for (const record of every) {
      for (const action of quarantineRecoveryActions(record)) {
        expect(QUARANTINE_RECOVERY_ACTION_KINDS).toContain(action.kind)
        expect(action.kind).not.toMatch(ASSERTION_LANGUAGE)
        expect(action.label).not.toMatch(ASSERTION_LANGUAGE)
      }
    }
  })

  it("routes every mutating action through one of the two audited operations", () => {
    for (const record of every) {
      for (const action of quarantineRecoveryActions(record)) {
        if (action.operation === undefined) continue
        expect(["closeQuarantineRecordSuperseded", "retryQuarantinedInput"]).toContain(
          action.operation,
        )
      }
    }
  })

  it("makes asking the store again the only path that can produce a fact", () => {
    const storeActions = every
      .flatMap((record) => quarantineRecoveryActions(record))
      .filter((action) => action.consultsStore)

    expect(storeActions.length).toBeGreaterThan(0)
    for (const action of storeActions) {
      expect(action.kind).toBe("retry_provider_validation")
      expect(action.operation).toBe("retryQuarantinedInput")
    }
  })

  it("offers nothing on a closed record, so a closure cannot be reversed by assertion", () => {
    for (const reasonCode of REASON_CODES) {
      expect(quarantineRecoveryActions({ reasonCode, status: "closed_after_success" })).toEqual([])
      expect(quarantineRecoveryActions({ reasonCode, status: "closed_superseded" })).toEqual([])
    }
  })

  it("still offers a store round-trip for the reasons an operator can actually repair", () => {
    const kinds = quarantineRecoveryActions({
      reasonCode: "product_unknown",
      status: "open",
    }).map((action) => action.kind)

    expect(kinds).toContain("repair_product_mapping")
    expect(kinds).toContain("retry_provider_validation")
  })
})
