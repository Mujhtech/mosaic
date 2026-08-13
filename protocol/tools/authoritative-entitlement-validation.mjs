/**
 * Authoritative Entitlement contract validation helpers.
 *
 * The contract is a single envelope schema (v2 contract) over the snapshot,
 * check, subscription, and restore payload libraries. Schema-expressible rules
 * live in JSON Schema; what lives here is what JSON Schema cannot state:
 *
 *   - the canonical serialization and its digests (`contentDigest`, `checksum`),
 *     which are what make a snapshot bindable to one customer and a projection
 *     comparable across replays;
 *   - snapshot-version monotonicity and freshness-window ordering;
 *   - the entry-to-source graph: counts, resolution, canonical ordering, and the
 *     rule that an active entry must actually have a granting source; and
 *   - two guards that watch the contract itself rather than a document: a
 *     persisted entitlement state may never include `unavailable`, and no reader
 *     policy may ever resolve a rejection to `inactive`.
 *
 * That last guard is the contract's whole point. Every other rule protects a
 * field; that one protects the user, who must never lose access because Mosaic
 * failed to answer.
 *
 * Consumed by tools/phase9c-contract-validation.mjs, which owns artifact
 * loading, schema compilation, and the authority-binding rules of the envelope.
 */
import { createHash } from "node:crypto";

/**
 * The canonical serialization the digests are computed over, pinned in the
 * manifest's `canonicalSerialization` block: minified JSON, object keys ascending
 * by UTF-16 code unit, array order preserved because array order is itself
 * normative, and no `null` anywhere.
 */
export function canonicalSerialization(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalSerialization).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalSerialization(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function canonicalDigest(payload, excludedMember) {
  const copy = { ...payload };
  delete copy[excludedMember];
  return `sha256:${createHash("sha256")
    .update(canonicalSerialization(copy), "utf8")
    .digest("hex")}`;
}

function encodedBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function notAfter(earlier, later) {
  return Date.parse(earlier) <= Date.parse(later);
}

function ascending(values) {
  return values.every(
    (value, index) => index === 0 || values[index - 1] < value,
  );
}

/**
 * A JWS/receipt/purchase-token shape. Nothing in this contract may carry one,
 * and no fixture may contain one even as a placeholder: the fixtures are the
 * examples SDK authors copy. This validator does not police field *names* --
 * entitlement, subscription, and customer vocabulary is exactly what this
 * contract is about -- only values.
 */
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

const MAX_CACHE_HORIZON_SECONDS = 2_592_000;

/**
 * The freshness window, shared by a snapshot and by the unchanged response that
 * slides it.
 *
 * The combined-horizon bound is the one that actually matters. `validUntil` and
 * `staleGraceSeconds` each have their own 30-day maximum, but only a bound on
 * their sum stops a 30-day validity and a 30-day grace window from composing
 * into 60 days during which a device serves access Mosaic has not confirmed.
 */
export function freshnessWindowSemantics(label, payload) {
  const errors = [];
  if (!notAfter(payload.asOf, payload.issuedAt)) {
    errors.push(`${label} was issued before the instant it evaluated state at`);
  }
  if (!notAfter(payload.issuedAt, payload.refreshAfter)) {
    errors.push(`${label} recommends a refresh before it was issued`);
  }
  if (!notAfter(payload.refreshAfter, payload.validUntil)) {
    errors.push(
      `${label} refreshAfter is later than validUntil; the freshness window is ordered issuedAt <= refreshAfter <= validUntil`,
    );
  }
  const validitySeconds =
    (Date.parse(payload.validUntil) - Date.parse(payload.issuedAt)) / 1000;
  const horizon = validitySeconds + (payload.staleGraceSeconds ?? 0);
  if (horizon > MAX_CACHE_HORIZON_SECONDS) {
    errors.push(
      `${label} offers a combined offline horizon of ${horizon} seconds; ` +
        `validity plus stale grace may never exceed ${MAX_CACHE_HORIZON_SECONDS} seconds`,
    );
  }
  return errors;
}

export function snapshotSemantics(label, payload) {
  const errors = [...freshnessWindowSemantics(label, payload)];

  const expected = canonicalDigest(payload, "contentDigest");
  if (payload.contentDigest !== expected) {
    errors.push(
      `${label} contentDigest does not cover its own canonical serialization; ` +
        "the digest binds the snapshot to its Billing Customer, Project, Environment, and version",
    );
  }

  // The never-projected placeholder. The schema constrains its content; what it
  // cannot constrain is the one instant the record carries. `lastProjectedAt` is
  // required on every projection status, and on a placeholder there is no
  // projection to date it from, so it is pinned to the record's own evaluation
  // instant. Leaving it free would let a producer date a placeholder from an
  // unrelated run and let a reader mistake it for evidence a projection happened.
  if (
    payload.snapshotVersion === 0 &&
    payload.projectionStatus.lastProjectedAt !== payload.asOf
  ) {
    errors.push(
      `${label} is the never-projected placeholder but dates its projection at ` +
        `${payload.projectionStatus.lastProjectedAt} rather than its own asOf ${payload.asOf}; ` +
        "no projection has run, so the only instant it can honestly report is the instant it was evaluated",
    );
  }

  if (
    payload.previousSnapshotVersion !== undefined &&
    payload.snapshotVersion <= payload.previousSnapshotVersion
  ) {
    errors.push(
      `${label} snapshotVersion ${payload.snapshotVersion} does not advance past ` +
        `previousSnapshotVersion ${payload.previousSnapshotVersion}; snapshot versions are monotonic per customer per Environment`,
    );
  }

  const keys = payload.entries.map((item) => item.entitlementKey);
  if (!ascending(keys)) {
    errors.push(
      `${label} entries are not ascending and unique by entitlementKey; the ordering is normative because the contentDigest is computed over it`,
    );
  }
  const sourceIds = payload.sources.map((item) => item.sourceId);
  if (!ascending(sourceIds)) {
    errors.push(`${label} sources are not ascending and unique by sourceId`);
  }

  const byId = new Map(payload.sources.map((item) => [item.sourceId, item]));
  const referenced = new Set();

  for (const entry of payload.entries) {
    const at = `${label} entry ${entry.entitlementKey}`;
    if (entry.sourceCount !== entry.sourceIds.length) {
      errors.push(
        `${at} declares sourceCount ${entry.sourceCount} but lists ${entry.sourceIds.length} sources`,
      );
    }
    if (!ascending(entry.sourceIds)) {
      errors.push(`${at} sourceIds are not ascending and unique`);
    }
    const contributing = [];
    for (const sourceId of entry.sourceIds) {
      referenced.add(sourceId);
      const source = byId.get(sourceId);
      if (source === undefined) {
        errors.push(`${at} references source ${sourceId}, which the snapshot does not carry`);
        continue;
      }
      contributing.push(source);
    }
    const explanationSourceId = entry.primaryExplanation.sourceId;
    if (explanationSourceId !== undefined && !byId.has(explanationSourceId)) {
      errors.push(
        `${at} explains itself with source ${explanationSourceId}, which the snapshot does not carry`,
      );
    }
    const granting = contributing.filter(
      (source) => source.sourceState === "granting",
    );
    const uncertain = contributing.filter(
      (source) => source.sourceState === "unknown",
    );
    if (entry.state === "active" && granting.length === 0) {
      errors.push(
        `${at} is active but no contributing source is granting; an active Entitlement always has a reason`,
      );
    }
    if (entry.state === "inactive" && granting.length > 0) {
      errors.push(`${at} is inactive while a contributing source is still granting`);
    }
    if (entry.state === "inactive" && uncertain.length > 0) {
      errors.push(
        `${at} is inactive while a contributing source is uncertain; unresolved evidence yields unknown, never inactive`,
      );
    }
    if (
      entry.effectiveStart !== undefined &&
      entry.effectiveEnd !== undefined &&
      !notAfter(entry.effectiveStart, entry.effectiveEnd)
    ) {
      errors.push(`${at} ends before it starts`);
    }
  }

  for (const source of payload.sources) {
    if (!referenced.has(source.sourceId)) {
      errors.push(
        `${label} carries source ${source.sourceId}, which no entry accounts for`,
      );
    }
    if (source.end !== undefined && !notAfter(source.start, source.end)) {
      errors.push(`${label} source ${source.sourceId} ends before it starts`);
    }
  }

  return errors;
}

export function subscriptionSemantics(label, payload) {
  const errors = [];
  const expected = canonicalDigest(payload, "checksum");
  if (payload.checksum !== expected) {
    errors.push(
      `${label} checksum does not cover its own canonical serialization; ` +
        "no-change replay detection and shadow comparison both depend on it",
    );
  }
  if (
    payload.periodStart !== undefined &&
    payload.periodEnd !== undefined &&
    !notAfter(payload.periodStart, payload.periodEnd)
  ) {
    errors.push(`${label} ends its service period before it starts`);
  }
  if (
    payload.pauseEffectiveAt !== undefined &&
    payload.pauseResumeAt !== undefined &&
    !notAfter(payload.pauseEffectiveAt, payload.pauseResumeAt)
  ) {
    errors.push(`${label} resumes from pause before the pause takes effect`);
  }
  return errors;
}

export function checkSemantics(label, payload) {
  const errors = [];
  const keys = payload.results.map((item) => item.entitlementKey);
  if (!ascending(keys)) {
    errors.push(`${label} results are not ascending and unique by entitlementKey`);
  }
  for (const result of payload.results) {
    if (
      result.sourceIds !== undefined &&
      result.sourceCount !== result.sourceIds.length
    ) {
      errors.push(
        `${label} result ${result.entitlementKey} declares sourceCount ${result.sourceCount} but lists ${result.sourceIds.length} sources`,
      );
    }
    if (payload.snapshotVersion === undefined && result.state !== "unavailable") {
      errors.push(
        `${label} result ${result.entitlementKey} claims ${result.state} without a snapshot to derive it from; ` +
          "with no readable snapshot every result is unavailable",
      );
    }
  }
  return errors;
}

export function restoreSemantics(label, payload) {
  const errors = [];
  if (
    payload.completedAt !== undefined &&
    !notAfter(payload.requestedAt, payload.completedAt)
  ) {
    errors.push(`${label} completed before it was requested`);
  }
  if (
    payload.pendingValidationCount !== undefined &&
    payload.observedTransactionCount !== undefined &&
    payload.pendingValidationCount > payload.observedTransactionCount
  ) {
    errors.push(
      `${label} has more validations pending than transactions it observed`,
    );
  }
  return errors;
}

/** Record-envelope rules shared by every Authoritative Entitlement record. */
export function entitlementEnvelopeSemantics(label, document) {
  const errors = [];
  if (encodedBytes(document) > 65_536) {
    errors.push(`${label} exceeds the 64 KiB record limit`);
  }
  walkValues(document, "", (value, path) => {
    if (JWS_SHAPE.test(value)) {
      errors.push(`${label}${path} carries a signed-payload-shaped value`);
    }
  });
  return errors;
}

/**
 * Guards the contract itself, not a document.
 *
 * Two invariants have to hold for the whole design to mean anything, and neither
 * is checkable from any single record: a persisted Entitlement state may never
 * include `unavailable` (which would let a service failure be written into
 * immutable state), and no reader policy may ever resolve to `inactive` (which
 * would let a failure look like a cancellation).
 */
export function validateEntitlementFailClosedVocabulary(snapshotSchema, manifest) {
  const errors = [];
  const persisted = snapshotSchema.$defs.persistedEntitlementState.enum;
  if (persisted.includes("unavailable")) {
    errors.push(
      "A persisted Entitlement state may never include unavailable: it is a service-delivery state, not customer access",
    );
  }
  if (!persisted.includes("unknown")) {
    errors.push(
      "A persisted Entitlement state must include unknown, or a projection with incomplete evidence has nowhere safe to land",
    );
  }
  // The placeholder only works because it sorts below every version that can
  // supersede it. If issued versions ever started at 0, a never-projected
  // placeholder and a real first snapshot would be indistinguishable, and the
  // monotonic gate would silently refuse the real one.
  const issued = snapshotSchema.$defs.snapshotVersion;
  const placeholder = snapshotSchema.$defs.snapshotVersionOrPlaceholder;
  if (issued.minimum !== 1) {
    errors.push(
      "An issued snapshot version must start at 1, or the never-projected placeholder collides with a real first snapshot",
    );
  }
  if (placeholder.minimum !== 0) {
    errors.push(
      "The placeholder snapshot version must admit 0, which is the version a never-projected customer is answered with",
    );
  }

  // The manifest must *declare* a reader policy. Defaulting an absent or renamed
  // key to `{}` would let the invariant below pass over nothing at all, which is
  // the one failure mode a guard like this cannot afford.
  const policy = manifest.readerPolicy;
  if (
    policy === null ||
    typeof policy !== "object" ||
    Array.isArray(policy) ||
    Object.keys(policy).length === 0
  ) {
    errors.push(
      "The compatibility manifest must declare a non-empty readerPolicy object; without one the never-inactive invariant would hold vacuously",
    );
    return errors;
  }
  for (const [key, value] of Object.entries(policy)) {
    for (const { path, value: resolution } of policyResolutions(key, value)) {
      if (resolvesToInactive(resolution)) {
        errors.push(
          `Reader policy ${path} resolves to "${resolution}"; no failure, rejection, or expiry may ever resolve to inactive`,
        );
      }
    }
  }
  return errors;
}

/** The state-axis vocabularies the manifest pins against the schema. */
export function validateEntitlementStateAxes(snapshotSchema, manifest) {
  const errors = [];
  const axes = {
    accessState: snapshotSchema.$defs.accessState.enum,
    lifecycleState: snapshotSchema.$defs.lifecycleState.enum,
    renewalIntent: snapshotSchema.$defs.renewalIntent.enum,
    billingState: snapshotSchema.$defs.billingState.enum,
    uncertaintyReason: snapshotSchema.$defs.uncertaintyReason.enum,
    persistedEntitlementState:
      snapshotSchema.$defs.persistedEntitlementState.enum,
  };
  for (const [axis, members] of Object.entries(axes)) {
    const pinned = manifest.stateAxes[axis];
    if (
      pinned.length !== members.length ||
      members.some((member) => !pinned.includes(member))
    ) {
      errors.push(
        `Authoritative Entitlement manifest pins a ${axis} set that differs from the schema`,
      );
    }
  }
  return errors;
}

/** Every string a reader policy entry resolves to, including nested ones. */
function* policyResolutions(path, value) {
  if (typeof value === "string") {
    yield { path, value };
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, member] of value.entries()) {
      yield* policyResolutions(`${path}[${index}]`, member);
    }
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, member] of Object.entries(value)) {
      yield* policyResolutions(`${path}.${key}`, member);
    }
  }
}

/**
 * True when a policy string says a reader may land on `inactive`.
 *
 * `...NeverInactive` is the rule being stated, not broken, and is the only
 * admissible spelling. A bare `(?<!never)inactive` lookbehind is not enough on
 * its own: it also excuses any word *ending* in "never", so an adversarial
 * `resolveWheneverInactive` would read as compliant. Splitting on camel-case and
 * word boundaries first makes the qualifier an exact preceding word.
 */
function resolvesToInactive(value) {
  if (/(?<!never)inactive/i.test(value)) return true;
  const words = value
    .split(/[^A-Za-z0-9]+/u)
    .flatMap((segment) => segment.split(/(?<=[a-z0-9])(?=[A-Z])/u))
    .filter(Boolean)
    .map((word) => word.toLowerCase());
  return words.some((word, index) => {
    let cursor = word.indexOf("inactive");
    while (cursor !== -1) {
      const qualifier = cursor === 0 ? (words[index - 1] ?? "") : word.slice(0, cursor);
      if (qualifier !== "never") return true;
      cursor = word.indexOf("inactive", cursor + 1);
    }
    return false;
  });
}
