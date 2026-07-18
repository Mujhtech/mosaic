import { act, render, screen } from "@testing-library/react"
import { renderToString } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  classifyStudioViewport,
  useStudioViewportMode,
} from "@/features/paywall-editor/hooks/use-studio-viewport-mode"

const originalInnerWidth = window.innerWidth

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
    writable: true,
  })
}

function ViewportProbe({ label }: { label: string }) {
  const mode = useStudioViewportMode()

  return <output aria-label={label}>{mode}</output>
}

afterEach(() => {
  setViewportWidth(originalInnerWidth)
})

describe("classifyStudioViewport", () => {
  it.each([
    [1440, "large"],
    [Number.MAX_VALUE, "large"],
    [1439, "medium"],
    [1120, "medium"],
    [1119, "compact"],
    [768, "compact"],
    [767, "desktop-required"],
    [0, "desktop-required"],
  ] as const)("classifies %s as %s", (width, expectedMode) => {
    expect(classifyStudioViewport(width)).toBe(expectedMode)
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1])(
    "safely treats invalid width %s as desktop-required",
    (width) => {
      expect(classifyStudioViewport(width)).toBe("desktop-required")
    },
  )
})

describe("useStudioViewportMode", () => {
  it("uses one resize listener for every mounted consumer and publishes mode changes", () => {
    setViewportWidth(1440)
    const addEventListener = vi.spyOn(window, "addEventListener")
    const removeEventListener = vi.spyOn(window, "removeEventListener")

    const view = render(
      <>
        <ViewportProbe label="primary viewport" />
        <ViewportProbe label="secondary viewport" />
      </>,
    )

    expect(
      addEventListener.mock.calls.filter(([eventName]) => eventName === "resize"),
    ).toHaveLength(1)
    expect(screen.getByLabelText("primary viewport")).toHaveTextContent("large")
    expect(screen.getByLabelText("secondary viewport")).toHaveTextContent("large")

    act(() => {
      setViewportWidth(1120)
      window.dispatchEvent(new Event("resize"))
    })

    expect(screen.getByLabelText("primary viewport")).toHaveTextContent("medium")
    expect(screen.getByLabelText("secondary viewport")).toHaveTextContent("medium")

    view.unmount()

    expect(
      removeEventListener.mock.calls.filter(([eventName]) => eventName === "resize"),
    ).toHaveLength(1)
  })

  it("uses a stable large-mode server snapshot", () => {
    expect(renderToString(<ViewportProbe label="server viewport" />)).toContain(">large</output>")
  })
})
