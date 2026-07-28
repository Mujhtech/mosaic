import { WarningIcon } from "@phosphor-icons/react/dist/ssr/Warning"

import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { WorkflowPanel } from "@/features/organizations/components/workspace-page"
import {
  compareReplayAttempts,
  describeReplayConflict,
  selectComparableAttempts,
} from "@/features/billing-ledger/types/replay-comparison"
import type { TransactionFact, ValidationAttempt } from "@/generated/api"

interface ReplayPanelProps {
  attempts: readonly ValidationAttempt[]
  canManage: boolean
  factsByAttemptId: ReadonlyMap<string, TransactionFact>
  isReplaying: boolean
  mappingHistoryHref?: string
  onReplay: () => void
  quarantineHref: string
  replayError?: string
  validatorVersion?: number
}

/**
 * Replay and revalidation.
 *
 * Replay re-runs an accepted input and appends a new Validation Attempt. The
 * result is presented as a comparison of two retained columns, never as a
 * replacement: there is no control here to apply, accept, promote, or discard
 * either side, because doing so would destroy the audit trail that makes the
 * ledger worth keeping.
 */
export function ReplayPanel({
  attempts,
  canManage,
  factsByAttemptId,
  isReplaying,
  mappingHistoryHref,
  onReplay,
  quarantineHref,
  replayError,
  validatorVersion,
}: ReplayPanelProps) {
  const pair = selectComparableAttempts(attempts, factsByAttemptId)
  const comparison = pair ? compareReplayAttempts(pair[0], pair[1]) : undefined

  return (
    <WorkflowPanel
      description="Re-running an input asks the store again and appends a new attempt. Prior attempts and facts are preserved; an unchanged outcome recomputes the same fact and writes nothing."
      title="Replay and revalidation"
    >
      <div className="flex flex-wrap items-center gap-3">
        {canManage ? (
          <Button disabled={isReplaying} onClick={onReplay} type="button">
            {isReplaying ? "Queueing replay…" : "Re-run validation for this input"}
          </Button>
        ) : (
          <p className="text-muted-foreground text-sm">
            Organization owner or admin permission is required to re-run validation.
          </p>
        )}
        <p className="text-muted-foreground text-xs">
          Validator version {validatorVersion ?? "—"} is recorded on every attempt, so a later
          validator change is visible rather than silent.
        </p>
      </div>
      {replayError ? (
        <p className="text-destructive mt-3 text-sm" role="alert">
          {replayError}
        </p>
      ) : null}

      {comparison ? (
        <div className="mt-5">
          {comparison.hasConflict ? (
            <div
              className="border-destructive/30 bg-destructive/5 mb-4 rounded border p-4"
              role="alert"
            >
              <p className="text-destructive flex items-center gap-2 text-sm font-semibold">
                <WarningIcon aria-hidden size={16} />
                The replay contradicts the earlier attempt
              </p>
              <ul className="mt-2 space-y-1 text-sm leading-6">
                {comparison.conflicts.map((conflict) => (
                  <li key={conflict}>{describeReplayConflict(conflict)}</li>
                ))}
              </ul>
              <p className="text-muted-foreground mt-2 text-sm leading-6">
                Both attempts are retained and Mosaic has not overwritten anything. Deciding which
                reflects reality is an operator judgement, usually made from the Product mapping
                history and the quarantine record.
              </p>
              <div className="mt-3 flex flex-wrap gap-3 text-sm font-semibold">
                <a className="text-primary" href={quarantineHref}>
                  Open quarantine
                </a>
                {mappingHistoryHref ? (
                  <a className="text-primary" href={mappingHistoryHref}>
                    Review mapping history
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}

          <Table>
            <TableCaption>
              Both attempts are kept. This comparison is a read of history, not a choice between two
              options.
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Field</TableHead>
                <TableHead scope="col">
                  Earlier attempt {comparison.earlierAttemptNumber ?? ""}
                </TableHead>
                <TableHead scope="col">
                  New attempt {comparison.latestAttemptNumber ?? ""}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {comparison.rows.map((row) => (
                <TableRow key={row.label}>
                  <TableCell className="font-medium">{row.label}</TableCell>
                  <TableCell>{row.earlier}</TableCell>
                  <TableCell>
                    {row.latest}
                    <span className="text-muted-foreground ml-2 text-xs">
                      {row.changed ? "changed" : "unchanged"}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="text-muted-foreground mt-4 text-sm">
          A comparison appears once this input has more than one Validation Attempt.
        </p>
      )}
    </WorkflowPanel>
  )
}
