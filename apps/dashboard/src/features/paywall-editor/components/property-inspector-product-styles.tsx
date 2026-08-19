import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { SelectItem } from "@/components/ui/select";
import { DocumentBackgroundEditor } from "@/features/paywall-editor/components/property-inspector-background";
import {
  CompactOptionField,
  Field,
  InspectorSection,
  TwoColumn,
  useInspectorContext,
} from "@/features/paywall-editor/components/property-inspector-core";
import {
  alignmentOptions,
  distributionOptions,
  FLOW_OPTIONS,
} from "@/features/paywall-editor/components/property-inspector-core-support";
import {
  ColorField,
  EdgeInsetsFields,
  NumberField,
  SelectField,
} from "@/features/paywall-editor/components/property-inspector-fields";
import { SizingFields } from "@/features/paywall-editor/components/property-inspector-layout";
import { useEditorActions } from "@/features/paywall-editor/stores/editor-store-context";
import type {
  ProtocolColor,
  ProtocolNode,
} from "@/features/paywall-editor/types/editor";
import { updateNode } from "@/features/paywall-editor/utils/document-tree-traversal";
import { resolveSelectionStyle } from "@/features/paywall-editor/utils/protocol-component-rules";
import type {
  MosaicPaywallV04EdgeInsets,
  MosaicPaywallV04ProductCardSelectedStyle,
  MosaicPaywallV04ProductCardStyles,
} from "@/lib/mosaic-protocol";

export type CardState = "default" | "selected";
export type ProductLayerNode = Extract<
  ProtocolNode,
  { type: "productCard" | "productBadge" }
>;
/**
 * Every node whose appearance is the neutral Default-plus-partial-Selected
 * overlay. Protocol 0.3 renamed those definitions to `selectionStyles`, which
 * `productCardStyles` now aliases, so Tabs authors its states through exactly
 * the controls Product Card already had.
 */
export type SelectionStyledNode = Extract<
  ProtocolNode,
  { type: "productCard" | "productBadge" | "tabs" }
>;

function isSelectionStyledNode(
  node: ProtocolNode
): node is SelectionStyledNode {
  return (
    node.type === "productCard" ||
    node.type === "productBadge" ||
    node.type === "tabs"
  );
}

const PRODUCT_STYLE_OVERRIDE_FIELDS = [
  { label: "fill", path: ["background"] },
  { label: "shadow", path: ["shadow"] },
  { label: "stroke colour", path: ["border", "color"] },
  { label: "stroke weight", path: ["border", "width"] },
  { label: "corner radius", path: ["cornerRadius"] },
  { label: "padding top", path: ["padding", "top"] },
  { label: "padding start", path: ["padding", "start"] },
  { label: "padding bottom", path: ["padding", "bottom"] },
  { label: "padding end", path: ["padding", "end"] },
  { label: "opacity", path: ["opacity"] },
] as const;

function productStyleOverrideExists(
  style: MosaicPaywallV04ProductCardSelectedStyle,
  path: readonly string[]
) {
  let current: unknown = style;
  for (const segment of path) {
    if (!current || typeof current !== "object" || !(segment in current)) {
      return false;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return true;
}

function removeProductStyleOverride(
  style: MosaicPaywallV04ProductCardSelectedStyle,
  path: readonly string[]
) {
  function remove(
    value: Record<string, unknown>,
    remaining: readonly string[]
  ) {
    const [segment, ...rest] = remaining;
    if (!segment) {
      return value;
    }
    const next = { ...value };
    if (rest.length === 0) {
      delete next[segment];
      return next;
    }
    const child = next[segment];
    if (!child || typeof child !== "object" || Array.isArray(child)) {
      return next;
    }
    const nextChild = remove(child as Record<string, unknown>, rest);
    if (Object.keys(nextChild).length === 0) {
      delete next[segment];
    } else {
      next[segment] = nextChild;
    }
    return next;
  }

  return remove(
    style as Record<string, unknown>,
    path
  ) as MosaicPaywallV04ProductCardSelectedStyle;
}

// Selected/unselected product-layer styles are edited as one atomic inspector section; extracting
// either branch would duplicate transaction, validation, and preview-state coordination.
// oxlint-disable-next-line react-doctor/no-giant-component
export function SelectionStyleSection({
  node,
  title = "Appearance",
}: {
  node: SelectionStyledNode;
  title?: string;
}) {
  const { disabled, document, issues } = useInspectorContext();
  const editor = useEditorActions();
  const [state, setState] = useState<CardState>(() =>
    issues.some(
      (issue) =>
        issue.componentId === node.id &&
        issue.property?.startsWith("styles.selected")
    )
      ? "selected"
      : "default"
  );
  const resolved = resolveSelectionStyle(node, state === "selected");
  const customShadow =
    resolved.shadow?.type === "shadow" ? resolved.shadow : null;
  const activeOverrides = PRODUCT_STYLE_OVERRIDE_FIELDS.filter(({ path }) =>
    productStyleOverrideExists(node.styles.selected, path)
  );

  const isProductLayer = node.type !== "tabs";

  useEffect(() => {
    // Product layers preview their two states from the inspector because the
    // canvas selects a card by product availability. A Tabs control is
    // selected by clicking it on the canvas, so it needs no preview override.
    if (!isProductLayer) {
      return;
    }
    editor.setProductLayerPreview({ nodeId: node.id, state });
    return () => editor.setProductLayerPreview(null);
  }, [editor, isProductLayer, node.id, state]);

  const updateStyles = useCallback(
    (
      updater: (
        styles: MosaicPaywallV04ProductCardStyles
      ) => MosaicPaywallV04ProductCardStyles
    ) => {
      editor.updateComponent(node.id, (current) => {
        if (!isSelectionStyledNode(current)) {
          return current;
        }
        return { ...current, styles: updater(current.styles) } as ProtocolNode;
      });
    },
    [editor, node]
  );

  const handleClick = useCallback(
    () => updateStyles((styles) => ({ ...styles, selected: {} })),
    [updateStyles]
  );
  function setValue(
    key: "background" | "cornerRadius" | "opacity" | "shadow",
    value: unknown
  ) {
    updateStyles((styles) =>
      state === "default"
        ? { ...styles, default: { ...styles.default, [key]: value } }
        : { ...styles, selected: { ...styles.selected, [key]: value } }
    );
  }

  function setBorder(part: "color" | "width", value: ProtocolColor | number) {
    updateStyles((styles) =>
      state === "default"
        ? {
            ...styles,
            default: {
              ...styles.default,
              border: { ...styles.default.border, [part]: value },
            },
          }
        : {
            ...styles,
            selected: {
              ...styles.selected,
              border: { ...styles.selected.border, [part]: value },
            },
          }
    );
  }

  function setPaddingEdge(
    edge: keyof MosaicPaywallV04EdgeInsets,
    value: number
  ) {
    updateStyles((styles) =>
      state === "default"
        ? {
            ...styles,
            default: {
              ...styles.default,
              padding: { ...styles.default.padding, [edge]: value },
            },
          }
        : {
            ...styles,
            selected: {
              ...styles.selected,
              padding: { ...styles.selected.padding, [edge]: value },
            },
          }
    );
  }

  function resetSelectedOverride(path: readonly string[]) {
    updateStyles((styles) => ({
      ...styles,
      selected: removeProductStyleOverride(styles.selected, path),
    }));
  }

  return (
    <InspectorSection title={title}>
      <fieldset
        aria-label={
          isProductLayer ? "Product layer state" : "Tab control state"
        }
        className="grid min-w-0 grid-cols-2 rounded bg-muted p-0.5"
      >
        {(["default", "selected"] as const).map((candidate) => (
          <button
            aria-pressed={state === candidate}
            className="h-7 rounded-[5px] font-medium text-muted-foreground text-xs aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm"
            key={candidate}
            onClick={() => setState(candidate)}
            type="button"
          >
            {candidate === "default" ? "Default" : "Selected"}
          </button>
        ))}
      </fieldset>
      {state === "selected" ? (
        <div className="space-y-2 rounded bg-muted/60 p-2 text-[11px] leading-4">
          <p>Selected values inherit from Default until you change them.</p>
          {activeOverrides.length > 0 ? (
            <fieldset
              aria-label="Selected appearance overrides"
              className="flex min-w-0 flex-wrap gap-1"
            >
              {activeOverrides.map(({ label, path }) => (
                <Button
                  aria-label={`Reset ${label} to Default`}
                  className="h-6 px-2 text-[10px]"
                  disabled={disabled}
                  key={path.join(".")}
                  onClick={() => resetSelectedOverride(path)}
                  size="xs"
                  type="button"
                  variant="outline"
                >
                  {label}
                </Button>
              ))}
            </fieldset>
          ) : (
            <p className="text-muted-foreground">No Selected overrides.</p>
          )}
          <Button
            className="w-full"
            disabled={disabled || activeOverrides.length === 0}
            onClick={handleClick}
            size="xs"
            type="button"
            variant="outline"
          >
            Reset selected appearance
          </Button>
        </div>
      ) : null}
      <DocumentBackgroundEditor
        address={`styles.${state}.background`}
        colorLabel="Fill"
        noneIsTransparent
        onUpdate={(currentDocument, background) =>
          updateNode(currentDocument, node.id, (current) =>
            isSelectionStyledNode(current)
              ? {
                  ...current,
                  styles: {
                    ...current.styles,
                    [state]: {
                      ...current.styles[state],
                      background: background ?? {
                        type: "color",
                        value: "transparent",
                      },
                    },
                  },
                }
              : current
          )
        }
        value={resolved.background}
      />
      <SelectField
        address={`styles.${state}.shadow.type`}
        label="Shadow"
        onChange={(type) =>
          setValue(
            "shadow",
            (() => {
              if (type === "none") {
                return;
              }
              if (type === "shadowToken") {
                return (() => {
                  if (document.designSystem.shadows[0]) {
                    return { type, id: document.designSystem.shadows[0].id };
                  }
                })();
              }
              return {
                type: "shadow",
                color: "#00000033",
                offsetX: 0,
                offsetY: 8,
                blurRadius: 24,
              };
            })()
          )
        }
        value={resolved.shadow?.type ?? "none"}
      >
        <SelectItem value="none">None</SelectItem>
        <SelectItem value="shadow">Custom</SelectItem>
        <SelectItem
          disabled={document.designSystem.shadows.length === 0}
          value="shadowToken"
        >
          Design-system shadow
        </SelectItem>
      </SelectField>
      {resolved.shadow?.type === "shadowToken" ? (
        <SelectField
          address={`styles.${state}.shadow.id`}
          label="Shadow style"
          onChange={(id) => setValue("shadow", { type: "shadowToken", id })}
          value={resolved.shadow.id}
        >
          {document.designSystem.shadows.map((token) => (
            <SelectItem key={token.id} value={token.id}>
              {token.name}
            </SelectItem>
          ))}
        </SelectField>
      ) : null}
      {customShadow ? (
        <>
          <ColorField
            address={`styles.${state}.shadow.color`}
            label="Shadow colour"
            onUpdate={(current, color) => {
              if (!isSelectionStyledNode(current)) {
                return current;
              }
              const shadow = { ...customShadow, color };
              return {
                ...current,
                styles:
                  state === "default"
                    ? {
                        ...current.styles,
                        default: { ...current.styles.default, shadow },
                      }
                    : {
                        ...current.styles,
                        selected: { ...current.styles.selected, shadow },
                      },
              } as ProtocolNode;
            }}
            value={customShadow.color}
          />
          <TwoColumn>
            <NumberField
              address={`styles.${state}.shadow.offsetX`}
              label="Shadow X"
              max={4096}
              min={-4096}
              onChange={(offsetX) =>
                setValue("shadow", { ...customShadow, offsetX })
              }
              unit="lu"
              value={customShadow.offsetX}
            />
            <NumberField
              address={`styles.${state}.shadow.offsetY`}
              label="Shadow Y"
              max={4096}
              min={-4096}
              onChange={(offsetY) =>
                setValue("shadow", { ...customShadow, offsetY })
              }
              unit="lu"
              value={customShadow.offsetY}
            />
          </TwoColumn>
          <NumberField
            address={`styles.${state}.shadow.blurRadius`}
            label="Shadow blur"
            max={4096}
            min={0}
            onChange={(blurRadius) =>
              setValue("shadow", { ...customShadow, blurRadius })
            }
            unit="lu"
            value={customShadow.blurRadius}
          />
        </>
      ) : null}
      <ColorField
        address={`styles.${state}.border.color`}
        label="Stroke"
        onUpdate={(current, color) =>
          isSelectionStyledNode(current)
            ? ({
                ...current,
                styles: {
                  ...current.styles,
                  [state]: {
                    ...current.styles[state],
                    border: { ...current.styles[state].border, color },
                  },
                },
              } as ProtocolNode)
            : current
        }
        value={resolved.border.color}
      />
      <TwoColumn>
        <NumberField
          address={`styles.${state}.border.width`}
          label="Weight"
          max={4096}
          min={0}
          onChange={(width) => setBorder("width", width)}
          unit="lu"
          value={resolved.border.width}
        />
        <NumberField
          address={`styles.${state}.cornerRadius`}
          label="Corner radius"
          max={4096}
          min={0}
          onChange={(cornerRadius) => setValue("cornerRadius", cornerRadius)}
          unit="lu"
          value={resolved.cornerRadius}
        />
      </TwoColumn>
      <NumberField
        address={`styles.${state}.opacity`}
        label="Opacity"
        max={100}
        min={0}
        onChange={(opacity) => setValue("opacity", opacity / 100)}
        unit="%"
        value={Math.round(resolved.opacity * 100)}
      />
      <Field address={`styles.${state}.padding`} group label="Padding">
        {() => (
          <EdgeInsetsFields
            address={`styles.${state}.padding`}
            onEdgeChange={setPaddingEdge}
            value={resolved.padding}
          />
        )}
      </Field>
    </InspectorSection>
  );
}

export function ProductLayerLayoutSection({
  node,
}: {
  node: ProductLayerNode;
}) {
  const editor = useEditorActions();
  return (
    <InspectorSection defaultOpen title="Layout">
      <CompactOptionField
        address="direction"
        label="Flow"
        onChange={(direction) =>
          editor.updateComponent(node.id, (current) =>
            current.type === node.type
              ? ({ ...current, direction } as ProtocolNode)
              : current
          )
        }
        options={FLOW_OPTIONS}
        value={node.direction}
      />
      <CompactOptionField
        address="mainAxisDistribution"
        label="Distribution"
        onChange={(mainAxisDistribution) =>
          editor.updateComponent(node.id, (current) =>
            current.type === node.type
              ? ({ ...current, mainAxisDistribution } as ProtocolNode)
              : current
          )
        }
        options={distributionOptions(node.direction)}
        value={node.mainAxisDistribution}
      />
      <CompactOptionField
        address="crossAxisAlignment"
        label="Alignment"
        onChange={(crossAxisAlignment) =>
          editor.updateComponent(node.id, (current) =>
            current.type === node.type
              ? ({ ...current, crossAxisAlignment } as ProtocolNode)
              : current
          )
        }
        options={alignmentOptions(node.direction)}
        value={node.crossAxisAlignment}
      />
      <SizingFields node={node} />
      <NumberField
        address="gap"
        label="Spacing"
        max={4096}
        min={0}
        onChange={(gap) =>
          editor.updateComponent(node.id, (current) =>
            current.type === node.type
              ? ({ ...current, gap } as ProtocolNode)
              : current
          )
        }
        unit="lu"
        value={node.gap}
      />
    </InspectorSection>
  );
}

export function ProductLayerStyleSection({ node }: { node: ProductLayerNode }) {
  return <SelectionStyleSection node={node} />;
}
