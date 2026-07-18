import { ArrowDownIcon } from "@phosphor-icons/react/dist/ssr/ArrowDown"
import { ArrowUpIcon } from "@phosphor-icons/react/dist/ssr/ArrowUp"
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr/CaretRight"
import { CopyIcon } from "@phosphor-icons/react/dist/ssr/Copy"
import { PlusIcon } from "@phosphor-icons/react/dist/ssr/Plus"
import { TrashIcon } from "@phosphor-icons/react/dist/ssr/Trash"
import { StatusMessage } from "@mosaic/design-system"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { InspectorColorControl } from "@/features/paywall-editor/components/inspector-color-control"
import {
  useEditorActions,
  useEditorStore,
} from "@/features/paywall-editor/stores/editor-store-context"
import type {
  MosaicDocument,
  PaywallDesignSystem,
  ProtocolBackground,
  ProtocolColor,
  ProtocolShadow,
} from "@/features/paywall-editor/types/editor"
import { cloneValue } from "@/features/paywall-editor/utils/clone"
import {
  appendBackgroundAsset,
  clampGradientAngle,
  defaultMediaBackground,
  insertGradientStop,
  isSafeTokenReplacement,
  tokenReferenceType,
  updateGradientStopPosition,
} from "@/features/paywall-editor/utils/style-authoring"
import type { DesignCategory } from "@/features/paywall-editor/utils/style-authoring"
import type {
  MosaicPaywallV02BackgroundToken,
  MosaicPaywallV02ColorToken,
  MosaicPaywallV02ShadowToken,
} from "@/lib/mosaic-protocol"

type DesignToken =
  MosaicPaywallV02ColorToken | MosaicPaywallV02BackgroundToken | MosaicPaywallV02ShadowToken

interface PendingDelete {
  readonly category: DesignCategory
  readonly id: string
}

const FIELD_CLASS =
  "border-input bg-background focus:border-ring focus:ring-ring/30 h-8 min-w-0 rounded-md border px-2 text-xs outline-none focus:ring-2"

function replaceTokenReferences(
  value: unknown,
  referenceType: string,
  id: string,
  replacement: unknown,
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => replaceTokenReferences(entry, referenceType, id, replacement))
  }
  if (!value || typeof value !== "object") return value
  const record = value as Record<string, unknown>
  if (record.type === referenceType && record.id === id) return cloneValue(replacement)
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [
      key,
      replaceTokenReferences(entry, referenceType, id, replacement),
    ]),
  )
}

function countTokenReferences(value: unknown, referenceType: string, id: string): number {
  if (Array.isArray(value)) {
    return value.reduce((total, entry) => total + countTokenReferences(entry, referenceType, id), 0)
  }
  if (!value || typeof value !== "object") return 0
  const record = value as Record<string, unknown>
  return (
    (record.type === referenceType && record.id === id ? 1 : 0) +
    Object.values(record).reduce<number>(
      (total, entry) => total + countTokenReferences(entry, referenceType, id),
      0,
    )
  )
}

function nextTokenId(tokens: readonly DesignToken[], prefix: string) {
  const used = new Set(tokens.map((token) => token.id))
  let ordinal = tokens.length + 1
  while (used.has(`${prefix}-${ordinal}`)) ordinal += 1
  return `${prefix}-${ordinal}`
}

function tokensFor(system: PaywallDesignSystem, category: DesignCategory): readonly DesignToken[] {
  if (category === "colors") return system.colors
  if (category === "backgrounds") return system.backgrounds
  return system.shadows
}

function SectionHeading({
  count,
  label,
  onAdd,
}: {
  count: number
  label: string
  onAdd: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div>
        <h3 className="text-sm font-semibold">{label}</h3>
        <p className="text-muted-foreground text-[11px]">
          {count} {count === 1 ? "style" : "styles"}
        </p>
      </div>
      <Button
        aria-label={`Add ${label.toLowerCase()} style`}
        onClick={onAdd}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <PlusIcon aria-hidden />
      </Button>
    </div>
  )
}

function TokenActions({
  canMoveDown,
  canMoveUp,
  name,
  onDelete,
  onDuplicate,
  onMove,
}: {
  canMoveDown: boolean
  canMoveUp: boolean
  name: string
  onDelete: () => void
  onDuplicate: () => void
  onMove: (offset: -1 | 1) => void
}) {
  return (
    <div className="flex shrink-0">
      <Button
        aria-label={`Move ${name} up`}
        disabled={!canMoveUp}
        onClick={() => onMove(-1)}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <ArrowUpIcon aria-hidden />
      </Button>
      <Button
        aria-label={`Move ${name} down`}
        disabled={!canMoveDown}
        onClick={() => onMove(1)}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <ArrowDownIcon aria-hidden />
      </Button>
      <Button
        aria-label={`Duplicate ${name}`}
        onClick={onDuplicate}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <CopyIcon aria-hidden />
      </Button>
      <Button
        aria-label={`Delete ${name}`}
        onClick={onDelete}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <TrashIcon aria-hidden />
      </Button>
    </div>
  )
}

function TokenSummary({
  editorId,
  name,
  onToggle,
  open,
  summary,
}: {
  editorId: string
  name: string
  onToggle: () => void
  open: boolean
  summary: string
}) {
  return (
    <button
      aria-controls={editorId}
      aria-expanded={open}
      className="hover:bg-muted/60 focus-visible:ring-ring flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1 text-left focus-visible:ring-2 focus-visible:outline-none"
      onClick={onToggle}
      type="button"
    >
      <CaretRightIcon
        aria-hidden
        className={`size-3.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
      />
      <span className="min-w-0 flex-1 truncate text-xs font-medium">{name}</span>
      <span className="text-muted-foreground max-w-24 truncate text-[11px]">{summary}</span>
    </button>
  )
}

function ColorControl({
  document,
  id,
  label,
  onChange,
  value,
}: {
  document: MosaicDocument
  id: string
  label: string
  onChange: (value: ProtocolColor) => void
  value: ProtocolColor
}) {
  const editor = useEditorActions()
  return (
    <>
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <InspectorColorControl
        document={document}
        id={id}
        label={label}
        onBegin={() => editor.beginDocumentTransaction()}
        onCancel={() => editor.cancelDocumentTransaction()}
        onChange={onChange}
        onCommit={() => editor.commitDocumentTransaction()}
        value={value}
      />
    </>
  )
}

function BackgroundEditor({
  document,
  id,
  onAddMedia,
  onChange,
  value,
}: {
  document: MosaicDocument
  id: string
  onAddMedia: (type: "image" | "video") => void
  onChange: (value: ProtocolBackground) => void
  value: ProtocolBackground
}) {
  const images = document.assets.filter((asset) => asset.type === "image")
  const videos = document.assets.filter((asset) => asset.type === "video")
  function changeType(type: ProtocolBackground["type"]) {
    if (type === "color") onChange({ type, value: "surface.default" })
    else if (type === "linearGradient") {
      onChange({
        type,
        angle: 180,
        stops: [
          { position: 0, color: "surface.default" },
          { position: 1, color: "surface.elevated" },
        ],
      })
    } else if (type === "radialGradient") {
      onChange({
        type,
        center: { x: 0.5, y: 0.5 },
        radius: 0.75,
        stops: [
          { position: 0, color: "surface.elevated" },
          { position: 1, color: "surface.default" },
        ],
      })
    } else if (type === "image") {
      if (images[0]) onChange(defaultMediaBackground(type, images[0].id))
    } else if (type === "video") {
      if (videos[0]) onChange(defaultMediaBackground(type, videos[0].id))
    }
  }
  const selectedMediaExists =
    value.type === "image" || value.type === "video"
      ? document.assets.some((asset) => asset.type === value.type && asset.id === value.assetId)
      : true
  return (
    <div className="space-y-2">
      <select
        aria-label="Background kind"
        className={FIELD_CLASS}
        onChange={(event) => changeType(event.target.value as ProtocolBackground["type"])}
        value={value.type}
      >
        <option value="color">Colour</option>
        <option value="linearGradient">Linear gradient</option>
        <option value="radialGradient">Radial gradient</option>
        <option disabled={images.length === 0 && value.type !== "image"} value="image">
          Image
        </option>
        <option disabled={videos.length === 0 && value.type !== "video"} value="video">
          Video
        </option>
      </select>
      {images.length === 0 || videos.length === 0 || !selectedMediaExists ? (
        <div className="border-border bg-muted/30 flex flex-wrap gap-1.5 rounded-md border p-2">
          {!selectedMediaExists ? (
            <p className="text-muted-foreground w-full text-[11px] leading-4">
              The selected media asset is missing. Add a replacement to keep this style valid.
            </p>
          ) : null}
          {images.length === 0 || (value.type === "image" && !selectedMediaExists) ? (
            <Button onClick={() => onAddMedia("image")} size="xs" type="button" variant="outline">
              <PlusIcon aria-hidden /> Add image
            </Button>
          ) : null}
          {videos.length === 0 || (value.type === "video" && !selectedMediaExists) ? (
            <Button onClick={() => onAddMedia("video")} size="xs" type="button" variant="outline">
              <PlusIcon aria-hidden /> Add video
            </Button>
          ) : null}
        </div>
      ) : null}
      {value.type === "color" ? (
        <ColorControl
          document={document}
          id={`${id}-colour`}
          label="Colour"
          onChange={(color) => onChange({ ...value, value: color })}
          value={value.value}
        />
      ) : null}
      {value.type === "linearGradient" ? (
        <label className="grid gap-1 text-[11px]">
          <span className="text-muted-foreground">Angle</span>
          <input
            className={FIELD_CLASS}
            max={360}
            min={0}
            onChange={(event) =>
              onChange({ ...value, angle: clampGradientAngle(event.target.valueAsNumber) })
            }
            type="number"
            value={value.angle}
          />
        </label>
      ) : null}
      {value.type === "radialGradient" ? (
        <div className="grid grid-cols-3 gap-1.5">
          {(["x", "y"] as const).map((axis) => (
            <label className="grid gap-1 text-[11px]" key={axis}>
              <span className="text-muted-foreground">Centre {axis.toUpperCase()}</span>
              <input
                className={FIELD_CLASS}
                max={100}
                min={0}
                onChange={(event) =>
                  onChange({
                    ...value,
                    center: { ...value.center, [axis]: event.target.valueAsNumber / 100 },
                  })
                }
                type="number"
                value={Math.round(value.center[axis] * 100)}
              />
            </label>
          ))}
          <label className="grid gap-1 text-[11px]">
            <span className="text-muted-foreground">Radius</span>
            <input
              className={FIELD_CLASS}
              max={200}
              min={1}
              onChange={(event) => onChange({ ...value, radius: event.target.valueAsNumber / 100 })}
              type="number"
              value={Math.round(value.radius * 100)}
            />
          </label>
        </div>
      ) : null}
      {value.type === "linearGradient" || value.type === "radialGradient" ? (
        <div className="space-y-2">
          {value.stops.map((stop, index) => (
            <div className="grid grid-cols-[1fr_4rem_auto] items-end gap-1.5" key={index}>
              <ColorControl
                document={document}
                id={`${id}-stop-${index}`}
                label={`Stop ${index + 1}`}
                onChange={(color) =>
                  onChange({
                    ...value,
                    stops: value.stops.map((entry, current) =>
                      current === index ? { ...entry, color } : entry,
                    ),
                  })
                }
                value={stop.color}
              />
              <input
                aria-label={`Stop ${index + 1} position`}
                className={FIELD_CLASS}
                max={100}
                min={0}
                onChange={(event) =>
                  onChange({
                    ...value,
                    stops: updateGradientStopPosition(
                      value.stops,
                      index,
                      event.target.valueAsNumber / 100,
                    ),
                  })
                }
                type="number"
                value={Math.round(stop.position * 100)}
              />
              <Button
                aria-label={`Delete stop ${index + 1}`}
                disabled={value.stops.length <= 2}
                onClick={() =>
                  onChange({
                    ...value,
                    stops: value.stops.filter((_, current) => current !== index),
                  })
                }
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <TrashIcon aria-hidden />
              </Button>
            </div>
          ))}
          <Button
            disabled={value.stops.length >= 8}
            onClick={() =>
              onChange({
                ...value,
                stops: insertGradientStop(value.stops),
              })
            }
            size="xs"
            type="button"
            variant="outline"
          >
            <PlusIcon aria-hidden /> Add stop
          </Button>
        </div>
      ) : null}
      {value.type === "image" || value.type === "video" ? (
        <>
          <select
            aria-label={`${value.type} asset`}
            className={FIELD_CLASS}
            onChange={(event) => onChange({ ...value, assetId: event.target.value })}
            value={value.assetId}
          >
            {(value.type === "image" ? images : videos).map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.id}
              </option>
            ))}
          </select>
          <select
            aria-label="Content mode"
            className={FIELD_CLASS}
            onChange={(event) =>
              onChange({ ...value, contentMode: event.target.value as "fit" | "fill" })
            }
            value={value.contentMode}
          >
            <option value="fit">Fit</option>
            <option value="fill">Fill</option>
          </select>
          {value.type === "video" ? (
            <select
              aria-label="Poster image"
              className={FIELD_CLASS}
              onChange={(event) =>
                onChange({ ...value, posterAssetId: event.target.value || undefined })
              }
              value={value.posterAssetId ?? ""}
            >
              <option value="">No poster</option>
              {images.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.id}
                </option>
              ))}
            </select>
          ) : null}
          <ColorControl
            document={document}
            id={`${id}-fallback`}
            label="Fallback colour"
            onChange={(fallbackColor) => onChange({ ...value, fallbackColor })}
            value={value.fallbackColor}
          />
        </>
      ) : null}
    </div>
  )
}

function ShadowEditor({
  document,
  id,
  onChange,
  value,
}: {
  document: MosaicDocument
  id: string
  onChange: (value: ProtocolShadow) => void
  value: ProtocolShadow
}) {
  if (value.type === "shadowToken") {
    return <p className="text-muted-foreground text-[11px]">Linked to shadow {value.id}</p>
  }
  return (
    <div className="space-y-2">
      <ColorControl
        document={document}
        id={`${id}-colour`}
        label="Shadow colour"
        onChange={(color) => onChange({ ...value, color })}
        value={value.color}
      />
      <div className="grid grid-cols-3 gap-1.5">
        {(["offsetX", "offsetY", "blurRadius"] as const).map((property) => (
          <label className="grid gap-1 text-[11px]" key={property}>
            <span className="text-muted-foreground">
              {property === "offsetX" ? "X" : property === "offsetY" ? "Y" : "Blur"}
            </span>
            <input
              className={FIELD_CLASS}
              max={4096}
              min={property === "blurRadius" ? 0 : -4096}
              onChange={(event) => onChange({ ...value, [property]: event.target.valueAsNumber })}
              type="number"
              value={value[property]}
            />
          </label>
        ))}
      </div>
    </div>
  )
}

export function DesignSystemPanel() {
  const { document } = useEditorStore()
  const editor = useEditorActions()
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const [replacementId, setReplacementId] = useState("detach")
  const [openEditor, setOpenEditor] = useState<PendingDelete | null>(null)

  if (!document) return null
  const designSystem = document.designSystem

  function updateSystem(updater: (current: PaywallDesignSystem) => PaywallDesignSystem) {
    editor.updateDocument((current) => ({
      ...current,
      designSystem: updater(current.designSystem),
    }))
  }

  function updateColor(
    id: string,
    updater: (token: MosaicPaywallV02ColorToken) => MosaicPaywallV02ColorToken,
  ) {
    updateSystem((current) => ({
      ...current,
      colors: current.colors.map((token) => (token.id === id ? updater(token) : token)),
    }))
  }
  function updateBackground(
    id: string,
    updater: (token: MosaicPaywallV02BackgroundToken) => MosaicPaywallV02BackgroundToken,
  ) {
    updateSystem((current) => ({
      ...current,
      backgrounds: current.backgrounds.map((token) => (token.id === id ? updater(token) : token)),
    }))
  }
  function updateShadow(
    id: string,
    updater: (token: MosaicPaywallV02ShadowToken) => MosaicPaywallV02ShadowToken,
  ) {
    updateSystem((current) => ({
      ...current,
      shadows: current.shadows.map((token) => (token.id === id ? updater(token) : token)),
    }))
  }

  function deleteNow(category: DesignCategory, id: string) {
    updateSystem((current) => {
      if (category === "colors")
        return { ...current, colors: current.colors.filter((token) => token.id !== id) }
      if (category === "backgrounds")
        return { ...current, backgrounds: current.backgrounds.filter((token) => token.id !== id) }
      return { ...current, shadows: current.shadows.filter((token) => token.id !== id) }
    })
    if (openEditor?.category === category && openEditor.id === id) setOpenEditor(null)
  }

  function requestDelete(category: DesignCategory, id: string) {
    if (countTokenReferences(document, tokenReferenceType(category), id) === 0) {
      deleteNow(category, id)
      return
    }
    setReplacementId("detach")
    setPendingDelete({ category, id })
  }

  function confirmDelete() {
    if (!pendingDelete) return
    const tokens = tokensFor(designSystem, pendingDelete.category)
    const currentToken = tokens.find((token) => token.id === pendingDelete.id)
    if (!currentToken) return
    const replacementToken = tokens.find((token) => token.id === replacementId)
    if (
      replacementToken &&
      !isSafeTokenReplacement(
        designSystem,
        pendingDelete.category,
        pendingDelete.id,
        replacementToken.id,
      )
    ) {
      setReplacementId("detach")
      return
    }
    const replacement = replacementToken
      ? { type: tokenReferenceType(pendingDelete.category), id: replacementToken.id }
      : cloneValue(currentToken.value)
    editor.updateDocument((current) => {
      const replaced = replaceTokenReferences(
        current,
        tokenReferenceType(pendingDelete.category),
        pendingDelete.id,
        replacement,
      ) as MosaicDocument
      if (pendingDelete.category === "colors")
        return {
          ...replaced,
          designSystem: {
            ...replaced.designSystem,
            colors: replaced.designSystem.colors.filter((token) => token.id !== pendingDelete.id),
          },
        }
      if (pendingDelete.category === "backgrounds")
        return {
          ...replaced,
          designSystem: {
            ...replaced.designSystem,
            backgrounds: replaced.designSystem.backgrounds.filter(
              (token) => token.id !== pendingDelete.id,
            ),
          },
        }
      return {
        ...replaced,
        designSystem: {
          ...replaced.designSystem,
          shadows: replaced.designSystem.shadows.filter((token) => token.id !== pendingDelete.id),
        },
      }
    })
    setPendingDelete(null)
    if (openEditor?.category === pendingDelete.category && openEditor.id === pendingDelete.id) {
      setOpenEditor(null)
    }
  }

  function addColor() {
    const id = nextTokenId(designSystem.colors, "colour")
    updateSystem((current) => ({
      ...current,
      colors: [
        ...current.colors,
        { id, name: `Colour ${current.colors.length + 1}`, value: "#087F73FF" },
      ],
    }))
    setOpenEditor({ category: "colors", id })
  }

  function addBackground() {
    const id = nextTokenId(designSystem.backgrounds, "background")
    updateSystem((current) => ({
      ...current,
      backgrounds: [
        ...current.backgrounds,
        {
          id,
          name: `Background ${current.backgrounds.length + 1}`,
          value: { type: "color", value: "surface.default" },
        },
      ],
    }))
    setOpenEditor({ category: "backgrounds", id })
  }

  function addShadow() {
    const id = nextTokenId(designSystem.shadows, "shadow")
    updateSystem((current) => ({
      ...current,
      shadows: [
        ...current.shadows,
        {
          id,
          name: `Shadow ${current.shadows.length + 1}`,
          value: {
            type: "shadow",
            color: "#00000033",
            offsetX: 0,
            offsetY: 8,
            blurRadius: 24,
          },
        },
      ],
    }))
    setOpenEditor({ category: "shadows", id })
  }

  function addMediaBackground(id: string, type: "image" | "video") {
    editor.updateDocument((current) => {
      const result = appendBackgroundAsset(current, type)
      return {
        ...result.document,
        designSystem: {
          ...result.document.designSystem,
          backgrounds: result.document.designSystem.backgrounds.map((token) =>
            token.id === id
              ? { ...token, value: defaultMediaBackground(type, result.assetId) }
              : token,
          ),
        },
      }
    })
  }

  function toggleEditor(category: DesignCategory, id: string) {
    setOpenEditor((current) =>
      current?.category === category && current.id === id ? null : { category, id },
    )
  }

  function move(category: DesignCategory, id: string, offset: -1 | 1) {
    updateSystem((current) => {
      const reorder = <Token extends DesignToken>(tokens: readonly Token[]) => {
        const index = tokens.findIndex((token) => token.id === id)
        const target = index + offset
        if (index < 0 || target < 0 || target >= tokens.length) return [...tokens]
        const next = [...tokens]
        const [token] = next.splice(index, 1)
        if (token) next.splice(target, 0, token)
        return next
      }
      if (category === "colors") return { ...current, colors: reorder(current.colors) }
      if (category === "backgrounds")
        return { ...current, backgrounds: reorder(current.backgrounds) }
      return { ...current, shadows: reorder(current.shadows) }
    })
  }

  function duplicate(category: DesignCategory, id: string) {
    updateSystem((current) => {
      if (category === "colors") {
        const source = current.colors.find((token) => token.id === id)
        return source
          ? {
              ...current,
              colors: [
                ...current.colors,
                {
                  ...cloneValue(source),
                  id: nextTokenId(current.colors, "colour"),
                  name: `${source.name} copy`,
                },
              ],
            }
          : current
      }
      if (category === "backgrounds") {
        const source = current.backgrounds.find((token) => token.id === id)
        return source
          ? {
              ...current,
              backgrounds: [
                ...current.backgrounds,
                {
                  ...cloneValue(source),
                  id: nextTokenId(current.backgrounds, "background"),
                  name: `${source.name} copy`,
                },
              ],
            }
          : current
      }
      const source = current.shadows.find((token) => token.id === id)
      return source
        ? {
            ...current,
            shadows: [
              ...current.shadows,
              {
                ...cloneValue(source),
                id: nextTokenId(current.shadows, "shadow"),
                name: `${source.name} copy`,
              },
            ],
          }
        : current
    })
  }

  return (
    <section aria-labelledby="design-system-panel-title" className="space-y-5">
      <div>
        <h2 className="text-sm font-semibold" id="design-system-panel-title">
          Design System
        </h2>
        <p className="text-muted-foreground mt-0.5 text-xs leading-5">
          Reusable paywall colours, backgrounds, and shadows. Linked changes update every usage.
        </p>
      </div>

      {pendingDelete ? (
        <StatusMessage
          className="border-warning/30 bg-warning/5 space-y-2 rounded-lg border p-3 text-xs"
          tone="warning"
        >
          <p className="font-medium">This style is in use.</p>
          <label className="grid gap-1">
            <span>Replace usages or detach their current values</span>
            <select
              className={FIELD_CLASS}
              onChange={(event) => setReplacementId(event.target.value)}
              value={replacementId}
            >
              <option value="detach">Detach current values</option>
              {tokensFor(designSystem, pendingDelete.category)
                .filter((token) =>
                  isSafeTokenReplacement(
                    designSystem,
                    pendingDelete.category,
                    pendingDelete.id,
                    token.id,
                  ),
                )
                .map((token) => (
                  <option key={token.id} value={token.id}>
                    Replace usages with {token.name}
                  </option>
                ))}
            </select>
          </label>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setPendingDelete(null)} size="sm" type="button" variant="ghost">
              Cancel
            </Button>
            <Button onClick={confirmDelete} size="sm" type="button" variant="destructive">
              Apply and delete
            </Button>
          </div>
        </StatusMessage>
      ) : null}

      <section className="border-border space-y-3 border-t pt-4">
        <SectionHeading count={designSystem.colors.length} label="Colours" onAdd={addColor} />
        {designSystem.colors.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed p-3 text-xs">
            Add colours to make them available at the top of every colour picker.
          </p>
        ) : (
          <ul className="space-y-2">
            {designSystem.colors.map((token, index) => (
              <li className="border-border rounded-lg border p-1" key={token.id}>
                <div className="flex items-center gap-1">
                  <TokenSummary
                    editorId={`design-colour-editor-${token.id}`}
                    name={token.name}
                    onToggle={() => toggleEditor("colors", token.id)}
                    open={openEditor?.category === "colors" && openEditor.id === token.id}
                    summary={
                      typeof token.value === "string" ? token.value : `Linked · ${token.value.id}`
                    }
                  />
                  <TokenActions
                    canMoveDown={index < designSystem.colors.length - 1}
                    canMoveUp={index > 0}
                    name={token.name}
                    onDelete={() => requestDelete("colors", token.id)}
                    onDuplicate={() => duplicate("colors", token.id)}
                    onMove={(offset) => move("colors", token.id, offset)}
                  />
                </div>
                {openEditor?.category === "colors" && openEditor.id === token.id ? (
                  <div
                    className="border-border space-y-2 border-t p-2"
                    id={`design-colour-editor-${token.id}`}
                  >
                    <input
                      aria-label={`Name for ${token.name}`}
                      className={`${FIELD_CLASS} w-full`}
                      maxLength={80}
                      onChange={(event) =>
                        updateColor(token.id, (current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                      value={token.name}
                    />
                    <ColorControl
                      document={document}
                      id={`design-colour-${token.id}`}
                      label={token.name}
                      onChange={(value) =>
                        updateColor(token.id, (current) => ({ ...current, value }))
                      }
                      value={token.value}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="border-border space-y-3 border-t pt-4">
        <SectionHeading
          count={designSystem.backgrounds.length}
          label="Backgrounds"
          onAdd={addBackground}
        />
        {designSystem.backgrounds.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed p-3 text-xs">
            Add a reusable colour, gradient, image, or video background.
          </p>
        ) : (
          <ul className="space-y-2">
            {designSystem.backgrounds.map((token, index) => (
              <li className="border-border rounded-lg border p-1" key={token.id}>
                <div className="flex items-center gap-1">
                  <TokenSummary
                    editorId={`design-background-editor-${token.id}`}
                    name={token.name}
                    onToggle={() => toggleEditor("backgrounds", token.id)}
                    open={openEditor?.category === "backgrounds" && openEditor.id === token.id}
                    summary={token.value.type.replace(/([A-Z])/g, " $1")}
                  />
                  <TokenActions
                    canMoveDown={index < designSystem.backgrounds.length - 1}
                    canMoveUp={index > 0}
                    name={token.name}
                    onDelete={() => requestDelete("backgrounds", token.id)}
                    onDuplicate={() => duplicate("backgrounds", token.id)}
                    onMove={(offset) => move("backgrounds", token.id, offset)}
                  />
                </div>
                {openEditor?.category === "backgrounds" && openEditor.id === token.id ? (
                  <div
                    className="border-border space-y-2 border-t p-2"
                    id={`design-background-editor-${token.id}`}
                  >
                    <input
                      aria-label={`Name for ${token.name}`}
                      className={`${FIELD_CLASS} w-full`}
                      maxLength={80}
                      onChange={(event) =>
                        updateBackground(token.id, (current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                      value={token.name}
                    />
                    <BackgroundEditor
                      document={document}
                      id={`design-background-${token.id}`}
                      onAddMedia={(type) => addMediaBackground(token.id, type)}
                      onChange={(value) =>
                        updateBackground(token.id, (current) => ({ ...current, value }))
                      }
                      value={token.value}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="border-border space-y-3 border-t pt-4">
        <SectionHeading count={designSystem.shadows.length} label="Shadows" onAdd={addShadow} />
        {designSystem.shadows.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed p-3 text-xs">
            Add a reusable native shadow effect.
          </p>
        ) : (
          <ul className="space-y-2">
            {designSystem.shadows.map((token, index) => (
              <li className="border-border rounded-lg border p-1" key={token.id}>
                <div className="flex items-center gap-1">
                  <TokenSummary
                    editorId={`design-shadow-editor-${token.id}`}
                    name={token.name}
                    onToggle={() => toggleEditor("shadows", token.id)}
                    open={openEditor?.category === "shadows" && openEditor.id === token.id}
                    summary={
                      token.value.type === "shadow" ? `${token.value.blurRadius}px blur` : "Linked"
                    }
                  />
                  <TokenActions
                    canMoveDown={index < designSystem.shadows.length - 1}
                    canMoveUp={index > 0}
                    name={token.name}
                    onDelete={() => requestDelete("shadows", token.id)}
                    onDuplicate={() => duplicate("shadows", token.id)}
                    onMove={(offset) => move("shadows", token.id, offset)}
                  />
                </div>
                {openEditor?.category === "shadows" && openEditor.id === token.id ? (
                  <div
                    className="border-border space-y-2 border-t p-2"
                    id={`design-shadow-editor-${token.id}`}
                  >
                    <input
                      aria-label={`Name for ${token.name}`}
                      className={`${FIELD_CLASS} w-full`}
                      maxLength={80}
                      onChange={(event) =>
                        updateShadow(token.id, (current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                      value={token.name}
                    />
                    <ShadowEditor
                      document={document}
                      id={`design-shadow-${token.id}`}
                      onChange={(value) =>
                        updateShadow(token.id, (current) => ({ ...current, value }))
                      }
                      value={token.value}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  )
}
