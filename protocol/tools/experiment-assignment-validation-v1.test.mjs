import assert from "node:assert/strict";
import test from "node:test";

import { loadExperimentAssignmentV1Artifacts, validateExperimentAssignmentV1, validateExperimentAssignmentV1Artifacts } from "./experiment-assignment-validation-v1.mjs";

test("Experiment Assignment v1 schema, exact manifest, and cross-language vectors remain coherent", () => {
  assert.deepEqual(validateExperimentAssignmentV1Artifacts(), []);
});

test("allocation gaps, overlaps, and incorrect Control anchors fail closed", () => {
  const artifacts = loadExperimentAssignmentV1Artifacts();
  assert.notDeepEqual(validateExperimentAssignmentV1(artifacts.invalidAssignments[0], artifacts), []);
  const candidate = structuredClone(artifacts.validAssignments[0]);
  candidate.assignment.controlPaywallVersionId = "paywall_version_wrong";
  assert.ok(validateExperimentAssignmentV1(candidate, artifacts).some((error) => error.includes("Control anchor")));
});

test("compatibility is the exact derivation of Assignment semantics", () => {
  const artifacts = loadExperimentAssignmentV1Artifacts();
  const candidate = structuredClone(artifacts.validAssignments[0]);
  candidate.assignment.compatibility.requiredFeatures.push("override.qa");
  assert.ok(validateExperimentAssignmentV1(candidate, artifacts).some((error) => error.includes("exactly equal")));
});

test("Group Version membership uses stable Experiment IDs and complete ranges", () => {
  const artifacts = loadExperimentAssignmentV1Artifacts();
  const candidate = structuredClone(artifacts.validAssignments[0]);
  const group = candidate.assignment.mutualExclusionGroup;
  assert.equal(group.members[0].experimentId, candidate.assignment.experimentId);
  assert.equal(group.members[0].experimentVersionId, undefined);
  group.members[0].experimentId = "experiment_unrelated";
  assert.ok(validateExperimentAssignmentV1(candidate, artifacts).some((error) => error.includes("must belong")));
});

test("immediate/manual completion omits schedule end while a scheduled end must follow start", () => {
  const artifacts = loadExperimentAssignmentV1Artifacts();
  const immediate = structuredClone(artifacts.validAssignments[0]);
  assert.equal(immediate.assignment.schedule.endsAt, undefined);
  assert.deepEqual(validateExperimentAssignmentV1(immediate, artifacts), []);

  const bounded = structuredClone(immediate);
  bounded.assignment.schedule.endsAt = bounded.assignment.schedule.startsAt;
  assert.ok(validateExperimentAssignmentV1(bounded, artifacts).some((error) => error.includes("strictly after")));
});
