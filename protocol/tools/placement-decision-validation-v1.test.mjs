import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateDecisionV1,
  loadDecisionV1Artifacts,
  rolloutV1,
  validateDecisionV1,
  validateDecisionV1Detailed,
  validateDecisionV1Artifacts,
} from "./placement-decision-validation-v1.mjs";

test("shared decision and rollout conformance corpus is internally consistent", () => {
  assert.deepEqual(validateDecisionV1Artifacts(), []);
});

test("priority, canonical locales, unknown inputs, fallback, typed values, and semantic versions follow the shared cases", () => {
  const fixture = loadDecisionV1Artifacts().evaluatorFixture;
  for (const testCase of fixture.cases) {
    assert.deepEqual(
      evaluateDecisionV1(fixture.decision, testCase.context, testCase.assignment),
      testCase.expected,
      testCase.name,
    );
  }
});

test("length-prefixed UTF-8 rollout is stable at exact threshold boundaries", () => {
  for (const vector of loadDecisionV1Artifacts().rolloutFixture.vectors) {
    const actual = rolloutV1(vector);
    assert.equal(actual.canonicalUtf8, vector.canonicalUtf8);
    assert.equal(actual.sha256Hex, vector.sha256Hex);
    assert.equal(actual.bucket, vector.bucket);
    for (const threshold of vector.thresholdCases) {
      assert.equal(actual.bucket < threshold.thresholdBasisPoints, threshold.matches);
    }
  }
});

test("unsupported, malformed, ambiguous-priority, and cyclic candidates reject completely", () => {
  for (const invalid of loadDecisionV1Artifacts().invalidFixtures) {
    assert.notDeepEqual(validateDecisionV1(invalid), [], invalid.ruleSet.id);
  }
});

test("exact feature declarations reject both under- and over-declaration", () => {
  const valid = loadDecisionV1Artifacts().evaluatorFixture.decision;
  const underdeclared = structuredClone(valid);
  underdeclared.ruleSet.compatibility.requiredFeatures = underdeclared.ruleSet.compatibility.requiredFeatures.filter((feature) => feature !== "source.device.platform");
  assert.ok(validateDecisionV1(underdeclared).some((error) => error.includes("exactly equal semantics")));

  const overdeclared = structuredClone(valid);
  overdeclared.ruleSet.compatibility.requiredFeatures.push("condition.any");
  assert.ok(validateDecisionV1(overdeclared).some((error) => error.includes("exactly equal semantics")));
});

test("closed source/operator pairs and unavailable-Paywall fallback references reject", () => {
  const valid = loadDecisionV1Artifacts().evaluatorFixture.decision;
  const incompatible = structuredClone(valid);
  incompatible.ruleSet.rules[0].conditions.operator = "greater_than";
  incompatible.ruleSet.compatibility.requiredFeatures = [...new Set(incompatible.ruleSet.compatibility.requiredFeatures.concat("operator.greater_than"))].sort();
  assert.ok(validateDecisionV1(incompatible).some((error) => error.includes("incompatible with entitlement_state")));

  const missingFallback = structuredClone(valid);
  missingFallback.ruleSet.rules[2].outcome.unavailableFallbackKey = "not_defined";
  assert.ok(validateDecisionV1(missingFallback).some((error) => error.includes("unknown fallback not_defined")));
});

test("duplicate-leaf and obviously-shadowed diagnostics are bounded warnings, not errors", () => {
  const decision = structuredClone(loadDecisionV1Artifacts().evaluatorFixture.decision);
  decision.ruleSet.rules[2].conditions.children.push(structuredClone(decision.ruleSet.rules[2].conditions.children[0]));
  const shadowed = structuredClone(decision.ruleSet.rules[0]);
  shadowed.id = "rule_pro_shadowed";
  shadowed.priority = 11;
  decision.ruleSet.rules.push(shadowed);
  const result = validateDecisionV1Detailed(decision);
  assert.deepEqual(result.errors, []);
  assert.ok(result.warnings.some((warning) => warning.includes("duplicate leaf condition")));
  assert.ok(result.warnings.some((warning) => warning.includes("obviously shadowed")));
  assert.ok(result.warnings.length <= 64);
});
