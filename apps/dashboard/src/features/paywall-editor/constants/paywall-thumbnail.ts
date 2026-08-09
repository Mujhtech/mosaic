import { resolveCanvasDeviceGeometry } from "@/features/paywall-editor/components/canvas-preview-geometry";
import type { StudioCanvasDevice } from "@/features/paywall-editor/types/studio-workspace";

/** The Studio canvas default, so a thumbnail matches what authoring shows. */
export const PAYWALL_THUMBNAIL_DEVICE: StudioCanvasDevice = "iphone-17-pro";

/** Phone-shaped, and small enough to sit beside a card's metadata. */
export const PAYWALL_THUMBNAIL_WIDTH = 116;

/**
 * The logical screen a thumbnail is drawn at before scaling.
 *
 * Shared so the frame that reserves space and the content scaled into it read
 * the same numbers: a frame with one aspect and content with another would
 * either crop the design or leave a stripe of empty card.
 *
 * This module holds no React, so a route may reserve thumbnail space without
 * pulling in the canvas renderer.
 */
export function paywallThumbnailGeometry() {
  return resolveCanvasDeviceGeometry(PAYWALL_THUMBNAIL_DEVICE, "portrait");
}
