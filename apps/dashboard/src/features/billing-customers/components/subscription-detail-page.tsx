import { useQuery } from "@tanstack/react-query"

import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary"
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state"
import {
  DefinitionRow,
  LedgerPaging,
  StatusPill,
} from "@/features/billing-ledger/components/billing-chrome"
import { pagedListHeading } from "@/features/billing-ledger/types/billing-list-headings"
import { providerLabel } from "@/features/billing-ledger/types/billing-vocabulary"
import { SubscriptionStateAxes } from "@/features/billing-customers/components/subscription-state-axes"
import {
  subscriptionQueryOptions,
  subscriptionTimelineQueryOptions,
} from "@/features/billing-customers/queries/customer-queries"
import {
  AUTHORITATIVE_ACCESS_NOTE,
  AUTHORITATIVE_TIMESTAMP_NOTE,
  explanationSentence,
  formatEntitlementInstant,
  timelineEntryTypeLabel,
} from "@/features/billing-customers/types/entitlement-vocabulary"
import { ScopeMismatchRecovery } from "@/features/orgs/components/scope-mismatch-recovery"
import { WorkflowPanel, WorkspacePage } from "@/features/orgs/components/workspace-page"
import { useValidatedProjectScope } from "@/features/projects/hooks/use-validated-project-scope"
import {
  billingCustomerHref,
  billingTransactionsHref,
  catalogProductHref,
} from "@/lib/routing/workspace-hrefs"
import type { BillingSubscriptionSnapshot } from "@/generated/api"

interface SubscriptionDetailPageProps {
  cursor?: string
  environmentId: string
  instanceId: string
  onCursorChange: (cursor: string | undefined) => void
  organizationId: string
  projectId: string
}

/**
 * One Subscription Instance and the append-only history that explains it.
 *
 * The timeline is newest-first and nothing is ever removed from it: a
 * superseded entry is still part of why the current state is what it is, and
 * dropping it would leave an operator with a conclusion and no derivation —
 * which on a billing surface is indistinguishable from Mosaic having made it
 * up.
 *
 * That promise is about the record, not about one response. A subscription that
 * has renewed monthly for two years has more entries than any single page
 * carries, so the page is paged and says so. Claiming completeness while
 * silently trimming would break the same promise from the other direction.
 */
export function SubscriptionDetailPage({
  cursor,
  environmentId,
  instanceId,
  onCursorChange,
  organizationId,
  projectId,
}: SubscriptionDetailPageProps) {
  const { project, scopeMismatch, scopeReady } = useValidatedProjectScope(organizationId, projectId)
  const subscription = useQuery({
    ...subscriptionQueryOptions(projectId, environmentId, instanceId),
    enabled: scopeReady,
  })
  const timeline = useQuery({
    ...subscriptionTimelineQueryOptions(projectId, environmentId, instanceId, cursor),
    enabled: scopeReady,
  })
  const timelineEntries = timeline.data?.items ?? []

  const error = project.error ?? subscription.error
  const state = resolveHostedQueryState({
    error,
    isEmpty: false,
    isPending: project.isPending || (scopeReady && subscription.isPending),
    loadingDescription: "Loading this Subscription Instance's projected state.",
    onRetry: () => {
      void subscription.refetch()
      void timeline.refetch()
    },
    permissionDescription:
      "Organization owner or admin permission is required to read a Subscription Instance.",
    scope: { environmentId, organizationId, projectId },
  })

  if (scopeMismatch) {
    return (
      <WorkspacePage
        description="The routed Organization does not own this Project."
        title="Subscription unavailable in this Organization"
      >
        <ScopeMismatchRecovery
          mismatch={scopeMismatch}
          organizationId={organizationId}
          projectId={projectId}
        />
      </WorkspacePage>
    )
  }

  const scope = { environmentId, organizationId, projectId }
  const data = subscription.data

  return (
    <WorkspacePage
      description="One Subscription Instance's current projected state and the immutable history behind it. No store status string appears anywhere on this page: Mosaic states its own normalized axes."
      eyebrow="Mosaic Billing · Subscription"
      title={instanceId}
    >
      {data?.billingCustomerId ? (
        <a
          className="text-primary text-sm font-semibold"
          href={billingCustomerHref(scope, data.billingCustomerId) ?? "#"}
        >
          Back to the Billing Customer
        </a>
      ) : null}

      <p className="text-muted-foreground text-xs leading-5">{AUTHORITATIVE_ACCESS_NOTE}</p>

      <HostedResourceBoundary state={state}>
        <WorkflowPanel
          description="Five axes, never merged. Cancellation changes renewal intent only; it does not end access."
          title="Current state"
        >
          {data ? <SubscriptionStateAxes subscription={data} /> : null}
        </WorkflowPanel>

        <WorkflowPanel title="Provider-derived effective times">
          <dl>
            <DefinitionRow label="Store" value={providerLabel(storeProviderOf(data))} />
            <DefinitionRow
              label="Period"
              value={`${formatEntitlementInstant(data?.periodStart)} → ${formatEntitlementInstant(data?.periodEnd)}`}
            />
            <DefinitionRow
              label="Grace period ends"
              value={formatEntitlementInstant(data?.gracePeriodEnd)}
            />
            <DefinitionRow
              label="Billing retry started"
              value={formatEntitlementInstant(data?.billingRetryStart)}
            />
            <DefinitionRow
              label="Pause effective / resumes"
              value={`${formatEntitlementInstant(data?.pauseEffectiveAt)} → ${formatEntitlementInstant(data?.pauseResumeAt)}`}
            />
            {/* Deliberately labelled as the moment renewal was turned off, not
                as the moment access ended. They are not the same instant and
                conflating them is the cancellation bug. */}
            <DefinitionRow
              label="Cancellation recorded (renewal intent only)"
              value={formatEntitlementInstant(data?.cancellationEffectiveAt)}
            />
            <DefinitionRow
              label="Expiration effective"
              value={formatEntitlementInstant(data?.expirationEffectiveAt)}
            />
            <DefinitionRow
              label="Revocation effective"
              value={formatEntitlementInstant(data?.revocationEffectiveAt)}
            />
            <DefinitionRow
              label="Refund effective"
              value={formatEntitlementInstant(data?.refundEffectiveAt)}
            />
          </dl>
        </WorkflowPanel>

        <WorkflowPanel title="Projection">
          <dl>
            <DefinitionRow
              label="As of (the instant the projection reasoned about)"
              value={formatEntitlementInstant(data?.asOf)}
            />
            <DefinitionRow
              label="Computed at (when the run committed)"
              value={formatEntitlementInstant(data?.computedAt)}
            />
            <DefinitionRow
              label="Projection version"
              value={String(data?.projectionVersion ?? "—")}
            />
            <DefinitionRow
              label="Projection rule version"
              value={String(data?.projectionRuleVersion ?? "—")}
            />
            <DefinitionRow
              label="Contributing facts"
              value={String(data?.sourceFactCount ?? "—")}
            />
          </dl>
          <p className="text-muted-foreground mt-2 text-xs leading-5">
            {AUTHORITATIVE_TIMESTAMP_NOTE}
          </p>
          {data?.explanationCode ? (
            <p className="mt-2 text-sm leading-6">{explanationSentence(data.explanationCode)}</p>
          ) : null}
          {data?.supersededBySubscriptionInstanceId ? (
            <p className="text-muted-foreground mt-2 text-sm leading-6">
              Superseded by {data.supersededBySubscriptionInstanceId}. Nothing was deleted — the
              replacement is recorded explicitly and this instance stays readable.
            </p>
          ) : null}
          {data?.mosaicProductId ? (
            <a
              className="text-primary mt-2 inline-flex text-sm font-semibold"
              href={catalogProductHref(scope, data.mosaicProductId) ?? "#"}
            >
              Product
            </a>
          ) : null}
        </WorkflowPanel>

        <WorkflowPanel
          description="Append-only and newest first. Nothing is ever removed from this history, but one page is not the whole of it — page forward to reach older entries. Entries restate what a store said and when it took effect; they pass the same safety guard as the 9A ledger, so no store payload fragment can appear here."
          title={
            timelineEntries.length === 0
              ? "Timeline"
              : pagedListHeading({
                  count: timelineEntries.length,
                  cursor,
                  nextCursor: timeline.data?.nextCursor,
                  noun: "timeline entr(y/ies)",
                })
          }
        >
          {timelineEntries.length === 0 ? (
            <>
              <p className="text-sm leading-6">
                {cursor
                  ? "No timeline entry is on this page. Return to the first page to read this Subscription Instance's history from the newest entry."
                  : "No timeline entry is recorded for this Subscription Instance yet."}
              </p>
              <LedgerPaging
                cursor={cursor}
                endLabel="End of the timeline — this is the oldest recorded entry."
                nextCursor={timeline.data?.nextCursor}
                onCursorChange={onCursorChange}
              />
            </>
          ) : (
            <ol className="space-y-3">
              {timelineEntries.map((entry) => (
                <li className="rounded border p-4" key={entry.timelineEntryId}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-semibold">
                      {timelineEntryTypeLabel(entry.entryType)}
                    </span>
                    <StatusPill label="Immutable" tone="neutral" />
                  </div>

                  {/* Effective and observed are two clocks: when the store says
                      it took effect, and when Mosaic learned about it. Neither
                      provider guarantees notification ordering, so they diverge
                      routinely and an operator reasoning about a dispute needs
                      both. */}
                  <div className="mt-2 text-xs">
                    <p title={entry.effectiveAt}>
                      <span className="text-muted-foreground">Effective at </span>
                      {formatEntitlementInstant(entry.effectiveAt)}
                    </p>
                    <p className="mt-0.5" title={entry.observedAt}>
                      <span className="text-muted-foreground">Observed at </span>
                      {formatEntitlementInstant(entry.observedAt)}
                    </p>
                  </div>

                  {entry.explanationCode ? (
                    <p className="text-muted-foreground mt-2 text-sm leading-6">
                      {explanationSentence(entry.explanationCode)}
                    </p>
                  ) : null}

                  {entry.detail && Object.keys(entry.detail).length > 0 ? (
                    <dl className="mt-2">
                      {Object.entries(entry.detail).map(([key, value]) => (
                        <DefinitionRow key={key} label={key} value={value} />
                      ))}
                    </dl>
                  ) : null}

                  <a
                    className="text-primary mt-2 inline-flex text-xs font-semibold"
                    href={billingTransactionsHref(scope) ?? "#"}
                  >
                    Find the recorded facts behind this
                  </a>
                </li>
              ))}
            </ol>
          )}
          {timelineEntries.length > 0 ? (
            <LedgerPaging
              cursor={cursor}
              endLabel="End of the timeline — this is the oldest recorded entry."
              nextCursor={timeline.data?.nextCursor}
              onCursorChange={onCursorChange}
            />
          ) : null}
        </WorkflowPanel>
      </HostedResourceBoundary>
    </WorkspacePage>
  )
}

/**
 * The snapshot names the platform in SDK vocabulary while the ledger names the
 * store in provider vocabulary. Mapping here keeps one provider label in use
 * across both features rather than introducing a second name for one store.
 */
function storeProviderOf(subscription: BillingSubscriptionSnapshot | undefined) {
  if (subscription?.storePlatform === "apple_app_store") return "app_store"
  if (subscription?.storePlatform === "google_play") return "google_play"
  return subscription?.storePlatform
}
