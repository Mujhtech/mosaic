import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { FreezeMappingAction } from "@/features/billing-migrations/components/freeze-mapping-action"
import type { BillingMigrationMappingSet } from "@/generated/api"

function mapping(id: string, version: number, digest: string): BillingMigrationMappingSet {
  return {
    entries: [],
    mappingDigest: digest,
    mappingSetId: id,
    programId: "program_1",
    stateVersion: 1,
    status: "draft",
    version,
  }
}

describe("FreezeMappingAction", () => {
  it("binds confirmation to the exact selected mapping ID, version, and digest", () => {
    const onFreeze = vi.fn().mockResolvedValue(undefined)
    render(
      <>
        {[mapping("mapping_1", 1, "sha256:one"), mapping("mapping_2", 2, "sha256:two")].map(
          (item) => (
            <FreezeMappingAction
              isPending={false}
              key={item.mappingSetId}
              mapping={item}
              onFreeze={onFreeze}
            />
          ),
        )}
      </>,
    )
    expect(screen.getByRole("button", { name: "Freeze version 1" })).toBeDisabled()
    fireEvent.click(screen.getByLabelText("Confirm freeze version 2"))
    const button = screen.getByRole("button", { name: "Freeze version 2" })
    expect(button).toHaveAttribute("data-confirmation", "mapping_2:2:sha256:two")
    fireEvent.click(button)
    expect(onFreeze).toHaveBeenCalledOnce()
    expect(onFreeze).toHaveBeenCalledWith("mapping_2")
  })
})
