import { ArrowDownIcon } from "@phosphor-icons/react/dist/ssr/ArrowDown"
import { ArrowUpIcon } from "@phosphor-icons/react/dist/ssr/ArrowUp"
import { PlusIcon } from "@phosphor-icons/react/dist/ssr/Plus"
import { TrashIcon } from "@phosphor-icons/react/dist/ssr/Trash"

import { Button } from "@/components/ui/button"
import { useEditorActions } from "@/features/paywall-editor/stores/editor-store-context"
import type { ProtocolNode } from "@/features/paywall-editor/types/editor"
import {
  findAncestorNodes,
  findNode,
  updateNode,
} from "@/features/paywall-editor/utils/document-tree"
import { createSeededLocalizedText } from "@/features/paywall-editor/utils/editor-transforms"
import type {
  MosaicPaywallV02BaseTypography,
  MosaicPaywallV02Typography,
} from "@/lib/mosaic-protocol"

import {
  AdvancedPropertiesSection,
  AdvancedSection,
  ControlAccessibilitySection,
  ImageAccessibilitySection,
  TextAccessibilitySection,
} from "@/features/paywall-editor/components/property-inspector-accessibility"
import {
  BackgroundSection,
  BorderSection,
  DocumentBackgroundEditor,
} from "@/features/paywall-editor/components/property-inspector-background"
import {
  CompactOptionField,
  FLOW_OPTIONS,
  Field,
  InspectorSection,
  PRODUCT_VARIABLE_TOKENS,
  ScrollContainer,
  alignmentOptions,
  distributionOptions,
  updateScrollContainer,
  useInspectorContext,
} from "@/features/paywall-editor/components/property-inspector-core"
import {
  CheckboxField,
  ColorField,
  EdgeInsetsFields,
  LocalizedField,
  NumberField,
  SelectField,
} from "@/features/paywall-editor/components/property-inspector-fields"
import {
  AppearanceSection,
  SizingFields,
  SizingLayoutSection,
  SpacingSection,
  TypographySection,
  VisibilitySection,
} from "@/features/paywall-editor/components/property-inspector-layout"

export function ScrollContainerInspector({ layout }: { layout: ScrollContainer }) {
  const { document } = useInspectorContext()
  const editor = useEditorActions()
  const screen = document.screens.find((candidate) => candidate.layout.id === layout.id)
  const presentation =
    (screen as (typeof screen & { presentation?: { type: "screen" | "sheet" } }) | undefined)
      ?.presentation?.type ?? "screen"
  const isInitial = screen?.id === document.initialScreenId
  return (
    <>
      <InspectorSection defaultOpen title="Layout">
        <SelectField
          address="presentation.type"
          description={
            isInitial
              ? "The starting destination must remain a screen. Set another start screen before converting this one."
              : "Conversion keeps this destination's ID, content, links, and frame position."
          }
          label="Presentation"
          onChange={(type) => {
            if (!screen || (isInitial && type === "sheet")) return
            editor.updateDocument((current) => ({
              ...current,
              screens: current.screens.map((candidate) =>
                candidate.id === screen.id
                  ? ({ ...candidate, presentation: { type } } as typeof candidate)
                  : candidate,
              ),
            }))
          }}
          value={presentation}
        >
          <option value="screen">Screen</option>
          <option disabled={isInitial} value="sheet">
            Sheet
          </option>
        </SelectField>
        {screen && !isInitial && presentation === "screen" ? (
          <Button
            className="w-full justify-start"
            onClick={() =>
              editor.updateDocument((current) => ({
                ...current,
                initialScreenId: screen.id,
              }))
            }
            size="sm"
            type="button"
            variant="outline"
          >
            Set as start
          </Button>
        ) : null}
        <CheckboxField
          address="showsIndicators"
          checked={layout.showsIndicators}
          description="Controls the native scroll indicator."
          label="Show scroll indicators"
          onChange={(showsIndicators) =>
            editor.updateDocument((document) =>
              updateScrollContainer(document, layout.id, (current) => ({
                ...current,
                showsIndicators,
              })),
            )
          }
        />
        <p className="text-muted-foreground text-[11px] leading-4">
          Select the Content Stack to change padding, flow, sizing, and appearance.
        </p>
      </InspectorSection>
      <InspectorSection title="Background">
        <DocumentBackgroundEditor
          address="background"
          onUpdate={(document, background) => ({
            ...updateScrollContainer(document, layout.id, (current) => ({
              ...current,
              background,
            })),
          })}
          value={layout.background}
        />
      </InspectorSection>
      <AdvancedPropertiesSection
        properties={[
          { address: "id", label: "Component ID", value: layout.id },
          { address: "type", label: "Component type", value: layout.type },
          { address: "axis", label: "Scroll axis", value: layout.axis },
          { address: "safeArea", label: "Safe-area policy", value: layout.safeArea },
          { address: "content.id", label: "Content Stack", value: layout.content.id },
        ]}
      />
    </>
  )
}

export function StackInspector({ node }: { node: Extract<ProtocolNode, { type: "stack" }> }) {
  const editor = useEditorActions()
  return (
    <>
      <InspectorSection defaultOpen title="Layout">
        <CompactOptionField
          address="direction"
          label="Flow"
          onChange={(direction) =>
            editor.updateComponent(node.id, (current) =>
              current.type === "stack" ? ({ ...current, direction } as typeof current) : current,
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
              current.type === "stack"
                ? ({ ...current, mainAxisDistribution } as typeof current)
                : current,
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
              current.type === "stack"
                ? ({ ...current, crossAxisAlignment } as typeof current)
                : current,
            )
          }
          options={alignmentOptions(node.direction)}
          value={node.crossAxisAlignment}
        />
        <SizingFields node={node} />
      </InspectorSection>
      <SpacingSection node={node}>
        <NumberField
          address="gap"
          label="Spacing"
          max={4096}
          min={0}
          onChange={(gap) =>
            editor.updateComponent(node.id, (current) =>
              current.type === "stack" ? { ...current, gap } : current,
            )
          }
          unit="lu"
          value={node.gap}
        />
        <Field address="padding" group label="Padding">
          {() => (
            <EdgeInsetsFields
              address="padding"
              onChange={(padding) =>
                editor.updateComponent(node.id, (current) =>
                  current.type === "stack" ? { ...current, padding } : current,
                )
              }
              value={node.padding}
            />
          )}
        </Field>
      </SpacingSection>
      <BackgroundSection node={node} />
      <BorderSection node={node} />
      <AppearanceSection container node={node} />
      <VisibilitySection node={node} />
      <AdvancedSection node={node} />
    </>
  )
}

export function TextInspector({ node }: { node: Extract<ProtocolNode, { type: "text" }> }) {
  const { document } = useInspectorContext()
  const productBound = findAncestorNodes(document, node.id).some(
    (ancestor) => ancestor.type === "productCard",
  )
  return (
    <>
      <InspectorSection defaultOpen title="Content">
        <LocalizedField
          address="value"
          label="Text"
          multiline
          text={node.value}
          tokens={productBound ? PRODUCT_VARIABLE_TOKENS : undefined}
        />
        {productBound ? (
          <p className="text-muted-foreground text-[11px] leading-4">
            Product variables resolve from this card&apos;s bound store product in Studio and every
            native renderer.
          </p>
        ) : null}
      </InspectorSection>
      <TypographySection
        node={node}
        onChange={(current, typography) =>
          current.type === "text"
            ? { ...current, typography: typography as MosaicPaywallV02Typography }
            : current
        }
        supportsMaxLines
        typography={node.typography}
      />
      <SizingLayoutSection node={node} />
      <SpacingSection box node={node} />
      <BackgroundSection node={node} />
      <BorderSection node={node} />
      <AppearanceSection node={node} />
      <VisibilitySection node={node} />
      <TextAccessibilitySection node={node} />
      <AdvancedSection node={node} />
    </>
  )
}

export function ImageInspector({ node }: { node: Extract<ProtocolNode, { type: "image" }> }) {
  const { document } = useInspectorContext()
  const editor = useEditorActions()

  function updateImage(updater: (image: typeof node) => ProtocolNode) {
    editor.updateComponent(node.id, (current) =>
      current.type === "image" ? updater(current) : current,
    )
  }

  return (
    <>
      <InspectorSection defaultOpen title="Content">
        <SelectField
          address="assetId"
          label="Asset"
          onChange={(assetId) => updateImage((current) => ({ ...current, assetId }))}
          value={node.assetId}
        >
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
        <SelectField
          address="contentMode"
          label="Content mode"
          onChange={(contentMode) =>
            updateImage((current) => ({ ...current, contentMode }) as typeof current)
          }
          value={node.contentMode}
        >
          <option value="fit">Fit</option>
          <option value="fill">Fill</option>
        </SelectField>
      </InspectorSection>
      <SizingLayoutSection node={node} />
      <InspectorSection title="Ratio">
        <CheckboxField
          address="aspectRatio.enabled"
          checked={node.aspectRatio !== undefined}
          label="Preserve aspect ratio"
          onChange={(enabled) =>
            updateImage((current) => {
              if (enabled)
                return { ...current, aspectRatio: current.aspectRatio ?? 1.777_777_777_8 }
              const next = { ...current }
              delete next.aspectRatio
              return next
            })
          }
        />
        {node.aspectRatio !== undefined ? (
          <NumberField
            address="aspectRatio"
            exclusiveMin
            label="Aspect ratio"
            max={10}
            min={0}
            onChange={(aspectRatio) =>
              updateImage((current) => ({ ...current, aspectRatio }) as typeof current)
            }
            step={0.01}
            value={node.aspectRatio}
          />
        ) : null}
      </InspectorSection>
      <SpacingSection box node={node} />
      <BackgroundSection node={node} />
      <BorderSection node={node} />
      <AppearanceSection node={node} />
      <VisibilitySection node={node} />
      <ImageAccessibilitySection node={node} />
      <AdvancedSection node={node} />
    </>
  )
}

export function IconInspector({ node }: { node: Extract<ProtocolNode, { type: "icon" }> }) {
  const editor = useEditorActions()
  return (
    <>
      <InspectorSection defaultOpen title="Icon">
        <SelectField
          address="name"
          label="Icon"
          onChange={(name) =>
            editor.updateComponent(node.id, (current) =>
              current.type === "icon" ? { ...current, name: name as typeof current.name } : current,
            )
          }
          value={node.name}
        >
          {[
            "checkmark",
            "close",
            "lock",
            "restore",
            "externalLink",
            "arrowBackward",
            "arrowForward",
            "chevronBackward",
            "chevronForward",
          ].map((name) => (
            <option key={name} value={name}>
              {name.replaceAll(/([A-Z])/g, " $1")}
            </option>
          ))}
        </SelectField>
        <NumberField
          address="size"
          exclusiveMin
          label="Size"
          max={4096}
          min={0}
          onChange={(size) =>
            editor.updateComponent(node.id, (current) =>
              current.type === "icon" ? { ...current, size } : current,
            )
          }
          unit="lu"
          value={node.size}
        />
        <ColorField
          address="color"
          label="Colour"
          onUpdate={(current, color) => (current.type === "icon" ? { ...current, color } : current)}
          value={node.color}
        />
      </InspectorSection>
      <SizingLayoutSection node={node} />
      <SpacingSection box node={node} />
      <BackgroundSection node={node} />
      <BorderSection node={node} />
      <AppearanceSection node={node} />
      <VisibilitySection node={node} />
      <ImageAccessibilitySection node={node} />
      <AdvancedSection node={node} />
    </>
  )
}

export function FeatureListInspector({
  node,
}: {
  node: Extract<ProtocolNode, { type: "featureList" }>
}) {
  const { disabled } = useInspectorContext()
  const editor = useEditorActions()

  function moveItem(index: number, direction: -1 | 1) {
    editor.updateComponent(node.id, (current) => {
      if (current.type !== "featureList") return current
      const target = index + direction
      if (target < 0 || target >= current.items.length) return current
      const items = [...current.items]
      const [item] = items.splice(index, 1)
      if (!item) return current
      items.splice(target, 0, item)
      return { ...current, items }
    })
  }

  function addItem() {
    editor.updateDocument((document) => {
      const current = findNode(document, node.id)
      if (!current || current.type !== "featureList") return document
      const existing = new Set(current.items.map((item) => item.id))
      let sequence = current.items.length + 1
      let id = `${current.id}-item-${sequence}`
      while (existing.has(id)) {
        sequence += 1
        id = `${current.id}-item-${sequence}`
      }
      const seeded = createSeededLocalizedText({
        document,
        defaultValue: "New benefit",
        keyBase: `paywall.${current.id.replaceAll("-", "_")}.item_${sequence}`,
      })
      return updateNode(seeded.document, current.id, (candidate) =>
        candidate.type === "featureList"
          ? { ...candidate, items: [...candidate.items, { id, text: seeded.text }] }
          : candidate,
      )
    })
  }

  return (
    <>
      <InspectorSection defaultOpen title="Content">
        <div className="space-y-3">
          {node.items.map((item, index) => (
            <div className="border-border bg-muted/30 rounded-md border p-2" key={item.id}>
              <LocalizedField
                address={`items.${item.id}.text`}
                label={`Benefit ${index + 1}`}
                text={item.text}
              />
              <div className="mt-2 flex justify-end gap-1">
                <Button
                  aria-label={`Move benefit ${index + 1} up`}
                  disabled={disabled || index === 0}
                  onClick={() => moveItem(index, -1)}
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                >
                  <ArrowUpIcon aria-hidden />
                </Button>
                <Button
                  aria-label={`Move benefit ${index + 1} down`}
                  disabled={disabled || index === node.items.length - 1}
                  onClick={() => moveItem(index, 1)}
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                >
                  <ArrowDownIcon aria-hidden />
                </Button>
                <Button
                  aria-label={`Delete benefit ${index + 1}`}
                  disabled={disabled || node.items.length === 1}
                  onClick={() =>
                    editor.updateComponent(node.id, (current) =>
                      current.type === "featureList"
                        ? {
                            ...current,
                            items: current.items.filter((candidate) => candidate.id !== item.id),
                          }
                        : current,
                    )
                  }
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                >
                  <TrashIcon aria-hidden />
                </Button>
              </div>
            </div>
          ))}
        </div>
        <Button
          className="w-full"
          disabled={disabled}
          onClick={addItem}
          size="sm"
          type="button"
          variant="outline"
        >
          <PlusIcon aria-hidden />
          Add benefit
        </Button>
      </InspectorSection>
      <TypographySection
        node={node}
        onChange={(current, typography) =>
          current.type === "featureList"
            ? { ...current, typography: typography as MosaicPaywallV02BaseTypography }
            : current
        }
        typography={node.typography}
      />
      <SizingLayoutSection node={node} />
      <SpacingSection box node={node}>
        <NumberField
          address="gap"
          label="Item spacing"
          max={4096}
          min={0}
          onChange={(gap) =>
            editor.updateComponent(node.id, (current) =>
              current.type === "featureList" ? { ...current, gap } : current,
            )
          }
          unit="lu"
          value={node.gap}
        />
      </SpacingSection>
      <BackgroundSection node={node} />
      <BorderSection node={node} />
      <AppearanceSection node={node}>
        <ColorField
          address="markerColor"
          label="Marker colour"
          onUpdate={(current, markerColor) =>
            current.type === "featureList" ? { ...current, markerColor } : current
          }
          value={node.markerColor}
        />
      </AppearanceSection>
      <VisibilitySection node={node} />
      <ControlAccessibilitySection node={node} />
      <AdvancedSection node={node} />
    </>
  )
}
