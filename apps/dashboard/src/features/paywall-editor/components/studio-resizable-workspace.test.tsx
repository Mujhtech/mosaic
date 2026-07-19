import { readFileSync } from "node:fs"

import { createRef, useEffect } from "react"
import type { ReactNode } from "react"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ResizablePanelImperativeHandle } from "@/components/ui/resizable"
import { TooltipProvider } from "@/components/ui/tooltip"
import {
  StudioResizableWorkspace,
  type StudioResizableWorkspaceHandle,
  type StudioResizableWorkspaceProps,
} from "@/features/paywall-editor/components/studio-resizable-workspace"
import {
  commitCompletedPanelLayout,
  commitUpstreamDoubleClickResult,
  restorePanelPreference,
  restoreWorkspacePanelPreferences,
} from "@/features/paywall-editor/utils/resizable-workspace-layout"
import {
  DEFAULT_STUDIO_WORKSPACE_PREFERENCES,
  STUDIO_WORKSPACE_STORAGE_KEY,
} from "@/features/paywall-editor/constants/studio-workspace"
import type { StudioWorkspaceStorage } from "@/features/paywall-editor/mutations/studio-workspace-persistence"
import { createStudioWorkspaceStore } from "@/features/paywall-editor/stores/studio-workspace-store"
import type { StudioWorkspaceActions } from "@/features/paywall-editor/stores/studio-workspace-store"
import { createEditorStore } from "@/features/paywall-editor/stores/editor-store"
import {
  StudioWorkspaceStoreProvider,
  useStudioWorkspaceActions,
} from "@/features/paywall-editor/stores/studio-workspace-store-context"
import type { StudioWorkspacePreferencesV1 } from "@/features/paywall-editor/types/studio-workspace"

class ResizeObserverStub {
  disconnect() {}
  observe() {}
  unobserve() {}
}

const slotProps = {
  leftPanel: <div>Left panel slot</div>,
  canvas: <div>Canvas slot</div>,
  propertiesPanel: <div>Properties panel slot</div>,
  diagnosticsPanel: <div>Diagnostics panel slot</div>,
  desktopRequiredContent: <button type="button">Export local draft</button>,
  onOpenCommands: vi.fn(),
} as const

function createMemoryStorage(
  preferences: StudioWorkspacePreferencesV1 = DEFAULT_STUDIO_WORKSPACE_PREFERENCES,
) {
  let value: string | null = JSON.stringify(preferences)
  const storage: StudioWorkspaceStorage = {
    getItem: vi.fn((key) => (key === STUDIO_WORKSPACE_STORAGE_KEY ? value : null)),
    setItem: vi.fn((key, nextValue) => {
      if (key === STUDIO_WORKSPACE_STORAGE_KEY) value = nextValue
    }),
    removeItem: vi.fn((key) => {
      if (key === STUDIO_WORKSPACE_STORAGE_KEY) value = null
    }),
  }
  return { storage, read: () => value }
}

function createPanelHandle({
  collapsed = false,
  inPixels = 300,
}: {
  collapsed?: boolean
  inPixels?: number
} = {}): ResizablePanelImperativeHandle {
  return {
    collapse: vi.fn(),
    expand: vi.fn(),
    getSize: vi.fn(() => ({ asPercentage: 25, inPixels })),
    isCollapsed: vi.fn(() => collapsed),
    resize: vi.fn(),
  }
}

function renderWorkspace(
  viewportMode: StudioResizableWorkspaceProps["viewportMode"],
  options: {
    children?: ReactNode
    storage?: StudioWorkspaceStorage | null
    slots?: Partial<StudioResizableWorkspaceProps>
  } = {},
) {
  return render(
    <TooltipProvider>
      <StudioWorkspaceStoreProvider storage={options.storage ?? null}>
        {options.children}
        <StudioResizableWorkspace {...slotProps} {...options.slots} viewportMode={viewportMode} />
      </StudioWorkspaceStoreProvider>
    </TooltipProvider>,
  )
}

function childIds(element: HTMLElement) {
  return Array.from(element.children, (child) => child.id)
}

function WorkspaceActionsCapture({
  capture,
}: {
  capture: (actions: StudioWorkspaceActions) => void
}) {
  const actions = useStudioWorkspaceActions()
  useEffect(() => {
    capture(actions)
  }, [actions, capture])
  return null
}

describe("StudioResizableWorkspace", () => {
  beforeEach(() => vi.stubGlobal("ResizeObserver", ResizeObserverStub))
  afterEach(() => vi.unstubAllGlobals())

  it.each(["large", "medium"] as const)(
    "renders the exact nested desktop structure in %s mode",
    (viewportMode) => {
      renderWorkspace(viewportMode)

      const workspace = screen.getByTestId("studio-resizable-workspace")
      const rail = screen.getByRole("navigation", { name: "Studio activity" })
      const rootGroup = screen.getByTestId("studio-root-group")
      const horizontalGroup = screen.getByTestId("studio-horizontal-group")

      expect(workspace).toHaveAttribute("data-studio-viewport-mode", viewportMode)
      expect(workspace.firstElementChild).toBe(rail)
      expect(rail).toHaveAttribute("data-rail-width", "52")
      expect(rail.contains(rootGroup)).toBe(false)
      expect(childIds(rootGroup)).toEqual([
        "studio-main-panel",
        "studio-diagnostics-handle",
        "studio-diagnostics-panel",
      ])
      expect(childIds(horizontalGroup)).toEqual([
        "studio-left-panel",
        "studio-left-handle",
        "studio-canvas-panel",
        "studio-right-handle",
        "studio-properties-panel",
      ])
    },
  )

  it("uses explicit unit props and imports the resizable implementation only through its wrapper", () => {
    renderWorkspace("large")

    const source = readFileSync(
      "src/features/paywall-editor/components/studio-resizable-workspace.tsx",
      "utf8",
    )
    expect(source).toContain('defaultSize="300px"')
    expect(source).toContain('minSize="240px"')
    expect(source).toContain('maxSize="440px"')
    expect(source).toContain('collapsedSize="0px"')
    expect(source).toContain('defaultSize="360px"')
    expect(source).toContain('minSize="420px"')
    expect(source).toContain('defaultSize="220px"')
    expect(source).toContain('collapsedSize="32px"')
    expect(source).toContain('maxSize="45vh"')
    expect(source).not.toContain("react-resizable-panels")
    expect(source).not.toMatch(/onLayoutChange=/)

    expect(screen.getByTestId("studio-left-panel")).toHaveAttribute("data-default-size", "300px")
    expect(screen.getByTestId("studio-canvas-panel")).toHaveAttribute(
      "data-canvas-min-width",
      "420px",
    )
  })

  it("restores a valid persisted preference through panel APIs without persistence", () => {
    const memory = createMemoryStorage()
    const handle = createPanelHandle({ inPixels: 300 })

    restorePanelPreference(handle, { size: 400, collapsed: true })

    expect(handle.resize).toHaveBeenCalledOnce()
    expect(handle.resize).toHaveBeenCalledWith("400px")
    expect(handle.collapse).toHaveBeenCalledOnce()
    expect(handle.expand).not.toHaveBeenCalled()
    expect(memory.storage.setItem).not.toHaveBeenCalled()
  })

  it("defers an all-panel restore until zero geometry becomes ready, then applies once", () => {
    let ready = false
    const leftHandle = createPanelHandle()
    vi.mocked(leftHandle.getSize).mockImplementation(() => ({
      asPercentage: ready ? 25 : 0,
      inPixels: ready ? 300 : 0,
    }))
    const propertiesHandle = createPanelHandle({ inPixels: 360 })
    const diagnosticsHandle = createPanelHandle({ inPixels: 220 })

    const input = {
      diagnosticsPanelHandle: diagnosticsHandle,
      includeProperties: true,
      leftPanelHandle: leftHandle,
      preferences: DEFAULT_STUDIO_WORKSPACE_PREFERENCES.panels,
      propertiesPanelHandle: propertiesHandle,
    }

    expect(restoreWorkspacePanelPreferences(input)).toBe(false)
    expect(leftHandle.resize).not.toHaveBeenCalled()
    expect(propertiesHandle.resize).not.toHaveBeenCalled()
    expect(diagnosticsHandle.resize).not.toHaveBeenCalled()

    ready = true
    expect(restoreWorkspacePanelPreferences(input)).toBe(true)
    expect(leftHandle.resize).toHaveBeenCalledOnce()
    expect(propertiesHandle.resize).toHaveBeenCalledOnce()
    expect(diagnosticsHandle.resize).toHaveBeenCalledOnce()
  })

  it("commits completed expanded and collapsed layouts atomically and rejects invalid pixels", () => {
    const memory = createMemoryStorage()
    const store = createStudioWorkspaceStore({ storage: memory.storage })
    const expandedHandle = createPanelHandle({ inPixels: 340 })

    expect(
      commitCompletedPanelLayout({
        actions: store,
        meta: { isUserInteraction: false },
        panel: "left",
        panelHandle: expandedHandle,
        preference: store.getSnapshot().preferences.panels.left,
      }),
    ).toBe(false)
    expect(memory.storage.setItem).not.toHaveBeenCalled()

    expect(
      commitCompletedPanelLayout({
        actions: store,
        meta: { isUserInteraction: true },
        panel: "left",
        panelHandle: expandedHandle,
        preference: store.getSnapshot().preferences.panels.left,
      }),
    ).toBe(true)
    expect(memory.storage.setItem).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot().preferences.panels.left).toEqual({
      size: 340,
      collapsed: false,
    })

    const collapsedHandle = createPanelHandle({ collapsed: true, inPixels: 0 })
    expect(
      commitCompletedPanelLayout({
        actions: store,
        meta: { isUserInteraction: true },
        panel: "left",
        panelHandle: collapsedHandle,
        preference: store.getSnapshot().preferences.panels.left,
      }),
    ).toBe(true)
    expect(memory.storage.setItem).toHaveBeenCalledTimes(2)
    expect(store.getSnapshot().preferences.panels.left).toEqual({
      size: 340,
      collapsed: true,
    })

    const invalidHandle = createPanelHandle({ inPixels: 239 })
    expect(
      commitCompletedPanelLayout({
        actions: store,
        meta: { isUserInteraction: true },
        panel: "left",
        panelHandle: invalidHandle,
        preference: store.getSnapshot().preferences.panels.left,
      }),
    ).toBe(false)
    expect(memory.storage.setItem).toHaveBeenCalledTimes(2)
  })

  it("uses the activity rail to collapse, expand, and select another tool", async () => {
    const memory = createMemoryStorage()
    renderWorkspace("large", { storage: memory.storage })

    const layers = screen.getByRole("button", { name: "Layers" })
    fireEvent.click(layers)
    await waitFor(() =>
      expect(layers).toHaveAttribute("title", "Layers — expand tool panel (G then L)"),
    )
    expect(JSON.parse(memory.read() ?? "null").panels.left.collapsed).toBe(true)

    fireEvent.click(layers)
    await waitFor(() =>
      expect(layers).toHaveAttribute("title", "Layers — collapse tool panel (G then L)"),
    )
    expect(JSON.parse(memory.read() ?? "null").panels.left.collapsed).toBe(false)

    fireEvent.click(layers)
    await waitFor(() =>
      expect(layers).toHaveAttribute("title", "Layers — expand tool panel (G then L)"),
    )
    fireEvent.click(screen.getByRole("button", { name: "Components" }))

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Components" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    )
    const persisted = JSON.parse(memory.read() ?? "null")
    expect(persisted.selectedTool).toBe("components")
    expect(persisted.panels.left.collapsed).toBe(false)
  })

  it("exposes atomic React 19 controller commands without touching editor state", () => {
    const memory = createMemoryStorage()
    const controller = createRef<StudioResizableWorkspaceHandle>()
    const editorStore = createEditorStore()
    const editorSnapshot = editorStore.getSnapshot()
    renderWorkspace("large", { storage: memory.storage, slots: { ref: controller } })

    let result = false
    act(() => {
      result = controller.current?.collapse("left") ?? false
    })
    expect(result).toBe(true)
    expect(memory.storage.setItem).toHaveBeenCalledTimes(1)

    act(() => {
      result = controller.current?.collapse("left") ?? true
    })
    expect(result).toBe(false)
    expect(memory.storage.setItem).toHaveBeenCalledTimes(1)

    act(() => {
      result = controller.current?.expand("left") ?? false
    })
    expect(result).toBe(true)
    act(() => {
      result = controller.current?.toggle("left") ?? false
    })
    expect(result).toBe(true)
    act(() => {
      result = controller.current?.collapse("properties") ?? false
    })
    expect(result).toBe(true)
    act(() => {
      result = controller.current?.collapse("diagnostics") ?? false
    })
    expect(result).toBe(true)
    expect(memory.storage.setItem).toHaveBeenCalledTimes(5)
    expect(editorStore.getSnapshot()).toBe(editorSnapshot)
  })

  it("truthfully controls the compact Properties sheet without touching editor or persistence", async () => {
    const memory = createMemoryStorage()
    const controller = createRef<StudioResizableWorkspaceHandle>()
    const editorStore = createEditorStore()
    const editorSnapshot = editorStore.getSnapshot()
    renderWorkspace("compact", { storage: memory.storage, slots: { ref: controller } })

    let result = true
    act(() => {
      result = controller.current?.collapse("properties") ?? true
    })
    expect(result).toBe(false)
    expect(memory.storage.setItem).not.toHaveBeenCalled()

    act(() => {
      result = controller.current?.expand("properties") ?? false
    })
    expect(result).toBe(true)
    expect(await screen.findByRole("dialog", { name: "Properties" })).toBeVisible()

    act(() => {
      result = controller.current?.expand("properties") ?? true
    })
    expect(result).toBe(false)

    act(() => {
      result = controller.current?.toggle("properties") ?? false
    })
    expect(result).toBe(true)
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Properties" })).toBeNull())

    act(() => {
      result = controller.current?.toggle("properties") ?? false
    })
    expect(result).toBe(true)
    expect(await screen.findByRole("dialog", { name: "Properties" })).toBeVisible()

    act(() => {
      result = controller.current?.collapse("properties") ?? false
    })
    expect(result).toBe(true)
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Properties" })).toBeNull())
    expect(memory.storage.setItem).not.toHaveBeenCalled()
    expect(editorStore.getSnapshot()).toBe(editorSnapshot)

    act(() => {
      expect(controller.current?.collapse("left")).toBe(true)
      expect(controller.current?.collapse("diagnostics")).toBe(true)
    })
    expect(memory.storage.setItem).toHaveBeenCalledTimes(2)
  })

  it("resets storage and synchronizes canonical live layouts for repeated and external resets", async () => {
    const preferences: StudioWorkspacePreferencesV1 = {
      ...DEFAULT_STUDIO_WORKSPACE_PREFERENCES,
      panels: {
        left: { size: 400, collapsed: true },
        properties: { size: 500, collapsed: true },
        diagnostics: { size: 300, collapsed: true },
      },
    }
    const memory = createMemoryStorage(preferences)
    const controller = createRef<StudioResizableWorkspaceHandle>()
    let capturedActions: StudioWorkspaceActions | null = null
    renderWorkspace("large", {
      children: <WorkspaceActionsCapture capture={(actions) => (capturedActions = actions)} />,
      storage: memory.storage,
      slots: { ref: controller },
    })

    act(() => {
      expect(controller.current?.reset()).toBe(true)
    })
    await waitFor(() =>
      expect(screen.getByTestId("studio-resizable-workspace")).toHaveAttribute(
        "data-workspace-persistence-operation",
        "reset",
      ),
    )
    expect(memory.storage.removeItem).toHaveBeenCalledTimes(1)
    expect(memory.read()).toBeNull()
    expect(screen.getByRole("button", { name: "Layers" })).toHaveAttribute(
      "title",
      "Layers — collapse tool panel (G then L)",
    )

    act(() => {
      controller.current?.reset()
    })
    expect(memory.storage.removeItem).toHaveBeenCalledTimes(2)

    act(() => {
      capturedActions?.resetWorkspace()
    })
    expect(memory.storage.removeItem).toHaveBeenCalledTimes(3)

    const leftHandle = createPanelHandle({ inPixels: 300 })
    const propertiesHandle = createPanelHandle({ inPixels: 360 })
    const diagnosticsHandle = createPanelHandle({ inPixels: 220 })
    const resetInput = {
      diagnosticsPanelHandle: diagnosticsHandle,
      includeProperties: true,
      leftPanelHandle: leftHandle,
      preferences: DEFAULT_STUDIO_WORKSPACE_PREFERENCES.panels,
      propertiesPanelHandle: propertiesHandle,
    }
    expect(restoreWorkspacePanelPreferences(resetInput)).toBe(true)
    expect(restoreWorkspacePanelPreferences(resetInput)).toBe(true)
    expect(leftHandle.resize).toHaveBeenNthCalledWith(1, "300px")
    expect(propertiesHandle.resize).toHaveBeenNthCalledWith(1, "360px")
    expect(diagnosticsHandle.resize).toHaveBeenNthCalledWith(1, "220px")
    expect(leftHandle.resize).toHaveBeenCalledTimes(2)
    expect(leftHandle.expand).toHaveBeenCalledTimes(2)
  })

  it("keeps stable slot identities from rerendering during workspace-only updates", async () => {
    const recordRender = vi.fn<(name: "left" | "canvas" | "properties" | "diagnostics") => void>()

    function Slot({ name }: { name: "left" | "canvas" | "properties" | "diagnostics" }) {
      recordRender(name)
      return <div>{name} content</div>
    }

    const slots = {
      leftPanel: <Slot name="left" />,
      canvas: <Slot name="canvas" />,
      propertiesPanel: <Slot name="properties" />,
      diagnosticsPanel: <Slot name="diagnostics" />,
    }
    renderWorkspace("large", { slots })
    expect(recordRender.mock.calls.map(([name]) => name).sort()).toEqual([
      "canvas",
      "diagnostics",
      "left",
      "properties",
    ])

    fireEvent.click(screen.getByRole("button", { name: "Components" }))
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Components" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    )
    expect(recordRender).toHaveBeenCalledTimes(4)
  })

  it("keeps properties outside the compact group while retaining diagnostics persistence", () => {
    const memory = createMemoryStorage()
    const store = createStudioWorkspaceStore({ storage: memory.storage })
    renderWorkspace("compact")

    expect(childIds(screen.getByTestId("studio-horizontal-group"))).toEqual([
      "studio-left-panel",
      "studio-left-handle",
      "studio-canvas-panel",
    ])
    expect(screen.queryByTestId("studio-properties-panel")).not.toBeInTheDocument()

    expect(
      commitCompletedPanelLayout({
        actions: store,
        meta: { isUserInteraction: true },
        panel: "diagnostics",
        panelHandle: createPanelHandle({ inPixels: 260 }),
        preference: store.getSnapshot().preferences.panels.diagnostics,
      }),
    ).toBe(true)
    expect(store.getSnapshot().preferences.panels.diagnostics.size).toBe(260)
    expect(memory.storage.setItem).toHaveBeenCalledOnce()
  })

  it("persists canonical upstream double-click results without intercepting the separator event", async () => {
    const preferences: StudioWorkspacePreferencesV1 = {
      ...DEFAULT_STUDIO_WORKSPACE_PREFERENCES,
      panels: {
        left: { size: 400, collapsed: false },
        properties: { size: 500, collapsed: false },
        diagnostics: { size: 300, collapsed: false },
      },
    }
    const adapterMemory = createMemoryStorage(preferences)
    const adapterStore = createStudioWorkspaceStore({ storage: adapterMemory.storage })

    for (const [panel, inPixels] of [
      ["left", 300],
      ["properties", 360],
      ["diagnostics", 220],
    ] as const) {
      expect(
        commitUpstreamDoubleClickResult({
          actions: adapterStore,
          panel,
          panelHandle: createPanelHandle({ inPixels }),
          preference: adapterStore.getSnapshot().preferences.panels[panel],
        }),
      ).toBe(true)
    }
    expect(adapterMemory.storage.setItem).toHaveBeenCalledTimes(3)
    expect(adapterStore.getSnapshot().preferences.panels).toEqual(
      DEFAULT_STUDIO_WORKSPACE_PREFERENCES.panels,
    )

    const memory = createMemoryStorage(preferences)
    renderWorkspace("large", { storage: memory.storage })
    const leftPanel = screen.getByTestId("studio-left-panel")
    Object.defineProperty(leftPanel, "offsetWidth", {
      configurable: true,
      get: () => 300,
    })

    fireEvent.doubleClick(screen.getByRole("separator", { name: "Resize Studio tools and canvas" }))
    await waitFor(() => expect(memory.storage.setItem).toHaveBeenCalledTimes(1))
    expect(JSON.parse(memory.read() ?? "null").panels.left).toEqual({
      size: 300,
      collapsed: false,
    })

    const source = readFileSync(
      "src/features/paywall-editor/components/studio-resizable-workspace.tsx",
      "utf8",
    )
    expect(source).not.toContain("preventDefault")
    expect(source).not.toContain("stopPropagation")
    expect(source).not.toContain("disableDoubleClick")
    const helperSource = source.slice(
      source.indexOf("function scheduleDoubleClickPanelCommit"),
      source.indexOf("const getPanelHandle"),
    )
    expect(helperSource).not.toContain(".resize(")
  })

  it("provides compact properties through a Sheet and keeps the desktop-required safe state", async () => {
    const view = renderWorkspace("compact")
    expect(screen.queryByText("Properties panel slot")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Properties" }))
    const sheet = await screen.findByRole("dialog", { name: "Properties" })
    expect(within(sheet).getByText("Properties panel slot")).toBeVisible()
    fireEvent.click(within(sheet).getByRole("button", { name: "Close" }))
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Properties" })).toBeNull())

    view.rerender(
      <TooltipProvider>
        <StudioWorkspaceStoreProvider storage={null}>
          <StudioResizableWorkspace {...slotProps} viewportMode="desktop-required" />
        </StudioWorkspaceStoreProvider>
      </TooltipProvider>,
    )
    expect(
      within(screen.getByRole("region", { name: "Studio requires a larger screen" })).getByRole(
        "button",
        { name: "Export local draft" },
      ),
    ).toBeVisible()
    expect(screen.queryByTestId("studio-root-group")).not.toBeInTheDocument()
  })
})
