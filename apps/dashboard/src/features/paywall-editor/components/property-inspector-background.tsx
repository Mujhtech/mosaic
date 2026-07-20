/* eslint-disable react-refresh/only-export-components -- internal inspector modules colocate private controls with their supporting types and transforms. */
import { EyeIcon } from "@phosphor-icons/react/dist/ssr/Eye"
import { EyeSlashIcon } from "@phosphor-icons/react/dist/ssr/EyeSlash"
import { MinusIcon } from "@phosphor-icons/react/dist/ssr/Minus"
import { PlusIcon } from "@phosphor-icons/react/dist/ssr/Plus"
import { TrashIcon } from "@phosphor-icons/react/dist/ssr/Trash"
import { useEffect, useRef } from "react"

import { Button } from "@/components/ui/button"
import { InspectorColorControl } from "@/features/paywall-editor/components/inspector-color-control"
import { useEditorActions } from "@/features/paywall-editor/stores/editor-store-context"
import type {
  MosaicDocument,
  ProtocolBackground,
  ProtocolColor,
  ProtocolNode,
  ProtocolShadow,
} from "@/features/paywall-editor/types/editor"
import { updateNode } from "@/features/paywall-editor/utils/document-tree"
import {
  appendBackgroundAsset,
  clampGradientAngle,
  defaultMediaBackground,
  insertGradientStop,
  updateGradientStopPosition,
} from "@/features/paywall-editor/utils/style-authoring"

import {
  AppearanceValue,
  CONTROL_CLASS,
  InspectorSection,
  TwoColumn,
  useInspectorContext,
} from "@/features/paywall-editor/components/property-inspector-core"
import {
  ColorField,
  DocumentColorField,
  NumberField,
  SelectField,
} from "@/features/paywall-editor/components/property-inspector-fields"

export function updateAppearance(
  node: ProtocolNode,
  updater: (appearance: AppearanceValue) => AppearanceValue,
) {
  return {
    ...node,
    appearance: updater(("appearance" in node ? node.appearance : undefined) ?? {}),
  } as ProtocolNode
}

export function defaultBackground(
  type: ProtocolBackground["type"],
  document: MosaicDocument,
): ProtocolBackground | undefined {
  switch (type) {
    case "color":
      return { type, value: "transparent" }
    case "linearGradient":
      return {
        type,
        angle: 180,
        stops: [
          { position: 0, color: "surface.default" },
          { position: 1, color: "surface.elevated" },
        ],
      }
    case "radialGradient":
      return {
        type,
        center: { x: 0.5, y: 0.5 },
        radius: 0.75,
        stops: [
          { position: 0, color: "surface.elevated" },
          { position: 1, color: "surface.default" },
        ],
      }
    case "image":
      return document.assets.find((asset) => asset.type === "image")?.id
        ? defaultMediaBackground(type, document.assets.find((asset) => asset.type === "image")!.id)
        : undefined
    case "video":
      return document.assets.find((asset) => asset.type === "video")?.id
        ? defaultMediaBackground(type, document.assets.find((asset) => asset.type === "video")!.id)
        : undefined
    case "backgroundToken":
      return document.designSystem.backgrounds[0]
        ? { type, id: document.designSystem.backgrounds[0].id }
        : undefined
  }
}

// All background variants share one transaction boundary so switching variants preserves the
// previous authored value; primitive controls and style transforms are already extracted.
// oxlint-disable-next-line react-doctor/no-giant-component
export function DocumentBackgroundEditor({
  address,
  colorLabel = "Background",
  noneIsTransparent = false,
  onUpdate,
  value,
}: {
  address: string
  colorLabel?: string
  noneIsTransparent?: boolean
  onUpdate: (document: MosaicDocument, value: ProtocolBackground | undefined) => MosaicDocument
  value: ProtocolBackground | undefined
}) {
  const { componentId, disabled, document } = useInspectorContext()
  const editor = useEditorActions()
  const transparentNone =
    noneIsTransparent && value?.type === "color" && value.value === "transparent"
  const type = transparentNone ? "none" : (value?.type ?? "none")
  const backgroundKey = `${componentId ?? "document"}:${address}`
  const preservedBackground = useRef<{
    key: string
    value: ProtocolBackground | undefined
  }>({
    key: backgroundKey,
    value: type === "none" ? undefined : value,
  })

  useEffect(() => {
    if (preservedBackground.current.key !== backgroundKey) {
      preservedBackground.current = {
        key: backgroundKey,
        value: type === "none" ? undefined : value,
      }
    } else if (type !== "none") {
      preservedBackground.current.value = value
    }
  }, [backgroundKey, type, value])

  function update(next: ProtocolBackground | undefined) {
    editor.updateDocument((current) => onUpdate(current, next))
  }

  function updateGradientStop(index: number, color: ProtocolColor) {
    if (!value || (value.type !== "linearGradient" && value.type !== "radialGradient")) return
    update({
      ...value,
      stops: value.stops.map((stop, current) => (current === index ? { ...stop, color } : stop)),
    })
  }

  function addAndUseMedia(type: "image" | "video") {
    editor.updateDocument((current) => {
      const result = appendBackgroundAsset(current, type)
      return onUpdate(result.document, defaultMediaBackground(type, result.assetId))
    })
  }

  const imageAssets = document.assets.filter((asset) => asset.type === "image")
  const videoAssets = document.assets.filter((asset) => asset.type === "video")
  const selectedMediaExists =
    value?.type === "image" || value?.type === "video"
      ? document.assets.some((asset) => asset.type === value.type && asset.id === value.assetId)
      : true
  const tokenBackground =
    value?.type === "backgroundToken"
      ? document.designSystem.backgrounds.find((token) => token.id === value.id)?.value
      : undefined
  const visibleBackground = tokenBackground ?? (type === "none" ? undefined : value)
  const fillKind =
    visibleBackground?.type === "linearGradient" || visibleBackground?.type === "radialGradient"
      ? "gradient"
      : visibleBackground?.type === "image" || visibleBackground?.type === "video"
        ? "image"
        : visibleBackground
          ? "color"
          : "none"

  function selectFillKind(nextKind: "color" | "gradient" | "image") {
    if (nextKind === fillKind) return

    if (nextKind === "color") {
      update({ type: "color", value: "surface.default" })
      return
    }

    if (nextKind === "gradient") {
      update(defaultBackground("linearGradient", document))
      return
    }

    const imageBackground = defaultBackground("image", document)
    if (imageBackground) update(imageBackground)
    else addAndUseMedia("image")
  }

  function toggleFillVisibility() {
    if (type === "none") {
      update(preservedBackground.current.value ?? { type: "color", value: "surface.default" })
      return
    }

    preservedBackground.current.value = value
    update(undefined)
  }

  function removeFill() {
    preservedBackground.current.value = undefined
    update(undefined)
  }

  return (
    <div className="space-y-3" data-component-id={componentId} data-property-address={address}>
      <div className="grid grid-cols-[minmax(0,1fr)_2rem_2rem] items-center gap-1.5">
        <div
          aria-label={`${colorLabel} type`}
          className="bg-muted grid h-8 min-w-0 grid-cols-3 rounded-md p-0.5"
          role="group"
        >
          {(
            [
              ["color", "Solid"],
              ["gradient", "Gradient"],
              ["image", "Image"],
            ] as const
          ).map(([kind, label]) => {
            const selected = fillKind === kind
            return (
              <Button
                aria-pressed={selected}
                className={`h-7 min-w-0 rounded-[5px] px-2 text-xs font-medium shadow-none ${
                  selected
                    ? "bg-background text-foreground hover:bg-background shadow-sm"
                    : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
                }`}
                disabled={disabled}
                key={kind}
                onClick={() => selectFillKind(kind)}
                size="sm"
                type="button"
                variant="ghost"
              >
                {label}
              </Button>
            )
          })}
        </div>
        <Button
          aria-label={
            type === "none"
              ? `Show ${colorLabel.toLowerCase()}`
              : `Hide ${colorLabel.toLowerCase()}`
          }
          aria-pressed={type !== "none"}
          disabled={disabled}
          onClick={toggleFillVisibility}
          size="icon"
          title={
            type === "none"
              ? `Show ${colorLabel.toLowerCase()}`
              : `Hide ${colorLabel.toLowerCase()}`
          }
          type="button"
          variant="ghost"
        >
          {type === "none" ? <EyeSlashIcon aria-hidden /> : <EyeIcon aria-hidden />}
        </Button>
        <Button
          aria-label={`Remove ${colorLabel.toLowerCase()}`}
          disabled={disabled || type === "none"}
          onClick={removeFill}
          size="icon"
          title={`Remove ${colorLabel.toLowerCase()}`}
          type="button"
          variant="ghost"
        >
          <MinusIcon aria-hidden />
        </Button>
      </div>
      {imageAssets.length === 0 || videoAssets.length === 0 || !selectedMediaExists ? (
        <div className="border-border bg-muted/30 flex flex-wrap items-center gap-1.5 rounded-md border p-2">
          {!selectedMediaExists ? (
            <p className="text-muted-foreground w-full text-[11px] leading-4">
              The selected media asset is missing. Add a replacement to keep this background valid.
            </p>
          ) : null}
          {imageAssets.length === 0 || (value?.type === "image" && !selectedMediaExists) ? (
            <Button
              onClick={() => addAndUseMedia("image")}
              size="xs"
              type="button"
              variant="outline"
            >
              <PlusIcon aria-hidden /> Add image
            </Button>
          ) : null}
          {videoAssets.length === 0 || (value?.type === "video" && !selectedMediaExists) ? (
            <Button
              onClick={() => addAndUseMedia("video")}
              size="xs"
              type="button"
              variant="outline"
            >
              <PlusIcon aria-hidden /> Add video
            </Button>
          ) : null}
        </div>
      ) : null}
      {value?.type === "backgroundToken" ? (
        <SelectField
          address={`${address}.id`}
          label="Background style"
          onChange={(id) => update({ type: "backgroundToken", id })}
          value={value.id}
        >
          {document.designSystem.backgrounds.map((token) => (
            <option key={token.id} value={token.id}>
              {token.name}
            </option>
          ))}
        </SelectField>
      ) : null}
      {type === "color" && value?.type === "color" ? (
        <DocumentColorField
          address={`${address}.value`}
          label={colorLabel}
          onUpdate={(current, color) => onUpdate(current, { ...value, value: color })}
          value={value.value}
        />
      ) : null}
      {value?.type === "linearGradient" ? (
        <NumberField
          address={`${address}.angle`}
          label="Angle"
          max={360}
          min={0}
          onChange={(angle) => update({ ...value, angle: clampGradientAngle(angle) })}
          unit="°"
          value={value.angle}
        />
      ) : null}
      {value?.type === "radialGradient" ? (
        <>
          <TwoColumn>
            <NumberField
              address={`${address}.center.x`}
              label="Centre X"
              max={100}
              min={0}
              onChange={(x) => update({ ...value, center: { ...value.center, x: x / 100 } })}
              unit="%"
              value={Math.round(value.center.x * 100)}
            />
            <NumberField
              address={`${address}.center.y`}
              label="Centre Y"
              max={100}
              min={0}
              onChange={(y) => update({ ...value, center: { ...value.center, y: y / 100 } })}
              unit="%"
              value={Math.round(value.center.y * 100)}
            />
          </TwoColumn>
          <NumberField
            address={`${address}.radius`}
            label="Radius"
            max={200}
            min={1}
            onChange={(radius) => update({ ...value, radius: radius / 100 })}
            unit="%"
            value={Math.round(value.radius * 100)}
          />
        </>
      ) : null}
      {value?.type === "linearGradient" || value?.type === "radialGradient" ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-[11px]">Colour stops</span>
            <Button
              disabled={value.stops.length >= 8}
              onClick={() =>
                update({
                  ...value,
                  stops: insertGradientStop(value.stops),
                })
              }
              size="xs"
              type="button"
              variant="ghost"
            >
              <PlusIcon aria-hidden /> Stop
            </Button>
          </div>
          {value.stops.map((stop, index) => (
            <div className="grid grid-cols-[1fr_4.5rem_auto] items-end gap-1.5" key={stop.position}>
              <InspectorColorControl
                disabled={false}
                document={document}
                id={`${address}-stop-${index}`}
                label={`Stop ${index + 1}`}
                onBegin={() => editor.beginDocumentTransaction()}
                onCancel={() => editor.cancelDocumentTransaction()}
                onChange={(color) => updateGradientStop(index, color)}
                onCommit={() => editor.commitDocumentTransaction()}
                value={stop.color}
              />
              <label className="grid gap-1 text-[11px]">
                <span className="text-muted-foreground">Position</span>
                <input
                  className={CONTROL_CLASS}
                  max={100}
                  min={0}
                  onChange={(event) =>
                    update({
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
              </label>
              <Button
                aria-label={`Delete stop ${index + 1}`}
                disabled={value.stops.length <= 2}
                onClick={() =>
                  update({ ...value, stops: value.stops.filter((_, i) => i !== index) })
                }
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <TrashIcon aria-hidden />
              </Button>
            </div>
          ))}
        </div>
      ) : null}
      {value?.type === "image" || value?.type === "video" ? (
        <>
          <SelectField
            address={`${address}.assetId`}
            label={`${value.type === "image" ? "Image" : "Video"} asset`}
            onChange={(assetId) => update({ ...value, assetId })}
            value={value.assetId}
          >
            {(value.type === "image" ? imageAssets : videoAssets).map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.id}
              </option>
            ))}
          </SelectField>
          <SelectField
            address={`${address}.contentMode`}
            label="Content mode"
            onChange={(contentMode) =>
              update({ ...value, contentMode: contentMode as "fit" | "fill" })
            }
            value={value.contentMode}
          >
            <option value="fit">Fit</option>
            <option value="fill">Fill</option>
          </SelectField>
          {value.type === "video" ? (
            <SelectField
              address={`${address}.posterAssetId`}
              label="Poster image"
              onChange={(posterAssetId) =>
                update({ ...value, posterAssetId: posterAssetId || undefined })
              }
              value={value.posterAssetId ?? ""}
            >
              <option value="">No poster</option>
              {document.assets.flatMap((asset) =>
                asset.type === "image" ? (
                  <option key={asset.id} value={asset.id}>
                    {asset.id}
                  </option>
                ) : (
                  []
                ),
              )}
            </SelectField>
          ) : null}
          <DocumentColorField
            address={`${address}.fallbackColor`}
            label="Fallback colour"
            onUpdate={(current, fallbackColor) => onUpdate(current, { ...value, fallbackColor })}
            value={value.fallbackColor}
          />
        </>
      ) : null}
    </div>
  )
}

export function BackgroundSection({ node }: { node: ProtocolNode }) {
  const appearance = ("appearance" in node ? node.appearance : undefined) ?? {}
  return (
    <>
      <InspectorSection title="Background">
        <DocumentBackgroundEditor
          address="appearance.background"
          onUpdate={(document, background) =>
            updateNode(document, node.id, (current) =>
              updateAppearance(current, (currentAppearance) => {
                if (background) return { ...currentAppearance, background }
                const rest = { ...currentAppearance }
                delete rest.background
                return rest
              }),
            )
          }
          value={appearance.background}
        />
      </InspectorSection>
      <ShadowSection node={node} />
    </>
  )
}

export function ShadowSection({ node }: { node: ProtocolNode }) {
  const { document } = useInspectorContext()
  const editor = useEditorActions()
  const appearance = ("appearance" in node ? node.appearance : undefined) ?? {}
  const shadow = appearance.shadow

  function update(next: ProtocolShadow | undefined) {
    editor.updateComponent(node.id, (current) =>
      updateAppearance(current, (currentAppearance) => {
        if (next) return { ...currentAppearance, shadow: next }
        const rest = { ...currentAppearance }
        delete rest.shadow
        return rest
      }),
    )
  }

  return (
    <InspectorSection title="Shadow">
      <SelectField
        address="appearance.shadow.type"
        label="Style"
        onChange={(type) =>
          update(
            type === "none"
              ? undefined
              : type === "shadowToken"
                ? document.designSystem.shadows[0]
                  ? { type, id: document.designSystem.shadows[0].id }
                  : undefined
                : {
                    type: "shadow",
                    color: "#00000033",
                    offsetX: 0,
                    offsetY: 8,
                    blurRadius: 24,
                  },
          )
        }
        value={shadow?.type ?? "none"}
      >
        <option value="none">None</option>
        <option value="shadow">Custom</option>
        <option disabled={document.designSystem.shadows.length === 0} value="shadowToken">
          Design-system shadow
        </option>
      </SelectField>
      {shadow?.type === "shadowToken" ? (
        <SelectField
          address="appearance.shadow.id"
          label="Shadow style"
          onChange={(id) => update({ type: "shadowToken", id })}
          value={shadow.id}
        >
          {document.designSystem.shadows.map((token) => (
            <option key={token.id} value={token.id}>
              {token.name}
            </option>
          ))}
        </SelectField>
      ) : null}
      {shadow?.type === "shadow" ? (
        <>
          <ColorField
            address="appearance.shadow.color"
            label="Colour"
            onUpdate={(current, color) =>
              updateAppearance(current, (currentAppearance) => ({
                ...currentAppearance,
                shadow:
                  currentAppearance.shadow?.type === "shadow"
                    ? { ...currentAppearance.shadow, color }
                    : shadow,
              }))
            }
            value={shadow.color}
          />
          <div className="grid grid-cols-3 gap-1.5">
            {(["offsetX", "offsetY", "blurRadius"] as const).map((property) => (
              <NumberField
                address={`appearance.shadow.${property}`}
                key={property}
                label={property === "offsetX" ? "X" : property === "offsetY" ? "Y" : "Blur"}
                max={4096}
                min={property === "blurRadius" ? 0 : -4096}
                onChange={(value) => update({ ...shadow, [property]: value })}
                unit="lu"
                value={shadow[property]}
              />
            ))}
          </div>
        </>
      ) : null}
    </InspectorSection>
  )
}

export function BorderFields({ node }: { node: ProtocolNode }) {
  const editor = useEditorActions()
  const appearance = ("appearance" in node ? node.appearance : undefined) ?? {}
  const border = appearance.border ?? { color: "border.default" as const, width: 0 }

  function update(updater: (value: AppearanceValue) => AppearanceValue) {
    editor.updateComponent(node.id, (current) => updateAppearance(current, updater))
  }

  return (
    <div className="space-y-3">
      <ColorField
        address="appearance.border.color"
        label="Stroke colour"
        onUpdate={(current, color) =>
          updateAppearance(current, (currentAppearance) => ({
            ...currentAppearance,
            border: {
              color,
              width: currentAppearance.border?.width ?? 1,
            },
          }))
        }
        value={border.color}
      />
      <NumberField
        address="appearance.border.width"
        label="Stroke weight"
        max={4096}
        min={0}
        onChange={(width) =>
          update((currentAppearance) => ({
            ...currentAppearance,
            border: { color: currentAppearance.border?.color ?? "border.default", width },
          }))
        }
        unit="lu"
        value={border.width}
      />
    </div>
  )
}

export function BorderSection({ node }: { node: ProtocolNode }) {
  return (
    <InspectorSection title="Border">
      <BorderFields node={node} />
    </InspectorSection>
  )
}
