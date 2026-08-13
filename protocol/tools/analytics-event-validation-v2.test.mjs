import assert from "node:assert/strict";
import test from "node:test";

import { loadAnalyticsEventV2Artifacts, validateAnalyticsEventV2Artifacts, validateAnalyticsEventV2Event } from "./analytics-event-validation-v2.mjs";

test("Analytics Event v2 schema, exact manifest, fixtures, and batch remain coherent", () => {
  assert.deepEqual(validateAnalyticsEventV2Artifacts(), []);
});

test("Experiment attribution is all-or-none and limited to causal event families", () => {
  const artifacts = loadAnalyticsEventV2Artifacts();
  assert.notDeepEqual(validateAnalyticsEventV2Event(artifacts.invalidEvents[0], artifacts), []);
  const event = structuredClone(artifacts.events.find((candidate) => candidate.eventName === "experiment_exposed"));
  delete event.attribution.experimentAllocationVersion;
  assert.notDeepEqual(validateAnalyticsEventV2Event(event, artifacts), []);
});

test("assignment is diagnostic, exposure requires presentation, and fallback identity stays distinct", () => {
  const artifacts = loadAnalyticsEventV2Artifacts();
  const assigned = artifacts.events.find((event) => event.eventName === "experiment_assigned");
  assert.equal(assigned.correlation.paywallPresentationId, undefined);
  const exposed = artifacts.events.find((event) => event.eventName === "experiment_exposed");
  assert.ok(exposed.correlation.paywallPresentationId);
  const fallback = artifacts.events.find((event) => event.eventName === "experiment_fallback_presented");
  assert.equal(fallback.attribution.paywallVersionId, undefined);
  assert.ok(fallback.payload.presentedPaywallVersionId);
});

test("event-specific correlation and attribution stay closed", () => {
  const artifacts = loadAnalyticsEventV2Artifacts();
  const event = structuredClone(artifacts.events.find((candidate) => candidate.eventName === "product_selected"));
  event.correlation.providerUpdateId = "provider_update_unrelated";
  event.attribution.winningRuleId = "rule_without_ruleset";
  const errors = validateAnalyticsEventV2Event(event, artifacts);
  // Both rules are now enforced by the canonical schema (per-event allow-list
  // and `dependentRequired` Rule Set pairing) rather than only by this semantic
  // validator, so the assertions name the offending fields instead of the
  // semantic layer's prose.
  assert.ok(errors.some((error) => error.includes("correlation.providerUpdateId")));
  assert.ok(errors.some((error) => error.includes("placementRuleSetId")));
});
