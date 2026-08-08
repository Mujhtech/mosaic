import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { releaseMaterialDigest, sha256Digest } from "./delivery-v1-common.mjs";

const toolsDirectory = dirname(fileURLToPath(import.meta.url));
const protocolRoot = resolve(toolsDirectory, "..");
const outputDirectory = resolve(
  protocolRoot,
  "fixtures/configuration-delivery/v1",
);
const invalidDirectory = resolve(outputDirectory, "invalid");

function readJson(path) {
  return JSON.parse(readFileSync(resolve(protocolRoot, path), "utf8"));
}

function writeJson(name, value, directory = outputDirectory) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    resolve(directory, name),
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
}

function sortedCapabilities(documents) {
  const capabilities = new Map();
  for (const document of documents) {
    for (const capability of document.compatibility.requiredCapabilities) {
      capabilities.set(`${capability.name}@${capability.version}`, capability);
    }
  }
  return [...capabilities.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

function productReferences(document) {
  return document.products.map((product) => ({
    id: product.productId,
    type: product.productId.includes("lifetime")
      ? "one_time_non_consumable"
      : "subscription",
    fallbackDisplayName: product.label.default,
  }));
}

function hostedAssetId(documentAssetId) {
  return `hosted_${documentAssetId.replaceAll("-", "_")}`;
}

function assetReferences(document) {
  return document.assets
    .filter((asset) => asset.source.type === "remote")
    .map((asset, index) => {
      const id = hostedAssetId(asset.id);
      return {
        id,
        kind: asset.type,
        mediaType: asset.type === "image" ? "image/webp" : "video/mp4",
        byteLength: asset.type === "image" ? 24576 + index : 1048576 + index,
        contentDigest: sha256Digest({ fixtureAssetBytes: id }),
        url: asset.source.url,
      };
    });
}

function versionRecord({ id, paywallId, document }) {
  return {
    id,
    paywallId,
    protocolVersion: "0.3",
    documentDigest: sha256Digest(document),
    document,
    productReferenceIds: document.products.map((product) => product.productId),
    assetBindings: document.assets
      .filter((asset) => asset.source.type === "remote")
      .map((asset) => ({
        documentAssetId: asset.id,
        assetReferenceId: hostedAssetId(asset.id),
      })),
  };
}

function envelope({
  id,
  number,
  placements,
  paywallVersions,
  productRecords = [],
  assetRecords = [],
}) {
  const value = {
    configurationDeliveryVersion: "1",
    release: {
      id,
      number,
      environment: {
        id: "environment_staging",
        key: "staging",
      },
      publishedAt: "2026-07-22T12:00:00Z",
      contentDigest: `sha256:${"0".repeat(64)}`,
      compatibility: {
        paywallProtocols: [
          {
            version: "0.3",
            requiredCapabilities: sortedCapabilities(
              paywallVersions.map((version) => version.document),
            ),
          },
        ],
        acceptance: "atomic",
      },
      placements,
      paywallVersions,
      productReferences: productRecords,
      assetReferences: assetRecords,
    },
  };
  value.release.contentDigest = releaseMaterialDigest(value);
  return value;
}

const navigation = readJson("fixtures/v0.3/navigation-only.json");
const complete = readJson("fixtures/v0.3/complete-paywall.json");

const navigationVersion = versionRecord({
  id: "paywall_version_navigation_1",
  paywallId: navigation.id,
  document: navigation,
});
const validRelease = envelope({
  id: "configuration_release_1",
  number: 1,
  placements: [
    {
      key: "onboarding_complete",
      paywallVersionId: navigationVersion.id,
    },
  ],
  paywallVersions: [navigationVersion],
});

const placementRelease = structuredClone(validRelease);
placementRelease.release.id = "configuration_release_placement";
placementRelease.release.number = 2;
placementRelease.release.contentDigest = releaseMaterialDigest(placementRelease);

const secondNavigation = structuredClone(navigation);
secondNavigation.id = "navigation-secondary";
secondNavigation.revision = 2;
const secondNavigationVersion = versionRecord({
  id: "paywall_version_navigation_2",
  paywallId: secondNavigation.id,
  document: secondNavigation,
});
const multiplePaywalls = envelope({
  id: "configuration_release_multiple",
  number: 3,
  placements: [
    {
      key: "onboarding_complete",
      paywallVersionId: navigationVersion.id,
    },
    {
      key: "export_pdf",
      paywallVersionId: secondNavigationVersion.id,
    },
  ],
  paywallVersions: [navigationVersion, secondNavigationVersion],
});

const completeVersion = versionRecord({
  id: "paywall_version_complete_1",
  paywallId: complete.id,
  document: complete,
});
const richRelease = envelope({
  id: "configuration_release_rich",
  number: 4,
  placements: [
    {
      key: "upgrade_prompt",
      paywallVersionId: completeVersion.id,
    },
  ],
  paywallVersions: [completeVersion],
  productRecords: productReferences(complete),
  assetRecords: assetReferences(complete),
});

const productRelease = structuredClone(richRelease);
productRelease.release.id = "configuration_release_product";
productRelease.release.number = 5;
productRelease.release.contentDigest = releaseMaterialDigest(productRelease);

const assetRelease = structuredClone(richRelease);
assetRelease.release.id = "configuration_release_asset";
assetRelease.release.number = 6;
assetRelease.release.contentDigest = releaseMaterialDigest(assetRelease);

writeJson("valid-release.json", validRelease);
writeJson("multiple-paywalls.json", multiplePaywalls);
writeJson("placement-binding.json", placementRelease);
writeJson("product-reference.json", productRelease);
writeJson("asset-reference.json", assetRelease);
writeJson("capability-request.json", {
  platform: "flutter",
  sdkVersion: "0.2.0-dev.5",
  supportedConfigurationDeliveryVersions: ["1"],
  supportedPaywallProtocols: [
    {
      version: "0.3",
      capabilities: sortedCapabilities([complete]),
    },
  ],
  applicationVersion: "1.0.0",
});

const unsupportedContract = structuredClone(validRelease);
unsupportedContract.configurationDeliveryVersion = "2";
writeJson("unsupported-contract-version.json", unsupportedContract, invalidDirectory);

const unsupportedPaywall = structuredClone(validRelease);
unsupportedPaywall.release.compatibility.paywallProtocols[0].version = "0.4";
unsupportedPaywall.release.paywallVersions[0].protocolVersion = "0.4";
unsupportedPaywall.release.paywallVersions[0].document.schemaVersion = "0.4";
writeJson("unsupported-paywall-protocol.json", unsupportedPaywall, invalidDirectory);

const malformedRelease = structuredClone(validRelease);
malformedRelease.release.internalAuditActor = "actor_secret";
writeJson("malformed-release.json", malformedRelease, invalidDirectory);

const incompleteRelease = structuredClone(richRelease);
incompleteRelease.release.productReferences.pop();
incompleteRelease.release.contentDigest = releaseMaterialDigest(incompleteRelease);
writeJson("incomplete-release.json", incompleteRelease, invalidDirectory);
