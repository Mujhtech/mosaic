import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useEffect } from "react"
import { describe, expect, it, vi } from "vitest"

import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates"
import { useEditorKeyboardShortcuts } from "@/features/paywall-editor/hooks/use-editor-keyboard-shortcuts"
import type { EditorKeyboardShortcutHandlers } from "@/features/paywall-editor/hooks/use-editor-keyboard-shortcuts"
import {
  EditorStoreProvider,
  useEditorActions,
  useEditorStore,
} from "@/features/paywall-editor/stores/editor-store-context"
import { findNode } from "@/features/paywall-editor/utils/document-tree"

const ORIGINAL_HEADLINE = "Build a paywall people understand"
const EDITED_HEADLINE = "Edited headline"

function ShortcutHarness({ handlers = {} }: { handlers?: EditorKeyboardShortcutHandlers }) {
  const { document } = useEditorStore()
  const actions = useEditorActions()
  useEditorKeyboardShortcuts(handlers)

  useEffect(() => {
    if (document) return
    const template = EDITOR_TEMPLATES[0]
    if (!template) throw new Error("Missing shortcut test template")
    actions.loadTemplate(template.document)
    actions.selectComponent("headline")
    actions.updateComponent("headline", (node) =>
      node.type === "text" ? { ...node, value: { ...node.value, default: EDITED_HEADLINE } } : node,
    )
  }, [actions, document])

  const headline = document ? findNode(document, "headline") : null

  return (
    <div>
      <output data-testid="headline">
        {headline?.type === "text" ? headline.value.default : "Loading"}
      </output>
      <output data-testid="component-order">
        {document?.screens[0]?.layout.content.children.map((node) => node.id).join("|") ??
          "Loading"}
      </output>
      <input aria-label="Headline input" defaultValue="Native input history" />
      <input aria-label="Command search" type="search" />
      <textarea aria-label="Body textarea" defaultValue="Native textarea history" />
      <select aria-label="Plan select" defaultValue="monthly">
        <option value="monthly">Monthly</option>
        <option value="yearly">Yearly</option>
      </select>
      <div aria-label="Inline editor" contentEditable role="textbox" suppressContentEditableWarning>
        <span data-testid="contenteditable-child">Inline content</span>
      </div>
      <button type="button" onClick={actions.undo}>
        Prepare redo
      </button>
      <button type="button">Canvas surface</button>
    </div>
  )
}

function renderHarness(handlers: EditorKeyboardShortcutHandlers = {}) {
  render(
    <EditorStoreProvider>
      <ShortcutHarness handlers={handlers} />
    </EditorStoreProvider>,
  )
}

function shortcut(target: Element, init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  })
  fireEvent(target, event)
  return event
}

async function waitForEditedHeadline() {
  await waitFor(() => expect(screen.getByTestId("headline")).toHaveTextContent(EDITED_HEADLINE))
}

function editableTargets() {
  return [
    screen.getByRole("textbox", { name: "Headline input" }),
    screen.getByRole("searchbox", { name: "Command search" }),
    screen.getByRole("textbox", { name: "Body textarea" }),
    screen.getByRole("combobox", { name: "Plan select" }),
    screen.getByTestId("contenteditable-child"),
  ]
}

describe("editor keyboard shortcuts", () => {
  it("leaves undo, delete, and reorder to every focused editing control", async () => {
    renderHarness()
    await waitForEditedHeadline()
    const initialOrder = screen.getByTestId("component-order").textContent

    for (const target of editableTargets()) {
      for (const init of [
        { ctrlKey: true, key: "z" },
        { key: "Delete" },
        { ctrlKey: true, key: "ArrowUp" },
        { ctrlKey: true, key: "ArrowDown" },
      ]) {
        const event = shortcut(target, init)
        expect(event.defaultPrevented).toBe(false)
        expect(screen.getByTestId("headline")).toHaveTextContent(EDITED_HEADLINE)
        expect(screen.getByTestId("component-order")).toHaveTextContent(initialOrder ?? "")
      }
    }
  })

  it("leaves both redo shortcuts to every focused editing control", async () => {
    renderHarness()
    await waitForEditedHeadline()
    fireEvent.click(screen.getByRole("button", { name: "Prepare redo" }))
    expect(screen.getByTestId("headline")).toHaveTextContent(ORIGINAL_HEADLINE)

    for (const target of editableTargets()) {
      for (const init of [
        { ctrlKey: true, key: "y" },
        { ctrlKey: true, key: "z", shiftKey: true },
      ]) {
        const event = shortcut(target, init)
        expect(event.defaultPrevented).toBe(false)
        expect(screen.getByTestId("headline")).toHaveTextContent(ORIGINAL_HEADLINE)
      }
    }
  })

  it("still dispatches document commands from a non-editable surface", async () => {
    renderHarness()
    await waitForEditedHeadline()
    const surface = screen.getByRole("button", { name: "Canvas surface" })
    const initialOrder = screen.getByTestId("component-order").textContent

    expect(shortcut(surface, { ctrlKey: true, key: "z" }).defaultPrevented).toBe(true)
    expect(screen.getByTestId("headline")).toHaveTextContent(ORIGINAL_HEADLINE)

    expect(shortcut(surface, { ctrlKey: true, key: "y" }).defaultPrevented).toBe(true)
    expect(screen.getByTestId("headline")).toHaveTextContent(EDITED_HEADLINE)

    expect(shortcut(surface, { ctrlKey: true, key: "ArrowDown" }).defaultPrevented).toBe(true)
    expect(screen.getByTestId("component-order").textContent).not.toBe(initialOrder)

    expect(shortcut(surface, { altKey: true, shiftKey: true, key: "d" }).defaultPrevented).toBe(
      true,
    )
    const duplicatedOrder = screen.getByTestId("component-order").textContent

    expect(shortcut(surface, { key: "Delete" }).defaultPrevented).toBe(true)
    expect(screen.getByTestId("component-order").textContent).not.toBe(duplicatedOrder)
    expect(screen.getByTestId("headline")).toHaveTextContent(EDITED_HEADLINE)
  })

  it("dispatches every conflict-safe Studio shortcut through one registry", async () => {
    const handlers = {
      onFitCanvas: vi.fn<NonNullable<EditorKeyboardShortcutHandlers["onFitCanvas"]>>(),
      onOpenCommandPalette:
        vi.fn<NonNullable<EditorKeyboardShortcutHandlers["onOpenCommandPalette"]>>(),
      onOpenTool: vi.fn<NonNullable<EditorKeyboardShortcutHandlers["onOpenTool"]>>(),
      onResetZoom: vi.fn<NonNullable<EditorKeyboardShortcutHandlers["onResetZoom"]>>(),
      onToggleAppearance:
        vi.fn<NonNullable<EditorKeyboardShortcutHandlers["onToggleAppearance"]>>(),
      onTogglePanel: vi.fn<NonNullable<EditorKeyboardShortcutHandlers["onTogglePanel"]>>(),
    }
    renderHarness(handlers)
    await waitForEditedHeadline()
    const surface = screen.getByRole("button", { name: "Canvas surface" })

    shortcut(surface, { ctrlKey: true, shiftKey: true, key: "k" })
    shortcut(surface, { key: "g" })
    shortcut(surface, { key: "l" })
    shortcut(surface, { key: "g" })
    shortcut(surface, { key: "c" })
    shortcut(surface, { key: "g" })
    shortcut(surface, { key: "p" })
    shortcut(surface, { key: "g" })
    shortcut(surface, { key: "o" })
    shortcut(surface, { key: "[" })
    shortcut(surface, { key: "]" })
    shortcut(surface, { key: "\\" })
    shortcut(surface, { key: "f" })
    shortcut(surface, { code: "Digit0", key: ")", shiftKey: true })
    shortcut(surface, { key: "A", shiftKey: true })

    expect(handlers.onOpenCommandPalette).toHaveBeenCalledOnce()
    expect(handlers.onOpenTool.mock.calls.map(([tool]) => tool)).toEqual([
      "layers",
      "components",
      "products",
      "localization",
    ])
    expect(handlers.onTogglePanel.mock.calls.map(([panel]) => panel)).toEqual([
      "left",
      "properties",
      "diagnostics",
    ])
    expect(handlers.onFitCanvas).toHaveBeenCalledOnce()
    expect(handlers.onResetZoom).toHaveBeenCalledOnce()
    expect(handlers.onToggleAppearance).toHaveBeenCalledOnce()
  })

  it("does not open commands or start tool chords from editable and search controls", async () => {
    const onOpenCommandPalette = vi.fn()
    const onOpenTool = vi.fn()
    renderHarness({ onOpenCommandPalette, onOpenTool })
    await waitForEditedHeadline()

    for (const target of editableTargets()) {
      expect(shortcut(target, { ctrlKey: true, shiftKey: true, key: "k" }).defaultPrevented).toBe(
        false,
      )
      expect(shortcut(target, { key: "g" }).defaultPrevented).toBe(false)
      expect(shortcut(target, { key: "l" }).defaultPrevented).toBe(false)
    }
    expect(onOpenCommandPalette).not.toHaveBeenCalled()
    expect(onOpenTool).not.toHaveBeenCalled()
  })
})
