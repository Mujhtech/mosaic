import { describe, expect, it } from "vitest";
import {
  tokensFor,
  withDuplicatedToken,
  withMovedToken,
  withoutToken,
} from "@/features/paywall-editor/components/design-system-controls";
import type { PaywallDesignSystem } from "@/features/paywall-editor/types/editor";
import {
  clampGradientAngle,
  insertGradientStop,
  isSafeTokenReplacement,
  tokenReferenceType,
  updateGradientStopPosition,
} from "@/features/paywall-editor/utils/style-authoring";
import { required } from "@/test/required";

describe("style authoring safeguards", () => {
  it("inserts gradient stops inside the largest gap without duplicating positions", () => {
    const stops = insertGradientStop([
      { position: 0, color: "surface.default" },
      { position: 1, color: "surface.elevated" },
    ]);

    expect(stops.map((stop) => stop.position)).toEqual([0, 0.5, 1]);
    expect(
      stops.every(
        (stop, index) =>
          index === 0 ||
          stop.position >
            required(stops[index - 1], "stops[index - 1]").position
      )
    ).toBe(true);
  });

  it("keeps edited gradient positions strictly between adjacent stops", () => {
    const stops = updateGradientStopPosition(
      [
        { position: 0, color: "surface.default" },
        { position: 0.5, color: "surface.default" },
        { position: 1, color: "surface.default" },
      ],
      1,
      1
    );

    expect(stops.map((stop) => stop.position)).toEqual([0, 0.99, 1]);
    expect(clampGradientAngle(-45)).toBe(0);
    expect(clampGradientAngle(540)).toBe(360);
  });

  it("rejects direct and transitive replacement cycles", () => {
    const system: PaywallDesignSystem = {
      colors: [
        { id: "source", name: "Source", value: "#000000FF" },
        {
          id: "direct",
          name: "Direct",
          value: { type: "colorToken", id: "source" },
        },
        {
          id: "transitive",
          name: "Transitive",
          value: { type: "colorToken", id: "direct" },
        },
        { id: "safe", name: "Safe", value: "#FFFFFFFF" },
      ],
      backgrounds: [],
      shadows: [],
      motions: [],
    };

    expect(isSafeTokenReplacement(system, "colors", "source", "direct")).toBe(
      false
    );
    expect(
      isSafeTokenReplacement(system, "colors", "source", "transitive")
    ).toBe(false);
    expect(isSafeTokenReplacement(system, "colors", "source", "safe")).toBe(
      true
    );
  });
  /**
   * The motions catalog is the fourth one, and the three CRUD helpers are
   * generic over the category precisely so that adding it was not a four-place
   * edit. That genericity is the thing worth testing: a helper that still
   * branched per catalog would silently no-op on motions, leaving the Motion
   * section's add, duplicate, reorder, and delete buttons inert.
   */
  it("manages the motions catalog through the shared catalog helpers", () => {
    const system: PaywallDesignSystem = {
      colors: [],
      backgrounds: [],
      shadows: [],
      motions: [
        {
          id: "motion-entrance",
          name: "Entrance",
          value: {
            type: "motion",
            durationMilliseconds: 240,
            easing: "decelerate",
          },
        },
        {
          id: "motion-pulse",
          name: "Pulse",
          value: {
            type: "motion",
            durationMilliseconds: 600,
            easing: "standard",
          },
        },
      ],
    };

    expect(tokensFor(system, "motions").map((token) => token.id)).toEqual([
      "motion-entrance",
      "motion-pulse",
    ]);
    expect(tokenReferenceType("motions")).toBe("motionToken");

    const duplicated = withDuplicatedToken(
      system,
      "motions",
      "motion-entrance"
    );
    expect(tokensFor(duplicated, "motions").map((token) => token.name)).toEqual(
      ["Entrance", "Pulse", "Entrance copy"]
    );

    const moved = withMovedToken(system, "motions", "motion-pulse", -1);
    expect(tokensFor(moved, "motions").map((token) => token.id)).toEqual([
      "motion-pulse",
      "motion-entrance",
    ]);
    // Clamped rather than wrapped: reordering past the end must not rotate.
    expect(
      tokensFor(
        withMovedToken(system, "motions", "motion-entrance", -1),
        "motions"
      )
    ).toEqual(system.motions);

    const removed = withoutToken(system, "motions", "motion-entrance");
    expect(tokensFor(removed, "motions").map((token) => token.id)).toEqual([
      "motion-pulse",
    ]);
    // The other catalogs are untouched by a motions edit.
    expect(removed.colors).toEqual([]);
    expect(removed.shadows).toEqual([]);
  });
});
