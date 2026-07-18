import { createRef } from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import type {
  ResizableLayoutChangedMeta,
  ResizablePanelImperativeHandle,
} from "@/components/ui/resizable"

class ResizeObserverStub {
  disconnect() {}
  observe() {}
  unobserve() {}
}

class PointerEventStub extends MouseEvent {
  readonly pointerId: number
  readonly pointerType: string

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init)
    this.pointerId = init.pointerId ?? 1
    this.pointerType = init.pointerType ?? "mouse"
  }
}

const originalDescriptors = new Map<PropertyKey, PropertyDescriptor | undefined>()

function rememberProperty(key: PropertyKey) {
  originalDescriptors.set(key, Object.getOwnPropertyDescriptor(HTMLElement.prototype, key))
}

function groupOrientation(group: HTMLElement) {
  return group.style.flexDirection === "column" ? "vertical" : "horizontal"
}

function groupWidth(group: HTMLElement) {
  return Number(group.dataset.geometryWidth ?? 1_000)
}

function groupHeight(group: HTMLElement) {
  return Number(group.dataset.geometryHeight ?? 800)
}

function panelAxisSize(element: HTMLElement, axis: "horizontal" | "vertical") {
  const group = element.parentElement
  if (!group) return 0
  const total = axis === "horizontal" ? groupWidth(group) : groupHeight(group)
  const flexGrow = Number(element.style.flexGrow)
  if (Number.isFinite(flexGrow) && flexGrow > 0) return (total * flexGrow) / 100
  const basis = element.style.flexBasis
  const numeric = Number.parseFloat(basis)
  if (!Number.isFinite(numeric)) return 0
  if (basis.endsWith("%")) return (total * numeric) / 100
  if (basis.endsWith("vh")) return (window.innerHeight * numeric) / 100
  if (basis.endsWith("vw")) return (window.innerWidth * numeric) / 100
  return numeric
}

function elementWidth(element: HTMLElement) {
  if (element.hasAttribute("data-group")) return groupWidth(element)
  if (element.hasAttribute("data-separator"))
    return groupOrientation(element.parentElement!) === "horizontal"
      ? 1
      : groupWidth(element.parentElement!)
  if (element.hasAttribute("data-panel")) {
    const group = element.parentElement
    return group && groupOrientation(group) === "horizontal"
      ? panelAxisSize(element, "horizontal")
      : group
        ? groupWidth(group)
        : 0
  }
  return 0
}

function elementHeight(element: HTMLElement) {
  if (element.hasAttribute("data-group")) return groupHeight(element)
  if (element.hasAttribute("data-separator"))
    return groupOrientation(element.parentElement!) === "vertical"
      ? 1
      : groupHeight(element.parentElement!)
  if (element.hasAttribute("data-panel")) {
    const group = element.parentElement
    return group && groupOrientation(group) === "vertical"
      ? panelAxisSize(element, "vertical")
      : group
        ? groupHeight(group)
        : 0
  }
  return 0
}

function elementAxisOffset(element: HTMLElement, axis: "horizontal" | "vertical") {
  const parent = element.parentElement
  if (!parent) return 0
  if (parent.hasAttribute("data-group") && groupOrientation(parent) !== axis) return 0
  let offset = 0
  for (const sibling of Array.from(parent.children)) {
    if (sibling === element) break
    if (!(sibling instanceof HTMLElement)) continue
    offset += axis === "horizontal" ? sibling.offsetWidth : sibling.offsetHeight
  }
  return offset
}

function installGeometry() {
  for (const key of [
    "offsetWidth",
    "offsetHeight",
    "offsetLeft",
    "offsetTop",
    "getBoundingClientRect",
    "setPointerCapture",
    "hasPointerCapture",
  ]) {
    rememberProperty(key)
  }

  Object.defineProperties(HTMLElement.prototype, {
    offsetWidth: {
      configurable: true,
      get() {
        return elementWidth(this as HTMLElement)
      },
    },
    offsetHeight: {
      configurable: true,
      get() {
        return elementHeight(this as HTMLElement)
      },
    },
    offsetLeft: {
      configurable: true,
      get() {
        return elementAxisOffset(this as HTMLElement, "horizontal")
      },
    },
    offsetTop: {
      configurable: true,
      get() {
        return elementAxisOffset(this as HTMLElement, "vertical")
      },
    },
    getBoundingClientRect: {
      configurable: true,
      value(this: HTMLElement) {
        const x = elementAxisOffset(this, "horizontal")
        const y = elementAxisOffset(this, "vertical")
        return new DOMRect(x, y, elementWidth(this), elementHeight(this))
      },
    },
    setPointerCapture: { configurable: true, value: vi.fn() },
    hasPointerCapture: { configurable: true, value: vi.fn(() => false) },
  })
}

function restoreGeometry() {
  for (const [key, descriptor] of originalDescriptors) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, key, descriptor)
    else Reflect.deleteProperty(HTMLElement.prototype, key)
  }
  originalDescriptors.clear()
}

function ResizeHarness({
  collapsible = false,
  onLayoutChanged,
  orientation,
  panelRef,
}: {
  collapsible?: boolean
  onLayoutChanged?: (layout: Record<string, number>, meta: ResizableLayoutChangedMeta) => void
  orientation: "horizontal" | "vertical"
  panelRef: React.RefObject<ResizablePanelImperativeHandle | null>
}) {
  const horizontal = orientation === "horizontal"
  return (
    <ResizablePanelGroup
      data-geometry-height="800"
      data-geometry-width="1000"
      id={`${orientation}-behavior-group`}
      onLayoutChanged={onLayoutChanged}
      orientation={orientation}
    >
      <ResizablePanel
        collapsedSize="0px"
        collapsible={collapsible}
        defaultSize={horizontal ? "300px" : "500px"}
        id={`${orientation}-first-panel`}
        maxSize={horizontal ? "440px" : "620px"}
        minSize={horizontal ? "240px" : "380px"}
        panelRef={panelRef}
      >
        First
      </ResizablePanel>
      <ResizableHandle aria-label={`Resize ${orientation} panels`} withHandle />
      <ResizablePanel
        defaultSize={horizontal ? "700px" : "300px"}
        id={`${orientation}-second-panel`}
        minSize={horizontal ? "420px" : "140px"}
      >
        Second
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}

function dragSeparator(
  separator: HTMLElement,
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  fireEvent.pointerDown(separator, {
    button: 0,
    buttons: 1,
    clientX: start.x,
    clientY: start.y,
    pointerId: 7,
    pointerType: "mouse",
  })
  fireEvent.pointerMove(separator, {
    buttons: 1,
    clientX: end.x,
    clientY: end.y,
    movementX: end.x - start.x,
    movementY: end.y - start.y,
    pointerId: 7,
    pointerType: "mouse",
  })
  fireEvent.pointerUp(separator, {
    button: 0,
    buttons: 0,
    clientX: end.x,
    clientY: end.y,
    pointerId: 7,
    pointerType: "mouse",
  })
}

describe("Resizable upstream behavior", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub)
    vi.stubGlobal("PointerEvent", PointerEventStub)
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false })),
    )
    installGeometry()
  })

  afterEach(() => {
    restoreGeometry()
    vi.unstubAllGlobals()
  })

  it.each([
    ["horizontal", { x: 300, y: 100 }, { x: 380, y: 100 }, 380],
    ["vertical", { x: 100, y: 500 }, { x: 100, y: 560 }, 560],
  ] as const)(
    "uses upstream %s pointer resizing and pointer capture",
    async (orientation, start, end, expected) => {
      const panelRef = createRef<ResizablePanelImperativeHandle>()
      const onLayoutChanged = vi.fn()
      render(
        <ResizeHarness
          onLayoutChanged={onLayoutChanged}
          orientation={orientation}
          panelRef={panelRef}
        />,
      )
      const separator = screen.getByRole("separator", { name: `Resize ${orientation} panels` })
      await waitFor(() =>
        expect(panelRef.current?.getSize().inPixels).toBe(orientation === "horizontal" ? 300 : 500),
      )
      onLayoutChanged.mockClear()

      dragSeparator(separator, start, end)

      await waitFor(() => expect(panelRef.current?.getSize().inPixels).toBeCloseTo(expected, 0))
      expect(HTMLElement.prototype.setPointerCapture).toHaveBeenCalledWith(7)
      expect(onLayoutChanged).toHaveBeenLastCalledWith(
        expect.any(Object),
        expect.objectContaining({ isUserInteraction: true }),
      )
    },
  )

  it("uses upstream keyboard resizing with enforced minimum and maximum sizes", async () => {
    const panelRef = createRef<ResizablePanelImperativeHandle>()
    const onLayoutChanged = vi.fn()
    render(
      <ResizeHarness
        onLayoutChanged={onLayoutChanged}
        orientation="horizontal"
        panelRef={panelRef}
      />,
    )
    const separator = screen.getByRole("separator", { name: "Resize horizontal panels" })
    await waitFor(() => expect(panelRef.current?.getSize().inPixels).toBe(300))
    onLayoutChanged.mockClear()

    fireEvent.keyDown(separator, { key: "ArrowRight" })
    await waitFor(() => expect(panelRef.current?.getSize().inPixels).toBe(350))
    fireEvent.keyDown(separator, { key: "End" })
    await waitFor(() => expect(panelRef.current?.getSize().inPixels).toBe(440))
    fireEvent.keyDown(separator, { key: "Home" })
    await waitFor(() => expect(panelRef.current?.getSize().inPixels).toBe(240))

    expect(onLayoutChanged).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({ isUserInteraction: true }),
    )
  })

  it("uses upstream Enter collapse/expand and double-click default reset", async () => {
    const panelRef = createRef<ResizablePanelImperativeHandle>()
    render(<ResizeHarness collapsible orientation="horizontal" panelRef={panelRef} />)
    const separator = screen.getByRole("separator", { name: "Resize horizontal panels" })
    await waitFor(() => expect(panelRef.current?.getSize().inPixels).toBe(300))

    fireEvent.keyDown(separator, { key: "Enter" })
    await waitFor(() => expect(panelRef.current?.isCollapsed()).toBe(true))
    fireEvent.keyDown(separator, { key: "Enter" })
    await waitFor(() => expect(panelRef.current?.isCollapsed()).toBe(false))

    panelRef.current?.resize("400px")
    await waitFor(() => expect(panelRef.current?.getSize().inPixels).toBe(400))
    fireEvent.doubleClick(separator, { clientX: 400, clientY: 100 })
    await waitFor(() => expect(panelRef.current?.getSize().inPixels).toBe(300))
  })
})
