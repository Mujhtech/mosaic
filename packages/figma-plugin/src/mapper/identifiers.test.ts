import { describe, expect, it } from "vitest";
import {
  IDENTIFIER_MAX_LENGTH,
  identifierAllocator,
  localizationKeyAllocator,
  slugifyIdentifier,
  slugifyKeySegment,
} from "./identifiers.js";

/** `#/$defs/identifier`. */
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/;

/** `#/$defs/localizationKey`. */
const LOCALIZATION_KEY_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;

describe("slugifyIdentifier", () => {
  it("lowercases and hyphenates a layer name", () => {
    expect(slugifyIdentifier("Hero Title")).toBe("hero-title");
    expect(slugifyIdentifier("Paywall / Annual")).toBe("paywall-annual");
    expect(slugifyIdentifier("CTA__Button  ")).toBe("cta-button");
  });

  it("keeps a leading digit rather than dropping it", () => {
    expect(slugifyIdentifier("2 Columns")).toBe("n-2-columns");
  });

  it("folds accents instead of losing the letter", () => {
    expect(slugifyIdentifier("Café Plan")).toBe("cafe-plan");
  });

  it("falls back when nothing slugifiable remains", () => {
    expect(slugifyIdentifier("···")).toBe("node");
    expect(slugifyIdentifier("", "group")).toBe("group");
    expect(slugifyIdentifier("🎉")).toBe("node");
  });

  it("truncates without leaving a trailing separator", () => {
    const name = `${"segment ".repeat(40)}tail`;
    const slug = slugifyIdentifier(name);
    expect(slug.length).toBeLessThanOrEqual(IDENTIFIER_MAX_LENGTH);
    expect(slug).toMatch(IDENTIFIER_PATTERN);
  });

  it("always produces something the schema accepts", () => {
    for (const name of [
      "Frame 12",
      "-- divider --",
      "  spaced  out  ",
      "ALL CAPS",
      "mixed_Case-Name",
      "9",
    ]) {
      expect(slugifyIdentifier(name)).toMatch(IDENTIFIER_PATTERN);
    }
  });
});

describe("slugifyKeySegment", () => {
  it("uses underscores, because a localization key forbids hyphens", () => {
    expect(slugifyKeySegment("Hero Title")).toBe("hero_title");
    expect(`figma.${slugifyKeySegment("Hero Title")}`).toMatch(
      LOCALIZATION_KEY_PATTERN,
    );
  });

  it("prefixes a leading digit", () => {
    expect(`figma.${slugifyKeySegment("30 day trial")}`).toMatch(
      LOCALIZATION_KEY_PATTERN,
    );
  });

  it("falls back for an unslugifiable name", () => {
    expect(slugifyKeySegment("!!!")).toBe("text");
  });
});

describe("allocators", () => {
  it("de-duplicates repeated layer names", () => {
    const ids = identifierAllocator();
    expect(ids.allocate("feature")).toBe("feature");
    expect(ids.allocate("feature")).toBe("feature-2");
    expect(ids.allocate("feature")).toBe("feature-3");
    expect(ids.allocate("other")).toBe("other");
  });

  it("does not collide with a name that already looks like a suffix", () => {
    const ids = identifierAllocator();
    expect(ids.allocate("feature")).toBe("feature");
    expect(ids.allocate("feature-2")).toBe("feature-2");
    expect(ids.allocate("feature")).toBe("feature-3");
  });

  it("de-duplicates localization keys with the key separator", () => {
    const keys = localizationKeyAllocator();
    expect(keys.allocate("figma.title")).toBe("figma.title");
    expect(keys.allocate("figma.title")).toBe("figma.title_2");
    expect(keys.allocate("figma.title")).toBe("figma.title_3");
    expect(keys.allocate("figma.title_3")).toBe("figma.title_3_2");
  });

  it("keeps de-duplicated identifiers within the schema bounds", () => {
    const ids = identifierAllocator();
    const long = slugifyIdentifier("x".repeat(200));
    for (let index = 0; index < 12; index += 1) {
      const allocated = ids.allocate(long);
      expect(allocated.length).toBeLessThanOrEqual(IDENTIFIER_MAX_LENGTH);
      expect(allocated).toMatch(IDENTIFIER_PATTERN);
    }
  });
});
