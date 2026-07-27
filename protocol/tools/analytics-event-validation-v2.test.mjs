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

test("v2 preserves event-specific closed correlation and attribution from v1", () => {
  const artifacts = loadAnalyticsEventV2Artifacts();
  const event = structuredClone(artifacts.events.find((candidate) => candidate.eventName === "product_selected"));
  event.correlation.providerUpdateId = "provider_update_unrelated";
  event.attribution.winningRuleId = "rule_without_ruleset";
  const errors = validateAnalyticsEventV2Event(event, artifacts);
  assert.ok(errors.some((error) => error.includes("correlation.providerUpdateId")));
  assert.ok(errors.some((error) => error.includes("winning Rule")));
});
