import type {
  MosaicPaywallV03CapabilityName,
  MosaicPaywallV03Document,
  MosaicPaywallV03RequiredCapability,
} from "../../../../protocol/browser/index.js";

/**
 * Capability derivation for the subset this plugin emits.
 *
 * The reference implementation is `requiredCapabilitiesFor` in
 * `protocol/browser/index.js`, but that module pulls in Ajv, which compiles
 * schemas with `new Function` -- unavailable in the Figma plugin sandbox. So
 * the plugin re-derives, and `capabilities.test.ts` asserts the two agree
 * exactly on every document the mapper can produce. An over-declared or
 * under-declared capability is rejected at import, so "close enough" is not a
 * thing here.
 *
 * The emitted vocabulary is deliberately tiny: scroll container, stacks, text.
 * Anything richer is added in Studio, and would need this table extended.
 */

/**
 * Canonical order, copied from `#/$defs/capabilityName.enum`, restricted to the
 * names this mapper can emit. `requiredCapabilitiesFor` sorts by the full enum
 * order; keeping the same relative order makes the two arrays comparable
 * element-for-element.
 */
const CAPABILITY_ORDER: readonly MosaicPaywallV03CapabilityName[] = [
  "layout.scrollContainer",
  "layout.stack",
  "layout.sizing",
  "layout.heightSizing",
  "navigation.screens",
  "component.text",
  "component.button",
  "localization.catalogs",
  "action.close",
  "action.navigateTo",
  "accessibility.metadata",
  "outcome.normalized",
  "style.colors",
  "style.box",
  "style.typography",
];

/**
 * The two actions the plugin emits, both placeholders.
 *
 * `close` needs no field the plugin would have to invent -- no product selector
 * to bind, no URL -- so it is what a detected button gets. `navigateTo` is the
 * one exception: a multi-frame export has to thread its screens together,
 * because the protocol rejects a screen the first one cannot reach.
 *
 * Only `purchase`, `restore`, and `close` pull in `outcome.normalized`;
 * `navigateTo` does not, and `capabilities.test.ts` holds this to the
 * protocol's own derivation.
 */
const OUTCOME_ACTION_TYPES = new Set(["purchase", "restore", "close"]);
const SUPPORTED_ACTION_TYPES = new Set(["close", "navigateTo"]);

/** `colorFieldNames` from the protocol browser module, inlined. */
const COLOR_FIELD_NAMES: readonly string[] = [
  "background",
  "color",
  "emptyColor",
  "filledColor",
  "markerColor",
  "offTrackColor",
  "onTrackColor",
  "productLabelColor",
  "runtimePriceColor",
  "selectedLabelColor",
  "textColor",
  "thumbColor",
];

type UnknownRecord = Record<string, unknown>;

function walkObjectValues(
  value: unknown,
  visit: (entry: UnknownRecord) => void,
): void {
  if (Array.isArray(value)) {
    for (const entry of value) walkObjectValues(entry, visit);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as UnknownRecord;
  visit(record);
  for (const entry of Object.values(record)) walkObjectValues(entry, visit);
}

/** Mirrors `usesColor`: a colour-named field anywhere inside, or a colour token. */
function usesColor(value: unknown): boolean {
  let found = false;
  walkObjectValues(value, (entry) => {
    if (entry.type === "colorToken") found = true;
    for (const field of COLOR_FIELD_NAMES) {
      if (entry[field] !== undefined) found = true;
    }
  });
  return found;
}

function walkNodes(document: MosaicPaywallV03Document): UnknownRecord[] {
  const entries: UnknownRecord[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const record = node as UnknownRecord;
    entries.push(record);
    if (record.type === "scrollContainer") {
      visit(record.content);
    } else if (record.type === "stack" || record.type === "button") {
      for (const child of (record.children as unknown[]) ?? []) visit(child);
    }
  };
  for (const screen of document.screens) visit(screen.layout);
  return entries;
}

/**
 * The capability names the document requires, in canonical order.
 *
 * Only the derivations that can fire for the emitted subset are implemented;
 * a node type outside that subset would need a rule added here.
 */
export function deriveCapabilityNames(
  document: MosaicPaywallV03Document,
): readonly MosaicPaywallV03CapabilityName[] {
  const capabilities = new Set<MosaicPaywallV03CapabilityName>([
    "localization.catalogs",
    "navigation.screens",
  ]);

  if (document.products.length > 0) {
    throw new Error(
      "Capability derivation covers no product references; the mapper emits none.",
    );
  }
  const designSystem = document.designSystem;
  if (
    designSystem.colors.length > 0 ||
    designSystem.backgrounds.length > 0 ||
    designSystem.shadows.length > 0
  ) {
    throw new Error(
      "Capability derivation covers no design tokens; the mapper emits none.",
    );
  }
  if (document.assets.length > 0) {
    throw new Error(
      "Capability derivation covers no assets; the mapper emits none.",
    );
  }
  if (
    Object.values(document.localization.locales).some(
      (locale) => locale.direction === "rtl",
    )
  ) {
    throw new Error(
      "Capability derivation covers no RTL catalog; the mapper emits ltr only.",
    );
  }

  for (const node of walkNodes(document)) {
    if (node.outerInsets || node.visibility) {
      throw new Error(
        `Capability derivation covers no outer insets or visibility on ${String(node.id)}.`,
      );
    }
    if (node.type === "scrollContainer") capabilities.add("layout.scrollContainer");
    if (node.type === "stack") capabilities.add("layout.stack");
    if (node.type === "text") capabilities.add("component.text");
    if (node.type === "button") capabilities.add("component.button");
    if (node.accessibility) capabilities.add("accessibility.metadata");
    if (node.typography) capabilities.add("style.typography");
    if (
      node.appearance ||
      node.padding ||
      (node.type === "scrollContainer" && node.background)
    ) {
      capabilities.add("style.box");
    }
    if (node.sizing) {
      capabilities.add("layout.sizing");
      // `boxSizing` requires both axes, so the height capability always comes
      // along; the check is kept explicit so it stays right if that changes.
      if (Object.hasOwn(node.sizing, "height")) {
        capabilities.add("layout.heightSizing");
      }
    }
    const action = node.action as { type?: string } | undefined;
    if (action?.type) {
      if (!SUPPORTED_ACTION_TYPES.has(action.type)) {
        throw new Error(
          `Capability derivation covers no ${action.type} action on ${String(node.id)}.`,
        );
      }
      capabilities.add(`action.${action.type}` as MosaicPaywallV03CapabilityName);
      if (OUTCOME_ACTION_TYPES.has(action.type)) {
        capabilities.add("outcome.normalized");
      }
    }
    if (usesColor(node)) capabilities.add("style.colors");
  }

  return CAPABILITY_ORDER.filter((name) => capabilities.has(name));
}

/** The same set, shaped for `compatibility.requiredCapabilities`. */
export function deriveRequiredCapabilities(
  document: MosaicPaywallV03Document,
): MosaicPaywallV03RequiredCapability[] {
  return deriveCapabilityNames(document).map((name) => ({
    name,
    version: "0.3",
  }));
}
