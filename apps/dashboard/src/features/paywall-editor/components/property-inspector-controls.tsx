import { PlusIcon } from "@phosphor-icons/react/dist/ssr/Plus"

import { Button } from "@/components/ui/button"
import { useEditorActions } from "@/features/paywall-editor/stores/editor-store-context"
import type { ProtocolNode } from "@/features/paywall-editor/types/editor"
import {
  flattenDocument,
  resolveLocalizedText,
} from "@/features/paywall-editor/utils/document-tree"
import type { MosaicPaywallV02BaseTypography } from "@/lib/mosaic-protocol"

import {
  AdvancedSection,
  ControlAccessibilitySection,
  TextAccessibilitySection,
} from "@/features/paywall-editor/components/property-inspector-accessibility"
import {
  BackgroundSection,
  BorderSection,
} from "@/features/paywall-editor/components/property-inspector-background"
import {
  FeatureListInspector,
  IconInspector,
  ImageInspector,
  StackInspector,
  TextInspector,
} from "@/features/paywall-editor/components/property-inspector-basic-nodes"
import {
  CONTROL_CLASS,
  CompactOptionField,
  FLOW_OPTIONS,
  Field,
  InspectorSection,
  TwoColumn,
  layerDisplayLabel,
  useInspectorContext,
} from "@/features/paywall-editor/components/property-inspector-core"
import {
  CheckboxField,
  ComponentTextField,
  LocalizedField,
  NumberField,
  SelectField,
} from "@/features/paywall-editor/components/property-inspector-fields"
import {
  AppearanceSection,
  SizingFields,
  SizingLayoutSection,
  SpacingSection,
  SwitchAppearanceFields,
  TypographyFields,
  TypographySection,
  VisibilitySection,
} from "@/features/paywall-editor/components/property-inspector-layout"
import {
  ProductBadgeInspector,
  ProductCardInspector,
  ProductSelectorInspector,
} from "@/features/paywall-editor/components/property-inspector-products"

export function ButtonInspector({ node }: { node: Extract<ProtocolNode, { type: "button" }> }) {
  const { disabled, document } = useInspectorContext()
  const editor = useEditorActions()
  const entries = flattenDocument(document)
  const sourceEntry = entries.find((entry) => entry.node.id === node.id)
  const sourceScreenIndex = sourceEntry?.documentPath.match(/^\/screens\/(\d+)/)?.[1]
  const screenPrefix = sourceScreenIndex === undefined ? null : `/screens/${sourceScreenIndex}/`
  const selectors = entries
    .filter(
      (
        entry,
      ): entry is typeof entry & {
        node: Extract<ProtocolNode, { type: "productSelector" }>
      } =>
        entry.node.type === "productSelector" && entry.documentPath.startsWith(screenPrefix ?? ""),
    )
    .map((entry) => entry.node)
  const sourceScreen =
    sourceScreenIndex === undefined ? undefined : document.screens[Number(sourceScreenIndex)]
  const destinationScreens = document.screens.filter((screen) => screen.id !== sourceScreen?.id)
  const externalUrl = node.action.type === "openExternalUrl" ? node.action.url : ""

  function changeAction(type: string) {
    editor.updateComponent(node.id, (current) => {
      if (current.type !== "button") return current
      const action = (() => {
        switch (type) {
          case "purchase":
            return selectors[0]
              ? { type: "purchase" as const, productSelectorId: selectors[0].id }
              : null
          case "restore":
            return { type: "restore" as const }
          case "close":
            return { type: "close" as const }
          case "navigateTo":
            return destinationScreens[0]
              ? { type: "navigateTo" as const, screenId: destinationScreens[0].id }
              : null
          case "navigateBack":
            return { type: "navigateBack" as const }
          case "openExternalUrl":
            return { type: "openExternalUrl" as const, url: "https://example.com" }
          default:
            return null
        }
      })()
      if (!action) return current
      return {
        ...current,
        action,
        ...(type === "purchase" || type === "restore" ? {} : { inProgressChildren: undefined }),
      }
    })
  }

  return (
    <>
      <InspectorSection defaultOpen title="Content">
        <p className="text-muted-foreground text-xs leading-5">
          Button content is made from child nodes. Add, reorder, and edit its Text or Icon children
          directly in Layers.
        </p>
        {node.action.type === "purchase" || node.action.type === "restore" ? (
          node.inProgressChildren?.length ? (
            <p className="text-muted-foreground text-xs leading-5">
              In-progress children appear as labelled layers and preview automatically when
              selected.
            </p>
          ) : (
            <Button
              className="w-full justify-start"
              disabled={disabled}
              onClick={() =>
                editor.insertComponentAt("text", {
                  parentId: node.id,
                  index: 0,
                  collection: "inProgressChildren",
                })
              }
              size="sm"
              type="button"
              variant="outline"
            >
              <PlusIcon aria-hidden /> Add in-progress content
            </Button>
          )
        ) : null}
      </InspectorSection>
      <InspectorSection title="Actions">
        <SelectField
          address="action.type"
          label="Action"
          onChange={changeAction}
          value={node.action.type}
        >
          <option disabled={selectors.length === 0} value="purchase">
            Purchase
          </option>
          <option value="restore">Restore purchases</option>
          <option value="close">Close paywall</option>
          <option disabled={destinationScreens.length === 0} value="navigateTo">
            Navigate to screen
          </option>
          <option value="navigateBack">Navigate back</option>
          <option value="openExternalUrl">Open external URL</option>
        </SelectField>
        {node.action.type === "purchase" ? (
          <SelectField
            address="action.productSelectorId"
            label="Product selector"
            onChange={(productSelectorId) =>
              editor.updateComponent(node.id, (current) =>
                current.type === "button" && current.action.type === "purchase"
                  ? { ...current, action: { ...current.action, productSelectorId } }
                  : current,
              )
            }
            value={node.action.productSelectorId}
          >
            {selectors.map((selector) => (
              <option key={selector.id} value={selector.id}>
                {layerDisplayLabel(document, selector.id, {})}
              </option>
            ))}
          </SelectField>
        ) : null}
        {node.action.type === "navigateTo" ? (
          <SelectField
            address="action.screenId"
            label="Destination"
            onChange={(screenId) =>
              editor.updateComponent(node.id, (current) =>
                current.type === "button" && current.action.type === "navigateTo"
                  ? { ...current, action: { ...current.action, screenId } }
                  : current,
              )
            }
            value={node.action.screenId}
          >
            {destinationScreens.map((screen) => (
              <option key={screen.id} value={screen.id}>
                {screen.accessibilityLabel
                  ? resolveLocalizedText(
                      document,
                      screen.accessibilityLabel,
                      document.localization.defaultLocale,
                    )
                  : screen.id}
              </option>
            ))}
          </SelectField>
        ) : null}
        {node.action.type === "openExternalUrl" ? (
          <Field address="action.url" label="External URL">
            {(fieldProps) => (
              <input
                {...fieldProps}
                className={CONTROL_CLASS}
                onChange={(event) =>
                  editor.updateComponent(node.id, (current) =>
                    current.type === "button" && current.action.type === "openExternalUrl"
                      ? { ...current, action: { ...current.action, url: event.target.value } }
                      : current,
                  )
                }
                placeholder="https://example.com/terms"
                type="url"
                value={externalUrl}
              />
            )}
          </Field>
        ) : null}
      </InspectorSection>
      <InspectorSection defaultOpen title="Layout">
        <CompactOptionField
          address="direction"
          label="Flow"
          onChange={(direction) =>
            editor.updateComponent(node.id, (current) =>
              current.type === "button"
                ? { ...current, direction: direction as typeof current.direction }
                : current,
            )
          }
          options={FLOW_OPTIONS}
          value={node.direction}
        />
        <NumberField
          address="gap"
          label="Gap"
          max={4096}
          min={0}
          onChange={(gap) =>
            editor.updateComponent(node.id, (current) =>
              current.type === "button" ? { ...current, gap } : current,
            )
          }
          unit="lu"
          value={node.gap}
        />
        <SizingFields node={node} />
      </InspectorSection>
      <SpacingSection box node={node} />
      <BackgroundSection node={node} />
      <BorderSection node={node} />
      <AppearanceSection node={node} />
      <VisibilitySection node={node} />
      <ControlAccessibilitySection node={node} />
      <AdvancedSection node={node} />
    </>
  )
}

export function CarouselInspector({ node }: { node: Extract<ProtocolNode, { type: "carousel" }> }) {
  const editor = useEditorActions()
  return (
    <>
      <InspectorSection defaultOpen title="Content">
        <>
          <SelectField
            address="initialPageIndex"
            label="Initial page"
            onChange={(value) =>
              editor.updateComponent(node.id, (current) =>
                current.type === "carousel"
                  ? { ...current, initialPageIndex: Number(value) }
                  : current,
              )
            }
            value={String(node.initialPageIndex)}
          >
            {node.pages.map((page, index) => (
              <option key={page.id} value={index}>
                Page {index + 1}
              </option>
            ))}
          </SelectField>
        </>
        {node.pages.map((page, index) => (
          <LocalizedField
            address={`pages.${index}.accessibilityLabel`}
            key={page.id}
            label={`Page ${index + 1} label`}
            text={page.accessibilityLabel}
          />
        ))}
        <p className="text-muted-foreground text-[11px] leading-4">
          Arrange each page&apos;s Stack and children directly in Layers.
        </p>
      </InspectorSection>
      <InspectorSection defaultOpen title="Layout">
        <CheckboxField
          address="showsIndicators"
          checked={node.showsIndicators}
          label="Show indicators"
          onChange={(showsIndicators) =>
            editor.updateComponent(node.id, (current) =>
              current.type === "carousel" ? { ...current, showsIndicators } : current,
            )
          }
        />
        <SizingFields node={node} />
      </InspectorSection>
      <SpacingSection node={node} />
      <BackgroundSection node={node} />
      <BorderSection node={node} />
      <AppearanceSection container node={node} />
      <VisibilitySection node={node} />
      <ControlAccessibilitySection node={node} />
      <AdvancedSection node={node} />
    </>
  )
}

export function SwitchInspector({ node }: { node: Extract<ProtocolNode, { type: "switch" }> }) {
  const editor = useEditorActions()
  return (
    <>
      <InspectorSection defaultOpen title="Content">
        <LocalizedField address="label" label="Switch label" text={node.label} />
        <CheckboxField
          address="initialValue"
          checked={node.initialValue}
          label="On by default"
          onChange={(initialValue) =>
            editor.updateComponent(node.id, (current) =>
              current.type === "switch" ? { ...current, initialValue } : current,
            )
          }
        />
      </InspectorSection>
      <AppearanceSection node={node}>
        <SwitchAppearanceFields node={node} />
        <TypographyFields
          node={node}
          onChange={(current, typography) =>
            current.type === "switch"
              ? { ...current, typography: typography as MosaicPaywallV02BaseTypography }
              : current
          }
          typography={node.typography}
        />
      </AppearanceSection>
      <SizingLayoutSection node={node} />
      <BackgroundSection node={node} />
      <BorderSection node={node} />
      <SpacingSection box node={node} />
      <VisibilitySection node={node} />
      <ControlAccessibilitySection node={node} />
      <AdvancedSection node={node} />
    </>
  )
}

export function CountdownInspector({
  node,
}: {
  node: Extract<ProtocolNode, { type: "countdown" }>
}) {
  const editor = useEditorActions()
  return (
    <>
      <InspectorSection defaultOpen title="Content">
        <ComponentTextField
          address="endsAt"
          description="Use an ISO 8601 UTC timestamp."
          label="Ends at"
          onUpdate={(current, endsAt) =>
            current.type === "countdown" ? { ...current, endsAt } : current
          }
          value={node.endsAt}
        />
        <TwoColumn>
          <SelectField
            address="largestUnit"
            label="Largest unit"
            onChange={(largestUnit) =>
              editor.updateComponent(node.id, (current) =>
                current.type === "countdown"
                  ? ({ ...current, largestUnit } as typeof current)
                  : current,
              )
            }
            value={node.largestUnit}
          >
            {["day", "hour", "minute", "second"].map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </SelectField>
          <SelectField
            address="smallestUnit"
            label="Smallest unit"
            onChange={(smallestUnit) =>
              editor.updateComponent(node.id, (current) =>
                current.type === "countdown"
                  ? ({ ...current, smallestUnit } as typeof current)
                  : current,
              )
            }
            value={node.smallestUnit}
          >
            {["day", "hour", "minute", "second"].map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </SelectField>
        </TwoColumn>
        <LocalizedField address="completedText" label="Completed text" text={node.completedText} />
      </InspectorSection>
      <TypographySection
        node={node}
        onChange={(current, typography) =>
          current.type === "countdown"
            ? { ...current, typography: typography as MosaicPaywallV02BaseTypography }
            : current
        }
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

export function InspectorForNode({ node }: { node: ProtocolNode }) {
  switch (node.type) {
    case "stack":
      return <StackInspector node={node} />
    case "text":
      return <TextInspector node={node} />
    case "image":
      return <ImageInspector node={node} />
    case "icon":
      return <IconInspector node={node} />
    case "featureList":
      return <FeatureListInspector node={node} />
    case "productSelector":
      return <ProductSelectorInspector node={node} />
    case "productCard":
      return <ProductCardInspector node={node} />
    case "productBadge":
      return <ProductBadgeInspector node={node} />
    case "button":
      return <ButtonInspector node={node} />
    case "carousel":
      return <CarouselInspector node={node} />
    case "switch":
      return <SwitchInspector node={node} />
    case "countdown":
      return <CountdownInspector node={node} />
  }
}
