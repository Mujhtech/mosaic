import { RequestIdCopy } from "@/features/auth/components/hosted-resource-boundary"
import { StatusPill } from "@/features/billing-ledger/components/billing-chrome"
import {
  formatBillingTimestamp,
  storeEnvironmentLabel,
  validationOutcomeLabel,
} from "@/features/billing-ledger/types/billing-vocabulary"
import { WorkflowPanel } from "@/features/organizations/components/workspace-page"
import type { ValidationAttempt } from "@/generated/api"

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
export function ValidationAttemptsPanel({ attempts }: { attempts: readonly ValidationAttempt[] }) {
  const ordered = [...attempts].sort((a, b) => (b.attemptNumber ?? 0) - (a.attemptNumber ?? 0))
  const latest = ordered[0]?.attemptNumber

  return (
    <WorkflowPanel
      description="One record per validation try. Earlier attempts are never overwritten, and a superseded attempt stays visible."
      title={`Validation attempts (${ordered.length})`}
    >
      {ordered.length === 0 ? (
        <p className="text-sm">
          No Validation Attempt is recorded against this input yet. An attempt appears as soon as
          the validation worker picks it up.
        </p>
      ) : (
        <ol className="space-y-3">
          {ordered.map((attempt) => {
            const superseded =
              typeof latest === "number" &&
              typeof attempt.attemptNumber === "number" &&
              attempt.attemptNumber < latest
            return (
              <li className="rounded border p-4" key={attempt.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">Attempt {attempt.attemptNumber ?? "—"}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill
                      label={validationOutcomeLabel(attempt.outcome)}
                      tone={
                        attempt.outcome === "validated"
                          ? "positive"
                          : attempt.outcome === "retryable_failure"
                            ? "attention"
                            : attempt.outcome === "recorded_no_fact"
                              ? "neutral"
                              : "negative"
                      }
                    />
                    {superseded ? (
                      <StatusPill label={`Superseded by attempt ${latest}`} tone="neutral" />
                    ) : null}
                  </div>
                </div>
                <dl className="text-muted-foreground mt-3 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                  <Row label="Started" value={formatBillingTimestamp(attempt.startedAt)} />
                  <Row label="Completed" value={formatBillingTimestamp(attempt.completedAt)} />
                  <Row
                    label="Store Environment"
                    value={storeEnvironmentLabel(attempt.storeEnvironment)}
                  />
                  <Row label="Validator version" value={String(attempt.validatorVersion ?? "—")} />
                  <Row
                    label="Latency"
                    value={attempt.latencyMs === undefined ? "—" : `${attempt.latencyMs} ms`}
                  />
                  <Row label="Credential" value={attempt.credentialId ?? "—"} />
                  {attempt.replayOfAttemptId ? (
                    <Row label="Replay of attempt" value={attempt.replayOfAttemptId} />
                  ) : null}
                </dl>
                {attempt.outcome && attempt.outcome !== "validated" ? (
                  <div className="bg-muted/40 mt-3 rounded border p-3 text-xs">
                    <p className="font-medium">
                      {attempt.diagnosticCode ?? "unclassified_failure"}
                      {attempt.failureCategory ? ` · ${attempt.failureCategory}` : ""}
                    </p>
                    <p className="text-muted-foreground mt-1 leading-5">
                      {attempt.retryable
                        ? "Mosaic will try again with backoff. Each retry appends a new attempt; this one stays as it is."
                        : "This category never succeeds by retrying unchanged. Correct the underlying condition, then re-run validation from the quarantine record."}
                    </p>
                    {attempt.providerCode || attempt.providerHttpStatus ? (
                      <p className="text-muted-foreground mt-1">
                        Store code {attempt.providerCode ?? "—"}
                        {attempt.providerHttpStatus ? ` · HTTP ${attempt.providerHttpStatus}` : ""}
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
            )
          })}
        </ol>
      )}
    </WorkflowPanel>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt>{label}</dt>
      <dd className="text-foreground text-right break-all">{value}</dd>
    </div>
  )
}
