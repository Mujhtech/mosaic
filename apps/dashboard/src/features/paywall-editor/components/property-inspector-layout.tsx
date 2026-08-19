import type { ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateAppearance } from "@/features/paywall-editor/components/property-inspector-background-support";
import {
  type AppearanceValue,
  Field,
  InspectorSection,
  TwoColumn,
  type TypographyValue,
  useInspectorContext,
} from "@/features/paywall-editor/components/property-inspector-core";
import { ZERO_INSETS } from "@/features/paywall-editor/components/property-inspector-core-support";
import {
  CheckboxField,
  ColorField,
  EdgeInsetsFields,
  NumberField,
  SelectField,
} from "@/features/paywall-editor/components/property-inspector-fields";
import { useEditorActions } from "@/features/paywall-editor/stores/editor-store-context";
import type {
  AxisSizing,
  ProtocolNode,
  Visibility,
} from "@/features/paywall-editor/types/editor";
import { resolveLocalizedText } from "@/features/paywall-editor/utils/document-tree-mutations";
import { flattenDocument } from "@/features/paywall-editor/utils/document-tree-traversal";
import { eligibleTabControllers } from "@/features/paywall-editor/utils/protocol-component-rules";
import { sizingMode } from "@/features/paywall-editor/utils/protocol-styles";
import { fillAxisIsBounded } from "@/features/paywall-editor/utils/sizing";
import type { MosaicPaywallV04Typography } from "@/lib/mosaic-protocol";

const AXIS_MODE_OPTIONS = [
  { label: "Fit", value: "fit" },
  { label: "Fill", value: "fill" },
  { label: "Fixed", value: "fixed" },
];

export function AppearanceSection({
  children,
  container = false,
  node,
}: {
  children?: ReactNode;
  container?: boolean;
  node: ProtocolNode;
}) {
  const editor = useEditorActions();
  const appearance = ("appearance" in node ? node.appearance : undefined) ?? {};

  function update(updater: (value: AppearanceValue) => AppearanceValue) {
    editor.updateComponent(node.id, (current) =>
      updateAppearance(current, updater)
    );
  }

  return (
    <InspectorSection title="Appearance">
      {children}
      <TwoColumn>
        <NumberField
          address="appearance.cornerRadius"
          label="Corner radius"
          max={4096}
          min={0}
          onChange={(cornerRadius) =>
            update((currentAppearance) => ({
              ...currentAppearance,
              cornerRadius,
            }))
          }
          unit="lu"
          value={appearance.cornerRadius ?? 0}
        />
        <NumberField
          address="appearance.opacity"
          label="Opacity"
          max={100}
          min={0}
          onChange={(opacity) =>
            update((currentAppearance) => ({
              ...currentAppearance,
              opacity: opacity / 100,
            }))
          }
          step={5}
          unit="%"
          value={Math.round((appearance.opacity ?? 1) * 100)}
        />
      </TwoColumn>
      {container ? (
        <CheckboxField
          address="appearance.clipContent"
          checked={
            "clipContent" in appearance &&
            typeof appearance.clipContent === "boolean"
              ? appearance.clipContent
              : false
          }
          label="Clip content"
          onChange={(clipContent) =>
            update((currentAppearance) => ({
              ...currentAppearance,
              clipContent,
            }))
          }
        />
      ) : null}
    </InspectorSection>
  );
}

function AppearancePaddingFields({ node }: { node: ProtocolNode }) {
  const editor = useEditorActions();
  const appearance = ("appearance" in node ? node.appearance : undefined) ?? {};
  const padding =
    "padding" in appearance && appearance.padding
      ? appearance.padding
      : ZERO_INSETS;

  return (
    <Field address="appearance.padding" group label="Inner padding">
      {() => (
        <EdgeInsetsFields
          address="appearance.padding"
          onChange={(nextPadding) =>
            editor.updateComponent(node.id, (current) =>
              updateAppearance(current, (currentAppearance) => ({
                ...currentAppearance,
                padding: nextPadding,
              }))
            )
          }
          value={padding}
        />
      )}
    </Field>
  );
}

export function SpacingSection({
  box = false,
  children,
  node,
}: {
  box?: boolean;
  children?: ReactNode;
  node: ProtocolNode;
}) {
  return (
    <InspectorSection title="Spacing">
      {children}
      {box ? <AppearancePaddingFields node={node} /> : null}
      <OuterInsetsFields node={node} />
    </InspectorSection>
  );
}

export function SizingLayoutSection({ node }: { node: ProtocolNode }) {
  return (
    <InspectorSection defaultOpen title="Layout">
      <SizingFields node={node} />
    </InspectorSection>
  );
}

export function SwitchAppearanceFields({
  node,
}: {
  node: Extract<ProtocolNode, { type: "switch" }>;
}) {
  return (
    <>
      <ColorField
        address="offTrackColor"
        label="Off track"
        onUpdate={(current, offTrackColor) =>
          current.type === "switch" ? { ...current, offTrackColor } : current
        }
        value={node.offTrackColor}
      />
      <ColorField
        address="onTrackColor"
        label="On track"
        onUpdate={(current, onTrackColor) =>
          current.type === "switch" ? { ...current, onTrackColor } : current
        }
        value={node.onTrackColor}
      />
      <ColorField
        address="thumbColor"
        label="Thumb"
        onUpdate={(current, thumbColor) =>
          current.type === "switch" ? { ...current, thumbColor } : current
        }
        value={node.thumbColor}
      />
    </>
  );
}

export function SizingFields({ node }: { node: ProtocolNode }) {
  const { document } = useInspectorContext();
  const editor = useEditorActions();
  const sizing = "sizing" in node ? node.sizing : undefined;
  const width: AxisSizing = sizing?.width ?? "fit";
  const height: AxisSizing = sizing?.height ?? "fit";
  const widthFillBounded = fillAxisIsBounded(document, node, "width");
  const heightFillBounded = fillAxisIsBounded(document, node, "height");

  function updateSizing(nextSizing: Record<string, unknown>) {
    editor.updateComponent(
      node.id,
      (current) =>
        ({
          ...current,
          sizing: {
            width:
              ("sizing" in current ? current.sizing?.width : undefined) ??
              "fit",
            height:
              ("sizing" in current ? current.sizing?.height : undefined) ??
              "fit",
            ...nextSizing,
          },
        }) as ProtocolNode
    );
  }

  return (
    <div className="space-y-2">
      <TwoColumn>
        <SizingAxisField
          axis="width"
          onModeChange={(mode) =>
            updateSizing({
              width: mode === "fixed" ? { mode: "fixed", value: 320 } : mode,
            })
          }
          onValueChange={(value) =>
            updateSizing({ width: { mode: "fixed", value } })
          }
          value={width}
        />
        <SizingAxisField
          axis="height"
          onModeChange={(mode) =>
            updateSizing({
              height: mode === "fixed" ? { mode: "fixed", value: 240 } : mode,
            })
          }
          onValueChange={(value) =>
            updateSizing({ height: { mode: "fixed", value } })
          }
          value={height}
        />
      </TwoColumn>
      {sizingMode(width) === "fill" && !widthFillBounded ? (
        <p className="text-[11px] text-muted-foreground leading-4">
          Width Fill is unbounded here, so previews recover to Fit.
        </p>
      ) : null}
      {sizingMode(height) === "fill" && !heightFillBounded ? (
        <p className="text-[11px] text-muted-foreground leading-4">
          Height Fill is unbounded here, so previews recover to Fit.
        </p>
      ) : null}
    </div>
  );
}

function SizingAxisField({
  axis,
  onModeChange,
  onValueChange,
  value,
}: {
  axis: "height" | "width";
  onModeChange: (mode: "fill" | "fit" | "fixed") => void;
  onValueChange: (value: number) => void;
  value: AxisSizing;
}) {
  const { disabled } = useInspectorContext();
  const mode = sizingMode(value);
  const axisLabel = axis === "width" ? "Width" : "Height";
  const prefix = axis === "width" ? "W" : "H";

  return (
    <Field address={`sizing.${axis}`} hideLabel label={axisLabel}>
      {(fieldProps) => (
        <div className="flex h-9 min-w-0 items-center overflow-hidden rounded border border-input bg-background focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
          <span
            aria-hidden
            className="ps-2 font-medium text-muted-foreground text-xs"
          >
            {prefix}
          </span>
          {typeof value === "object" ? (
            <input
              aria-label={`Fixed ${axis}`}
              className="min-w-0 flex-1 appearance-none bg-transparent px-2 text-sm outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              disabled={disabled}
              inputMode="decimal"
              max={4096}
              min={0.01}
              onChange={(event) => {
                const next = event.target.valueAsNumber;
                if (Number.isFinite(next) && next > 0 && next <= 4096) {
                  onValueChange(next);
                }
              }}
              step={1}
              type="number"
              value={value.value}
            />
          ) : (
            <span className="min-w-0 flex-1 px-2 text-sm capitalize">
              {mode}
            </span>
          )}
          <span
            className="relative h-full w-8 shrink-0 border-input border-s"
            title={`${axisLabel} behaviour`}
          >
            <Select
              items={AXIS_MODE_OPTIONS}
              onValueChange={(next) =>
                onModeChange(next as "fill" | "fit" | "fixed")
              }
              value={mode}
            >
              <SelectTrigger
                {...fieldProps}
                aria-label={`${axisLabel} behaviour`}
                className="absolute inset-0 size-full cursor-pointer justify-center rounded-none border-0 bg-transparent px-0 disabled:cursor-not-allowed"
                disabled={disabled}
                size="sm"
              >
                {/* The caret alone is the affordance here: the chosen mode is
                    already spelled out in the value beside this control. */}
                <SelectValue className="sr-only" />
              </SelectTrigger>
              <SelectContent>
                {AXIS_MODE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </span>
        </div>
      )}
    </Field>
  );
}

function OuterInsetsFields({ node }: { node: ProtocolNode }) {
  const editor = useEditorActions();
  return (
    <Field address="outerInsets" group label="Outer spacing">
      {() => (
        <EdgeInsetsFields
          address="outerInsets"
          onChange={(outerInsets) =>
            editor.updateComponent(
              node.id,
              (current) => ({ ...current, outerInsets }) as ProtocolNode
            )
          }
          value={
            ("outerInsets" in node ? node.outerInsets : undefined) ??
            ZERO_INSETS
          }
        />
      )}
    </Field>
  );
}

export function TypographyFields({
  node,
  onChange,
  supportsMaxLines = false,
  typography,
}: {
  node: ProtocolNode;
  onChange: (node: ProtocolNode, typography: TypographyValue) => ProtocolNode;
  supportsMaxLines?: boolean;
  typography: TypographyValue;
}) {
  const editor = useEditorActions();
  const extended = typography as MosaicPaywallV04Typography;

  function update(next: TypographyValue) {
    editor.updateComponent(node.id, (current) => onChange(current, next));
  }

  return (
    <>
      <TwoColumn>
        <SelectField
          address="typography.style"
          label="Text style"
          onChange={(style) =>
            update({ ...typography, style } as TypographyValue)
          }
          value={typography.style}
        >
          {["display", "title", "heading", "body", "label", "caption"].map(
            (style) => (
              <SelectItem key={style} value={style}>
                {style[0]?.toUpperCase()}
                {style.slice(1)}
              </SelectItem>
            )
          )}
        </SelectField>
        <SelectField
          address="typography.weight"
          label="Weight"
          onChange={(weight) =>
            update({ ...typography, weight } as TypographyValue)
          }
          value={typography.weight}
        >
          {["regular", "medium", "semibold", "bold"].map((weight) => (
            <SelectItem key={weight} value={weight}>
              {weight[0]?.toUpperCase()}
              {weight.slice(1)}
            </SelectItem>
          ))}
        </SelectField>
      </TwoColumn>
      <TwoColumn>
        <NumberField
          address="typography.fontSize"
          label="Font size"
          max={96}
          min={8}
          onChange={(fontSize) => update({ ...typography, fontSize })}
          unit="lu"
          value={typography.fontSize}
        />
        <NumberField
          address="typography.lineHeightMultiplier"
          label="Line height"
          max={3}
          min={0.8}
          onChange={(lineHeightMultiplier) =>
            update({ ...typography, lineHeightMultiplier })
          }
          step={0.05}
          unit="×"
          value={typography.lineHeightMultiplier}
        />
      </TwoColumn>
      <div className="space-y-3">
        <ColorField
          address="typography.color"
          label="Colour"
          onUpdate={(current, color) =>
            onChange(current, { ...typography, color })
          }
          value={typography.color}
        />
        <SelectField
          address="typography.alignment"
          label="Alignment"
          onChange={(alignment) =>
            update({ ...typography, alignment } as TypographyValue)
          }
          value={typography.alignment}
        >
          <SelectItem value="start">Start</SelectItem>
          <SelectItem value="center">Centre</SelectItem>
          <SelectItem value="end">End</SelectItem>
        </SelectField>
      </div>
      {supportsMaxLines ? (
        <>
          <CheckboxField
            address="typography.maxLines.enabled"
            checked={extended.maxLines !== undefined}
            label="Limit lines"
            onChange={(enabled) => {
              if (enabled) {
                update({ ...extended, maxLines: 2, overflow: "ellipsis" });
                return;
              }
              const next = { ...extended };
              delete next.maxLines;
              delete next.overflow;
              update(next);
            }}
          />
          {extended.maxLines === undefined ? null : (
            <TwoColumn>
              <NumberField
                address="typography.maxLines"
                integer
                label="Maximum lines"
                max={100}
                min={1}
                onChange={(maxLines) => update({ ...extended, maxLines })}
                value={extended.maxLines}
              />
              <SelectField
                address="typography.overflow"
                label="Overflow"
                onChange={(overflow) =>
                  update({
                    ...extended,
                    overflow,
                  } as MosaicPaywallV04Typography)
                }
                value={extended.overflow ?? "ellipsis"}
              >
                <SelectItem value="ellipsis">Ellipsis</SelectItem>
                <SelectItem value="clip">Clip</SelectItem>
              </SelectField>
            </TwoColumn>
          )}
        </>
      ) : null}
    </>
  );
}

export function TypographySection({
  node,
  onChange,
  supportsMaxLines = false,
  typography,
}: {
  node: ProtocolNode;
  onChange: (node: ProtocolNode, typography: TypographyValue) => ProtocolNode;
  supportsMaxLines?: boolean;
  typography: TypographyValue;
}) {
  return (
    <InspectorSection title="Typography">
      <TypographyFields
        node={node}
        onChange={onChange}
        supportsMaxLines={supportsMaxLines}
        typography={typography}
      />
    </InspectorSection>
  );
}

export function VisibilitySection({ node }: { node: ProtocolNode }) {
  const { document } = useInspectorContext();
  const editor = useEditorActions();
  const switches = flattenDocument(document)
    .map((entry) => entry.node)
    .filter(
      (candidate): candidate is Extract<ProtocolNode, { type: "switch" }> =>
        candidate.type === "switch"
    );
  // Only Tabs components this node may legally name: same screen, not itself,
  // and not one it lives inside. Offering an illegal target would let Studio
  // author a document the protocol rejects atomically.
  const tabControllers = eligibleTabControllers(document, node.id);
  const visibility = ("visibility" in node ? node.visibility : undefined) ?? {
    mode: "always" as const,
  };
  const activeController =
    visibility.mode === "tab"
      ? tabControllers.find((candidate) => candidate.id === visibility.tabsId)
      : undefined;

  function update(nextVisibility: Visibility) {
    editor.updateComponent(
      node.id,
      (current) =>
        ({
          ...current,
          visibility: nextVisibility,
        }) as ProtocolNode
    );
  }

  function selectTabController(tabsId: string) {
    const controller = tabControllers.find(
      (candidate) => candidate.id === tabsId
    );
    const [firstTab] = controller?.tabs ?? [];
    if (!firstTab) {
      return;
    }
    update({ mode: "tab", tabsId, equals: firstTab.id });
  }

  return (
    <InspectorSection title="Visibility">
      <SelectField
        address="visibility.mode"
        label="Visibility"
        onChange={(mode) => {
          if (mode === "hidden") {
            update({ mode: "hidden" });
          } else if (mode === "switch" && switches[0]) {
            update({ mode: "switch", switchId: switches[0].id, equals: true });
          } else if (mode === "tab" && tabControllers[0]) {
            selectTabController(tabControllers[0].id);
          } else {
            update({ mode: "always" });
          }
        }}
        value={visibility.mode}
      >
        <SelectItem value="always">Always visible</SelectItem>
        <SelectItem value="hidden">Hidden</SelectItem>
        <SelectItem disabled={switches.length === 0} value="switch">
          Controlled by switch
        </SelectItem>
        <SelectItem disabled={tabControllers.length === 0} value="tab">
          Controlled by tab
        </SelectItem>
      </SelectField>
      {visibility.mode === "switch" ? (
        <>
          <SelectField
            address="visibility.switchId"
            label="Switch"
            onChange={(switchId) => update({ ...visibility, switchId })}
            value={visibility.switchId}
          >
            {switches.map((candidate) => (
              <SelectItem key={candidate.id} value={candidate.id}>
                {resolveLocalizedText(
                  document,
                  candidate.label,
                  document.localization.defaultLocale
                )}
              </SelectItem>
            ))}
          </SelectField>
          <CheckboxField
            address="visibility.equals"
            checked={visibility.equals}
            label="Visible when switch is on"
            onChange={(equals) => update({ ...visibility, equals })}
          />
        </>
      ) : null}
      {visibility.mode === "tab" ? (
        <>
          <SelectField
            address="visibility.tabsId"
            description="Tabs on this screen that do not contain this layer. A condition inside its own panel is already decided, so it is not offered."
            label="Tabs"
            onChange={selectTabController}
            value={visibility.tabsId}
          >
            {tabControllers.map((candidate) => (
              <SelectItem key={candidate.id} value={candidate.id}>
                {resolveLocalizedText(
                  document,
                  candidate.accessibility.label,
                  document.localization.defaultLocale
                )}
              </SelectItem>
            ))}
          </SelectField>
          <SelectField
            address="visibility.equals"
            label="Visible on tab"
            onChange={(equals) => update({ ...visibility, equals })}
            value={visibility.equals}
          >
            {(activeController?.tabs ?? []).map((tab) => (
              <SelectItem key={tab.id} value={tab.id}>
                {resolveLocalizedText(
                  document,
                  tab.label,
                  document.localization.defaultLocale
                )}
              </SelectItem>
            ))}
          </SelectField>
        </>
      ) : null}
    </InspectorSection>
  );
}
