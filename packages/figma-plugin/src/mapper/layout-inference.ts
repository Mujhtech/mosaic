/**
 * Layout inference for frames without auto-layout.
 *
 * A Figma frame that was never given auto-layout carries its structure only in
 * pixel coordinates. Flattening it to a zero-gap, zero-padding vertical stack
 * is honest but useless: the real export that motivated this module produced
 * all-zero spacing for a three-card paywall. So instead the geometry is read
 * back out -- rows, gaps, padding, alignment -- and the result is labelled as
 * inferred rather than authored.
 *
 * Everything here is pure arithmetic over bounding boxes. It knows nothing
 * about Figma or about the protocol.
 */

import type { IntermediateBounds } from "./intermediate.js";

/** One-dimensional extent, used for whichever axis is being reasoned about. */
export type Extent = { readonly start: number; readonly end: number };

export type InferredAlignment = "start" | "center" | "end" | "stretch";

export type InferredInsets = {
  readonly top: number;
  readonly start: number;
  readonly bottom: number;
  readonly end: number;
};

/** A child spans its container when it covers at least this much of it. */
const SPAN_RATIO = 0.9;

/** How many children must span the container before the stack reads as stretched. */
const STRETCH_SHARE = 0.6;

/** Alignment tolerance floor, in logical pixels, before the proportional term. */
const MIN_ALIGNMENT_TOLERANCE = 2;

/** Alignment tolerance as a share of the content extent. */
const ALIGNMENT_TOLERANCE_RATIO = 0.02;

export function verticalExtent(bounds: IntermediateBounds): Extent {
  return { start: bounds.y, end: bounds.y + bounds.height };
}

export function horizontalExtent(bounds: IntermediateBounds): Extent {
  return { start: bounds.x, end: bounds.x + bounds.width };
}

function midpoint(extent: Extent): number {
  return (extent.start + extent.end) / 2;
}

function contains(extent: Extent, value: number): boolean {
  return value >= extent.start && value <= extent.end;
}

/**
 * Whether two extents overlap enough to read as the same row.
 *
 * The test is deliberately the midpoint one rather than any-overlap: two
 * stacked paragraphs whose descenders touch are not a row, but a tall badge
 * beside a short label is.
 */
export function overlapsSubstantially(left: Extent, right: Extent): boolean {
  return (
    contains(right, midpoint(left)) || contains(left, midpoint(right))
  );
}

/** The smallest extent containing all of `extents`. Empty input is a bug. */
export function unionExtent(extents: readonly Extent[]): Extent {
  const [first] = extents;
  if (!first) throw new Error("unionExtent needs at least one extent.");
  let start = first.start;
  let end = first.end;
  for (const extent of extents) {
    start = Math.min(start, extent.start);
    end = Math.max(end, extent.end);
  }
  return { start, end };
}

/**
 * Groups items into visual rows.
 *
 * Items are seeded top-to-bottom, and each one joins the open row when it
 * overlaps that row's *seed*. Comparing against the seed rather than against
 * the row's growing union is what stops a staircase of overlapping siblings
 * from collapsing into one row. Within a row, items are ordered by their left
 * edge; rows are ordered by their seed's top edge.
 *
 * Known limitation: a full-height element beside a column of short ones -- a
 * sidebar, a tall divider -- swallows whichever of them its midpoint reaches,
 * because rows are flat and the honest answer there is a nested column that
 * this function does not attempt to find. Adding auto-layout in Figma is the
 * fix, and the export report says so.
 */
export function clusterRows<T>(
  items: readonly T[],
  boundsOf: (item: T) => IntermediateBounds,
): T[][] {
  const sorted = [...items].sort((left, right) => {
    const a = boundsOf(left);
    const b = boundsOf(right);
    if (a.y !== b.y) return a.y - b.y;
    return a.x - b.x;
  });

  const rows: { seed: Extent; items: T[] }[] = [];
  for (const item of sorted) {
    const extent = verticalExtent(boundsOf(item));
    const open = rows.at(-1);
    if (open && overlapsSubstantially(extent, open.seed)) {
      open.items.push(item);
      continue;
    }
    rows.push({ seed: extent, items: [item] });
  }

  return rows.map((row) =>
    [...row.items].sort((left, right) => {
      const a = boundsOf(left);
      const b = boundsOf(right);
      if (a.x !== b.x) return a.x - b.x;
      return a.y - b.y;
    }),
  );
}

/** The median of a sample. Even counts average the two middle values. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] as number;
  return ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/**
 * The gap between consecutive siblings, as a single number.
 *
 * The median rather than the mean, because one outlier -- a floating badge, a
 * section break -- should not drag the whole stack's spacing with it.
 * Overlapping siblings contribute zero rather than a negative number: the
 * protocol has no negative gap, and clamping each sample before the median
 * keeps a single overlap from skewing the result downwards.
 */
export function inferGap(extents: readonly Extent[]): number {
  if (extents.length < 2) return 0;
  const spacings: number[] = [];
  for (let index = 1; index < extents.length; index += 1) {
    const previous = extents[index - 1] as Extent;
    const next = extents[index] as Extent;
    spacings.push(Math.max(0, next.start - previous.end));
  }
  return median(spacings);
}

/**
 * The container's padding, as the smallest offset any child leaves at each
 * edge. Anything larger would clip a child; anything smaller is not padding.
 */
export function inferPadding(
  container: IntermediateBounds,
  children: readonly IntermediateBounds[],
): InferredInsets {
  if (children.length === 0) {
    return { top: 0, start: 0, bottom: 0, end: 0 };
  }
  const box = {
    top: container.y,
    bottom: container.y + container.height,
    left: container.x,
    right: container.x + container.width,
  };
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.POSITIVE_INFINITY;
  let left = Number.POSITIVE_INFINITY;
  let right = Number.POSITIVE_INFINITY;
  for (const child of children) {
    top = Math.min(top, child.y - box.top);
    bottom = Math.min(bottom, box.bottom - (child.y + child.height));
    left = Math.min(left, child.x - box.left);
    right = Math.min(right, box.right - (child.x + child.width));
  }
  return {
    top: Math.max(0, top),
    start: Math.max(0, left),
    bottom: Math.max(0, bottom),
    end: Math.max(0, right),
  };
}

/**
 * The cross-axis alignment a set of siblings implies.
 *
 * `content` is the container's box already reduced by the inferred padding, so
 * the leading and trailing offsets both bottom out at zero and the three
 * candidates compete on equal terms:
 *
 *   start   the largest leading offset  (zero when every child is flush left)
 *   end     the largest trailing offset (zero when every child is flush right)
 *   center  the largest deviation of a child's centre from the content centre
 *
 * The smallest score wins, ties going to `start`. When no candidate fits
 * inside the tolerance the children simply are not aligned, and `start` --
 * which with the inferred padding reproduces at least the first child exactly
 * -- is the honest answer. `stretch` is checked first and wins outright when
 * most children span the container.
 */
export function inferAlignment(
  children: readonly Extent[],
  content: Extent,
): InferredAlignment {
  if (children.length === 0) return "start";
  const contentSize = content.end - content.start;
  if (contentSize <= 0) return "start";

  const spanning = children.filter(
    (child) => child.end - child.start >= contentSize * SPAN_RATIO,
  ).length;
  if (spanning / children.length >= STRETCH_SHARE) return "stretch";

  const contentCentre = midpoint(content);
  let startScore = 0;
  let endScore = 0;
  let centreScore = 0;
  for (const child of children) {
    startScore = Math.max(startScore, Math.abs(child.start - content.start));
    endScore = Math.max(endScore, Math.abs(content.end - child.end));
    centreScore = Math.max(centreScore, Math.abs(midpoint(child) - contentCentre));
  }

  const tolerance = Math.max(
    MIN_ALIGNMENT_TOLERANCE,
    contentSize * ALIGNMENT_TOLERANCE_RATIO,
  );
  const best = Math.min(startScore, centreScore, endScore);
  if (best > tolerance) return "start";
  if (startScore === best) return "start";
  if (centreScore === best) return "center";
  return "end";
}
