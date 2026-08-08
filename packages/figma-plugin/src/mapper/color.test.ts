import { describe, expect, it } from "vitest";
import {
  firstVisibleSolid,
  hasVisibleUnsupportedPaint,
  solidFillColor,
  toLiteralColor,
} from "./color.js";
import { imagePaint, solid } from "./test-support.js";

/** `#/$defs/literalColor`. */
const LITERAL_COLOR_PATTERN = /^#[0-9A-F]{8}$/;

describe("toLiteralColor", () => {
  it("emits uppercase eight-digit hex", () => {
    expect(toLiteralColor({ r: 1, g: 1, b: 1 }, 1)).toBe("#FFFFFFFF");
    expect(toLiteralColor({ r: 0, g: 0, b: 0 }, 0)).toBe("#00000000");
    expect(toLiteralColor({ r: 0.8, g: 0.4, b: 0.2 }, 0.5)).toMatch(
      LITERAL_COLOR_PATTERN,
    );
  });

  it("rounds channels rather than truncating them", () => {
    // 0.5 * 255 = 127.5, which truncation would read as 7F.
    expect(toLiteralColor({ r: 0.5, g: 0.5, b: 0.5 }, 1)).toBe("#808080FF");
  });

  it("clamps values outside 0..1", () => {
    expect(toLiteralColor({ r: 2, g: -1, b: 0.5 }, 5)).toBe("#FF0080FF");
  });

  it("pads single-digit channels", () => {
    expect(toLiteralColor({ r: 1 / 255, g: 0, b: 0 }, 1)).toBe("#010000FF");
  });
});

describe("solidFillColor", () => {
  it("multiplies paint opacity by node opacity", () => {
    // 0.5 * 0.5 = 0.25 -> 64 -> 0x40.
    expect(solidFillColor([solid("#FF0000", 0.5)], 0.5)).toBe("#FF000040");
  });

  it("skips hidden paints and takes the first visible solid", () => {
    expect(
      solidFillColor([solid("#FF0000", 1, false), solid("#00FF00")], 1),
    ).toBe("#00FF00FF");
  });

  it("returns null when there is no solid fill", () => {
    expect(solidFillColor([imagePaint()], 1)).toBeNull();
    expect(solidFillColor([], 1)).toBeNull();
  });

  it("does not treat an unsupported paint as a solid", () => {
    expect(firstVisibleSolid([imagePaint()])).toBeNull();
    expect(hasVisibleUnsupportedPaint([imagePaint()])).toBe(true);
    expect(hasVisibleUnsupportedPaint([imagePaint(false)])).toBe(false);
    expect(hasVisibleUnsupportedPaint([solid("#FFFFFF")])).toBe(false);
  });
});
