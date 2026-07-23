import assert from "node:assert/strict";
import test from "node:test";

import {
  applyNavigationAction as applyBrowserNavigationAction,
  canonicalSchemasByVersion,
  decideLocalPreviewDraftDelivery as decideBrowserDraftDelivery,
  evaluateVisibility,
  localPreviewContractVersions,
  localPreviewVersionPreference,
  localPreviewWebSocketProtocols,
  migrateV02RC2CandidateToRC3 as migrateBrowserV02RC2CandidateToRC3,
  migrateV02RC3CandidateToRC4 as migrateBrowserV02RC3CandidateToRC4,
  negotiateLocalPreviewVersion as negotiateBrowserPreview,
  paywallRuntimeDiagnostics,
  interpolateProductText as interpolateBrowserProductText,
  resolveCountdownState as resolveBrowserCountdownState,
  resolveProductBadgeStyle as resolveBrowserProductBadgeStyle,
  resolveProductSelectorSelection as resolveBrowserProductSelectorSelection,
  resolveProductCardStyle as resolveBrowserProductCardStyle,
  resolveAxisSizing as resolveBrowserAxisSizing,
  resolveBackgroundToken as resolveBrowserBackgroundToken,
  resolveMediaBackgroundFallback as resolveBrowserMediaBackgroundFallback,
  runtimeStateForAcceptedRevision,
  validateLocalProject,
  validatePaywallDocument,
  validatePreviewMessage,
} from "../browser/index.js";
import { migrateV02RC2CandidateToRC3 } from "./migrate-v0.2-rc2-to-rc3.mjs";
import { migrateV02RC3CandidateToRC4 } from "./migrate-v0.2-rc3-to-rc4.mjs";
import {
  decideLocalPreviewDraftDelivery,
  loadPreviewV02Artifacts,
  negotiateLocalPreviewVersion,
  validatePreviewV02Artifacts,
  validatePreviewV02JsonFormatting,
} from "./preview-validation-v0.2.mjs";
import {
  applyV02NavigationAction,
  expectedV02DocumentCapabilities,
  loadProtocolV02Artifacts,
  orderedV02Capabilities,
  protocolV02AuthoringWarnings,
  protocolV02RuntimeDiagnostics,
  interpolateProductText,
  resolveProductBadgeStyle,
  resolveProductSelectorSelection,
  resolveProductCardStyle,
  resolveV02AxisSizing,
  resolveV02BackgroundToken,
  resolveV02MediaBackgroundFallback,
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

function screen(document, id) {
  const value = document.screens.find((candidate) => candidate.id === id);
  assert.ok(value, `expected screen ${id}`);
  return value;
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
  const derived = expectedV02DocumentCapabilities(presentationOnly);
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
    walkV02DocumentNodes(input.document)
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

  const bounded = resolveV02AxisSizing("fill", {
    axis: "height",
    bounded: true,
    componentId: "headline",
  });
  assert.deepEqual(bounded, { value: "fill", diagnostic: null });
  const unbounded = resolveV02AxisSizing("fill", {
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
    resolveV02BackgroundToken(input.document, {
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
    resolveV02BackgroundToken(input.document, {
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

  const poster = resolveV02MediaBackgroundFallback(
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
  const color = resolveV02MediaBackgroundFallback(
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

test("Product Selector and Feature List own their current 0.2 layout fields", () => {
  const input = artifacts();
  const selector = node(input.document, "plans");
  assert.deepEqual(protocolV02AuthoringWarnings(input.document), []);
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
    protocolV02AuthoringWarnings(input.document).some(
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
    protocolV02AuthoringWarnings(lowContrast.document).some(
      ({ code, field }) =>
        code === "productCard.lowContrast" &&
        field === "plans-yearly-plan-card-name",
    ),
    true,
  );
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
        walkV02DocumentNodes(input.document).find(
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
    expectedV02DocumentCapabilities(input.document).has(
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

test("an accepted revision resets Switch, Carousel, and navigation runtime state", () => {
  const input = artifacts();
  const expected = {
    switches: {
      "show-offer-details": true,
      "show-technical-details": false,
    },
    carousels: { "offer-highlights": 1 },
    navigation: { currentScreenId: "offer", history: ["offer"] },
    selectedProducts: { plans: "plans-yearly-plan-card" },
  };
  assert.deepEqual(runtimeStateForAcceptedV02Revision(input.document), expected);
  assert.deepEqual(runtimeStateForAcceptedRevision(input.document), expected);
});

test("navigation history is runtime-only and root Navigate Back is a safe no-op", () => {
  const initial = { currentScreenId: "offer", history: ["offer"] };
  const forwardAction = { type: "navigateTo", screenId: "details" };
  const forward = applyV02NavigationAction(initial, forwardAction);
  assert.deepEqual(forward, {
    state: {
      currentScreenId: "details",
      history: ["offer", "details"],
    },
    diagnostic: null,
  });
  assert.deepEqual(forward, applyBrowserNavigationAction(initial, forwardAction));

  const back = applyV02NavigationAction(forward.state, { type: "navigateBack" });
  assert.deepEqual(back.state, initial);
  assert.equal(back.diagnostic, null);

  const rootBack = applyV02NavigationAction(initial, { type: "navigateBack" });
  assert.deepEqual(rootBack.state, initial);
  assert.equal(rootBack.diagnostic.code, "navigation.noBackTarget");
  assert.deepEqual(
    rootBack,
    applyBrowserNavigationAction(initial, { type: "navigateBack" }),
  );
});

test("RC3 candidate recovery upgrades backgrounds, sizing, presentation, and capabilities to RC4", () => {
  const input = artifacts();
  const candidate = structuredClone(input.hiddenPurchaseTargetDocument);
  delete candidate.designSystem;
  function downgrade(value) {
    if (Array.isArray(value)) {
      value.forEach(downgrade);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, entry] of Object.entries(value)) {
      if (key === "background" && entry?.type === "color") {
        value[key] = structuredClone(entry.value);
      } else {
        downgrade(entry);
      }
    }
    if (value.sizing) {
      value.sizing.width =
        value.sizing.width === "fit" ? "content" : value.sizing.width;
      delete value.sizing.height;
    }
    if (value.type === "image") {
      value.width = value.sizing?.width ?? "fill";
      delete value.sizing;
    }
  }
  for (const candidateScreen of candidate.screens) {
    delete candidateScreen.presentation;
    downgrade(candidateScreen.layout);
  }
  const first = migrateV02RC3CandidateToRC4(candidate, input.paywallSchema);
  const second = migrateV02RC3CandidateToRC4(candidate, input.paywallSchema);
  assert.deepEqual(first, second);
  assert.deepEqual(migrateBrowserV02RC3CandidateToRC4(candidate), first);
  assert.deepEqual(errors({ ...input, document: first.document }), []);
  assert.deepEqual(first.document.designSystem, {
    colors: [],
    backgrounds: [],
    shadows: [],
  });
  assert.equal(
    first.document.screens.every(({ presentation }) => presentation.type === "screen"),
    true,
  );
  assert.equal(node(first.document, "hero").sizing.height, "fit");
  assert.equal(Object.hasOwn(candidate, "designSystem"), false);
});

test("RC2 candidate recovery preserves representable card state and emits review diagnostics", () => {
  const input = artifacts();
  const candidate = structuredClone(input.hiddenPurchaseTargetDocument);
  const selector = node(candidate, "plans");
  const sourceCards = structuredClone(selector.cards);
  candidate.products[1].badge = {
    default: "Best value",
    localizationKey: "paywall.products.best_value",
  };
  for (const locale of Object.values(candidate.localization.locales)) {
    for (const key of Object.keys(locale.strings)) {
      if (key.startsWith("mosaic.migration.product_card_")) {
        delete locale.strings[key];
      }
    }
  }
  selector.productReferenceIds = sourceCards.map(
    (card) => card.productReferenceId,
  );
  selector.initiallySelectedProductReferenceId = "yearly-plan";
  selector.cardStyles = {
    default: {
      background: "surface.elevated",
      border: { color: "border.default", width: 1 },
      cornerRadius: 12,
      padding: { top: 12, start: 12, bottom: 12, end: 12 },
      contentGap: 8,
      contentAlignment: "spaceBetween",
      productLabelColor: "text.primary",
      runtimePriceColor: "text.secondary",
      badge: {
        background: "surface.default",
        textColor: "text.primary",
        border: { color: "border.default", width: 1 },
        cornerRadius: 999,
        padding: { top: 4, start: 8, bottom: 4, end: 8 },
      },
    },
    selected: {
      background: "surface.default",
      border: { color: "action.primary", width: 2 },
      contentGap: 12,
      productLabelColor: "action.primary",
      badge: { textColor: "action.onPrimary" },
    },
  };
  delete selector.cards;
  delete selector.initialProductCardId;
  delete selector.crossAxisAlignment;
  const first = migrateV02RC2CandidateToRC3(candidate, input.paywallSchema);
  const second = migrateV02RC2CandidateToRC3(candidate, input.paywallSchema);
  const browserRecovery = migrateBrowserV02RC2CandidateToRC3(candidate);
  assert.deepEqual(first, second);
  assert.deepEqual(browserRecovery, first);
  assert.deepEqual(errors({ ...input, document: first.document }), []);
  assert.equal(Object.hasOwn(candidate.products[1], "badge"), true);
  assert.equal(Object.hasOwn(first.document.products[1], "badge"), false);
  const recoveredSelector = node(first.document, "plans");
  assert.equal(recoveredSelector.cards.length, 2);
  assert.equal(
    node(first.document, recoveredSelector.cards[1].id).children.some(
      (child) => child.type === "productBadge",
    ),
    true,
  );
  assert.deepEqual(
    first.diagnostics.map(({ field }) => field),
    [
      "cardStyles.selected.contentGap",
      "cardStyles.selected.productLabelColor",
      "cardStyles.selected.badge.textColor",
    ],
  );
});

test("Local Preview negotiates only 0.2 and withholds from an incompatible client", () => {
  const preview = loadPreviewV02Artifacts();
  assert.deepEqual(validatePreviewV02Artifacts(preview), []);
  assert.deepEqual(validatePreviewV02JsonFormatting(), []);
  assert.deepEqual(localPreviewContractVersions, ["0.2"]);
  assert.deepEqual(localPreviewVersionPreference, ["0.2"]);
  assert.equal(
    localPreviewWebSocketProtocols["0.2"],
    "mosaic.local-preview.v0.2",
  );

  const supported = negotiateLocalPreviewVersion(["0.2"], ["0.2"]);
  assert.equal(supported.selectedVersion, "0.2");
  assert.deepEqual(
    supported,
    negotiateBrowserPreview(["0.2"], ["0.2"]),
  );
  const incompatible = negotiateLocalPreviewVersion(["0.2"], ["0.1"]);
  assert.deepEqual(
    incompatible,
    negotiateBrowserPreview(["0.2"], ["0.1"]),
  );
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

test("browser validation dispatches the sole Protocol and Local Preview 0.2 contract", () => {
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
