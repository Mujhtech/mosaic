import { StatusPill } from "@/features/billing-ledger/components/billing-chrome"
import {
  accessStateLabel,
  accessStateTone,
  billingStateLabel,
  billingStateTone,
  lifecycleStateLabel,
  lifecycleStateTone,
  renewalIntentLabel,
  renewalIntentTone,
  subscriptionAccessStatement,
  uncertaintyReasonLabel,
  uncertaintyTone,
} from "@/features/billing-customers/types/entitlement-vocabulary"
import type { BillingSubscriptionSnapshot } from "@/generated/api"

/**
 * The five state axes, always rendered as five separate text-first pills.
 *
 * This is the single most consequential rendering decision on the customer
 * surfaces, and it is why no component here accepts a "status" prop.
 *
 * A cancelled subscription that still has access is the case that proves it. A
 * merged pill must choose between "Cancelled" — which support agents read as
 * access gone, and act on, by offering a refund or a re-purchase — and
 * "Active", which hides that renewal was turned off and produces a surprised
 * customer at period end. Both are wrong, and the first is wrong in the
 * expensive direction.
 *
 * Five pills state five true things at once: access is active, the lifecycle is
 * active, renewal intent is disabled, billing is current, and there is no
 * uncertainty. Nothing has to be summarised away.
 */
export function SubscriptionStateAxes({
  subscription,
}: {
  subscription: BillingSubscriptionSnapshot
}) {
  const statement = subscriptionAccessStatement({
    accessState: subscription.accessState,
    periodEnd: subscription.periodEnd,
    renewalIntent: subscription.renewalIntent,
  })

  return (
    <div>
      <dl className="flex flex-wrap gap-x-6 gap-y-3">
        <Axis label="Access">
          <StatusPill
            label={accessStateLabel(subscription.accessState)}
            tone={accessStateTone(subscription.accessState)}
          />
        </Axis>
        <Axis label="Lifecycle">
          <StatusPill
            label={lifecycleStateLabel(subscription.lifecycleState)}
            tone={lifecycleStateTone(subscription.lifecycleState)}
          />
        </Axis>
        <Axis label="Renewal intent">
          <StatusPill
            label={renewalIntentLabel(subscription.renewalIntent)}
            tone={renewalIntentTone(subscription.renewalIntent)}
          />
        </Axis>
        <Axis label="Billing state">
          <StatusPill
            label={billingStateLabel(subscription.billingState)}
            tone={billingStateTone(subscription.billingState)}
          />
        </Axis>
        <Axis label="Uncertainty">
          <StatusPill
            label={uncertaintyReasonLabel(subscription.uncertaintyReason)}
            tone={uncertaintyTone(subscription.uncertaintyReason)}
          />
        </Axis>
      </dl>

      {/* The sentence pair. Cancellation flips renewal intent only, so the
          access line states the period end rather than the cancellation. */}
      <p className="mt-3 text-sm leading-6">
        <span className="font-semibold">{statement.access}</span>
        <span className="text-muted-foreground"> · {statement.renewal}</span>
      </p>

      {subscription.isTestSource ? (
        <p className="mt-2">
          <StatusPill label="Test purchase" tone="attention" />
        </p>
      ) : null}
    </div>
  )
}

function Axis({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-1">{children}</dd>
    </div>
  )
}
