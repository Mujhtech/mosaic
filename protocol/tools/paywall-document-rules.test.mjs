import assert from "node:assert/strict";
import test from "node:test";

import {
  applyNavigationAction as applyBrowserNavigationAction,
  canonicalSchemas,
  decideLocalPreviewDraftDelivery as decideBrowserDraftDelivery,
  evaluateVisibility,
  localPreviewContractVersions,
  localPreviewVersionPreference,
  localPreviewWebSocketProtocols,
  negotiateLocalPreviewVersion as negotiateBrowserPreview,
  paywallRuntimeDiagnostics as browserPaywallRuntimeDiagnostics,
  interpolateProductText as interpolateBrowserProductText,
  resolveCountdownState as resolveBrowserCountdownState,
  resolveProductBadgeStyle as resolveBrowserProductBadgeStyle,
  resolveProductSelectorSelection as resolveBrowserProductSelectorSelection,
  resolveProductCardStyle as resolveBrowserProductCardStyle,
  resolveAxisSizing as resolveBrowserAxisSizing,
  resolveBackgroundToken as resolveBrowserBackgroundToken,
  resolveMediaBackgroundFallback as resolveBrowserMediaBackgroundFallback,
  runtimeStateForAcceptedRevision as browserRuntimeStateForAcceptedRevision,
  validateLocalProject,
  validatePaywallDocument,
  validatePreviewMessage,
  capabilityNames as browserCapabilityNames,
  capabilityByComponentType as browserCapabilityByComponentType,
  colorFieldNames as browserColorFieldNames,
  expectedDocumentCapabilities as browserExpectedDocumentCapabilities,
  paywallContractVersion as browserPaywallContractVersion,
  requiredCapabilitiesFor,
  reservedAccessibilityKeys as browserReservedAccessibilityKeys,
  usesColor,
  accessibilityAnnouncement as browserAccessibilityAnnouncement,
  resolvedCatalogStrings as browserResolvedCatalogStrings,
} from "../browser/index.js";
import {
  decideLocalPreviewDraftDelivery,
  loadPreviewV04Artifacts,
  negotiateLocalPreviewVersion,
  validatePreviewV04Artifacts,
  validatePreviewV04JsonFormatting,
} from "./preview-validation-v0.4.mjs";
import {
  applyNavigationAction,
  expectedDocumentCapabilities,
  orderedCapabilities,
  paywallAuthoringWarnings,
  paywallRuntimeDiagnostics,
  interpolateProductText,
  resolveProductBadgeStyle,
  resolveProductSelectorSelection,
  resolveProductCardStyle,
  resolveAxisSizing,
  resolveBackgroundToken,
  resolveMediaBackgroundFallback,
  resolveCountdownState,
  runtimeStateForAcceptedRevision,
  validateCanonicalCoverage,
  walkDocumentNodes,
  ACCESSIBILITY_ANNOUNCEMENT_CASE_FLOOR,
  RATING_ANNOUNCEMENT_CASE_FLOOR,
  accessibilityAnnouncement,
  paywallRulesPaths,
  readPaywallJson,
  reservedAccessibilityKeys,
  resolveRatingAnnouncement,
  ratingPoints,
  resolvedCatalogStrings,
  validateAccessibilityAnnouncementVectors,
  validateRatingAnnouncementVectors,
} from "./paywall-document-rules.mjs";
import {
  loadProtocolV04Artifacts,
  protocolV04Paths,
  validateProtocolV04,
  validateV04AccessibilityAnnouncementVectors,
  validateV04JsonFormatting,
} from "./validation-v0.4.mjs";
import {
  fixtureNames,
  rejectionLayerTargets,
  validateRejectionLayers,
} from "./generate-rejection-layers.mjs";

function artifacts() {
  return structuredClone(loadProtocolV04Artifacts());
}

function errors(input) {
  return validateProtocolV04(input);
}

function node(document, id) {
  const entry = walkDocumentNodes(document).find(
    ({ node: candidate }) => candidate.id === id,
  );
  assert.ok(entry, `expected node ${id}`);
  return entry.node;
}

function screen(document, id) {
  const value = document.screens.find((candidate) => candidate.id === id);
  assert.ok(value, `expected screen ${id}`);
  return value;
}

function assertInvalid(input) {
  assert.notDeepEqual(errors(input), []);
}

function refreshCapabilities(input) {
  input.document.compatibility.requiredCapabilities = orderedCapabilities(
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

test("every committed fixture validates, and the contract stays honest about its status", () => {
  const input = artifacts();
  for (const document of [
    input.document,
    input.edgeDocument,
    input.expiredCountdownDocument,
    input.hiddenPurchaseTargetDocument,
    input.navigationOnlyDocument,
  ]) {
    assert.deepEqual(errors({ ...input, document }), []);
  }
  for (const document of input.invalidDocuments) {
    assert.notDeepEqual(errors({ ...input, document }), []);
    assert.equal(validatePaywallDocument(document).ok, false);
  }
  assert.deepEqual(validateCanonicalCoverage(input.document), []);
  assert.deepEqual(validateV04JsonFormatting(), []);
  // Paywall Protocol 0.4 is a draft, not an approved contract. The
  // cross-platform implementability gate in
  // docs/protocol/release-approval-process.md has not cleared. Asserting the
  // status here keeps that honest -- flipping the manifest without clearing the
  // checklist fails this test rather than passing silently.
  assert.equal(input.manifest.status, "draft");
  assert.equal(input.manifest.releaseCandidate, undefined);
  // Local Preview is version-locked to the paywall contract, so it cannot be
  // approved while the contract it carries is a draft.
  assert.equal(loadPreviewV04Artifacts().localPreviewManifest.status, "draft");
});

test("the canonical fixture declares exactly every capability it uses", () => {
  const input = artifacts();
  assert.deepEqual(
    new Set(
      input.document.compatibility.requiredCapabilities.map(({ name }) => name),
    ),
    expectedDocumentCapabilities(input.document),
  );
  assert.deepEqual(
    expectedDocumentCapabilities(input.document),
    new Set(input.paywallSchema.$defs.capabilityName.enum),
  );

  const presentationOnly = {
    localization: { locales: { en: { direction: "ltr" } } },
    products: [],
    assets: [],
    screens: [
      {
        id: "main",
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
      },
    ],
  };
  const derived = expectedDocumentCapabilities(presentationOnly);
  assert.equal(derived.has("style.box"), true);
  assert.equal(derived.has("layout.sizing"), true);
  assert.equal(derived.has("style.colors"), false);
});

test("navigation and external URL actions do not declare normalized commerce outcomes", () => {
  const document = artifacts().navigationOnlyDocument;
  const capabilities = new Set(
    document.compatibility.requiredCapabilities.map(({ name }) => name),
  );
  assert.equal(capabilities.has("action.navigateTo"), true);
  assert.equal(capabilities.has("action.navigateBack"), true);
  assert.equal(capabilities.has("action.openExternalUrl"), true);
  assert.equal(capabilities.has("outcome.normalized"), false);
  assert.equal(validatePaywallDocument(document).ok, true);
});

test("Stack uses gap and distribution, permits nested emptiness, and keeps a nonempty root", () => {
  const input = artifacts();
  const directions = new Set(
    walkDocumentNodes(input.document)
      .filter(({ node: candidate }) => candidate.type === "stack")
      .map(({ node: candidate }) => candidate.direction),
  );
  assert.deepEqual(directions, new Set(["vertical", "horizontal"]));
  assert.deepEqual(node(input.document, "future-content").children, []);

  const oldShape = artifacts();
  node(oldShape.document, "paywall-content").spacing = 12;
  assertInvalid(oldShape);

  const emptyRoot = artifacts();
  emptyRoot.document.screens[0].layout.content.children = [];
  refreshCapabilities(emptyRoot);
  assert.ok(errors(emptyRoot).some((error) => error.includes("at least one child")));

  const horizontalRoot = artifacts();
  horizontalRoot.document.screens[0].layout.content.direction = "horizontal";
  assert.ok(
    errors(horizontalRoot).some((error) => error.includes("root scroll content")),
  );
});

test("screens are bounded, labelled when plural, reachable, and forward-acyclic", () => {
  const canonical = artifacts();
  assert.equal(canonical.document.initialScreenId, "offer");
  assert.equal(canonical.document.screens.length, 2);
  assert.equal(
    canonical.document.screens.every((candidate) => candidate.accessibilityLabel),
    true,
  );

  const singleScreen = artifacts();
  singleScreen.document.screens = [screen(singleScreen.document, "offer")];
  node(singleScreen.document, "view-details").action = { type: "close" };
  delete singleScreen.document.screens[0].accessibilityLabel;
  for (const locale of Object.values(singleScreen.document.localization.locales)) {
    for (const key of [
      "paywall.screen.offer",
      "paywall.screen.details",
      "paywall.navigation.back",
      "paywall.details.title",
      "paywall.details.privacy",
      "paywall.details.privacy.hint",
      "paywall.timeline.support.label",
      "paywall.timeline.support.triage_title",
      "paywall.timeline.support.reply_title",
    ]) {
      delete locale.strings[key];
    }
  }
  refreshCapabilities(singleScreen);
  assert.deepEqual(errors(singleScreen), []);

  const missingPluralLabel = artifacts();
  delete screen(missingPluralLabel.document, "details").accessibilityLabel;
  assertInvalid(missingPluralLabel);

  const missingInitial = artifacts();
  missingInitial.document.initialScreenId = "missing";
  assert.ok(errors(missingInitial).some((error) => error.includes("initialScreenId")));

  const selfTarget = artifacts();
  node(selfTarget.document, "view-details").action.screenId = "offer";
  assert.ok(errors(selfTarget).some((error) => error.includes("differ from source")));

  const unreachable = artifacts();
  node(unreachable.document, "view-details").action = { type: "close" };
  refreshCapabilities(unreachable);
  assert.ok(errors(unreachable).some((error) => error.includes("unreachable")));

  const cyclic = artifacts();
  node(cyclic.document, "details-back").action = {
    type: "navigateTo",
    screenId: "offer",
  };
  refreshCapabilities(cyclic);
  assert.ok(errors(cyclic).some((error) => error.includes("acyclic")));

  const tooMany = artifacts();
  while (tooMany.document.screens.length < 11) {
    const index = tooMany.document.screens.length;
    const copy = structuredClone(screen(tooMany.document, "details"));
    copy.id = `extra-${index}`;
    copy.accessibilityLabel.localizationKey = "paywall.screen.details";
    tooMany.document.screens.push(copy);
  }
  assertInvalid(tooMany);
});

test("Button is one closed container with passive content and six closed actions", () => {
  const input = artifacts();
  const actionTypes = new Set(
    walkDocumentNodes(input.document)
      .filter(({ node: candidate }) => candidate.type === "button")
      .map(({ node: candidate }) => candidate.action.type),
  );
  assert.deepEqual(
    actionTypes,
    new Set([
      "purchase",
      "restore",
      "close",
      "navigateTo",
      "navigateBack",
      "openExternalUrl",
    ]),
  );
  const mixed = node(input.document, "view-details");
  assert.deepEqual(
    mixed.children.map((child) => child.type),
    ["text", "icon"],
  );
  assert.equal(node(input.document, "purchase").inProgressChildren.length, 1);

  const interactiveChild = artifacts();
  node(interactiveChild.document, "view-details").children.push(
    structuredClone(node(interactiveChild.document, "plans")),
  );
  assert.ok(
    errors(interactiveChild).some((error) =>
      error.includes("cannot contain interactive productSelector"),
    ),
  );

  const progressOnNavigation = artifacts();
  node(progressOnNavigation.document, "view-details").inProgressChildren = [
    structuredClone(node(progressOnNavigation.document, "view-details-label")),
  ];
  assert.ok(
    errors(progressOnNavigation).some((error) =>
      error.includes("only for purchase or restore"),
    ),
  );

  for (const url of [
    "http://example.com/privacy",
    "https://user:secret@example.com/privacy",
    "https://user%40example.com/privacy",
    "https://例え.テスト/privacy",
    "https://example.com\\@evil.example/privacy",
    "https://example.com:70000/privacy",
    "javascript:alert(1)",
  ]) {
    const unsafe = artifacts();
    node(unsafe.document, "privacy-policy").action.url = url;
    assertInvalid(unsafe);
    assert.equal(validatePaywallDocument(unsafe.document).ok, false);
  }

  const crossScreenSwitch = artifacts();
  node(crossScreenSwitch.document, "details-title").visibility = {
    mode: "switch",
    switchId: "show-offer-details",
    equals: true,
  };
  refreshCapabilities(crossScreenSwitch);
  assert.ok(
    errors(crossScreenSwitch).some((error) => error.includes("screen details")),
  );
});

test("Icon uses the exact logical vocabulary and image accessibility", () => {
  const validNames = new Set([
    "checkmark",
    "close",
    "lock",
    "restore",
    "externalLink",
    "arrowBackward",
    "arrowForward",
    "chevronBackward",
    "chevronForward",
  ]);
  assert.deepEqual(
    new Set(artifacts().paywallSchema.$defs.iconName.enum),
    validNames,
  );

  const physicalDirection = artifacts();
  node(physicalDirection.document, "view-details-icon").name = "chevronRight";
  assertInvalid(physicalDirection);

  const zeroSize = artifacts();
  node(zeroSize.document, "view-details-icon").size = 0;
  assertInvalid(zeroSize);

  const missingInformativeLabel = artifacts();
  node(missingInformativeLabel.document, "view-details-icon").accessibility = {
    hidden: false,
  };
  assertInvalid(missingInformativeLabel);
});

test("sizing is uniform on both axes and unbounded Fill safely resolves to Fit", () => {
  const fixedStack = artifacts();
  node(fixedStack.document, "future-content").visibility = { mode: "always" };
  assert.deepEqual(errors(fixedStack), []);

  const stackFillHeight = artifacts();
  node(stackFillHeight.document, "future-content").sizing.height = "fill";
  refreshCapabilities(stackFillHeight);
  assert.deepEqual(errors(stackFillHeight), []);

  const textFixedHeight = artifacts();
  node(textFixedHeight.document, "headline").sizing.height = {
    mode: "fixed",
    value: 40,
  };
  assert.deepEqual(errors(textFixedHeight), []);

  const carouselFixedHeight = artifacts();
  node(carouselFixedHeight.document, "offer-highlights").sizing.height = {
    mode: "fixed",
    value: 200,
  };
  assert.deepEqual(errors(carouselFixedHeight), []);

  const image = node(artifacts().document, "hero");
  assert.deepEqual(image.sizing, {
    width: "fill",
    height: { mode: "fixed", value: 180 },
  });
  assert.equal(Object.hasOwn(image, "width"), false);
  assert.equal(Object.hasOwn(image, "height"), false);

  const bounded = resolveAxisSizing("fill", {
    axis: "height",
    bounded: true,
    componentId: "headline",
  });
  assert.deepEqual(bounded, { value: "fill", diagnostic: null });
  const unbounded = resolveAxisSizing("fill", {
    axis: "height",
    bounded: false,
    componentId: "headline",
  });
  assert.equal(unbounded.value, "fit");
  assert.equal(unbounded.diagnostic.code, "layout.unboundedFill");
  assert.deepEqual(resolveBrowserAxisSizing("fill", {
    axis: "height",
    bounded: false,
    componentId: "headline",
  }), unbounded);
});

test("RC4 design tokens are category-scoped, referential, and cycle-safe", () => {
  const input = artifacts();
  assert.equal(input.document.designSystem.colors.length, 2);
  assert.deepEqual(
    resolveBackgroundToken(input.document, {
      type: "backgroundToken",
      id: "offer-gradient",
    }),
    input.document.designSystem.backgrounds.find(
      ({ id }) => id === "offer-gradient",
    ).value,
  );
  assert.deepEqual(
    resolveBrowserBackgroundToken(input.document, {
      type: "backgroundToken",
      id: "offer-gradient",
    }),
    resolveBackgroundToken(input.document, {
      type: "backgroundToken",
      id: "offer-gradient",
    }),
  );

  const missing = artifacts();
  node(missing.document, "paywall-content").appearance.background = {
    type: "backgroundToken",
    id: "missing-background",
  };
  assert.ok(
    errors(missing).some((error) => error.includes("unknown token")),
  );
  assert.equal(validatePaywallDocument(missing.document).ok, false);

  const cycle = artifacts();
  cycle.document.designSystem.colors.find(
    ({ id }) => id === "brand-primary",
  ).value = { type: "colorToken", id: "brand-accent" };
  assert.ok(errors(cycle).some((error) => error.includes("reference cycle")));
  assert.equal(validatePaywallDocument(cycle.document).ok, false);

  const duplicateName = artifacts();
  duplicateName.document.designSystem.colors[1].name =
    duplicateName.document.designSystem.colors[0].name;
  assert.ok(errors(duplicateName).some((error) => error.includes("duplicate name")));
});

test("RC4 gradients, decorative media fallback, and remote asset safety are deterministic", () => {
  const input = artifacts();
  const backgroundTypes = new Set(
    input.document.designSystem.backgrounds.map(({ value }) => value.type),
  );
  assert.deepEqual(
    backgroundTypes,
    new Set(["linearGradient", "radialGradient", "image", "video"]),
  );

  const unordered = artifacts();
  const gradient = unordered.document.designSystem.backgrounds.find(
    ({ id }) => id === "offer-gradient",
  ).value;
  gradient.stops[1].position = gradient.stops[0].position;
  assert.ok(errors(unordered).some((error) => error.includes("stops must be ordered")));
  assert.equal(validatePaywallDocument(unordered.document).ok, false);

  const wrongAssetKind = artifacts();
  wrongAssetKind.document.designSystem.backgrounds.find(
    ({ id }) => id === "offer-texture",
  ).value.assetId = "bundled-ambient-video";
  assert.ok(
    errors(wrongAssetKind).some((error) =>
      error.includes("must reference a image asset"),
    ),
  );

  const unsafeRemote = artifacts();
  unsafeRemote.document.assets.find(
    ({ id }) => id === "remote-sheet-video",
  ).source.url = "https://user:secret@example.com/video.mp4";
  assertInvalid(unsafeRemote);
  assert.equal(validatePaywallDocument(unsafeRemote.document).ok, false);

  const poster = resolveMediaBackgroundFallback(
    input.document,
    { type: "backgroundToken", id: "sheet-video" },
    ["remote-texture"],
  );
  assert.equal(poster.background.type, "image");
  assert.equal(poster.diagnostic.behavior, "usePoster");
  assert.deepEqual(
    resolveBrowserMediaBackgroundFallback(
      input.document,
      { type: "backgroundToken", id: "sheet-video" },
      ["remote-texture"],
    ),
    poster,
  );
  const color = resolveMediaBackgroundFallback(
    input.document,
    { type: "backgroundToken", id: "sheet-video" },
    [],
  );
  assert.equal(color.background.type, "color");
  assert.equal(color.diagnostic.behavior, "useFallbackColor");
});

test("RC4 requires explicit Screen or Sheet presentation and keeps the initial route full-screen", () => {
  const input = artifacts();
  assert.deepEqual(screen(input.document, "offer").presentation, {
    type: "screen",
  });
  assert.deepEqual(screen(input.document, "details").presentation, {
    type: "sheet",
  });

  const initialSheet = artifacts();
  screen(initialSheet.document, "offer").presentation = { type: "sheet" };
  refreshCapabilities(initialSheet);
  assert.ok(
    errors(initialSheet).some((error) =>
      error.includes("initial screen presentation must be screen"),
    ),
  );
  assert.equal(validatePaywallDocument(initialSheet.document).ok, false);

  const converted = artifacts();
  const before = structuredClone(screen(converted.document, "details"));
  screen(converted.document, "details").presentation = { type: "screen" };
  refreshCapabilities(converted);
  assert.deepEqual(errors(converted), []);
  assert.equal(screen(converted.document, "details").id, before.id);
  assert.deepEqual(screen(converted.document, "details").layout, before.layout);
});

test("Product Selector and Feature List own their current 0.3 layout fields", () => {
  const input = artifacts();
  const selector = node(input.document, "plans");
  assert.deepEqual(paywallAuthoringWarnings(input.document), []);
  assert.equal(selector.direction, "horizontal");
  assert.equal(typeof selector.gap, "number");

  const featureList = node(input.document, "features");
  assert.equal(typeof featureList.gap, "number");
  assert.ok(featureList.markerColor);

  const invalid = artifacts();
  node(invalid.document, "plans").direction = "grid";
  assertInvalid(invalid);

  const missingMarker = artifacts();
  delete node(missingMarker.document, "features").markerColor;
  assertInvalid(missingMarker);
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
      { switches: { control: false } },
    ),
    true,
  );
  // A condition whose controller is absent from the supplied state throws.
  // Resolving it would read back as `false`, which is a component that
  // silently disappears rather than a caller that is told it has a bug.
  assert.throws(
    () =>
      evaluateVisibility(
        { mode: "switch", switchId: "control", equals: false },
        { switches: {} },
      ),
    TypeError,
  );
  assert.equal(
    evaluateVisibility(
      { mode: "tab", tabsId: "billing-tabs", equals: "billing-tabs-annual" },
      { tabs: { "billing-tabs": "billing-tabs-annual" } },
    ),
    true,
  );
  assert.equal(
    evaluateVisibility(
      { mode: "tab", tabsId: "billing-tabs", equals: "billing-tabs-monthly" },
      { tabs: { "billing-tabs": "billing-tabs-annual" } },
    ),
    false,
  );
  assert.throws(
    () =>
      evaluateVisibility(
        { mode: "tab", tabsId: "billing-tabs", equals: "billing-tabs-annual" },
        { tabs: {} },
      ),
    TypeError,
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

  const ordinaryTextCanUseTextFeatures = artifacts();
  node(ordinaryTextCanUseTextFeatures.document, "legal").typography.maxLines = 2;
  node(ordinaryTextCanUseTextFeatures.document, "legal").typography.overflow =
    "ellipsis";
  node(ordinaryTextCanUseTextFeatures.document, "legal").accessibility = {
    role: "heading",
    level: 2,
  };
  assert.deepEqual(errors(ordinaryTextCanUseTextFeatures), []);
  assert.equal(validatePaywallDocument(ordinaryTextCanUseTextFeatures.document).ok, true);

  const buttonTruncation = artifacts();
  node(buttonTruncation.document, "purchase").typography = {};
  assertInvalid(buttonTruncation);
});

test("Product Card and Product Badge Selected are recursively partial box-style overlays", () => {
  const input = artifacts();
  const card = node(input.document, "plans-yearly-plan-card");
  const badge = node(input.document, "plans-yearly-plan-card-badge");
  const base = resolveProductCardStyle(card, false);
  const selected = resolveProductCardStyle(card, true);
  assert.deepEqual(selected, resolveBrowserProductCardStyle(card, true));
  assert.deepEqual(selected.background, {
    type: "color",
    value: "surface.elevated",
  });
  assert.equal(selected.border.color, "action.primary");
  assert.equal(selected.border.width, 2);
  assert.equal(selected.padding.top, base.padding.top);
  assert.equal(selected.padding.start, 18);
  assert.equal(selected.opacity, base.opacity);
  assert.deepEqual(
    resolveProductBadgeStyle(badge, true),
    resolveBrowserProductBadgeStyle(badge, true),
  );
  assert.deepEqual(resolveProductBadgeStyle(badge, true).background, {
    type: "color",
    value: "action.primary",
  });

  delete card.styles.selected.border.color;
  const perLeafReset = resolveProductCardStyle(card, true);
  assert.equal(perLeafReset.border.color, base.border.color);
  assert.equal(perLeafReset.border.width, 2);
  assert.deepEqual(errors(input), []);

  card.styles.selected = {};
  assert.deepEqual(resolveProductCardStyle(card, true), base);
  assert.deepEqual(errors(input), []);
  assert.equal(
    paywallAuthoringWarnings(input.document).some(
      ({ code }) => code === "productCard.indistinguishableStates",
    ),
    true,
  );

  assert.equal(Object.hasOwn(base, "sizing"), false);

  const selectedSizing = artifacts();
  node(selectedSizing.document, "plans-yearly-plan-card").styles.selected = {
    sizing: { width: "content" },
  };
  assertInvalid(selectedSizing);

  const defaultSizing = artifacts();
  node(defaultSizing.document, "plans-yearly-plan-card").styles.default.sizing = {
    width: "fill",
  };
  assertInvalid(defaultSizing);

  const incompleteDefault = artifacts();
  delete node(incompleteDefault.document, "plans-yearly-plan-card").styles.default.opacity;
  assertInvalid(incompleteDefault);

  const authoredHover = artifacts();
  node(authoredHover.document, "plans-yearly-plan-card").styles.hover = {};
  assertInvalid(authoredHover);

  const lowContrast = artifacts();
  const lowContrastCard = node(lowContrast.document, "plans-yearly-plan-card");
  lowContrastCard.children[0].typography.color =
    lowContrastCard.styles.default.background.value;
  assert.equal(
    paywallAuthoringWarnings(lowContrast.document).some(
      ({ code, field }) =>
        code === "productCard.lowContrast" &&
        field === "plans-yearly-plan-card-name",
    ),
    true,
  );

  // A literal the checker cannot read is reported, not silently passed. Only
  // literals: semantic tokens resolve in the renderer's theme and are a
  // legitimate skip, and a translucent literal composites over unknown pixels.
  const unreadable = artifacts();
  const unreadableCard = node(unreadable.document, "plans-yearly-plan-card");
  unreadableCard.children[0].typography.color = "#12345";
  const unreadableWarnings = paywallAuthoringWarnings(unreadable.document);
  assert.equal(
    unreadableWarnings.some(
      ({ code, field }) =>
        code === "productCard.contrastNotEvaluated" &&
        field === "plans-yearly-plan-card-name",
    ),
    true,
  );
  assert.equal(
    unreadableWarnings.some(({ code }) => code === "productCard.lowContrast"),
    false,
  );

  for (const readable of ["surface.elevated", "#11223380"]) {
    const skipped = artifacts();
    node(skipped.document, "plans-yearly-plan-card").children[0].typography.color =
      readable;
    assert.equal(
      paywallAuthoringWarnings(skipped.document).some(
        ({ code }) => code === "productCard.contrastNotEvaluated",
      ),
      false,
      readable,
    );
  }
});

test("Product Selector owns ordered real cards with closed Product Card and Badge structure", () => {
  const input = artifacts();
  const selector = node(input.document, "plans");
  assert.equal(selector.cards.length, 3);
  assert.deepEqual(
    selector.cards.map((card) => card.productReferenceId),
    ["monthly-plan", "yearly-plan", "lifetime-plan"],
  );
  assert.equal(
    selector.cards.some((card) => card.id === selector.initialProductCardId),
    true,
  );
  assert.equal(
    selector.cards.every(
      (card) =>
        walkDocumentNodes(input.document).find(
          ({ node: candidate }) => candidate.id === card.id,
        )?.ancestors.at(-1)?.id === selector.id,
    ),
    true,
  );
  assert.equal(
    node(input.document, "plans-yearly-plan-card-badge").placement.mode,
    "nested",
  );
  assert.deepEqual(
    node(input.document, "plans-lifetime-plan-card-badge").placement,
    { mode: "overlay", anchor: "topEnd", inset: 8 },
  );
  const fallbackSelection = resolveProductSelectorSelection(
    selector,
    ["monthly-plan", "lifetime-plan"],
    selector.initialProductCardId,
  );
  assert.deepEqual(fallbackSelection, {
    selectedProductCardId: "plans-monthly-plan-card",
    selectedProductReferenceId: "monthly-plan",
    purchaseEnabled: true,
    showUnavailableFallback: false,
  });
  assert.deepEqual(
    fallbackSelection,
    resolveBrowserProductSelectorSelection(
      selector,
      ["monthly-plan", "lifetime-plan"],
      selector.initialProductCardId,
    ),
  );
  assert.deepEqual(resolveProductSelectorSelection(selector, []), {
    selectedProductCardId: null,
    selectedProductReferenceId: null,
    purchaseEnabled: false,
    showUnavailableFallback: true,
  });

  const duplicate = artifacts();
  const duplicateSelector = node(duplicate.document, "plans");
  duplicateSelector.cards[1].productReferenceId =
    duplicateSelector.cards[0].productReferenceId;
  assert.match(errors(duplicate).join("\n"), /duplicate product reference/u);

  const missingInitial = artifacts();
  node(missingInitial.document, "plans").initialProductCardId = "missing-card";
  assert.match(errors(missingInitial).join("\n"), /undeclared Product Card/u);

  const recursiveBadge = artifacts();
  const badge = node(recursiveBadge.document, "plans-yearly-plan-card-badge");
  badge.children.push(structuredClone(badge));
  assertInvalid(recursiveBadge);

  const interactive = artifacts();
  node(interactive.document, "plans-monthly-plan-card").children.push(
    structuredClone(node(interactive.document, "view-details")),
  );
  assertInvalid(interactive);

  const tooManyPassive = artifacts();
  const boundedCard = node(tooManyPassive.document, "plans-monthly-plan-card");
  const passiveTemplate = structuredClone(boundedCard.children[0]);
  boundedCard.children = Array.from({ length: 21 }, (_, index) => ({
    ...structuredClone(passiveTemplate),
    id: `bounded-card-text-${index + 1}`,
  }));
  assert.match(errors(tooManyPassive).join("\n"), /exceeds 20 passive/u);

  const badgeCountsTowardBound = artifacts();
  const cardWithBadge = node(
    badgeCountsTowardBound.document,
    "plans-yearly-plan-card",
  );
  const boundedBadge = cardWithBadge.children.find(
    (child) => child.type === "productBadge",
  );
  const text = structuredClone(cardWithBadge.children[0]);
  cardWithBadge.children = [
    ...Array.from({ length: 19 }, (_, index) => ({
      ...structuredClone(text),
      id: `badge-bound-text-${index + 1}`,
    })),
    boundedBadge,
  ];
  assert.match(
    errors(badgeCountsTowardBound).join("\n"),
    /exceeds 20 passive/u,
  );

  const deepStacks = artifacts();
  const deepCard = node(deepStacks.document, "plans-monthly-plan-card");
  let nested = structuredClone(deepCard.children[0]);
  for (let depth = 5; depth >= 1; depth -= 1) {
    nested = {
      type: "stack",
      id: `card-nested-stack-${depth}`,
      direction: "vertical",
      gap: 0,
      padding: { top: 0, start: 0, bottom: 0, end: 0 },
      mainAxisDistribution: "start",
      crossAxisAlignment: "stretch",
      children: [nested],
    };
  }
  deepCard.children = [nested];
  assert.match(errors(deepStacks).join("\n"), /Stack depth 4/u);
});

test("product templates use only name and price inside card content and fail closed", () => {
  const input = artifacts();
  assert.equal(
    expectedDocumentCapabilities(input.document).has(
      "localization.productTemplate",
    ),
    true,
  );
  assert.deepEqual(
    interpolateProductText("{{ product.name }} — {{product.price}}", {
      name: "Mosaic Pro",
      price: "$9.99",
    }),
    { available: true, value: "Mosaic Pro — $9.99", diagnostic: null },
  );
  assert.deepEqual(
    interpolateBrowserProductText("{{ product.name }}", {
      fallbackName: "Monthly",
    }),
    { available: true, value: "Monthly", diagnostic: null },
  );
  assert.deepEqual(
    interpolateProductText("Plan: {{ product.name }}", {
      name: "Mosaic Pro",
      price: "   ",
    }),
    { available: true, value: "Plan: Mosaic Pro", diagnostic: null },
  );
  assert.deepEqual(interpolateBrowserProductText("No runtime value", {}), {
    available: true,
    value: "No runtime value",
    diagnostic: null,
  });
  assert.deepEqual(interpolateProductText("{{ product.price }}", {}), {
    available: false,
    value: null,
    diagnostic: "missingPrice",
  });
  assert.deepEqual(interpolateBrowserProductText("{{ product.price }}", { price: "  " }), {
    available: false,
    value: null,
    diagnostic: "missingPrice",
  });
  assert.deepEqual(interpolateProductText(null, { price: "$9.99" }), {
    available: false,
    value: null,
    diagnostic: "invalidTemplate",
  });
  assert.deepEqual(
    interpolateProductText("{{ product.price | currency }}", {
      price: "$9.99",
    }),
    { available: false, value: null, diagnostic: "invalidTemplate" },
  );

  const unknown = artifacts();
  const unknownText = node(unknown.document, "plans-monthly-plan-card-name");
  unknownText.value.default = "{{ product.currency }}";
  unknown.document.localization.locales.en.strings[
    unknownText.value.localizationKey
  ] = unknownText.value.default;
  assert.match(errors(unknown).join("\n"), /malformed product template/u);

  const malformed = artifacts();
  const malformedText = node(malformed.document, "plans-monthly-plan-card-name");
  malformedText.value.default = "{{ product.price }";
  malformed.document.localization.locales.en.strings[
    malformedText.value.localizationKey
  ] = malformedText.value.default;
  assert.match(errors(malformed).join("\n"), /malformed product template/u);

  const outOfContext = artifacts();
  const headline = node(outOfContext.document, "headline");
  headline.value.default = "{{ product.price }}";
  outOfContext.document.localization.locales.en.strings[
    headline.value.localizationKey
  ] = headline.value.default;
  assert.match(errors(outOfContext).join("\n"), /outside a Product Card/u);
});

test("Countdown unit ordering and controlled-clock completion are deterministic", () => {
  const input = artifacts();
  const active = node(input.document, "offer-countdown");
  assert.equal(
    resolveCountdownState(active, "2029-01-01T00:00:00Z")
      .remainingMilliseconds > 0,
    true,
  );
  const expired = node(input.expiredCountdownDocument, "expired-offer-countdown");
  const completed = resolveCountdownState(
    expired,
    "2026-07-17T00:00:00Z",
  );
  assert.equal(completed.completed, true);
  assert.deepEqual(
    completed,
    resolveBrowserCountdownState(expired, "2026-07-17T00:00:00Z"),
  );

  // An unparsable deadline must refuse to resolve on both copies, exactly as an
  // unparsable clock does. Left to arithmetic it returned NaN remaining with
  // completed:false -- an offer that neither counts down nor ever expires.
  // (A calendar-impossible date such as 2030-02-31 is caught by the schema's
  // canonical-UTC rule below; Date.parse silently rolls it over.)
  for (const endsAt of ["not a timestamp", "", undefined]) {
    const unresolvable = { ...expired, endsAt };
    for (const resolve of [resolveCountdownState, resolveBrowserCountdownState]) {
      assert.throws(
        () => resolve(unresolvable, "2026-07-17T00:00:00Z"),
        (error) =>
          error instanceof TypeError && /valid endsAt deadline/u.test(error.message),
        `expected ${String(endsAt)} to be refused by ${resolve.name}`,
      );
    }
    // The invalid-clock branch it is now consistent with.
    for (const resolve of [resolveCountdownState, resolveBrowserCountdownState]) {
      assert.throws(
        () => resolve(expired, "not a clock"),
        (error) =>
          error instanceof TypeError && /controlled clock/u.test(error.message),
      );
    }
  }

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
  assert.deepEqual(paywallRuntimeDiagnostics(document), expected);
  assert.deepEqual(browserPaywallRuntimeDiagnostics(document), expected);
});

test("an accepted revision resets Switch, Tabs, Carousel, and navigation runtime state", () => {
  const input = artifacts();
  const expected = {
    switches: {
      "show-offer-details": true,
      "show-technical-details": false,
    },
    tabs: { "billing-tabs": "billing-tabs-annual" },
    carousels: { "offer-highlights": 1 },
    navigation: { currentScreenId: "offer", history: ["offer"] },
    selectedProducts: { plans: "plans-yearly-plan-card" },
  };
  assert.deepEqual(runtimeStateForAcceptedRevision(input.document), expected);
  assert.deepEqual(browserRuntimeStateForAcceptedRevision(input.document), expected);
});

test("navigation history is runtime-only and root Navigate Back is a safe no-op", () => {
  const initial = { currentScreenId: "offer", history: ["offer"] };
  const forwardAction = { type: "navigateTo", screenId: "details" };
  const forward = applyNavigationAction(initial, forwardAction);
  assert.deepEqual(forward, {
    state: {
      currentScreenId: "details",
      history: ["offer", "details"],
    },
    diagnostic: null,
  });
  assert.deepEqual(forward, applyBrowserNavigationAction(initial, forwardAction));

  const back = applyNavigationAction(forward.state, { type: "navigateBack" });
  assert.deepEqual(back.state, initial);
  assert.equal(back.diagnostic, null);

  const rootBack = applyNavigationAction(initial, { type: "navigateBack" });
  assert.deepEqual(rootBack.state, initial);
  assert.equal(rootBack.diagnostic.code, "navigation.noBackTarget");
  assert.deepEqual(
    rootBack,
    applyBrowserNavigationAction(initial, { type: "navigateBack" }),
  );
});

test("Local Preview negotiates its sole version and withholds from an incompatible client", () => {
  const preview = loadPreviewV04Artifacts();
  assert.deepEqual(validatePreviewV04Artifacts(preview), []);
  assert.deepEqual(validatePreviewV04JsonFormatting(), []);
  // One contract version, so one offer. A peer that speaks something else is
  // refused rather than served a generation Mosaic no longer carries.
  assert.deepEqual(localPreviewContractVersions, ["0.4"]);
  assert.deepEqual(localPreviewVersionPreference, ["0.4"]);
  assert.equal(
    localPreviewWebSocketProtocols["0.4"],
    "mosaic.local-preview.v0.4",
  );

  const supported = negotiateLocalPreviewVersion(["0.4"], ["0.4"]);
  assert.equal(supported.selectedVersion, "0.4");
  assert.deepEqual(supported, negotiateBrowserPreview(["0.4"], ["0.4"]));
  const incompatible = negotiateLocalPreviewVersion(["0.4"], ["0.3"]);
  assert.deepEqual(incompatible, negotiateBrowserPreview(["0.4"], ["0.3"]));
  assert.equal(incompatible.ok, false);
  assert.equal(incompatible.diagnostic.code, "preview.noMutualVersion");

  const report = preview.messages.find(
    (message) => message.type === "capabilityReport",
  ).payload;
  const withheld = decideLocalPreviewDraftDelivery({
    capabilityReport: report,
    document: preview.document,
    negotiation: incompatible,
  });
  assert.deepEqual(withheld, {
    delivery: "withhold",
    diagnostic: incompatible.diagnostic,
  });
  assert.deepEqual(
    withheld,
    decideBrowserDraftDelivery({
      capabilityReport: report,
      document: preview.document,
      negotiation: incompatible,
    }),
  );
  assert.deepEqual(
    decideLocalPreviewDraftDelivery({
      capabilityReport: report,
      document: preview.document,
      negotiation: supported,
    }),
    { delivery: "send" },
  );
  assert.deepEqual(
    decideBrowserDraftDelivery({
      capabilityReport: report,
      document: preview.document,
      negotiation: supported,
    }),
    { delivery: "send" },
  );

  const incomplete = structuredClone(report);
  incomplete.supportedCapabilities.pop();
  assertWithheldDeliveryParity(
    {
      capabilityReport: incomplete,
      document: preview.document,
      negotiation: supported,
    },
    "preview.unsupportedCapability",
  );

  const missingPreviewCapability = structuredClone(report);
  missingPreviewCapability.previewCapabilities.pop();
  assertWithheldDeliveryParity(
    {
      capabilityReport: missingPreviewCapability,
      document: preview.document,
      negotiation: supported,
    },
    "preview.unsupportedPreviewCapability",
  );

  const wrongPreviewCapabilityVersion = structuredClone(report);
  wrongPreviewCapabilityVersion.previewCapabilities[0].version = "9.9";
  assertWithheldDeliveryParity(
    {
      capabilityReport: wrongPreviewCapabilityVersion,
      document: preview.document,
      negotiation: supported,
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
      negotiation: supported,
    },
    "preview.documentTooLarge",
  );

  assertWithheldDeliveryParity(
    {
      document: preview.document,
      negotiation: supported,
    },
    "preview.invalidCapabilityReport",
  );
  assertWithheldDeliveryParity(
    {
      capabilityReport: { ...report, previewCapabilities: null },
      document: preview.document,
      negotiation: supported,
    },
    "preview.invalidCapabilityReport",
  );
  assertWithheldDeliveryParity(undefined, "preview.invalidNegotiation");
});

test("browser validation reads the sole Protocol and Local Preview contract", () => {
  const preview = loadPreviewV04Artifacts();
  assert.equal(validatePaywallDocument(preview.document).ok, true);
  assert.equal(validateLocalProject(preview.localProject).ok, true);
  const invalidDraft = preview.messages.find(
    ({ messageId }) => messageId === "msg_000009",
  );
  assert.equal(validatePreviewMessage(invalidDraft).ok, false);
  assert.equal(canonicalSchemas.paywall.$id, preview.paywallSchema.$id);
});

/**
 * Protocol 0.3's four new components.
 *
 * Each assertion below breaks exactly one rule and expects a rejection. A rule
 * that never rejects anything is a rule the renderers are free to ignore, and
 * the 2026-08 fallback audit found several checks that passed vacuously because
 * nothing in the corpus ever reached them.
 */
test("Tabs carry an authored initial selection and a tab-scoped visibility condition", () => {
  const canonical = artifacts();
  const tabs = node(canonical.document, "billing-tabs");
  assert.equal(tabs.initialTabId, "billing-tabs-annual");
  assert.notEqual(tabs.initialTabId, tabs.tabs[0].id);
  assert.deepEqual(node(canonical.document, "annual-note").visibility, {
    mode: "tab",
    tabsId: "billing-tabs",
    equals: "billing-tabs-annual",
  });

  const unknownInitial = artifacts();
  node(unknownInitial.document, "billing-tabs").initialTabId = "billing-tabs-quarterly";
  assert.ok(
    errors(unknownInitial).some((error) =>
      error.includes("initialTabId must name one of its declared tabs"),
    ),
  );

  const duplicateTabIds = artifacts();
  const duplicated = node(duplicateTabIds.document, "billing-tabs");
  duplicated.tabs[1].id = duplicated.tabs[0].id;
  duplicated.initialTabId = duplicated.tabs[0].id;
  assertInvalid(duplicateTabIds);

  const unknownTab = artifacts();
  node(unknownTab.document, "annual-note").visibility.equals = "billing-tabs-weekly";
  assert.ok(
    errors(unknownTab).some((error) => error.includes("visibility references unknown tab")),
  );

  const unknownTabs = artifacts();
  node(unknownTabs.document, "annual-note").visibility.tabsId = "no-such-tabs";
  assert.ok(
    errors(unknownTabs).some((error) => error.includes("visibility references unknown tabs")),
  );

  // Inside a panel the condition is already decided, so both the vacuously
  // true and the unsatisfiable form are dead layout and both reject.
  const selfReferential = artifacts();
  node(selfReferential.document, "billing-tabs-annual-body").visibility = {
    mode: "tab",
    tabsId: "billing-tabs",
    equals: "billing-tabs-annual",
  };
  refreshCapabilities(selfReferential);
  assert.ok(
    errors(selfReferential).some((error) =>
      error.includes("cannot reference the Tabs component it belongs to"),
    ),
  );

  const crossScreen = artifacts();
  node(crossScreen.document, "details-title").visibility = {
    mode: "tab",
    tabsId: "billing-tabs",
    equals: "billing-tabs-annual",
  };
  refreshCapabilities(crossScreen);
  assert.ok(
    errors(crossScreen).some((error) =>
      error.includes("must reference a Tabs component on screen details"),
    ),
  );

  const insideButton = artifacts();
  node(insideButton.document, "view-details").children.push(
    structuredClone(node(insideButton.document, "billing-tabs")),
  );
  assertInvalid(insideButton);
});

test("Timeline styles exist exactly where an entry consumes them", () => {
  const canonical = artifacts();
  const trial = node(canonical.document, "trial-timeline");
  assert.deepEqual(
    trial.entries.map((entry) => entry.marker?.kind ?? null),
    ["dot", "ordinal", "icon"],
  );
  assert.equal(trial.entries.at(-1).description, undefined);
  assert.equal(node(canonical.document, "support-timeline").markerColor, undefined);

  for (const field of ["markerColor", "markerSize", "descriptionTypography"]) {
    const missing = artifacts();
    delete node(missing.document, "trial-timeline")[field];
    assert.ok(
      errors(missing).some((error) => error.includes(`must declare ${field}`)),
      `expected timeline to require ${field}`,
    );

    const unused = artifacts();
    const support = node(unused.document, "support-timeline");
    support[field] = structuredClone(node(unused.document, "trial-timeline")[field]);
    assert.ok(
      errors(unused).some((error) =>
        error.includes(`declares ${field} but no entry uses it`),
      ),
      `expected timeline to reject an unused ${field}`,
    );
  }

  const duplicateEntries = artifacts();
  const entries = node(duplicateEntries.document, "trial-timeline").entries;
  entries[1].id = entries[0].id;
  assertInvalid(duplicateEntries);
});

test("Award and Social Proof resolve their assets and bound their rating", () => {
  const canonical = artifacts();
  assert.equal(node(canonical.document, "press-award").emblem.assetId, "award-emblem");
  assert.equal(node(canonical.document, "editor-award").emblem.type, "icon");
  assert.equal(node(canonical.document, "analyst-note").rating, undefined);
  assert.equal(node(canonical.document, "rated-review").rating.step, "half");
  assert.equal(node(canonical.document, "rated-review").rating.value, 9);

  const unknownEmblem = artifacts();
  node(unknownEmblem.document, "press-award").emblem.assetId = "no-such-asset";
  assert.ok(
    errors(unknownEmblem).some((error) =>
      error.includes("award press-award emblem references unknown asset"),
    ),
  );

  const videoEmblem = artifacts();
  node(videoEmblem.document, "press-award").emblem.assetId = "bundled-ambient-video";
  assert.ok(
    errors(videoEmblem).some((error) =>
      error.includes("award press-award emblem must reference an image asset"),
    ),
  );

  const unknownAvatar = artifacts();
  node(unknownAvatar.document, "rated-review").avatar.assetId = "no-such-asset";
  assert.ok(
    errors(unknownAvatar).some((error) =>
      error.includes("social proof rated-review avatar references unknown asset"),
    ),
  );

  // 5 points at half steps is 10 steps. 11 is a rating the scale cannot state.
  const overrated = artifacts();
  node(overrated.document, "rated-review").rating.value = 11;
  assert.ok(
    errors(overrated).some((error) => error.includes("exceeds 10 half steps out of 5")),
  );
  // The bound is not vacuous in the other direction: the boundary is legal.
  const exact = artifacts();
  node(exact.document, "rated-review").rating.value = 10;
  assert.deepEqual(errors(exact), []);

  const overratedWhole = artifacts();
  node(overratedWhole.document, "whole-review").rating.value = 6;
  assert.ok(
    errors(overratedWhole).some((error) =>
      error.includes("exceeds 5 whole steps out of 5"),
    ),
  );
});

test("every invalid-fixture corpus declares a case-count floor it actually meets", () => {
  // The floor exists because a corpus that has silently emptied reconciles
  // perfectly against a recorded map of zero fixtures and reports success over
  // nothing. Breaking it must fail, so break it here.
  assert.deepEqual(validateRejectionLayers(), []);
  const paywallTarget = rejectionLayerTargets.find(
    (target) => target.directory === "fixtures/v0.4/invalid",
  );
  assert.ok(paywallTarget, "the paywall corpus must be registered");
  assert.ok(paywallTarget.minimumCases >= 20);
  assert.ok(
    fixtureNames(paywallTarget.directory).length >= paywallTarget.minimumCases,
  );
  for (const target of rejectionLayerTargets) {
    assert.ok(
      fixtureNames(target.directory).length > 0,
      `${target.directory} holds no invalid fixtures`,
    );
  }
});

test("the browser and Node reference implementations derive the same capabilities", () => {
  // Two implementations of one contract drift silently: a component added to
  // the Node capability table and not the browser one produces a document that
  // validates in `npm run check` and is rejected by Studio. The 0.1-era entries
  // this check would have caught (`closeButton`, `legalText`, `verticalStack`,
  // `purchaseButton`, `restoreButton`) survived in the browser table alone.
  const input = artifacts();
  for (const document of [
    input.document,
    input.edgeDocument,
    input.expiredCountdownDocument,
    input.hiddenPurchaseTargetDocument,
    input.navigationOnlyDocument,
  ]) {
    assert.equal(
      validatePaywallDocument(document).ok,
      true,
      `browser rejected valid document ${document.id}`,
    );
    // The declared set is exactly what the Node implementation derives, and the
    // browser accepting the document proves it derives that set too: an
    // over- or under-declared capability is a browser diagnostic.
    assert.deepEqual(
      document.compatibility.requiredCapabilities,
      orderedCapabilities(document, input.paywallSchema),
    );
  }
});

test("runtime diagnostics refuse a document that is not Protocol 0.3", () => {
  // Reporting no diagnostics for an unreadable version reads as "nothing is
  // wrong with this document", which is the opposite of what it means.
  assert.throws(
    () => browserPaywallRuntimeDiagnostics({ schemaVersion: "0.2" }),
    TypeError,
  );
  assert.deepEqual(
    browserPaywallRuntimeDiagnostics(artifacts().navigationOnlyDocument),
    [],
  );
});

test("a rating announces points, not steps, from a reserved localized template", () => {
  // The whole point: `value` counts steps and `maximum` counts points, so
  // announcing `value` directly says "9 out of 5" for a four-and-a-half.
  const half = { symbol: "star", value: 9, maximum: 5, step: "half" };
  assert.equal(ratingPoints(half), "4.5");
  assert.notEqual(ratingPoints(half), String(half.value));
  assert.equal(ratingPoints({ ...half, value: 10 }), "5");
  assert.equal(ratingPoints({ ...half, value: 0 }), "0");
  assert.equal(ratingPoints({ ...half, value: 1 }), "0.5");
  assert.equal(ratingPoints({ symbol: "star", value: 3, maximum: 5, step: "whole" }), "3");

  assert.equal(
    resolveRatingAnnouncement(
      half,
      "{{ rating.value }} out of {{ rating.maximum }} stars",
    ),
    "4.5 out of 5 stars",
  );
  // The phrasing is authored, so word order and language travel with the
  // catalog rather than with the renderer.
  assert.equal(
    resolveRatingAnnouncement(half, "{{ rating.maximum }} 中 {{ rating.value }}"),
    "5 中 4.5",
  );
  // A template missing a placeholder would announce a rating with no number in
  // it, so it refuses rather than producing a plausible-looking string.
  assert.throws(
    () => resolveRatingAnnouncement(half, "{{ rating.value }} stars"),
    TypeError,
  );
  assert.throws(() => resolveRatingAnnouncement(half, undefined), TypeError);

  assert.deepEqual(validateRatingAnnouncementVectors(), []);
  const vectors = readPaywallJson(paywallRulesPaths.ratingAnnouncementVectors);
  // The floor is a declared commitment, so the number itself is pinned here.
  // Asserting only `cases.length >= FLOOR` is satisfied by lowering the floor,
  // which is the move the floor exists to prevent.
  assert.ok(RATING_ANNOUNCEMENT_CASE_FLOOR >= 10);
  assert.ok(
    validateRatingAnnouncementVectors({ ...vectors, cases: [] }).some((error) =>
      error.includes("floor"),
    ),
  );
  // A vector whose expectation was written from steps must be caught.
  const stepsNotPoints = structuredClone(vectors);
  const target = stepsNotPoints.cases.find((entry) => entry.points === "4.5");
  target.expectedAnnouncement = "9 out of 5 stars";
  assert.ok(
    validateRatingAnnouncementVectors(stepsNotPoints).some((error) =>
      error.includes("resolves to"),
    ),
  );
});

test("reserved accessibility strings exist exactly where the protocol announces them", () => {
  const canonical = artifacts();
  const strings =
    canonical.document.localization.locales[
      canonical.document.localization.defaultLocale
    ].strings;
  for (const key of Object.keys(reservedAccessibilityKeys)) {
    assert.ok(Object.hasOwn(strings, key), `expected reserved key ${key}`);
  }
  assert.ok(
    canonical.document.compatibility.requiredCapabilities.some(
      (capability) => capability.name === "accessibility.reservedStrings",
    ),
  );

  for (const key of Object.keys(reservedAccessibilityKeys)) {
    const missing = artifacts();
    for (const catalog of Object.values(missing.document.localization.locales)) {
      delete catalog.strings[key];
    }
    assert.ok(
      errors(missing).some((error) =>
        error.includes(`must declare reserved key ${key}`),
      ),
      `expected ${key} to be required`,
    );
  }

  // A reserved string nothing announces is a value nothing reads.
  const unconsumed = artifacts();
  const navigation = { ...unconsumed, document: unconsumed.navigationOnlyDocument };
  const navigationLocales = navigation.document.localization.locales;
  for (const catalog of Object.values(navigationLocales)) {
    catalog.strings["mosaic.a11y.rating"] =
      "{{ rating.value }} out of {{ rating.maximum }}";
  }
  assert.ok(
    errors(navigation).some((error) =>
      error.includes("declares reserved key mosaic.a11y.rating but the document"),
    ),
  );

  // A translation that drops a placeholder announces a rating with no number.
  const dropped = artifacts();
  dropped.document.localization.locales.de.strings["mosaic.a11y.rating"] =
    "von {{ rating.maximum }} Sternen";
  assert.ok(
    errors(dropped).some((error) =>
      error.includes("must contain {{ rating.value }} exactly once"),
    ),
  );

  // Substitution is closed: no other expression is interpreted.
  const foreign = artifacts();
  foreign.document.localization.locales.en.strings["mosaic.a11y.in_progress"] =
    "{{ product.name }} in progress";
  assert.ok(
    errors(foreign).some((error) =>
      error.includes("contains an unsupported template expression"),
    ),
  );
});

test("the exported derivation surface is the one derivation actually uses", () => {
  // Studio, and eventually the three SDKs, must call these instead of
  // hand-mirroring them. A hand-mirrored capability list is rejected at
  // delivery rather than caught by a typechecker, and the validator and browser
  // capability tables had already drifted apart once inside this repository.
  const input = artifacts();

  // Ordering is the schema enum, not a second list that happens to match.
  assert.deepEqual(
    [...browserCapabilityNames],
    input.paywallSchema.$defs.capabilityName.enum,
  );
  assert.equal(browserPaywallContractVersion, "0.4");

  for (const document of [
    input.document,
    input.edgeDocument,
    input.expiredCountdownDocument,
    input.hiddenPurchaseTargetDocument,
    input.navigationOnlyDocument,
  ]) {
    // The export agrees with the Node reference implementation...
    assert.deepEqual(
      [...browserExpectedDocumentCapabilities(document)],
      orderedCapabilities(document, input.paywallSchema).map(
        (capability) => capability.name,
      ),
      `capability derivation diverged for ${document.id}`,
    );
    // ...and with what the committed fixture declares, in order.
    assert.deepEqual(
      [...requiredCapabilitiesFor(document)],
      document.compatibility.requiredCapabilities,
      `serialised capabilities diverged for ${document.id}`,
    );
    for (const name of browserExpectedDocumentCapabilities(document)) {
      assert.ok(
        browserCapabilityNames.includes(name),
        `${name} is not a declared capability`,
      );
    }
  }

  // Every exported colour-field name is consulted by the predicate derivation
  // runs, and a name outside the list is not. An exported entry that nothing
  // reads is precisely the stale-table problem these exports exist to end.
  for (const field of browserColorFieldNames) {
    assert.equal(
      usesColor({ [field]: "#112233FF" }),
      true,
      `${field} is exported but not consulted`,
    );
  }
  assert.equal(usesColor({ notAColorField: "#112233FF" }), false);
  assert.equal(usesColor({ type: "colorToken", id: "brand-primary" }), true);

  // The component-to-capability table covers every component the schema admits.
  const componentTypes = new Set(
    walkDocumentNodes(input.document).map(({ node }) => node.type),
  );
  for (const type of componentTypes) {
    assert.ok(
      browserCapabilityByComponentType[type],
      `${type} has no capability mapping`,
    );
  }

  // The reserved-key table is one table, not two that agree today.
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(browserReservedAccessibilityKeys).map(([key, value]) => [
        key,
        [...value.placeholders],
      ]),
    ),
    Object.fromEntries(
      Object.entries(reservedAccessibilityKeys).map(([key, value]) => [
        key,
        [...value.placeholders],
      ]),
    ),
  );
});

test("selection-state styling is gated by the component capability that requires it", () => {
  // Tabs requires `styles`, so a renderer cannot declare `component.tabs` and
  // decline two-state tab styling -- the component capability already carries
  // the claim, and a second capability that can never vary independently of it
  // would be a negotiation signal with no information in it.
  const input = artifacts();
  const schema = input.paywallSchema;
  assert.ok(schema.$defs.tabsComponent.required.includes("styles"));
  assert.equal(schema.$defs.tabsComponent.properties.styles.$ref, "#/$defs/selectionStyles");
  assert.equal(
    schema.$defs.productCardStyles.$ref,
    "#/$defs/selectionStyles",
    "Product Card and Tabs must share one selection-style contract",
  );
  assert.ok(!schema.$defs.capabilityName.enum.includes("style.tabStates"));

  // Neither does `style.productCardStates` exist any more. It was exactly
  // co-derived with the three components that require it, so it carried no
  // information a reader could act on independently, and nothing may
  // reintroduce it -- not the schema, not the manifest, not the derivation.
  assert.ok(!schema.$defs.capabilityName.enum.includes("style.productCardStates"));
  for (const document of [
    input.document,
    input.edgeDocument,
    input.hiddenPurchaseTargetDocument,
    input.navigationOnlyDocument,
  ]) {
    const derived = new Set(browserExpectedDocumentCapabilities(document));
    assert.equal(
      derived.has("style.productCardStates"),
      false,
      `style.productCardStates reappeared in ${document.id}`,
    );
  }

  // The discriminating case: a document with Tabs and no Product Card at all.
  // Asserting co-derivation only on the canonical fixture proves nothing, because
  // it contains both and the two are true together either way.
  const tabsOnlyDocument = structuredClone(input.navigationOnlyDocument);
  const tabs = structuredClone(node(input.document, "billing-tabs"));
  // The canonical Tabs animates its selection through the canonical motion
  // catalog, which this document does not declare. Capability co-derivation is
  // the subject here, so the entrance travels no further than the node.
  const stripMotion = (value) => {
    if (Array.isArray(value)) {
      for (const entry of value) stripMotion(entry);
      return;
    }
    if (!value || typeof value !== "object") return;
    delete value.motion;
    for (const entry of Object.values(value)) stripMotion(entry);
  };
  stripMotion(tabs);
  const canonicalStrings =
    input.document.localization.locales[
      input.document.localization.defaultLocale
    ].strings;
  const collectKeys = (value, keys = new Set()) => {
    if (Array.isArray(value)) {
      for (const entry of value) collectKeys(entry, keys);
    } else if (value && typeof value === "object") {
      if (typeof value.localizationKey === "string") keys.add(value.localizationKey);
      for (const entry of Object.values(value)) collectKeys(entry, keys);
    }
    return keys;
  };
  for (const key of collectKeys(tabs)) {
    for (const catalog of Object.values(tabsOnlyDocument.localization.locales)) {
      if (Object.hasOwn(canonicalStrings, key)) catalog.strings[key] = canonicalStrings[key];
    }
  }
  tabsOnlyDocument.screens[0].layout.content.children.push(tabs);
  const tabsOnly = new Set(browserExpectedDocumentCapabilities(tabsOnlyDocument));
  assert.ok(tabsOnly.has("component.tabs"));
  assert.ok(!tabsOnly.has("component.productCard"));
  assert.ok(
    !tabsOnly.has("style.productCardStates"),
    "Tabs must not derive a product-card capability",
  );
  // Tab styles still carry authored colour like every other authored box.
  assert.ok(tabsOnly.has("style.colors"));
  // And the document is genuinely valid, so the derivation ran on a real
  // document rather than on a shape the schema would have rejected.
  tabsOnlyDocument.compatibility.requiredCapabilities = [
    ...requiredCapabilitiesFor(tabsOnlyDocument),
  ];
  assert.deepEqual(errors({ ...input, document: tabsOnlyDocument }), []);
});

test("announced segments are separate elements and are never joined", () => {
  const input = artifacts();
  const document = input.document;
  const strings = resolvedCatalogStrings(document.localization, "en");

  const social = accessibilityAnnouncement(node(document, "rated-review"), {
    strings,
  });
  assert.equal(social.composition, "separateElements");
  // The ruling, in one assertion: there is no separator to concatenate with.
  assert.equal(social.separator, null);
  assert.deepEqual(
    social.elements.map((element) => element.segment),
    ["rating", "quote", "attribution"],
  );
  assert.equal(social.container.role, "group");
  assert.deepEqual(social.decorative, ["avatar"]);
  // An absent rating produces no segment at all -- not an empty one.
  const unrated = accessibilityAnnouncement(node(document, "analyst-note"), {
    strings,
  });
  assert.deepEqual(
    unrated.elements.map((element) => element.segment),
    ["quote", "attribution"],
  );

  const award = accessibilityAnnouncement(node(document, "editor-award"), {
    strings,
  });
  assert.deepEqual(
    award.elements.map((element) => element.segment),
    ["title", "subtitle"],
  );
  assert.deepEqual(
    accessibilityAnnouncement(node(document, "press-award"), {
      strings,
    }).elements.map((element) => element.segment),
    ["title"],
  );

  const timeline = accessibilityAnnouncement(node(document, "trial-timeline"), {
    strings,
  });
  assert.equal(timeline.container.role, "list");
  assert.deepEqual(
    timeline.elements.map((element) => `${element.item}.${element.segment}`),
    [
      "trial-today.title",
      "trial-today.description",
      "trial-reminder.title",
      "trial-reminder.description",
      "trial-charge.title",
    ],
  );
  assert.ok(timeline.decorative.includes("connector"));

  // Nothing a renderer produces may contain a segment boundary it invented.
  for (const announcement of [social, unrated, award, timeline]) {
    for (const element of announcement.elements) {
      assert.ok(!element.text.includes(". "), "a segment carries joined text");
    }
  }

  // A component with no composed announcement contract refuses rather than
  // returning an empty shape a renderer would read as "announce nothing".
  assert.throws(
    () => accessibilityAnnouncement(node(document, "headline"), { strings }),
    TypeError,
  );
  assert.throws(
    () => accessibilityAnnouncement(node(document, "rated-review"), {}),
    TypeError,
  );
});

test("a busy Button carries its state as a value and keeps its authored name", () => {
  const input = artifacts();
  const document = input.document;
  const strings = resolvedCatalogStrings(document.localization, "en");
  const purchase = node(document, "purchase");

  const idle = accessibilityAnnouncement(purchase, { strings, state: "idle" });
  const busy = accessibilityAnnouncement(purchase, {
    strings,
    state: "inProgress",
  });

  assert.equal(idle.composition, "singleElement");
  assert.equal(idle.container.role, "button");
  assert.equal(idle.container.value, null);
  assert.equal(busy.container.value, strings["mosaic.a11y.in_progress"]);
  // The name is authored and must not change when the control becomes busy.
  assert.equal(busy.container.label, idle.container.label);
  assert.notEqual(busy.container.value, busy.container.label);
  // A Button is one element; neither its children nor its in-progress children
  // are announced, so there is no leading-or-trailing question to get wrong.
  assert.deepEqual(idle.elements, []);
  assert.deepEqual(busy.elements, []);
  assert.deepEqual(idle.decorative, ["purchase-label"]);
  assert.deepEqual(busy.decorative, ["purchase-progress-label"]);

  // The state is a catalog string, never composed.
  const german = accessibilityAnnouncement(purchase, {
    strings: resolvedCatalogStrings(document.localization, "de"),
    state: "inProgress",
  });
  assert.equal(german.container.value, "Wird ausgeführt");

  // An unstated Button state is a caller bug, not an idle Button.
  assert.throws(
    () => accessibilityAnnouncement(purchase, { strings }),
    TypeError,
  );
  assert.throws(
    () => accessibilityAnnouncement(purchase, { strings, state: "busy" }),
    TypeError,
  );

  assert.deepEqual(validateV04AccessibilityAnnouncementVectors(), []);
  const vectors = readPaywallJson(
    protocolV04Paths.accessibilityAnnouncementVectors,
  );
  assert.ok(ACCESSIBILITY_ANNOUNCEMENT_CASE_FLOOR >= 11);
  assert.ok(
    validateAccessibilityAnnouncementVectors(
      { ...vectors, cases: [] },
      document,
    ).some((error) => error.includes("floor")),
  );
  // A vector recording a joined announcement must be rejected.
  const joined = structuredClone(vectors);
  const target = joined.cases.find((entry) => entry.componentType === "award");
  target.separator = ". ";
  assert.ok(
    validateAccessibilityAnnouncementVectors(joined, document).some((error) =>
      error.includes("segments are never joined"),
    ),
  );

  // The browser mirror resolves identically, case for case.
  for (const entry of vectors.cases) {
    const target = node(document, entry.componentId);
    assert.deepEqual(
      browserAccessibilityAnnouncement(target, {
        strings: browserResolvedCatalogStrings(document.localization, entry.locale),
        state: entry.state ?? null,
      }),
      accessibilityAnnouncement(target, {
        strings: resolvedCatalogStrings(document.localization, entry.locale),
        state: entry.state ?? null,
      }),
      `browser mirror diverged on ${entry.id}`,
    );
  }
});
