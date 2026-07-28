/**
 * Customer Access Token Contract v1 validation.
 *
 * One canonical schema plus a compatibility manifest. The contract describes an
 * OPAQUE credential, so there is nothing inside a token to validate: everything
 * here validates metadata *about* a token, and the most valuable checks are the
 * two that watch the contract itself.
 *
 *   - `validateOpaqueTokenModel` fails if the contract ever grows a signing
 *     vocabulary -- an algorithm, a key identifier, a JWK, a JWS header. The
 *     opaque model is an owner-approved deviation from the orchestration
 *     prompt's "signed" wording, and a deviation that can drift back silently is
 *     not a decision, it is a coincidence.
 *   - the same guard fails if any property name suggests the token carries
 *     access state. A token that carried entitlements would keep granting them
 *     after a refund, for as long as it lived.
 *
 * The semantic layer otherwise covers lifetime arithmetic, revocation ordering,
 * and the forbidden-value walk ported from Billing Ingestion.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import { REJECTION_LAYERS_FILENAME } from "./generate-rejection-layers.mjs";

const toolsDirectory = dirname(fileURLToPath(import.meta.url));
export const customerAccessTokenV1Root = resolve(toolsDirectory, "..");

export const customerAccessTokenV1Paths = Object.freeze({
  tokenSchema: resolve(
    customerAccessTokenV1Root,
    "schema/customer-access-token/v1/token.schema.json",
  ),
  compatibilityManifestSchema: resolve(
    customerAccessTokenV1Root,
    "schema/customer-access-token/v1/compatibility-manifest.schema.json",
  ),
  compatibilityManifest: resolve(
    customerAccessTokenV1Root,
    "compatibility/customer-access-token/v1.json",
  ),
  fixtureDirectory: resolve(
    customerAccessTokenV1Root,
    "fixtures/customer-access-token/v1",
  ),
});

const RECORD_TYPES = Object.freeze([
  "customerAccessTokenIssuanceRequest",
  "customerAccessTokenIssuanceResult",
  "customerAccessTokenMetadata",
  "customerAccessTokenRevocation",
]);

export function readCustomerAccessTokenV1Json(filePath) {
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

export function loadCustomerAccessTokenV1Artifacts() {
  const fixturePaths = jsonPaths(customerAccessTokenV1Paths.fixtureDirectory);
  const validFixturePaths = fixturePaths.filter(
    (path) => !path.includes("/invalid/"),
  );
  const invalidFixturePaths = fixturePaths.filter((path) =>
    path.includes("/invalid/"),
  );
  return {
    tokenSchema: readCustomerAccessTokenV1Json(
      customerAccessTokenV1Paths.tokenSchema,
    ),
    compatibilityManifestSchema: readCustomerAccessTokenV1Json(
      customerAccessTokenV1Paths.compatibilityManifestSchema,
    ),
    compatibilityManifest: readCustomerAccessTokenV1Json(
      customerAccessTokenV1Paths.compatibilityManifest,
    ),
    fixturePaths,
    validFixturePaths,
    invalidFixturePaths,
    validFixtures: validFixturePaths.map(readCustomerAccessTokenV1Json),
    invalidFixtures: invalidFixturePaths.map(readCustomerAccessTokenV1Json),
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
    artifacts.tokenSchema,
    artifacts.compatibilityManifestSchema,
  ]) {
    ajv.addSchema(schema);
  }
  return {
    token: ajv.getSchema(artifacts.tokenSchema.$id),
    manifest: ajv.getSchema(artifacts.compatibilityManifestSchema.$id),
  };
}

function describeSchemaError(label, error) {
  const at = `${label}${error.instancePath || "/"}`;
  const offending =
    error.params?.unevaluatedProperty ?? error.params?.additionalProperty;
  if (offending !== undefined) return `${at}.${offending} is not allowed`;
  return `${at} ${error.message ?? "is invalid"}`;
}

function schemaErrors(label, errors = []) {
  const specific = errors.filter((error) => error.keyword !== "oneOf");
  const reported = specific.length > 0 ? specific : errors;
  return [
    ...new Set(reported.map((error) => describeSchemaError(label, error))),
  ];
}

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

const MAXIMUM_LIFETIME_SECONDS = 86_400;

function metadataSemantics(label, metadata) {
  const errors = [];
  const issued = Date.parse(metadata.issuedAt);
  const expires = Date.parse(metadata.expiresAt);
  if (expires <= issued) {
    errors.push(`${label} expires before or when it was issued`);
  } else if ((expires - issued) / 1000 > MAXIMUM_LIFETIME_SECONDS) {
    errors.push(
      `${label} lives longer than the ${MAXIMUM_LIFETIME_SECONDS}-second maximum; ` +
        "a short life is the only thing limiting the damage of a leaked opaque token",
    );
  }
  if (
    metadata.notBefore !== undefined &&
    Date.parse(metadata.notBefore) > expires
  ) {
    errors.push(`${label} becomes valid after it expires`);
  }
  if (
    metadata.revokedAt !== undefined &&
    Date.parse(metadata.revokedAt) < issued
  ) {
    errors.push(`${label} was revoked before it was issued`);
  }
  if (
    metadata.lastUsedAt !== undefined &&
    Date.parse(metadata.lastUsedAt) < issued
  ) {
    errors.push(`${label} was used before it was issued`);
  }
  return errors;
}

function recordSemantics(label, document) {
  const errors = [];
  if (Buffer.byteLength(JSON.stringify(document), "utf8") > 8_192) {
    errors.push(`${label} exceeds the 8 KiB record limit`);
  }
  walkValues(document, "", (value, path) => {
    if (JWS_SHAPE.test(value)) {
      errors.push(
        `${label}${path} carries a signed-payload-shaped value; a Customer Access Token is opaque and this contract carries no signed material`,
      );
    }
  });

  const payload = document.payload;
  if (document.recordType === "customerAccessTokenMetadata") {
    errors.push(...metadataSemantics(label, payload));
  }
  if (document.recordType === "customerAccessTokenIssuanceResult") {
    errors.push(...metadataSemantics(`${label} metadata`, payload.metadata));
    if (payload.metadata.status !== "active") {
      errors.push(
        `${label} issues a token whose metadata is already ${payload.metadata.status}`,
      );
    }
  }
  return errors;
}

export function validateCustomerAccessTokenV1Record(
  document,
  artifacts,
  label = "Customer Access Token record",
) {
  const compiled = validators(artifacts);
  if (!RECORD_TYPES.includes(document?.recordType)) {
    return [`${label} declares unknown record type ${document?.recordType}`];
  }
  if (!compiled.token(document)) {
    return schemaErrors(label, compiled.token.errors);
  }
  return recordSemantics(label, document);
}

/**
 * Guards the contract itself. The token is opaque by an explicit owner decision;
 * these two checks are what stop that decision from decaying into a signed token
 * or a token that carries access.
 */
function validateOpaqueTokenModel(artifacts) {
  const errors = [];
  const signing = /^(alg|kid|jwk|jwks|jws|jwt|signature|signingKey|publicKey|privateKey|keyId)$/i;
  const accessState =
    /(entitlement|accessState|grant|subscription|snapshotVersion)/i;

  const walk = (node, path) => {
    if (node === null || typeof node !== "object") return;
    for (const name of Object.keys(node.properties ?? {})) {
      if (signing.test(name)) {
        errors.push(
          `Customer Access Token contract declares "${name}" at ${path}; the token is opaque and has no signing vocabulary`,
        );
      }
      if (accessState.test(name)) {
        errors.push(
          `Customer Access Token contract declares "${name}" at ${path}; a token never carries access state, or it would outlive a refund`,
        );
      }
    }
    for (const [key, child] of Object.entries(node)) {
      walk(child, `${path}/${key}`);
    }
  };
  walk(artifacts.tokenSchema, "");

  const model = artifacts.compatibilityManifest.tokenModel;
  if (model.signed !== false) {
    errors.push("Customer Access Token model claims to be signed; v1 tokens are opaque");
  }
  if (model.carriesEntitlementState !== false) {
    errors.push("Customer Access Token model claims to carry Entitlement state");
  }
  if (model.storage !== "digestOnly") {
    errors.push(
      "Customer Access Token storage must be digest-only; Mosaic never holds a token it could replay",
    );
  }
  return errors;
}

function validateCompatibility(artifacts) {
  const compiled = validators(artifacts);
  if (!compiled.manifest(artifacts.compatibilityManifest)) {
    return schemaErrors(
      "Customer Access Token compatibility manifest",
      compiled.manifest.errors,
    );
  }
  const errors = [];
  const manifest = artifacts.compatibilityManifest;

  const declared = artifacts.tokenSchema.$defs.recordType.enum;
  if (
    manifest.recordTypes.length !== declared.length ||
    declared.some((recordType) => !manifest.recordTypes.includes(recordType))
  ) {
    errors.push("Customer Access Token record-type set is incomplete");
  }
  if (manifest.lifetime.maximumSeconds !== MAXIMUM_LIFETIME_SECONDS) {
    errors.push(
      "Customer Access Token manifest pins a maximum lifetime the validator does not enforce",
    );
  }

  const manifestDirectory = dirname(
    customerAccessTokenV1Paths.compatibilityManifest,
  );
  for (const path of [
    ...Object.values(manifest.schemas),
    ...manifest.canonicalFixtures,
  ]) {
    if (!existsSync(resolve(manifestDirectory, path))) {
      errors.push(`Customer Access Token compatibility path does not exist: ${path}`);
    }
  }
  const canonical = new Set(
    manifest.canonicalFixtures.map((path) => resolve(manifestDirectory, path)),
  );
  for (const path of artifacts.validFixturePaths) {
    if (!canonical.has(path)) {
      errors.push(
        `Customer Access Token fixture ${relative(customerAccessTokenV1Root, path)} is not listed in the compatibility manifest`,
      );
    }
  }
  const covered = new Set(
    artifacts.validFixtures.map((document) => document.recordType),
  );
  for (const recordType of declared) {
    if (!covered.has(recordType)) {
      errors.push(
        `Customer Access Token record type ${recordType} has no canonical fixture`,
      );
    }
  }
  return errors;
}

export function validateCustomerAccessTokenV1Artifacts(artifacts) {
  const compiled = validators(artifacts);
  const errors = [
    ...validateOpaqueTokenModel(artifacts),
    ...validateCompatibility(artifacts),
  ];

  for (const [index, document] of artifacts.validFixtures.entries()) {
    const path = artifacts.validFixturePaths[index];
    const label = `Customer Access Token fixture ${relative(customerAccessTokenV1Root, path)}`;
    if (!RECORD_TYPES.includes(document.recordType)) {
      errors.push(`${label} declares unknown record type ${document.recordType}`);
      continue;
    }
    if (!compiled.token(document)) {
      errors.push(...schemaErrors(label, compiled.token.errors));
      continue;
    }
    errors.push(...recordSemantics(label, document));
  }

  for (const [index, document] of artifacts.invalidFixtures.entries()) {
    const path = artifacts.invalidFixturePaths[index];
    const label = `Invalid Customer Access Token fixture ${relative(customerAccessTokenV1Root, path)}`;
    if (
      compiled.token(document) &&
      recordSemantics(label, document).length === 0
    ) {
      errors.push(`${label} was accepted`);
    }
  }

  return errors;
}

export function validateCustomerAccessTokenV1JsonFormatting() {
  const paths = [
    customerAccessTokenV1Paths.tokenSchema,
    customerAccessTokenV1Paths.compatibilityManifestSchema,
    customerAccessTokenV1Paths.compatibilityManifest,
    ...jsonPaths(customerAccessTokenV1Paths.fixtureDirectory),
  ];
  return paths.flatMap((path) => {
    const source = readFileSync(path, "utf8");
    const canonical = `${JSON.stringify(JSON.parse(source), null, 2)}\n`;
    return source === canonical
      ? []
      : [`${relative(customerAccessTokenV1Root, path)} is not canonical JSON`];
  });
}
