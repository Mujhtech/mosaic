/* eslint-disable react-refresh/only-export-components -- token controls share private immutable token helpers. */
import { ArrowDownIcon } from "@phosphor-icons/react/dist/ssr/ArrowDown";
import { ArrowUpIcon } from "@phosphor-icons/react/dist/ssr/ArrowUp";
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { CopyIcon } from "@phosphor-icons/react/dist/ssr/Copy";
import { PlusIcon } from "@phosphor-icons/react/dist/ssr/Plus";
import { TrashIcon } from "@phosphor-icons/react/dist/ssr/Trash";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InspectorColorControl } from "@/features/paywall-editor/components/inspector-color-control";
import { useEditorActions } from "@/features/paywall-editor/stores/editor-store-context";
import type {
  MosaicDocument,
  PaywallDesignSystem,
  ProtocolBackground,
  ProtocolColor,
  ProtocolShadow,
} from "@/features/paywall-editor/types/editor";
import { cloneValue } from "@/features/paywall-editor/utils/clone";
import type { DesignCategory } from "@/features/paywall-editor/utils/style-authoring";
import {
  clampGradientAngle,
  defaultMediaBackground,
  insertGradientStop,
  updateGradientStopPosition,
} from "@/features/paywall-editor/utils/style-authoring";
import type {
  MosaicPaywallV02BackgroundToken,
  MosaicPaywallV02ColorToken,
  MosaicPaywallV02ShadowToken,
} from "@/lib/mosaic-protocol";

export type DesignToken =
  | MosaicPaywallV02ColorToken
  | MosaicPaywallV02BackgroundToken
  | MosaicPaywallV02ShadowToken;

export interface PendingDelete {
  readonly category: DesignCategory;
  readonly id: string;
}

export const FIELD_CLASS =
  "border-input bg-background focus:border-ring focus:ring-ring/30 h-8 min-w-0 rounded border px-2 text-xs outline-none focus:ring-2";

export function replaceTokenReferences(
  value: unknown,
  referenceType: string,
  id: string,
  replacement: unknown
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) =>
      replaceTokenReferences(entry, referenceType, id, replacement)
    );
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const record = value as Record<string, unknown>;
  if (record.type === referenceType && record.id === id) {
    return cloneValue(replacement);
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [
      key,
      replaceTokenReferences(entry, referenceType, id, replacement),
    ])
  );
}

export function countTokenReferences(
  value: unknown,
  referenceType: string,
  id: string
): number {
  if (Array.isArray(value)) {
    return value.reduce(
      (total, entry) => total + countTokenReferences(entry, referenceType, id),
      0
    );
  }
  if (!value || typeof value !== "object") {
    return 0;
  }
  const record = value as Record<string, unknown>;
  return (
    (record.type === referenceType && record.id === id ? 1 : 0) +
    Object.values(record).reduce<number>(
      (total, entry) => total + countTokenReferences(entry, referenceType, id),
      0
    )
  );
}

export function nextTokenId(tokens: readonly DesignToken[], prefix: string) {
  const used = new Set(tokens.map((token) => token.id));
  let ordinal = tokens.length + 1;
  while (used.has(`${prefix}-${ordinal}`)) {
    ordinal += 1;
  }
  return `${prefix}-${ordinal}`;
}

export function tokensFor(
  system: PaywallDesignSystem,
  category: DesignCategory
): readonly DesignToken[] {
  if (category === "colors") {
    return system.colors;
  }
  if (category === "backgrounds") {
    return system.backgrounds;
  }
  return system.shadows;
}

export function SectionHeading({
  count,
  label,
  onAdd,
}: {
  count: number;
  label: string;
  onAdd: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div>
        <h3 className="font-semibold text-sm">{label}</h3>
        <p className="text-[11px] text-muted-foreground">
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
  );
}

export function TokenActions({
  canMoveDown,
  canMoveUp,
  name,
  onDelete,
  onDuplicate,
  onMove,
}: {
  canMoveDown: boolean;
  canMoveUp: boolean;
  name: string;
  onDelete: () => void;
  onDuplicate: () => void;
  onMove: (offset: -1 | 1) => void;
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
  );
}

export function TokenSummary({
  editorId,
  name,
  onToggle,
  open,
  summary,
}: {
  editorId: string;
  name: string;
  onToggle: () => void;
  open: boolean;
  summary: string;
}) {
  return (
    <button
      aria-controls={editorId}
      aria-expanded={open}
      className="flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onToggle}
      type="button"
    >
      <CaretRightIcon
        aria-hidden
        className={`size-3.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
      />
      <span className="min-w-0 flex-1 truncate font-medium text-xs">
        {name}
      </span>
      <span className="max-w-24 truncate text-[11px] text-muted-foreground">
        {summary}
      </span>
    </button>
  );
}

export function ColorControl({
  document,
  id,
  label,
  onChange,
  value,
}: {
  document: MosaicDocument;
  id: string;
  label: string;
  onChange: (value: ProtocolColor) => void;
  value: ProtocolColor;
}) {
  const editor = useEditorActions();
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
  );
}

const BACKGROUND_KIND_OPTIONS = [
  { label: "Colour", value: "color" },
  { label: "Linear gradient", value: "linearGradient" },
  { label: "Radial gradient", value: "radialGradient" },
  { label: "Image", value: "image" },
  { label: "Video", value: "video" },
];

const CONTENT_MODE_OPTIONS = [
  { label: "Fit", value: "fit" },
  { label: "Fill", value: "fill" },
];

export function BackgroundEditor({
  document,
  id,
  onAddMedia,
  onChange,
  value,
}: {
  document: MosaicDocument;
  id: string;
  onAddMedia: (type: "image" | "video") => void;
  onChange: (value: ProtocolBackground) => void;
  value: ProtocolBackground;
}) {
  const images = document.assets.filter((asset) => asset.type === "image");
  const videos = document.assets.filter((asset) => asset.type === "video");
  function changeType(type: ProtocolBackground["type"]) {
    if (type === "color") {
      onChange({ type, value: "surface.default" });
    } else if (type === "linearGradient") {
      onChange({
        type,
        angle: 180,
        stops: [
          { position: 0, color: "surface.default" },
          { position: 1, color: "surface.elevated" },
        ],
      });
    } else if (type === "radialGradient") {
      onChange({
        type,
        center: { x: 0.5, y: 0.5 },
        radius: 0.75,
        stops: [
          { position: 0, color: "surface.elevated" },
          { position: 1, color: "surface.default" },
        ],
      });
    } else if (type === "image") {
      if (images[0]) {
        onChange(defaultMediaBackground(type, images[0].id));
      }
    } else if (type === "video" && videos[0]) {
      onChange(defaultMediaBackground(type, videos[0].id));
    }
  }
  const assetOptions = (value.type === "image" ? images : videos).map(
    (asset) => ({
      label: asset.id,
      value: asset.id,
    })
  );
  const posterOptions = [
    { label: "No poster", value: "" },
    ...images.map((asset) => ({ label: asset.id, value: asset.id })),
  ];
  const selectedMediaExists =
    value.type === "image" || value.type === "video"
      ? document.assets.some(
          (asset) => asset.type === value.type && asset.id === value.assetId
        )
      : true;
  return (
    <div className="space-y-2">
      <Select
        items={BACKGROUND_KIND_OPTIONS}
        onValueChange={(kind) => changeType(kind as ProtocolBackground["type"])}
        value={value.type}
      >
        <SelectTrigger aria-label="Background kind" size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {BACKGROUND_KIND_OPTIONS.map((option) => (
            <SelectItem
              disabled={
                (option.value === "image" &&
                  images.length === 0 &&
                  value.type !== "image") ||
                (option.value === "video" &&
                  videos.length === 0 &&
                  value.type !== "video")
              }
              key={option.value}
              value={option.value}
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {images.length === 0 || videos.length === 0 || !selectedMediaExists ? (
        <div className="flex flex-wrap gap-1.5 rounded border border-border bg-muted/30 p-2">
          {selectedMediaExists ? null : (
            <p className="w-full text-[11px] text-muted-foreground leading-4">
              The selected media asset is missing. Add a replacement to keep
              this style valid.
            </p>
          )}
          {images.length === 0 ||
          (value.type === "image" && !selectedMediaExists) ? (
            <Button
              onClick={() => onAddMedia("image")}
              size="xs"
              type="button"
              variant="outline"
            >
              <PlusIcon aria-hidden /> Add image
            </Button>
          ) : null}
          {videos.length === 0 ||
          (value.type === "video" && !selectedMediaExists) ? (
            <Button
              onClick={() => onAddMedia("video")}
              size="xs"
              type="button"
              variant="outline"
            >
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
              onChange({
                ...value,
                angle: clampGradientAngle(event.target.valueAsNumber),
              })
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
              <span className="text-muted-foreground">
                Centre {axis.toUpperCase()}
              </span>
              <input
                className={FIELD_CLASS}
                max={100}
                min={0}
                onChange={(event) =>
                  onChange({
                    ...value,
                    center: {
                      ...value.center,
                      [axis]: event.target.valueAsNumber / 100,
                    },
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
              onChange={(event) =>
                onChange({ ...value, radius: event.target.valueAsNumber / 100 })
              }
              type="number"
              value={Math.round(value.radius * 100)}
            />
          </label>
        </div>
      ) : null}
      {value.type === "linearGradient" || value.type === "radialGradient" ? (
        <div className="space-y-2">
          {value.stops.map((stop, index) => (
            <div
              className="grid grid-cols-[1fr_4rem_auto] items-end gap-1.5"
              key={stop.position}
            >
              <ColorControl
                document={document}
                id={`${id}-stop-${index}`}
                label={`Stop ${index + 1}`}
                onChange={(color) =>
                  onChange({
                    ...value,
                    stops: value.stops.map((entry, current) =>
                      current === index ? { ...entry, color } : entry
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
                      event.target.valueAsNumber / 100
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
                    stops: value.stops.filter(
                      (_, current) => current !== index
                    ),
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
          <Select
            items={assetOptions}
            onValueChange={(assetId) => onChange({ ...value, assetId })}
            value={value.assetId}
          >
            <SelectTrigger aria-label={`${value.type} asset`} size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {assetOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            items={CONTENT_MODE_OPTIONS}
            onValueChange={(contentMode) =>
              onChange({ ...value, contentMode: contentMode as "fit" | "fill" })
            }
            value={value.contentMode}
          >
            <SelectTrigger aria-label="Content mode" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CONTENT_MODE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {value.type === "video" ? (
            <Select
              items={posterOptions}
              onValueChange={(posterAssetId) =>
                onChange({
                  ...value,
                  posterAssetId: posterAssetId || undefined,
                })
              }
              value={value.posterAssetId ?? ""}
            >
              <SelectTrigger aria-label="Poster image" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {posterOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
  );
}

export function ShadowEditor({
  document,
  id,
  onChange,
  value,
}: {
  document: MosaicDocument;
  id: string;
  onChange: (value: ProtocolShadow) => void;
  value: ProtocolShadow;
}) {
  if (value.type === "shadowToken") {
    return (
      <p className="text-[11px] text-muted-foreground">
        Linked to shadow {value.id}
      </p>
    );
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
              {property === "offsetX"
                ? "X"
                : property === "offsetY"
                  ? "Y"
                  : "Blur"}
            </span>
            <input
              className={FIELD_CLASS}
              max={4096}
              min={property === "blurRadius" ? 0 : -4096}
              onChange={(event) =>
                onChange({ ...value, [property]: event.target.valueAsNumber })
              }
              type="number"
              value={value[property]}
            />
          </label>
        ))}
      </div>
    </div>
  );
}
