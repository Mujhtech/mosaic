import { describe, expect, it } from "vitest";
import {
  detectProductCardGroups,
  detectsAsButton,
  looksLikePrice,
  soleTextChild,
  structureSignature,
} from "./detect.js";
import { frame, imagePaint, shape, solid, text, unsupported } from "./test-support.js";

describe("button detection", () => {
  it("claims a painted, rounded frame wrapping one label", () => {
    expect(
      detectsAsButton(
        frame({
          name: "Frame 12",
          fills: [solid("#0D99FF")],
          cornerRadius: 28,
          children: [text({ name: "Label", characters: "Continue" })],
        }),
      ),
    ).toBe(true);
  });

  it("claims a frame whose name says button, however it is painted", () => {
    for (const name of ["Primary Button", "btn / large", "CTA", "cta-primary"]) {
      expect(
        detectsAsButton(
          frame({
            name,
            children: [text({ name: "Label", characters: "Continue" })],
          }),
        ),
      ).toBe(true);
    }
  });

  it("does not read a word that merely contains one of the tokens", () => {
    expect(
      detectsAsButton(
        frame({
          name: "Buttons overview",
          children: [text({ name: "Label", characters: "Continue" })],
        }),
      ),
    ).toBe(false);
  });

  it("leaves a painted rounded frame with two children as a stack", () => {
    expect(
      detectsAsButton(
        frame({
          name: "Card",
          fills: [solid("#0D99FF")],
          cornerRadius: 12,
          children: [
            text({ name: "Title", characters: "Yearly" }),
            text({ name: "Price", characters: "$59.99" }),
          ],
        }),
      ),
    ).toBe(false);
  });

  it("leaves a painted rounded frame holding an icon beside its label as a stack", () => {
    // The protocol's button would take the icon, but the plugin has no asset to
    // put there, so it would ship a button missing half its content.
    expect(
      detectsAsButton(
        frame({
          name: "Button",
          fills: [solid("#0D99FF")],
          cornerRadius: 12,
          children: [
            unsupported({ name: "Icon", figmaType: "VECTOR", reason: "vector" }),
            text({ name: "Label", characters: "Continue" }),
          ],
        }),
      ),
    ).toBe(false);
  });

  it("needs a corner radius as well as a fill", () => {
    expect(
      detectsAsButton(
        frame({
          name: "Banner",
          fills: [solid("#0D99FF")],
          cornerRadius: 0,
          children: [text({ name: "Label", characters: "Continue" })],
        }),
      ),
    ).toBe(false);
  });

  it("needs a solid fill, not an image one", () => {
    expect(
      detectsAsButton(
        frame({
          name: "Hero",
          fills: [imagePaint()],
          cornerRadius: 20,
          children: [text({ name: "Label", characters: "Continue" })],
        }),
      ),
    ).toBe(false);
  });

  it("rejects an empty or hidden label", () => {
    const blank = frame({
      name: "Button",
      children: [text({ name: "Label", characters: "   " })],
    });
    const hidden = frame({
      name: "Button",
      children: [
        text({ name: "Label", characters: "Continue", visible: false }),
      ],
    });
    expect(detectsAsButton(blank)).toBe(false);
    expect(detectsAsButton(hidden)).toBe(false);
    expect(soleTextChild(blank)).toBeNull();
  });

  it("rejects a frame whose only child is not text", () => {
    expect(
      detectsAsButton(
        frame({
          name: "Button",
          fills: [solid("#0D99FF")],
          cornerRadius: 8,
          children: [shape({ name: "Fill" })],
        }),
      ),
    ).toBe(false);
  });
});

describe("price detection", () => {
  it("reads the shapes a price takes", () => {
    for (const value of ["$9.99", "€ 4", "£12,00", "9.99", "59,00 kr"]) {
      expect(looksLikePrice(value)).toBe(true);
    }
  });

  it("does not read a bare number or a measurement as a price", () => {
    for (const value of ["Unlimited", "7 days free", "1.5 GB", "2024"]) {
      expect(looksLikePrice(value)).toBe(false);
    }
  });
});

describe("plan-card detection", () => {
  const card = (name: string, price: string) =>
    frame({
      name,
      children: [
        text({ name: "Name", characters: name }),
        text({ name: "Price", characters: price }),
      ],
    });

  it("finds sibling frames that share a structure and each carry a price", () => {
    const cards = detectProductCardGroups(
      frame({
        name: "Plans",
        children: [
          text({ name: "Heading", characters: "Choose a plan" }),
          card("Monthly", "$9.99"),
          card("Yearly", "$59.99"),
          card("Lifetime", "$149.00"),
        ],
      }),
    );
    expect(cards.map((entry) => entry.name)).toEqual([
      "Monthly",
      "Yearly",
      "Lifetime",
    ]);
  });

  it("finds a price nested inside a card rather than only at its top level", () => {
    const nested = (name: string, price: string) =>
      frame({
        name,
        children: [
          frame({
            name: "Inner",
            children: [text({ name: "Price", characters: price })],
          }),
        ],
      });
    expect(
      detectProductCardGroups(
        frame({ name: "Plans", children: [nested("A", "$1.00"), nested("B", "$2.00")] }),
      ),
    ).toHaveLength(2);
  });

  it("ignores a lone priced card", () => {
    expect(
      detectProductCardGroups(
        frame({ name: "Plans", children: [card("Monthly", "$9.99")] }),
      ),
    ).toEqual([]);
  });

  it("ignores repeated rows that carry no price", () => {
    expect(
      detectProductCardGroups(
        frame({
          name: "Features",
          children: [
            card("Offline", "Included"),
            card("Sync", "Included"),
            card("Backup", "Included"),
          ],
        }),
      ),
    ).toEqual([]);
  });

  it("ignores priced siblings that are built differently from each other", () => {
    expect(
      detectProductCardGroups(
        frame({
          name: "Mixed",
          children: [
            frame({
              name: "Hero Price",
              children: [text({ name: "Price", characters: "$9.99" })],
            }),
            card("Yearly", "$59.99"),
          ],
        }),
      ),
    ).toEqual([]);
  });

  it("fingerprints only the visible direct children", () => {
    expect(
      structureSignature(
        frame({
          name: "Card",
          children: [
            text({ name: "Name", characters: "Yearly" }),
            text({ name: "Hidden", characters: "x", visible: false }),
            shape({ name: "Rule" }),
          ],
        }),
      ),
    ).toBe("text,shape");
  });
});
