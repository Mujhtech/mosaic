import { useState } from "react"

import { DefinitionRow, StatusPill } from "@/features/billing-ledger/components/billing-chrome"
import {
  accessStateExplanation,
  accessStateLabel,
  accessStateTone,
  explanationSentence,
  formatEntitlementInstant,
  sourceEndStatement,
  sourceStateLabel,
  sourceStateTone,
  sourceTypeLabel,
  uncertaintyReasonLabel,
  uncertaintyTone,
} from "@/features/billing-customers/types/entitlement-vocabulary"
import { WorkflowPanel } from "@/features/organizations/components/workspace-page"
import {
  billingSubscriptionHref,
  catalogProductHref,
  grantVersionsHref,
  type WorkspaceScope,
} from "@/lib/routing/workspace-hrefs"
import type {
  BillingEntitlementSnapshot,
  BillingEntitlementSnapshotEntry,
  BillingEntitlementSource,
} from "@/generated/api"

interface EntitlementExplanationPanelProps {
  scope: WorkspaceScope
  snapshot: BillingEntitlementSnapshot | undefined
}

/**
 * Why this customer has — or does not have — each Entitlement.
 *
 * The panel exists because a state without its derivation is unusable in a
 * support conversation. Every entry expands to *all* of its contributing
 * sources, not just the one that happened to win: an operator asked "why is
 * this person still Pro after cancelling?" needs to see the lifetime purchase
 * sitting underneath the cancelled subscription, and a UI that shows only the
 * decisive source makes that invisible.
 *
 * Nothing here is a control. This is a derivation, and the only way to change
 * it is to change the facts or the grant version it was derived from.
 */
export function EntitlementExplanationPanel({ scope, snapshot }: EntitlementExplanationPanelProps) {
  const entries = snapshot?.entries ?? []
  const sources = snapshot?.sources ?? []

  if (!snapshot || entries.length === 0) {
    return (
      <WorkflowPanel title="Current entitlements">
        <p className="text-sm leading-6">
          {snapshot
            ? "The committed snapshot carries no Entitlement entries. Mosaic has computed an answer and the answer is that no purchase currently grants this customer anything."
            : "No Customer Entitlement Snapshot has been committed for this customer in this Mosaic Environment. That is undetermined, not inactive: Mosaic has not yet computed an answer rather than having computed that there is no access."}
        </p>
      </WorkflowPanel>
    )
  }

  return (
    <WorkflowPanel
      description="Each Entitlement expands to every purchase contributing to it, including the ones that are not currently granting. A state without its sources cannot be argued with."
      title="Current entitlements"
    >
      <ul className="space-y-3">
        {entries.map((entry) => (
          <EntitlementRow
            entry={entry}
            key={entry.entitlementId}
            scope={scope}
            // `sourceIds` is authoritative and is the only membership test.
            //
            // This used to also accept any source carrying the same
            // `entitlementId`, which quietly widened every row: a source the
            // snapshot did not attribute to this entry — a different grant
            // version, a lineage the projection excluded — appeared underneath
            // it as a contributing reason. On the surface whose promise is
            // "this is why", inventing a reason is the worst available failure,
            // and it also made the rendered list disagree with the
            // `sourceCount` printed directly above it.
            sources={sources.filter(
              (source) => source.sourceId && entry.sourceIds?.includes(source.sourceId),
            )}
          />
        ))}
      </ul>
    </WorkflowPanel>
  )
}

function EntitlementRow({
  entry,
  scope,
  sources,
}: {
  entry: BillingEntitlementSnapshotEntry
  scope: WorkspaceScope
  sources: readonly BillingEntitlementSource[]
}) {
  const [open, setOpen] = useState(false)
  const contentId = `entitlement-sources-${entry.entitlementId}`

  return (
    <li className="rounded border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{entry.entitlementKey ?? entry.entitlementId}</p>
          <p className="text-muted-foreground font-mono text-xs break-all">{entry.entitlementId}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill label={accessStateLabel(entry.state)} tone={accessStateTone(entry.state)} />
          {entry.uncertaintyReason && entry.uncertaintyReason !== "none" ? (
            <StatusPill
              label={uncertaintyReasonLabel(entry.uncertaintyReason)}
              tone={uncertaintyTone(entry.uncertaintyReason)}
            />
          ) : null}
          {entry.isTestSource ? <StatusPill label="Test purchase" tone="attention" /> : null}
        </div>
      </div>

      <p className="mt-2 text-sm leading-6">
        {accessStateExplanation(
          entry.state,
          entry.uncertaintyReason ? { reason: entry.uncertaintyReason } : undefined,
        )}
      </p>
      <p className="text-muted-foreground mt-1 text-sm leading-6">
        {explanationSentence(entry.explanationCode)}
      </p>

      <dl className="mt-3">
        <DefinitionRow
          label="Effective from"
          value={formatEntitlementInstant(entry.effectiveStart)}
        />
        <DefinitionRow
          label="Effective until"
          value={
            entry.effectiveEnd
              ? formatEntitlementInstant(entry.effectiveEnd)
              : entry.endKnown === false
                ? "Not known — an active source has an uncertain end"
                : "No finite end — a permanent source grants this"
          }
        />
        <DefinitionRow
          label="Contributing sources"
          value={String(entry.sourceCount ?? sources.length)}
        />
      </dl>

      {/* A count that disagrees with the sources actually named is a defect in
          the snapshot, not a rendering detail to smooth over. Saying so is the
          honest option: quietly showing whichever number is smaller would hide
          a source an operator is entitled to see, and quietly padding the list
          would invent one. */}
      {entry.sourceCount !== undefined && entry.sourceCount !== sources.length ? (
        <p className="text-muted-foreground mt-2 text-xs leading-5">
          The snapshot reports {entry.sourceCount} contributing source(s) but names {sources.length}
          . Mosaic renders only the sources the snapshot attributes to this entry; the difference is
          a data problem worth reporting rather than a display limit.
        </p>
      ) : null}

      <button
        aria-controls={contentId}
        aria-expanded={open}
        className="text-primary mt-3 text-sm font-semibold"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        {open ? "Hide contributing sources" : `Show all ${sources.length} contributing source(s)`}
      </button>

      {open ? (
        <ul className="mt-3 space-y-2" id={contentId}>
          {sources.length === 0 ? (
            <li className="text-muted-foreground text-sm leading-6">
              The snapshot names no source for this entry. For an inactive entry that is the
              expected shape: nothing is granting it.
            </li>
          ) : (
            sources.map((source) => (
              <SourceRow key={source.sourceId} scope={scope} source={source} />
            ))
          )}
        </ul>
      ) : null}
    </li>
  )
}

function SourceRow({ scope, source }: { scope: WorkspaceScope; source: BillingEntitlementSource }) {
  const productHref = source.mosaicProductId
    ? catalogProductHref(scope, source.mosaicProductId)
    : undefined
  const subscriptionHref = source.subscriptionInstanceId
    ? billingSubscriptionHref(scope, source.subscriptionInstanceId)
    : undefined
  const grantHref = grantVersionsHref(scope, {
    ...(source.entitlementId ? { entitlementId: source.entitlementId } : {}),
    ...(source.mosaicProductId ? { productId: source.mosaicProductId } : {}),
  })

  return (
    <li className="bg-muted/30 rounded border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{sourceTypeLabel(source.sourceType)}</span>
        <StatusPill
          label={sourceStateLabel(source.sourceState)}
          tone={sourceStateTone(source.sourceState)}
        />
        {source.uncertaintyReason && source.uncertaintyReason !== "none" ? (
          <StatusPill label={uncertaintyReasonLabel(source.uncertaintyReason)} tone="attention" />
        ) : null}
        {/* Apple sandbox and Google licence-tester purchases both reach here.
            A test purchase granting production access is a thing an operator
            must be able to see at a glance. */}
        {source.isTestSource ? <StatusPill label="Test source" tone="attention" /> : null}
      </div>

      <p className="text-muted-foreground mt-2 text-sm leading-6">
        {explanationSentence(source.explanationCode)}
      </p>

      <p className="text-muted-foreground mt-2 text-xs">
        {formatEntitlementInstant(source.sourceStart)} ·{" "}
        {sourceEndStatement({ ...(source.sourceEnd ? { end: source.sourceEnd } : {}) })}
      </p>

      <div className="mt-2 flex flex-wrap gap-3 text-xs font-semibold">
        {productHref ? (
          <a className="text-primary" href={productHref}>
            Product
          </a>
        ) : null}
        {subscriptionHref ? (
          <a className="text-primary" href={subscriptionHref}>
            Subscription
          </a>
        ) : null}
        {source.oneTimePurchaseInstanceId ? (
          <span className="text-muted-foreground font-normal">
            One-time purchase {source.oneTimePurchaseInstanceId}
          </span>
        ) : null}
        {grantHref ? (
          <a className="text-primary" href={grantHref}>
            Grant version
          </a>
        ) : null}
      </div>
    </li>
  )
}
