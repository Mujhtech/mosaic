import { describe, expect, it } from "vitest"

import type { PaywallDesignSystem } from "@/features/paywall-editor/types/editor"
import {
  clampGradientAngle,
  insertGradientStop,
  isSafeTokenReplacement,
  updateGradientStopPosition,
} from "@/features/paywall-editor/utils/style-authoring"

describe("style authoring safeguards", () => {
  it("inserts gradient stops inside the largest gap without duplicating positions", () => {
    const stops = insertGradientStop([
      { position: 0, color: "surface.default" },
      { position: 1, color: "surface.elevated" },
    ])

    expect(stops.map((stop) => stop.position)).toEqual([0, 0.5, 1])
    expect(
      stops.every((stop, index) => index === 0 || stop.position > stops[index - 1]!.position),
    ).toBe(true)
  })

  it("keeps edited gradient positions strictly between adjacent stops", () => {
    const stops = updateGradientStopPosition(
      [
        { position: 0, color: "surface.default" },
        { position: 0.5, color: "surface.default" },
        { position: 1, color: "surface.default" },
      ],
      1,
      1,
    )

    expect(stops.map((stop) => stop.position)).toEqual([0, 0.99, 1])
    expect(clampGradientAngle(-45)).toBe(0)
    expect(clampGradientAngle(540)).toBe(360)
  })

  it("rejects direct and transitive replacement cycles", () => {
    const system: PaywallDesignSystem = {
      colors: [
        { id: "source", name: "Source", value: "#000000FF" },
        { id: "direct", name: "Direct", value: { type: "colorToken", id: "source" } },
        { id: "transitive", name: "Transitive", value: { type: "colorToken", id: "direct" } },
        { id: "safe", name: "Safe", value: "#FFFFFFFF" },
      ],
      backgrounds: [],
      shadows: [],
    }

    expect(isSafeTokenReplacement(system, "colors", "source", "direct")).toBe(false)
    expect(isSafeTokenReplacement(system, "colors", "source", "transitive")).toBe(false)
    expect(isSafeTokenReplacement(system, "colors", "source", "safe")).toBe(true)
  })
})
