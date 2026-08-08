import type {
  LocalizedText,
  MosaicDocument,
} from "@/features/paywall-editor/types/editor";
import { cloneValue } from "@/features/paywall-editor/utils/clone";
import { flattenDocument } from "@/features/paywall-editor/utils/document-tree-traversal";
import { reconcileReservedAccessibilityStrings } from "@/features/paywall-editor/utils/protocol-component-rules";
import { requiredCapabilitiesFor } from "@/lib/mosaic-protocol";

function collectLocalizedText(value: unknown, entries: LocalizedText[]) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectLocalizedText(entry, entries);
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.default === "string" &&
    typeof record.localizationKey === "string"
  ) {
    entries.push({
      default: record.default,
      localizationKey: record.localizationKey,
    });
    return;
  }
  for (const entry of Object.values(record)) {
    collectLocalizedText(entry, entries);
  }
}

export function synchronizeProtocolMetadata(
  document: MosaicDocument
): MosaicDocument {
  const next = cloneValue(reconcileReservedAccessibilityStrings(document));
  const entries = flattenDocument(next);

  const referencedProducts = new Set(
    entries.flatMap((entry) =>
      entry.node.type === "productCard" ? [entry.node.productReferenceId] : []
    )
  );
  next.products = next.products.filter((product) =>
    referencedProducts.has(product.id)
  );

  const localized: LocalizedText[] = [];
  collectLocalizedText(next.assets, localized);
  collectLocalizedText(next.products, localized);
  collectLocalizedText(next.screens, localized);
  const defaultValues = new Map(
    localized.map((entry) => [entry.localizationKey, entry.default])
  );
  next.localization.locales = Object.fromEntries(
    Object.entries(next.localization.locales).map(([locale, catalog]) => [
      locale,
      {
        ...catalog,
        strings: Object.fromEntries(
          [...defaultValues].map(([key, defaultValue]) => [
            key,
            locale === next.localization.defaultLocale
              ? defaultValue
              : (catalog.strings[key] ?? defaultValue),
          ])
        ),
      },
    ])
  );
  // Reserved keys are consumed by the protocol rather than referenced by a
  // component, so the rebuild above cannot see them and would drop every one.
  const reconciled = reconcileReservedAccessibilityStrings(next);
  next.localization = reconciled.localization;

  // Derivation and serialisation both come from the protocol reference, so a
  // document's declared capabilities cannot drift from the ones its content
  // actually requires.
  next.compatibility.requiredCapabilities = [...requiredCapabilitiesFor(next)];
  return next;
}
