import assert from "node:assert/strict";
import test from "node:test";

import {
  DecisionEvaluationError,
  evaluateDecisionV1,
  loadDecisionV1Artifacts,
  normalizeLocale,
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

test("targeting reads an ICU identifier as the locale it denotes, and never recovers a language", () => {
  // The three shapes hosts actually hand the SDKs. Targeting stops here: unlike
  // catalog lookup, it must not retarget a malformed tag onto a broader
  // language, because that changes which users match a Rule.
  for (const identifier of ["en_US@rg=gbzzzz", "en_US.UTF-8", "en_US_#u-rg-gbzzzz", "en-US-u-rg-gbzzzz"]) {
    assert.equal(normalizeLocale(identifier), "en-US", identifier);
  }
  assert.equal(normalizeLocale("en-US-verylongsubtag"), null);
});

const QA_OVERRIDE = Object.freeze({
  id: "override_qa",
  selectorDigest: `sha256:${"a".repeat(64)}`,
  safeLabel: "qa override",
  startsAt: "2026-08-01T00:00:00Z",
  expiresAt: "2026-08-01T12:00:00Z",
  outcome: { type: "no_paywall" },
});

test("a QA override window is never evaluated against an assumed clock", () => {
  // Regression: `context.now ?? epoch` made every override window silently
  // inactive, so a QA override could look expired on a caller that forgot the
  // clock rather than surfacing the omission.
  const fixture = loadDecisionV1Artifacts().evaluatorFixture;
  const withOverride = structuredClone(fixture.decision);
  withOverride.ruleSet.qaOverrides = [structuredClone(QA_OVERRIDE)];
  const context = {
    ...fixture.cases[0].context,
    qaOverrideSelectorDigest: QA_OVERRIDE.selectorDigest,
  };

  for (const now of [undefined, "not a timestamp"]) {
    assert.throws(
      () => evaluateDecisionV1(withOverride, { ...context, now }),
      (error) =>
        error instanceof DecisionEvaluationError && error.code === "now_required",
      `expected now_required for ${JSON.stringify(now)}`,
    );
  }

  // Inside the window the override wins; outside it, the rules run.
  assert.deepEqual(
    evaluateDecisionV1(withOverride, { ...context, now: "2026-08-01T06:00:00Z" }),
    { matchedRuleId: null, overrideId: "override_qa", outcome: { type: "no_paywall" } },
  );
  assert.equal(
    evaluateDecisionV1(withOverride, { ...context, now: "2026-08-02T06:00:00Z" })
      .overrideId,
    undefined,
  );

  // A rule set with no override windows never needed a clock in the first place.
  assert.deepEqual(
    evaluateDecisionV1(fixture.decision, fixture.cases[0].context),
    fixture.cases[0].expected,
  );
});

test("an unresolvable fallback key is named rather than crashing the evaluator", () => {
  // The evaluator is reachable from callers that have not validated the
  // document. A dangling fallback reference used to surface as a bare
  // "cannot read properties of undefined".
  const decision = structuredClone(loadDecisionV1Artifacts().evaluatorFixture.decision);
  decision.ruleSet.defaultOutcome = { type: "fallback", key: "not_defined" };
  assert.throws(
    () => evaluateDecisionV1(decision, { entitlements: {}, products: {} }),
    (error) =>
      error instanceof DecisionEvaluationError &&
      error.code === "unknown_fallback_key" &&
      error.message.includes("not_defined"),
  );
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
