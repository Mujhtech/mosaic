import { DefinitionRow } from "@/features/billing-ledger/components/billing-chrome"
import {
  formatBillingTimestamp,
  ledgerEntryTypeLabel,
} from "@/features/billing-ledger/types/billing-vocabulary"
import { WorkflowPanel } from "@/features/organizations/components/workspace-page"
import type { BillingLedgerEntry, TransactionFact } from "@/generated/api"

/**
 * The source Raw Billing Input, described through the append-only Billing Event
 * Ledger.
 *
 * The stored body — a signed Apple payload or a Google purchase token — is
 * sealed under the Mosaic keyring and is deliberately not exposed by any REST
 * read. Rendering it would put store bearer material in a browser, which is the
 * one thing the redaction rules exist to prevent. What this panel shows instead
 * is the identity and the ledger trail: enough to correlate the input with a
 * server-side investigation, and nothing that could be replayed against a
 * store.
 */
export function RawInputPanel({
  entries,
  fact,
}: {
  entries: readonly BillingLedgerEntry[]
  fact: TransactionFact
}) {
  const related = entries
    .filter(
      (entry) =>
        (fact.sourceRawInputId && entry.rawInputId === fact.sourceRawInputId) ||
        (fact.id && entry.transactionFactId === fact.id),
    )
    .sort((a, b) => Date.parse(b.occurredAt ?? "") - Date.parse(a.occurredAt ?? ""))

  return (
    <WorkflowPanel
      description="The original input is immutable. Its stored body is encrypted at rest and is never returned by the API, so this view identifies the input rather than reproducing it."
      title="Source input and ledger trail"
    >
      <dl>
        <DefinitionRow label="Raw Billing Input" value={fact.sourceRawInputId ?? "—"} />
        <DefinitionRow
          label="Producing Validation Attempt"
          value={fact.validationAttemptId ?? "—"}
        />
        <DefinitionRow label="Transaction Fact" value={fact.id ?? "—"} />
        <DefinitionRow
          label="Fact version"
          value={fact.factVersion === undefined ? "—" : String(fact.factVersion)}
        />
      </dl>

      <h3 className="mt-5 text-xs font-semibold tracking-wide uppercase">Billing Ledger entries</h3>
      {related.length === 0 ? (
        <p className="text-muted-foreground mt-2 text-sm">
          No ledger entry for this input is inside the recent ledger window.
        </p>
      ) : (
        <ol className="mt-2 space-y-2">
          {related.map((entry) => (
            <li
              className="flex flex-wrap items-baseline justify-between gap-2 rounded border p-3"
              key={entry.id}
            >
              <span className="text-sm font-medium">{ledgerEntryTypeLabel(entry.entryType)}</span>
              <span className="text-muted-foreground text-xs" title={entry.occurredAt}>
                {formatBillingTimestamp(entry.occurredAt)}
                {entry.correlationId ? ` · correlation ${entry.correlationId}` : ""}
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="text-muted-foreground mt-4 text-xs leading-5">
        The ledger has no update operation. Entries are appended in the order events happened and
        are never edited or removed.
      </p>
    </WorkflowPanel>
  )
}
