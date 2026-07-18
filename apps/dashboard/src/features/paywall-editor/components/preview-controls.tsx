import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/ssr/ArrowsClockwise"
import { CornersOutIcon } from "@phosphor-icons/react/dist/ssr/CornersOut"
import { DeviceMobileIcon } from "@phosphor-icons/react/dist/ssr/DeviceMobile"
import { DeviceTabletIcon } from "@phosphor-icons/react/dist/ssr/DeviceTablet"
import { GearSixIcon } from "@phosphor-icons/react/dist/ssr/GearSix"
import { MagnifyingGlassMinusIcon } from "@phosphor-icons/react/dist/ssr/MagnifyingGlassMinus"
import { MagnifyingGlassPlusIcon } from "@phosphor-icons/react/dist/ssr/MagnifyingGlassPlus"
import { MoonIcon } from "@phosphor-icons/react/dist/ssr/Moon"
import { SunIcon } from "@phosphor-icons/react/dist/ssr/Sun"
import { TextAaIcon } from "@phosphor-icons/react/dist/ssr/TextAa"
import { useReactFlow, useViewport } from "@xyflow/react"
import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  CANVAS_DEVICE_GROUPS,
  CANVAS_DEVICE_PRESETS,
  getCanvasDevicePreset,
} from "@/features/paywall-editor/constants/canvas-devices"
import { STUDIO_CANVAS_ZOOM_BOUNDS } from "@/features/paywall-editor/constants/studio-workspace"
import type { StudioWorkspaceSnapshot } from "@/features/paywall-editor/stores/studio-workspace-store"
import {
  useStudioWorkspaceActions,
  useStudioWorkspaceSelector,
} from "@/features/paywall-editor/stores/studio-workspace-store-context"
import {
  useEditorActions,
  useEditorStore,
} from "@/features/paywall-editor/stores/editor-store-context"
import type {
  StudioCanvasDevice,
  StudioCanvasPreferences,
} from "@/features/paywall-editor/types/studio-workspace"
import { changeDocumentDefaultLocale } from "@/features/paywall-editor/utils/editor-transforms"
import {
  advanceCountdownInstant,
  countdownInstantFromLocalInput,
  countdownLocalInputFromInstant,
  currentCountdownInstant,
} from "@/features/paywall-editor/utils/countdown"

const CONTROL_CLASS =
  "border-input bg-background focus-visible:ring-ring rounded-lg border px-2.5 py-2 text-xs focus-visible:ring-2 focus-visible:outline-none"
const selectCanvasPreferences = (snapshot: StudioWorkspaceSnapshot) => snapshot.preferences.canvas

function clampZoom(value: number) {
  return Math.min(STUDIO_CANVAS_ZOOM_BOUNDS.max, Math.max(STUDIO_CANVAS_ZOOM_BOUNDS.min, value))
}

function IconControl({
  children,
  label,
  onClick,
  pressed,
}: {
  children: ReactNode
  label: string
  onClick: () => void
  pressed?: boolean
}) {
  return (
    <Button
      aria-label={label}
      aria-pressed={pressed}
      className="transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.96] motion-reduce:transition-none"
      onClick={onClick}
      size="icon-sm"
      title={label}
      type="button"
      variant={pressed ? "secondary" : "ghost"}
    >
      {children}
    </Button>
  )
}

function DeviceSelect({ toolbar }: { toolbar: boolean }) {
  const canvas = useStudioWorkspaceSelector(selectCanvasPreferences)
  const workspace = useStudioWorkspaceActions()
  const preset = getCanvasDevicePreset(canvas.device)
  const fieldId = toolbar ? "canvas-toolbar-device" : "preview-panel-device"

  return (
    <label className={toolbar ? "relative" : "block space-y-1 text-xs"} htmlFor={fieldId}>
      <span className={toolbar ? "sr-only" : "text-muted-foreground block font-medium"}>
        Device
      </span>
      <span className="relative block">
        {preset.formFactor === "tablet" ? (
          <DeviceTabletIcon
            aria-hidden
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
          />
        ) : (
          <DeviceMobileIcon
            aria-hidden
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
          />
        )}
        <select
          aria-label={toolbar ? "Preview device" : undefined}
          className={`${CONTROL_CLASS} ${toolbar ? "h-8 w-40 pr-8 pl-8" : "w-full"}`}
          id={fieldId}
          onChange={(event) =>
            workspace.setCanvasPreference("device", event.target.value as StudioCanvasDevice)
          }
          value={canvas.device}
        >
          {CANVAS_DEVICE_GROUPS.map((group) => (
            <optgroup key={group} label={group}>
              {CANVAS_DEVICE_PRESETS.filter((entry) => entry.group === group).map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </span>
    </label>
  )
}

function SecondaryPreviewSettings({ toolbar }: { toolbar: boolean }) {
  const { document } = useEditorStore()
  const canvas = useStudioWorkspaceSelector(selectCanvasPreferences)
  const workspace = useStudioWorkspaceActions()
  if (!document) return null

  function setPreference<Key extends keyof StudioCanvasPreferences>(
    key: Key,
    value: StudioCanvasPreferences[Key],
  ) {
    workspace.setCanvasPreference(key, value)
  }

  function advanceCountdownPreview(milliseconds: number) {
    const next = advanceCountdownInstant(canvas.countdownPreviewAt, milliseconds)
    if (next) setPreference("countdownPreviewAt", next)
  }

  const countdownFieldId = toolbar
    ? "canvas-toolbar-countdown-preview-at"
    : "preview-panel-countdown-preview-at"

  return (
    <div className={toolbar ? "space-y-4" : "space-y-3"}>
      <label className="block space-y-1 text-xs">
        <span className="text-muted-foreground block font-medium">Preview locale</span>
        <select
          aria-label="Preview locale"
          className={`${CONTROL_CLASS} w-full`}
          onChange={(event) => setPreference("locale", event.target.value)}
          value={canvas.locale}
        >
          {Object.entries(document.localization.locales).map(([locale, catalog]) => (
            <option key={locale} value={locale}>
              {locale} · {catalog.direction.toUpperCase()}
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-2 text-xs">
        <span className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground flex items-center gap-1.5 font-medium">
            <TextAaIcon aria-hidden className="size-4" />
            Text scale
          </span>
          <span aria-hidden className="text-muted-foreground tabular-nums">
            {Math.round(canvas.textScale * 100)}%
          </span>
        </span>
        <input
          aria-label={`Preview text scale ${Math.round(canvas.textScale * 100)}%`}
          className="w-full accent-teal-700"
          max="1.5"
          min="0.75"
          onChange={(event) => setPreference("textScale", Number(event.target.value))}
          step="0.05"
          type="range"
          value={canvas.textScale}
        />
      </label>

      <div className="space-y-1.5">
        <span className="text-muted-foreground block text-xs font-medium">Appearance</span>
        <div
          className="bg-muted grid grid-cols-2 rounded-lg p-1"
          role="group"
          aria-label="Preview appearance"
        >
          <Button
            aria-pressed={canvas.appearance === "light"}
            onClick={() => setPreference("appearance", "light")}
            size="sm"
            type="button"
            variant={canvas.appearance === "light" ? "secondary" : "ghost"}
          >
            <SunIcon aria-hidden /> Light
          </Button>
          <Button
            aria-pressed={canvas.appearance === "dark"}
            onClick={() => setPreference("appearance", "dark")}
            size="sm"
            type="button"
            variant={canvas.appearance === "dark" ? "secondary" : "ghost"}
          >
            <MoonIcon aria-hidden /> Dark
          </Button>
        </div>
      </div>

      <div className="border-border space-y-2 rounded-lg border p-2.5">
        <div>
          <label
            className="text-muted-foreground block text-xs font-medium"
            htmlFor={countdownFieldId}
          >
            Countdown preview instant (UTC)
          </label>
          <input
            className={`${CONTROL_CLASS} mt-1 w-full`}
            id={countdownFieldId}
            onChange={(event) => {
              const instant = countdownInstantFromLocalInput(event.target.value)
              if (instant) setPreference("countdownPreviewAt", instant)
            }}
            step="1"
            type="datetime-local"
            value={countdownLocalInputFromInstant(canvas.countdownPreviewAt)}
          />
        </div>
        <div
          aria-label="Advance Countdown preview time"
          className="flex flex-wrap gap-1.5"
          role="group"
        >
          <Button
            aria-label="Set Countdown preview to current UTC time"
            onClick={() => setPreference("countdownPreviewAt", currentCountdownInstant())}
            size="xs"
            type="button"
            variant="outline"
          >
            Now
          </Button>
          <Button
            aria-label="Advance Countdown preview by 1 minute"
            onClick={() => advanceCountdownPreview(60_000)}
            size="xs"
            type="button"
            variant="outline"
          >
            +1m
          </Button>
          <Button
            aria-label="Advance Countdown preview by 1 hour"
            onClick={() => advanceCountdownPreview(3_600_000)}
            size="xs"
            type="button"
            variant="outline"
          >
            +1h
          </Button>
          <Button
            aria-label="Advance Countdown preview by 1 day"
            onClick={() => advanceCountdownPreview(86_400_000)}
            size="xs"
            type="button"
            variant="outline"
          >
            +1d
          </Button>
        </div>
        <p className="text-muted-foreground text-[11px] leading-4">
          Frozen workspace-only time. Native SDKs use the device clock, so Countdown is not
          tamper-proof scarcity.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="border-border bg-background flex min-h-9 items-center gap-2 rounded-lg border px-2.5 text-xs">
          <input
            checked={canvas.forceRTL}
            onChange={(event) => setPreference("forceRTL", event.target.checked)}
            type="checkbox"
          />
          Force RTL
        </label>
        <label className="border-border bg-background flex min-h-9 items-center gap-2 rounded-lg border px-2.5 text-xs">
          <input
            aria-label="Safe area"
            checked={canvas.safeArea}
            onChange={(event) => setPreference("safeArea", event.target.checked)}
            type="checkbox"
          />
          Safe-area guides
        </label>
      </div>
    </div>
  )
}

export function CanvasPreviewToolbar() {
  const canvas = useStudioWorkspaceSelector(selectCanvasPreferences)
  const workspace = useStudioWorkspaceActions()
  const flow = useReactFlow()
  const viewport = useViewport()
  const visibleZoom = canvas.fitMode === "fit" ? viewport.zoom : canvas.zoom

  function setZoom(value: number) {
    const nextZoom = clampZoom(Number(value.toFixed(2)))
    workspace.setCanvasPreference("fitMode", "manual")
    workspace.setCanvasPreference("zoom", nextZoom)
    void flow.zoomTo(nextZoom, { duration: 160 })
  }

  function fitDevice() {
    workspace.setCanvasPreference("fitMode", "fit")
    void flow.fitView({
      duration: 180,
      maxZoom: STUDIO_CANVAS_ZOOM_BOUNDS.max,
      minZoom: STUDIO_CANVAS_ZOOM_BOUNDS.min,
      padding: { top: "32px", right: "36px", bottom: "88px", left: "36px" },
    })
  }

  return (
    <div
      aria-label="Canvas preview controls"
      className="nodrag nopan nowheel border-border/80 bg-background/92 flex items-center gap-0.5 rounded-xl border p-1 shadow-[0_18px_44px_-18px_rgba(15,23,42,0.42)] backdrop-blur-xl"
      data-testid="canvas-preview-toolbar"
      role="toolbar"
    >
      <DeviceSelect toolbar />
      <span aria-hidden className="bg-border mx-0.5 h-4 w-px" />
      <IconControl
        label={`Use ${canvas.orientation === "portrait" ? "landscape" : "portrait"} orientation`}
        onClick={() =>
          workspace.setCanvasPreference(
            "orientation",
            canvas.orientation === "portrait" ? "landscape" : "portrait",
          )
        }
      >
        <ArrowsClockwiseIcon aria-hidden />
      </IconControl>
      <span aria-hidden className="bg-border mx-0.5 h-4 w-px" />
      <IconControl label="Zoom out" onClick={() => setZoom(visibleZoom - 0.1)}>
        <MagnifyingGlassMinusIcon aria-hidden />
      </IconControl>
      <Button
        className="min-w-11 px-1.5 font-mono text-[11px] tabular-nums transition-transform duration-150 active:scale-[0.96] motion-reduce:transition-none"
        onClick={() => setZoom(1)}
        size="xs"
        title="Set canvas zoom to 100%"
        type="button"
        variant="ghost"
      >
        {Math.round(visibleZoom * 100)}%
      </Button>
      <IconControl label="Zoom in" onClick={() => setZoom(visibleZoom + 0.1)}>
        <MagnifyingGlassPlusIcon aria-hidden />
      </IconControl>
      <IconControl
        label="Fit device to canvas"
        onClick={fitDevice}
        pressed={canvas.fitMode === "fit"}
      >
        <CornersOutIcon aria-hidden />
      </IconControl>
      <span aria-hidden className="bg-border mx-0.5 h-4 w-px" />
      <Popover>
        <PopoverTrigger
          render={
            <Button
              aria-label="Open preview settings"
              className="transition-transform duration-150 active:scale-[0.96] motion-reduce:transition-none"
              size="icon-sm"
              title="Preview settings"
              type="button"
              variant="ghost"
            />
          }
        >
          <GearSixIcon aria-hidden />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))]" side="top">
          <PopoverTitle>Preview settings</PopoverTitle>
          <PopoverDescription className="mt-1 mb-4">
            Locale, accessibility, and system appearance stay outside the exported paywall.
          </PopoverDescription>
          <SecondaryPreviewSettings toolbar />
        </PopoverContent>
      </Popover>
    </div>
  )
}

export function PreviewControls() {
  const { document } = useEditorStore()
  const editor = useEditorActions()
  const canvas = useStudioWorkspaceSelector(selectCanvasPreferences)
  const workspace = useStudioWorkspaceActions()
  if (!document) return null

  function setZoom(value: number) {
    workspace.setCanvasPreference("fitMode", "manual")
    workspace.setCanvasPreference("zoom", clampZoom(Number(value.toFixed(2))))
  }

  return (
    <section aria-labelledby="preview-context-title" className="space-y-4">
      <div>
        <h2
          className="text-sm font-semibold focus:outline-none"
          id="preview-context-title"
          tabIndex={-1}
        >
          Preview context
        </h2>
        <p className="text-muted-foreground mt-0.5 text-xs leading-5">
          Workspace preferences do not change the exported paywall. Pan the canvas to inspect the
          active native device frame.
        </p>
      </div>

      <div className="space-y-3">
        <DeviceSelect toolbar={false} />
        <div className="flex flex-wrap items-center gap-1.5">
          <IconControl
            label={`Use ${canvas.orientation === "portrait" ? "landscape" : "portrait"} orientation`}
            onClick={() =>
              workspace.setCanvasPreference(
                "orientation",
                canvas.orientation === "portrait" ? "landscape" : "portrait",
              )
            }
          >
            <ArrowsClockwiseIcon aria-hidden />
          </IconControl>
          <IconControl label="Zoom out" onClick={() => setZoom(canvas.zoom - 0.1)}>
            <MagnifyingGlassMinusIcon aria-hidden />
          </IconControl>
          <Button onClick={() => setZoom(1)} size="sm" type="button" variant="outline">
            {Math.round(canvas.zoom * 100)}%
          </Button>
          <IconControl label="Zoom in" onClick={() => setZoom(canvas.zoom + 0.1)}>
            <MagnifyingGlassPlusIcon aria-hidden />
          </IconControl>
          <IconControl
            label="Fit device to canvas"
            onClick={() => workspace.setCanvasPreference("fitMode", "fit")}
            pressed={canvas.fitMode === "fit"}
          >
            <CornersOutIcon aria-hidden />
          </IconControl>
        </div>
        <SecondaryPreviewSettings toolbar={false} />
      </div>

      <div className="border-border space-y-3 border-t pt-4">
        <div>
          <h3 className="text-xs font-semibold">Document localization</h3>
          <p className="text-muted-foreground mt-1 text-[11px] leading-4">
            These portable settings are part of the paywall document and its undo history.
          </p>
        </div>
        <label className="block space-y-1 text-xs" htmlFor="document-default-locale">
          <span className="text-muted-foreground font-medium">Default locale</span>
          <select
            className={`${CONTROL_CLASS} w-full`}
            id="document-default-locale"
            onChange={(event) =>
              editor.updateDocument((current) =>
                changeDocumentDefaultLocale(current, event.target.value),
              )
            }
            value={document.localization.defaultLocale}
          >
            {Object.keys(document.localization.locales).map((locale) => (
              <option key={locale} value={locale}>
                {locale}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1 text-xs" htmlFor="document-fallback-locale">
          <span className="text-muted-foreground font-medium">Fallback locale</span>
          <select
            className={`${CONTROL_CLASS} w-full`}
            id="document-fallback-locale"
            onChange={(event) =>
              editor.updateDocument((current) => ({
                ...current,
                localization: { ...current.localization, fallbackLocale: event.target.value },
              }))
            }
            value={document.localization.fallbackLocale}
          >
            {Object.keys(document.localization.locales).map((locale) => (
              <option key={locale} value={locale}>
                {locale}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  )
}
