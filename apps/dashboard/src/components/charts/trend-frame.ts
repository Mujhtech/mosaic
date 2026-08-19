/**
 * The frame geometry every trend plot is drawn inside.
 *
 * It lives beside the chart rather than in it so a caller can reserve exactly
 * the height the plot will occupy — a skeleton, an empty message, or a failure
 * notice that changes the card's height reads as the chart moving rather than
 * as the data arriving.
 */

export const PAD_TOP = 12;
export const PAD_LEFT = 44;
export const PAD_RIGHT = 12;
export const DEFAULT_TREND_PLOT_HEIGHT = 200;
/** A trend read beside a table rather than as the page's subject. */
export const COMPACT_TREND_PLOT_HEIGHT = 108;
const X_AXIS_BAND = 26;

/** The drawn height of the frame, so a message or skeleton can match it. */
export function trendFrameHeight(plotHeight = DEFAULT_TREND_PLOT_HEIGHT) {
  return PAD_TOP + plotHeight + X_AXIS_BAND;
}
