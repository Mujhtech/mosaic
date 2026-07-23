import assert from "node:assert/strict";
import test from "node:test";

import {
  loadCommerceProviderV1Artifacts,
  validateCommerceProviderV1Artifacts,
  validateCommerceProviderV1JsonFormatting,
  validateCommerceProviderV1Record,
} from "./commerce-provider-validation-v1.mjs";

function fixture(artifacts, name) {
  const index = artifacts.fixturePaths.findIndex((path) =>
    path.endsWith(`/${name}`),
  );
  assert.notEqual(index, -1, `Missing fixture ${name}`);
  return structuredClone(artifacts.fixtures[index]);
}

test("Commerce Provider v1 canonical artifacts are valid and formatted", () => {
  const artifacts = loadCommerceProviderV1Artifacts();
  assert.deepEqual(validateCommerceProviderV1Artifacts(artifacts), []);
  assert.deepEqual(validateCommerceProviderV1JsonFormatting(), []);
});

test("Commerce Provider v1 is exact and closed", () => {
  const artifacts = loadCommerceProviderV1Artifacts();
  const profile = fixture(artifacts, "provider-profile.json");
  profile.commerceProviderContractVersion = "2";
  profile.payload.provider.rawConfiguration = { apiKey: "forbidden" };

  const errors = validateCommerceProviderV1Record(
    profile,
    artifacts.contractSchema,
  );
  assert.ok(errors.some((error) => error.includes("must be equal to constant")));
  assert.ok(errors.some((error) => error.includes("additional properties")));
});

test("capabilities and Product-load identities are unique", () => {
  const artifacts = loadCommerceProviderV1Artifacts();
  const profile = fixture(artifacts, "provider-profile.json");
  profile.payload.capabilities[1].name = profile.payload.capabilities[0].name;
  delete profile.payload.capabilities[5].reasonCode;
  assert.ok(
    validateCommerceProviderV1Record(profile, artifacts.contractSchema).some(
      (error) => error.includes("duplicate productLoading"),
    ),
  );
  assert.ok(
    validateCommerceProviderV1Record(profile, artifacts.contractSchema).some(
      (error) => error.includes("conditional without a reasonCode"),
    ),
  );

  const request = fixture(artifacts, "product-load-request.json");
  request.payload.products[1].product.mosaicProductId =
    request.payload.products[0].product.mosaicProductId;
  assert.ok(
    validateCommerceProviderV1Record(request, artifacts.contractSchema).some(
      (error) => error.includes("duplicate product_pro_monthly"),
    ),
  );
});

test("available Products require coherent provider metadata", () => {
  const artifacts = loadCommerceProviderV1Artifacts();
  const result = fixture(artifacts, "product-load-available.json");
  delete result.payload.products[0].metadata;
  result.payload.products[2].metadata.trial = {
    period: { unit: "day", value: 7 },
  };

  const errors = validateCommerceProviderV1Record(
    result,
    artifacts.contractSchema,
  );
  assert.ok(errors.some((error) => error.includes("no resolved metadata")));
  assert.ok(
    errors.some((error) =>
      error.includes("subscription-only metadata"),
    ),
  );
});

test("failure outcomes require diagnostics and never imply inactive access", () => {
  const artifacts = loadCommerceProviderV1Artifacts();
  const entitlements = fixture(
    artifacts,
    "entitlement-provider-unavailable.json",
  );
  entitlements.payload.diagnostics = [];
  entitlements.payload.activeEntitlementKeys = [];

  const errors = validateCommerceProviderV1Record(
    entitlements,
    artifacts.contractSchema,
  );
  assert.ok(errors.some((error) => error.includes("error diagnostic")));
  assert.ok(
    errors.some((error) =>
      error.includes("cannot assert active Entitlements or freshness"),
    ),
  );

  entitlements.payload.outcome = "available";
  entitlements.payload.activeEntitlementKeys = [];
  entitlements.payload.freshness = {
    source: "liveProvider",
    status: "fresh",
    observedAt: "2026-07-23T12:05:00Z",
  };
  assert.deepEqual(
    validateCommerceProviderV1Record(
      entitlements,
      artifacts.contractSchema,
    ),
    [],
  );
});

test("retry-after is valid only for retryable diagnostics", () => {
  const artifacts = loadCommerceProviderV1Artifacts();
  const result = fixture(artifacts, "product-load-unavailable.json");
  result.payload.products[0].diagnostics[0].retryable = false;

  assert.ok(
    validateCommerceProviderV1Record(result, artifacts.contractSchema).some(
      (error) => error.includes("retryAfterSeconds"),
    ),
  );
});

test("non-success purchase and restore outcomes cannot grant access", () => {
  const artifacts = loadCommerceProviderV1Artifacts();
  const purchase = fixture(artifacts, "purchase-pending.json");
  purchase.payload.activeEntitlementKeys = ["pro"];
  assert.ok(
    validateCommerceProviderV1Record(purchase, artifacts.contractSchema).some(
      (error) => error.includes("cannot assert active Entitlements"),
    ),
  );

  const restore = fixture(artifacts, "restore-restored.json");
  restore.payload.outcome = "failed";
  assert.ok(
    validateCommerceProviderV1Record(restore, artifacts.contractSchema).some(
      (error) => error.includes("cannot assert active Entitlements"),
    ),
  );
  assert.ok(
    validateCommerceProviderV1Record(restore, artifacts.contractSchema).some(
      (error) => error.includes("requires an error diagnostic"),
    ),
  );
});
