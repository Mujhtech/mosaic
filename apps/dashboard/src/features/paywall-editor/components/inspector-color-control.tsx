import { CheckIcon } from "@phosphor-icons/react/dist/ssr/Check"
import { EyedropperIcon } from "@phosphor-icons/react/dist/ssr/Eyedropper"
import { PercentIcon } from "@phosphor-icons/react/dist/ssr/Percent"
import { useMemo, useState } from "react"
import type { CSSProperties, KeyboardEvent, PointerEvent as ReactPointerEvent } from "react"

import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import type { MosaicDocument, ProtocolColor } from "@/features/paywall-editor/types/editor"
import {
  isColorTokenReference,
  protocolColorLabel,
  resolvedProtocolColor,
} from "@/features/paywall-editor/utils/protocol-styles"
import { resolveColorToken } from "@/lib/mosaic-protocol"
import { cn } from "@/lib/utils"

type SemanticProtocolColor = Exclude<ProtocolColor, `#${string}` | { type: "colorToken" }>

interface ColorChannels {
  readonly alpha: number
  readonly blue: number
  readonly green: number
  readonly red: number
}

interface HsvColor {
  readonly hue: number
  readonly saturation: number
  readonly value: number
}

interface SemanticColorOption {
  readonly css: string
  readonly fallback: `#${string}`
  readonly label: string
  readonly value: SemanticProtocolColor
}

const SEMANTIC_COLOR_OPTIONS: readonly SemanticColorOption[] = [
  {
    value: "text.primary",
    label: "Text primary",
    css: "var(--foreground)",
    fallback: "#172033FF",
  },
  {
    value: "text.secondary",
    label: "Text secondary",
    css: "var(--muted-foreground)",
    fallback: "#687284FF",
  },
  {
    value: "surface.default",
    label: "Surface default",
    css: "var(--background)",
    fallback: "#FFFFFFFF",
  },
  {
    value: "surface.elevated",
    label: "Surface elevated",
    css: "var(--card)",
    fallback: "#F7F9FCFF",
  },
  {
    value: "action.primary",
    label: "Action primary",
    css: "var(--primary)",
    fallback: "#087F73FF",
  },
  {
    value: "action.onPrimary",
    label: "On action",
    css: "var(--primary-foreground)",
    fallback: "#FFFFFFFF",
  },
  {
    value: "border.default",
    label: "Border default",
    css: "var(--border)",
    fallback: "#D9DEE8FF",
  },
  {
    value: "transparent",
    label: "Transparent",
    css: "transparent",
    fallback: "#00000000",
  },
]

const SEMANTIC_COLOR_BY_VALUE = new Map(
  SEMANTIC_COLOR_OPTIONS.map((option) => [option.value, option]),
)

const CHECKERBOARD_STYLE: CSSProperties = {
  backgroundColor: "#ffffff",
  backgroundImage:
    "linear-gradient(45deg, #d7dbe2 25%, transparent 25%), linear-gradient(-45deg, #d7dbe2 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #d7dbe2 75%), linear-gradient(-45deg, transparent 75%, #d7dbe2 75%)",
  backgroundPosition: "0 0, 0 4px, 4px -4px, -4px 0",
  backgroundSize: "8px 8px",
}

const RANGE_CLASS =
  "h-3 w-full cursor-pointer appearance-none rounded-full border border-black/10 outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-transparent [&::-moz-range-thumb]:shadow-sm [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-transparent [&::-webkit-slider-thumb]:shadow-sm"

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value))
}

function channelToHex(value: number) {
  return Math.round(clamp(value, 0, 255))
    .toString(16)
    .padStart(2, "0")
    .toUpperCase()
}

function channelsToLiteral(color: ColorChannels): ProtocolColor {
  return `#${channelToHex(color.red)}${channelToHex(color.green)}${channelToHex(color.blue)}${channelToHex(color.alpha * 255)}`
}

function parseLiteralColor(value: string): ColorChannels | null {
  const match = /^#?([\dA-Fa-f]{6})([\dA-Fa-f]{2})?$/.exec(value.trim())
  if (!match) return null
  const rgb = match[1]
  if (!rgb) return null
  const alpha = match[2] ?? "FF"
  return {
    red: Number.parseInt(rgb.slice(0, 2), 16),
    green: Number.parseInt(rgb.slice(2, 4), 16),
    blue: Number.parseInt(rgb.slice(4, 6), 16),
    alpha: Number.parseInt(alpha, 16) / 255,
  }
}

function resolvedChannels(value: ProtocolColor, document?: MosaicDocument): ColorChannels {
  const resolved = document ? resolveColorToken(document, value) : value
  const literal =
    typeof resolved === "string" && resolved.startsWith("#")
      ? resolved
      : typeof resolved === "string"
        ? SEMANTIC_COLOR_BY_VALUE.get(resolved as SemanticProtocolColor)?.fallback
        : undefined
  return (
    parseLiteralColor(literal ?? "#172033FF") ?? {
      red: 23,
      green: 32,
      blue: 51,
      alpha: 1,
    }
  )
}

function colorCss(value: ProtocolColor, document?: MosaicDocument) {
  if (document) return resolvedProtocolColor(document, value) ?? "transparent"
  if (typeof value !== "string") return "transparent"
  if (!value.startsWith("#")) {
    return SEMANTIC_COLOR_BY_VALUE.get(value as SemanticProtocolColor)?.css ?? "transparent"
  }
  const channels = resolvedChannels(value, document)
  return `rgba(${channels.red}, ${channels.green}, ${channels.blue}, ${channels.alpha})`
}

function normalizedColor(value: string): ProtocolColor {
  const trimmed = value.trim()
  if (SEMANTIC_COLOR_BY_VALUE.has(trimmed as SemanticProtocolColor)) {
    return trimmed as SemanticProtocolColor
  }
  const channels = parseLiteralColor(trimmed)
  return channels ? channelsToLiteral(channels) : (value as ProtocolColor)
}

function rgbToHsv({ blue, green, red }: ColorChannels): HsvColor {
  const r = red / 255
  const g = green / 255
  const b = blue / 255
  const maximum = Math.max(r, g, b)
  const minimum = Math.min(r, g, b)
  const delta = maximum - minimum
  let hue = 0

  if (delta > 0) {
    if (maximum === r) hue = 60 * (((g - b) / delta) % 6)
    else if (maximum === g) hue = 60 * ((b - r) / delta + 2)
    else hue = 60 * ((r - g) / delta + 4)
  }

  return {
    hue: hue < 0 ? hue + 360 : hue,
    saturation: maximum === 0 ? 0 : delta / maximum,
    value: maximum,
  }
}

function hsvToRgb({ hue, saturation, value }: HsvColor): Omit<ColorChannels, "alpha"> {
  const chroma = value * saturation
  const segment = (((hue % 360) + 360) % 360) / 60
  const x = chroma * (1 - Math.abs((segment % 2) - 1))
  let red = 0
  let green = 0
  let blue = 0

  if (segment < 1) [red, green] = [chroma, x]
  else if (segment < 2) [red, green] = [x, chroma]
  else if (segment < 3) [green, blue] = [chroma, x]
  else if (segment < 4) [green, blue] = [x, chroma]
  else if (segment < 5) [red, blue] = [x, chroma]
  else [red, blue] = [chroma, x]

  const match = value - chroma
  return {
    red: (red + match) * 255,
    green: (green + match) * 255,
    blue: (blue + match) * 255,
  }
}

function ColorSwatch({
  color,
  className,
  document,
}: {
  color: ProtocolColor
  className?: string
  document?: MosaicDocument
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative block overflow-hidden rounded-[4px] border border-black/15",
        className,
      )}
      style={CHECKERBOARD_STYLE}
    >
      <span className="absolute inset-0" style={{ background: colorCss(color, document) }} />
    </span>
  )
}

function TokenPalette({
  disabled,
  document,
  onChange,
  onCommit,
  value,
}: {
  disabled: boolean
  document?: MosaicDocument
  onChange: (value: ProtocolColor) => void
  onCommit: () => void
  value: ProtocolColor
}) {
  return (
    <div className="space-y-3 p-3">
      {document?.designSystem.colors.length ? (
        <div>
          <p className="text-muted-foreground mb-1.5 text-[10px] font-semibold tracking-wide uppercase">
            Design system
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {document.designSystem.colors.map((token) => {
              const tokenValue: ProtocolColor = { type: "colorToken", id: token.id }
              const selected = isColorTokenReference(value) && value.id === token.id
              return (
                <button
                  aria-pressed={selected}
                  className={cn(
                    "hover:bg-muted focus-visible:ring-ring/40 flex min-w-0 items-center gap-2 rounded-lg border px-2 py-2 text-left text-xs outline-none focus-visible:ring-2 active:scale-[0.98] motion-reduce:transform-none",
                    selected ? "border-primary bg-primary/8" : "border-transparent",
                  )}
                  disabled={disabled}
                  key={token.id}
                  onClick={() => {
                    onChange(tokenValue)
                    onCommit()
                  }}
                  type="button"
                >
                  <ColorSwatch className="size-5 shrink-0" color={tokenValue} document={document} />
                  <span className="min-w-0 flex-1 truncate">{token.name}</span>
                  {selected ? <CheckIcon aria-hidden className="text-primary size-3.5" /> : null}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
      <div>
        <p className="text-muted-foreground mb-1.5 text-[10px] font-semibold tracking-wide uppercase">
          Mosaic defaults
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {SEMANTIC_COLOR_OPTIONS.map((option) => {
            const selected = option.value === value
            return (
              <button
                aria-pressed={selected}
                className={cn(
                  "hover:bg-muted focus-visible:ring-ring/40 flex min-w-0 items-center gap-2 rounded-lg border px-2 py-2 text-left text-xs transition-colors outline-none focus-visible:ring-2 active:scale-[0.98] motion-reduce:transform-none",
                  selected ? "border-primary bg-primary/8" : "border-transparent",
                )}
                disabled={disabled}
                key={option.value}
                onClick={() => {
                  onChange(option.value)
                  onCommit()
                }}
                type="button"
              >
                <ColorSwatch className="size-5 shrink-0" color={option.value} document={document} />
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {selected ? (
                  <CheckIcon aria-hidden className="text-primary size-3.5 shrink-0" />
                ) : null}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function CustomColorPicker({
  disabled,
  document,
  onBegin,
  onCancel,
  onChange,
  onCommit,
  value,
}: {
  disabled: boolean
  document?: MosaicDocument
  onBegin: () => void
  onCancel: () => void
  onChange: (value: ProtocolColor) => void
  onCommit: () => void
  value: ProtocolColor
}) {
  const channels = useMemo(() => resolvedChannels(value, document), [document, value])
  const hsv = useMemo(() => rgbToHsv(channels), [channels])
  const rgb = hsvToRgb(hsv)
  const customAlpha = value === "transparent" ? 1 : channels.alpha

  function updateHsv(next: HsvColor) {
    onChange(channelsToLiteral({ ...hsvToRgb(next), alpha: customAlpha }))
  }

  function updatePlane(event: ReactPointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    updateHsv({
      hue: hsv.hue,
      saturation: clamp((event.clientX - bounds.left) / bounds.width),
      value: 1 - clamp((event.clientY - bounds.top) / bounds.height),
    })
  }

  function keyboardPlane(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 0.1 : 0.01
    let next: HsvColor
    if (event.key === "ArrowLeft") next = { ...hsv, saturation: clamp(hsv.saturation - step) }
    else if (event.key === "ArrowRight") {
      next = { ...hsv, saturation: clamp(hsv.saturation + step) }
    } else if (event.key === "ArrowUp") next = { ...hsv, value: clamp(hsv.value + step) }
    else if (event.key === "ArrowDown") next = { ...hsv, value: clamp(hsv.value - step) }
    else if (event.key === "Escape") {
      event.preventDefault()
      onCancel()
      return
    } else return

    event.preventDefault()
    onBegin()
    updateHsv(next)
  }

  const rgbHex = `${channelToHex(channels.red)}${channelToHex(channels.green)}${channelToHex(channels.blue)}`
  const alphaPercent = Math.round(channels.alpha * 100)
  const alphaTrackStyle: CSSProperties = {
    backgroundColor: "#ffffff",
    backgroundImage: `linear-gradient(to right, rgba(${Math.round(rgb.red)}, ${Math.round(rgb.green)}, ${Math.round(rgb.blue)}, 0), rgb(${Math.round(rgb.red)}, ${Math.round(rgb.green)}, ${Math.round(rgb.blue)})), ${CHECKERBOARD_STYLE.backgroundImage}`,
    backgroundPosition: "0 0, 0 0, 0 4px, 4px -4px, -4px 0",
    backgroundSize: "100% 100%, 8px 8px, 8px 8px, 8px 8px, 8px 8px",
  }

  return (
    <div className="space-y-3 p-3 pt-2">
      <div
        aria-label="Colour saturation and brightness"
        aria-valuetext={`Saturation ${Math.round(hsv.saturation * 100)}%, brightness ${Math.round(hsv.value * 100)}%`}
        className="focus-visible:ring-ring/50 relative h-36 cursor-crosshair touch-none overflow-hidden rounded-lg border border-black/10 outline-none focus-visible:ring-2"
        onBlur={onCommit}
        onKeyDown={keyboardPlane}
        onKeyUp={(event) => {
          if (event.key.startsWith("Arrow")) onCommit()
        }}
        onPointerCancel={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
          onCancel()
        }}
        onPointerDown={(event) => {
          if (disabled) return
          onBegin()
          event.currentTarget.setPointerCapture(event.pointerId)
          updatePlane(event)
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) updatePlane(event)
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            updatePlane(event)
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
          onCommit()
        }}
        role="slider"
        style={{
          backgroundColor: `hsl(${hsv.hue} 100% 50%)`,
          backgroundImage:
            "linear-gradient(to top, #000000, transparent), linear-gradient(to right, #ffffff, transparent)",
        }}
        tabIndex={disabled ? -1 : 0}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_1px_3px_rgba(0,0,0,0.65)]"
          style={{
            background: colorCss(value, document),
            left: `${hsv.saturation * 100}%`,
            top: `${(1 - hsv.value) * 100}%`,
          }}
        />
      </div>

      <div className="flex items-center gap-2.5">
        <label
          className="hover:bg-muted focus-within:ring-ring/40 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md focus-within:ring-2"
          title="Open system colour picker"
        >
          <EyedropperIcon aria-hidden className="size-4" />
          <span className="sr-only">Open system colour picker</span>
          <input
            className="sr-only"
            disabled={disabled}
            onBlur={onCommit}
            onChange={(event) => {
              const picked = parseLiteralColor(event.target.value)
              if (!picked) return
              onBegin()
              onChange(channelsToLiteral({ ...picked, alpha: customAlpha }))
            }}
            type="color"
            value={`#${rgbHex}`}
          />
        </label>
        <div className="min-w-0 flex-1 space-y-2.5">
          <input
            aria-label="Hue"
            className={RANGE_CLASS}
            disabled={disabled}
            max={360}
            min={0}
            onBlur={onCommit}
            onChange={(event) => {
              onBegin()
              updateHsv({ ...hsv, hue: Number(event.target.value) })
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") onCancel()
              else if (event.key.startsWith("Arrow")) onBegin()
            }}
            onPointerDown={onBegin}
            onPointerUp={onCommit}
            step={1}
            style={{
              background:
                "linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)",
            }}
            type="range"
            value={Math.round(hsv.hue)}
          />
          <input
            aria-label="Colour opacity"
            className={RANGE_CLASS}
            disabled={disabled}
            max={100}
            min={0}
            onBlur={onCommit}
            onChange={(event) => {
              onBegin()
              onChange(channelsToLiteral({ ...channels, alpha: Number(event.target.value) / 100 }))
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") onCancel()
              else if (event.key.startsWith("Arrow")) onBegin()
            }}
            onPointerDown={onBegin}
            onPointerUp={onCommit}
            step={1}
            style={alphaTrackStyle}
            type="range"
            value={alphaPercent}
          />
        </div>
      </div>

      <div className="border-input bg-background focus-within:border-ring focus-within:ring-ring/30 flex h-8 overflow-hidden rounded-md border focus-within:ring-2">
        <span className="text-muted-foreground flex w-12 shrink-0 items-center justify-center border-r text-[10px] font-semibold tracking-wide">
          HEX
        </span>
        <input
          aria-label="Hex colour"
          className="min-w-0 flex-1 bg-transparent px-2 font-mono text-xs uppercase outline-none"
          disabled={disabled}
          maxLength={6}
          onBlur={onCommit}
          onChange={(event) => {
            if (!/^[\dA-Fa-f]{6}$/.test(event.target.value)) return
            onBegin()
            const next = parseLiteralColor(`#${event.target.value}`)
            if (next) onChange(channelsToLiteral({ ...next, alpha: customAlpha }))
          }}
          onFocus={onBegin}
          value={rgbHex}
        />
        <span className="text-muted-foreground flex items-center border-l px-2 text-xs tabular-nums">
          {alphaPercent}
          <PercentIcon aria-hidden className="ml-1 size-3" />
        </span>
      </div>
    </div>
  )
}

export function InspectorColorControl({
  describedBy,
  disabled = false,
  document,
  id,
  invalid = false,
  label,
  onBegin,
  onCancel,
  onChange,
  onCommit,
  value,
}: {
  describedBy?: string
  disabled?: boolean
  document?: MosaicDocument
  id: string
  invalid?: boolean
  label: string
  onBegin: () => void
  onCancel: () => void
  onChange: (value: ProtocolColor) => void
  onCommit: () => void
  value: ProtocolColor
}) {
  const [open, setOpen] = useState(false)
  const [panel, setPanel] = useState<"custom" | "tokens">(() =>
    typeof value === "string" && value.startsWith("#") ? "custom" : "tokens",
  )
  const channels = useMemo(() => resolvedChannels(value, document), [document, value])
  const alphaPercent = Math.round(channels.alpha * 100)

  function changeAlpha(nextPercent: number) {
    if (!Number.isFinite(nextPercent)) return
    onBegin()
    onChange(channelsToLiteral({ ...channels, alpha: clamp(nextPercent / 100) }))
  }

  return (
    <Popover
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (nextOpen) {
          setPanel(typeof value === "string" && value.startsWith("#") ? "custom" : "tokens")
        } else onCommit()
      }}
      open={open}
    >
      <div
        className={cn(
          "border-input bg-background focus-within:border-ring focus-within:ring-ring/30 flex h-8 min-w-0 overflow-hidden rounded-md border focus-within:ring-2",
          invalid && "border-destructive ring-destructive/20",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        <PopoverTrigger
          render={
            <button
              aria-label={`Open ${label} colour picker`}
              className="focus-visible:ring-ring/50 m-1 flex size-6 shrink-0 items-center justify-center rounded-[5px] outline-none focus-visible:ring-2 active:scale-[0.95] motion-reduce:transform-none"
              disabled={disabled}
              title={`Choose ${label.toLowerCase()}`}
              type="button"
            />
          }
        >
          <ColorSwatch className="size-4" color={value} document={document} />
        </PopoverTrigger>
        <input
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className="min-w-0 flex-1 bg-transparent px-1.5 font-mono text-[11px] outline-none"
          disabled={disabled}
          id={id}
          onBlur={(event) => {
            if (isColorTokenReference(value)) {
              onCommit()
              return
            }
            const normalized = normalizedColor(event.target.value)
            if (normalized !== value) onChange(normalized)
            onCommit()
          }}
          onChange={(event) => {
            if (isColorTokenReference(value)) return
            onBegin()
            onChange(event.target.value as ProtocolColor)
          }}
          onFocus={onBegin}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return
            event.preventDefault()
            onCancel()
            event.currentTarget.blur()
          }}
          spellCheck={false}
          readOnly={isColorTokenReference(value)}
          type="text"
          value={
            document
              ? protocolColorLabel(document, value)
              : typeof value === "string"
                ? value
                : value.id
          }
        />
        <span aria-hidden className="bg-border my-1.5 w-px shrink-0" />
        <input
          aria-label={`${label} opacity`}
          className="w-10 bg-transparent px-1 text-right text-[11px] tabular-nums outline-none"
          disabled={disabled}
          max={100}
          min={0}
          onBlur={onCommit}
          onChange={(event) => changeAlpha(event.target.valueAsNumber)}
          onFocus={onBegin}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return
            event.preventDefault()
            onCancel()
            event.currentTarget.blur()
          }}
          step={1}
          type="number"
          value={alphaPercent}
        />
        <PercentIcon aria-hidden className="text-muted-foreground my-auto mr-2 size-3 shrink-0" />
      </div>

      <PopoverContent
        align="start"
        className="w-80 overflow-hidden p-0"
        side="left"
        sideOffset={10}
      >
        <PopoverTitle className="sr-only">{label} colour</PopoverTitle>
        <PopoverDescription className="sr-only">
          Choose a Mosaic semantic token or define a custom RGBA colour.
        </PopoverDescription>
        <div className="border-border flex items-center justify-between border-b px-2 py-2">
          <div className="bg-muted flex rounded-lg p-0.5" role="tablist">
            {(["custom", "tokens"] as const).map((candidate) => (
              <button
                aria-selected={panel === candidate}
                className={cn(
                  "focus-visible:ring-ring/40 rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors outline-none focus-visible:ring-2",
                  panel === candidate
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
                key={candidate}
                onClick={() => setPanel(candidate)}
                role="tab"
                type="button"
              >
                {candidate === "tokens" ? "Mosaic tokens" : "Custom"}
              </button>
            ))}
          </div>
          <ColorSwatch className="size-6" color={value} document={document} />
        </div>
        {panel === "custom" ? (
          <CustomColorPicker
            disabled={disabled}
            document={document}
            onBegin={onBegin}
            onCancel={onCancel}
            onChange={onChange}
            onCommit={onCommit}
            value={value}
          />
        ) : (
          <TokenPalette
            disabled={disabled}
            document={document}
            onChange={(next) => {
              onBegin()
              onChange(next)
            }}
            onCommit={onCommit}
            value={value}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}
