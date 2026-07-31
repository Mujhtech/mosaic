import { useState } from "react";

import { Button } from "@/components/ui/button";
import { StatusPill } from "@/features/billing-ledger/components/billing-chrome";
import { BILLING_OPTIONAL_NOTE } from "@/features/billing-ledger/types/billing-vocabulary";
import { WorkflowPanel } from "@/features/orgs/components/workspace-page";
import { ApiError } from "@/lib/api/errors";

interface BillingEnablementPanelProps {
  activeCredentialCount: number;
  /** `null` when Mosaic could not read the state, which is not the same as off. */
  billingEnabled: boolean | null;
  canManage: boolean;
  error: unknown;
  isPending: boolean;
  isSaving: boolean;
  membersHref: string;
  onChange: (billingEnabled: boolean) => void;
}

/**
 * The Mosaic Billing switch, and the first thing on the setup page.
 *
 * Enabling is step two of two documented steps (the deployment sets
 * `MOSAIC_BILLING_ENABLED`; the Project turns itself on here). Until it is on,
 * intake, the RTDN pull consumer, and the validation, reconciliation, and
 * replay workers all skip the Project, so a fully configured credential still
 * produces nothing — which is exactly the dead end this panel closes.
 */
export function BillingEnablementPanel({
  activeCredentialCount,
  billingEnabled,
  canManage,
  error,
  isPending,
  isSaving,
  membersHref,
  onChange,
}: BillingEnablementPanelProps) {
  const [confirmDisable, setConfirmDisable] = useState(false);
  const credentialsStillActive =
    error instanceof ApiError &&
    error.code === "store_credentials_still_active";

  return (
    <WorkflowPanel
      description="Mosaic Billing is off until you turn it on for this Project. While it is off, no Store Notification is accepted and no observation is recorded."
      title="Mosaic Billing"
    >
      <div className="flex flex-wrap items-center gap-3">
        {isPending ? (
          <StatusPill label="Checking…" tone="neutral" />
        ) : billingEnabled === null ? (
          <StatusPill label="State unavailable" tone="attention" />
        ) : billingEnabled ? (
          <StatusPill label="Enabled for this Project" tone="positive" />
        ) : (
          <StatusPill label="Not enabled" tone="attention" />
        )}

        {canManage && billingEnabled === false ? (
          <Button
            disabled={isSaving}
            onClick={() => onChange(true)}
            type="button"
          >
            {isSaving ? "Turning on…" : "Turn on Mosaic Billing"}
          </Button>
        ) : null}

        {canManage && billingEnabled === true ? (
          <Button
            disabled={isSaving}
            onClick={() => setConfirmDisable(true)}
            type="button"
            variant="outline"
          >
            Turn off Mosaic Billing
          </Button>
        ) : null}
      </div>

      {billingEnabled === null && !isPending ? (
        <p className="mt-3 text-muted-foreground text-sm leading-6">
          Mosaic could not read whether billing is on for this Project. This is
          not the same as it being off — retry, and check that the deployment
          sets <code className="text-xs">MOSAIC_BILLING_ENABLED</code>.
        </p>
      ) : null}

      {billingEnabled === false ? (
        <div className="mt-3 space-y-2 text-sm leading-6">
          <p>
            Turning it on is the first setup step. After that, add a Store
            Server Credential below and give the store the notification endpoint
            Mosaic issues.
          </p>
          <p className="text-muted-foreground">{BILLING_OPTIONAL_NOTE}</p>
        </div>
      ) : null}

      {billingEnabled === true ? (
        <p className="mt-3 text-muted-foreground text-sm leading-6">
          Intake, the Pub/Sub pull consumer, and the validation, reconciliation,
          and replay workers are all active for this Project. Recorded facts
          never grant, revoke, or represent anyone's access to your app.
        </p>
      ) : null}

      {canManage ? null : (
        <p className="mt-3 text-muted-foreground text-sm leading-6">
          Organization owner or admin permission is required to change this.{" "}
          <a className="font-semibold text-primary" href={membersHref}>
            Ask an Owner or Admin
          </a>
        </p>
      )}

      {confirmDisable ? (
        <div className="mt-4 rounded border border-destructive/25 bg-destructive/5 p-4">
          <p className="font-semibold text-sm">
            Turn Mosaic Billing off for this Project?
          </p>
          <p className="mt-1 text-muted-foreground text-sm leading-6">
            Intake stops accepting Store Notifications and observations, and the
            workers skip this Project. Everything already recorded stays: the
            ledger is append-only and turning billing off does not delete a
            single fact, attempt, or quarantine record.
          </p>
          {activeCredentialCount > 0 ? (
            <p className="mt-2 text-sm leading-6">
              {activeCredentialCount} Store Server Credential(s) are still
              active. Mosaic refuses to turn billing off while that is true —
              see below.
            </p>
          ) : null}
          <div className="mt-3 flex gap-2">
            <Button
              disabled={isSaving}
              onClick={() => onChange(false)}
              type="button"
              variant="destructive"
            >
              {isSaving ? "Turning off…" : "Confirm turn off"}
            </Button>
            <Button
              disabled={isSaving}
              onClick={() => setConfirmDisable(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {credentialsStillActive ? (
        <div
          className="mt-4 rounded border border-destructive/25 bg-destructive/5 p-4"
          role="alert"
        >
          <p className="font-semibold text-destructive text-sm">
            Revoke the active Store Server Credentials first
          </p>
          <p className="mt-1 text-muted-foreground text-sm leading-6">
            Turning billing off would not stop the store. Apple keeps posting to
            an endpoint whose intake token still resolves, and every refusal
            spends one of its five non-renewable delivery attempts — so a
            transaction can be lost permanently. Revoking the credential is what
            actually stops the store, so Mosaic requires it first and the switch
            then means exactly what it says.
          </p>
          <p className="mt-2 text-muted-foreground text-sm leading-6">
            Revoke each active credential in the list below, then turn billing
            off.
          </p>
        </div>
      ) : error ? (
        <p className="mt-3 text-destructive text-sm" role="alert">
          {error instanceof Error
            ? error.message
            : "Mosaic could not change this setting."}
        </p>
      ) : null}
    </WorkflowPanel>
  );
}
