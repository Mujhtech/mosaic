import { CommandIcon } from "@phosphor-icons/react/dist/ssr/Command"
import { GearIcon } from "@phosphor-icons/react/dist/ssr/Gear"
import { ImageIcon } from "@phosphor-icons/react/dist/ssr/Image"
import { PackageIcon } from "@phosphor-icons/react/dist/ssr/Package"
import { PaletteIcon } from "@phosphor-icons/react/dist/ssr/Palette"
import { SquaresFourIcon } from "@phosphor-icons/react/dist/ssr/SquaresFour"
import { StackIcon } from "@phosphor-icons/react/dist/ssr/Stack"
import { TranslateIcon } from "@phosphor-icons/react/dist/ssr/Translate"
import { TreeStructureIcon } from "@phosphor-icons/react/dist/ssr/TreeStructure"
import { useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { STUDIO_SHORTCUT_HINTS } from "@/features/paywall-editor/hooks/use-editor-keyboard-shortcuts"
import type { StudioTool } from "@/features/paywall-editor/types/studio-workspace"

const STUDIO_ACTIVITY_TOOLS: readonly {
  readonly tool: StudioTool
  readonly label: string
  readonly icon: typeof TreeStructureIcon
  readonly shortcut?: string
}[] = [
  {
    tool: "layers",
    label: "Layers",
    icon: TreeStructureIcon,
    shortcut: STUDIO_SHORTCUT_HINTS.openLayers,
  },
  {
    tool: "components",
    label: "Components",
    icon: StackIcon,
    shortcut: STUDIO_SHORTCUT_HINTS.openComponents,
  },
  { tool: "templates", label: "Templates", icon: SquaresFourIcon },
  { tool: "designSystem", label: "Design System", icon: PaletteIcon },
  {
    tool: "products",
    label: "Products",
    icon: PackageIcon,
    shortcut: STUDIO_SHORTCUT_HINTS.openProducts,
  },
  {
    tool: "localization",
    label: "Localization",
    icon: TranslateIcon,
    shortcut: STUDIO_SHORTCUT_HINTS.openLocalization,
  },
  { tool: "assets", label: "Assets", icon: ImageIcon },
  { tool: "settings", label: "Settings", icon: GearIcon },
]

export interface StudioActivityRailProps {
  readonly selectedTool: StudioTool
  readonly collapsed: boolean
  /** Selecting a non-active tool is also a request to expand its tool panel. */
  readonly onSelectTool: (tool: StudioTool) => void
  readonly onToggleActiveTool: () => void
  readonly onOpenCommands: () => void
}

function getNextTool(tool: StudioTool, key: string): StudioTool | undefined {
  const currentIndex = STUDIO_ACTIVITY_TOOLS.findIndex((item) => item.tool === tool)

  switch (key) {
    case "ArrowDown":
      return STUDIO_ACTIVITY_TOOLS[(currentIndex + 1) % STUDIO_ACTIVITY_TOOLS.length]?.tool
    case "ArrowUp":
      return STUDIO_ACTIVITY_TOOLS[
        (currentIndex - 1 + STUDIO_ACTIVITY_TOOLS.length) % STUDIO_ACTIVITY_TOOLS.length
      ]?.tool
    case "Home":
      return STUDIO_ACTIVITY_TOOLS[0]?.tool
    case "End":
      return STUDIO_ACTIVITY_TOOLS.at(-1)?.tool
    default:
      return undefined
  }
}

export function StudioActivityRail({
  selectedTool,
  collapsed,
  onSelectTool,
  onToggleActiveTool,
  onOpenCommands,
}: StudioActivityRailProps) {
  const [rovingTool, setRovingTool] = useState<StudioTool>(selectedTool)
  const buttonRefs = useRef(new Map<StudioTool, HTMLButtonElement>())

  function moveFocus(currentTool: StudioTool, key: string) {
    const nextTool = getNextTool(currentTool, key)

    if (!nextTool) {
      return false
    }

    setRovingTool(nextTool)
    buttonRefs.current.get(nextTool)?.focus()
    return true
  }

  return (
    <nav
      aria-label="Studio activity"
      className="border-border bg-sidebar flex w-[52px] max-w-[52px] min-w-[52px] shrink-0 flex-col border-r"
      data-panel-collapsed={collapsed}
      data-rail-width="52"
    >
      <div
        aria-label="Studio tools"
        aria-orientation="vertical"
        className="flex flex-col items-center gap-1 px-2 py-2"
        role="toolbar"
      >
        {STUDIO_ACTIVITY_TOOLS.map(({ tool, label, icon: Icon, shortcut }) => {
          const isSelected = tool === selectedTool
          const actionLabel = isSelected
            ? `${label} — ${collapsed ? "expand" : "collapse"} tool panel`
            : `${label} — open tool panel`
          const tooltipLabel = shortcut ? `${actionLabel} (${shortcut})` : actionLabel

          return (
            <Tooltip key={tool}>
              <TooltipTrigger
                render={
                  <Button
                    aria-label={label}
                    aria-pressed={isSelected}
                    className="text-sidebar-foreground data-[selected=true]:bg-sidebar-accent data-[selected=true]:text-sidebar-accent-foreground data-[selected=true]:before:bg-sidebar-primary relative size-9 transition-none before:absolute before:inset-y-2 before:-left-2 before:w-0.5 before:rounded-full motion-reduce:transition-none"
                    data-selected={isSelected}
                    data-tool={tool}
                    id={`studio-tool-${tool}`}
                    onClick={() => {
                      if (isSelected) {
                        onToggleActiveTool()
                        return
                      }

                      onSelectTool(tool)
                    }}
                    onFocus={() => setRovingTool(tool)}
                    onKeyDown={(event) => {
                      if (moveFocus(tool, event.key)) {
                        event.preventDefault()
                      }
                    }}
                    ref={(element) => {
                      if (element) {
                        buttonRefs.current.set(tool, element)
                      } else {
                        buttonRefs.current.delete(tool)
                      }
                    }}
                    size="icon-lg"
                    tabIndex={rovingTool === tool ? 0 : -1}
                    title={tooltipLabel}
                    type="button"
                    variant="ghost"
                  />
                }
              >
                <Icon aria-hidden weight={isSelected ? "fill" : "regular"} />
              </TooltipTrigger>
              <TooltipContent side="right">{tooltipLabel}</TooltipContent>
            </Tooltip>
          )
        })}
      </div>
      <div
        aria-label="Studio commands"
        className="border-border mt-auto flex justify-center border-t px-2 py-2"
        role="group"
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label="Open Studio commands"
                className="text-sidebar-foreground size-9 transition-none motion-reduce:transition-none"
                onClick={onOpenCommands}
                size="icon-lg"
                title={`Open Studio commands (${STUDIO_SHORTCUT_HINTS.commandPalette})`}
                type="button"
                variant="ghost"
              />
            }
          >
            <CommandIcon aria-hidden />
          </TooltipTrigger>
          <TooltipContent side="right">
            Open Studio commands ({STUDIO_SHORTCUT_HINTS.commandPalette})
          </TooltipContent>
        </Tooltip>
      </div>
    </nav>
  )
}
