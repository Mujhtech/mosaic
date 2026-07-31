import { WarningIcon } from "@phosphor-icons/react/dist/ssr/Warning";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusPill } from "@/features/billing-ledger/components/billing-chrome";
import {
  formatBillingTimestamp,
  replayComparisonExplanation,
  replayComparisonLabel,
  replayKindLabel,
  runStatusLabel,
} from "@/features/billing-ledger/types/billing-vocabulary";
import {
  compareReplayAttempts,
  describeReplayConflict,
  selectComparableAttempts,
} from "@/features/billing-ledger/types/replay-comparison";
import { WorkflowPanel } from "@/features/orgs/components/workspace-page";
import type {
  ReplayJob,
  TransactionFact,
  ValidationAttempt,
} from "@/generated/api";

interface ReplayPanelProps {
  attempts: readonly ValidationAttempt[];
  canManage: boolean;
  factsByAttemptId: ReadonlyMap<string, TransactionFact>;
  isReplaying: boolean;
  /** Replay jobs that could have touched this input, newest first. */
  jobs: readonly ReplayJob[];
  justQueued: boolean;
  mappingHistoryHref?: string;
  onReplay: () => void;
  quarantineHref: string;
  replayError?: string;
  validatorVersion?: number;
}

const TERMINAL_STATUSES: readonly ReplayJob["status"][] = [
  "completed",
  "failed",
];

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
  jobs,
  justQueued,
  mappingHistoryHref,
  onReplay,
  quarantineHref,
  replayError,
  validatorVersion,
}: ReplayPanelProps) {
  const pair = selectComparableAttempts(attempts, factsByAttemptId);
  const comparison = pair ? compareReplayAttempts(pair[0], pair[1]) : undefined;
  const latestJob = jobs[0];
  const running =
    latestJob !== undefined && !TERMINAL_STATUSES.includes(latestJob.status);

  return (
    <WorkflowPanel
      description="Re-running an input asks the store again and appends a new attempt. Prior attempts and facts are preserved; an unchanged outcome recomputes the same fact and writes nothing."
      title="Replay and revalidation"
    >
      <div className="flex flex-wrap items-center gap-3">
        {canManage ? (
          <Button disabled={isReplaying} onClick={onReplay} type="button">
            {isReplaying
              ? "Queueing replay…"
              : "Re-run validation for this input"}
          </Button>
        ) : (
          <p className="text-muted-foreground text-sm">
            Organization owner or admin permission is required to re-run
            validation.
          </p>
        )}
        <p className="text-muted-foreground text-xs">
          Validator version {validatorVersion ?? "—"} is recorded on every
          attempt, so a later validator change is visible rather than silent.
        </p>
      </div>
      {replayError ? (
        <p className="mt-3 text-destructive text-sm" role="alert">
          {replayError}
        </p>
      ) : null}

      {justQueued && !running ? (
        <p className="mt-3 text-muted-foreground text-sm" role="status">
          The replay was queued. A worker picks it up shortly; this panel
          refreshes on its own once the job reports progress.
        </p>
      ) : null}

      {latestJob ? (
        <ReplayJobStatus
          job={latestJob}
          quarantineHref={quarantineHref}
          running={running}
        />
      ) : null}

      {jobs.length > 1 ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-muted-foreground text-xs">
            Earlier replay jobs ({jobs.length - 1})
          </summary>
          <ul className="mt-2 space-y-1">
            {jobs.slice(1).map((job) => (
              <li className="text-muted-foreground text-xs" key={job.id}>
                {replayKindLabel(job.kind)} · {runStatusLabel(job.status)} ·{" "}
                {replayComparisonLabel(job.comparisonResult)} ·{" "}
                {formatBillingTimestamp(job.completedAt ?? job.createdAt)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {comparison ? (
        <div className="mt-5">
          {comparison.hasConflict ? (
            <div
              className="mb-4 rounded border border-destructive/30 bg-destructive/5 p-4"
              role="alert"
            >
              <p className="flex items-center gap-2 font-semibold text-destructive text-sm">
                <WarningIcon aria-hidden size={16} />
                The replay contradicts the earlier attempt
              </p>
              <ul className="mt-2 space-y-1 text-sm leading-6">
                {comparison.conflicts.map((conflict) => (
                  <li key={conflict}>{describeReplayConflict(conflict)}</li>
                ))}
              </ul>
              <p className="mt-2 text-muted-foreground text-sm leading-6">
                Both attempts are retained and Mosaic has not overwritten
                anything. Deciding which reflects reality is an operator
                judgement, usually made from the Product mapping history and the
                quarantine record.
              </p>
              <div className="mt-3 flex flex-wrap gap-3 font-semibold text-sm">
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
              Both attempts are kept. This comparison is a read of history, not
              a choice between two options.
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
                    <span className="ml-2 text-muted-foreground text-xs">
                      {row.changed ? "changed" : "unchanged"}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="mt-4 text-muted-foreground text-sm">
          A comparison appears once this input has more than one Validation
          Attempt.
        </p>
      )}
    </WorkflowPanel>
  );
}

/**
 * Progress and outcome for the most recent replay job.
 *
 * Modelled on the analytics `JobStatus`: a polite live region that names the
 * state, and on failure names the safe error code and one next step. The
 * counts are the point of a replay — they say whether re-running changed
 * anything, and `conflictCount` says whether it changed something that
 * contradicts what is already recorded.
 */
function ReplayJobStatus({
  job,
  quarantineHref,
  running,
}: {
  job: ReplayJob;
  quarantineHref: string;
  running: boolean;
}) {
  const conflicts = job.conflictCount ?? 0;

  return (
    <section
      aria-live="polite"
      className="mt-4 rounded border bg-muted/30 p-4"
      role="status"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-sm">
          {replayKindLabel(job.kind)} · {runStatusLabel(job.status)}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          {job.status === "completed" ? (
            <StatusPill
              label={replayComparisonLabel(job.comparisonResult)}
              tone={
                job.comparisonResult === "conflicting"
                  ? "negative"
                  : job.comparisonResult === "still_failing"
                    ? "attention"
                    : job.comparisonResult === "new_facts"
                      ? "positive"
                      : "neutral"
              }
            />
          ) : null}
          {conflicts > 0 ? (
            <StatusPill label={`${conflicts} conflict(s)`} tone="negative" />
          ) : null}
        </div>
      </div>

      {running ? (
        <p className="mt-1 text-muted-foreground text-sm leading-6">
          Mosaic is re-running this input against the store. This status
          refreshes automatically and stops polling once the job finishes.
        </p>
      ) : job.status === "failed" ? (
        <>
          <p className="mt-1 text-destructive text-sm" role="alert">
            The replay failed safely with code{" "}
            {job.lastErrorCode ?? "unknown_error"}. No attempt or fact already
            on record was changed.
          </p>
          <p className="mt-1 text-muted-foreground text-sm leading-6">
            Re-running is safe: replay is idempotent, and an unchanged outcome
            recomputes the same fact digest and writes nothing.
          </p>
        </>
      ) : (
        <>
          <p className="mt-1 text-muted-foreground text-sm leading-6">
            {replayComparisonExplanation(job.comparisonResult)}
          </p>
          <dl className="mt-3 grid gap-x-6 gap-y-1 text-muted-foreground text-xs sm:grid-cols-2">
            <Count label="Inputs examined" value={job.examinedCount} />
            <Count label="Unchanged" value={job.unchangedCount} />
            <Count label="New facts appended" value={job.newFactCount} />
            <Count label="Conflicts detected" value={job.conflictCount} />
          </dl>
        </>
      )}

      <p className="mt-3 text-muted-foreground text-xs">
        Validator version {job.validatorVersion ?? "—"} ·{" "}
        {formatBillingTimestamp(job.completedAt ?? job.createdAt)}
      </p>

      {conflicts > 0 ? (
        <a
          className="mt-2 inline-flex font-semibold text-primary text-sm"
          href={quarantineHref}
        >
          Review the quarantine records this opened
        </a>
      ) : null}
    </section>
  );
}

function Count({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="flex justify-between gap-3">
      <dt>{label}</dt>
      <dd className="text-foreground">{value ?? 0}</dd>
    </div>
  );
}
