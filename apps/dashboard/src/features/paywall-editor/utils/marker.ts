import type {
  FeatureListComponent,
  FeatureListItem,
  IconName,
  Marker,
} from "@/features/paywall-editor/types/editor";

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
  return item.marker ?? list.marker;
}

/**
 * The size a Feature List marker draws at.
 *
 * When `markerSize` is unauthored the size is the list's own
 * `typography.fontSize`. The contract forbids a renderer substituting a value
 * of its own, and the canvas is a renderer for this purpose.
 */
export function resolvedFeatureListMarkerSize(
  list: FeatureListComponent
): number {
  return list.markerSize ?? list.typography.fontSize;
}

/** The icon a marker draws, or null when the marker is not an icon. */
export function markerIconName(marker: Marker): IconName | null {
  return marker.kind === "icon" ? marker.name : null;
}

/** A human-readable description of a marker, for inspector summaries. */
export function markerLabel(marker: Marker): string {
  if (marker.kind === "icon") {
    return `Icon: ${marker.name}`;
  }
  return marker.kind === "dot" ? "Dot" : "Ordinal";
}
