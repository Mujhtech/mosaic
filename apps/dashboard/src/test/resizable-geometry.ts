import { fireEvent } from "@testing-library/react"
import { vi } from "vitest"

export class ResizeObserverStub {
  disconnect() {}
  observe() {}
  unobserve() {}
}

export class PointerEventStub extends MouseEvent {
  readonly pointerId: number
  readonly pointerType: string

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init)
    this.pointerId = init.pointerId ?? 1
    this.pointerType = init.pointerType ?? "mouse"
  }
}

const originalDescriptors = new Map<PropertyKey, PropertyDescriptor | undefined>()

function groupOrientation(group: HTMLElement) {
  return group.style.flexDirection === "column" ? "vertical" : "horizontal"
}

function groupWidth(group: HTMLElement) {
  if (group.dataset.geometryWidth) return Number(group.dataset.geometryWidth)
  return group.id === "studio-horizontal-group" || group.id === "studio-root-group" ? 1_400 : 1_000
}

function groupHeight(group: HTMLElement) {
  if (group.dataset.geometryHeight) return Number(group.dataset.geometryHeight)
  if (group.id === "studio-root-group") return 852
  if (group.id === "studio-horizontal-group") return 632
  return 800
}

function panelAxisSize(element: HTMLElement, axis: "horizontal" | "vertical") {
  const group = element.parentElement
  if (!group) return 0
  const total = axis === "horizontal" ? groupWidth(group) : groupHeight(group)
  const flexGrow = Number(element.style.flexGrow)
  const basis = element.style.flexBasis
  const numeric = Number.parseFloat(basis)

  if (Number.isFinite(numeric) && numeric > 0) {
    if (basis.endsWith("%")) return (total * numeric) / 100
    if (basis.endsWith("vh")) return (window.innerHeight * numeric) / 100
    if (basis.endsWith("vw")) return (window.innerWidth * numeric) / 100
    return numeric
  }

  // A no-default panel starts at flex-grow 1 until the upstream group derives its layout.
  if (flexGrow === 1) {
    const occupied = Array.from(group.children).reduce((sum, sibling) => {
      if (!(sibling instanceof HTMLElement) || sibling === element) return sum
      const siblingBasis = sibling.style.flexBasis
      const siblingNumeric = Number.parseFloat(siblingBasis)
      if (!Number.isFinite(siblingNumeric) || siblingNumeric <= 0) return sum
      if (siblingBasis.endsWith("%")) return sum + (total * siblingNumeric) / 100
      if (siblingBasis.endsWith("vh")) return sum + (window.innerHeight * siblingNumeric) / 100
      return sum + siblingNumeric
    }, 0)
    return Math.max(0, total - occupied)
  }
  if (Number.isFinite(flexGrow) && flexGrow > 0) return (total * flexGrow) / 100
  return 0
}

function elementWidth(element: HTMLElement) {
  if (element.hasAttribute("data-group")) return groupWidth(element)
  if (element.hasAttribute("data-separator")) {
    return groupOrientation(element.parentElement!) === "horizontal"
      ? 1
      : groupWidth(element.parentElement!)
  }
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
  if (element.hasAttribute("data-separator")) {
    return groupOrientation(element.parentElement!) === "vertical"
      ? 1
      : groupHeight(element.parentElement!)
  }
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

export function installResizableGeometry() {
  for (const key of [
    "offsetWidth",
    "offsetHeight",
    "offsetLeft",
    "offsetTop",
    "getBoundingClientRect",
    "setPointerCapture",
    "hasPointerCapture",
  ]) {
    originalDescriptors.set(key, Object.getOwnPropertyDescriptor(HTMLElement.prototype, key))
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

export function restoreResizableGeometry() {
  for (const [key, descriptor] of originalDescriptors) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, key, descriptor)
    else Reflect.deleteProperty(HTMLElement.prototype, key)
  }
  originalDescriptors.clear()
}

export function dragResizableSeparator(
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
