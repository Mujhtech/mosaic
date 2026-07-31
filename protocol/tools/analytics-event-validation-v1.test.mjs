import assert from "node:assert/strict";
import test from "node:test";

import {
  loadAnalyticsEventV1Artifacts,
  validateAnalyticsEventV1Artifacts,
  validateAnalyticsEventV1Batch,
  validateAnalyticsEventV1Event,
  validateAnalyticsEventV1JsonFormatting,
  validateAnalyticsEventV1Response,
} from "./analytics-event-validation-v1.mjs";

function fixture(artifacts, name) {
  const index = artifacts.eventFixturePaths.findIndex((path) =>
    path.endsWith(`/${name}`),
  );
  assert.notEqual(index, -1, `Missing fixture ${name}`);
  return structuredClone(artifacts.eventFixtures[index]);
}

function clientEvent(artifacts, eventName) {
  const event = fixture(artifacts, "placement-request.json");
  event.eventId = `event_${eventName}`;
  event.eventName = eventName;
  event.correlation = {};
  event.attribution = {};
  event.payload = {};
  const placement = () => {
    event.correlation.placementRequestId = "placement_request_all_events";
    event.attribution.placementId = "placement_export_pdf";
  };
  const presentation = () => {
    event.correlation.paywallPresentationId = "presentation_all_events";
  };
  const paywall = () => {
    event.attribution.paywallId = "paywall_pro";
    event.attribution.paywallVersionId = "paywall_version_19";
  };
  const product = () => {
    event.attribution.mosaicProductId = "product_yearly";
  };
  const purchase = () => {
    event.correlation.purchaseAttemptId = "purchase_attempt_all_events";
    product();
    event.attribution.providerId = "app_store";
  };
  const restore = () => {
    event.correlation.restoreAttemptId = "restore_attempt_all_events";
  };

  switch (eventName) {
    case "placement_requested":
      placement();
      event.payload = { decisionContractVersion: "1" };
      break;
    case "placement_paywall_selected":
      placement();
      paywall();
      event.payload = { finalOutcome: "paywall", decisionContractVersion: "1" };
      break;
    case "placement_no_paywall":
      placement();
      event.payload = { finalOutcome: "no_paywall", decisionContractVersion: "1" };
      break;
    case "placement_fallback_used":
      placement();
      event.payload = {
        trigger: "product_unavailable",
        fallbackKey: "safe_default",
        finalOutcome: "paywall",
      };
      break;
    case "placement_unavailable":
      placement();
      event.payload = { reason: "no_safe_decision" };
      break;
    case "placement_evaluation_failed":
      placement();
      event.payload = { diagnosticCode: "placement.evaluation_failed", retryable: false };
      break;
    case "paywall_presented":
      presentation();
      paywall();
      break;
    case "paywall_dismissed":
      presentation();
      event.payload = { reason: "user" };
      break;
    case "paywall_action_selected":
      presentation();
      event.payload = { action: "purchase", componentId: "button_purchase" };
      break;
    case "paywall_render_failed":
      event.payload = { diagnosticCode: "rendering.content_unavailable", retryable: false };
      break;
    case "product_load_started":
      presentation();
      event.correlation.productLoadAttemptId = "product_load_all_events";
      event.payload = { requestedProductCount: 2 };
      break;
    case "product_load_completed":
      event.correlation.productLoadAttemptId = "product_load_all_events";
      event.payload = { availableProductCount: 1, unavailableProductCount: 1, durationMs: 320 };
      break;
    case "product_load_failed":
      event.correlation.productLoadAttemptId = "product_load_all_events";
      event.payload = { requestedProductCount: 2, durationMs: 320, diagnosticCode: "commerce.product_load_failed", retryable: true };
      break;
    case "product_unavailable":
      event.correlation.productLoadAttemptId = "product_load_all_events";
      product();
      event.payload = { reason: "product_not_found" };
      break;
    case "product_selected":
      presentation();
      paywall();
      product();
      event.payload = { source: "user" };
      break;
    case "purchase_started":
      purchase();
      break;
    case "purchase_completed_client":
      purchase();
      event.payload = { outcome: "purchased", durationMs: 2000, observedEntitlementKeys: ["pro_access"] };
      break;
    case "purchase_completed_provider":
      purchase();
      event.authority = "provider_confirmed";
      event.attribution.providerId = "trusted_provider_future";
      event.payload = { confirmationSource: "trusted_provider_integration", activeEntitlementKeys: ["pro_access"] };
      break;
    case "purchase_pending":
    case "purchase_deferred":
    case "purchase_cancelled":
      purchase();
      event.payload = { durationMs: 2000 };
      break;
    case "purchase_failed":
      purchase();
      event.payload = { durationMs: 2000, diagnosticCode: "commerce.purchase_failed", retryable: true };
      break;
    case "restore_started":
      restore();
      event.payload = { providerId: "app_store" };
      break;
    case "restore_completed":
      restore();
      event.payload = { providerId: "app_store", durationMs: 900, restoredProductIds: ["product_yearly"], observedEntitlementKeys: ["pro_access"] };
      break;
    case "restore_nothing_found":
    case "restore_cancelled":
      restore();
      event.payload = { providerId: "app_store", durationMs: 900 };
      break;
    case "restore_failed":
      restore();
      event.payload = { providerId: "app_store", durationMs: 900, diagnosticCode: "commerce.restore_failed", retryable: true };
      break;
    default:
      assert.fail(`Unhandled Analytics event ${eventName}`);
  }
  return event;
}

test("Analytics Event v1 canonical artifacts are valid and formatted", () => {
  const artifacts = loadAnalyticsEventV1Artifacts();
  assert.deepEqual(validateAnalyticsEventV1Artifacts(artifacts), []);
  assert.deepEqual(validateAnalyticsEventV1JsonFormatting(), []);
});

test("every declared event name has one closed valid typed payload", () => {
  const artifacts = loadAnalyticsEventV1Artifacts();
  const names = artifacts.eventSchema.$defs.eventName.enum;
  assert.equal(names.length, 27);
  for (const name of names) {
    assert.deepEqual(
      validateAnalyticsEventV1Event(clientEvent(artifacts, name), artifacts),
      [],
      name,
    );
  }

  const unknown = clientEvent(artifacts, "placement_requested");
  unknown.payload.customProperties = { unrestricted: true };
  assert.ok(
    validateAnalyticsEventV1Event(unknown, artifacts).some((error) =>
      error.includes("payload.customProperties is not allowed"),
    ),
  );
});

test("public SDK authority cannot fabricate provider confirmation", () => {
  const artifacts = loadAnalyticsEventV1Artifacts();
  const provider = clientEvent(artifacts, "purchase_completed_provider");
  provider.authority = "client_observed";
  assert.ok(validateAnalyticsEventV1Event(provider, artifacts).length > 0);

  const client = clientEvent(artifacts, "purchase_completed_client");
  client.authority = "trusted_server";
  assert.ok(validateAnalyticsEventV1Event(client, artifacts).length > 0);
});

test("event payloads exclude tenant fields, URLs, and unrestricted metadata", () => {
  const artifacts = loadAnalyticsEventV1Artifacts();
  for (const field of ["organizationId", "projectId", "environmentId", "applicationId", "properties"]) {
    const event = clientEvent(artifacts, "placement_requested");
    event[field] = "forbidden";
    assert.ok(validateAnalyticsEventV1Event(event, artifacts).length > 0, field);
  }
  const action = clientEvent(artifacts, "paywall_action_selected");
  action.payload.url = "https://example.com/private";
  assert.ok(validateAnalyticsEventV1Event(action, artifacts).length > 0);
});

test("event-specific correlation and immutable attribution are required", () => {
  const artifacts = loadAnalyticsEventV1Artifacts();
  const purchase = clientEvent(artifacts, "purchase_started");
  delete purchase.correlation.purchaseAttemptId;
  assert.ok(validateAnalyticsEventV1Event(purchase, artifacts).length > 0);

  const presented = clientEvent(artifacts, "paywall_presented");
  delete presented.attribution.paywallVersionId;
  assert.ok(validateAnalyticsEventV1Event(presented, artifacts).length > 0);
});

test("event-specific correlation and attribution reject unrelated global fields", () => {
  const artifacts = loadAnalyticsEventV1Artifacts();
  const placement = clientEvent(artifacts, "placement_requested");
  placement.correlation.providerUpdateId = "provider_update_unrelated";
  placement.attribution.planId = "plan_unrelated";
  const errors = validateAnalyticsEventV1Event(placement, artifacts);
  assert.ok(errors.some((error) => error.includes("correlation.providerUpdateId")));
  assert.ok(errors.some((error) => error.includes("attribution.planId")));

  const purchase = clientEvent(artifacts, "purchase_started");
  purchase.correlation.restoreAttemptId = "restore_attempt_unrelated";
  assert.ok(
    validateAnalyticsEventV1Event(purchase, artifacts).some((error) =>
      error.includes("correlation.restoreAttemptId"),
    ),
  );
});

// Both invariants are now enforced by the canonical schema via
// `dependentRequired` rather than only by the semantic validator, so these
// assertions name the field the rejection is about instead of matching the
// semantic layer's prose. The protected risk is unchanged: a partial rollout
// tuple or a half-identified Rule Set must never be accepted.
test("rollout and Rule Set attribution are all-or-none", () => {
  const artifacts = loadAnalyticsEventV1Artifacts();
  const noPaywall = clientEvent(artifacts, "placement_no_paywall");
  noPaywall.attribution.placementRuleSetId = "rule_set_holdout";
  noPaywall.attribution.placementRuleSetVersion = 3;
  noPaywall.attribution.winningRuleId = "rule_holdout";
  noPaywall.payload.assignmentKeyType = "installation";
  noPaywall.payload.bucketingAlgorithm = "sha256_length_prefixed_v1";
  noPaywall.payload.rolloutBucket = 7421;
  assert.deepEqual(validateAnalyticsEventV1Event(noPaywall, artifacts), []);

  delete noPaywall.payload.bucketingAlgorithm;
  assert.ok(
    validateAnalyticsEventV1Event(noPaywall, artifacts).some((error) =>
      error.includes("bucketingAlgorithm"),
    ),
  );

  const selected = clientEvent(artifacts, "placement_paywall_selected");
  selected.attribution.placementRuleSetId = "rule_set_selected";
  assert.ok(
    validateAnalyticsEventV1Event(selected, artifacts).some((error) =>
      error.includes("placementRuleSetVersion"),
    ),
  );

  const orphanRule = clientEvent(artifacts, "placement_no_paywall");
  orphanRule.attribution.winningRuleId = "rule_without_ruleset";
  assert.ok(
    validateAnalyticsEventV1Event(orphanRule, artifacts).some((error) =>
      error.includes("placementRuleSetId"),
    ),
  );
});

test("shared edge-case corpus covers risky taxonomy branches", () => {
  const artifacts = loadAnalyticsEventV1Artifacts();
  const corpus = artifacts.batchFixtures.find(
    (batch) => batch.batchId === "batch_edge_case_conformance_001",
  );
  assert.ok(corpus);
  assert.deepEqual(validateAnalyticsEventV1Batch(corpus, artifacts), []);
  assert.deepEqual(
    corpus.events.map((event) => event.eventName),
    [
      "placement_no_paywall",
      "placement_fallback_used",
      "placement_evaluation_failed",
      "paywall_render_failed",
      "product_unavailable",
      "purchase_failed",
      "restore_nothing_found",
    ],
  );
  assert.equal(
    corpus.events[0].identity.applicationUserId,
    "tenant opaque/user 42",
    "applicationUserId is opaque and is not constrained to Mosaic resource-ID syntax",
  );
});

test("batch uniqueness and hard encoded-size limits are semantic invariants", () => {
  const artifacts = loadAnalyticsEventV1Artifacts();
  const batch = structuredClone(artifacts.batchFixtures[0]);
  batch.events[1].eventId = batch.events[0].eventId;
  assert.ok(
    validateAnalyticsEventV1Batch(batch, artifacts).some((error) =>
      error.includes("duplicate event ID"),
    ),
  );

  const oversized = clientEvent(artifacts, "paywall_render_failed");
  oversized.payload.diagnosticCode = `render.${"a".repeat(33_000)}`;
  assert.ok(validateAnalyticsEventV1Event(oversized, artifacts).length > 0);
});

test("partial-batch responses keep accepted, duplicate, permanent, and retryable distinct", () => {
  const artifacts = loadAnalyticsEventV1Artifacts();
  const mixed = artifacts.responseFixtures.find((response) =>
    response.batchId.includes("mixed"),
  );
  assert.deepEqual(
    mixed.results.map((result) => result.status),
    ["accepted", "duplicate", "permanently_rejected", "retryable"],
  );
  assert.equal(mixed.results[2].code, "authority_not_allowed");
  assert.equal(mixed.results[3].retryAfterSeconds, 10);
});

test("unknown acknowledgement codes invalidate the response", () => {
  const artifacts = loadAnalyticsEventV1Artifacts();
  const response = structuredClone(artifacts.responseFixtures[0]);
  response.results[0] = {
    eventId: response.results[0].eventId,
    status: "retryable",
    code: "future_retry_code",
  };
  assert.ok(validateAnalyticsEventV1Response(response, artifacts).length > 0);
});
