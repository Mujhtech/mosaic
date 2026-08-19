import type { TimelineComponent } from "@/features/paywall-editor/types/editor";
import { typography } from "@/features/paywall-editor/utils/document-tree-creation";

const SEEDED_MARKER_COLOR = "action.primary";
const SEEDED_MARKER_SIZE = 20;

/**
 * `markerColor`, `markerSize`, and `descriptionTypography` are required when an
 * entry consumes them and forbidden when none does. Every edit that can change
 * whether an entry carries a marker or a description runs through here, so the
 * inspector cannot leave the document in a state the protocol rejects — in
 * either direction.
 */
export function withTimelineStyleCoPresence(
  timeline: TimelineComponent
): TimelineComponent {
  const usesMarker = timeline.entries.some(
    (entry) => entry.marker !== undefined
  );
  const usesDescription = timeline.entries.some(
    (entry) => entry.description !== undefined
  );
  const next: TimelineComponent = { ...timeline };
  if (usesMarker) {
    // Adding the first marker makes these required, so the editor authors a
    // starting value the author can then change. It never substitutes one for
    // a field that is already authored.
    next.markerColor = timeline.markerColor ?? SEEDED_MARKER_COLOR;
    next.markerSize = timeline.markerSize ?? SEEDED_MARKER_SIZE;
  } else {
    delete next.markerColor;
    delete next.markerSize;
  }
  if (usesDescription) {
    next.descriptionTypography =
      timeline.descriptionTypography ?? typography("caption", "start");
  } else {
    delete next.descriptionTypography;
  }
  return next;
}
