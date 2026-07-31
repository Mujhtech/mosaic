import { useState } from "react"

import { Button } from "@/components/ui/button"
import type { BillingMigrationMappingSet } from "@/generated/api"

export function FreezeMappingAction({
  isPending,
  mapping,
  onFreeze,
}: {
  isPending: boolean
  mapping: BillingMigrationMappingSet
  onFreeze: (mappingSetId: string) => Promise<unknown>
}) {
  const [confirmed, setConfirmed] = useState(false)
  const confirmation = `${mapping.mappingSetId}:${mapping.version}:${mapping.mappingDigest}`
  return (
    <div className="ml-auto max-w-xl rounded border border-dashed p-3">
      <p className="text-sm font-semibold">Freeze version {mapping.version}</p>
      <p className="text-muted-foreground mt-1 text-xs">
        Impact: mapping set <code>{mapping.mappingSetId}</code> with digest{" "}
        <code className="break-all">{mapping.mappingDigest}</code> becomes immutable and the Program
        advances to Import.
      </p>
      <label className="mt-2 flex items-start gap-2 text-xs">
        <input
          aria-label={`Confirm freeze version ${mapping.version}`}
          checked={confirmed}
          onChange={(event) => setConfirmed(event.currentTarget.checked)}
          type="checkbox"
        />
        I confirm this exact mapping version and digest.
      </label>
      <Button
        className="mt-2"
        data-confirmation={confirmation}
        disabled={!confirmed || isPending}
        onClick={() => void onFreeze(mapping.mappingSetId)}
        size="sm"
        type="button"
        variant="destructive"
      >
        {isPending ? "Freezing…" : `Freeze version ${mapping.version}`}
      </Button>
    </div>
  )
}
