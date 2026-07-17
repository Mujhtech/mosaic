import assert from "node:assert/strict";
import test from "node:test";

import {
  expectedDocumentCapabilities,
  loadProtocolArtifacts,
  resolveLocalizedText,
  validateCanonicalFixtureCoverage,
  validateJsonFormatting,
  validateProtocol,
  walkDocumentNodes,
} from "./validation.mjs";

function artifacts() {
  return structuredClone(loadProtocolArtifacts());
}

function errors(input) {
  return validateProtocol(input);
}

function assertInvalid(input) {
  assert.notDeepEqual(errors(input), []);
}

function assertErrorIncludes(input, expected) {
  assert.ok(
    errors(input).some((error) => error.includes(expected)),
    `expected an error containing ${JSON.stringify(expected)}, got:\n${errors(input).join("\n")}`,
  );
}

function node(document, type, id) {
  return walkDocumentNodes(document).find(
    (candidate) =>
      candidate.type === type && (id === undefined || candidate.id === id),
  );
}

test("the RC1 canonical fixture, manifest, coverage, and formatting are valid", () => {
  const input = artifacts();

  assert.deepEqual(errors(input), []);
  assert.deepEqual(validateCanonicalFixtureCoverage(input.document), []);
  assert.deepEqual(validateJsonFormatting(), []);
  assert.equal(input.manifest.status, "approved");
  assert.equal(input.manifest.releaseCandidate, "RC1");
  assert.equal(
    input.manifest.canonicalFixture,
    "../fixtures/v0.1/complete-paywall.json",
  );
});

test("the canonical fixture exercises every schema capability", () => {
  const input = artifacts();
  const expected = expectedDocumentCapabilities(input.document);
  const schemaCapabilities = new Set(
    input.paywallSchema.$defs.capabilityName.enum,
  );

  assert.deepEqual(expected, schemaCapabilities);
});

test("an unsupported schema version is rejected", () => {
  const input = artifacts();
  input.document.schemaVersion = "1.0";

  assertInvalid(input);
});

test("the maximum revision is accepted", () => {
  const input = artifacts();
  input.document.revision = 2147483647;

  assert.deepEqual(errors(input), []);
});

test("a revision above the maximum is rejected", () => {
  const input = artifacts();
  input.document.revision = 2147483648;

  assertErrorIncludes(input, "must be <= 2147483647");
});

test("an integral JSON number spelling is accepted as a revision", () => {
  const input = artifacts();
  input.document.revision = JSON.parse("1.0");

  assert.deepEqual(errors(input), []);
});

test("the root layout must be a vertical scroll container", () => {
  const input = artifacts();
  input.document.layout.type = "verticalStack";

  assertInvalid(input);
});

test("a nested scroll container is rejected", () => {
  const input = artifacts();
  input.document.layout.content.children.push(
    structuredClone(input.document.layout),
  );

  assertInvalid(input);
});

test("an unknown nested component is rejected", () => {
  const input = artifacts();
  input.document.layout.content.children.push({
    type: "unknown",
    id: "unknown",
  });

  assertInvalid(input);
});

test("an unknown component property is rejected", () => {
  const input = artifacts();
  node(input.document, "text", "headline").executable = "never";

  assertInvalid(input);
});

test("duplicate layout and component IDs are rejected recursively", () => {
  const input = artifacts();
  node(input.document, "text", "subtitle").id = "headline";

  assertErrorIncludes(input, "layout tree contains duplicate id headline");
});

test("duplicate feature item IDs are rejected", () => {
  const input = artifacts();
  const featureList = node(input.document, "featureList");
  featureList.items[1].id = featureList.items[0].id;

  assertErrorIncludes(input, "feature list features contains duplicate id");
});

test("negative logical spacing is rejected", () => {
  const input = artifacts();
  input.document.layout.content.spacing = -1;

  assertInvalid(input);
});

test("non-finite runtime layout values are rejected", () => {
  const input = artifacts();
  input.document.layout.content.spacing = Number.POSITIVE_INFINITY;

  assertInvalid(input);
});

test("logical edge insets require direction-relative start and end", () => {
  const input = artifacts();
  delete input.document.layout.content.padding.start;

  assertInvalid(input);
});

test("physical left alignment is not a protocol alignment", () => {
  const input = artifacts();
  input.document.layout.content.horizontalAlignment = "left";

  assertInvalid(input);
});

test("the RC1 scroll axis is vertical only", () => {
  const input = artifacts();
  input.document.layout.axis = "horizontal";

  assertInvalid(input);
});

test("the RC1 scroll container must respect every safe-area edge", () => {
  const input = artifacts();
  input.document.layout.safeArea = "ignore";

  assertInvalid(input);
});

test("image width must fill its stack allocation", () => {
  const input = artifacts();
  node(input.document, "image").width = "content";

  assertInvalid(input);
});

test("image aspect ratio must be positive", () => {
  const input = artifacts();
  node(input.document, "image").aspectRatio = 0;

  assertInvalid(input);
});

test("image content mode is constrained", () => {
  const input = artifacts();
  node(input.document, "image").contentMode = "platformDefault";

  assertInvalid(input);
});

test("an image must reference a declared asset", () => {
  const input = artifacts();
  node(input.document, "image").assetId = "missing-image";

  assertErrorIncludes(input, "references unknown asset missing-image");
});

test("unused assets are rejected", () => {
  const input = artifacts();
  const extra = structuredClone(input.document.assets[0]);
  extra.id = "unused-image";
  extra.source.key = "mosaic.paywall.unused";
  input.document.assets.push(extra);

  assertErrorIncludes(input, "asset catalog declares unused asset unused-image");
});

test("duplicate asset IDs are rejected", () => {
  const input = artifacts();
  input.document.assets.push(structuredClone(input.document.assets[0]));

  assertErrorIncludes(input, "asset catalog contains duplicate id hero-image");
});

test("bundled asset keys remain logical and path-free", () => {
  const input = artifacts();
  input.document.assets[0].source.key = "../platform/hero.png";

  assertInvalid(input);
});

test("every image asset requires its declared placeholder fallback", () => {
  const input = artifacts();
  delete input.document.assets[0].fallback;

  assertInvalid(input);
});

test("the RC1 asset fallback cannot load remote content", () => {
  const input = artifacts();
  input.document.assets[0].fallback.type = "remote";

  assertInvalid(input);
});

test("an informative image requires a localized accessibility label", () => {
  const input = artifacts();
  delete node(input.document, "image").accessibility.label;

  assertInvalid(input);
});

test("a decorative image cannot retain an accessibility label", () => {
  const input = artifacts();
  node(input.document, "image").accessibility.hidden = true;

  assertInvalid(input);
});

test("heading accessibility levels are bounded", () => {
  const input = artifacts();
  node(input.document, "text", "headline").accessibility.level = 7;

  assertInvalid(input);
});

test("interactive controls require localized accessibility labels", () => {
  const input = artifacts();
  delete node(input.document, "purchaseButton").accessibility.label;

  assertInvalid(input);
});

test("product reference IDs are unique", () => {
  const input = artifacts();
  const duplicate = structuredClone(input.document.products[0]);
  input.document.products.push(duplicate);

  assertErrorIncludes(input, "product catalog contains duplicate id monthly-plan");
});

test("purchase-provider product IDs are unique", () => {
  const input = artifacts();
  const duplicate = structuredClone(input.document.products[0]);
  duplicate.id = "duplicate-monthly-plan";
  input.document.products.push(duplicate);

  assertErrorIncludes(
    input,
    "product catalog contains duplicate productId mosaic_pro_monthly",
  );
});

test("prices and periods cannot be embedded in product references", () => {
  const input = artifacts();
  input.document.products[0].price = "$9.99";

  assertInvalid(input);
});

test("a selector must reference declared products", () => {
  const input = artifacts();
  node(input.document, "productSelector").productReferenceIds[0] =
    "missing-plan";

  assertErrorIncludes(input, "references unknown product missing-plan");
});

test("a selector cannot repeat a product reference", () => {
  const input = artifacts();
  const selector = node(input.document, "productSelector");
  selector.productReferenceIds.push(selector.productReferenceIds[0]);

  assertInvalid(input);
});

test("a selector cannot initially select an unlisted product", () => {
  const input = artifacts();
  node(input.document, "productSelector").initiallySelectedProductReferenceId =
    "missing-plan";

  assertErrorIncludes(input, "initially selects an undeclared product");
});

test("the unavailable-product selection fallback is exact", () => {
  const input = artifacts();
  node(input.document, "productSelector").unavailableFallback.selection =
    "platformDefault";

  assertInvalid(input);
});

test("the no-products fallback must disable purchase and show its message", () => {
  const input = artifacts();
  node(
    input.document,
    "productSelector",
  ).unavailableFallback.whenNoneAvailable = "hidePaywall";

  assertInvalid(input);
});

test("purchase actions must reference a product selector", () => {
  const input = artifacts();
  node(input.document, "purchaseButton").action.productSelectorId = "headline";

  assertErrorIncludes(input, "references unknown product selector headline");
});

test("every product selector needs a purchase action", () => {
  const input = artifacts();
  const actions = node(input.document, "verticalStack", "commerce-actions");
  actions.children = actions.children.filter(
    (child) => child.type !== "purchaseButton",
  );

  assertErrorIncludes(input, "product selector plans has no purchase action");
});

test("unused product declarations are rejected", () => {
  const input = artifacts();
  const unused = structuredClone(input.document.products[0]);
  unused.id = "unused-plan";
  unused.productId = "mosaic_pro_unused";
  input.document.products.push(unused);

  assertErrorIncludes(input, "product catalog declares unused product unused-plan");
});

test("action objects reject executable or arbitrary payloads", () => {
  const input = artifacts();
  node(input.document, "purchaseButton").action.script = "purchase()";

  assertInvalid(input);
});

test("a missing nested capability declaration is rejected", () => {
  const input = artifacts();
  input.document.compatibility.requiredCapabilities =
    input.document.compatibility.requiredCapabilities.filter(
      (capability) => capability.name !== "layout.verticalStack",
    );

  assertErrorIncludes(
    input,
    "document is missing required capability layout.verticalStack",
  );
});

test("an unused capability declaration is rejected", () => {
  const input = artifacts();
  delete input.document.localization.locales.ar;

  assertErrorIncludes(
    input,
    "document declares unused capability localization.rtl",
  );
});

test("a manifest missing a schema capability is rejected", () => {
  const input = artifacts();
  input.manifest.capabilities = input.manifest.capabilities.filter(
    (capability) => capability.name !== "component.image",
  );

  assertErrorIncludes(
    input,
    "manifest omits schema capability component.image",
  );
});

test("the paywall and manifest schemas cannot drift in capability vocabulary", () => {
  const input = artifacts();
  input.manifestSchema.$defs.capabilityName.enum.push("component.platformOnly");

  assertErrorIncludes(
    input,
    "manifest schema declares unknown capability component.platformOnly",
  );
});

test("duplicate capability declarations are rejected", () => {
  const input = artifacts();
  input.document.compatibility.requiredCapabilities.push(
    structuredClone(input.document.compatibility.requiredCapabilities[0]),
  );

  assertInvalid(input);
});

test("the default locale must have a catalog", () => {
  const input = artifacts();
  input.document.localization.defaultLocale = "fr";

  assertErrorIncludes(input, "default locale fr is not declared");
});

test("the fallback locale must have a catalog", () => {
  const input = artifacts();
  input.document.localization.fallbackLocale = "fr";

  assertErrorIncludes(input, "fallback locale fr is not declared");
});

test("localized inline defaults must match the default catalog", () => {
  const input = artifacts();
  node(input.document, "text", "headline").value.default = "Different";

  assertErrorIncludes(input, "default text does not match en catalog key");
});

test("every localized value must exist in the default catalog", () => {
  const input = artifacts();
  delete input.document.localization.locales.en.strings["paywall.headline"];

  assertErrorIncludes(input, "references missing default localization key");
});

test("unused default localization keys are rejected", () => {
  const input = artifacts();
  input.document.localization.locales.en.strings["paywall.unused"] = "Unused";

  assertErrorIncludes(input, "default localization catalog declares unused key");
});

test("translations cannot invent keys absent from the default catalog", () => {
  const input = artifacts();
  input.document.localization.locales.de.strings["paywall.unknown"] =
    "Unbekannt";

  assertErrorIncludes(input, "catalog de declares unknown key paywall.unknown");
});

test("exact locale resolution uses the requested catalog", () => {
  const input = artifacts();
  const headline = node(input.document, "text", "headline").value;

  assert.deepEqual(resolveLocalizedText(input.document, headline, "ar"), {
    direction: "rtl",
    locale: "ar",
    value: "افتح جميع مزايا Mosaic Pro",
  });
});

test("regional locale resolution falls back to the base language", () => {
  const input = artifacts();
  const subtitle = node(input.document, "text", "subtitle").value;
  const resolved = resolveLocalizedText(input.document, subtitle, "de-DE");

  assert.equal(resolved.locale, "de");
  assert.equal(resolved.direction, "ltr");
  assert.ok(resolved.value.length >= 120);
});

test("an unknown locale resolves through the declared fallback locale", () => {
  const input = artifacts();
  const headline = node(input.document, "text", "headline").value;

  assert.deepEqual(resolveLocalizedText(input.document, headline, "fr-FR"), {
    direction: "ltr",
    locale: "en",
    value: "Unlock every Mosaic Pro feature",
  });
});

test("missing RTL strings retain RTL direction while using text fallback", () => {
  const input = artifacts();
  const subtitle = node(input.document, "text", "subtitle").value;
  delete input.document.localization.locales.ar.strings["paywall.subtitle"];

  assert.deepEqual(resolveLocalizedText(input.document, subtitle, "ar"), {
    direction: "rtl",
    locale: "en",
    value:
      "Build, preview, and improve native paywalls across every supported platform without giving up platform conventions.",
  });
});

test("the manifest fixes every primary and runtime fallback policy", () => {
  const mutations = {
    bundledFallbackRejected: "renderPartialDocument",
    invalidReference: "ignore",
    missingAsset: "crash",
    primaryDocumentRejected: "renderPartialDocument",
    unavailableProduct: "selectUnavailable",
    unknownComponent: "skipComponent",
    unknownProperty: "ignore",
    unknownSchemaVersion: "guess",
    unsupportedCapability: "renderPartialDocument",
  };

  for (const [policy, invalidValue] of Object.entries(mutations)) {
    const input = artifacts();
    input.manifest.readerPolicy[policy] = invalidValue;
    assertInvalid(input);
  }
});

test("normalized interaction outcomes are exact", () => {
  const input = artifacts();
  input.manifest.normalizedOutcomes.restore.push("cancelled");

  assertInvalid(input);
});

test("normalized presentation outcomes are exact and complete", () => {
  const input = artifacts();

  assert.deepEqual(input.manifest.normalizedOutcomes.presentation, [
    "purchased",
    "restored",
    "alreadyEntitled",
    "dismissed",
    "cancelled",
    "productUnavailable",
    "configurationUnavailable",
    "purchaseFailed",
    "renderingFailed",
  ]);

  input.manifest.normalizedOutcomes.presentation.pop();
  assertInvalid(input);
});

test("canonical coverage detects a missing required component", () => {
  const input = artifacts();
  const actions = node(input.document, "verticalStack", "commerce-actions");
  actions.children = actions.children.filter(
    (child) => child.type !== "restoreButton",
  );

  assert.ok(
    validateCanonicalFixtureCoverage(input.document).includes(
      "canonical fixture omits component restoreButton",
    ),
  );
});

test("canonical coverage detects missing RTL and long localization paths", () => {
  const input = artifacts();
  delete input.document.localization.locales.ar;
  delete input.document.localization.locales.de;

  assert.deepEqual(validateCanonicalFixtureCoverage(input.document), [
    "canonical fixture does not exercise RTL localization",
    "canonical fixture does not exercise a long localization",
  ]);
});
