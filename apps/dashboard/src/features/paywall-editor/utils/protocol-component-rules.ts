import type {
  MosaicDocument,
  ProtocolNode,
  SelectionStateStyle,
  SelectionStyles,
  SocialProofRating,
  TimelineComponent,
  Visibility,
} from "@/features/paywall-editor/types/editor";
import {
  findAncestorNodeIds,
  flattenDocument,
  screenContainingNode,
} from "@/features/paywall-editor/utils/document-tree-traversal";
import type { MosaicPaywallAnnouncement } from "@/lib/mosaic-protocol";
import {
  accessibilityAnnouncement,
  evaluateVisibility,
  reservedAccessibilityKeys,
  resolvedCatalogStrings,
  resolveProductCardStyle,
} from "@/lib/mosaic-protocol";

/**
 * Authored translations for the protocol's reserved accessibility keys. The
 * key set, the placeholders, and when each key is consumed all come from the
 * protocol reference; only the copy is Studio's, because a paywall ships with
 * translations rather than a machine-generated string.
 */
const RESERVED_KEY_TRANSLATIONS: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  "mosaic.a11y.rating": {
    en: "{{ rating.value }} out of {{ rating.maximum }} stars",
    de: "{{ rating.value }} von {{ rating.maximum }} Sternen",
    ar: "{{ rating.value }} من {{ rating.maximum }} نجوم",
  },
  "mosaic.a11y.in_progress": {
    en: "In progress",
    de: "Wird ausgeführt",
    ar: "قيد التنفيذ",
  },
};

/** The reference's `consumedBy` reads `{ node }` entries, as its walker emits. */
function reservedKeyEntries(document: MosaicDocument) {
  return [
    ...document.screens.map((screen) => ({ node: screen.layout.content })),
    ...flattenDocument(document).map((entry) => ({ node: entry.node })),
  ] as readonly { readonly node: Record<string, unknown> }[];
}

/**
 * Declares each reserved key exactly where the document announces it and drops
 * it everywhere else — the same co-presence discipline the Timeline style
 * fields follow. A locale with no authored translation falls back to the
 * default catalog's string, which is what the resolver would reach anyway.
 */
export function reconcileReservedAccessibilityStrings(
  document: MosaicDocument
): MosaicDocument {
  const entries = reservedKeyEntries(document);
  const { defaultLocale, locales } = document.localization;
  return {
    ...document,
    localization: {
      ...document.localization,
      locales: Object.fromEntries(
        Object.entries(locales).map(([locale, catalog]) => {
          const strings: Record<string, string> = { ...catalog.strings };
          for (const [key, reserved] of Object.entries(
            reservedAccessibilityKeys
          )) {
            if (reserved.consumedBy(entries)) {
              const translations = RESERVED_KEY_TRANSLATIONS[key];
              strings[key] ??=
                translations?.[locale] ??
                locales[defaultLocale]?.strings[key] ??
                translations?.en ??
                key;
            } else {
              delete strings[key];
            }
          }
          return [locale, { ...catalog, strings }];
        })
      ),
    },
  };
}

export type NodeAnnouncement =
  | {
      readonly status: "announced";
      readonly announcement: MosaicPaywallAnnouncement;
    }
  | { readonly status: "unavailable"; readonly message: string };

/**
 * The announcement a native renderer composes for this node.
 *
 * Studio never assembles one itself. Segments are separate accessibility
 * elements with no separator, and the connective inside a rating belongs to
 * the authored `mosaic.a11y.rating` template — composing either here would
 * emit English word order in every locale and a different string from the one
 * the three SDKs announce.
 */
export function announcementFor(
  document: MosaicDocument,
  node: ProtocolNode,
  locale: string,
  state: "idle" | "inProgress" | null = null
): NodeAnnouncement {
  try {
    return {
      status: "announced",
      announcement: accessibilityAnnouncement(
        node as Parameters<typeof accessibilityAnnouncement>[0],
        {
          strings: resolvedCatalogStrings(document.localization, locale),
          state,
        }
      ),
    };
  } catch (error) {
    // A reserved key is missing or malformed. Announcing a composed substitute
    // would hide that behind copy this document never authored.
    return {
      status: "unavailable",
      message: `${error instanceof Error ? error.message : "This component cannot be announced."} Restore the reserved string in Localization controls.`,
    };
  }
}

export type TimelineStyleField =
  | "markerColor"
  | "markerSize"
  | "descriptionTypography";

export const TIMELINE_STYLE_FIELDS: readonly TimelineStyleField[] = [
  "markerColor",
  "markerSize",
  "descriptionTypography",
];

/**
 * Which co-present style fields the timeline's entries actually consume.
 * `markerColor` and `markerSize` are consumed by any entry carrying a marker;
 * `descriptionTypography` by any entry carrying a description. The protocol
 * requires each field exactly when it is consumed and forbids it otherwise,
 * so the inspector and the validator read this one answer.
 */
export function timelineStyleFieldIsConsumed(
  timeline: TimelineComponent,
  field: TimelineStyleField
): boolean {
  if (field === "descriptionTypography") {
    return timeline.entries.some((entry) => entry.description !== undefined);
  }
  return timeline.entries.some((entry) => entry.marker !== undefined);
}

export function timelineStyleFieldIsDeclared(
  timeline: TimelineComponent,
  field: TimelineStyleField
): boolean {
  return timeline[field] !== undefined;
}

export function timelineStyleCoPresenceHolds(
  timeline: TimelineComponent
): boolean {
  return TIMELINE_STYLE_FIELDS.every(
    (field) =>
      timelineStyleFieldIsConsumed(timeline, field) ===
      timelineStyleFieldIsDeclared(timeline, field)
  );
}

export function ratingStepsPerPoint(step: SocialProofRating["step"]): number {
  return step === "half" ? 2 : 1;
}

export function ratingMaximumSteps(
  rating: Pick<SocialProofRating, "maximum" | "step">
): number {
  return rating.maximum * ratingStepsPerPoint(rating.step);
}

/** The 0-based symbol positions a rating draws, in order. */
export function ratingPointOffsets(
  rating: Pick<SocialProofRating, "maximum">
): readonly number[] {
  return Array.from({ length: rating.maximum }, (_, point) => point);
}

export function socialProofRatingIsInBounds(
  rating: SocialProofRating
): boolean {
  return rating.value <= ratingMaximumSteps(rating);
}

/**
 * Tabs and Product Card share the neutral Default-plus-partial-Selected
 * overlay; the protocol reference resolves it structurally, so one helper
 * serves every node carrying `styles`.
 */
export function resolveSelectionStyle(
  node: { readonly styles: SelectionStyles },
  selected: boolean
): SelectionStateStyle {
  return resolveProductCardStyle(
    node as Parameters<typeof resolveProductCardStyle>[0],
    selected
  );
}

export type TabsComponentNode = Extract<ProtocolNode, { type: "tabs" }>;

/**
 * The Tabs components a node may legally name in a `{ mode: "tab" }`
 * visibility condition. All four protocol rules are applied here so Studio
 * cannot offer a target that the protocol would reject: same screen, not the
 * Tabs component itself, and not one of its descendants. The fourth rule —
 * `equals` must name a declared tab — is satisfied by only offering the tab
 * ids each returned component declares.
 */
export function eligibleTabControllers(
  document: MosaicDocument,
  nodeId: string
): TabsComponentNode[] {
  const screen = screenContainingNode(document, nodeId);
  if (!screen) {
    return [];
  }
  const ancestorIds = new Set(findAncestorNodeIds(document, nodeId));
  return flattenDocument(document).flatMap((entry) => {
    if (entry.node.type !== "tabs" || entry.node.id === nodeId) {
      return [];
    }
    if (ancestorIds.has(entry.node.id)) {
      return [];
    }
    return screenContainingNode(document, entry.node.id)?.id === screen.id
      ? [entry.node]
      : [];
  });
}

export interface PaywallSelectionState {
  readonly switches: Readonly<Record<string, boolean>>;
  readonly tabs: Readonly<Record<string, string>>;
}

export type ResolvedVisibility =
  | { readonly status: "resolved"; readonly visible: boolean }
  | { readonly status: "unresolved"; readonly message: string };

/**
 * `evaluateVisibility` throws when a condition names a controller the supplied
 * runtime state does not carry, because answering "not visible" would turn a
 * broken reference into a component that silently disappears. Studio derives
 * its runtime state from the open document, so a throw here means the document
 * references a Switch or Tabs it does not declare. That is reported to the
 * author as a failure, never resolved to a visibility answer nobody wrote.
 */
export function resolveNodeVisibility(
  visibility: Visibility | undefined,
  selectionState: PaywallSelectionState
): ResolvedVisibility {
  try {
    return {
      status: "resolved",
      visible: evaluateVisibility(visibility, selectionState),
    };
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : "This layer's visibility condition cannot be evaluated.";
    return {
      status: "unresolved",
      message: `${detail} Point the condition at a control this screen declares, or set Visibility back to Always visible.`,
    };
  }
}
