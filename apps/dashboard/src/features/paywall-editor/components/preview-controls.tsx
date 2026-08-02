import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/ssr/ArrowsClockwise";
import { CornersOutIcon } from "@phosphor-icons/react/dist/ssr/CornersOut";
import { DeviceMobileIcon } from "@phosphor-icons/react/dist/ssr/DeviceMobile";
import { DeviceTabletIcon } from "@phosphor-icons/react/dist/ssr/DeviceTablet";
import { GearSixIcon } from "@phosphor-icons/react/dist/ssr/GearSix";
import { MagnifyingGlassMinusIcon } from "@phosphor-icons/react/dist/ssr/MagnifyingGlassMinus";
import { MagnifyingGlassPlusIcon } from "@phosphor-icons/react/dist/ssr/MagnifyingGlassPlus";
import { MoonIcon } from "@phosphor-icons/react/dist/ssr/Moon";
import { SunIcon } from "@phosphor-icons/react/dist/ssr/Sun";
import { TextAaIcon } from "@phosphor-icons/react/dist/ssr/TextAa";
import { useReactFlow, useViewport } from "@xyflow/react";
import type { ReactNode } from "react";
import { useCallback } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CANVAS_DEVICE_GROUPS,
  CANVAS_DEVICE_PRESETS,
  getCanvasDevicePreset,
} from "@/features/paywall-editor/constants/canvas-devices";
import { STUDIO_CANVAS_ZOOM_BOUNDS } from "@/features/paywall-editor/constants/studio-workspace";
import {
  useEditorActions,
  useEditorStore,
} from "@/features/paywall-editor/stores/editor-store-context";
import type { StudioWorkspaceSnapshot } from "@/features/paywall-editor/stores/studio-workspace-store";
import {
  useStudioWorkspaceActions,
  useStudioWorkspaceSelector,
} from "@/features/paywall-editor/stores/studio-workspace-store-context";
import type {
  StudioCanvasDevice,
  StudioCanvasPreferences,
} from "@/features/paywall-editor/types/studio-workspace";
import {
  advanceCountdownInstant,
  countdownInstantFromLocalInput,
  countdownLocalInputFromInstant,
  currentCountdownInstant,
} from "@/features/paywall-editor/utils/countdown";
import { changeDocumentDefaultLocale } from "@/features/paywall-editor/utils/editor-transforms";

const CONTROL_CLASS =
  "border-input bg-background focus-visible:ring-ring rounded border px-2.5 py-2 text-xs focus-visible:ring-2 focus-visible:outline-none";
const selectCanvasPreferences = (snapshot: StudioWorkspaceSnapshot) =>
  snapshot.preferences.canvas;

function clampZoom(value: number) {
  return Math.min(
    STUDIO_CANVAS_ZOOM_BOUNDS.max,
    Math.max(STUDIO_CANVAS_ZOOM_BOUNDS.min, value)
  );
}

function IconControl({
  children,
  label,
  onClick,
  pressed,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  pressed?: boolean;
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
  );
}

const DEVICE_ITEM_GROUPS = CANVAS_DEVICE_GROUPS.map((group) => ({
  items: CANVAS_DEVICE_PRESETS.filter((entry) => entry.group === group).map(
    (entry) => ({
      label: entry.label,
      value: entry.id,
    })
  ),
  label: group,
}));

function DeviceSelect({ toolbar }: { toolbar: boolean }) {
  const canvas = useStudioWorkspaceSelector(selectCanvasPreferences);
  const workspace = useStudioWorkspaceActions();
  const preset = getCanvasDevicePreset(canvas.device);
  const fieldId = toolbar ? "canvas-toolbar-device" : "preview-panel-device";

  return (
    <label
      className={toolbar ? "relative" : "block space-y-1 text-xs"}
      htmlFor={fieldId}
    >
      <span
        className={
          toolbar ? "sr-only" : "block font-medium text-muted-foreground"
        }
      >
        Device
      </span>
      <span className="relative block">
        {preset.formFactor === "tablet" ? (
          <DeviceTabletIcon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
        ) : (
          <DeviceMobileIcon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
        )}
        <Select
          items={DEVICE_ITEM_GROUPS}
          onValueChange={(value) =>
            workspace.setCanvasPreference("device", value as StudioCanvasDevice)
          }
          value={canvas.device}
        >
          <SelectTrigger
            aria-label={toolbar ? "Preview device" : undefined}
            className={toolbar ? "w-40 pl-8" : "w-full"}
            id={fieldId}
            size={toolbar ? "sm" : "default"}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DEVICE_ITEM_GROUPS.map((group) => (
              <SelectGroup key={group.label}>
                <SelectLabel>{group.label}</SelectLabel>
                {group.items.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </span>
    </label>
  );
}

function SecondaryPreviewSettings({ toolbar }: { toolbar: boolean }) {
  const { document } = useEditorStore();
  const canvas = useStudioWorkspaceSelector(selectCanvasPreferences);
  const workspace = useStudioWorkspaceActions();
  if (!document) {
    return null;
  }

  function setPreference<Key extends keyof StudioCanvasPreferences>(
    key: Key,
    value: StudioCanvasPreferences[Key]
  ) {
    workspace.setCanvasPreference(key, value);
  }

  function advanceCountdownPreview(milliseconds: number) {
    const next = advanceCountdownInstant(
      canvas.countdownPreviewAt,
      milliseconds
    );
    if (next) {
      setPreference("countdownPreviewAt", next);
    }
  }

  const previewLocaleOptions = Object.entries(
    document.localization.locales
  ).map(([locale, catalog]) => ({
    label: `${locale} · ${catalog.direction.toUpperCase()}`,
    value: locale,
  }));

  const countdownFieldId = toolbar
    ? "canvas-toolbar-countdown-preview-at"
    : "preview-panel-countdown-preview-at";

  return (
    <div className={toolbar ? "space-y-4" : "space-y-3"}>
      <div className="block space-y-1 text-xs">
        <span className="block font-medium text-muted-foreground">
          Preview locale
        </span>
        <Select
          items={previewLocaleOptions}
          onValueChange={(value) => setPreference("locale", value)}
          value={canvas.locale}
        >
          <SelectTrigger aria-label="Preview locale" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {previewLocaleOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <label className="block space-y-2 text-xs">
        <span className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 font-medium text-muted-foreground">
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
          onChange={(event) =>
            setPreference("textScale", Number(event.target.value))
          }
          step="0.05"
          type="range"
          value={canvas.textScale}
        />
      </label>

      <div className="space-y-1.5">
        <span className="block font-medium text-muted-foreground text-xs">
          Appearance
        </span>
        <fieldset
          aria-label="Preview appearance"
          className="grid min-w-0 grid-cols-2 rounded bg-muted p-1"
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
        </fieldset>
      </div>

      <div className="space-y-2 rounded border border-border p-2.5">
        <div>
          <label
            className="block font-medium text-muted-foreground text-xs"
            htmlFor={countdownFieldId}
          >
            Countdown preview instant (UTC)
          </label>
          <input
            className={`${CONTROL_CLASS} mt-1 w-full`}
            id={countdownFieldId}
            onChange={(event) => {
              const instant = countdownInstantFromLocalInput(
                event.target.value
              );
              if (instant) {
                setPreference("countdownPreviewAt", instant);
              }
            }}
            step="1"
            type="datetime-local"
            value={countdownLocalInputFromInstant(canvas.countdownPreviewAt)}
          />
        </div>
        <fieldset
          aria-label="Advance Countdown preview time"
          className="flex min-w-0 flex-wrap gap-1.5"
        >
          <Button
            aria-label="Set Countdown preview to current UTC time"
            onClick={() =>
              setPreference("countdownPreviewAt", currentCountdownInstant())
            }
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
        </fieldset>
        <p className="text-[11px] text-muted-foreground leading-4">
          Frozen workspace-only time. Native SDKs use the device clock, so
          Countdown is not tamper-proof scarcity.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex min-h-9 items-center gap-2 rounded border border-border bg-background px-2.5 text-xs">
          <input
            checked={canvas.forceRTL}
            onChange={(event) =>
              setPreference("forceRTL", event.target.checked)
            }
            type="checkbox"
          />
          Force RTL
        </label>
        <label className="flex min-h-9 items-center gap-2 rounded border border-border bg-background px-2.5 text-xs">
          <input
            aria-label="Safe area"
            checked={canvas.safeArea}
            onChange={(event) =>
              setPreference("safeArea", event.target.checked)
            }
            type="checkbox"
          />
          Safe-area guides
        </label>
      </div>
    </div>
  );
}

export function CanvasPreviewToolbar() {
  const canvas = useStudioWorkspaceSelector(selectCanvasPreferences);
  const workspace = useStudioWorkspaceActions();
  const handleClick = useCallback(
    () =>
      workspace.setCanvasPreference(
        "orientation",
        canvas.orientation === "portrait" ? "landscape" : "portrait"
      ),
    [canvas, workspace]
  );
  const flow = useReactFlow();
  const viewport = useViewport();
  const visibleZoom = canvas.fitMode === "fit" ? viewport.zoom : canvas.zoom;

  const setZoom = useCallback(
    (value: number) => {
      const nextZoom = clampZoom(Number(value.toFixed(2)));
      workspace.setCanvasPreference("fitMode", "manual");
      workspace.setCanvasPreference("zoom", nextZoom);
      flow.zoomTo(nextZoom, { duration: 160 });
    },
    [flow, workspace]
  );

  const handleClick4 = useCallback(
    () => setZoom(visibleZoom + 0.1),
    [setZoom, visibleZoom]
  );
  const handleClick3 = useCallback(() => setZoom(1), [setZoom]);
  const handleClick2 = useCallback(
    () => setZoom(visibleZoom - 0.1),
    [setZoom, visibleZoom]
  );
  function fitDevice() {
    workspace.setCanvasPreference("fitMode", "fit");
    flow.fitView({
      duration: 180,
      maxZoom: STUDIO_CANVAS_ZOOM_BOUNDS.max,
      minZoom: STUDIO_CANVAS_ZOOM_BOUNDS.min,
      padding: { top: "32px", right: "36px", bottom: "88px", left: "36px" },
    });
  }

  return (
    <div
      aria-label="Canvas preview controls"
      className="nodrag nopan nowheel flex items-center gap-0.5 rounded border border-border/80 bg-background/92 p-1 shadow-[0_18px_44px_-18px_rgba(15,23,42,0.42)] backdrop-blur-xl"
      data-testid="canvas-preview-toolbar"
      role="toolbar"
    >
      <DeviceSelect toolbar />
      <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />
      <IconControl
        label={`Use ${canvas.orientation === "portrait" ? "landscape" : "portrait"} orientation`}
        onClick={handleClick}
      >
        <ArrowsClockwiseIcon aria-hidden />
      </IconControl>
      <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />
      <IconControl label="Zoom out" onClick={handleClick2}>
        <MagnifyingGlassMinusIcon aria-hidden />
      </IconControl>
      <Button
        className="min-w-11 px-1.5 font-mono text-[11px] tabular-nums transition-transform duration-150 active:scale-[0.96] motion-reduce:transition-none"
        onClick={handleClick3}
        size="xs"
        title="Set canvas zoom to 100%"
        type="button"
        variant="ghost"
      >
        {Math.round(visibleZoom * 100)}%
      </Button>
      <IconControl label="Zoom in" onClick={handleClick4}>
        <MagnifyingGlassPlusIcon aria-hidden />
      </IconControl>
      <IconControl
        label="Fit device to canvas"
        onClick={fitDevice}
        pressed={canvas.fitMode === "fit"}
      >
        <CornersOutIcon aria-hidden />
      </IconControl>
      <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />
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
        <PopoverContent
          align="end"
          className="w-[min(22rem,calc(100vw-2rem))]"
          side="top"
        >
          <PopoverTitle>Preview settings</PopoverTitle>
          <PopoverDescription className="mt-1 mb-4">
            Locale, accessibility, and system appearance stay outside the
            exported paywall.
          </PopoverDescription>
          <SecondaryPreviewSettings toolbar />
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function PreviewControls() {
  const { document } = useEditorStore();
  const editor = useEditorActions();
  const canvas = useStudioWorkspaceSelector(selectCanvasPreferences);
  const workspace = useStudioWorkspaceActions();
  const handleClick2 = useCallback(
    () => workspace.setCanvasPreference("fitMode", "fit"),
    [workspace]
  );
  const handleClick = useCallback(
    () =>
      workspace.setCanvasPreference(
        "orientation",
        canvas.orientation === "portrait" ? "landscape" : "portrait"
      ),
    [canvas, workspace]
  );
  if (!document) {
    return null;
  }

  function setZoom(value: number) {
    workspace.setCanvasPreference("fitMode", "manual");
    workspace.setCanvasPreference("zoom", clampZoom(Number(value.toFixed(2))));
  }

  const localeOptions = Object.keys(document.localization.locales).map(
    (locale) => ({
      label: locale,
      value: locale,
    })
  );

  return (
    <section aria-labelledby="preview-context-title" className="space-y-4">
      <div>
        <h2
          className="font-semibold text-sm focus:outline-none"
          id="preview-context-title"
          tabIndex={-1}
        >
          Preview context
        </h2>
        <p className="mt-0.5 text-muted-foreground text-xs leading-5">
          Workspace preferences do not change the exported paywall. Pan the
          canvas to inspect the active native device frame.
        </p>
      </div>

      <div className="space-y-3">
        <DeviceSelect toolbar={false} />
        <div className="flex flex-wrap items-center gap-1.5">
          <IconControl
            label={`Use ${canvas.orientation === "portrait" ? "landscape" : "portrait"} orientation`}
            onClick={handleClick}
          >
            <ArrowsClockwiseIcon aria-hidden />
          </IconControl>
          <IconControl
            label="Zoom out"
            onClick={() => setZoom(canvas.zoom - 0.1)}
          >
            <MagnifyingGlassMinusIcon aria-hidden />
          </IconControl>
          <Button
            onClick={() => setZoom(1)}
            size="sm"
            type="button"
            variant="outline"
          >
            {Math.round(canvas.zoom * 100)}%
          </Button>
          <IconControl
            label="Zoom in"
            onClick={() => setZoom(canvas.zoom + 0.1)}
          >
            <MagnifyingGlassPlusIcon aria-hidden />
          </IconControl>
          <IconControl
            label="Fit device to canvas"
            onClick={handleClick2}
            pressed={canvas.fitMode === "fit"}
          >
            <CornersOutIcon aria-hidden />
          </IconControl>
        </div>
        <SecondaryPreviewSettings toolbar={false} />
      </div>

      <div className="space-y-3 border-border border-t pt-4">
        <div>
          <h3 className="font-semibold text-xs">Document localization</h3>
          <p className="mt-1 text-[11px] text-muted-foreground leading-4">
            These portable settings are part of the paywall document and its
            undo history.
          </p>
        </div>
        <div className="block space-y-1 text-xs">
          <label
            className="font-medium text-muted-foreground"
            htmlFor="document-default-locale"
          >
            Default locale
          </label>
          <Select
            items={localeOptions}
            onValueChange={(value) =>
              editor.updateDocument((current) =>
                changeDocumentDefaultLocale(current, value)
              )
            }
            value={document.localization.defaultLocale}
          >
            <SelectTrigger id="document-default-locale" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {localeOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="block space-y-1 text-xs">
          <label
            className="font-medium text-muted-foreground"
            htmlFor="document-fallback-locale"
          >
            Fallback locale
          </label>
          <Select
            items={localeOptions}
            onValueChange={(value) =>
              editor.updateDocument((current) => ({
                ...current,
                localization: {
                  ...current.localization,
                  fallbackLocale: value,
                },
              }))
            }
            value={document.localization.fallbackLocale}
          >
            <SelectTrigger id="document-fallback-locale" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {localeOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </section>
  );
}
