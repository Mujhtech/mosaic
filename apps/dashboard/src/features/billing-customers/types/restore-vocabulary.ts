import type { BillingRestoreJob } from "@/generated/api";

/**
 * Restore, explained in three layers that are never merged.
 *
 * A restore involves three separate things succeeding, and conflating any two
 * of them produces a support answer that is confidently wrong:
 *
 * 1. **The native restore** — the store's own operation on the device. It can
 *    succeed and find nothing, which is not a Mosaic failure.
 * 2. **Server validation** — Mosaic asking the store to confirm each purchase
 *    the device reported. This takes time and can still be running.
 * 3. **Authoritative projection** — Mosaic recomputing the customer's access
 *    from the newly validated facts. Only when a committed snapshot reflects
 *    the restore is anything actually restored.
 *
 * So `providerOutcome` and `outcome` are rendered as two separate axes and
 * `restored` is never reported until the third layer has committed.
 */

export const RESTORE_LAYERS = [
  {
    body: "The store's own restore on the device, run by the SDK. Mosaic records what it reported but never treats it as proof of access: a native restore that succeeds only means the device asked and the store answered.",
    title: "1. Native store restore",
  },
  {
    body: "Mosaic asks the store server to confirm each purchase the device reported. Nothing a device says is trusted on its own. This layer takes time, and while it runs the restore is pending — not failed.",
    title: "2. Server validation",
  },
  {
    body: "Mosaic recomputes the customer's authoritative access from the newly validated facts. Only once a committed snapshot reflects the restore is access actually restored, which is why the outcome below can still be pending after the store reported success.",
    title: "3. Authoritative projection",
  },
] as const;

export const RESTORE_READ_ONLY_NOTE =
  "Restores are started by an SDK on a device. This surface reports their status; an operator cannot start one, because nobody but the device can ask the store to replay its own purchases.";

const PROVIDER_OUTCOME_LABELS: Record<string, string> = {
  cancelled: "The person cancelled it",
  completed: "The store completed it",
  failed: "The store reported a failure",
  no_purchases_found: "The store found no purchases",
  not_attempted: "Not attempted",
  unsupported: "Not supported on this platform",
};

export function providerOutcomeLabel(value: string | undefined) {
  if (!value) {
    return "Not reported";
  }
  return PROVIDER_OUTCOME_LABELS[value] ?? humanize(value);
}

const OUTCOME_LABELS: Record<string, string> = {
  failed: "Failed",
  identity_unresolved: "Identity unresolved",
  no_additional_purchases: "Nothing further to restore",
  product_unresolved: "Product unresolved",
  provider_unavailable: "Store unavailable",
  restored: "Restored",
  validation_pending: "Validation in progress",
};

/**
 * Tone is where this vocabulary earns its keep.
 *
 * `validation_pending` is emphatically not a failure — it is the expected
 * middle state of every restore — and rendering it in a destructive tone is how
 * a support agent talks a paying customer through "reinstall the app" for a
 * restore that was about to succeed on its own.
 */
const OUTCOME_TONES: Record<
  string,
  "attention" | "negative" | "neutral" | "positive"
> = {
  failed: "negative",
  identity_unresolved: "attention",
  no_additional_purchases: "neutral",
  product_unresolved: "attention",
  provider_unavailable: "attention",
  restored: "positive",
  validation_pending: "attention",
};

const OUTCOME_EXPLANATIONS: Record<string, string> = {
  failed:
    "The restore chain could not complete. Every attempt is preserved; nothing already recorded was changed.",
  identity_unresolved:
    "Purchases were validated but Mosaic could not decide which Billing Customer they belong to. Access is granted to nobody rather than to a guess. Check identity conflicts.",
  no_additional_purchases:
    "The chain completed and found nothing Mosaic did not already hold. For a customer who genuinely has no purchases this is the correct, successful outcome.",
  product_unresolved:
    "The store confirmed a purchase of a Product this Project does not map, so Mosaic cannot say what it grants. Repair the mapping and the next projection picks it up.",
  provider_unavailable:
    "The store could not be reached during validation. This is retried automatically.",
  restored:
    "A committed snapshot now reflects the restore. This is the only outcome that means the customer's access actually changed — the store reporting success is not sufficient on its own.",
  validation_pending:
    "The device reported purchases and Mosaic is confirming them with the store. This is the normal middle of a restore, not a failure: the outcome becomes definite once validation finishes and a projection commits.",
};

export function restoreOutcomeLabel(value: string | undefined) {
  if (!value) {
    return "In progress";
  }
  return OUTCOME_LABELS[value] ?? humanize(value);
}

export function restoreOutcomeTone(value: string | undefined) {
  if (!value) {
    return "neutral" as const;
  }
  return OUTCOME_TONES[value] ?? ("attention" as const);
}

export function restoreOutcomeExplanation(value: string | undefined) {
  if (!value) {
    return "Mosaic has not recorded a final outcome yet. The restore is still moving through validation and projection.";
  }
  return (
    OUTCOME_EXPLANATIONS[value] ??
    "Mosaic reported an outcome this build does not recognise. Treat it as still in progress rather than as a failure."
  );
}

/** Terminal for the *job*, which is not the same as the outcome being final. */
export const TERMINAL_RESTORE_STATUSES: readonly string[] = [
  "completed",
  "failed",
];

export function isRestoreJobRunning(job: Pick<BillingRestoreJob, "status">) {
  return !TERMINAL_RESTORE_STATUSES.includes(job.status ?? "queued");
}

/**
 * Whether the snapshot moved.
 *
 * The baseline and current snapshot versions are the honest evidence that a
 * restore changed anything, independent of what any layer reported.
 */
export function describeSnapshotMovement(job: BillingRestoreJob) {
  if (job.snapshotVersion === undefined) {
    return "No committed snapshot has been recorded against this restore yet.";
  }
  if (job.baselineSnapshotVersion === undefined) {
    return `A snapshot at version ${job.snapshotVersion} is recorded for this restore.`;
  }
  if (job.snapshotVersion > job.baselineSnapshotVersion) {
    return `The customer's snapshot moved from version ${job.baselineSnapshotVersion} to ${job.snapshotVersion}, so committed access changed.`;
  }
  return `The snapshot is still at version ${job.baselineSnapshotVersion}, so committed access has not changed. A no-change projection does not advance the version.`;
}

function humanize(value: string) {
  const spaced = value.replaceAll("_", " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
