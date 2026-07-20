import { PlusIcon } from "@phosphor-icons/react/dist/ssr/Plus"

import { Button } from "@/components/ui/button"
import { LAYER_TYPE_LABELS } from "@/features/paywall-editor/components/component-catalog"
import { LayerTypeIcon } from "@/features/paywall-editor/components/layer-type-icon"
import { useEditorActions } from "@/features/paywall-editor/stores/editor-store-context"
import type { ProtocolNode } from "@/features/paywall-editor/types/editor"
import {
  appendProductBadge,
  appendProductCard,
  findParent,
  resolveLocalizedText,
} from "@/features/paywall-editor/utils/document-tree"

import {
  AdvancedSection,
  ControlAccessibilitySection,
  seedOptionalLocalizedText,
} from "@/features/paywall-editor/components/property-inspector-accessibility"
import {
  BackgroundSection,
  BorderSection,
} from "@/features/paywall-editor/components/property-inspector-background"
import {
  CompactOptionField,
  FLOW_OPTIONS,
  InspectorSection,
  PRODUCT_VARIABLE_TOKENS,
  TwoColumn,
  alignmentOptions,
  useInspectorContext,
} from "@/features/paywall-editor/components/property-inspector-core"
import {
  CheckboxField,
  LocalizedField,
  NumberField,
  SelectField,
} from "@/features/paywall-editor/components/property-inspector-fields"
import {
  AppearanceSection,
  SizingFields,
  SpacingSection,
  VisibilitySection,
} from "@/features/paywall-editor/components/property-inspector-layout"
import {
  ProductLayerLayoutSection,
  ProductLayerStyleSection,
} from "@/features/paywall-editor/components/property-inspector-product-styles"

export function ProductCardInspector({
  node,
}: {
  node: Extract<ProtocolNode, { type: "productCard" }>
}) {
  const { disabled, document, locale } = useInspectorContext()
  const editor = useEditorActions()
  const parent = findParent(document, node.id)
  const selector = parent?.parent.type === "productSelector" ? parent.parent : null
  const product = document.products.find((candidate) => candidate.id === node.productReferenceId)
  const usedProductIds = new Set(
    selector?.cards.flatMap((card) => (card.id === node.id ? [] : card.productReferenceId)),
  )
  const badge = node.children.find((child) => child.type === "productBadge")

  function addBadge() {
    const result = appendProductBadge(document, node.id)
    if (!result) return
    editor.updateDocument(() => result.document)
    editor.selectComponent(result.selectionId)
  }

  return (
    <>
      <InspectorSection defaultOpen title="Product">
        <SelectField
          address="productReferenceId"
          label="Product"
          onChange={(productReferenceId) =>
            editor.updateComponent(node.id, (current) =>
              current.type === "productCard" ? { ...current, productReferenceId } : current,
            )
          }
          value={node.productReferenceId}
        >
          {document.products.map((candidate) => (
            <option
              disabled={usedProductIds.has(candidate.id)}
              key={candidate.id}
              value={candidate.id}
            >
              {resolveLocalizedText(document, candidate.label, locale)}
            </option>
          ))}
        </SelectField>
        <CheckboxField
          address="initialProductCardId"
          checked={selector?.initialProductCardId === node.id}
          description="The selector keeps exactly one initial selection."
          label="Initial selection"
          onChange={(checked) => {
            if (!checked || !selector) return
            editor.updateComponent(selector.id, (current) =>
              current.type === "productSelector"
                ? { ...current, initialProductCardId: node.id }
                : current,
            )
          }}
        />
        {product ? (
          <p className="text-muted-foreground text-[11px] leading-4">
            Provider product ID: <span className="font-mono">{product.productId}</span>
          </p>
        ) : null}
      </InspectorSection>
      <InspectorSection title="Content">
        <p className="text-muted-foreground text-xs leading-5">
          Add and reorder Text, Icon, Image, Stack, Feature List, or Countdown directly in Layers.
          The whole card remains one selectable control.
        </p>
        {badge ? (
          <Button
            className="w-full justify-start"
            disabled={disabled}
            onClick={() => editor.selectComponent(badge.id)}
            size="sm"
            type="button"
            variant="outline"
          >
            Edit Product Badge
          </Button>
        ) : (
          <Button
            className="w-full justify-start"
            disabled={disabled}
            onClick={addBadge}
            size="sm"
            type="button"
            variant="outline"
          >
            <PlusIcon aria-hidden /> Add Product Badge
          </Button>
        )}
      </InspectorSection>
      <ProductLayerLayoutSection node={node} />
      <ProductLayerStyleSection node={node} />
      <InspectorSection title="Accessibility">
        {node.accessibility ? (
          <>
            <LocalizedField
              address="accessibility.label"
              label="Accessibility label"
              text={node.accessibility.label}
              tokens={PRODUCT_VARIABLE_TOKENS}
            />
            <Button
              disabled={disabled}
              onClick={() =>
                editor.updateComponent(node.id, (current) => {
                  if (current.type !== "productCard") return current
                  const next = { ...current }
                  delete next.accessibility
                  return next
                })
              }
              size="xs"
              type="button"
              variant="ghost"
            >
              Use visible card text
            </Button>
          </>
        ) : (
          <Button
            disabled={disabled}
            onClick={() =>
              editor.updateDocument(
                seedOptionalLocalizedText({
                  defaultValue: "{{ product.name }}, {{ product.price }}",
                  keyBase: `paywall.${node.id.replaceAll("-", "_")}.accessibility`,
                  nodeId: node.id,
                  update: (current, label) =>
                    current.type === "productCard"
                      ? { ...current, accessibility: { label } }
                      : current,
                }),
              )
            }
            size="sm"
            type="button"
            variant="outline"
          >
            <PlusIcon aria-hidden /> Add custom label
          </Button>
        )}
      </InspectorSection>
      <AdvancedSection node={node} />
    </>
  )
}

export function ProductBadgeInspector({
  node,
}: {
  node: Extract<ProtocolNode, { type: "productBadge" }>
}) {
  const editor = useEditorActions()
  return (
    <>
      <InspectorSection defaultOpen title="Badge">
        <SelectField
          address="placement.mode"
          label="Placement"
          onChange={(mode) =>
            editor.updateComponent(node.id, (current) =>
              current.type === "productBadge"
                ? {
                    ...current,
                    placement:
                      mode === "overlay"
                        ? { mode: "overlay", anchor: "topEnd", inset: 8 }
                        : { mode: "nested" },
                  }
                : current,
            )
          }
          value={node.placement.mode}
        >
          <option value="nested">Nested in card</option>
          <option value="overlay">Overlaid on card</option>
        </SelectField>
        {node.placement.mode === "overlay" ? (
          <TwoColumn>
            <SelectField
              address="placement.anchor"
              label="Position"
              onChange={(anchor) =>
                editor.updateComponent(node.id, (current) =>
                  current.type === "productBadge" && current.placement.mode === "overlay"
                    ? {
                        ...current,
                        placement: {
                          ...current.placement,
                          anchor: anchor as typeof current.placement.anchor,
                        },
                      }
                    : current,
                )
              }
              value={node.placement.anchor}
            >
              <option value="topStart">Top start</option>
              <option value="topEnd">Top end</option>
              <option value="bottomStart">Bottom start</option>
              <option value="bottomEnd">Bottom end</option>
            </SelectField>
            <NumberField
              address="placement.inset"
              label="Inset"
              max={64}
              min={0}
              onChange={(inset) =>
                editor.updateComponent(node.id, (current) =>
                  current.type === "productBadge" && current.placement.mode === "overlay"
                    ? { ...current, placement: { ...current.placement, inset } }
                    : current,
                )
              }
              unit="lu"
              value={node.placement.inset}
            />
          </TwoColumn>
        ) : null}
      </InspectorSection>
      <InspectorSection title="Content">
        <p className="text-muted-foreground text-xs leading-5">
          Badge content is made from child layers. Add, reorder, and edit Text, Icon, or Stack
          children in Layers; product variables work inside Text.
        </p>
        <div className="border-border divide-border divide-y rounded-md border">
          {node.children.map((child) => (
            <button
              aria-label={`Edit ${LAYER_TYPE_LABELS[child.type]} in Product Badge`}
              className="hover:bg-muted flex w-full items-center gap-2 p-2 text-left text-xs"
              key={child.id}
              onClick={() => editor.selectComponent(child.id)}
              type="button"
            >
              <span className="size-4 shrink-0">
                <LayerTypeIcon type={child.type} />
              </span>
              <span className="min-w-0 flex-1 truncate">{LAYER_TYPE_LABELS[child.type]}</span>
            </button>
          ))}
        </div>
      </InspectorSection>
      <ProductLayerLayoutSection node={node} />
      <ProductLayerStyleSection node={node} />
      <AdvancedSection node={node} />
    </>
  )
}

export function ProductSelectorInspector({
  node,
}: {
  node: Extract<ProtocolNode, { type: "productSelector" }>
}) {
  const { disabled, document } = useInspectorContext()
  const editor = useEditorActions()

  function addProductCard() {
    const result = appendProductCard(document, node.id)
    if (!result) return
    editor.updateDocument(() => result.document)
    editor.selectComponent(result.selectionId)
  }

  return (
    <>
      <InspectorSection defaultOpen title="Product Cards">
        <p className="text-muted-foreground text-xs leading-5">
          Product Cards are authored layers. Reorder the full card rows in Layers and edit each
          card&apos;s product, content, badge, and selected appearance separately.
        </p>
        <div className="border-border divide-border divide-y rounded-md border">
          {node.cards.map((card, index) => {
            const productName =
              document.products.find((product) => product.id === card.productReferenceId)?.label
                .default ?? card.productReferenceId
            const isInitial = card.id === node.initialProductCardId
            return (
              <button
                aria-label={`Edit ${productName} Product Card${isInitial ? " (initial selection)" : ""}`}
                className="hover:bg-muted flex w-full items-center gap-2 p-2 text-left text-xs"
                key={card.id}
                onClick={() => editor.selectComponent(card.id)}
                type="button"
              >
                <span className="bg-muted grid size-5 shrink-0 place-items-center rounded text-[10px]">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate">{productName}</span>
                {isInitial ? (
                  <span className="text-primary text-[10px] font-medium">Initial</span>
                ) : null}
              </button>
            )
          })}
        </div>
        <Button
          className="w-full justify-start"
          disabled={disabled || node.cards.length >= 20}
          onClick={addProductCard}
          size="sm"
          type="button"
          variant="outline"
        >
          <PlusIcon aria-hidden /> Add Product Card
        </Button>
        <LocalizedField
          address="unavailableFallback.message"
          label="Unavailable message"
          multiline
          text={node.unavailableFallback.message}
        />
        <p className="text-muted-foreground text-[11px] leading-4">
          If the initial product is unavailable, Mosaic selects the first available authored card.
          When none are available, this message replaces the group and Purchase is disabled.
        </p>
      </InspectorSection>
      <InspectorSection defaultOpen title="Layout">
        <CompactOptionField
          address="direction"
          label="Flow"
          onChange={(direction) =>
            editor.updateComponent(node.id, (current) =>
              current.type === "productSelector"
                ? ({ ...current, direction } as typeof current)
                : current,
            )
          }
          options={FLOW_OPTIONS}
          value={node.direction}
        />
        <CompactOptionField
          address="crossAxisAlignment"
          label="Alignment"
          onChange={(crossAxisAlignment) =>
            editor.updateComponent(node.id, (current) =>
              current.type === "productSelector"
                ? ({ ...current, crossAxisAlignment } as typeof current)
                : current,
            )
          }
          options={alignmentOptions(node.direction)}
          value={node.crossAxisAlignment}
        />
        <SizingFields node={node} />
      </InspectorSection>
      <SpacingSection box node={node}>
        <NumberField
          address="gap"
          label="Spacing"
          max={4096}
          min={0}
          onChange={(gap) =>
            editor.updateComponent(node.id, (current) =>
              current.type === "productSelector" ? { ...current, gap } : current,
            )
          }
          unit="lu"
          value={node.gap}
        />
      </SpacingSection>
      <BackgroundSection node={node} />
      <BorderSection node={node} />
      <AppearanceSection node={node} />
      <VisibilitySection node={node} />
      <ControlAccessibilitySection node={node} />
      <AdvancedSection node={node} />
    </>
  )
}
