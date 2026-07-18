import { act, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import {
  useStudioWorkspaceActions,
  useStudioWorkspaceSelector,
  StudioWorkspaceStoreProvider,
} from "@/features/paywall-editor/stores/studio-workspace-store-context"
import type {
  StudioWorkspaceActions,
  StudioWorkspaceSnapshot,
} from "@/features/paywall-editor/stores/studio-workspace-store"
import type { StudioWorkspaceStorage } from "@/features/paywall-editor/mutations/studio-workspace-persistence"

const selectTool = (snapshot: StudioWorkspaceSnapshot) => snapshot.preferences.selectedTool
const selectLeftSize = (snapshot: StudioWorkspaceSnapshot) => snapshot.preferences.panels.left.size
const selectCanvasIdentity = (snapshot: StudioWorkspaceSnapshot) => ({
  device: snapshot.preferences.canvas.device,
  orientation: snapshot.preferences.canvas.orientation,
})
const canvasIdentityEqual = (
  left: ReturnType<typeof selectCanvasIdentity>,
  right: ReturnType<typeof selectCanvasIdentity>,
) => left.device === right.device && left.orientation === right.orientation

describe("Studio workspace store context", () => {
  it("isolates primitive and equality-selected consumers from unrelated updates", () => {
    let actions: StudioWorkspaceActions | null = null
    let actionConsumerRenders = 0
    let toolRenders = 0
    let sizeRenders = 0
    let canvasIdentityRenders = 0

    function ActionConsumer() {
      actionConsumerRenders += 1
      actions = useStudioWorkspaceActions()
      return null
    }

    function ToolConsumer() {
      toolRenders += 1
      return <span data-testid="tool">{useStudioWorkspaceSelector(selectTool)}</span>
    }

    function SizeConsumer() {
      sizeRenders += 1
      return <span data-testid="left-size">{useStudioWorkspaceSelector(selectLeftSize)}</span>
    }

    function CanvasIdentityConsumer() {
      canvasIdentityRenders += 1
      const identity = useStudioWorkspaceSelector(selectCanvasIdentity, canvasIdentityEqual)
      return (
        <span data-testid="canvas-identity">{identity.device + ":" + identity.orientation}</span>
      )
    }

    render(
      <StudioWorkspaceStoreProvider storage={null}>
        <ActionConsumer />
        <ToolConsumer />
        <SizeConsumer />
        <CanvasIdentityConsumer />
      </StudioWorkspaceStoreProvider>,
    )

    function currentActions() {
      if (!actions) throw new Error("Expected Studio workspace actions")
      return actions
    }

    expect(actionConsumerRenders).toBe(1)
    expect(toolRenders).toBe(1)
    expect(sizeRenders).toBe(1)
    expect(canvasIdentityRenders).toBe(1)

    act(() => {
      currentActions().commitPanelSize("left", 340)
    })
    expect(screen.getByTestId("left-size")).toHaveTextContent("340")
    expect(actionConsumerRenders).toBe(1)
    expect(toolRenders).toBe(1)
    expect(sizeRenders).toBe(2)
    expect(canvasIdentityRenders).toBe(1)

    act(() => {
      currentActions().setCanvasPreference("zoom", 1.5)
    })
    expect(canvasIdentityRenders).toBe(1)
    expect(toolRenders).toBe(1)
    expect(sizeRenders).toBe(2)

    act(() => {
      currentActions().setCanvasPreference("orientation", "landscape")
    })
    expect(screen.getByTestId("canvas-identity")).toHaveTextContent("iphone-17-pro:landscape")
    expect(canvasIdentityRenders).toBe(2)
    expect(toolRenders).toBe(1)

    act(() => {
      currentActions().setSelectedTool("products")
    })
    expect(screen.getByTestId("tool")).toHaveTextContent("products")
    expect(toolRenders).toBe(2)
    expect(sizeRenders).toBe(2)
    expect(canvasIdentityRenders).toBe(2)
    expect(actionConsumerRenders).toBe(1)
  })

  it("creates one store per provider mount and reads storage only once", () => {
    const storage: StudioWorkspaceStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    }
    const replacementStorage: StudioWorkspaceStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    }
    let actions: StudioWorkspaceActions | null = null

    function ActionConsumer() {
      actions = useStudioWorkspaceActions()
      return null
    }

    const view = render(
      <StudioWorkspaceStoreProvider storage={storage}>
        <ActionConsumer />
      </StudioWorkspaceStoreProvider>,
    )
    const firstActions = actions
    expect(storage.getItem).toHaveBeenCalledTimes(1)

    view.rerender(
      <StudioWorkspaceStoreProvider storage={replacementStorage}>
        <ActionConsumer />
      </StudioWorkspaceStoreProvider>,
    )
    expect(actions).toBe(firstActions)
    expect(storage.getItem).toHaveBeenCalledTimes(1)
    expect(replacementStorage.getItem).not.toHaveBeenCalled()

    view.unmount()
    render(
      <StudioWorkspaceStoreProvider storage={replacementStorage}>
        <ActionConsumer />
      </StudioWorkspaceStoreProvider>,
    )
    expect(replacementStorage.getItem).toHaveBeenCalledTimes(1)
    expect(actions).not.toBe(firstActions)
  })
})
