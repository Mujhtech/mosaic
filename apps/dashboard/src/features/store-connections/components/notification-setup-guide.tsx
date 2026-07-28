import type { StoreServerCredential } from "@/generated/api"
import { WorkflowPanel } from "@/features/organizations/components/workspace-page"
import { storeEnvironmentLabel } from "@/features/billing-ledger/types/billing-vocabulary"

/**
 * Store-side configuration steps.
 *
 * Apple and Google are not symmetric and the guidance must not pretend they
 * are: Apple pushes to an HTTPS endpoint Mosaic hosts, while Google publishes
 * to Pub/Sub and Mosaic pulls. Only one of the two has an inbound URL to
 * configure.
 */
export function NotificationSetupGuide({ credential }: { credential: StoreServerCredential }) {
  const storeEnvironment = storeEnvironmentLabel(credential.storeEnvironment)

  if (credential.provider === "google_play") {
    return (
      <WorkflowPanel
        description="Google Play publishes Real-time developer notifications to Cloud Pub/Sub. Mosaic pulls them with this credential's own service account, so there is no inbound Mosaic address to configure."
        title={`Google Play setup · ${storeEnvironment}`}
      >
        <ol className="list-decimal space-y-3 pl-5 text-sm leading-6">
          <li>
            In Google Cloud, create a Pub/Sub topic and a <strong>pull</strong> subscription on it.
            Mosaic never needs a push endpoint.
          </li>
          <li>
            Grant this service account (
            <code className="text-xs">{credential.googleClientEmail}</code>) the Pub/Sub Subscriber
            role on that subscription, and read-only Play Developer API access for the Applications
            below.
          </li>
          <li>
            In Play Console · Monetisation setup, set the Cloud Pub/Sub topic name for real-time
            developer notifications.
          </li>
          <li>
            Confirm the subscription identifiers recorded here match the ones in Google Cloud:{" "}
            <code className="text-xs">
              {credential.googlePubSubProjectId ?? "—"} /{" "}
              {credential.googlePubSubSubscriptionId ?? "—"}
            </code>
            .
          </li>
        </ol>
        <p className="text-muted-foreground mt-4 text-xs leading-5">
          Mosaic reads from the Play Developer API and never acknowledges, consumes, or refunds a
          purchase. Acknowledgement stays with your app and its Play Billing integration. An
          unacknowledged purchase is refunded by Google after three days, so do not remove
          acknowledgement from your app.
        </p>
      </WorkflowPanel>
    )
  }

  return (
    <WorkflowPanel
      description="Apple posts App Store Server Notifications V2 to the endpoint that was shown once when this credential was created or rotated."
      title={`App Store setup · ${storeEnvironment}`}
    >
      <ol className="list-decimal space-y-3 pl-5 text-sm leading-6">
        <li>
          Open App Store Connect · your app · App Information · App Store Server Notifications.
        </li>
        <li>
          Paste the endpoint URL into the <strong>{storeEnvironment}</strong> URL field for version
          2 notifications. Sandbox and production are separate fields and separate Mosaic
          credentials; never paste one into the other.
        </li>
        <li>
          Confirm the issuer ID and key ID recorded here match the In-App Purchase key you uploaded:{" "}
          <code className="text-xs">{credential.appleIssuerId ?? "—"}</code> /{" "}
          <code className="text-xs">{credential.appleKeyId ?? "—"}</code>.
        </li>
        <li>
          Watch the billing health view for the first accepted notification. Apple retries a failed
          notification only five times in production and never in sandbox, so a misconfigured
          endpoint loses transactions rather than queuing them.
        </li>
      </ol>
    </WorkflowPanel>
  )
}
