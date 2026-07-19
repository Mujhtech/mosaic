import { BatteryHighIcon } from "@phosphor-icons/react/dist/ssr/BatteryHigh"
import { CellSignalFullIcon } from "@phosphor-icons/react/dist/ssr/CellSignalFull"
import { WifiHighIcon } from "@phosphor-icons/react/dist/ssr/WifiHigh"
import type { CSSProperties, MouseEvent, ReactNode } from "react"

import type {
  CanvasDeviceMaterial,
  CanvasDevicePreset,
} from "@/features/paywall-editor/constants/canvas-devices"
import type {
  CanvasDeviceGeometry,
  CanvasDeviceNodeGeometry,
} from "@/features/paywall-editor/components/canvas-preview-geometry"
import type { MosaicDocument, Screen, StackComponent } from "@/features/paywall-editor/types/editor"
import type { StudioCanvasPreferences } from "@/features/paywall-editor/types/studio-workspace"
import {
  resolvedBackground,
  resolvedProtocolColor,
  resolvedShadow,
} from "@/features/paywall-editor/utils/protocol-styles"

const FRAME_MATERIALS: Record<CanvasDeviceMaterial, CSSProperties> = {
  aluminum: {
    background:
      "linear-gradient(145deg, #f1f3f4 0%, #9ca3aa 20%, #555c65 48%, #d8dcdf 78%, #737b84 100%)",
  },
  graphite: {
    background:
      "linear-gradient(145deg, #777b82 0%, #24272c 24%, #0d0f12 55%, #555a61 82%, #1a1d22 100%)",
  },
  pixel: {
    background:
      "linear-gradient(145deg, #d5d7d9 0%, #6b7076 20%, #25282d 52%, #9da1a6 82%, #42464c 100%)",
  },
  galaxy: {
    background:
      "linear-gradient(145deg, #e0e1df 0%, #7f827f 18%, #303330 50%, #b9bbb8 80%, #545754 100%)",
  },
}

function alignmentStyle(alignment: StackComponent["crossAxisAlignment"]) {
  switch (alignment) {
    case "start":
      return "flex-start"
    case "center":
      return "center"
    case "end":
      return "flex-end"
    case "stretch":
      return "stretch"
  }
}

function distributionStyle(distribution: StackComponent["mainAxisDistribution"]) {
  return distribution === "spaceBetween" ? "space-between" : distribution
}

function HardwareButtons({
  orientation,
  preset,
}: {
  orientation: StudioCanvasPreferences["orientation"]
  preset: CanvasDevicePreset
}) {
  if (preset.formFactor === "tablet") {
    return orientation === "portrait" ? (
      <>
        <span className="absolute -top-[3px] right-16 h-[4px] w-16 rounded-full bg-zinc-700" />
        <span className="absolute top-24 -right-[3px] h-20 w-[4px] rounded-full bg-zinc-700" />
      </>
    ) : (
      <>
        <span className="absolute top-16 -right-[3px] h-16 w-[4px] rounded-full bg-zinc-700" />
        <span className="absolute -bottom-[3px] left-24 h-[4px] w-20 rounded-full bg-zinc-700" />
      </>
    )
  }

  return orientation === "portrait" ? (
    <>
      <span className="absolute top-28 -left-[4px] h-11 w-[5px] rounded-l-full bg-zinc-700" />
      <span className="absolute top-44 -left-[4px] h-20 w-[5px] rounded-l-full bg-zinc-700" />
      <span className="absolute top-40 -right-[4px] h-28 w-[5px] rounded-r-full bg-zinc-700" />
    </>
  ) : (
    <>
      <span className="absolute -top-[4px] left-28 h-[5px] w-11 rounded-t-full bg-zinc-700" />
      <span className="absolute -top-[4px] left-44 h-[5px] w-20 rounded-t-full bg-zinc-700" />
      <span className="absolute -bottom-[4px] left-40 h-[5px] w-28 rounded-b-full bg-zinc-700" />
    </>
  )
}

function DeviceSensor({
  orientation,
  preset,
}: {
  orientation: StudioCanvasPreferences["orientation"]
  preset: CanvasDevicePreset
}) {
  const landscape = orientation === "landscape"

  if (preset.frame.sensor === "bezel-camera") {
    return (
      <span
        aria-hidden
        data-device-sensor="bezel-camera"
        className={`absolute z-50 size-[7px] rounded-full bg-black ring-1 ring-white/15 ${
          landscape ? "top-1/2 left-[6px] -translate-y-1/2" : "top-[6px] left-1/2 -translate-x-1/2"
        }`}
      />
    )
  }

  if (preset.frame.sensor === "dynamic-island") {
    return (
      <span
        aria-hidden
        data-device-sensor="dynamic-island"
        className={`pointer-events-none absolute z-[70] bg-black shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] ${
          landscape
            ? "top-1/2 left-[15px] h-[104px] w-[32px] -translate-y-1/2 rounded-[17px]"
            : "top-[18px] left-1/2 h-[32px] w-[104px] -translate-x-1/2 rounded-[17px]"
        }`}
      >
        <span
          aria-hidden
          data-device-camera-lens
          className={`absolute size-[7px] rounded-full bg-[#101923] shadow-[inset_0_0_0_1px_rgba(75,112,139,0.45)] ring-1 ring-[#273848] ${
            landscape
              ? "bottom-[10px] left-1/2 -translate-x-1/2"
              : "top-1/2 right-[10px] -translate-y-1/2"
          }`}
        />
      </span>
    )
  }

  return (
    <span
      aria-hidden
      data-device-sensor="punch-hole"
      className={`pointer-events-none absolute z-[70] size-[13px] rounded-full bg-black shadow-[0_0_0_2px_rgba(0,0,0,0.16)] ${
        landscape ? "top-1/2 left-[13px] -translate-y-1/2" : "top-[13px] left-1/2 -translate-x-1/2"
      }`}
    >
      <span className="absolute top-[3px] left-[3px] size-[3px] rounded-full bg-sky-900/80" />
    </span>
  )
}

function IosCellularSignal({ compact }: { compact: boolean }) {
  return (
    <svg
      aria-hidden
      className={compact ? "h-[10px] w-[15px]" : "h-[13px] w-[19px]"}
      data-system-icon="ios-cellular"
      fill="currentColor"
      viewBox="0 0 21 14"
    >
      <rect height="4" rx="1.25" width="3.5" x="0" y="10" />
      <rect height="7" rx="1.25" width="3.5" x="5.5" y="7" />
      <rect height="10" rx="1.25" width="3.5" x="11" y="4" />
      <rect height="14" rx="1.25" width="3.5" x="16.5" y="0" />
    </svg>
  )
}

function IosWifiSignal({ compact }: { compact: boolean }) {
  return (
    <svg
      aria-hidden
      className={compact ? "h-[10px] w-[14px]" : "h-[14px] w-[19px]"}
      data-system-icon="ios-wifi"
      fill="none"
      viewBox="0 0 20 15"
    >
      <path
        d="M1.5 5.1C6.2 1.2 13.8 1.2 18.5 5.1"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2.35"
      />
      <path
        d="M4.8 8.7C7.7 6.3 12.3 6.3 15.2 8.7"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2.35"
      />
      <circle cx="10" cy="12.6" fill="currentColor" r="1.55" />
    </svg>
  )
}

function IosBattery({ compact, dark }: { compact: boolean; dark: boolean }) {
  return (
    <svg
      aria-hidden
      className={compact ? "h-[10px] w-[22px]" : "h-[14px] w-[29px]"}
      data-battery-percent="82"
      data-system-icon="ios-battery"
      fill="none"
      viewBox="0 0 29 14"
    >
      <rect
        height="12"
        rx="3.25"
        stroke="currentColor"
        strokeWidth="1.5"
        width="24.5"
        x="0.75"
        y="1"
      />
      <rect fill="currentColor" height="9" rx="2" width="18.1" x="2.5" y="2.5" />
      <path
        d="M26.7 4.25C27.8 4.65 28.5 5.65 28.5 7C28.5 8.35 27.8 9.35 26.7 9.75V4.25Z"
        fill="currentColor"
      />
      <text
        fill={dark ? "#0f172a" : "#ffffff"}
        fontFamily="-apple-system, BlinkMacSystemFont, sans-serif"
        fontSize="6.4"
        fontWeight="700"
        textAnchor="middle"
        x="11.55"
        y="9.25"
      >
        82
      </text>
    </svg>
  )
}

function IosStatusIndicators({ compact, dark }: { compact: boolean; dark: boolean }) {
  return (
    <span className={`flex items-center ${compact ? "gap-1" : "gap-[7px]"}`}>
      <IosCellularSignal compact={compact} />
      <IosWifiSignal compact={compact} />
      <IosBattery compact={compact} dark={dark} />
    </span>
  )
}

function AndroidStatusIndicators({ compact }: { compact: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <CellSignalFullIcon
        aria-hidden
        className={compact ? "size-3" : "size-[14px]"}
        weight="fill"
      />
      <WifiHighIcon aria-hidden className={compact ? "size-3" : "size-[14px]"} weight="bold" />
      <span className={compact ? "text-[10px]" : "text-[11px]"}>82%</span>
      <BatteryHighIcon aria-hidden className={compact ? "size-[14px]" : "size-4"} weight="fill" />
    </span>
  )
}

function SystemStatusBar({
  appearance,
  orientation,
  preset,
}: {
  appearance: StudioCanvasPreferences["appearance"]
  orientation: StudioCanvasPreferences["orientation"]
  preset: CanvasDevicePreset
}) {
  const isTablet = preset.formFactor === "tablet"
  const isLandscape = orientation === "landscape"
  const dark = appearance === "dark"
  const time = preset.platform === "ios" ? "9:41" : "12:45"
  const statusBarHeight = isTablet ? 26 : isLandscape ? 28 : preset.platform === "ios" ? 62 : 34
  const inlinePadding =
    preset.id === "iphone-17-pro-max" ? 40 : preset.id === "iphone-17-pro" ? 35 : isTablet ? 18 : 22

  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-x-0 top-0 z-[60] flex items-start justify-between font-semibold tracking-tight ${
        dark ? "text-white" : "text-slate-950"
      }`}
      data-status-platform={preset.platform}
      data-testid="device-status-bar"
      dir="ltr"
      style={{
        height: statusBarHeight,
        paddingBlockStart: isTablet ? 7 : isLandscape ? 7 : preset.platform === "ios" ? 18 : 9,
        paddingInline: inlinePadding,
      }}
    >
      <span
        className={
          isTablet
            ? "text-[11px] leading-none"
            : preset.platform === "ios"
              ? "text-[15px] leading-none"
              : "text-[13px] leading-none"
        }
        style={{
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif",
          fontVariantNumeric: "tabular-nums",
          fontWeight: preset.platform === "ios" ? 600 : 650,
          letterSpacing: "-0.025em",
        }}
      >
        {time}
      </span>
      {preset.platform === "ios" ? (
        <IosStatusIndicators compact={isTablet} dark={dark} />
      ) : (
        <AndroidStatusIndicators compact={isTablet} />
      )}
    </div>
  )
}

function SystemGestureBar({
  appearance,
  platform,
}: {
  appearance: StudioCanvasPreferences["appearance"]
  platform: CanvasDevicePreset["platform"]
}) {
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute bottom-[7px] left-1/2 z-[60] h-[5px] -translate-x-1/2 rounded-full ${
        appearance === "dark" ? "bg-white/80" : "bg-slate-950/80"
      } ${platform === "ios" ? "w-32" : "w-24"}`}
    />
  )
}

export function CanvasPreviewDevice({
  active,
  canvas,
  children,
  direction,
  document,
  geometry,
  initial,
  layout,
  nodeGeometry,
  presentation,
  preset,
  rootHidden,
  screenLabel,
  selectedComponentId,
  zoom,
  onFrameSelect,
  onRootClick,
  onRootSelect,
}: {
  active: boolean
  canvas: StudioCanvasPreferences
  children: ReactNode
  direction: "ltr" | "rtl"
  document: MosaicDocument
  geometry: CanvasDeviceGeometry
  initial: boolean
  layout: Screen["layout"]
  nodeGeometry: CanvasDeviceNodeGeometry
  presentation: "screen" | "sheet"
  preset: CanvasDevicePreset
  rootHidden: boolean
  screenLabel: string
  selectedComponentId: string | null
  zoom: number
  onFrameSelect: () => void
  onRootClick: (event: MouseEvent<HTMLDivElement>) => void
  onRootSelect: () => void
}) {
  const root = layout.content
  const layoutBackground = resolvedBackground(document, layout.background)
  const rootBackground = resolvedBackground(document, root.appearance?.background)
  const respectsSafeArea = layout.safeArea === "respect"
  const safeArea = respectsSafeArea ? geometry.safeArea : { top: 0, right: 0, bottom: 0, left: 0 }

  return (
    <div
      aria-label={`${preset.label}, ${preset.displayLabel}, ${canvas.orientation}, ${Math.round(zoom * 100)}% zoom`}
      className="group/device relative select-none"
      data-canvas-fit-mode={canvas.fitMode}
      data-device-height={geometry.height}
      data-device-id={preset.id}
      data-device-platform={preset.platform}
      data-device-width={geometry.width}
      data-effective-zoom={zoom.toFixed(3)}
      data-presentation={presentation}
      role="group"
      style={{ height: nodeGeometry.height, width: nodeGeometry.width }}
    >
      <div
        className="mosaic-device-drag-handle flex h-[38px] cursor-grab items-start justify-between gap-3 px-1 text-xs active:cursor-grabbing"
        data-testid="device-metadata-labels"
      >
        <button
          aria-label={`${screenLabel} ${presentation} frame`}
          className={`border-border/70 bg-background/95 text-foreground flex min-w-0 items-center gap-1.5 rounded-full border px-3 py-1.5 font-semibold shadow-sm backdrop-blur focus-visible:ring-2 focus-visible:outline-none ${
            active ? "ring-primary ring-2" : ""
          }`}
          data-testid="device-name-label"
          onClick={(event) => {
            event.stopPropagation()
            onFrameSelect()
          }}
          type="button"
        >
          <span className="max-w-40 truncate">{screenLabel}</span>
          <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px] font-medium uppercase">
            {presentation}
          </span>
          {initial ? (
            <span className="bg-primary/10 text-primary rounded px-1.5 py-0.5 text-[10px] font-medium uppercase">
              Start
            </span>
          ) : null}
          <span className="sr-only">{preset.label}</span>
        </button>
        <span
          className="border-border/60 bg-background/90 text-muted-foreground pointer-events-none truncate rounded-full border px-3 py-1.5 font-medium shadow-sm backdrop-blur"
          data-testid="device-size-label"
        >
          {preset.label} · {preset.displayLabel}
        </span>
      </div>

      <div
        className="relative shadow-[0_34px_80px_-28px_rgba(15,23,42,0.62),0_12px_24px_-12px_rgba(15,23,42,0.4)] ring-1 ring-black/50"
        style={{
          ...FRAME_MATERIALS[preset.frame.material],
          borderRadius: preset.frame.outerRadius,
          height: nodeGeometry.shellHeight,
          padding: preset.frame.bezel,
          width: nodeGeometry.shellWidth,
        }}
      >
        <HardwareButtons orientation={canvas.orientation} preset={preset} />
        <DeviceSensor orientation={canvas.orientation} preset={preset} />
        <div
          className={`nodrag nowheel nopan relative h-full w-full overflow-y-auto overscroll-contain ${
            canvas.appearance === "dark" ? "bg-slate-950 text-slate-50" : "bg-white text-slate-950"
          }`}
          dir={direction}
          style={{
            ...layoutBackground.style,
            borderRadius: preset.frame.screenRadius,
            fontSize: `${16 * canvas.textScale}px`,
          }}
        >
          <SystemStatusBar
            appearance={canvas.appearance}
            orientation={canvas.orientation}
            preset={preset}
          />
          <SystemGestureBar appearance={canvas.appearance} platform={preset.platform} />
          {layoutBackground.video ? (
            <video
              aria-hidden
              autoPlay
              className="pointer-events-none absolute inset-0 z-0 size-full"
              loop
              muted
              playsInline
              poster={layoutBackground.video.poster}
              src={layoutBackground.video.src}
              style={{
                objectFit: layoutBackground.video.contentMode === "fill" ? "cover" : "contain",
              }}
            />
          ) : null}

          {canvas.safeArea ? (
            <div
              aria-hidden
              className="pointer-events-none absolute z-40 border border-dashed border-fuchsia-500/70"
              data-testid="canvas-safe-area"
              style={{
                insetBlockEnd: geometry.safeArea.bottom,
                insetBlockStart: geometry.safeArea.top,
                insetInlineEnd: geometry.safeArea.right,
                insetInlineStart: geometry.safeArea.left,
              }}
            />
          ) : null}

          {presentation === "sheet" ? (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 z-[8] bg-slate-950/45"
            />
          ) : null}

          <div
            className={`z-10 flex flex-col ${
              presentation === "sheet"
                ? "absolute inset-x-0 bottom-0 max-h-[88%] min-h-[36%] overflow-y-auto rounded-t-[28px] shadow-[0_-18px_50px_-24px_rgba(15,23,42,0.65)]"
                : "relative min-h-full"
            } ${selectedComponentId === root.id ? "ring-primary ring-2 ring-inset" : ""}`}
            data-component-id={root.id}
            data-sheet-surface={presentation === "sheet" ? "true" : undefined}
            onClick={onRootClick}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return
              event.preventDefault()
              onRootSelect()
            }}
            role="button"
            style={{
              alignItems: alignmentStyle(root.crossAxisAlignment),
              ...rootBackground.style,
              backgroundColor:
                rootBackground.style.backgroundColor ??
                (rootBackground.style.background
                  ? undefined
                  : presentation === "sheet"
                    ? canvas.appearance === "dark"
                      ? "#020617"
                      : "#ffffff"
                    : undefined),
              borderColor: resolvedProtocolColor(document, root.appearance?.border?.color),
              borderRadius:
                presentation === "sheet"
                  ? `${Math.max(28, root.appearance?.cornerRadius ?? 0)}px ${Math.max(28, root.appearance?.cornerRadius ?? 0)}px 0 0`
                  : root.appearance?.cornerRadius,
              borderStyle: root.appearance?.border ? "solid" : undefined,
              borderWidth: root.appearance?.border?.width,
              flexDirection: root.direction === "vertical" ? "column" : "row",
              gap: root.gap,
              justifyContent: distributionStyle(root.mainAxisDistribution),
              opacity: root.appearance?.opacity,
              boxShadow: resolvedShadow(document, root.appearance?.shadow),
              isolation: "isolate",
              overflow: root.appearance?.clipContent ? "hidden" : undefined,
              paddingBlockEnd: root.padding.bottom + safeArea.bottom,
              paddingBlockStart: root.padding.top + (presentation === "sheet" ? 0 : safeArea.top),
              paddingInlineEnd: root.padding.end + safeArea.right,
              paddingInlineStart: root.padding.start + safeArea.left,
            }}
            tabIndex={0}
          >
            {rootBackground.video ? (
              <video
                aria-hidden
                autoPlay
                className="pointer-events-none absolute inset-0 z-0 size-full rounded-[inherit]"
                loop
                muted
                playsInline
                poster={rootBackground.video.poster}
                src={rootBackground.video.src}
                style={{
                  objectFit: rootBackground.video.contentMode === "fill" ? "cover" : "contain",
                }}
              />
            ) : null}
            {rootHidden ? (
              <div className="m-auto max-w-xs rounded-xl border border-dashed border-slate-300 p-5 text-center text-sm opacity-70">
                Content Stack is hidden on the canvas. Show it from Layers to preview its content.
              </div>
            ) : (
              children
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
