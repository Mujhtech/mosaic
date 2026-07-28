/**
 * Regenerates the three Authoritative Entitlement reference-vector files.
 *
 * These are the derivations that five implementations -- Go, Dart, Swift,
 * Kotlin, and the protocol validator -- must agree on exactly, and that a schema
 * can constrain the *shape* of but not the *value* of. Two SDKs can both be
 * schema-valid and still disagree about whether a cached snapshot should be
 * replaced, or whether an offline cache has expired, and the user experience of
 * that disagreement is losing access they paid for.
 *
 * Digests are computed here, never hand-written. A hand-edited digest would
 * assert every implementation against a value no implementation produces.
 *
 * Run: node packages/test-fixtures/src/build-entitlement-reference-vectors.mjs
 * Verified by: protocol/tools/authoritative-entitlement-validation-v1.test.mjs
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, "../../..");

const CONTRACT = "Authoritative Entitlement Contract v1";
const PROVENANCE =
  "Generated cross-implementation reference vectors. Regenerate with " +
  "packages/test-fixtures/src/build-entitlement-reference-vectors.mjs; never hand-edit a digest.";

/**
 * The canonical serialization pinned by
 * `protocol/compatibility/authoritative-entitlement/v1.json`.
 */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const sha256 = (text) =>
  `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;

const write = (name, document) => {
  const path = resolve(here, name);
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
  return path;
};

/* ------------------------------------------------------------ digest vectors */

const digestVector = (id, payload, notes) => {
  const serialized = canonical(payload);
  return {
    id,
    payload,
    canonicalSerialization: serialized,
    canonicalByteLength: Buffer.byteLength(serialized, "utf8"),
    digest: sha256(serialized),
    notes,
  };
};

const canonicalFixturePath =
  "protocol/fixtures/authoritative-entitlement/v1/snapshots/active-subscription.json";
const canonicalFixture = JSON.parse(
  readFileSync(resolve(repository, canonicalFixturePath), "utf8"),
);
const canonicalFixturePayload = { ...canonicalFixture.payload };
delete canonicalFixturePayload.contentDigest;

const digestDocument = {
  $comment: PROVENANCE,
  contract: CONTRACT,
  contractVersion: "1",
  compatibilityManifest: "protocol/compatibility/authoritative-entitlement/v1.json",
  canonicalSerialization: {
    form: "minifiedJsonSortedKeys",
    hash: "SHA-256",
    inputEncoding: "UTF-8",
    output: "sha256_prefixed_lowercase_hex",
    rules: [
      "Serialize with no insignificant whitespace: no spaces after ':' or ',', no newlines.",
      "Order object members ascending by UTF-16 code unit. Sort at every nesting depth.",
      "Preserve array order exactly. Array order is normative in this contract: snapshot entries ascend by entitlementKey and sources ascend by sourceId, so a serializer must never sort or reorder an array.",
      "Omit absent members. Never emit null: an absent optional and a null optional are different bytes and therefore different digests, and null is invalid everywhere in this contract.",
      "Emit every timestamp with exactly three fractional digits and a literal Z, which is what the schema already requires.",
      "Emit integers in shortest decimal form with no exponent, no leading zeros, and no decimal point. This contract contains no non-integer numbers.",
      "Escape strings minimally, as JSON requires: only the quotation mark, the reverse solidus, and control characters. Never escape non-ASCII characters into \\u sequences.",
      "Remove the excluded member -- contentDigest on a customer entitlement snapshot, checksum on a subscription snapshot -- before serializing. Nothing else is removed.",
    ],
    excludedMembers: {
      customerEntitlementSnapshot: "contentDigest",
      subscriptionSnapshot: "checksum",
    },
  },
  vectors: [
    digestVector(
      "canonical-fixture-snapshot",
      canonicalFixturePayload,
      `The payload of ${canonicalFixturePath} with contentDigest removed. An implementation ` +
        "that reproduces this digest agrees with the canonical fixture, which is the only " +
        "agreement that matters at run time.",
    ),
    digestVector(
      "member-order-is-irrelevant",
      { zeta: 1, alpha: 2, Mu: 3, _underscore: 4 },
      "Authoring order is discarded; sorting is by UTF-16 code unit, so uppercase sorts " +
        "before lowercase and '_' sorts after both. An implementation that sorts " +
        "case-insensitively or by locale produces a different digest here and agrees on " +
        "every all-lowercase vector.",
    ),
    digestVector(
      "array-order-is-preserved",
      { entries: ["pro", "pro_lifetime"], sources: ["b", "a"] },
      "Arrays are never sorted by the serializer. The 'sources' array here is deliberately " +
        "out of order: a serializer that sorts it would silently repair a document the " +
        "semantic validator is supposed to reject.",
    ),
    digestVector(
      "absent-optional",
      { endKnown: true, entitlementKey: "pro" },
      "Paired with null-is-never-emitted and present-optional below. These three prove that " +
        "absent, null, and present are three different states.",
    ),
    digestVector(
      "present-optional",
      { effectiveEnd: "2026-08-01T09:00:00.000Z", endKnown: true, entitlementKey: "pro" },
      "The same payload with the optional present. Its digest differs from absent-optional, " +
        "which is why an implementation must not invent a default for an absent member.",
    ),
    digestVector(
      "non-ascii-safe-text",
      { safeSummary: "Abonnement actif jusqu'au 1 août — 続き" },
      "Proves UTF-8 encoding and minimal escaping. A UTF-16 or Latin-1 encoding, or a " +
        "serializer that escapes non-ASCII into \\u sequences, produces a different digest " +
        "here and agrees on every ASCII vector. This is the vector that actually catches the bug.",
    ),
    digestVector(
      "escaped-characters",
      { safeSummary: 'quote " backslash \\ tab\tend' },
      "The three escapes JSON requires. A serializer that escapes more than this disagrees.",
    ),
    digestVector(
      "integer-form",
      { previousSnapshotVersion: 0, projectionRuleVersion: 1, snapshotVersion: 999999999999 },
      "Integers are shortest decimal with no exponent. A serializer that emits 1.0, 1e0, or " +
        "1E12 for the largest value disagrees. Zero is a legal previousSnapshotVersion and " +
        "must not be omitted as falsy.",
    ),
    digestVector(
      "nested-sorting",
      {
        projectionStatus: { state: "current", lastProjectedAt: "2026-07-28T11:59:58.000Z" },
        entries: [{ state: "active", entitlementKey: "pro", endKnown: true }],
      },
      "Sorting applies at every depth, including inside array elements. An implementation " +
        "that sorts only the top level agrees on flat vectors and disagrees on every real snapshot.",
    ),
  ],
};

/* ------------------------------------------------------ cache-decision vectors */

const cacheVector = (id, cached, incoming, decision, reason, cacheAction, resultingAccessState, notes) => ({
  id,
  cached,
  incoming,
  decision,
  reason,
  cacheAction,
  resultingAccessState,
  notes,
});

const CACHED = Object.freeze({
  contractVersion: "1",
  billingCustomerId: "fixture-customer-0001",
  projectId: "fixture-project-mosaic",
  environmentId: "fixture-environment-production",
  snapshotVersion: 4,
  asOf: "2026-07-28T11:59:58.000Z",
  contentDigestValid: true,
});

const incoming = (overrides) => ({ ...CACHED, ...overrides });

const cacheDocument = {
  $comment: PROVENANCE,
  contract: CONTRACT,
  contractVersion: "1",
  compatibilityManifest: "protocol/compatibility/authoritative-entitlement/v1.json",
  evaluationOrder: [
    "unsupportedContractVersion",
    "customerBindingMismatch",
    "contentDigestMismatch",
    "snapshotVersionNotNewer",
    "asOfRegression",
    "accept",
  ],
  rules: [
    "Evaluate the checks in evaluationOrder. The order is normative: a snapshot that is both bound to a different customer and older must be reported as a binding mismatch, because the binding failure requires clearing the cache and the version failure does not.",
    "A rejected snapshot NEVER produces accessState inactive. It produces unknown, and the previously accepted cache is preserved -- except on a binding mismatch, where the cache is cleared because continuing to serve the previous customer's access is the leak this rule exists to prevent.",
    "snapshotVersion is the sole monotonicity key. The entity tag is an opaque equality token and is never compared for magnitude.",
    "A snapshot whose version equals the cached version is not newer and is not accepted. Re-accepting it would be harmless today and is refused anyway, so that 'accepted' always means 'the state advanced'.",
  ],
  vectors: [
    cacheVector(
      "newer-version-accepted",
      CACHED,
      incoming({ snapshotVersion: 5, asOf: "2026-07-28T12:30:00.000Z" }),
      "accept",
      "newer_snapshot_version",
      "replace",
      "fromSnapshot",
      "The ordinary path. The cache is replaced atomically; there is no partial merge.",
    ),
    cacheVector(
      "older-version-rejected",
      CACHED,
      incoming({ snapshotVersion: 3, asOf: "2026-07-28T11:00:00.000Z" }),
      "reject",
      "snapshot_version_not_newer",
      "preserve",
      "unknownIfNoCacheOtherwiseCached",
      "A late or replayed response must not roll state backwards. Rejecting it preserves the newer accepted state.",
    ),
    cacheVector(
      "equal-version-rejected",
      CACHED,
      incoming({ snapshotVersion: 4 }),
      "reject",
      "snapshot_version_not_newer",
      "preserve",
      "unknownIfNoCacheOtherwiseCached",
      "Equal is not newer. A 304 unchanged response is the correct way to confirm a current snapshot; it slides freshness without re-accepting anything.",
    ),
    cacheVector(
      "version-regression-after-environment-change",
      CACHED,
      incoming({
        environmentId: "fixture-environment-staging",
        snapshotVersion: 1,
        asOf: "2026-07-28T12:30:00.000Z",
      }),
      "reject",
      "environment_mismatch",
      "clear",
      "unknown",
      "Snapshot versions are monotonic per customer PER ENVIRONMENT, so a staging snapshot legitimately starts at 1. Treating this as a version regression would be the wrong diagnosis and would preserve a production cache under a staging identity. The binding check runs first for exactly this case.",
    ),
    cacheVector(
      "different-customer-clears-cache",
      CACHED,
      incoming({ billingCustomerId: "fixture-customer-0002", snapshotVersion: 9 }),
      "reject",
      "customer_mismatch",
      "clear",
      "unknown",
      "The one rejection that clears rather than preserves. A newer version does not make a snapshot for another person acceptable, and keeping the old cache after an identity change leaks the previous user's access.",
    ),
    cacheVector(
      "different-project-clears-cache",
      CACHED,
      incoming({ projectId: "fixture-project-other", snapshotVersion: 9 }),
      "reject",
      "project_mismatch",
      "clear",
      "unknown",
      "Same reasoning as customer mismatch. All three binding members -- customer, Project, Environment -- are covered by the contentDigest so a mismatch is detectable even if a field were tampered with.",
    ),
    cacheVector(
      "checksum-failure-preserves-cache",
      CACHED,
      incoming({ snapshotVersion: 5, contentDigestValid: false }),
      "reject",
      "content_digest_mismatch",
      "preserve",
      "unknownIfNoCacheOtherwiseCached",
      "Corruption in transit or at rest. The snapshot is discarded whole -- never partially applied -- and the last good cache stands.",
    ),
    cacheVector(
      "unsupported-contract-version",
      CACHED,
      incoming({ contractVersion: "2", snapshotVersion: 5 }),
      "reject",
      "unsupported_contract_version",
      "preserve",
      "unknownIfNoCacheOtherwiseCached",
      "Exact-match reading. A '2' document is as unreadable to a '1' reader as a '9.9' document; numeric ordering never implies support. This check runs first because a document in an unknown version cannot be trusted to have interpretable binding fields.",
    ),
    cacheVector(
      "as-of-regression-rejected",
      CACHED,
      incoming({ snapshotVersion: 5, asOf: "2026-07-28T10:00:00.000Z" }),
      "reject",
      "as_of_regression",
      "preserve",
      "unknownIfNoCacheOtherwiseCached",
      "A higher version evaluated at an earlier instant means the server projected from a stale read. Accepting it would move the version forward while moving the evidence backward.",
    ),
    cacheVector(
      "no-cache-accepts-first-snapshot",
      null,
      incoming({ snapshotVersion: 1 }),
      "accept",
      "no_cached_snapshot",
      "replace",
      "fromSnapshot",
      "With no cache there is nothing to be monotonic against. Every other check still applies.",
    ),
  ],
};

/* ---------------------------------------------------------- freshness vectors */

const freshnessVector = (id, snapshot, deviceNow, state, notes) => ({
  id,
  snapshot,
  deviceNow,
  clockSkewToleranceSeconds: 60,
  state,
  notes,
});

const WINDOW = Object.freeze({
  issuedAt: "2026-07-28T12:00:00.000Z",
  asOf: "2026-07-28T11:59:58.000Z",
  refreshAfter: "2026-07-28T13:00:00.000Z",
  validUntil: "2026-08-04T12:00:00.000Z",
  staleGraceSeconds: 86400,
});

const strictWindow = { ...WINDOW, staleGraceSeconds: 0 };

const freshnessDocument = {
  $comment: PROVENANCE,
  contract: CONTRACT,
  contractVersion: "1",
  compatibilityManifest: "protocol/compatibility/authoritative-entitlement/v1.json",
  policy: {
    name: "boundedGrace",
    clockSkewToleranceSeconds: 60,
    defaultRefreshAfterSeconds: 3600,
    defaultValidUntilSeconds: 604800,
    maxValidUntilSeconds: 2592000,
    maxStaleGraceSeconds: 2592000,
  },
  rules: [
    "fresh: deviceNow is before refreshAfter. Serve the cache and do not refresh.",
    "refresh_recommended: deviceNow is at or after refreshAfter and before validUntil. The snapshot is still fully valid; refresh opportunistically.",
    "stale_within_grace: deviceNow is at or after validUntil and before validUntil + staleGraceSeconds. Previously active Entitlements remain locally active and MUST be surfaced as stale. With staleGraceSeconds 0 this band does not exist and the state is expired.",
    "expired: deviceNow is at or after validUntil + staleGraceSeconds. Report unknown. NEVER report inactive: an expired cache means Mosaic has not been heard from, not that access ended.",
    "Boundaries are compared with the 60-second skew tolerance applied in the direction that favours the user: a boundary is crossed only once deviceNow exceeds it by more than the tolerance.",
    "A device clock earlier than issuedAt by more than the tolerance is unreliable. An unreliable clock is not a fifth state: it forces expired-equivalent behaviour, because a cache whose age cannot be measured cannot be trusted to be young.",
  ],
  vectors: [
    freshnessVector("well-inside-window", WINDOW, "2026-07-28T12:30:00.000Z", "fresh",
      "The ordinary case shortly after issuance."),
    freshnessVector("just-before-refresh-after", WINDOW, "2026-07-28T12:59:00.000Z", "fresh",
      "One minute before refreshAfter."),
    freshnessVector("one-second-past-refresh-after-within-skew", WINDOW, "2026-07-28T13:00:01.000Z", "fresh",
      "Inside the 60-second skew tolerance, so the boundary is not yet crossed. An implementation that compares boundaries exactly flaps between two states for every device whose clock is a few seconds fast."),
    freshnessVector("past-refresh-after-beyond-skew", WINDOW, "2026-07-28T13:05:00.000Z", "refresh_recommended",
      "Past the boundary by more than the tolerance. Still fully valid: this is a hint, not an expiry."),
    freshnessVector("long-past-refresh-after", WINDOW, "2026-08-01T12:00:00.000Z", "refresh_recommended",
      "Days offline and still inside validUntil. Access continues normally."),
    freshnessVector("just-past-valid-until", WINDOW, "2026-08-04T12:05:00.000Z", "stale_within_grace",
      "Inside the bounded-grace window. Previously active Entitlements stay active and must be marked stale in the UI."),
    freshnessVector("end-of-grace-window", WINDOW, "2026-08-05T11:55:00.000Z", "stale_within_grace",
      "Five minutes before the grace window closes."),
    freshnessVector("past-grace-window", WINDOW, "2026-08-05T12:05:00.000Z", "expired",
      "Past grace. The state is unknown, never inactive; a host that must not over-grant asks its own server."),
    freshnessVector("strict-policy-past-valid-until", strictWindow, "2026-08-04T12:05:00.000Z", "expired",
      "With staleGraceSeconds 0 there is no grace band at all, so validUntil is a hard edge. This is the strict policy expressed through the same fields rather than through a separate mode."),
    freshnessVector("backwards-clock-before-issued-at", WINDOW, "2026-07-28T09:00:00.000Z", "expired",
      "The device claims a time hours before the snapshot was issued. The cache's age is unmeasurable, so it is treated as expired. A naive implementation computes a negative age, concludes 'fresh', and hands an attacker unlimited offline access by moving the clock back."),
    freshnessVector("backwards-clock-within-skew", WINDOW, "2026-07-28T11:59:30.000Z", "fresh",
      "Thirty seconds before issuedAt is ordinary clock skew between a phone and a server, not a manipulated clock. It must not trip the unreliable-clock path."),
    freshnessVector("forwards-clock-far-future", WINDOW, "2027-07-28T12:00:00.000Z", "expired",
      "A wildly future clock expires the cache. This direction fails safe on its own: the user sees unknown rather than a granted state."),
  ],
};

/* --------------------------------------------------------------------- write */

const digestPath = write("entitlement-snapshot-digest-vectors.json", digestDocument);
const cachePath = write("entitlement-cache-decision-vectors.json", cacheDocument);
const freshnessPath = write("entitlement-freshness-vectors.json", freshnessDocument);

console.log(
  `Wrote ${digestDocument.vectors.length} snapshot digest vectors to ${digestPath}\n` +
    `Wrote ${cacheDocument.vectors.length} cache-decision vectors to ${cachePath}\n` +
    `Wrote ${freshnessDocument.vectors.length} freshness vectors to ${freshnessPath}`,
);
