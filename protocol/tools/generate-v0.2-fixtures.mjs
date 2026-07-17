import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { migrateV01ToV02 } from "./migrate-v0.1-to-v0.2.mjs";
import { orderedV02Capabilities } from "./validation-v0.2.mjs";

const toolsDirectory = dirname(fileURLToPath(import.meta.url));
const protocolRoot = resolve(toolsDirectory, "..");
const sourcePath = resolve(protocolRoot, "fixtures/v0.1/complete-paywall.json");
const schemaPath = resolve(protocolRoot, "schema/v0.2/paywall.schema.json");
const fixtureDirectory = resolve(protocolRoot, "fixtures/v0.2");

const zeroInsets = Object.freeze({ top: 0, start: 0, bottom: 0, end: 0 });

function typography({
  alignment = "start",
  color = "text.primary",
  fontSize = 16,
  lineHeightMultiplier = 1.5,
  maxLines,
  overflow,
  style = "body",
  weight = "regular",
} = {}) {
  return {
    style,
    fontSize,
    lineHeightMultiplier,
    weight,
    color,
    alignment,
    ...(maxLines === undefined ? {} : { maxLines, overflow }),
  };
}

function localizedText(defaultValue, localizationKey) {
  return { default: defaultValue, localizationKey };
}

function stack({
  children = [],
  crossAxisAlignment = "stretch",
  direction = "vertical",
  gap = 0,
  id,
  mainAxisDistribution = "start",
  padding = zeroInsets,
}) {
  return {
    type: "stack",
    id,
    direction,
    gap,
    padding: { ...padding },
    mainAxisDistribution,
    crossAxisAlignment,
    children,
  };
}

function addLocalizedStrings(document, stringsByLocale) {
  for (const [locale, strings] of Object.entries(stringsByLocale)) {
    Object.assign(document.localization.locales[locale].strings, strings);
  }
}

function buildCompleteFixture(source, schema) {
  const document = migrateV01ToV02(source, schema);
  const root = document.layout.content;
  document.layout.background = "surface.default";
  root.appearance = {
    background: "surface.default",
    opacity: 1,
    clipContent: false,
  };
  root.sizing = { width: "fill" };

  const closeActions = root.children.find((node) => node.id === "close-actions");
  closeActions.direction = "horizontal";
  closeActions.mainAxisDistribution = "end";
  closeActions.crossAxisAlignment = "center";
  closeActions.outerInsets = { top: 0, start: 0, bottom: 4, end: 0 };
  closeActions.children[0].sizing = { width: "content" };

  const hero = root.children.find((node) => node.id === "hero");
  hero.appearance = {
    cornerRadius: 18,
    opacity: 0.98,
  };
  hero.outerInsets = { top: 0, start: 4, bottom: 0, end: 4 };

  const headline = root.children.find((node) => node.id === "headline");
  headline.typography.color = "#17324DFF";
  headline.appearance = {
    background: "transparent",
    padding: { top: 4, start: 8, bottom: 4, end: 8 },
  };
  headline.sizing = { width: "fill" };

  const subtitle = root.children.find((node) => node.id === "subtitle");
  subtitle.typography.maxLines = 3;
  subtitle.typography.overflow = "ellipsis";
  subtitle.accessibility.label = structuredClone(subtitle.value);
  subtitle.outerInsets = { top: 0, start: 8, bottom: 0, end: 8 };

  const features = root.children.find((node) => node.id === "features");
  features.markerColor = "action.primary";
  features.appearance = {
    background: "surface.elevated",
    border: { color: "border.default", width: 1 },
    cornerRadius: 12,
    opacity: 1,
    padding: { top: 12, start: 12, bottom: 12, end: 12 },
  };
  features.sizing = { width: "fill" };

  const plans = root.children.find((node) => node.id === "plans");
  plans.direction = "horizontal";
  plans.cardStyles = {
    default: {
      background: "surface.elevated",
      border: { color: "border.default", width: 1 },
      cornerRadius: 12,
      padding: { top: 16, start: 16, bottom: 16, end: 16 },
      contentGap: 8,
      contentAlignment: "spaceBetween",
      productLabelColor: "text.primary",
      runtimePriceColor: "text.secondary",
      badge: {
        background: "surface.default",
        textColor: "action.primary",
        border: { color: "border.default", width: 1 },
        cornerRadius: 999,
        padding: { top: 4, start: 8, bottom: 4, end: 8 },
      },
    },
    selected: {
      background: "surface.default",
      border: { color: "action.primary", width: 2 },
      padding: { start: 18, end: 18 },
      contentGap: 12,
      productLabelColor: "action.primary",
      badge: {
        background: "action.primary",
        textColor: "action.onPrimary",
      },
    },
  };
  plans.appearance = { opacity: 1 };
  plans.sizing = { width: "fill" };
  plans.outerInsets = { top: 4, start: 0, bottom: 4, end: 0 };

  const commerceActions = root.children.find(
    (node) => node.id === "commerce-actions",
  );
  const purchase = commerceActions.children.find(
    (node) => node.id === "purchase",
  );
  purchase.typography.color = "action.onPrimary";
  purchase.appearance = {
    background: "action.primary",
    cornerRadius: 12,
    opacity: 1,
    padding: { top: 14, start: 20, bottom: 14, end: 20 },
  };
  purchase.sizing = { width: "fill" };
  const restore = commerceActions.children.find((node) => node.id === "restore");
  restore.appearance = {
    background: "transparent",
    border: { color: "border.default", width: 1 },
    cornerRadius: 10,
    opacity: 0.9,
    padding: { top: 12, start: 16, bottom: 12, end: 16 },
  };
  restore.sizing = { width: "fill" };
  restore.outerInsets = { top: 2, start: 0, bottom: 0, end: 0 };

  const legal = root.children.find((node) => node.id === "legal");
  legal.accessibility.label = structuredClone(legal.value);
  legal.appearance = { background: "transparent", opacity: 0.85 };
  legal.sizing = { width: "fill" };

  const primarySwitch = {
    type: "switch",
    id: "show-offer-details",
    label: localizedText("Show offer details", "paywall.offer.switch"),
    initialValue: true,
    typography: typography({ style: "label", weight: "semibold" }),
    offTrackColor: "border.default",
    onTrackColor: "action.primary",
    thumbColor: "action.onPrimary",
    appearance: {
      background: "surface.elevated",
      cornerRadius: 10,
      opacity: 1,
      padding: { top: 12, start: 12, bottom: 12, end: 12 },
    },
    outerInsets: { top: 4, start: 0, bottom: 0, end: 0 },
    accessibility: {
      label: localizedText("Show offer details", "paywall.offer.switch"),
      hint: localizedText(
        "Shows or hides optional offer content",
        "paywall.offer.switch.hint",
      ),
    },
  };

  const secondarySwitch = {
    type: "switch",
    id: "show-technical-details",
    label: localizedText(
      "Show technical details",
      "paywall.offer.technical_switch",
    ),
    initialValue: false,
    typography: typography({ style: "label", weight: "medium" }),
    offTrackColor: "border.default",
    onTrackColor: "#17324DFF",
    thumbColor: "action.onPrimary",
    visibility: {
      mode: "switch",
      switchId: "show-offer-details",
      equals: true,
    },
    accessibility: {
      label: localizedText(
        "Show technical details",
        "paywall.offer.technical_switch",
      ),
    },
  };

  const carousel = {
    type: "carousel",
    id: "offer-highlights",
    initialPageIndex: 1,
    showsIndicators: true,
    pages: [
      {
        id: "native-renderers-page",
        accessibilityLabel: localizedText(
          "Native renderers",
          "paywall.offer.page_one.label",
        ),
        content: stack({
          id: "offer-page-one-content",
          gap: 8,
          padding: { top: 16, start: 16, bottom: 16, end: 16 },
          children: [
            {
              type: "text",
              id: "offer-page-one-title",
              value: localizedText(
                "One paywall, three native renderers",
                "paywall.offer.page_one",
              ),
              typography: typography({
                style: "heading",
                fontSize: 22,
                lineHeightMultiplier: 28 / 22,
                weight: "bold",
              }),
              accessibility: { role: "heading", level: 2 },
            },
          ],
        }),
      },
      {
        id: "remote-update-page",
        accessibilityLabel: localizedText(
          "Remote updates",
          "paywall.offer.page_two.label",
        ),
        content: stack({
          id: "offer-page-two-content",
          direction: "horizontal",
          gap: 12,
          mainAxisDistribution: "center",
          crossAxisAlignment: "center",
          padding: { top: 24, start: 16, bottom: 24, end: 16 },
          children: [
            {
              type: "text",
              id: "offer-page-two-title",
              value: localizedText(
                "Update without an app release",
                "paywall.offer.page_two",
              ),
              typography: typography({
                alignment: "center",
                color: "action.onPrimary",
                style: "heading",
                fontSize: 22,
                lineHeightMultiplier: 28 / 22,
                weight: "bold",
              }),
              accessibility: { role: "heading", level: 2 },
            },
          ],
        }),
      },
    ],
    appearance: {
      background: "#17324DFF",
      border: { color: "#8AB4F8FF", width: 1 },
      cornerRadius: 16,
      opacity: 0.96,
      clipContent: true,
    },
    sizing: { width: "fill" },
    outerInsets: { top: 4, start: 0, bottom: 4, end: 0 },
    visibility: {
      mode: "switch",
      switchId: "show-offer-details",
      equals: true,
    },
    accessibility: {
      label: localizedText("Offer highlights", "paywall.offer.carousel"),
      hint: localizedText(
        "Swipe horizontally between offer highlights",
        "paywall.offer.carousel.hint",
      ),
    },
  };

  const countdown = {
    type: "countdown",
    id: "offer-countdown",
    endsAt: "2030-12-31T23:59:59Z",
    largestUnit: "day",
    smallestUnit: "second",
    completedText: localizedText("Offer ended", "paywall.offer.completed"),
    typography: typography({
      alignment: "center",
      color: "action.primary",
      style: "display",
      fontSize: 28,
      lineHeightMultiplier: 34 / 28,
      weight: "bold",
    }),
    appearance: {
      background: "surface.default",
      border: { color: "border.default", width: 1 },
      cornerRadius: 12,
      opacity: 1,
      padding: { top: 12, start: 12, bottom: 12, end: 12 },
    },
    sizing: { width: "fill" },
    outerInsets: { top: 4, start: 0, bottom: 4, end: 0 },
    visibility: {
      mode: "switch",
      switchId: "show-offer-details",
      equals: false,
    },
    accessibility: {
      role: "text",
      label: localizedText(
        "Time remaining for this offer",
        "paywall.offer.countdown.accessibility",
      ),
    },
  };

  const staticallyHidden = stack({
    id: "future-content",
    children: [],
  });
  staticallyHidden.sizing = {
    width: "fill",
    height: { mode: "fixed", value: 48 },
  };
  staticallyHidden.visibility = { mode: "hidden" };

  const insertionIndex = root.children.findIndex((node) => node.id === "features");
  root.children.splice(
    insertionIndex,
    0,
    primarySwitch,
    secondarySwitch,
    carousel,
    countdown,
    staticallyHidden,
  );

  addLocalizedStrings(document, {
    en: {
      "paywall.offer.switch": "Show offer details",
      "paywall.offer.switch.hint": "Shows or hides optional offer content",
      "paywall.offer.technical_switch": "Show technical details",
      "paywall.offer.page_one.label": "Native renderers",
      "paywall.offer.page_one": "One paywall, three native renderers",
      "paywall.offer.page_two.label": "Remote updates",
      "paywall.offer.page_two": "Update without an app release",
      "paywall.offer.carousel": "Offer highlights",
      "paywall.offer.carousel.hint":
        "Swipe horizontally between offer highlights",
      "paywall.offer.completed": "Offer ended",
      "paywall.offer.countdown.accessibility":
        "Time remaining for this offer",
    },
    de: {
      "paywall.offer.switch": "Angebotsdetails anzeigen",
      "paywall.offer.technical_switch": "Technische Details anzeigen",
      "paywall.offer.page_one.label": "Native Renderer",
      "paywall.offer.page_one": "Eine Paywall, drei native Renderer",
      "paywall.offer.page_two.label": "Remote-Aktualisierungen",
      "paywall.offer.page_two": "Aktualisieren ohne neue App-Version",
      "paywall.offer.carousel": "Angebotshighlights",
      "paywall.offer.completed": "Angebot beendet",
    },
    ar: {
      "paywall.offer.switch": "إظهار تفاصيل العرض",
      "paywall.offer.technical_switch": "إظهار التفاصيل التقنية",
      "paywall.offer.page_one.label": "العارضات الأصلية",
      "paywall.offer.page_one": "جدار دفع واحد وثلاثة عارضات أصلية",
      "paywall.offer.page_two.label": "التحديثات عن بُعد",
      "paywall.offer.page_two": "حدّث من دون إصدار جديد للتطبيق",
      "paywall.offer.carousel": "أبرز مزايا العرض",
      "paywall.offer.completed": "انتهى العرض",
    },
  });

  document.compatibility.requiredCapabilities = orderedV02Capabilities(
    document,
    schema,
  );
  return document;
}

function buildEdgeFixture(schema) {
  const pageLabel = localizedText("Maximum carousel page", "edge.carousel.page");
  const pages = Array.from({ length: 20 }, (_, index) => ({
    id: `edge-page-${index + 1}`,
    accessibilityLabel: pageLabel,
    content: stack({
      id: `edge-page-content-${index + 1}`,
      direction: index % 2 === 0 ? "vertical" : "horizontal",
      gap: index === 19 ? 4096 : 0,
      padding: {
        top: index === 19 ? 4096 : 0,
        start: 0,
        bottom: 0,
        end: 0,
      },
      children: [
        {
          type: "text",
          id: `edge-page-text-${index + 1}`,
          value: pageLabel,
          typography: typography({
            color: index === 19 ? "#FFFFFFFF" : "text.primary",
            fontSize: index === 19 ? 96 : 8,
            lineHeightMultiplier: index === 19 ? 3 : 0.8,
          }),
          accessibility: { role: "text" },
        },
      ],
    }),
  }));

  const document = {
    schemaVersion: "0.2",
    id: "protocol-edge-cases",
    revision: 2147483647,
    compatibility: { requiredCapabilities: [] },
    localization: {
      defaultLocale: "en",
      fallbackLocale: "en",
      locales: {
        en: {
          direction: "ltr",
          strings: {
            "edge.carousel.label": "Twenty page carousel",
            "edge.carousel.page": "Maximum carousel page",
            "edge.countdown.completed": "Complete",
          },
        },
      },
    },
    assets: [],
    products: [],
    layout: {
      type: "scrollContainer",
      id: "edge-scroll",
      axis: "vertical",
      safeArea: "respect",
      showsIndicators: false,
      background: "transparent",
      content: stack({
        id: "edge-content",
        children: [
          {
            type: "carousel",
            id: "edge-carousel",
            initialPageIndex: 19,
            showsIndicators: false,
            pages,
            appearance: {
              background: "#00000000",
              border: { color: "#FFFFFFFF", width: 4096 },
              cornerRadius: 4096,
              opacity: 0,
              clipContent: false,
            },
            sizing: { width: { mode: "fixed", value: 4096 } },
            accessibility: {
              label: localizedText(
                "Twenty page carousel",
                "edge.carousel.label",
              ),
            },
          },
          {
            type: "countdown",
            id: "edge-countdown",
            endsAt: "9999-12-31T23:59:59Z",
            largestUnit: "minute",
            smallestUnit: "second",
            completedText: localizedText(
              "Complete",
              "edge.countdown.completed",
            ),
            typography: typography({
              fontSize: 8,
              lineHeightMultiplier: 0.8,
            }),
            accessibility: { role: "text" },
          },
        ],
      }),
    },
  };
  document.compatibility.requiredCapabilities = orderedV02Capabilities(
    document,
    schema,
  );
  return document;
}

function buildExpiredCountdownFixture(edge, schema) {
  const document = structuredClone(edge);
  document.id = "expired-countdown";
  document.revision = 1;
  const countdown = document.layout.content.children.find(
    (node) => node.type === "countdown",
  );
  countdown.id = "expired-offer-countdown";
  countdown.endsAt = "2000-01-01T00:00:00Z";
  document.compatibility.requiredCapabilities = orderedV02Capabilities(
    document,
    schema,
  );
  return document;
}

function buildHiddenPurchaseTargetFixture(migrated, schema) {
  const document = structuredClone(migrated);
  document.id = "hidden-purchase-target";
  document.revision = 1;
  const selector = document.layout.content.children.find(
    (node) => node.type === "productSelector",
  );
  selector.visibility = { mode: "hidden" };
  document.compatibility.requiredCapabilities = orderedV02Capabilities(
    document,
    schema,
  );
  return document;
}

export function buildV02Fixtures() {
  const source = JSON.parse(readFileSync(sourcePath, "utf8"));
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const migrated = migrateV01ToV02(source, schema);
  const complete = buildCompleteFixture(source, schema);
  const edge = buildEdgeFixture(schema);
  const expiredCountdown = buildExpiredCountdownFixture(edge, schema);
  const hiddenPurchaseTarget = buildHiddenPurchaseTargetFixture(
    migrated,
    schema,
  );
  const invalid = structuredClone(edge);
  invalid.id = "invalid-noncanonical-color";
  invalid.layout.content.children[0].appearance.background = "#abcdef12";
  return {
    complete,
    edge,
    expiredCountdown,
    hiddenPurchaseTarget,
    invalid,
    migrated,
  };
}

export function writeV02Fixtures() {
  const fixtures = buildV02Fixtures();
  mkdirSync(resolve(fixtureDirectory, "invalid"), { recursive: true });
  const targets = {
    complete: resolve(fixtureDirectory, "complete-paywall.json"),
    edge: resolve(fixtureDirectory, "edge-cases.json"),
    expiredCountdown: resolve(fixtureDirectory, "expired-countdown.json"),
    hiddenPurchaseTarget: resolve(
      fixtureDirectory,
      "hidden-purchase-target.json",
    ),
    invalid: resolve(fixtureDirectory, "invalid/noncanonical-color.json"),
    migrated: resolve(fixtureDirectory, "migrated-v0.1.json"),
  };
  for (const [name, path] of Object.entries(targets)) {
    writeFileSync(path, `${JSON.stringify(fixtures[name], null, 2)}\n`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeV02Fixtures();
}
