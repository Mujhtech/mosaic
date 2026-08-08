import { describe, expect, it } from "vitest";
import {
  clampFontSize,
  isAllCaps,
  numericWeightFromStyleName,
  pickTypographyStyle,
  snapFontWeight,
  toLineHeightMultiplier,
  toTextAlignment,
} from "./typography.js";

describe("snapFontWeight", () => {
  it("snaps to the nearest protocol weight", () => {
    expect(snapFontWeight(100)).toBe("regular");
    expect(snapFontWeight(400)).toBe("regular");
    expect(snapFontWeight(520)).toBe("medium");
    expect(snapFontWeight(590)).toBe("semibold");
    expect(snapFontWeight(700)).toBe("bold");
    expect(snapFontWeight(900)).toBe("bold");
  });

  it("resolves a tie to the lighter weight", () => {
    expect(snapFontWeight(450)).toBe("regular");
    expect(snapFontWeight(550)).toBe("medium");
    expect(snapFontWeight(650)).toBe("semibold");
  });

  it("falls back to the style name when no numeric weight is reported", () => {
    expect(snapFontWeight(null, "SemiBold")).toBe("semibold");
    expect(snapFontWeight(null, "Extra Bold")).toBe("bold");
    expect(snapFontWeight(null, "Light")).toBe("regular");
    expect(snapFontWeight(null, "Medium Italic")).toBe("medium");
  });

  it("prefers semibold over bold when the style name contains both", () => {
    expect(numericWeightFromStyleName("SemiBold")).toBe(600);
    expect(numericWeightFromStyleName("DemiBold")).toBe(600);
    expect(numericWeightFromStyleName("Bold")).toBe(700);
  });

  it("is regular when nothing is known", () => {
    expect(snapFontWeight(null, null)).toBe("regular");
    expect(snapFontWeight(Number.NaN)).toBe("regular");
    expect(snapFontWeight(null, "Whatever")).toBe("regular");
  });
});

describe("clampFontSize", () => {
  it("clamps to the schema bounds", () => {
    expect(clampFontSize(4)).toBe(8);
    expect(clampFontSize(200)).toBe(96);
    expect(clampFontSize(17.456)).toBe(17.46);
  });

  it("uses the default for a mixed size", () => {
    expect(clampFontSize(null)).toBe(16);
  });
});

describe("toLineHeightMultiplier", () => {
  it("uses 1.2 for AUTO", () => {
    expect(toLineHeightMultiplier({ unit: "auto" }, 16)).toBe(1.2);
  });

  it("converts a percentage", () => {
    expect(toLineHeightMultiplier({ unit: "percent", value: 150 }, 16)).toBe(1.5);
  });

  it("divides pixels by the resolved font size", () => {
    expect(toLineHeightMultiplier({ unit: "pixels", value: 24 }, 16)).toBe(1.5);
  });

  it("clamps to the schema bounds", () => {
    expect(toLineHeightMultiplier({ unit: "percent", value: 40 }, 16)).toBe(0.8);
    expect(toLineHeightMultiplier({ unit: "percent", value: 900 }, 16)).toBe(3);
  });
});

describe("pickTypographyStyle", () => {
  it("reads size first", () => {
    expect(pickTypographyStyle(40, "Unlock everything")).toBe("display");
    expect(pickTypographyStyle(32, "Unlock everything")).toBe("display");
    expect(pickTypographyStyle(24, "Plans")).toBe("title");
    expect(pickTypographyStyle(18, "Plans")).toBe("heading");
    expect(pickTypographyStyle(16, "Some prose here")).toBe("body");
    expect(pickTypographyStyle(11, "Some fine print")).toBe("caption");
  });

  it("prefers label over caption for small all-caps text", () => {
    expect(pickTypographyStyle(11, "INCLUDED")).toBe("label");
    expect(pickTypographyStyle(14, "MOST POPULAR")).toBe("label");
  });

  it("does not call a large all-caps heading a label", () => {
    expect(pickTypographyStyle(36, "UNLOCK")).toBe("display");
  });

  it("does not call digits or symbols all-caps", () => {
    expect(isAllCaps("2024")).toBe(false);
    expect(isAllCaps("•••")).toBe(false);
    expect(isAllCaps("A SHOUTED SENTENCE THAT RUNS WELL PAST THE LABEL LIMIT")).toBe(
      false,
    );
    expect(isAllCaps("INCLUDED")).toBe(true);
  });
});

describe("toTextAlignment", () => {
  it("maps the three protocol alignments and degrades justified", () => {
    expect(toTextAlignment("left")).toBe("start");
    expect(toTextAlignment("center")).toBe("center");
    expect(toTextAlignment("right")).toBe("end");
    expect(toTextAlignment("justified")).toBe("start");
  });
});
