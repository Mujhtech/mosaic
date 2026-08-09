import { describe, expect, it } from "vitest";
import type { IntermediateBounds } from "./intermediate.js";
import {
  clusterRows,
  horizontalExtent,
  inferAlignment,
  inferGap,
  inferPadding,
  median,
  overlapsSubstantially,
  unionExtent,
  verticalExtent,
} from "./layout-inference.js";

function box(
  x: number,
  y: number,
  width: number,
  height: number,
): IntermediateBounds {
  return { x, y, width, height };
}

const identity = (bounds: IntermediateBounds): IntermediateBounds => bounds;

describe("row clustering", () => {
  it("keeps stacked siblings in separate rows", () => {
    const rows = clusterRows(
      [box(0, 0, 100, 20), box(0, 40, 100, 20), box(0, 80, 100, 20)],
      identity,
    );
    expect(rows.map((row) => row.length)).toEqual([1, 1, 1]);
    expect(rows.map((row) => (row[0] as IntermediateBounds).y)).toEqual([0, 40, 80]);
  });

  it("groups siblings whose vertical ranges overlap into one row, left to right", () => {
    const rows = clusterRows(
      [box(240, 100, 100, 120), box(0, 100, 100, 120), box(120, 104, 100, 112)],
      identity,
    );
    expect(rows).toHaveLength(1);
    expect((rows[0] as IntermediateBounds[]).map((bounds) => bounds.x)).toEqual([
      0, 120, 240,
    ]);
  });

  it("pairs a tall badge with the short label beside it", () => {
    const rows = clusterRows([box(0, 0, 60, 80), box(80, 30, 200, 20)], identity);
    expect(rows).toHaveLength(1);
  });

  it("does not chain a staircase of siblings into one row", () => {
    // Each item overlaps the one before it but not the one two back. Comparing
    // against the row's seed rather than its growing union is what stops the
    // whole staircase from collapsing into a single row.
    const rows = clusterRows(
      [box(0, 0, 50, 100), box(60, 40, 50, 100), box(120, 80, 50, 100)],
      identity,
    );
    expect(rows.map((row) => row.length)).toEqual([2, 1]);
  });

  it("treats touching but non-overlapping paragraphs as separate rows", () => {
    const rows = clusterRows([box(0, 0, 100, 20), box(0, 19, 100, 20)], identity);
    expect(rows).toHaveLength(2);
  });

  it("reads overlap from the midpoint, in either direction", () => {
    expect(
      overlapsSubstantially({ start: 0, end: 100 }, { start: 40, end: 60 }),
    ).toBe(true);
    expect(
      overlapsSubstantially({ start: 0, end: 20 }, { start: 19, end: 40 }),
    ).toBe(false);
  });
});

describe("median spacing", () => {
  it("averages the two middle values of an even sample", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("takes the middle value of an odd sample", () => {
    expect(median([10, 1, 5])).toBe(5);
  });

  it("ignores an outlier that would drag a mean", () => {
    const extents = [
      { start: 0, end: 10 },
      { start: 20, end: 30 },
      { start: 40, end: 50 },
      { start: 400, end: 410 },
    ];
    expect(inferGap(extents)).toBe(10);
  });

  it("treats overlapping siblings as a zero gap rather than a negative one", () => {
    expect(
      inferGap([
        { start: 0, end: 50 },
        { start: 30, end: 80 },
        { start: 70, end: 120 },
      ]),
    ).toBe(0);
  });

  it("has no gap to report for fewer than two siblings", () => {
    expect(inferGap([{ start: 0, end: 10 }])).toBe(0);
    expect(inferGap([])).toBe(0);
  });
});

describe("padding inference", () => {
  it("takes the smallest offset at each edge", () => {
    const padding = inferPadding(box(0, 0, 390, 844), [
      box(24, 60, 342, 40),
      box(32, 120, 300, 40),
    ]);
    expect(padding).toEqual({ top: 60, start: 24, bottom: 684, end: 24 });
  });

  it("never reports a negative inset for a child that overhangs", () => {
    const padding = inferPadding(box(0, 0, 100, 100), [box(-10, -10, 200, 200)]);
    expect(padding).toEqual({ top: 0, start: 0, bottom: 0, end: 0 });
  });

  it("is zero when there is nothing inside to measure against", () => {
    expect(inferPadding(box(0, 0, 100, 100), [])).toEqual({
      top: 0,
      start: 0,
      bottom: 0,
      end: 0,
    });
  });
});

describe("alignment inference", () => {
  const content = { start: 0, end: 300 };

  it("reads flush leading edges as start", () => {
    expect(
      inferAlignment(
        [
          { start: 0, end: 100 },
          { start: 0, end: 60 },
        ],
        content,
      ),
    ).toBe("start");
  });

  it("reads matching centres as center", () => {
    expect(
      inferAlignment(
        [
          { start: 100, end: 200 },
          { start: 120, end: 180 },
        ],
        content,
      ),
    ).toBe("center");
  });

  it("reads flush trailing edges as end", () => {
    expect(
      inferAlignment(
        [
          { start: 200, end: 300 },
          { start: 240, end: 300 },
        ],
        content,
      ),
    ).toBe("end");
  });

  it("reads children that span the container as stretch", () => {
    expect(
      inferAlignment(
        [
          { start: 0, end: 300 },
          { start: 0, end: 285 },
        ],
        content,
      ),
    ).toBe("stretch");
  });

  it("falls back to start when nothing lines up", () => {
    expect(
      inferAlignment(
        [
          { start: 0, end: 40 },
          { start: 90, end: 140 },
          { start: 30, end: 200 },
        ],
        content,
      ),
    ).toBe("start");
  });

  it("has nothing to infer from an empty or degenerate container", () => {
    expect(inferAlignment([], content)).toBe("start");
    expect(inferAlignment([{ start: 0, end: 1 }], { start: 5, end: 5 })).toBe(
      "start",
    );
  });
});

describe("extents", () => {
  it("reads both axes off a bounding box", () => {
    expect(verticalExtent(box(10, 20, 30, 40))).toEqual({ start: 20, end: 60 });
    expect(horizontalExtent(box(10, 20, 30, 40))).toEqual({ start: 10, end: 40 });
  });

  it("unions to the outermost edges", () => {
    expect(
      unionExtent([
        { start: 10, end: 20 },
        { start: 5, end: 15 },
        { start: 12, end: 40 },
      ]),
    ).toEqual({ start: 5, end: 40 });
  });

  it("refuses to union nothing rather than invent an extent", () => {
    expect(() => unionExtent([])).toThrow(/at least one/);
  });
});
