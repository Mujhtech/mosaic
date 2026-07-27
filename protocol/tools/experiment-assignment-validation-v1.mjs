import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const experimentAssignmentV1Paths = Object.freeze({
  schema: resolve(root, "schema/experiment-assignment/v1/assignment.schema.json"),
  manifestSchema: resolve(root, "schema/experiment-assignment/v1/compatibility-manifest.schema.json"),
  manifest: resolve(root, "compatibility/experiment-assignment/v1.json"),
  fixtureDirectory: resolve(root, "fixtures/experiment-assignment/v1"),
  canonicalFixture: resolve(root, "fixtures/experiment-assignment/v1/running-ab.json"),
  qaFixture: resolve(root, "fixtures/experiment-assignment/v1/staging-qa.json"),
  vectors: resolve(root, "fixtures/experiment-assignment/v1/assignment-vectors.json"),
  invalidFixture: resolve(root, "fixtures/experiment-assignment/v1/invalid/malformed-allocation.json"),
});

const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const sameSet = (a, b) => a.size === b.size && [...a].every((value) => b.has(value));
const schemaErrors = (label, errors = []) => errors.map((error) => `${label}${error.instancePath || "/"} ${error.message ?? "is invalid"}`);

export function loadExperimentAssignmentV1Artifacts() {
  return {
    schema: read(experimentAssignmentV1Paths.schema),
    manifestSchema: read(experimentAssignmentV1Paths.manifestSchema),
    manifest: read(experimentAssignmentV1Paths.manifest),
    validAssignments: [read(experimentAssignmentV1Paths.canonicalFixture), read(experimentAssignmentV1Paths.qaFixture)],
    vectors: read(experimentAssignmentV1Paths.vectors),
    invalidAssignments: [read(experimentAssignmentV1Paths.invalidFixture)],
  };
}

function validators(artifacts) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  ajv.addSchema(artifacts.schema);
  return { assignment: ajv.getSchema(artifacts.schema.$id), manifest: ajv.compile(artifacts.manifestSchema) };
}

function expectedFeatures(assignment) {
  const features = new Set(["allocation.ranges", `assignment.${assignment.assignmentKeyPolicy}`, "fallback.normal_placement", "schedule.trusted_server_time"]);
  if (assignment.mutualExclusionGroup) features.add("group.mutual_exclusion");
  if (assignment.qaOverrides.length > 0) features.add("override.qa");
  return features;
}

export function validateExperimentAssignmentV1(envelope, artifacts = loadExperimentAssignmentV1Artifacts()) {
  const validate = validators(artifacts).assignment;
  if (!validate(envelope)) return schemaErrors("assignment", validate.errors);
  const errors = [];
  const assignment = envelope.assignment;
  const ids = new Set();
  let cursor = 0;
  let controls = 0;
  let treatments = 0;
  for (const variant of assignment.variants) {
    if (ids.has(variant.id)) errors.push(`duplicate Variant ID ${variant.id}`);
    ids.add(variant.id);
    if (variant.role === "control") controls += 1; else treatments += 1;
    if (variant.rangeStart !== cursor || variant.rangeEnd <= variant.rangeStart) errors.push("Variant allocation must be ordered, gap-free, non-overlapping half-open ranges");
    cursor = variant.rangeEnd;
  }
  if (cursor !== 10000) errors.push("Variant allocation must cover [0,10000)");
  if (controls !== 1 || treatments < 1 || treatments > 3) errors.push("Assignment requires exactly one Control and one to three Treatments");
  const control = assignment.variants.find((variant) => variant.role === "control");
  if (control?.paywallVersionId !== assignment.controlPaywallVersionId) errors.push("Control anchor must equal the Control Variant Paywall Version");
  if (assignment.schedule.endsAt !== undefined && Date.parse(assignment.schedule.startsAt) >= Date.parse(assignment.schedule.endsAt)) errors.push("schedule end, when present, must be strictly after start");
  for (const override of assignment.qaOverrides) {
    if (!ids.has(override.variantId)) errors.push(`QA override ${override.id} references an unknown Variant`);
    const duration = Date.parse(override.expiresAt) - Date.parse(override.startsAt);
    if (duration <= 0 || duration > 86_400_000) errors.push(`QA override ${override.id} must expire within 24 hours`);
  }
  if (assignment.mutualExclusionGroup) {
    const group = assignment.mutualExclusionGroup;
    const memberIds = new Set();
    const ranges = [];
    for (const member of group.members) {
      if (memberIds.has(member.experimentId)) errors.push(`Group Version contains duplicate Experiment ID ${member.experimentId}`);
      memberIds.add(member.experimentId);
      ranges.push(member);
    }
    if (!memberIds.has(assignment.experimentId)) errors.push("Assignment Experiment ID must belong to its immutable Group Version");
    if (group.normalPlacementRange) ranges.push(group.normalPlacementRange);
    ranges.sort((left, right) => left.rangeStart - right.rangeStart);
    let groupCursor = 0;
    for (const range of ranges) {
      if (range.rangeStart !== groupCursor || range.rangeEnd <= range.rangeStart) errors.push("Group Version ranges must be gap-free, non-overlapping half-open ranges");
      groupCursor = range.rangeEnd;
    }
    if (groupCursor !== 10000) errors.push("Group Version ranges must cover [0,10000)");
  }
  const expected = expectedFeatures(assignment);
  if (!sameSet(expected, new Set(assignment.compatibility.requiredFeatures))) errors.push("Assignment compatibility features must exactly equal used semantics");
  const algorithms = new Set([assignment.bucketingAlgorithm]);
  if (assignment.mutualExclusionGroup) algorithms.add(assignment.mutualExclusionGroup.bucketingAlgorithm);
  if (!sameSet(algorithms, new Set(assignment.compatibility.bucketingAlgorithms))) errors.push("Assignment compatibility algorithms must exactly equal used algorithms");
  return errors;
}

function canonicalInput(domain, values) {
  return `${domain}\n1\n${values.map((value) => `${Buffer.byteLength(value, "utf8")}:${value}\n`).join("")}`;
}

function validateVectors(vectors) {
  const errors = [];
  for (const [domain, entries] of [["mosaic-experiment-assignment", vectors.assignmentVectors], ["mosaic-experiment-group", vectors.groupVectors]]) {
    for (const vector of entries) {
      const input = canonicalInput(domain, vector.values);
      const digest = createHash("sha256").update(input).digest();
      const bucket = Number(digest.readBigUInt64BE(0) % BigInt(vectors.bucketSpace));
      if (Buffer.from(input).toString("hex") !== vector.canonicalUtf8Hex) errors.push(`${vector.name} canonical bytes differ`);
      if (digest.toString("hex") !== vector.sha256) errors.push(`${vector.name} digest differs`);
      if (digest.subarray(0, 8).toString("hex") !== vector.firstEightBytes) errors.push(`${vector.name} first eight bytes differ`);
      if (bucket !== vector.bucket) errors.push(`${vector.name} bucket differs`);
      if (domain.endsWith("assignment")) {
        const selected = vectors.variantRanges.find((range) => bucket >= range.start && bucket < range.end)?.variantId;
        if (selected !== vector.variantId) errors.push(`${vector.name} Variant differs`);
      } else {
        const selected = vector.memberRanges.find((range) => bucket >= range.start && bucket < range.end)?.experimentId ?? "normal_placement";
        if (selected !== vector.selectedExperimentId) errors.push(`${vector.name} group selection differs`);
      }
    }
  }
  return errors;
}

export function validateExperimentAssignmentV1Artifacts(artifacts = loadExperimentAssignmentV1Artifacts()) {
  const compiled = validators(artifacts);
  const errors = [];
  if (!compiled.manifest(artifacts.manifest)) errors.push(...schemaErrors("manifest", compiled.manifest.errors));
  for (const assignment of artifacts.validAssignments) errors.push(...validateExperimentAssignmentV1(assignment, artifacts));
  for (const assignment of artifacts.invalidAssignments) if (validateExperimentAssignmentV1(assignment, artifacts).length === 0) errors.push("malformed allocation fixture was accepted");
  errors.push(...validateVectors(artifacts.vectors));
  const manifestDirectory = dirname(experimentAssignmentV1Paths.manifest);
  for (const path of [artifacts.manifest.assignmentSchema, artifacts.manifest.canonicalFixture, artifacts.manifest.conformanceFixture]) if (!existsSync(resolve(manifestDirectory, path))) errors.push(`manifest path does not exist: ${path}`);
  return errors;
}

export function validateExperimentAssignmentV1JsonFormatting() {
  const paths = readdirSync(experimentAssignmentV1Paths.fixtureDirectory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => resolve(entry.parentPath, entry.name));
  paths.push(experimentAssignmentV1Paths.schema, experimentAssignmentV1Paths.manifestSchema, experimentAssignmentV1Paths.manifest);
  return paths.flatMap((path) => readFileSync(path, "utf8") === `${JSON.stringify(read(path), null, 2)}\n` ? [] : [`${relative(root, path)} is not canonical JSON`]);
}
