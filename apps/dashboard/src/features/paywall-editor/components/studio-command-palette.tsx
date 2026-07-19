import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/ssr/ArrowCounterClockwise"
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/ssr/ArrowClockwise"
import { CommandIcon } from "@phosphor-icons/react/dist/ssr/Command"
import { CopyIcon } from "@phosphor-icons/react/dist/ssr/Copy"
import { CornersOutIcon } from "@phosphor-icons/react/dist/ssr/CornersOut"
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/ssr/DownloadSimple"
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/ssr/MagnifyingGlass"
import { PlusIcon } from "@phosphor-icons/react/dist/ssr/Plus"
import { SidebarSimpleIcon } from "@phosphor-icons/react/dist/ssr/SidebarSimple"
import { SlidersHorizontalIcon } from "@phosphor-icons/react/dist/ssr/SlidersHorizontal"
import { TrashIcon } from "@phosphor-icons/react/dist/ssr/Trash"
import { UploadSimpleIcon } from "@phosphor-icons/react/dist/ssr/UploadSimple"
import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr/WarningCircle"
import { XIcon } from "@phosphor-icons/react/dist/ssr/X"
import { useRef, useState } from "react"
import type { KeyboardEvent, ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { COMPONENT_CATALOG } from "@/features/paywall-editor/components/component-catalog"
import { useEditorHistory } from "@/features/paywall-editor/hooks/use-editor-history"
import { STUDIO_SHORTCUT_HINTS } from "@/features/paywall-editor/hooks/use-editor-keyboard-shortcuts"
import { useEditorActions } from "@/features/paywall-editor/stores/editor-store-context"
import type { StudioWorkspaceSnapshot } from "@/features/paywall-editor/stores/studio-workspace-store"
import {
  useStudioWorkspaceActions,
  useStudioWorkspaceSelector,
} from "@/features/paywall-editor/stores/studio-workspace-store-context"
import type {
  InsertableBlockType,
  MosaicDocument,
  TreeOperationResult,
} from "@/features/paywall-editor/types/editor"
import type { StudioTool } from "@/features/paywall-editor/types/studio-workspace"
import {
  findAncestorNodeIds,
  findNode,
  resolveLegacyInsertionLocation,
} from "@/features/paywall-editor/utils/document-tree"
import { cn } from "@/lib/utils"

type CommandGroup = "Add content" | "Navigate" | "Edit" | "Canvas" | "Workspace" | "File"
type CommandIconName = "add" | "navigate" | "edit" | "canvas" | "workspace" | "file"

interface StudioCommand {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly group: CommandGroup
  readonly icon: CommandIconName
  readonly keywords?: readonly string[]
  readonly shortcut?: string
  readonly disabled?: boolean
  readonly disabledReason?: string
  readonly run: () => boolean | void
}

export interface StudioCommandPaletteProps {
  readonly onExport: () => void
  readonly onOpenChange: (open: boolean) => void
  readonly onRequestImport: () => void
  readonly onWorkspaceCommand: (command: StudioWorkspaceCommand) => void
  readonly open: boolean
}

export type StudioWorkspaceCommand =
  "expand-left" | "toggle-left" | "toggle-properties" | "toggle-diagnostics" | "reset"

const selectWorkspacePreferences = (snapshot: StudioWorkspaceSnapshot) => snapshot.preferences
const COMMAND_GROUP_IDS: Readonly<Record<CommandGroup, string>> = Object.freeze({
  "Add content": "studio-command-group-add-content",
  Navigate: "studio-command-group-navigate",
  Edit: "studio-command-group-edit",
  Canvas: "studio-command-group-canvas",
  Workspace: "studio-command-group-workspace",
  File: "studio-command-group-file",
})
const TOOL_SHORTCUTS: Partial<Record<StudioTool, string>> = Object.freeze({
  layers: STUDIO_SHORTCUT_HINTS.openLayers,
  components: STUDIO_SHORTCUT_HINTS.openComponents,
  products: STUDIO_SHORTCUT_HINTS.openProducts,
  localization: STUDIO_SHORTCUT_HINTS.openLocalization,
})

function PaletteIcon({ name }: { readonly name: CommandIconName }) {
  switch (name) {
    case "add":
      return <PlusIcon aria-hidden />
    case "navigate":
      return <SidebarSimpleIcon aria-hidden />
    case "edit":
      return <CopyIcon aria-hidden />
    case "canvas":
      return <CornersOutIcon aria-hidden />
    case "workspace":
      return <SlidersHorizontalIcon aria-hidden />
    case "file":
      return <DownloadSimpleIcon aria-hidden />
  }
}

function insertionBlockedByLock(
  document: MosaicDocument,
  parentId: string,
  lockedIds: readonly string[],
) {
  const locked = new Set(lockedIds)
  return (
    locked.has(parentId) ||
    findAncestorNodeIds(document, parentId).some((ancestorId) => locked.has(ancestorId))
  )
}

function commandMatches(command: StudioCommand, query: string) {
  if (!query) return true
  const haystack = [command.label, command.description, command.group, ...(command.keywords ?? [])]
    .join(" ")
    .toLocaleLowerCase()
  return haystack.includes(query)
}

function commandIconForEdit(commandId: string): ReactNode {
  if (commandId === "undo") return <ArrowCounterClockwiseIcon aria-hidden />
  if (commandId === "redo") return <ArrowClockwiseIcon aria-hidden />
  if (commandId === "delete-selection") return <TrashIcon aria-hidden />
  return <PaletteIcon name="edit" />
}

// Command filtering, roving focus, and execution share one dialog lifecycle; command metadata and
// editor/workspace operations remain in their owning modules.
// oxlint-disable-next-line react-doctor/no-giant-component
export function StudioCommandPalette({
  onExport,
  onOpenChange,
  onRequestImport,
  onWorkspaceCommand,
  open,
}: StudioCommandPaletteProps) {
  const editor = useEditorActions()
  const history = useEditorHistory()
  const preferences = useStudioWorkspaceSelector(selectWorkspacePreferences)
  const workspace = useStudioWorkspaceActions()
  const [query, setQuery] = useState("")
  const [notice, setNotice] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const editorSnapshot = editor.getSnapshot()
  const document = editorSnapshot.document
  const selectedNode = document ? findNode(document, editorSnapshot.selectedComponentId) : null
  const lockedIdSet = new Set(preferences.layerMetadata.lockedIds)
  const selectedLocked = Boolean(
    selectedNode &&
    [selectedNode.id, ...findAncestorNodeIds(document as MosaicDocument, selectedNode.id)].some(
      (id) => lockedIdSet.has(id),
    ),
  )

  function closePalette() {
    setQuery("")
    setNotice(null)
    onOpenChange(false)
  }

  function focusCommand(relativeIndex: number, from?: HTMLElement) {
    const commands = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>(
        "[data-studio-command]:not(:disabled)",
      ) ?? [],
    )
    if (commands.length === 0) return
    const currentIndex = from ? commands.indexOf(from as HTMLButtonElement) : -1
    const nextIndex =
      currentIndex < 0
        ? relativeIndex < 0
          ? commands.length - 1
          : 0
        : (currentIndex + relativeIndex + commands.length) % commands.length
    commands[nextIndex]?.focus()
  }

  function handleCommandKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      focusCommand(1, event.currentTarget)
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      focusCommand(-1, event.currentTarget)
    } else if (event.key === "Home") {
      event.preventDefault()
      focusCommand(1)
    } else if (event.key === "End") {
      event.preventDefault()
      focusCommand(-1)
    }
  }

  function reportTreeResult(result: TreeOperationResult) {
    if (result.status === "accepted") {
      closePalette()
      return true
    }
    setNotice(`${result.message} ${result.recovery}`)
    return false
  }

  function insertComponent(type: InsertableBlockType) {
    const snapshot = editor.getSnapshot()
    const currentDocument = snapshot.document
    if (!currentDocument || snapshot.isDocumentTransactionActive) {
      setNotice("Finish the current edit before adding another component.")
      return false
    }

    const location = resolveLegacyInsertionLocation(
      currentDocument,
      snapshot.selectedComponentId,
      type,
    )
    const parent = findNode(currentDocument, location.parentId)
    if (parent?.type !== "stack" && parent?.type !== "button") {
      setNotice("Select Content Stack, Button, or another visible Stack and try again.")
      return false
    }
    if (
      insertionBlockedByLock(
        currentDocument,
        location.parentId,
        preferences.layerMetadata.lockedIds,
      )
    ) {
      setNotice("Unlock the destination Stack in Layers before adding content.")
      return false
    }

    const result = editor.insertComponentAt(type, location)
    if (result.status === "accepted") workspace.recordRecentInsertion(type)
    return reportTreeResult(result)
  }

  function openTool(tool: StudioTool) {
    workspace.setSelectedTool(tool)
    onWorkspaceCommand("expand-left")
    closePalette()
  }

  const commands: StudioCommand[] = [
    ...COMPONENT_CATALOG.map<StudioCommand>((entry) => ({
      id: `add-${entry.type}`,
      label: `Add ${entry.label}`,
      description:
        entry.type === "countdown"
          ? "Open Add content and enter an explicit UTC deadline before insertion."
          : entry.description,
      group: "Add content",
      icon: "add",
      disabled: !document || editorSnapshot.isDocumentTransactionActive,
      disabledReason: "Finish the current edit first.",
      run: () => {
        if (entry.type === "countdown") {
          openTool("components")
          return true
        }
        return insertComponent(entry.type)
      },
    })),
    ...(["layers", "components", "products", "localization"] as const).map<StudioCommand>(
      (tool) => ({
        id: `open-${tool}`,
        label: `Open ${tool.charAt(0).toUpperCase()}${tool.slice(1)}`,
        description: `Show the ${tool} tool without leaving Studio.`,
        group: "Navigate",
        icon: "navigate",
        shortcut: TOOL_SHORTCUTS[tool],
        run: () => openTool(tool),
      }),
    ),
    {
      id: "undo",
      label: "Undo",
      description: "Restore the previous document state.",
      group: "Edit",
      icon: "edit",
      shortcut: STUDIO_SHORTCUT_HINTS.undo,
      disabled: !history.canUndo,
      disabledReason: "There is nothing to undo.",
      run: () => {
        history.undo()
        closePalette()
      },
    },
    {
      id: "redo",
      label: "Redo",
      description: "Reapply the next document state.",
      group: "Edit",
      icon: "edit",
      shortcut: STUDIO_SHORTCUT_HINTS.redo,
      disabled: !history.canRedo,
      disabledReason: "There is nothing to redo.",
      run: () => {
        history.redo()
        closePalette()
      },
    },
    {
      id: "duplicate-selection",
      label: "Duplicate selection",
      description: "Duplicate the selected component with fresh identifiers.",
      group: "Edit",
      icon: "edit",
      shortcut: STUDIO_SHORTCUT_HINTS.duplicateSelection,
      disabled: !selectedNode || selectedLocked || editorSnapshot.isDocumentTransactionActive,
      disabledReason: selectedLocked ? "Unlock the selected layer first." : "Select a component.",
      run: () => reportTreeResult(editor.duplicateSelectedComponent()),
    },
    {
      id: "delete-selection",
      label: "Delete selection",
      description: "Delete the selected component when its parent remains valid.",
      group: "Edit",
      icon: "edit",
      shortcut: STUDIO_SHORTCUT_HINTS.deleteSelection,
      disabled: !selectedNode || selectedLocked || editorSnapshot.isDocumentTransactionActive,
      disabledReason: selectedLocked ? "Unlock the selected layer first." : "Select a component.",
      run: () => reportTreeResult(editor.deleteSelectedComponent()),
    },
    {
      id: "fit-canvas",
      label: "Fit canvas",
      description: "Fit the selected device inside the available canvas.",
      group: "Canvas",
      icon: "canvas",
      shortcut: STUDIO_SHORTCUT_HINTS.fitCanvas,
      run: () => {
        workspace.setCanvasPreference("fitMode", "fit")
        closePalette()
      },
    },
    {
      id: "reset-zoom",
      label: "Reset zoom to 100%",
      description: "Use manual canvas zoom at exactly 100%.",
      group: "Canvas",
      icon: "canvas",
      shortcut: STUDIO_SHORTCUT_HINTS.resetZoom,
      run: () => {
        workspace.setCanvasPreferences({
          ...preferences.canvas,
          fitMode: "manual",
          zoom: 1,
        })
        closePalette()
      },
    },
    {
      id: "change-appearance",
      label: `Use ${preferences.canvas.appearance === "light" ? "dark" : "light"} canvas appearance`,
      description: "Change only the browser-canvas appearance preference.",
      group: "Canvas",
      icon: "canvas",
      shortcut: STUDIO_SHORTCUT_HINTS.appearance,
      run: () => {
        workspace.setCanvasPreference(
          "appearance",
          preferences.canvas.appearance === "light" ? "dark" : "light",
        )
        closePalette()
      },
    },
    {
      id: "toggle-left",
      label: preferences.panels.left.collapsed ? "Expand left panel" : "Collapse left panel",
      description: "Collapse or expand the active Studio tool panel.",
      group: "Workspace",
      icon: "workspace",
      shortcut: STUDIO_SHORTCUT_HINTS.toggleLeft,
      run: () => {
        onWorkspaceCommand("toggle-left")
        closePalette()
      },
    },
    {
      id: "toggle-properties",
      label: "Collapse or expand Properties",
      description: "Toggle the desktop inspector or compact Properties sheet.",
      group: "Workspace",
      icon: "workspace",
      shortcut: STUDIO_SHORTCUT_HINTS.toggleProperties,
      run: () => {
        onWorkspaceCommand("toggle-properties")
        closePalette()
      },
    },
    {
      id: "toggle-diagnostics",
      label: preferences.panels.diagnostics.collapsed ? "Show diagnostics" : "Collapse diagnostics",
      description: "Show or collapse validation and connected-preview diagnostics.",
      group: "Workspace",
      icon: "workspace",
      shortcut: STUDIO_SHORTCUT_HINTS.toggleDiagnostics,
      run: () => {
        onWorkspaceCommand("toggle-diagnostics")
        closePalette()
      },
    },
    {
      id: "reset-workspace",
      label: "Reset workspace layout",
      description: "Restore every Studio workspace preference to its default.",
      group: "Workspace",
      icon: "workspace",
      run: () => {
        onWorkspaceCommand("reset")
        closePalette()
      },
    },
    {
      id: "import-document",
      label: "Import document",
      description: "Choose a local Mosaic JSON document to import.",
      group: "File",
      icon: "file",
      run: () => {
        onRequestImport()
        closePalette()
      },
    },
    {
      id: "export-document",
      label: "Export document",
      description: "Validate and export the portable Mosaic document.",
      group: "File",
      icon: "file",
      run: () => {
        onExport()
        closePalette()
      },
    },
  ]

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleCommands = commands.filter((command) => commandMatches(command, normalizedQuery))
  const groupedCommands = visibleCommands.reduce<Map<CommandGroup, StudioCommand[]>>(
    (groups, command) => {
      const group = groups.get(command.group) ?? []
      group.push(command)
      groups.set(command.group, group)
      return groups
    },
    new Map(),
  )

  return (
    <DialogPrimitive.Root
      onOpenChange={(nextOpen) => {
        if (!nextOpen) closePalette()
      }}
      open={open}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-60 bg-black/20 backdrop-blur-[1px]" />
        <DialogPrimitive.Popup className="bg-popover text-popover-foreground fixed top-[12vh] left-1/2 z-60 flex max-h-[min(72vh,680px)] w-[min(92vw,680px)] -translate-x-1/2 flex-col overflow-hidden rounded-xl border shadow-2xl outline-none">
          <div className="border-border flex items-start gap-3 border-b p-4">
            <span className="bg-muted grid size-9 shrink-0 place-items-center rounded-lg">
              <CommandIcon aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="text-sm font-semibold">
                Studio commands
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="text-muted-foreground mt-0.5 text-xs">
                Search local editing, canvas, workspace, import, and export actions.
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close
              aria-label="Close command palette"
              render={<Button size="icon-sm" type="button" variant="ghost" />}
            >
              <XIcon aria-hidden />
            </DialogPrimitive.Close>
          </div>

          <label className="border-border relative block border-b">
            <MagnifyingGlassIcon
              aria-hidden
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2"
            />
            <span className="sr-only">Search Studio commands</span>
            <input
              className="focus-visible:ring-ring h-12 w-full bg-transparent pr-4 pl-11 text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset"
              onChange={(event) => {
                setQuery(event.target.value)
                setNotice(null)
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault()
                  focusCommand(1)
                } else if (event.key === "ArrowUp") {
                  event.preventDefault()
                  focusCommand(-1)
                }
              }}
              placeholder="Search commands…"
              type="search"
              value={query}
            />
          </label>

          <div className="min-h-0 flex-1 overflow-y-auto p-2" ref={listRef}>
            {groupedCommands.size > 0 ? (
              Array.from(groupedCommands, ([group, groupCommands]) => (
                <section aria-labelledby={COMMAND_GROUP_IDS[group]} key={group}>
                  <h2
                    className="text-muted-foreground px-2 pt-3 pb-1 text-xs font-semibold first:pt-1"
                    id={COMMAND_GROUP_IDS[group]}
                  >
                    {group}
                  </h2>
                  <div className="space-y-1">
                    {groupCommands.map((command) => (
                      <button
                        aria-describedby={
                          command.disabled ? `studio-command-disabled-${command.id}` : undefined
                        }
                        className="focus-visible:ring-ring hover:bg-muted flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                        data-studio-command
                        disabled={command.disabled}
                        key={command.id}
                        onClick={() => command.run()}
                        onKeyDown={handleCommandKeyDown}
                        type="button"
                      >
                        <span className="text-muted-foreground grid size-7 shrink-0 place-items-center">
                          {command.group === "Edit" ? (
                            commandIconForEdit(command.id)
                          ) : command.id === "import-document" ? (
                            <UploadSimpleIcon aria-hidden />
                          ) : command.id === "toggle-diagnostics" ? (
                            <WarningCircleIcon aria-hidden />
                          ) : (
                            <PaletteIcon name={command.icon} />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">{command.label}</span>
                          <span
                            className="text-muted-foreground block truncate text-xs"
                            id={
                              command.disabled ? `studio-command-disabled-${command.id}` : undefined
                            }
                          >
                            {command.disabled
                              ? command.disabledReason || command.description
                              : command.description}
                          </span>
                        </span>
                        {command.shortcut ? (
                          <kbd className="border-border bg-muted text-muted-foreground rounded border px-1.5 py-0.5 text-[10px] whitespace-nowrap">
                            {command.shortcut}
                          </kbd>
                        ) : null}
                      </button>
                    ))}
                  </div>
                </section>
              ))
            ) : (
              <div className="p-8 text-center">
                <p className="text-sm font-medium">No commands match</p>
                <p className="text-muted-foreground mt-1 text-xs">
                  Try a component, workspace, canvas, import, or export action.
                </p>
              </div>
            )}
          </div>

          <div
            className={cn(
              "border-border min-h-9 border-t px-4 py-2 text-xs",
              notice ? "text-destructive" : "text-muted-foreground",
            )}
            role="status"
          >
            {notice || "Arrow keys move through commands. Enter activates the focused command."}
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
