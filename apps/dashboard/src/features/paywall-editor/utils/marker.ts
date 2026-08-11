import type {
  FeatureListComponent,
  FeatureListItem,
  IconName,
  Marker,
  TimelineMarker,
} from "@/features/paywall-editor/types/editor";

/**
 * A marker as it appears in either contract version.
 *
 * 0.3 gives Feature List the single constant `"checkmark"` and Timeline a
 * three-arm union; 0.4 consolidates both onto the union. Editor code that draws
 * or describes a marker sees this type and resolves it through
 * `resolvedMarker`, so neither the canvas nor the inspector has to know which
 * version it is looking at.
 */
export type AuthoredMarker = "checkmark" | Marker | TimelineMarker;

/**
 * The marker union, with 0.3's Feature List constant folded into it.
 *
 * The migration writes `"checkmark"` as `{kind:"icon",name:"checkmark"}`, so
 * this is the same mapping applied at read time rather than at rewrite time --
 * which is what lets the canvas render a 0.3 and a 0.4 list through one path
 * without mutating the 0.3 document.
 */
export function resolvedMarker(marker: AuthoredMarker): Marker {
  return marker === "checkmark" ? { kind: "icon", name: "checkmark" } : marker;
}

/**
 * The marker a Feature List item draws.
 *
 * An absent item marker means the item carries the list's marker. It is never a
 * request for no glyph.
 */
export function resolvedItemMarker(
  list: FeatureListComponent,
  item: FeatureListItem
): Marker {
  const itemMarker = "marker" in item ? item.marker : undefined;
  return resolvedMarker(itemMarker ?? list.marker);
}

/** The icon a marker draws, or null when the marker is not an icon. */
export function markerIconName(marker: AuthoredMarker): IconName | null {
  const resolved = resolvedMarker(marker);
  return resolved.kind === "icon" ? resolved.name : null;
}

/**
 * A human-readable description of a marker, for inspector summaries.
 *
 * A 0.3 Feature List reads back as the bare constant it authored. Only 0.4 has
 * a marker worth describing, and only 0.4 documents get the described form --
 * a 0.3 document shows exactly what it showed before 0.4 existed.
 */
export function markerLabel(marker: AuthoredMarker): string {
  if (marker === "checkmark") {
    return "checkmark";
  }
  if (marker.kind === "icon") {
    return `Icon: ${marker.name}`;
  }
  return marker.kind === "dot" ? "Dot" : "Ordinal";
}
