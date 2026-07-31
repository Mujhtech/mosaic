import { useCallback, useRef, useState } from "react"

import { migrationErrorCopy } from "@/features/billing-migrations/types/migration-operations"
import { ApiError } from "@/lib/api/errors"

type CommandKind = "mapping" | "freeze" | "import" | "run" | "readiness"

export function useMigrationCommand(onStale: () => Promise<unknown>) {
  const inFlight = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const run = useCallback(
    async (action: () => Promise<unknown>, command: CommandKind) => {
      if (inFlight.current) return undefined
      inFlight.current = true
      setError(null)
      try {
        return await action()
      } catch (cause) {
        setError(migrationErrorCopy(cause, command))
        if (cause instanceof ApiError && (cause.status === 403 || cause.status === 409)) {
          await onStale()
        }
        return undefined
      } finally {
        inFlight.current = false
      }
    },
    [onStale],
  )
  return { error, run }
}
