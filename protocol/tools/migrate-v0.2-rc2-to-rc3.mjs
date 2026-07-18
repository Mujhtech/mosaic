import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { orderedV02Capabilities } from "./validation-v0.2.mjs";
import { migrateV02RC3CandidateToRC4 } from "./migrate-v0.2-rc3-to-rc4.mjs";

const toolsDirectory = dirname(fileURLToPath(import.meta.url));
const protocolRoot = resolve(toolsDirectory, "..");
const schemaPath = resolve(protocolRoot, "schema/v0.2/paywall.schema.json");
const zeroInsets = Object.freeze({ top: 0, start: 0, bottom: 0, end: 0 });

function allocateIdentifier(usedIds, preferred) {
  let sequence = 1;
  while (true) {
    const suffix = sequence === 1 ? "" : `-${sequence}`;
    const base = preferred
      .slice(0, 128 - suffix.length)
      .replace(/[-_]+$/u, "");
    const candidate = `${base}${suffix}`;
    if (!usedIds.has(candidate)) {
      usedIds.add(candidate);
      return candidate;
    }
    sequence += 1;
  }
}

function collectIdentifiers(value, identifiers = new Set()) {
  if (Array.isArray(value)) {
    for (const entry of value) collectIdentifiers(entry, identifiers);
    return identifiers;
  }
  if (!value || typeof value !== "object") return identifiers;
  if (typeof value.id === "string") identifiers.add(value.id);
  for (const entry of Object.values(value)) collectIdentifiers(entry, identifiers);
  return identifiers;
}

function addTemplateLocalization(state, variable) {
  let key;
  do {
    state.templateKeySequence += 1;
    key = `mosaic.migration.rc2_product_card_${state.templateKeySequence}.${variable}`;
  } while (
    Object.values(state.document.localization.locales).some((locale) =>
      Object.hasOwn(locale.strings, key),
    )
  );
  const value = `{{ product.${variable} }}`;
  for (const locale of Object.values(state.document.localization.locales)) {
    locale.strings[key] = value;
  }
  return { default: value, localizationKey: key };
}

function textChild(state, cardId, variable, color) {
  return {
    type: "text",
    id: allocateIdentifier(state.usedIds, `${cardId}-${variable}`),
    value: addTemplateLocalization(state, variable),
    typography: {
      style: "body",
      fontSize: 16,
      lineHeightMultiplier: 1.5,
      weight: "regular",
      color,
      alignment: "start",
    },
    accessibility: { role: "text" },
  };
}

function stateStyles(defaultStyle, selectedStyle = {}) {
  return {
    default: {
      background: defaultStyle.background,
      border: structuredClone(defaultStyle.border),
      cornerRadius: defaultStyle.cornerRadius,
      padding: structuredClone(defaultStyle.padding),
      opacity: 1,
    },
    selected: Object.fromEntries(
      ["background", "border", "cornerRadius", "padding"]
        .filter((field) => Object.hasOwn(selectedStyle, field))
        .map((field) => [field, structuredClone(selectedStyle[field])]),
    ),
  };
}

function diagnostic(state, selector, field, message) {
  if (state.diagnosticFields.has(`${selector.id}:${field}`)) return;
  state.diagnosticFields.add(`${selector.id}:${field}`);
  state.diagnostics.push({
    code: "migration.reviewRequired",
    severity: "reviewRequired",
    selectorId: selector.id,
    field,
    message,
  });
}

function reportUnrepresentableOverrides(state, selector) {
  const { default: base, selected } = selector.cardStyles;
  for (const field of ["contentGap", "contentAlignment"]) {
    if (Object.hasOwn(selected, field) && selected[field] !== base[field]) {
      diagnostic(
        state,
        selector,
        `cardStyles.selected.${field}`,
        `Selected-only ${field} is layout in RC3 and requires author review.`,
      );
    }
  }
  for (const field of ["productLabelColor", "runtimePriceColor"]) {
    if (Object.hasOwn(selected, field) && selected[field] !== base[field]) {
      diagnostic(
        state,
        selector,
        `cardStyles.selected.${field}`,
        `Selected-only ${field} cannot be represented by state-independent Text styling.`,
      );
    }
  }
  if (
    selected.badge?.textColor !== undefined &&
    selected.badge.textColor !== base.badge.textColor
  ) {
    diagnostic(
      state,
      selector,
      "cardStyles.selected.badge.textColor",
      "Selected-only badge textColor cannot be represented by state-independent Text styling.",
    );
  }
}

function badgeForProduct(state, selector, cardId, product) {
  if (!product?.badge) return null;
  const badgeId = allocateIdentifier(state.usedIds, `${cardId}-badge`);
  return {
    type: "productBadge",
    id: badgeId,
    placement: { mode: "nested" },
    direction: "horizontal",
    gap: 0,
    mainAxisDistribution: "center",
    crossAxisAlignment: "center",
    children: [
      {
        type: "text",
        id: allocateIdentifier(state.usedIds, `${badgeId}-label`),
        value: structuredClone(product.badge),
        typography: {
          style: "label",
          fontSize: 16,
          lineHeightMultiplier: 1.25,
          weight: "semibold",
          color: selector.cardStyles.default.badge.textColor,
          alignment: "center",
        },
        accessibility: { role: "text" },
      },
    ],
    styles: stateStyles(
      selector.cardStyles.default.badge,
      selector.cardStyles.selected.badge,
    ),
  };
}

function migrateSelector(selector, state) {
  reportUnrepresentableOverrides(state, selector);
  const cards = selector.productReferenceIds.map((productReferenceId) => {
    const product = state.products.get(productReferenceId);
    const cardId = allocateIdentifier(
      state.usedIds,
      `${selector.id}-${productReferenceId}-card`,
    );
    const children = [
      textChild(
        state,
        cardId,
        "name",
        selector.cardStyles.default.productLabelColor,
      ),
      textChild(
        state,
        cardId,
        "price",
        selector.cardStyles.default.runtimePriceColor,
      ),
    ];
    const badge = badgeForProduct(state, selector, cardId, product);
    if (badge) children.push(badge);
    return {
      type: "productCard",
      id: cardId,
      productReferenceId,
      direction: "vertical",
      gap: selector.cardStyles.default.contentGap,
      mainAxisDistribution: selector.cardStyles.default.contentAlignment,
      crossAxisAlignment: "stretch",
      children,
      styles: stateStyles(
        selector.cardStyles.default,
        selector.cardStyles.selected,
      ),
    };
  });
  const initialProductCardId = cards.find(
    (card) =>
      card.productReferenceId === selector.initiallySelectedProductReferenceId,
  )?.id;
  const migrated = {
    type: "productSelector",
    id: selector.id,
    direction: selector.direction,
    gap: selector.gap,
    crossAxisAlignment: "stretch",
    initialProductCardId,
    cards,
    ...(selector.appearance ? { appearance: structuredClone(selector.appearance) } : {}),
    ...(selector.sizing ? { sizing: structuredClone(selector.sizing) } : {}),
    ...(selector.outerInsets ? { outerInsets: structuredClone(selector.outerInsets) } : {}),
    ...(selector.visibility ? { visibility: structuredClone(selector.visibility) } : {}),
    unavailableFallback: structuredClone(selector.unavailableFallback),
    accessibility: structuredClone(selector.accessibility),
  };
  return migrated;
}

function migrateNode(node, state) {
  if (!node || typeof node !== "object") return node;
  if (
    node.type === "productSelector" &&
    Array.isArray(node.productReferenceIds) &&
    node.cardStyles
  ) {
    return migrateSelector(node, state);
  }
  const migrated = structuredClone(node);
  if (migrated.type === "scrollContainer") {
    migrated.content = migrateNode(migrated.content, state);
  } else if (migrated.type === "stack") {
    migrated.children = migrated.children.map((child) => migrateNode(child, state));
  } else if (migrated.type === "carousel") {
    migrated.pages = migrated.pages.map((page) => ({
      ...page,
      content: migrateNode(page.content, state),
    }));
  } else if (migrated.type === "button") {
    migrated.children = migrated.children.map((child) => migrateNode(child, state));
    if (migrated.inProgressChildren) {
      migrated.inProgressChildren = migrated.inProgressChildren.map((child) =>
        migrateNode(child, state),
      );
    }
  }
  return migrated;
}

export function migrateV02RC2CandidateToRC3(document, paywallSchema) {
  if (!document || document.schemaVersion !== "0.2") {
    throw new Error("RC2 candidate recovery requires a Protocol 0.2 document.");
  }
  const migrated = structuredClone(document);
  const state = {
    diagnosticFields: new Set(),
    diagnostics: [],
    document: migrated,
    products: new Map(migrated.products.map((product) => [product.id, product])),
    templateKeySequence: 0,
    usedIds: collectIdentifiers(migrated),
  };
  migrated.screens = migrated.screens.map((screen) => ({
    ...screen,
    layout: migrateNode(screen.layout, state),
  }));
  for (const product of migrated.products) delete product.badge;
  migrated.compatibility.requiredCapabilities = orderedV02Capabilities(
    migrated,
    paywallSchema,
  );
  const rc4 = migrateV02RC3CandidateToRC4(migrated, paywallSchema);
  return {
    document: rc4.document,
    diagnostics: [...state.diagnostics, ...rc4.diagnostics],
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) {
    throw new Error("Usage: node tools/migrate-v0.2-rc2-to-rc3.mjs input.json");
  }
  const document = JSON.parse(readFileSync(resolve(process.cwd(), process.argv[2]), "utf8"));
  const paywallSchema = JSON.parse(readFileSync(schemaPath, "utf8"));
  process.stdout.write(
    `${JSON.stringify(migrateV02RC2CandidateToRC3(document, paywallSchema), null, 2)}\n`,
  );
}
