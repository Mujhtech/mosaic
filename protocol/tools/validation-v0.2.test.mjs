import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  canonicalSchemasByVersion,
  decideLocalPreviewDraftDelivery as decideBrowserDraftDelivery,
  evaluateVisibility,
  localPreviewContractVersions,
  localPreviewVersionPreference,
  localPreviewWebSocketProtocols,
  negotiateLocalPreviewVersion as negotiateBrowserPreview,
  paywallRuntimeDiagnostics,
  resolveCountdownState as resolveBrowserCountdownState,
  resolveProductCardStyle as resolveBrowserProductCardStyle,
  runtimeStateForAcceptedRevision,
  validateLocalProject,
  validatePaywallDocument,
  validatePreviewMessage,
} from "../browser/index.js";
import {
  migrateCanonicalV01Fixture,
  migrateV01ToV02,
} from "./migrate-v0.1-to-v0.2.mjs";
import {
  decideLocalPreviewDraftDelivery,
  loadPreviewV02Artifacts,
  negotiateLocalPreviewVersion,
  validatePreviewV02Artifacts,
  validatePreviewV02JsonFormatting,
} from "./preview-validation-v0.2.mjs";
import {
  expectedV02DocumentCapabilities,
  loadProtocolV02Artifacts,
  orderedV02Capabilities,
  protocolV02AuthoringWarnings,
  protocolV02RuntimeDiagnostics,
  resolveProductCardStyle,
  resolveV02CountdownState,
  runtimeStateForAcceptedV02Revision,
  validateCanonicalV02Coverage,
  validateProtocolV02,
  validateV02JsonFormatting,
  walkV02DocumentNodes,
} from "./validation-v0.2.mjs";

function artifacts() {
  return structuredClone(loadProtocolV02Artifacts());
}

function errors(input) {
  return validateProtocolV02(input);
}

function node(document, id) {
  const entry = walkV02DocumentNodes(document).find(
    ({ node: candidate }) => candidate.id === id,
  );
  assert.ok(entry, `expected node ${id}`);
  return entry.node;
}

function assertInvalid(input) {
  assert.notDeepEqual(errors(input), []);
}

function refreshCapabilities(input) {
  input.document.compatibility.requiredCapabilities = orderedV02Capabilities(
    input.document,
    input.paywallSchema,
  );
}

function assertWithheldDeliveryParity(options, expectedCode) {
  const nodeDecision = decideLocalPreviewDraftDelivery(options);
  const browserDecision = decideBrowserDraftDelivery(options);
  assert.deepEqual(browserDecision, nodeDecision);
  assert.equal(nodeDecision.delivery, "withhold");
  assert.equal(nodeDecision.diagnostic.code, expectedCode);
  assert.equal(nodeDecision.diagnostic.fallback, "keepLastAcceptedDraft");
  assert.equal(typeof nodeDecision.diagnostic.recovery.action, "string");
  assert.equal(typeof nodeDecision.diagnostic.recovery.message, "string");
  return nodeDecision;
}

test("Protocol 0.2 release-candidate fixtures validate without approving the version", () => {
  const input = artifacts();
  for (const document of [
    input.document,
    input.migratedDocument,
    input.edgeDocument,
    input.expiredCountdownDocument,
    input.hiddenPurchaseTargetDocument,
  ]) {
    assert.deepEqual(errors({ ...input, document }), []);
  }
  assert.notDeepEqual(errors({ ...input, document: input.invalidDocument }), []);
  assert.deepEqual(validateCanonicalV02Coverage(input.document), []);
  assert.deepEqual(validateV02JsonFormatting(), []);
  assert.equal(input.manifest.status, "releaseCandidate");
});

test("the canonical fixture declares exactly every used 0.2 capability", () => {
  const input = artifacts();
  assert.deepEqual(
    new Set(
      input.document.compatibility.requiredCapabilities.map(({ name }) => name),
    ),
    expectedV02DocumentCapabilities(input.document),
  );
  assert.deepEqual(
    expectedV02DocumentCapabilities(input.document),
    new Set(input.paywallSchema.$defs.capabilityName.enum),
  );

  const presentationOnly = {
    localization: { locales: { en: { direction: "ltr" } } },
    products: [],
    assets: [],
    layout: {
      type: "scrollContainer",
      content: {
        type: "stack",
        padding: { top: 8, start: 8, bottom: 8, end: 8 },
        sizing: { width: "fill" },
        appearance: { opacity: 0.5 },
        children: [],
      },
    },
  };
  const derived = expectedV02DocumentCapabilities(presentationOnly);
  assert.equal(derived.has("style.box"), true);
  assert.equal(derived.has("layout.sizing"), true);
  assert.equal(derived.has("style.colors"), false);
});

test("Stack uses gap and distribution, permits nested emptiness, and keeps a nonempty root", () => {
  const input = artifacts();
  const directions = new Set(
    walkV02DocumentNodes(input.document)
      .filter(({ node: candidate }) => candidate.type === "stack")
      .map(({ node: candidate }) => candidate.direction),
  );
  assert.deepEqual(directions, new Set(["vertical", "horizontal"]));
  assert.deepEqual(node(input.document, "future-content").children, []);

  const oldShape = artifacts();
  node(oldShape.document, "paywall-content").spacing = 12;
  assertInvalid(oldShape);

  const emptyRoot = artifacts();
  emptyRoot.document.layout.content.children = [];
  refreshCapabilities(emptyRoot);
  assert.ok(errors(emptyRoot).some((error) => error.includes("at least one child")));

  const horizontalRoot = artifacts();
  horizontalRoot.document.layout.content.direction = "horizontal";
  assert.ok(
    errors(horizontalRoot).some((error) => error.includes("root scroll content")),
  );
});

test("sizing is contextual and fill height is never accepted", () => {
  const fixedStack = artifacts();
  node(fixedStack.document, "future-content").visibility = { mode: "always" };
  assert.deepEqual(errors(fixedStack), []);

  const stackFillHeight = artifacts();
  node(stackFillHeight.document, "future-content").sizing.height = "fill";
  assertInvalid(stackFillHeight);

  const textFixedHeight = artifacts();
  node(textFixedHeight.document, "headline").sizing.height = {
    mode: "fixed",
    value: 40,
  };
  assertInvalid(textFixedHeight);

  const carouselFixedHeight = artifacts();
  node(carouselFixedHeight.document, "offer-highlights").sizing.height = {
    mode: "fixed",
    value: 200,
  };
  assertInvalid(carouselFixedHeight);

  const imageBoth = artifacts();
  node(imageBoth.document, "hero").height = 200;
  assertInvalid(imageBoth);
});

test("Product Selector owns direction and gap, including deterministic v0.1 migration", () => {
  const input = artifacts();
  const selector = node(input.document, "plans");
  assert.deepEqual(protocolV02AuthoringWarnings(input.document), []);
  assert.equal(selector.direction, "horizontal");
  assert.equal(typeof selector.gap, "number");

  const migratedSelector = node(input.migratedDocument, "plans");
  assert.equal(migratedSelector.direction, "vertical");
  assert.equal(migratedSelector.gap, 12);
  assert.equal(Object.hasOwn(migratedSelector, "itemSpacing"), false);
  const migratedFeatureList = node(input.migratedDocument, "features");
  assert.equal(migratedFeatureList.gap, 12);
  assert.equal(migratedFeatureList.markerColor, "text.primary");

  const invalid = artifacts();
  selector.direction = "grid";
  assertInvalid(input);

  delete migratedFeatureList.markerColor;
  assertInvalid({ ...input, document: input.migratedDocument });
});

test("Carousel has 2–20 labelled pages, Stack content, and a bounded initial index", () => {
  const canonical = node(artifacts().document, "offer-highlights");
  assert.equal(canonical.pages.length, 2);
  assert.equal(canonical.pages.every((page) => page.content.type === "stack"), true);
  assert.equal(canonical.pages.every((page) => page.accessibilityLabel), true);

  for (const mutate of [
    (carousel) => carousel.pages.splice(1),
    (carousel) =>
      carousel.pages.push(
        ...Array.from({ length: 19 }, (_, index) => ({
          ...structuredClone(carousel.pages[0]),
          id: `extra-page-${index}`,
          content: {
            ...structuredClone(carousel.pages[0].content),
            id: `extra-page-content-${index}`,
          },
        })),
      ),
    (carousel) => {
      carousel.pages[0].content = carousel.pages[0].content.children[0];
    },
    (carousel) => {
      carousel.autoplay = true;
    },
    (carousel) => {
      carousel.loop = true;
    },
  ]) {
    const input = artifacts();
    mutate(node(input.document, "offer-highlights"));
    assertInvalid(input);
  }

  const badIndex = artifacts();
  node(badIndex.document, "offer-highlights").initialPageIndex = 2;
  assert.ok(errors(badIndex).some((error) => error.includes("existing page")));

  const nested = artifacts();
  const carousel = node(nested.document, "offer-highlights");
  carousel.pages[0].content.children.push(structuredClone(carousel));
  assert.ok(
    errors(nested).some((error) => error.includes("nested inside another carousel")),
  );
});

test("visibility supports static modes and one Boolean equality against another Switch", () => {
  assert.equal(evaluateVisibility({ mode: "always" }), true);
  assert.equal(evaluateVisibility({ mode: "hidden" }), false);
  assert.equal(
    evaluateVisibility(
      { mode: "switch", switchId: "control", equals: false },
      { control: false },
    ),
    true,
  );

  const missing = artifacts();
  node(missing.document, "offer-countdown").visibility.switchId = "missing-switch";
  assert.ok(errors(missing).some((error) => error.includes("unknown switch")));

  const nonSwitch = artifacts();
  node(nonSwitch.document, "offer-countdown").visibility.switchId = "headline";
  assert.ok(errors(nonSwitch).some((error) => error.includes("unknown switch")));

  const self = artifacts();
  node(self.document, "show-offer-details").visibility = {
    mode: "switch",
    switchId: "show-offer-details",
    equals: true,
  };
  assert.ok(errors(self).some((error) => error.includes("cannot reference itself")));

  const expression = artifacts();
  node(expression.document, "offer-countdown").visibility.any = [];
  assertInvalid(expression);
});

test("colors are the frozen semantic vocabulary or uppercase #RRGGBBAA", () => {
  for (const color of [
    "surface.emphasis",
    "status.warning",
    "border.strong",
    "brand.custom",
    "#FFFFFF",
    "#abcdef12",
    "rgba(0,0,0,1)",
  ]) {
    const input = artifacts();
    node(input.document, "offer-highlights").appearance.background = color;
    assertInvalid(input);
  }
});

test("typography uses a line-height multiplier and limits only eligible text", () => {
  const canonical = artifacts();
  const subtitle = node(canonical.document, "subtitle");
  assert.equal(subtitle.typography.maxLines, 3);
  assert.equal(subtitle.typography.overflow, "ellipsis");
  assert.deepEqual(subtitle.accessibility.label, subtitle.value);

  for (const property of ["lineHeight", "letterSpacing", "italic"] ) {
    const input = artifacts();
    node(input.document, "headline").typography[property] = 1;
    assertInvalid(input);
  }

  const lowMultiplier = artifacts();
  node(lowMultiplier.document, "headline").typography.lineHeightMultiplier = 0.79;
  assertInvalid(lowMultiplier);

  const missingOverflow = artifacts();
  delete node(missingOverflow.document, "subtitle").typography.overflow;
  assertInvalid(missingOverflow);

  const legalTruncation = artifacts();
  node(legalTruncation.document, "legal").typography.maxLines = 2;
  node(legalTruncation.document, "legal").typography.overflow = "ellipsis";
  assertInvalid(legalTruncation);

  const legalHeading = artifacts();
  node(legalHeading.document, "legal").accessibility = {
    role: "heading",
    level: 2,
  };
  assertInvalid(legalHeading);
  assert.equal(validatePaywallDocument(legalHeading.document).ok, false);

  const buttonTruncation = artifacts();
  node(buttonTruncation.document, "purchase").typography.maxLines = 1;
  node(buttonTruncation.document, "purchase").typography.overflow = "ellipsis";
  assertInvalid(buttonTruncation);
});

test("Product Card Selected is a recursively partial, resettable overlay of complete Default", () => {
  const input = artifacts();
  const selector = node(input.document, "plans");
  const base = resolveProductCardStyle(selector, false);
  const selected = resolveProductCardStyle(selector, true);
  assert.deepEqual(selected, resolveBrowserProductCardStyle(selector, true));
  assert.equal(selected.background, "surface.default");
  assert.equal(selected.border.color, "action.primary");
  assert.equal(selected.border.width, 2);
  assert.equal(selected.padding.top, base.padding.top);
  assert.equal(selected.padding.start, 18);
  assert.deepEqual(selected.badge.border, base.badge.border);
  assert.equal(selected.badge.background, "action.primary");

  delete selector.cardStyles.selected.border.color;
  const perLeafReset = resolveProductCardStyle(selector, true);
  assert.equal(perLeafReset.border.color, base.border.color);
  assert.equal(perLeafReset.border.width, 2);
  assert.deepEqual(errors(input), []);

  selector.cardStyles.selected = {};
  assert.deepEqual(resolveProductCardStyle(selector, true), base);
  assert.deepEqual(errors(input), []);
  assert.equal(
    protocolV02AuthoringWarnings(input.document).some(
      ({ code }) => code === "productCard.indistinguishableStates",
    ),
    true,
  );

  assert.equal(Object.hasOwn(base, "sizing"), false);

  const selectedSizing = artifacts();
  node(selectedSizing.document, "plans").cardStyles.selected = {
    sizing: { width: "content" },
  };
  assertInvalid(selectedSizing);

  const defaultSizing = artifacts();
  node(defaultSizing.document, "plans").cardStyles.default.sizing = {
    width: "fill",
  };
  assertInvalid(defaultSizing);

  const incompleteDefault = artifacts();
  delete node(incompleteDefault.document, "plans").cardStyles.default.badge.border;
  assertInvalid(incompleteDefault);

  const authoredHover = artifacts();
  node(authoredHover.document, "plans").cardStyles.hover = {};
  assertInvalid(authoredHover);

  const lowContrast = artifacts();
  const lowContrastDefault = node(
    lowContrast.document,
    "plans",
  ).cardStyles.default;
  lowContrastDefault.productLabelColor = lowContrastDefault.background;
  assert.equal(
    protocolV02AuthoringWarnings(lowContrast.document).some(
      ({ code, field }) =>
        code === "productCard.lowContrast" && field === "productLabelColor",
    ),
    true,
  );
});

test("Countdown unit ordering and controlled-clock completion are deterministic", () => {
  const input = artifacts();
  const active = node(input.document, "offer-countdown");
  assert.equal(
    resolveV02CountdownState(active, "2029-01-01T00:00:00Z")
      .remainingMilliseconds > 0,
    true,
  );
  const expired = node(input.expiredCountdownDocument, "expired-offer-countdown");
  const completed = resolveV02CountdownState(
    expired,
    "2026-07-17T00:00:00Z",
  );
  assert.equal(completed.completed, true);
  assert.deepEqual(
    completed,
    resolveBrowserCountdownState(expired, "2026-07-17T00:00:00Z"),
  );

  const reversed = artifacts();
  const countdown = node(reversed.document, "offer-countdown");
  countdown.largestUnit = "second";
  countdown.smallestUnit = "day";
  assert.ok(errors(reversed).some((error) => error.includes("largestUnit")));

  const malformed = artifacts();
  node(malformed.document, "offer-countdown").endsAt = "2030-02-31T12:00:00Z";
  assert.ok(errors(malformed).some((error) => error.includes("canonical UTC")));

  const oldFormat = artifacts();
  node(oldFormat.document, "offer-countdown").format = "minutesSeconds";
  assertInvalid(oldFormat);
});

test("a hidden purchase target remains valid but disables purchase with a safe diagnostic", () => {
  const input = artifacts();
  const document = input.hiddenPurchaseTargetDocument;
  assert.deepEqual(errors({ ...input, document }), []);
  const expected = [
    {
      code: "purchase.hiddenProductSelector",
      componentId: "purchase",
      productSelectorId: "plans",
      behavior: "disablePurchase",
      message: "Purchase is disabled because its Product Selector is hidden.",
    },
  ];
  assert.deepEqual(protocolV02RuntimeDiagnostics(document), expected);
  assert.deepEqual(paywallRuntimeDiagnostics(document), expected);
});

test("an accepted revision resets Switch and Carousel runtime state", () => {
  const input = artifacts();
  const expected = {
    switches: {
      "show-offer-details": true,
      "show-technical-details": false,
    },
    carousels: { "offer-highlights": 1 },
  };
  assert.deepEqual(runtimeStateForAcceptedV02Revision(input.document), expected);
  assert.deepEqual(runtimeStateForAcceptedRevision(input.document), expected);
});

test("0.1 to 0.2 migration is deterministic and performs only frozen renames/defaults", () => {
  const input = artifacts();
  const first = migrateCanonicalV01Fixture();
  const second = migrateCanonicalV01Fixture();
  assert.deepEqual(first, second);
  assert.deepEqual(first, input.migratedDocument);
  assert.equal(first.schemaVersion, "0.2");
  for (const { node: candidate } of walkV02DocumentNodes(first)) {
    assert.notEqual(candidate.type, "verticalStack");
    if (candidate.type === "stack") {
      assert.equal(Object.hasOwn(candidate, "spacing"), false);
      assert.equal(Object.hasOwn(candidate, "horizontalAlignment"), false);
      assert.equal(candidate.direction, "vertical");
      assert.equal(candidate.mainAxisDistribution, "start");
    }
  }
  const migratedPurchase = node(first, "purchase");
  assert.equal(migratedPurchase.typography.color, "text.primary");
  assert.equal(Object.hasOwn(migratedPurchase, "appearance"), false);
  assert.equal(Object.hasOwn(migratedPurchase, "sizing"), false);

  const headingLegalSource = JSON.parse(
    readFileSync(
      new URL("../fixtures/v0.1/complete-paywall.json", import.meta.url),
    ),
  );
  const sourceLegal = headingLegalSource.layout.content.children.find(
    ({ id }) => id === "legal",
  );
  assert.ok(sourceLegal);
  sourceLegal.accessibility = { role: "heading", level: 2 };
  const normalizedLegal = node(
    migrateV01ToV02(headingLegalSource, input.paywallSchema),
    "legal",
  );
  assert.deepEqual(normalizedLegal.accessibility, { role: "text" });

  assert.throws(
    () => migrateV01ToV02(first, input.paywallSchema),
    /requires a 0\.1/,
  );
  const invalidSource = JSON.parse(
    readFileSync(
      new URL("../fixtures/v0.1/complete-paywall.json", import.meta.url),
    ),
  );
  invalidSource.executable = "never";
  assert.throws(
    () => migrateV01ToV02(invalidSource, input.paywallSchema),
    /requires a valid 0\.1/,
  );
});

test("Local Preview 0.2 negotiates highest-mutual and withholds from a 0.1-only client", () => {
  const preview = loadPreviewV02Artifacts();
  assert.deepEqual(validatePreviewV02Artifacts(preview), []);
  assert.deepEqual(validatePreviewV02JsonFormatting(), []);
  assert.deepEqual(localPreviewContractVersions, ["0.1", "0.2"]);
  assert.deepEqual(localPreviewVersionPreference, ["0.2", "0.1"]);
  assert.equal(
    localPreviewWebSocketProtocols["0.2"],
    "mosaic.local-preview.v0.2",
  );

  const both = negotiateLocalPreviewVersion(["0.1", "0.2"], ["0.1", "0.2"]);
  assert.equal(both.selectedVersion, "0.2");
  assert.deepEqual(
    both,
    negotiateBrowserPreview(["0.1", "0.2"], ["0.1", "0.2"]),
  );
  const older = negotiateLocalPreviewVersion(["0.1", "0.2"], ["0.1"]);
  assert.equal(older.selectedVersion, "0.1");
  assert.equal(
    older.selectedWebSocketSubprotocol,
    "mosaic.local-preview.v0.1",
  );
  assert.equal(negotiateLocalPreviewVersion(["0.2"], ["0.1"]).ok, false);

  const report = preview.messages.find(
    (message) => message.type === "capabilityReport",
  ).payload;
  const withheld = decideLocalPreviewDraftDelivery({
    capabilityReport: report,
    document: preview.document,
    negotiation: older,
  });
  assert.deepEqual(withheld, {
    delivery: preview.incompatibleClient.delivery,
    diagnostic: preview.incompatibleClient.diagnostic,
  });
  assert.deepEqual(
    withheld,
    decideBrowserDraftDelivery({
      capabilityReport: report,
      document: preview.document,
      negotiation: older,
    }),
  );
  assert.deepEqual(
    decideLocalPreviewDraftDelivery({
      capabilityReport: report,
      document: preview.document,
      negotiation: both,
    }),
    { delivery: "send" },
  );
  assert.deepEqual(
    decideBrowserDraftDelivery({
      capabilityReport: report,
      document: preview.document,
      negotiation: both,
    }),
    { delivery: "send" },
  );

  const incomplete = structuredClone(report);
  incomplete.supportedCapabilities.pop();
  assertWithheldDeliveryParity(
    {
      capabilityReport: incomplete,
      document: preview.document,
      negotiation: both,
    },
    "preview.unsupportedCapability",
  );

  const missingPreviewCapability = structuredClone(report);
  missingPreviewCapability.previewCapabilities.pop();
  assertWithheldDeliveryParity(
    {
      capabilityReport: missingPreviewCapability,
      document: preview.document,
      negotiation: both,
    },
    "preview.unsupportedPreviewCapability",
  );

  const wrongPreviewCapabilityVersion = structuredClone(report);
  wrongPreviewCapabilityVersion.previewCapabilities[0].version = "0.1";
  assertWithheldDeliveryParity(
    {
      capabilityReport: wrongPreviewCapabilityVersion,
      document: preview.document,
      negotiation: both,
    },
    "preview.unsupportedPreviewCapability",
  );

  const insufficientByteLimit = structuredClone(report);
  insufficientByteLimit.limits.maxDocumentBytes =
    new TextEncoder().encode(JSON.stringify(preview.document)).byteLength - 1;
  assertWithheldDeliveryParity(
    {
      capabilityReport: insufficientByteLimit,
      document: preview.document,
      negotiation: both,
    },
    "preview.documentTooLarge",
  );

  assertWithheldDeliveryParity(
    {
      document: preview.document,
      negotiation: both,
    },
    "preview.invalidCapabilityReport",
  );
  assertWithheldDeliveryParity(
    {
      capabilityReport: { ...report, previewCapabilities: null },
      document: preview.document,
      negotiation: both,
    },
    "preview.invalidCapabilityReport",
  );
  assertWithheldDeliveryParity(undefined, "preview.invalidNegotiation");

  assert.equal(
    canonicalSchemasByVersion["0.2"].incompatibleClient.$id,
    preview.incompatibleClientSchema.$id,
  );
});

test("browser validation dispatches Protocol and Local Preview 0.2 without weakening 0.1", () => {
  const preview = loadPreviewV02Artifacts();
  assert.equal(validatePaywallDocument(preview.document).ok, true);
  assert.equal(validateLocalProject(preview.localProject).ok, true);
  const invalidDraft = preview.messages.find(
    ({ messageId }) => messageId === "msg_000009",
  );
  assert.equal(validatePreviewMessage(invalidDraft).ok, false);
  assert.equal(
    canonicalSchemasByVersion["0.2"].paywall.$id,
    preview.paywallSchema.$id,
  );
});

test("approved Protocol and Local Preview 0.1 bytes remain immutable", () => {
  const expected = new Map([
    [
      "schema/v0.1/paywall.schema.json",
      "a860ecd41a7606db996019193a928ff832754c3c3715b2f95376d3e104606ad4",
    ],
    [
      "schema/v0.1/compatibility-manifest.schema.json",
      "8efe299834fa051b6b9d73d8e9fc1e99d5a28e2136723af34d30b348303bae14",
    ],
    [
      "compatibility/v0.1.json",
      "0f91cdb616d56aec5d4ed9c14c6f8dd71707893d5414fc39afcf49ed4c626d92",
    ],
    [
      "fixtures/v0.1/complete-paywall.json",
      "a93994ec99924110cb05d4778c227466aa8e44aadd2097dab5153b55212810c6",
    ],
    [
      "schema/local-preview/v0.1/preview-message.schema.json",
      "570a32f6e6d2680f10906af332f53eee779fc13b2ba9b25b3aea6d8cb37afd5c",
    ],
    [
      "schema/local-preview/v0.1/local-project.schema.json",
      "22762ba0f6ddcf167f3192fd2b4c4fc9c36eb676434973762f3a29d336b451f3",
    ],
    [
      "fixtures/local-preview/v0.1/local-project.json",
      "90d20452605d1333fdebfc1a6ce71e60724fb622e338c8c6242964f599709272",
    ],
    [
      "fixtures/local-preview/v0.1/session-flow.messages.json",
      "12cf4602db63fb2782e0d8777f3873dde952060dda13215fb891409018ed7acd",
    ],
  ]);
  const root = new URL("../", import.meta.url);
  for (const [path, hash] of expected) {
    const bytes = readFileSync(new URL(path, root));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), hash, path);
  }
});
