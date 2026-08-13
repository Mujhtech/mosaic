import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";

import {
  canonicalDigest,
  canonicalSerialization,
  freshnessWindowSemantics,
  snapshotSemantics,
  validateEntitlementFailClosedVocabulary,
} from "./authoritative-entitlement-validation.mjs";
import { loadPhase9CArtifacts, validatePhase9CArtifacts } from "./phase9c-contract-validation.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = loadPhase9CArtifacts("authoritativeEntitlementV2");
const snapshotSchema = artifacts.dependencies.find((schema) =>
  schema.$id.endsWith(":snapshot"),
);

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const vectors = (name) =>
  readJson(resolve(root, `../packages/test-fixtures/src/${name}`));

/** Reloads a fixture from disk so a mutation in one test cannot leak into another. */
function fixture(name) {
  const path = artifacts.fixturePaths.find((candidate) =>
    candidate.endsWith(`/${name}`),
  );
  assert.ok(path, `Missing fixture ${name}`);
  return readJson(path);
}

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, strictTypes: false });
for (const schema of [...artifacts.dependencies, artifacts.schema, artifacts.manifestSchema]) {
  ajv.addSchema(schema);
}
const validateRecord = ajv.getSchema(artifacts.schema.$id);

test("the manifest is born a draft and pins the fail-closed-to-unknown rule", () => {
  const manifest = artifacts.manifest;
  assert.equal(manifest.status, "draft");
  assert.equal(manifest.readerPolicy.rejectedRecord, "reportUnknownPreserveCache");
  assert.equal(manifest.readerPolicy.inactiveInference, "forbidden");
  assert.equal(manifest.readerPolicy.expiredCache, "reportUnknownNeverInactive");
  assert.equal(manifest.readerPolicy.billingDisabled, "unavailableNeverInactive");
  assert.equal(
    manifest.readerPolicy.customerBindingMismatch,
    "clearCacheReportUnknown",
  );
  assert.equal(manifest.readerPolicy.partialAcceptance, "forbidden");
});

test("no reader policy may ever resolve a failure to inactive", () => {
  // The contract-level guard, exercised by breaking it. A policy that resolved a
  // rejection to inactive would turn every Mosaic outage into a mass revocation.
  const broken = structuredClone(artifacts.manifest);
  broken.readerPolicy.expiredCache = "reportInactive";
  const errors = validateEntitlementFailClosedVocabulary(snapshotSchema, broken);
  assert.ok(
    errors.some((error) => error.includes("may ever resolve to inactive")),
    `expected an inactive-inference error, got: ${errors.join("; ")}`,
  );
});

test("an adversarially spelled inactive resolution is still caught", () => {
  // "whenever" ends in "never", so a bare negative lookbehind would read
  // `resolveWheneverInactive` as the compliant `...NeverInactive` spelling.
  for (const adversarial of [
    "resolveWheneverInactive",
    "reportUnknownNeverInactiveExceptInactive",
    "inactiveNeverReported",
    "never_inactive_then_inactive",
  ]) {
    const broken = structuredClone(artifacts.manifest);
    broken.readerPolicy.expiredCache = adversarial;
    const errors = validateEntitlementFailClosedVocabulary(snapshotSchema, broken);
    assert.ok(
      errors.some((error) => error.includes("may ever resolve to inactive")),
      `expected ${adversarial} to be rejected, got: ${errors.join("; ")}`,
    );
  }

  // The committed spellings must remain admissible, or the guard is useless.
  assert.deepEqual(
    validateEntitlementFailClosedVocabulary(snapshotSchema, artifacts.manifest).filter(
      (error) => error.includes("may ever resolve to inactive"),
    ),
    [],
  );
});

test("a manifest without a reader policy fails validation", () => {
  // Regression: the guard used to default an absent policy to {}, so a renamed
  // or dropped key made the never-inactive invariant pass over nothing.
  for (const replacement of [undefined, {}, null, "reReadSnapshot", []]) {
    const broken = structuredClone(artifacts.manifest);
    if (replacement === undefined) {
      delete broken.readerPolicy;
    } else {
      broken.readerPolicy = replacement;
    }
    const errors = validateEntitlementFailClosedVocabulary(snapshotSchema, broken);
    assert.ok(
      errors.some((error) => error.includes("must declare a non-empty readerPolicy")),
      `expected a missing-reader-policy error for ${JSON.stringify(replacement)}, got: ${errors.join("; ")}`,
    );
  }
});

test("unavailable can never be persisted in a snapshot entry", () => {
  // unavailable says Mosaic could not answer. Persisting it into an immutable
  // snapshot would record a service failure as customer state.
  assert.deepEqual(snapshotSchema.$defs.persistedEntitlementState.enum, [
    "active",
    "inactive",
    "unknown",
  ]);
  const document = fixture("ios-full-snapshot.json");
  document.payload.snapshot.entries[0].state = "unavailable";
  assert.equal(validateRecord(document), false);

  // It remains admissible on a read-time check response, which is the whole
  // reason the two vocabularies are separate.
  const check = fixture("checks/check-result-unavailable-billing-disabled.json");
  assert.equal(check.payload.results[0].state, "unavailable");
  assert.equal(validateRecord(check), true, JSON.stringify(validateRecord.errors));
});

test("cancellation changes renewal intent without ending access", () => {
  // The behavioural rule the whole contract exists to protect: a cancelled
  // subscription keeps access until a validated fact proves the period ended.
  const document = fixture("subscriptions/cancelled-access-still-active.json");
  assert.equal(document.payload.renewalIntent, "auto_renew_disabled");
  assert.equal(document.payload.accessState, "active");
  assert.equal(document.payload.lifecycleState, "active");
  assert.ok(document.payload.cancellationEffectiveAt);
  assert.equal(validateRecord(document), true, JSON.stringify(validateRecord.errors));
});

test("a revoked subscription can never report active access", () => {
  const document = fixture("subscriptions/revoked.json");
  document.payload.accessState = "active";
  assert.equal(validateRecord(document), false);

  const missingInstant = fixture("subscriptions/revoked.json");
  delete missingInstant.payload.revocationEffectiveAt;
  assert.equal(validateRecord(missingInstant), false);
});

test("a permanent source reports no finite expiry", () => {
  // Reporting the subscription's end date here would tell a lifetime purchaser
  // their access expires next month.
  const document = fixture("snapshots/permanent-source-no-finite-expiry.json");
  const entry = document.payload.snapshot.entries[0];
  assert.equal(entry.state, "active");
  assert.equal(entry.endKnown, true);
  assert.equal(entry.effectiveEnd, undefined);
  assert.equal(entry.sourceCount, 2);
});

test("refunding one source leaves an unrelated source granting", () => {
  const document = fixture(
    "snapshots/refund-of-one-source-other-remains-active.json",
  );
  const entry = document.payload.snapshot.entries[0];
  assert.equal(entry.state, "active");
  const states = Object.fromEntries(
    document.payload.snapshot.sources.map((source) => [source.sourceId, source.sourceState]),
  );
  assert.equal(states["fixture-source-subscription-0001"], "not_granting");
  assert.equal(states["fixture-source-lifetime-0001"], "granting");
});

test("every contributing source is exposed, never collapsed to a winner", () => {
  const document = fixture("snapshots/multiple-active-sources.json");
  const entry = document.payload.snapshot.entries[0];
  assert.equal(entry.sourceCount, 3);
  assert.equal(entry.sourceIds.length, 3);
  assert.equal(document.payload.snapshot.sources.length, 3);
});

test("an active entry always has a granting source", () => {
  const snapshot = fixture("ios-full-snapshot.json").payload.snapshot;
  snapshot.sources[0].sourceState = "not_granting";
  snapshot.contentDigest = canonicalDigest(snapshot, "contentDigest");
  const errors = snapshotSemantics("snapshot", snapshot);
  assert.ok(
    errors.some((error) => error.includes("no contributing source is granting")),
    `expected a granting-source error, got: ${errors.join("; ")}`,
  );
});

test("an entry is never inactive while its evidence is uncertain", () => {
  // Unresolved evidence yields unknown. Reporting inactive here is how a
  // projection outage becomes an apparent cancellation.
  const snapshot = fixture("ios-full-snapshot.json").payload.snapshot;
  snapshot.entries[0].state = "inactive";
  snapshot.sources[0].sourceState = "unknown";
  snapshot.sources[0].uncertainty = {
    reason: "provider_unavailable",
    since: "2026-07-28T11:00:00.000Z",
  };
  snapshot.contentDigest = canonicalDigest(snapshot, "contentDigest");
  const errors = snapshotSemantics("snapshot", snapshot);
  assert.ok(
    errors.some((error) => error.includes("unresolved evidence yields unknown")),
    `expected an uncertain-evidence error, got: ${errors.join("; ")}`,
  );
});

test("the content digest binds a snapshot to one customer, Project, and Environment", () => {
  const snapshot = fixture("ios-full-snapshot.json").payload.snapshot;
  assert.deepEqual(snapshotSemantics("snapshot", snapshot), []);

  for (const member of ["billingCustomerId", "projectId", "environmentId", "snapshotVersion"]) {
    const tampered = fixture("ios-full-snapshot.json").payload.snapshot;
    tampered[member] =
      typeof tampered[member] === "number"
        ? tampered[member] + 1
        : "fixture-other-0002";
    assert.notDeepEqual(
      snapshotSemantics("snapshot", tampered),
      [],
      `${member} is not covered by the content digest`,
    );
  }
});

test("snapshot versions are monotonic against their own predecessor", () => {
  const snapshot = fixture("ios-full-snapshot.json").payload.snapshot;
  snapshot.snapshotVersion = snapshot.previousSnapshotVersion;
  snapshot.contentDigest = canonicalDigest(snapshot, "contentDigest");
  const errors = snapshotSemantics("snapshot", snapshot);
  assert.ok(
    errors.some((error) => error.includes("monotonic per customer per Environment")),
    `expected a monotonicity error, got: ${errors.join("; ")}`,
  );
});

test("the never-projected placeholder dates its projection at its own asOf", () => {
  const snapshot = fixture("source-snapshot.json").payload.snapshot;
  assert.equal(snapshot.snapshotVersion, 0);
  assert.deepEqual(snapshotSemantics("snapshot", snapshot), []);
  snapshot.projectionStatus.lastProjectedAt = "2026-01-01T00:00:00.000Z";
  snapshot.contentDigest = canonicalDigest(snapshot, "contentDigest");
  assert.notDeepEqual(snapshotSemantics("snapshot", snapshot), []);
});

test("the Entitlement key vocabulary is the Commerce Configuration one", () => {
  // One key vocabulary spans catalogue and access. If these drifted, a Product
  // could grant a key no Entitlement could ever be named.
  const commerce = readJson(
    resolve(root, "schema/commerce-configuration/v2/configuration.schema.json"),
  );
  assert.equal(
    snapshotSchema.$defs.entitlementKey.pattern,
    commerce.$defs.entitlementKey.pattern,
  );
  assert.equal(
    snapshotSchema.$defs.entitlementKey.maxLength,
    commerce.$defs.entitlementKey.maxLength,
  );
});

test("an unknown Entitlement key is project data and is accepted", () => {
  // Defining a new Entitlement must never be a breaking change for an SDK that
  // shipped before it existed.
  assert.equal(
    artifacts.manifest.readerPolicy.unknownEntitlementKey,
    "acceptAsProjectData",
  );
  const snapshot = fixture("ios-full-snapshot.json").payload.snapshot;
  snapshot.entries[0].entitlementKey = "a_key_no_reader_has_ever_seen";
  snapshot.contentDigest = canonicalDigest(snapshot, "contentDigest");
  assert.deepEqual(snapshotSemantics("snapshot", snapshot), []);
});

test("no fixture carries a signed-payload-shaped value", () => {
  const jws = /^[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{8,}$/;
  const strings = (value) =>
    typeof value === "string"
      ? [value]
      : value !== null && typeof value === "object"
        ? Object.values(value).flatMap(strings)
        : [];
  for (const path of artifacts.validFixturePaths) {
    for (const value of strings(readJson(path))) assert.doesNotMatch(value, jws);
  }
});

test("every snapshot digest vector is the SHA-256 of its canonical serialization", () => {
  const document = vectors("entitlement-snapshot-digest-vectors.json");
  assert.equal(document.canonicalSerialization.form, "minifiedJsonSortedKeys");

  const digests = new Set();
  for (const vector of document.vectors) {
    const serialized = canonicalSerialization(vector.payload);
    assert.equal(
      serialized,
      vector.canonicalSerialization,
      `${vector.id} canonical serialization drifted`,
    );
    assert.equal(
      Buffer.byteLength(serialized, "utf8"),
      vector.canonicalByteLength,
      `${vector.id} declares the wrong UTF-8 byte length`,
    );
    assert.equal(
      `sha256:${createHash("sha256").update(serialized, "utf8").digest("hex")}`,
      vector.digest,
      `${vector.id} digest is not SHA-256 over its canonical serialization`,
    );
    digests.add(vector.digest);
  }
  assert.equal(digests.size, document.vectors.length, "distinct payloads must hash distinctly");

  // Absent and present are different states, which is why null is forbidden.
  const absent = document.vectors.find((vector) => vector.id === "absent-optional");
  const present = document.vectors.find((vector) => vector.id === "present-optional");
  assert.notEqual(absent.digest, present.digest);

  // The vector that catches a UTF-16 or Latin-1 implementation must contain
  // non-ASCII, or it catches nothing.
  const nonAscii = document.vectors.find((vector) => vector.id === "non-ascii-safe-text");
  assert.match(nonAscii.payload.safeSummary, /[^\x00-\x7F]/);
});

test("the canonical digest vector agrees with the canonical fixture", () => {
  const document = vectors("entitlement-snapshot-digest-vectors.json");
  const vector = document.vectors.find(
    (candidate) => candidate.id === "canonical-fixture-snapshot",
  );
  // The active-subscription scenario is embedded verbatim in the iOS full
  // snapshot; the vector must keep matching its contentDigest.
  const snapshot = fixture("ios-full-snapshot.json").payload.snapshot;
  assert.equal(
    vector.digest,
    snapshot.contentDigest,
    "the canonical vector and the canonical fixture have drifted apart",
  );
});

test("cache-decision vectors never resolve a rejection to inactive", () => {
  const document = vectors("entitlement-cache-decision-vectors.json");
  assert.ok(document.vectors.length >= 8);
  const seen = new Set();
  for (const vector of document.vectors) {
    assert.ok(["accept", "reject"].includes(vector.decision), vector.id);
    assert.ok(["preserve", "clear", "replace"].includes(vector.cacheAction), vector.id);
    assert.doesNotMatch(
      vector.resultingAccessState,
      /^inactive$/,
      `${vector.id} resolves a cache decision to inactive`,
    );
    if (vector.decision === "reject") {
      assert.notEqual(vector.cacheAction, "replace", vector.id);
    }
    seen.add(vector.reason);
  }
  // The reasons the SDKs branch on must all be represented.
  for (const reason of [
    "snapshot_version_not_newer",
    "customer_mismatch",
    "environment_mismatch",
    "content_digest_mismatch",
    "unsupported_contract_version",
    "as_of_regression",
  ]) {
    assert.ok(seen.has(reason), `no cache-decision vector covers ${reason}`);
  }

  // A binding mismatch is the one rejection that clears rather than preserves.
  for (const id of ["different-customer-clears-cache", "version-regression-after-environment-change"]) {
    const vector = document.vectors.find((candidate) => candidate.id === id);
    assert.equal(vector.cacheAction, "clear", id);
    assert.equal(vector.resultingAccessState, "unknown", id);
  }
});

test("freshness vectors agree with the window they declare", () => {
  const document = vectors("entitlement-freshness-vectors.json");
  const skew = document.policy.clockSkewToleranceSeconds * 1000;
  assert.equal(skew, 60_000);

  for (const vector of document.vectors) {
    const { issuedAt, refreshAfter, validUntil, staleGraceSeconds } = vector.snapshot;
    const now = Date.parse(vector.deviceNow);
    const graceEnd = Date.parse(validUntil) + staleGraceSeconds * 1000;

    let expected;
    if (now < Date.parse(issuedAt) - skew) {
      expected = "expired"; // unreliable clock forces expired-equivalent behaviour
    } else if (now <= Date.parse(refreshAfter) + skew) {
      expected = "fresh";
    } else if (now <= Date.parse(validUntil) + skew) {
      expected = "refresh_recommended";
    } else if (now <= graceEnd + skew) {
      expected = "stale_within_grace";
    } else {
      expected = "expired";
    }
    assert.equal(vector.state, expected, `${vector.id} disagrees with the declared window`);
  }

  const states = new Set(document.vectors.map((vector) => vector.state));
  for (const state of ["fresh", "refresh_recommended", "stale_within_grace", "expired"]) {
    assert.ok(states.has(state), `no freshness vector produces ${state}`);
  }

  // A backwards clock must never read as fresh: that is unlimited offline access
  // for anyone willing to change their device time.
  const backwards = document.vectors.find(
    (vector) => vector.id === "backwards-clock-before-issued-at",
  );
  assert.equal(backwards.state, "expired");
});

test("the freshness policy matches the limits the manifest pins", () => {
  const document = vectors("entitlement-freshness-vectors.json");
  const limits = artifacts.manifest.limits;
  assert.equal(document.policy.clockSkewToleranceSeconds, limits.clockSkewToleranceSeconds);
  assert.equal(document.policy.defaultRefreshAfterSeconds, limits.defaultRefreshAfterSeconds);
  assert.equal(document.policy.defaultValidUntilSeconds, limits.defaultValidUntilSeconds);
  assert.equal(document.policy.defaultStaleGraceSeconds, limits.defaultStaleGraceSeconds);
  assert.equal(document.policy.maxStaleGraceSeconds, limits.maxStaleGraceSeconds);
  assert.equal(document.policy.maxCacheHorizonSeconds, limits.maxCacheHorizonSeconds);
});

test("bounded grace is the shipped default, and strict is still expressible", () => {
  // A zero default would ship the strict policy under a bounded-grace decision.
  assert.equal(artifacts.manifest.limits.defaultStaleGraceSeconds, 86400);
  const document = vectors("entitlement-freshness-vectors.json");
  const strict = document.vectors.find(
    (vector) => vector.id === "strict-policy-past-valid-until",
  );
  assert.equal(strict.snapshot.staleGraceSeconds, 0);
  assert.equal(strict.state, "expired");
});

test("validity plus stale grace may never exceed thirty days", () => {
  // Bounding each field alone lets a 30-day validity and a 30-day grace window
  // compose into 60 days of offline access Mosaic never confirmed.
  assert.equal(artifacts.manifest.limits.maxCacheHorizonSeconds, 2592000);

  const snapshot = fixture("snapshots/bounded-offline-cache.json").payload.snapshot;
  assert.deepEqual(snapshotSemantics("snapshot", snapshot), []);

  snapshot.validUntil = "2026-08-27T12:00:00.000Z"; // 30 days of validity
  snapshot.staleGraceSeconds = 86400; // plus a day of grace
  snapshot.contentDigest = canonicalDigest(snapshot, "contentDigest");
  const errors = snapshotSemantics("snapshot", snapshot);
  assert.ok(
    errors.some((error) => error.includes("combined offline horizon")),
    `expected a combined-horizon error, got: ${errors.join("; ")}`,
  );
});

test("an unchanged response is bound by the same horizon as a snapshot", () => {
  // Otherwise the bound could be evaded by confirming a snapshot rather than
  // reissuing it.
  const unchanged = fixture("snapshot-unchanged.json").payload.unchanged;
  assert.deepEqual(freshnessWindowSemantics("unchanged", unchanged), []);
  unchanged.validUntil = "2026-09-27T12:45:00.000Z";
  assert.notDeepEqual(freshnessWindowSemantics("unchanged", unchanged), []);
});

test("the carried-forward record types all validate through the single envelope", () => {
  // The check, subscription, and restore surface of Contract 1 lives on in the
  // v2 envelope; losing a record type here would be losing product surface.
  assert.deepEqual(artifacts.schema.properties.recordType.enum, [
    "entitlementSyncRequest",
    "customerEntitlementSnapshot",
    "snapshotUnchanged",
    "authorityUnavailable",
    "entitlementCheckRequest",
    "entitlementCheckResult",
    "subscriptionSnapshot",
    "restoreResult",
  ]);
  assert.deepEqual(validatePhase9CArtifacts(artifacts), []);
});
