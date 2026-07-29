/**
 * Authoritative Entitlement Contract v1 validation.
 *
 * The contract is five canonical schemas plus a compatibility manifest. Each
 * schema is a self-describing envelope: `authoritativeEntitlementContractVersion`,
 * `recordType`, and a `payload` dispatched by record type. A fixture's directory
 * therefore determines which schema it is a document of.
 *
 * Most of this contract's rules are expressible in JSON Schema and are expressed
 * there -- revoked implies inactive, grace implies a grace end, unknown implies a
 * reason, `unavailable` is structurally impossible inside a persisted snapshot
 * entry. What remains here is what JSON Schema cannot state:
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
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import { REJECTION_LAYERS_FILENAME } from "./generate-rejection-layers.mjs";

const toolsDirectory = dirname(fileURLToPath(import.meta.url));
export const authoritativeEntitlementV1Root = resolve(toolsDirectory, "..");

const schemaPath = (name) =>
  resolve(
    authoritativeEntitlementV1Root,
    `schema/authoritative-entitlement/v1/${name}.schema.json`,
  );

export const authoritativeEntitlementV1Paths = Object.freeze({
  snapshotSchema: schemaPath("snapshot"),
  syncRequestSchema: schemaPath("sync-request"),
  checkSchema: schemaPath("check"),
  subscriptionSchema: schemaPath("subscription"),
  restoreSchema: schemaPath("restore"),
  compatibilityManifestSchema: schemaPath("compatibility-manifest"),
  compatibilityManifest: resolve(
    authoritativeEntitlementV1Root,
    "compatibility/authoritative-entitlement/v1.json",
  ),
  fixtureDirectory: resolve(
    authoritativeEntitlementV1Root,
    "fixtures/authoritative-entitlement/v1",
  ),
});

/** Fixture directory to the schema its documents belong to. */
const FIXTURE_FAMILIES = Object.freeze({
  snapshots: "snapshot",
  sync: "syncRequest",
  checks: "check",
  subscriptions: "subscription",
  restores: "restore",
});

/** Record types each schema accepts, used to catch misfiled fixtures. */
const FAMILY_RECORD_TYPES = Object.freeze({
  snapshot: ["customerEntitlementSnapshot", "snapshotUnchanged"],
  syncRequest: ["entitlementSyncRequest"],
  check: ["entitlementCheckRequest", "entitlementCheckResult"],
  subscription: ["subscriptionSnapshot"],
  restore: ["restoreResult"],
});

export function readAuthoritativeEntitlementV1Json(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function jsonPaths(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return jsonPaths(path);
      if (entry.name === REJECTION_LAYERS_FILENAME) return [];
      return entry.name.endsWith(".json") ? [path] : [];
    })
    .sort();
}

function familyOf(path) {
  const directory = dirname(
    relative(authoritativeEntitlementV1Paths.fixtureDirectory, path),
  );
  return FIXTURE_FAMILIES[directory];
}

export function loadAuthoritativeEntitlementV1Artifacts() {
  const fixturePaths = jsonPaths(
    authoritativeEntitlementV1Paths.fixtureDirectory,
  );
  const validFixturePaths = fixturePaths.filter(
    (path) => !path.includes("/invalid/"),
  );
  const invalidFixturePaths = fixturePaths.filter((path) =>
    path.includes("/invalid/"),
  );
  return {
    snapshotSchema: readAuthoritativeEntitlementV1Json(
      authoritativeEntitlementV1Paths.snapshotSchema,
    ),
    syncRequestSchema: readAuthoritativeEntitlementV1Json(
      authoritativeEntitlementV1Paths.syncRequestSchema,
    ),
    checkSchema: readAuthoritativeEntitlementV1Json(
      authoritativeEntitlementV1Paths.checkSchema,
    ),
    subscriptionSchema: readAuthoritativeEntitlementV1Json(
      authoritativeEntitlementV1Paths.subscriptionSchema,
    ),
    restoreSchema: readAuthoritativeEntitlementV1Json(
      authoritativeEntitlementV1Paths.restoreSchema,
    ),
    compatibilityManifestSchema: readAuthoritativeEntitlementV1Json(
      authoritativeEntitlementV1Paths.compatibilityManifestSchema,
    ),
    compatibilityManifest: readAuthoritativeEntitlementV1Json(
      authoritativeEntitlementV1Paths.compatibilityManifest,
    ),
    fixturePaths,
    validFixturePaths,
    invalidFixturePaths,
    validFixtures: validFixturePaths.map(readAuthoritativeEntitlementV1Json),
    invalidFixtures: invalidFixturePaths.map(readAuthoritativeEntitlementV1Json),
  };
}

function validators(artifacts) {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
    strictTypes: false,
  });
  for (const schema of [
    artifacts.snapshotSchema,
    artifacts.syncRequestSchema,
    artifacts.checkSchema,
    artifacts.subscriptionSchema,
    artifacts.restoreSchema,
    artifacts.compatibilityManifestSchema,
  ]) {
    ajv.addSchema(schema);
  }
  return {
    snapshot: ajv.getSchema(artifacts.snapshotSchema.$id),
    syncRequest: ajv.getSchema(artifacts.syncRequestSchema.$id),
    check: ajv.getSchema(artifacts.checkSchema.$id),
    subscription: ajv.getSchema(artifacts.subscriptionSchema.$id),
    restore: ajv.getSchema(artifacts.restoreSchema.$id),
    manifest: ajv.getSchema(artifacts.compatibilityManifestSchema.$id),
  };
}

function describeSchemaError(label, error) {
  const at = `${label}${error.instancePath || "/"}`;
  const offending =
    error.params?.unevaluatedProperty ?? error.params?.additionalProperty;
  if (offending !== undefined) {
    return `${at}.${offending} is not allowed`;
  }
  return `${at} ${error.message ?? "is invalid"}`;
}

function schemaErrors(label, errors = []) {
  const specific = errors.filter((error) => error.keyword !== "oneOf");
  const reported = specific.length > 0 ? specific : errors;
  return [
    ...new Set(reported.map((error) => describeSchemaError(label, error))),
  ];
}

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
 * examples SDK authors copy. Unlike Billing Ingestion this validator does not
 * police field *names* -- entitlement, subscription, and customer vocabulary is
 * exactly what this contract is about -- only values.
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
function freshnessWindowSemantics(label, payload) {
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

function snapshotSemantics(label, payload) {
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

function subscriptionSemantics(label, payload) {
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

function checkSemantics(label, payload) {
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

function restoreSemantics(label, payload) {
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

function recordSemantics(label, document) {
  const errors = [];
  if (encodedBytes(document) > 65_536) {
    errors.push(`${label} exceeds the 64 KiB record limit`);
  }
  walkValues(document, "", (value, path) => {
    if (JWS_SHAPE.test(value)) {
      errors.push(`${label}${path} carries a signed-payload-shaped value`);
    }
  });

  const payload = document.payload;
  switch (document.recordType) {
    case "customerEntitlementSnapshot":
      errors.push(...snapshotSemantics(label, payload));
      break;
    case "snapshotUnchanged":
      // An unchanged response slides the freshness window, so it is bound by
      // the same horizon a snapshot is. Otherwise the bound could be evaded by
      // confirming a snapshot rather than reissuing it.
      errors.push(...freshnessWindowSemantics(label, payload));
      break;
    case "subscriptionSnapshot":
      errors.push(...subscriptionSemantics(label, payload));
      break;
    case "entitlementCheckResult":
      errors.push(...checkSemantics(label, payload));
      break;
    case "restoreResult":
      errors.push(...restoreSemantics(label, payload));
      break;
    default:
      break;
  }
  return errors;
}

export function validateAuthoritativeEntitlementV1Record(
  document,
  artifacts,
  label = "Entitlement record",
) {
  const compiled = validators(artifacts);
  const family = Object.entries(FAMILY_RECORD_TYPES).find(([, types]) =>
    types.includes(document?.recordType),
  )?.[0];
  if (family === undefined) {
    return [`${label} declares unknown record type ${document?.recordType}`];
  }
  const validate = compiled[family];
  if (!validate(document)) return schemaErrors(label, validate.errors);
  return recordSemantics(label, document);
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
function validateFailClosedVocabulary(artifacts) {
  const errors = [];
  const persisted = artifacts.snapshotSchema.$defs.persistedEntitlementState.enum;
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
  const issued = artifacts.snapshotSchema.$defs.snapshotVersion;
  const placeholder = artifacts.snapshotSchema.$defs.snapshotVersionOrPlaceholder;
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

  const policy = artifacts.compatibilityManifest.readerPolicy ?? {};
  for (const [key, value] of Object.entries(policy)) {
    // `...NeverInactive` is the rule being stated, not broken.
    if (typeof value === "string" && /(?<!never)inactive/i.test(value)) {
      errors.push(
        `Reader policy ${key} resolves to "${value}"; no failure, rejection, or expiry may ever resolve to inactive`,
      );
    }
  }
  return errors;
}

function validateCompatibility(artifacts) {
  const compiled = validators(artifacts);
  if (!compiled.manifest(artifacts.compatibilityManifest)) {
    return schemaErrors(
      "Authoritative Entitlement compatibility manifest",
      compiled.manifest.errors,
    );
  }
  const errors = [];
  const manifest = artifacts.compatibilityManifest;

  const declared = artifacts.snapshotSchema.$defs.recordType.enum;
  const listed = manifest.recordTypes;
  if (
    listed.length !== declared.length ||
    declared.some((recordType) => !listed.includes(recordType))
  ) {
    errors.push("Authoritative Entitlement record-type set is incomplete");
  }
  const dispatched = Object.values(FAMILY_RECORD_TYPES).flat();
  for (const recordType of declared) {
    if (!dispatched.includes(recordType)) {
      errors.push(
        `Authoritative Entitlement record type ${recordType} has no schema that dispatches it`,
      );
    }
  }

  const axes = {
    accessState: artifacts.snapshotSchema.$defs.accessState.enum,
    lifecycleState: artifacts.snapshotSchema.$defs.lifecycleState.enum,
    renewalIntent: artifacts.snapshotSchema.$defs.renewalIntent.enum,
    billingState: artifacts.snapshotSchema.$defs.billingState.enum,
    uncertaintyReason: artifacts.snapshotSchema.$defs.uncertaintyReason.enum,
    persistedEntitlementState:
      artifacts.snapshotSchema.$defs.persistedEntitlementState.enum,
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

  const manifestDirectory = dirname(
    authoritativeEntitlementV1Paths.compatibilityManifest,
  );
  for (const path of [
    ...Object.values(manifest.schemas),
    ...manifest.canonicalFixtures,
  ]) {
    if (!existsSync(resolve(manifestDirectory, path))) {
      errors.push(`Authoritative Entitlement compatibility path does not exist: ${path}`);
    }
  }

  const canonical = new Set(
    manifest.canonicalFixtures.map((path) => resolve(manifestDirectory, path)),
  );
  for (const path of artifacts.validFixturePaths) {
    if (!canonical.has(path)) {
      errors.push(
        `Authoritative Entitlement fixture ${relative(authoritativeEntitlementV1Root, path)} is not listed in the compatibility manifest`,
      );
    }
  }
  const covered = new Set(
    artifacts.validFixtures.map((document) => document.recordType),
  );
  for (const recordType of declared) {
    if (!covered.has(recordType)) {
      errors.push(
        `Authoritative Entitlement record type ${recordType} has no canonical fixture`,
      );
    }
  }
  return errors;
}

export function validateAuthoritativeEntitlementV1Artifacts(artifacts) {
  const compiled = validators(artifacts);
  const errors = [
    ...validateFailClosedVocabulary(artifacts),
    ...validateCompatibility(artifacts),
  ];

  for (const [index, document] of artifacts.validFixtures.entries()) {
    const path = artifacts.validFixturePaths[index];
    const label = `Entitlement fixture ${relative(authoritativeEntitlementV1Root, path)}`;
    const family = familyOf(path);
    if (family === undefined) {
      errors.push(`${label} is in a directory with no schema family`);
      continue;
    }
    if (!FAMILY_RECORD_TYPES[family].includes(document.recordType)) {
      errors.push(
        `${label} declares ${document.recordType}, which does not belong in this directory`,
      );
      continue;
    }
    const validate = compiled[family];
    if (!validate(document)) {
      errors.push(...schemaErrors(label, validate.errors));
      continue;
    }
    errors.push(...recordSemantics(label, document));
  }

  for (const [index, document] of artifacts.invalidFixtures.entries()) {
    const path = artifacts.invalidFixturePaths[index];
    const label = `Invalid Entitlement fixture ${relative(authoritativeEntitlementV1Root, path)}`;
    const accepted = Object.keys(FAMILY_RECORD_TYPES).some((family) => {
      const validate = compiled[family];
      return validate(document) && recordSemantics(label, document).length === 0;
    });
    if (accepted) errors.push(`${label} was accepted`);
  }

  return errors;
}

export function validateAuthoritativeEntitlementV1JsonFormatting() {
  const paths = [
    authoritativeEntitlementV1Paths.snapshotSchema,
    authoritativeEntitlementV1Paths.syncRequestSchema,
    authoritativeEntitlementV1Paths.checkSchema,
    authoritativeEntitlementV1Paths.subscriptionSchema,
    authoritativeEntitlementV1Paths.restoreSchema,
    authoritativeEntitlementV1Paths.compatibilityManifestSchema,
    authoritativeEntitlementV1Paths.compatibilityManifest,
    ...jsonPaths(authoritativeEntitlementV1Paths.fixtureDirectory),
  ];
  return paths.flatMap((path) => {
    const source = readFileSync(path, "utf8");
    const canonical = `${JSON.stringify(JSON.parse(source), null, 2)}\n`;
    return source === canonical
      ? []
      : [
          `${relative(authoritativeEntitlementV1Root, path)} is not canonical JSON`,
        ];
  });
}
