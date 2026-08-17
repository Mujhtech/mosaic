import { RequestIdCopy } from "@/features/auth/components/hosted-resource-boundary";
import { StatusPill } from "@/features/billing-ledger/components/billing-chrome";
import {
  formatBillingTimestamp,
  storeEnvironmentLabel,
  validationOutcomeLabel,
} from "@/features/billing-ledger/types/billing-vocabulary";
import { compareAttemptNumberDescending } from "@/features/billing-ledger/types/replay-comparison";
import { WorkflowPanel } from "@/features/orgs/components/workspace-page";
import type { ValidationAttempt } from "@/generated/api";

/**
 * Validation Attempts, newest first.
 *
 * Every try is here, including the ones that failed and the ones a later replay
 * superseded. Nothing is hidden, collapsed away, or removed: the value of an
 * append-only attempt history is precisely that the earlier answer is still
 * readable after the later one arrives.
 *
 * Failed attempts show Mosaic's own diagnostic code and a bounded store code.
 * A store response body is never stored and so is never rendered.
 */
export function ValidationAttemptsPanel({
  attempts,
}: {
  attempts: readonly ValidationAttempt[];
}) {
  // Newest first, with unnumbered attempts last rather than first: a missing
  // attempt number treated as 0 put those records at the top of a
  // newest-first list, where `latest` is read from — which then marked every
  // real attempt as "superseded" by an attempt that has no position at all.
  const ordered = attempts.toSorted(compareAttemptNumberDescending);
  const latest = ordered.find(
    (attempt) => typeof attempt.attemptNumber === "number"
  )?.attemptNumber;

  return (
    <WorkflowPanel
      description="One record per validation try. Earlier attempts are never overwritten, and a superseded attempt stays visible."
      title={`Validation attempts (${ordered.length})`}
    >
      {ordered.length === 0 ? (
        <p className="text-sm">
          No Validation Attempt is recorded against this input yet. An attempt
          appears as soon as the validation worker picks it up.
        </p>
      ) : (
        <ol className="space-y-3">
          {ordered.map((attempt) => {
            const superseded =
              typeof latest === "number" &&
              typeof attempt.attemptNumber === "number" &&
              attempt.attemptNumber < latest;
            return (
              <li className="rounded border p-4" key={attempt.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-sm">
                    Attempt {attempt.attemptNumber ?? "—"}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill
                      label={validationOutcomeLabel(attempt.outcome)}
                      tone={(() => {
                        if (attempt.outcome === "validated") {
                          return "positive";
                        }
                        if (attempt.outcome === "retryable_failure") {
                          return "attention";
                        }
                        if (attempt.outcome === "recorded_no_fact") {
                          return "neutral";
                        }
                        return "negative";
                      })()}
                    />
                    {superseded ? (
                      <StatusPill
                        label={`Superseded by attempt ${latest}`}
                        tone="neutral"
                      />
                    ) : null}
                  </div>
                </div>
                <dl className="mt-3 grid gap-x-6 gap-y-1 text-muted-foreground text-xs sm:grid-cols-2">
                  <Row
                    label="Started"
                    value={formatBillingTimestamp(attempt.startedAt)}
                  />
                  <Row
                    label="Completed"
                    value={formatBillingTimestamp(attempt.completedAt)}
                  />
                  <Row
                    label="Store Environment"
                    value={storeEnvironmentLabel(attempt.storeEnvironment)}
                  />
                  <Row
                    label="Validator version"
                    value={String(attempt.validatorVersion ?? "—")}
                  />
                  <Row
                    label="Latency"
                    value={
                      attempt.latencyMs === undefined
                        ? "—"
                        : `${attempt.latencyMs} ms`
                    }
                  />
                  <Row label="Credential" value={attempt.credentialId ?? "—"} />
                  {attempt.replayOfAttemptId ? (
                    <Row
                      label="Replay of attempt"
                      value={attempt.replayOfAttemptId}
                    />
                  ) : null}
                </dl>
                {attempt.outcome && attempt.outcome !== "validated" ? (
                  <div className="mt-3 rounded border bg-muted/40 p-3 text-xs">
                    <p className="font-medium">
                      {attempt.diagnosticCode ?? "unclassified_failure"}
                      {attempt.failureCategory
                        ? ` · ${attempt.failureCategory}`
                        : ""}
                    </p>
                    <p className="mt-1 text-muted-foreground leading-5">
                      {attempt.retryable
                        ? "Mosaic will try again with backoff. Each retry appends a new attempt; this one stays as it is."
                        : "This category never succeeds by retrying unchanged. Correct the underlying condition, then re-run validation from the quarantine record."}
                    </p>
                    {attempt.providerCode || attempt.providerHttpStatus ? (
                      <p className="mt-1 text-muted-foreground">
                        Store code {attempt.providerCode ?? "—"}
                        {attempt.providerHttpStatus
                          ? ` · HTTP ${attempt.providerHttpStatus}`
                          : ""}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {attempt.correlationId ? (
                  <div className="mt-3">
                    <RequestIdCopy requestId={attempt.correlationId} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </WorkflowPanel>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt>{label}</dt>
      <dd className="break-all text-right text-foreground">{value}</dd>
    </div>
  );
}
