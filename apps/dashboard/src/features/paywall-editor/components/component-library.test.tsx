import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useLayoutEffect } from "react"
import { describe, expect, it } from "vitest"

import {
  COMPONENT_LIBRARY_COUNTDOWN_ENDS_AT_DRAG_TYPE,
  COMPONENT_LIBRARY_DRAG_TYPE,
} from "@/features/paywall-editor/components/component-catalog"
import { ComponentLibrary } from "@/features/paywall-editor/components/component-library"
import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates"
import {
  EditorStoreProvider,
  useEditorActions,
  useEditorStore,
} from "@/features/paywall-editor/stores/editor-store-context"
import type { StudioWorkspaceSnapshot } from "@/features/paywall-editor/stores/studio-workspace-store"
import {
  StudioWorkspaceStoreProvider,
  useStudioWorkspaceSelector,
} from "@/features/paywall-editor/stores/studio-workspace-store-context"
import { flattenDocument } from "@/features/paywall-editor/utils/document-tree"

const selectRecentInsertions = (snapshot: StudioWorkspaceSnapshot) =>
  snapshot.preferences.recentInsertions

function InitializeDocument({ withoutSelector = false }: { withoutSelector?: boolean }) {
  const editor = useEditorActions()

  useLayoutEffect(() => {
    if (editor.getSnapshot().document) return
    const source = EDITOR_TEMPLATES[0]!.document
    editor.loadTemplate(
      withoutSelector
        ? {
            ...source,
            screens: source.screens.map((screen) => ({
              ...screen,
              layout: {
                ...screen.layout,
                content: {
                  ...screen.layout.content,
                  children: screen.layout.content.children.filter(
                    (node) => node.type !== "productSelector",
                  ),
                },
              },
            })),
          }
        : source,
    )
  }, [editor, withoutSelector])

  return null
}

function LibraryProbe() {
  const { document, undoStack } = useEditorStore()
  const recentInsertions = useStudioWorkspaceSelector(selectRecentInsertions)
  const nodes = document ? flattenDocument(document).map((entry) => entry.node) : []
  const buttons = nodes.filter((node) => node.type === "button")
  const countdowns = nodes.flatMap((node) => (node.type === "countdown" ? [node.endsAt] : []))

  return (
    <div>
      <output data-testid="node-types">{nodes.map((node) => node.type).join("|")}</output>
      <output data-testid="buttons">{buttons.map((node) => node.id).join("|")}</output>
      <output data-testid="countdowns">{countdowns.join("|")}</output>
      <output data-testid="recent-insertions">{recentInsertions.join("|")}</output>
      <output data-testid="undo-count">{undoStack.length}</output>
    </div>
  )
}

function renderLibrary(withoutSelector = false) {
  render(
    <StudioWorkspaceStoreProvider storage={null}>
      <EditorStoreProvider>
        <InitializeDocument withoutSelector={withoutSelector} />
        <ComponentLibrary />
        <LibraryProbe />
      </EditorStoreProvider>
    </StudioWorkspaceStoreProvider>,
  )
}

function catalogCard(label: string) {
  return screen.getByRole("button", { name: new RegExp(`^${label}\\b`, "i") })
}

function createDataTransfer() {
  const values = new Map<string, string>()
  return {
    dropEffect: "none",
    effectAllowed: "uninitialized",
    getData: (type: string) => values.get(type) ?? "",
    setData: (type: string, value: string) => values.set(type, value),
    get types() {
      return [...values.keys()]
    },
  } as unknown as DataTransfer
}

describe("ComponentLibrary", () => {
  it("inserts the keyboard-targeted type and records that exact type as recent", async () => {
    renderLibrary()
    await waitFor(() => expect(screen.getByRole("button", { name: "Insert Text" })).toBeEnabled())

    fireEvent.keyDown(catalogCard("Image"), { key: "Enter" })

    await waitFor(() => expect(screen.getByTestId("recent-insertions")).toHaveTextContent("image"))
    expect(screen.getByTestId("node-types")).toHaveTextContent("image")
    expect(screen.getByText("Image inserted")).toBeVisible()
  })

  it("inserts a generic Button immediately and records the protocol type", async () => {
    renderLibrary()
    await waitFor(() => expect(catalogCard("Button")).toBeVisible())
    const initialButtons = screen.getByTestId("buttons").textContent?.split("|").filter(Boolean)

    fireEvent.doubleClick(catalogCard("Button"))

    await waitFor(() => expect(screen.getByTestId("undo-count")).toHaveTextContent("1"))
    expect(screen.getByTestId("buttons").textContent?.split("|")).toHaveLength(
      (initialButtons?.length ?? 0) + 1,
    )
    expect(screen.getByTestId("recent-insertions")).toHaveTextContent("button")
    expect(screen.getByText("Button inserted")).toBeVisible()
  })

  it("allows a generic Button even when the document has no Product Selector", async () => {
    renderLibrary(true)
    await waitFor(() => expect(catalogCard("Button")).toBeVisible())

    fireEvent.doubleClick(catalogCard("Button"))

    await waitFor(() => expect(screen.getByTestId("undo-count")).toHaveTextContent("1"))
    expect(screen.getByText("Button inserted")).toBeVisible()
  })

  it("requires a valid explicit Countdown deadline before insertion or dragging", async () => {
    renderLibrary()
    await waitFor(() => expect(catalogCard("Countdown")).toBeVisible())

    fireEvent.click(catalogCard("Countdown"))
    expect(screen.getByRole("button", { name: "Insert Countdown" })).toBeDisabled()
    expect(catalogCard("Countdown")).toHaveAttribute("draggable", "false")
    fireEvent.doubleClick(catalogCard("Countdown"))
    expect(screen.getByText("Countdown needs a valid deadline.")).toBeVisible()
    expect(screen.getByTestId("countdowns")).toBeEmptyDOMElement()
    expect(screen.getByTestId("undo-count")).toHaveTextContent("0")

    fireEvent.change(screen.getByLabelText("Deadline (UTC)"), {
      target: { value: "2000-01-01T00:00:00" },
    })
    expect(screen.getByRole("button", { name: "Insert Countdown" })).toBeEnabled()
    expect(catalogCard("Countdown")).toHaveAttribute("draggable", "true")

    const transfer = createDataTransfer()
    fireEvent.dragStart(catalogCard("Countdown"), { dataTransfer: transfer })
    expect(transfer.getData(COMPONENT_LIBRARY_DRAG_TYPE)).toBe("countdown")
    expect(transfer.getData(COMPONENT_LIBRARY_COUNTDOWN_ENDS_AT_DRAG_TYPE)).toBe(
      "2000-01-01T00:00:00Z",
    )

    fireEvent.click(screen.getByRole("button", { name: "Insert Countdown" }))
    await waitFor(() =>
      expect(screen.getByTestId("countdowns")).toHaveTextContent("2000-01-01T00:00:00Z"),
    )
    expect(screen.getByTestId("undo-count")).toHaveTextContent("1")
    expect(screen.getByText("Countdown inserted")).toBeVisible()
  })

  it("emits exact protocol component types in drag payloads", async () => {
    renderLibrary()
    await waitFor(() => expect(catalogCard("Text")).toBeVisible())
    const textTransfer = createDataTransfer()

    fireEvent.dragStart(catalogCard("Text"), { dataTransfer: textTransfer })
    expect(textTransfer.getData(COMPONENT_LIBRARY_DRAG_TYPE)).toBe("text")

    const buttonTransfer = createDataTransfer()
    fireEvent.dragStart(catalogCard("Button"), { dataTransfer: buttonTransfer })

    expect(buttonTransfer.getData(COMPONENT_LIBRARY_DRAG_TYPE)).toBe("button")
  })
})
