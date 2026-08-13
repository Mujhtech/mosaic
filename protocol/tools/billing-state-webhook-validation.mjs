/**
 * Billing State Webhook contract validation helpers.
 *
 * The event is what Mosaic transmits; the delivery attempt is what operators
 * read and is never transmitted at all. The semantic layer covers what JSON
 * Schema cannot: time ordering, snapshot monotonicity, retry arithmetic,
 * response-code agreement, and the rule that an event must actually report a
 * change. It also carries guards on the contract itself rather than on any
 * document -- no event type may name a provider, the emitted set must be a
 * subset of the declared vocabulary, and a summarized access state may never be
 * `unavailable` -- plus the forbidden-value walk ported from Billing Ingestion.
 * Only the *values* are policed: Billing Ingestion also bans entitlement and
 * subscription field names, which here would ban the entire contract.
 *
 * Consumed by tools/phase9c-contract-validation.mjs, which owns artifact
 * loading, schema compilation, and the authority-binding rules of the envelope.
 */

/**
 * Reasons a committed change may leave every Entitlement state untouched. A
 * period extension and a cancellation are real changes an application backend
 * wants to hear about even though nothing gained or lost access.
 */
const NON_STATE_CHANGE_REASONS = Object.freeze([
  "subscription_period_changed",
  "renewal_intent_changed",
  "grant_version_changed",
]);

const JWS_SHAPE = /^[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{8,}$/;

function walkValues(value, path, visit) {
  if (typeof value === "string") {
    visit(value, path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkValues(item, `${path}/${index}`, visit));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      walkValues(child, `${path}/${key}`, visit);
    }
  }
}

function notAfter(earlier, later) {
  return Date.parse(earlier) <= Date.parse(later);
}

function ascending(values) {
  return values.every((value, index) => index === 0 || values[index - 1] < value);
}

export function webhookEventSemantics(label, payload) {
  const errors = [];
  if (!notAfter(payload.occurredAt, payload.createdAt)) {
    errors.push(`${label} was created before the change it reports occurred`);
  }
  // Snapshot versions are monotonic within an authority epoch. An authority
  // transition -- a rollback above all -- opens a new epoch whose versions
  // restart, and the reader orders by authorityEpoch before snapshotVersion, so
  // the monotonic gate applies only to plain entitlement events.
  if (
    !payload.eventType.startsWith("authority.") &&
    payload.previousSnapshotVersion !== undefined &&
    payload.snapshotVersion <= payload.previousSnapshotVersion
  ) {
    errors.push(
      `${label} snapshotVersion ${payload.snapshotVersion} does not advance past ` +
        `previousSnapshotVersion ${payload.previousSnapshotVersion}; a consumer orders by this value within an authority epoch`,
    );
  }
  const keys = payload.changedEntitlements.map((item) => item.entitlementKey);
  if (!ascending(keys)) {
    errors.push(
      `${label} changedEntitlements are not ascending and unique by entitlementKey`,
    );
  }
  const changedState = payload.changedEntitlements.some(
    (item) => item.previousState !== item.currentState,
  );
  if (
    payload.changedEntitlements.length > 0 &&
    !changedState &&
    !NON_STATE_CHANGE_REASONS.includes(payload.sourceReason)
  ) {
    errors.push(
      `${label} reports no state change under sourceReason ${payload.sourceReason}; ` +
        "an event that changes nothing is a no-change projection, which emits no webhook",
    );
  }
  if (payload.eventType.startsWith("authority.") && payload.changedEntitlements.length !== 0) {
    errors.push(`${label} is an authority transition event and must not imply an entitlement-state delta`);
  }
  return errors;
}

export function webhookDeliverySemantics(label, payload) {
  const errors = [];
  if (payload.attempt > payload.maxAttempts) {
    errors.push(`${label} attempt exceeds maxAttempts`);
  }
  if (payload.status === "exhausted" && payload.attempt !== payload.maxAttempts) {
    errors.push(
      `${label} is exhausted on attempt ${payload.attempt} of ${payload.maxAttempts}; ` +
        "exhaustion means the attempts actually ran out",
    );
  }
  if (
    payload.respondedAt !== undefined &&
    !notAfter(payload.requestedAt, payload.respondedAt)
  ) {
    errors.push(`${label} was answered before it was sent`);
  }
  if (
    payload.nextAttemptAt !== undefined &&
    !notAfter(payload.requestedAt, payload.nextAttemptAt)
  ) {
    errors.push(`${label} schedules its next attempt before this one was sent`);
  }
  const code = payload.responseStatusCode;
  if (code !== undefined) {
    const success = code >= 200 && code <= 299;
    if (payload.status === "succeeded" && !success) {
      errors.push(`${label} succeeded with response status ${code}`);
    }
    if (
      (payload.status === "failed" || payload.status === "exhausted") &&
      success
    ) {
      errors.push(`${label} failed with response status ${code}`);
    }
  }
  return errors;
}

/** Record-envelope rules shared by every Billing State Webhook record. */
export function webhookEnvelopeSemantics(label, document) {
  const errors = [];
  if (Buffer.byteLength(JSON.stringify(document), "utf8") > 32_768) {
    errors.push(`${label} exceeds the 32 KiB record limit`);
  }
  walkValues(document, "", (value, path) => {
    if (JWS_SHAPE.test(value)) {
      errors.push(
        `${label}${path} carries a signed-payload-shaped value; no provider secret, purchase token, or raw provider payload crosses this contract`,
      );
    }
  });
  return errors;
}

/**
 * Guards the contract itself: the public event vocabulary may never name a
 * provider, and the emitted set must be a subset of the declared vocabulary. An
 * application backend that has to branch on whether a change came from Apple or
 * Google is reading a provider integration, not a Mosaic contract.
 */
export function validateWebhookEventTypeVocabulary(contractSchema, manifest) {
  const provider = /apple|google|storekit|play|itunes|android|ios/i;
  const errors = [];
  const declared = contractSchema.$defs.event.properties.eventType.enum;
  for (const eventType of declared) {
    if (provider.test(eventType)) {
      errors.push(
        `Webhook event type "${eventType}" names a provider; the public event vocabulary is provider-neutral`,
      );
    }
  }
  if (
    manifest.eventTypes.length !== declared.length ||
    declared.some((type) => !manifest.eventTypes.includes(type))
  ) {
    errors.push("Webhook event-type set is incomplete");
  }
  for (const eventType of manifest.emittedEventTypes ?? []) {
    if (!manifest.eventTypes.includes(eventType)) {
      errors.push(`Webhook emits ${eventType}, which is not a declared event type`);
    }
  }
  return errors;
}

/**
 * Guards the contract itself: an event's summarized access state may never be
 * `unavailable`.
 *
 * `unavailable` says Mosaic could not answer a read. An event is not a read --
 * it exists only because a projection committed a new snapshot, so the
 * projection did answer. The worst an event can honestly say about an axis is
 * `unknown`, carrying the uncertainty that explains why. Admitting
 * `unavailable` here would put a service-delivery state on a record that is not
 * authoritative in the first place, and a tolerant consumer would have no reason
 * to distrust it.
 */
export function validateWebhookSummaryAccessVocabulary(contractSchema) {
  const errors = [];
  const members = contractSchema.$defs.accessState.enum;
  if (members.includes("unavailable")) {
    errors.push(
      "Webhook stateSummary.accessState may never include unavailable: an event is not a read, so Mosaic's ability to answer is not one of its states",
    );
  }
  for (const required of ["active", "inactive", "unknown"]) {
    if (!members.includes(required)) {
      errors.push(
        `Webhook stateSummary.accessState must include ${required}, or a committed projection has nowhere honest to land`,
      );
    }
  }
  return errors;
}
