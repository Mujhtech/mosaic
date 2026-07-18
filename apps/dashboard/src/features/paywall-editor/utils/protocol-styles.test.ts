import { describe, expect, it } from "vitest"

import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates"
import {
  protocolGradientAngleToCss,
  resolvedBackground,
} from "@/features/paywall-editor/utils/protocol-styles"

describe("Protocol 0.2 preview styles", () => {
  it.each([
    [0, 90],
    [90, 180],
    [360, 90],
    [-90, 0],
  ])("maps the physical %s° gradient angle to CSS %s°", (protocolAngle, cssAngle) => {
    expect(protocolGradientAngleToCss(protocolAngle)).toBe(cssAngle)
  })

  it("renders physical gradient angles without any locale or RTL mirroring input", () => {
    const document = EDITOR_TEMPLATES[0]!.document
    const leftToRight = resolvedBackground(document, {
      type: "linearGradient",
      angle: 0,
      stops: [
        { position: 0, color: "#000000FF" },
        { position: 1, color: "#FFFFFFFF" },
      ],
    })
    const topToBottom = resolvedBackground(document, {
      type: "linearGradient",
      angle: 90,
      stops: [
        { position: 0, color: "#000000FF" },
        { position: 1, color: "#FFFFFFFF" },
      ],
    })

    expect(leftToRight.style.backgroundImage).toBe(
      "linear-gradient(90deg, rgba(0, 0, 0, 1) 0%, rgba(255, 255, 255, 1) 100%)",
    )
    expect(topToBottom.style.backgroundImage).toBe(
      "linear-gradient(180deg, rgba(0, 0, 0, 1) 0%, rgba(255, 255, 255, 1) 100%)",
    )
  })
})
