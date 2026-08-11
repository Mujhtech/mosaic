import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import { releaseMaterialDigest, sha256Digest } from "./delivery-v1-common.mjs";
import {
  loadProtocolV03Artifacts,
  validateProtocolV03,
} from "./validation-v0.3.mjs";

const toolsDirectory = dirname(fileURLToPath(import.meta.url));
export const deliveryV1Root = resolve(toolsDirectory, "..");

export const deliveryV1Paths = Object.freeze({
  releaseSchema: resolve(
    deliveryV1Root,
    "schema/configuration-delivery/v1/release.schema.json",
  ),
  capabilityRequestSchema: resolve(
    deliveryV1Root,
    "schema/configuration-delivery/v1/capability-request.schema.json",
  ),
  compatibilityManifestSchema: resolve(
    deliveryV1Root,
    "schema/configuration-delivery/v1/compatibility-manifest.schema.json",
  ),
  compatibilityManifest: resolve(
    deliveryV1Root,
    "compatibility/configuration-delivery/v1.json",
  ),
  validFixtures: [
    "valid-release.json",
    "multiple-paywalls.json",
    "placement-binding.json",
    "product-reference.json",
    "asset-reference.json",
  ].map((name) =>
    resolve(deliveryV1Root, "fixtures/configuration-delivery/v1", name),
  ),
  capabilityRequestFixture: resolve(
    deliveryV1Root,
    "fixtures/configuration-delivery/v1/capability-request.json",
  ),
  invalidFixtures: [
    "unsupported-contract-version.json",
    "unsupported-paywall-protocol.json",
    "malformed-release.json",
    "incomplete-release.json",
  ].map((name) =>
    resolve(
      deliveryV1Root,
      "fixtures/configuration-delivery/v1/invalid",
      name,
    ),
  ),
});

export function readDeliveryV1Json(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

export function loadDeliveryV1Artifacts() {
  return {
    releaseSchema: readDeliveryV1Json(deliveryV1Paths.releaseSchema),
    capabilityRequestSchema: readDeliveryV1Json(
      deliveryV1Paths.capabilityRequestSchema,
    ),
    compatibilityManifestSchema: readDeliveryV1Json(
      deliveryV1Paths.compatibilityManifestSchema,
    ),
    compatibilityManifest: readDeliveryV1Json(
      deliveryV1Paths.compatibilityManifest,
    ),
    validReleases: deliveryV1Paths.validFixtures.map(readDeliveryV1Json),
    capabilityRequest: readDeliveryV1Json(
      deliveryV1Paths.capabilityRequestFixture,
    ),
    invalidReleases: deliveryV1Paths.invalidFixtures.map(readDeliveryV1Json),
  };
}

function validators({
  releaseSchema,
  capabilityRequestSchema,
  compatibilityManifestSchema,
  paywallSchema,
}) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  ajv.addSchema(paywallSchema);
  return {
    release: ajv.compile(releaseSchema),
    capabilityRequest: ajv.compile(capabilityRequestSchema),
    compatibilityManifest: ajv.compile(compatibilityManifestSchema),
  };
}

function schemaErrors(label, errors = []) {
  return errors.map(
    (error) =>
      `${label}${error.instancePath || "/"} ${error.message ?? "is invalid"}`,
  );
}

function duplicates(entries, field, label, errors) {
  const seen = new Set();
  for (const entry of entries) {
    const value = entry[field];
    if (seen.has(value)) errors.push(`${label} contains duplicate ${field} ${value}`);
    seen.add(value);
  }
}

function setDifference(left, right) {
  return [...left].filter((value) => !right.has(value)).sort();
}

function requireSameSet(errors, actual, expected, label) {
  const missing = setDifference(expected, actual);
  const unexpected = setDifference(actual, expected);
  if (missing.length > 0) errors.push(`${label} is missing ${missing.join(", ")}`);
  if (unexpected.length > 0) {
    errors.push(`${label} contains unexpected ${unexpected.join(", ")}`);
  }
}

function capabilityKey(capability) {
  return `${capability.name}@${capability.version}`;
}

function validateReleaseSemantics(errors, envelope, protocolArtifacts) {
  const release = envelope.release;
  if (release.contentDigest !== releaseMaterialDigest(envelope)) {
    errors.push("release contentDigest does not match its canonical release material");
  }

  duplicates(release.placements, "key", "release placements", errors);
  duplicates(release.paywallVersions, "id", "release paywallVersions", errors);
  duplicates(release.paywallVersions, "paywallId", "release paywallVersions", errors);
  duplicates(release.productReferences, "id", "release productReferences", errors);
  duplicates(release.assetReferences, "id", "release assetReferences", errors);

  const versionById = new Map(
    release.paywallVersions.map((version) => [version.id, version]),
  );
  const referencedVersionIds = new Set();
  for (const placement of release.placements) {
    if (!versionById.has(placement.paywallVersionId)) {
      errors.push(
        `placement ${placement.key} references unknown Paywall Version ${placement.paywallVersionId}`,
      );
    } else {
      referencedVersionIds.add(placement.paywallVersionId);
    }
  }
  requireSameSet(
    errors,
    referencedVersionIds,
    new Set(versionById.keys()),
    "placement Paywall Version references",
  );

  const expectedProducts = new Set();
  const expectedAssets = new Set();
  const expectedCapabilities = new Set();
  const assetById = new Map(
    release.assetReferences.map((asset) => [asset.id, asset]),
  );

  for (const version of release.paywallVersions) {
    if (version.protocolVersion !== version.document.schemaVersion) {
      errors.push(
        `Paywall Version ${version.id} protocolVersion does not match its document`,
      );
    }
    if (version.paywallId !== version.document.id) {
      errors.push(`Paywall Version ${version.id} paywallId does not match document id`);
    }
    if (version.documentDigest !== sha256Digest(version.document)) {
      errors.push(`Paywall Version ${version.id} documentDigest does not match`);
    }
    errors.push(
      ...validateProtocolV03({
        ...protocolArtifacts,
        document: version.document,
      }).map((error) => `Paywall Version ${version.id}: ${error}`),
    );

    const documentProducts = new Set(
      version.document.products.map((product) => product.productId),
    );
    requireSameSet(
      errors,
      new Set(version.productReferenceIds),
      documentProducts,
      `Paywall Version ${version.id} productReferenceIds`,
    );
    for (const productId of documentProducts) expectedProducts.add(productId);
    for (const capability of version.document.compatibility.requiredCapabilities) {
      expectedCapabilities.add(capabilityKey(capability));
    }

    duplicates(
      version.assetBindings,
      "documentAssetId",
      `Paywall Version ${version.id} assetBindings`,
      errors,
    );
    duplicates(
      version.assetBindings,
      "assetReferenceId",
      `Paywall Version ${version.id} assetBindings`,
      errors,
    );
    const remoteAssetById = new Map(
      version.document.assets
        .filter((asset) => asset.source.type === "remote")
        .map((asset) => [asset.id, asset]),
    );
    requireSameSet(
      errors,
      new Set(version.assetBindings.map((binding) => binding.documentAssetId)),
      new Set(remoteAssetById.keys()),
      `Paywall Version ${version.id} remote Asset bindings`,
    );
    for (const binding of version.assetBindings) {
      expectedAssets.add(binding.assetReferenceId);
      const documentAsset = remoteAssetById.get(binding.documentAssetId);
      const releaseAsset = assetById.get(binding.assetReferenceId);
      if (!documentAsset) continue;
      if (!releaseAsset) {
        errors.push(
          `Paywall Version ${version.id} references unknown Asset ${binding.assetReferenceId}`,
        );
        continue;
      }
      if (releaseAsset.kind !== documentAsset.type) {
        errors.push(`Asset ${releaseAsset.id} kind does not match document Asset`);
      }
      if (releaseAsset.url !== documentAsset.source.url) {
        errors.push(`Asset ${releaseAsset.id} URL does not match document Asset URL`);
      }
    }
  }

  requireSameSet(
    errors,
    new Set(release.productReferences.map((product) => product.id)),
    expectedProducts,
    "release Product references",
  );
  requireSameSet(
    errors,
    new Set(release.assetReferences.map((asset) => asset.id)),
    expectedAssets,
    "release Asset references",
  );
  for (const asset of release.assetReferences) {
    if (!asset.mediaType.startsWith(`${asset.kind}/`)) {
      errors.push(`Asset ${asset.id} mediaType does not match kind`);
    }
  }

  const actualCapabilities = new Set(
    release.compatibility.paywallProtocols[0].requiredCapabilities.map(
      capabilityKey,
    ),
  );
  requireSameSet(
    errors,
    actualCapabilities,
    expectedCapabilities,
    "release required Paywall capabilities",
  );
}

export function validateDeliveryV1Release(
  envelope,
  artifacts = loadDeliveryV1Artifacts(),
) {
  const protocolArtifacts = loadProtocolV03Artifacts();
  const compiled = validators({
    ...artifacts,
    paywallSchema: protocolArtifacts.paywallSchema,
  });
  const errors = [];
  if (!compiled.release(envelope)) {
    errors.push(...schemaErrors("release", compiled.release.errors));
    return errors;
  }
  validateReleaseSemantics(errors, envelope, protocolArtifacts);
  return errors;
}

export function validateDeliveryV1CapabilityRequest(
  request,
  artifacts = loadDeliveryV1Artifacts(),
) {
  const protocolArtifacts = loadProtocolV03Artifacts();
  const compiled = validators({
    ...artifacts,
    paywallSchema: protocolArtifacts.paywallSchema,
  });
  if (!compiled.capabilityRequest(request)) {
    return schemaErrors("capability request", compiled.capabilityRequest.errors);
  }
  const errors = [];
  duplicates(
    request.supportedPaywallProtocols,
    "version",
    "supported Paywall protocols",
    errors,
  );
  for (const protocol of request.supportedPaywallProtocols) {
    duplicates(protocol.capabilities, "name", "supported capabilities", errors);
  }
  return errors;
}

export function validateDeliveryV1Artifacts(
  artifacts = loadDeliveryV1Artifacts(),
) {
  const protocolArtifacts = loadProtocolV03Artifacts();
  const compiled = validators({
    ...artifacts,
    paywallSchema: protocolArtifacts.paywallSchema,
  });
  const errors = [];
  if (!compiled.compatibilityManifest(artifacts.compatibilityManifest)) {
    errors.push(
      ...schemaErrors(
        "compatibility manifest",
        compiled.compatibilityManifest.errors,
      ),
    );
  }
  for (const [index, release] of artifacts.validReleases.entries()) {
    errors.push(
      ...validateDeliveryV1Release(release, artifacts).map(
        (error) => `valid fixture ${index + 1}: ${error}`,
      ),
    );
  }
  errors.push(
    ...validateDeliveryV1CapabilityRequest(
      artifacts.capabilityRequest,
      artifacts,
    ),
  );
  for (const [index, release] of artifacts.invalidReleases.entries()) {
    if (validateDeliveryV1Release(release, artifacts).length === 0) {
      errors.push(`invalid fixture ${index + 1} was accepted`);
    }
  }
  return errors;
}

export function validateDeliveryV1JsonFormatting() {
  const paths = [
    deliveryV1Paths.releaseSchema,
    deliveryV1Paths.capabilityRequestSchema,
    deliveryV1Paths.compatibilityManifestSchema,
    deliveryV1Paths.compatibilityManifest,
    deliveryV1Paths.capabilityRequestFixture,
    ...deliveryV1Paths.validFixtures,
    ...deliveryV1Paths.invalidFixtures,
  ];
  const errors = [];
  for (const path of paths) {
    const source = readFileSync(path, "utf8");
    const expected = `${JSON.stringify(JSON.parse(source), null, 2)}\n`;
    if (source !== expected) {
      errors.push(`${relative(deliveryV1Root, path)} is not canonical JSON`);
    }
  }
  return errors;
}

export function decideDeliveryV1Candidate({
  candidate,
  lastAcceptedReleaseAvailable,
  bundledReleaseAvailable,
}) {
  const errors = validateDeliveryV1Release(candidate);
  if (errors.length === 0) return { action: "acceptRelease", errors: [] };
  if (lastAcceptedReleaseAvailable) {
    return { action: "keepLastAcceptedRelease", errors };
  }
  if (bundledReleaseAvailable) return { action: "loadBundledRelease", errors };
  return { action: "configurationUnavailable", errors };
}
