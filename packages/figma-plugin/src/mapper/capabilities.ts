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
  "navigation.screens",
  "component.text",
  "localization.catalogs",
  "accessibility.metadata",
  "style.colors",
  "style.box",
  "style.typography",
];

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
    } else if (record.type === "stack") {
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
    if (node.sizing || node.outerInsets || node.visibility) {
      throw new Error(
        `Capability derivation covers no sizing, outer insets, or visibility on ${String(node.id)}.`,
      );
    }
    if (node.type === "scrollContainer") capabilities.add("layout.scrollContainer");
    if (node.type === "stack") capabilities.add("layout.stack");
    if (node.type === "text") capabilities.add("component.text");
    if (node.accessibility) capabilities.add("accessibility.metadata");
    if (node.typography) capabilities.add("style.typography");
    if (
      node.appearance ||
      node.padding ||
      (node.type === "scrollContainer" && node.background)
    ) {
      capabilities.add("style.box");
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
