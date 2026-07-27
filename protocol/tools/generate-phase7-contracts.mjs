import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const write = (path, value) => {
  const target = resolve(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
};

const delivery = read("schema/configuration-delivery/v2/release.schema.json");
delivery.$id = "urn:mosaic:protocol:schema:configuration-delivery:v3:release";
delivery.title = "Mosaic Configuration Delivery Contract v3";
delivery.properties.configurationDeliveryVersion.const = "3";
delivery.$defs.experimentCompatibility = {
  type: "object",
  additionalProperties: false,
  required: ["version", "requiredFeatures", "bucketingAlgorithms", "schedulePolicies"],
  properties: {
    version: { const: "1" },
    requiredFeatures: { type: "array", maxItems: 8, uniqueItems: true, items: { $ref: "urn:mosaic:protocol:schema:experiment-assignment:v1:assignment#/$defs/assignmentFeature" } },
    bucketingAlgorithms: { type: "array", maxItems: 2, uniqueItems: true, items: { enum: ["experiment_sha256_length_prefixed_v1", "experiment_group_sha256_length_prefixed_v1"] } },
    schedulePolicies: { type: "array", maxItems: 1, uniqueItems: true, items: { const: "trusted_server_time_v1" } },
  },
};
delivery.$defs.compatibility.required.push("experimentAssignmentContracts");
delivery.$defs.compatibility.properties.experimentAssignmentContracts = {
  type: "array", minItems: 1, maxItems: 1, items: { $ref: "#/$defs/experimentCompatibility" },
};
delivery.$defs.release.required.push("experimentAssignments");
delivery.$defs.release.properties.experimentAssignments = {
  type: "array", maxItems: 128, items: { $ref: "urn:mosaic:protocol:schema:experiment-assignment:v1:assignment#/$defs/assignment" },
};
write("schema/configuration-delivery/v3/release.schema.json", delivery);

const capability = read("schema/configuration-delivery/v2/capability-request.schema.json");
capability.$id = "urn:mosaic:protocol:schema:configuration-delivery:v3:capability-request";
for (const name of ["supportedExperimentAssignmentContracts", "supportedExperimentFeatures", "supportedExperimentBucketingAlgorithms", "supportedExperimentSchedulePolicies"]) capability.required.push(name);
Object.assign(capability.properties, {
  supportedExperimentAssignmentContracts: { type: "array", minItems: 1, maxItems: 8, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 16 } },
  supportedExperimentFeatures: { type: "array", maxItems: 16, uniqueItems: true, items: { $ref: "urn:mosaic:protocol:schema:experiment-assignment:v1:assignment#/$defs/assignmentFeature" } },
  supportedExperimentBucketingAlgorithms: { type: "array", maxItems: 8, uniqueItems: true, items: { enum: ["experiment_sha256_length_prefixed_v1", "experiment_group_sha256_length_prefixed_v1"] } },
  supportedExperimentSchedulePolicies: { type: "array", maxItems: 8, uniqueItems: true, items: { const: "trusted_server_time_v1" } },
});
write("schema/configuration-delivery/v3/capability-request.schema.json", capability);

const event = read("schema/analytics-event/v1/event.schema.json");
const replaceUrns = (value) => {
  if (Array.isArray(value)) return value.map(replaceUrns);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replaceUrns(child)]));
  return typeof value === "string" ? value.replaceAll("analytics-event:v1", "analytics-event:v2") : value;
};
const eventV2 = replaceUrns(event);
eventV2.$id = "urn:mosaic:protocol:schema:analytics-event:v2:event";
eventV2.title = "Mosaic Analytics Event Contract v2 event";
eventV2.properties.eventSchemaVersion.const = "2";
eventV2.$defs.context.properties.configurationDeliveryVersion.enum.push("3");
const experimentNames = ["experiment_assigned", "experiment_exposed", "experiment_fallback_presented", "experiment_assignment_failed"];
eventV2.$defs.eventName.enum.push(...experimentNames);
for (const field of ["experimentId", "experimentVersionId", "experimentVariantId", "experimentAllocationVersion"]) eventV2.$defs.attribution.properties[field] = { $ref: "#/$defs/identifier" };
eventV2.$defs.experimentAttribution = {
  type: "object",
  required: ["experimentId", "experimentVersionId", "experimentVariantId", "experimentAllocationVersion"],
  properties: Object.fromEntries(["experimentId", "experimentVersionId", "experimentVariantId", "experimentAllocationVersion"].map((field) => [field, { $ref: "#/$defs/identifier" }])),
};
eventV2.$defs.experimentAssignmentPayload = {
  type: "object", additionalProperties: false,
  required: ["assignmentKeyType", "bucketingAlgorithm", "bucket", "source"],
  properties: {
    assignmentKeyType: { enum: ["installation", "identified_user"] },
    bucketingAlgorithm: { const: "experiment_sha256_length_prefixed_v1" },
    bucket: { type: "integer", minimum: 0, maximum: 9999 },
    source: { enum: ["deterministic", "qa_override"] },
  },
};
eventV2.$defs.experimentExposurePayload = {
  type: "object", additionalProperties: false,
  required: ["assignmentKeyType", "bucketingAlgorithm", "productReadiness", "providerCapability"],
  properties: {
    assignmentKeyType: { enum: ["installation", "identified_user"] },
    bucketingAlgorithm: { const: "experiment_sha256_length_prefixed_v1" },
    productReadiness: { const: "ready" },
    providerCapability: { const: "accepted" },
    qaOverride: { type: "boolean" },
  },
};
eventV2.$defs.experimentFallbackPayload = {
  type: "object", additionalProperties: false,
  required: ["reason", "presentedPaywallId", "presentedPaywallVersionId"],
  properties: {
    reason: { enum: ["configuration_incompatible", "product_unavailable", "provider_unavailable", "rendering_failed", "time_unreliable"] },
    presentedPaywallId: { $ref: "#/$defs/identifier" },
    presentedPaywallVersionId: { $ref: "#/$defs/identifier" },
    diagnosticCode: { $ref: "#/$defs/safeCode" },
  },
};
eventV2.$defs.experimentAssignedEvent = { allOf: [{ $ref: "#/$defs/clientEventBase" }, { properties: { eventName: { const: "experiment_assigned" }, correlation: { $ref: "#/$defs/placementCorrelation" }, attribution: { allOf: [{ $ref: "#/$defs/placementAttribution" }, { $ref: "#/$defs/experimentAttribution" }] }, payload: { $ref: "#/$defs/experimentAssignmentPayload" } } }] };
eventV2.$defs.experimentExposedEvent = { allOf: [{ $ref: "#/$defs/clientEventBase" }, { properties: { eventName: { const: "experiment_exposed" }, correlation: { type: "object", required: ["placementRequestId", "paywallPresentationId"] }, attribution: { allOf: [{ $ref: "#/$defs/placementAttribution" }, { $ref: "#/$defs/paywallAttribution" }, { $ref: "#/$defs/experimentAttribution" }] }, payload: { $ref: "#/$defs/experimentExposurePayload" } } }] };
eventV2.$defs.experimentFallbackPresentedEvent = { allOf: [{ $ref: "#/$defs/clientEventBase" }, { properties: { eventName: { const: "experiment_fallback_presented" }, correlation: { type: "object", required: ["placementRequestId", "paywallPresentationId"] }, attribution: { allOf: [{ $ref: "#/$defs/placementAttribution" }, { $ref: "#/$defs/experimentAttribution" }] }, payload: { $ref: "#/$defs/experimentFallbackPayload" } } }] };
eventV2.$defs.experimentAssignmentFailedEvent = { allOf: [{ $ref: "#/$defs/clientEventBase" }, { properties: { eventName: { const: "experiment_assignment_failed" }, correlation: { $ref: "#/$defs/placementCorrelation" }, attribution: { allOf: [{ $ref: "#/$defs/placementAttribution" }, { $ref: "#/$defs/experimentAttribution" }] }, payload: { $ref: "#/$defs/diagnosticFailurePayload" } } }] };
for (const name of ["experimentAssignedEvent", "experimentExposedEvent", "experimentFallbackPresentedEvent", "experimentAssignmentFailedEvent"]) eventV2.oneOf.push({ $ref: `#/$defs/${name}` });
write("schema/analytics-event/v2/event.schema.json", eventV2);

for (const [source, target] of [["batch.schema.json", "batch.schema.json"], ["ingestion-response.schema.json", "ingestion-response.schema.json"]]) {
  const value = replaceUrns(read(`schema/analytics-event/v1/${source}`));
  value.$id = value.$id.replace("analytics-event:v1", "analytics-event:v2");
  value.title = value.title.replace("v1", "v2");
  value.properties.analyticsEventContractVersion.const = "2";
  write(`schema/analytics-event/v2/${target}`, value);
}

const analyticsManifestSchema = replaceUrns(read("schema/analytics-event/v1/compatibility-manifest.schema.json"));
analyticsManifestSchema.$id = "urn:mosaic:protocol:schema:analytics-event:v2:compatibility-manifest";
analyticsManifestSchema.title = "Mosaic Analytics Event Contract v2 compatibility manifest";
analyticsManifestSchema.properties.analyticsEventContractVersion.const = "2";
analyticsManifestSchema.properties.canonicalFixtures.minItems = 6;
analyticsManifestSchema.properties.eventSchemas.minItems = 31;
analyticsManifestSchema.properties.eventSchemas.maxItems = 31;
analyticsManifestSchema.properties.eventSchemas.items.properties.supportedVersions.items.const = "2";
analyticsManifestSchema.properties.readerPolicy.required.push("olderContractVersion");
analyticsManifestSchema.properties.readerPolicy.properties.olderContractVersion = { const: "acceptAlongsideV2" };
write("schema/analytics-event/v2/compatibility-manifest.schema.json", analyticsManifestSchema);

const analyticsManifest = read("compatibility/analytics-event/v1.json");
analyticsManifest.analyticsEventContractVersion = "2";
analyticsManifest.schemas = {
  event: "../../schema/analytics-event/v2/event.schema.json",
  batch: "../../schema/analytics-event/v2/batch.schema.json",
  ingestionResponse: "../../schema/analytics-event/v2/ingestion-response.schema.json",
};
analyticsManifest.canonicalFixtures = [
  "../../fixtures/analytics-event/v2/experiment-assigned.json",
  "../../fixtures/analytics-event/v2/experiment-exposed.json",
  "../../fixtures/analytics-event/v2/experiment-fallback-presented.json",
  "../../fixtures/analytics-event/v2/experiment-assignment-failed.json",
  "../../fixtures/analytics-event/v2/product-selection-attributed.json",
  "../../fixtures/analytics-event/v2/purchase-started-attributed.json",
  "../../fixtures/analytics-event/v2/batches/experiment-journey.json",
  "../../fixtures/analytics-event/v2/responses/accepted-exposure.json",
];
for (const entry of analyticsManifest.eventSchemas) entry.supportedVersions = ["2"];
analyticsManifest.eventSchemas.push(...experimentNames.map((eventName) => ({ eventName, supportedVersions: ["2"], acceptedAuthorities: ["client_observed"] })));
analyticsManifest.readerPolicy.olderContractVersion = "acceptAlongsideV2";
write("compatibility/analytics-event/v2.json", analyticsManifest);

const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const releaseDigest = (envelope) => {
  const material = structuredClone(envelope.release);
  delete material.contentDigest;
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical(material))).digest("hex")}`;
};

const assignmentEnvelope = read("fixtures/experiment-assignment/v1/running-ab.json");
const assignment = structuredClone(assignmentEnvelope.assignment);
Object.assign(assignment, {
  placementId: "placement_export_pdf",
  controlPaywallVersionId: "paywall_version_ios",
  variants: [
    { ...assignment.variants[0], paywallId: "paywall_ios", paywallVersionId: "paywall_version_ios", compatibility: { requiredProductIds: [], requiredProviderCapabilities: [] } },
    { ...assignment.variants[1], paywallId: "paywall_student", paywallVersionId: "paywall_version_student", compatibility: { requiredProductIds: [], requiredProviderCapabilities: [] } },
  ],
});
const deliveryFixture = read("fixtures/configuration-delivery/v2/advanced-release.json");
deliveryFixture.configurationDeliveryVersion = "3";
deliveryFixture.release.compatibility.experimentAssignmentContracts = [{
  version: "1",
  requiredFeatures: assignment.compatibility.requiredFeatures,
  bucketingAlgorithms: assignment.compatibility.bucketingAlgorithms,
  schedulePolicies: assignment.compatibility.schedulePolicies,
}];
deliveryFixture.release.experimentAssignments = [assignment];
deliveryFixture.release.contentDigest = releaseDigest(deliveryFixture);
write("fixtures/configuration-delivery/v3/experiment-release.json", deliveryFixture);

const malformedDelivery = structuredClone(deliveryFixture);
malformedDelivery.release.id = "release_phase7_invalid_allocation";
malformedDelivery.release.experimentAssignments[0].variants[0].rangeEnd = 6000;
malformedDelivery.release.contentDigest = releaseDigest(malformedDelivery);
write("fixtures/configuration-delivery/v3/invalid/malformed-allocation.json", malformedDelivery);

const unsupportedDelivery = structuredClone(deliveryFixture);
unsupportedDelivery.release.id = "release_phase7_unsupported_contract";
unsupportedDelivery.release.compatibility.experimentAssignmentContracts[0].version = "99";
unsupportedDelivery.release.contentDigest = releaseDigest(unsupportedDelivery);
write("fixtures/configuration-delivery/v3/invalid/unsupported-experiment-contract.json", unsupportedDelivery);

const capabilityFixture = read("fixtures/configuration-delivery/v2/capability-request.json");
capabilityFixture.supportedConfigurationDeliveryVersions.push("3");
Object.assign(capabilityFixture, {
  supportedExperimentAssignmentContracts: ["1"],
  supportedExperimentFeatures: assignment.compatibility.requiredFeatures,
  supportedExperimentBucketingAlgorithms: assignment.compatibility.bucketingAlgorithms,
  supportedExperimentSchedulePolicies: assignment.compatibility.schedulePolicies,
});
write("fixtures/configuration-delivery/v3/capability-request.json", capabilityFixture);

write("fixtures/configuration-delivery/v3/legacy-v2-projection.json", {
  sourceReleaseId: deliveryFixture.release.id,
  projectionPolicy: "remove_experiment_assignment_atomically",
  expectedPlacementBehavior: "unchanged_normal_placement",
  projectedConfigurationDeliveryVersion: "2",
});
