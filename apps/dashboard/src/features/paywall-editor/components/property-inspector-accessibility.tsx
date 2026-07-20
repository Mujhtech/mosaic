/* eslint-disable react-refresh/only-export-components -- internal inspector modules colocate private controls with their supporting types and transforms. */
import { PlusIcon } from "@phosphor-icons/react/dist/ssr/Plus"
import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { useEditorActions } from "@/features/paywall-editor/stores/editor-store-context"
import type {
  LocalizedText,
  MosaicDocument,
  ProtocolNode,
} from "@/features/paywall-editor/types/editor"
import { updateNode } from "@/features/paywall-editor/utils/document-tree"
import { createSeededLocalizedText } from "@/features/paywall-editor/utils/editor-transforms"

import {
  CONTROL_CLASS,
  ControlNode,
  Field,
  InspectorSection,
  TwoColumn,
  isControlNode,
  useInspectorContext,
} from "@/features/paywall-editor/components/property-inspector-core"
import {
  CheckboxField,
  LocalizedField,
  NumberField,
  SelectField,
} from "@/features/paywall-editor/components/property-inspector-fields"

export function seedOptionalLocalizedText(options: {
  defaultValue: string
  keyBase: string
  nodeId: string
  update: (node: ProtocolNode, text: LocalizedText) => ProtocolNode
}) {
  return (document: MosaicDocument) => {
    const seeded = createSeededLocalizedText({
      document,
      defaultValue: options.defaultValue,
      keyBase: options.keyBase,
    })
    return updateNode(seeded.document, options.nodeId, (node) => options.update(node, seeded.text))
  }
}

export function ControlAccessibilitySection({ node }: { node: ControlNode }) {
  const { disabled } = useInspectorContext()
  const editor = useEditorActions()

  return (
    <InspectorSection title="Accessibility">
      <LocalizedField
        address="accessibility.label"
        label="Accessibility label"
        text={node.accessibility.label}
      />
      {node.accessibility.hint ? (
        <>
          <LocalizedField
            address="accessibility.hint"
            label="Accessibility hint"
            text={node.accessibility.hint}
          />
          <Button
            disabled={disabled}
            onClick={() =>
              editor.updateComponent(node.id, (current) => {
                if (!isControlNode(current)) return current
                const accessibility = { ...current.accessibility }
                delete accessibility.hint
                return { ...current, accessibility }
              })
            }
            size="xs"
            type="button"
            variant="ghost"
          >
            Remove hint
          </Button>
        </>
      ) : (
        <Button
          disabled={disabled}
          onClick={() =>
            editor.updateDocument(
              seedOptionalLocalizedText({
                defaultValue: "Helpful guidance",
                keyBase: `paywall.${node.id.replaceAll("-", "_")}.accessibility_hint`,
                nodeId: node.id,
                update: (current, hint) =>
                  isControlNode(current)
                    ? { ...current, accessibility: { ...current.accessibility, hint } }
                    : current,
              }),
            )
          }
          size="sm"
          type="button"
          variant="outline"
        >
          <PlusIcon aria-hidden />
          Add accessibility hint
        </Button>
      )}
    </InspectorSection>
  )
}

export function TextAccessibilitySection({
  node,
}: {
  node: Extract<ProtocolNode, { type: "text" | "countdown" }>
}) {
  const { disabled } = useInspectorContext()
  const editor = useEditorActions()
  const label = node.accessibility.label

  return (
    <InspectorSection title="Accessibility">
      <TwoColumn>
        <SelectField
          address="accessibility.role"
          label="Role"
          onChange={(role) =>
            editor.updateComponent(node.id, (current) => {
              if (current.type !== "text" && current.type !== "countdown") return current
              const currentLabel = current.accessibility.label
              return {
                ...current,
                accessibility:
                  role === "heading"
                    ? {
                        role: "heading",
                        level: 2,
                        ...(currentLabel ? { label: currentLabel } : {}),
                      }
                    : { role: "text", ...(currentLabel ? { label: currentLabel } : {}) },
              }
            })
          }
          value={node.accessibility.role}
        >
          <option value="text">Text</option>
          <option value="heading">Heading</option>
        </SelectField>
        {node.accessibility.role === "heading" ? (
          <NumberField
            address="accessibility.level"
            integer
            label="Heading level"
            max={6}
            min={1}
            onChange={(level) =>
              editor.updateComponent(node.id, (current) => {
                if (
                  (current.type !== "text" && current.type !== "countdown") ||
                  current.accessibility.role !== "heading"
                ) {
                  return current
                }
                return {
                  ...current,
                  accessibility: { ...current.accessibility, level },
                }
              })
            }
            value={node.accessibility.level}
          />
        ) : (
          <div />
        )}
      </TwoColumn>
      {label ? (
        <>
          <LocalizedField address="accessibility.label" label="Accessibility label" text={label} />
          <Button
            disabled={disabled}
            onClick={() =>
              editor.updateComponent(node.id, (current) => {
                if (current.type !== "text" && current.type !== "countdown") return current
                const accessibility = { ...current.accessibility }
                delete accessibility.label
                return { ...current, accessibility }
              })
            }
            size="xs"
            type="button"
            variant="ghost"
          >
            Remove custom label
          </Button>
        </>
      ) : (
        <Button
          disabled={disabled}
          onClick={() =>
            editor.updateDocument(
              seedOptionalLocalizedText({
                defaultValue: node.type === "countdown" ? "Offer countdown" : "Text content",
                keyBase: `paywall.${node.id.replaceAll("-", "_")}.accessibility`,
                nodeId: node.id,
                update: (current, nextLabel) => {
                  if (current.type !== "text" && current.type !== "countdown") return current
                  return {
                    ...current,
                    accessibility: { ...current.accessibility, label: nextLabel },
                  }
                },
              }),
            )
          }
          size="sm"
          type="button"
          variant="outline"
        >
          <PlusIcon aria-hidden />
          Add accessibility label
        </Button>
      )}
    </InspectorSection>
  )
}

export function ImageAccessibilitySection({
  node,
}: {
  node: Extract<ProtocolNode, { type: "image" | "icon" }>
}) {
  const editor = useEditorActions()
  return (
    <InspectorSection title="Accessibility">
      <CheckboxField
        address="accessibility.hidden"
        checked={node.accessibility.hidden}
        description="Decorative images are omitted from the accessibility tree."
        label="Decorative; hide from assistive technology"
        onChange={(hidden) => {
          if (hidden) {
            editor.updateComponent(node.id, (current) =>
              current.type === node.type
                ? { ...current, accessibility: { hidden: true } }
                : current,
            )
            return
          }
          editor.updateDocument(
            seedOptionalLocalizedText({
              defaultValue: "Paywall image",
              keyBase: `paywall.${node.id.replaceAll("-", "_")}.accessibility`,
              nodeId: node.id,
              update: (current, label) =>
                current.type === node.type
                  ? { ...current, accessibility: { hidden: false, label } }
                  : current,
            }),
          )
        }}
      />
      {!node.accessibility.hidden ? (
        <LocalizedField
          address="accessibility.label"
          label="Accessibility label"
          text={node.accessibility.label}
        />
      ) : null}
    </InspectorSection>
  )
}

export interface AdvancedProperty {
  readonly address: string
  readonly label: string
  readonly value: string
}

export function addLocalizationKey(
  properties: AdvancedProperty[],
  address: string,
  label: string,
  text: LocalizedText | undefined,
) {
  if (!text) return
  properties.push({
    address: `${address}.localizationKey`,
    label: `${label} localization key`,
    value: text.localizationKey,
  })
}

export function addControlLocalizationKeys(properties: AdvancedProperty[], node: ControlNode) {
  addLocalizationKey(
    properties,
    "accessibility.label",
    "Accessibility label",
    node.accessibility.label,
  )
  addLocalizationKey(
    properties,
    "accessibility.hint",
    "Accessibility hint",
    node.accessibility.hint,
  )
}

export function advancedProperties(node: ProtocolNode) {
  const properties: AdvancedProperty[] = [
    { address: "id", label: "Component ID", value: node.id },
    { address: "type", label: "Component type", value: node.type },
  ]

  switch (node.type) {
    case "stack":
      properties.push({
        address: "children",
        label: "Child count",
        value: String(node.children.length),
      })
      break
    case "text":
      addLocalizationKey(properties, "value", "Text", node.value)
      addLocalizationKey(
        properties,
        "accessibility.label",
        "Accessibility label",
        node.accessibility.label,
      )
      break
    case "image":
    case "icon":
      if (!node.accessibility.hidden) {
        addLocalizationKey(
          properties,
          "accessibility.label",
          "Accessibility label",
          node.accessibility.label,
        )
      }
      break
    case "featureList":
      properties.push({ address: "marker", label: "Marker", value: node.marker })
      node.items.forEach((item, index) => {
        properties.push({
          address: `items.${item.id}.id`,
          label: `Benefit ${index + 1} ID`,
          value: item.id,
        })
        addLocalizationKey(properties, `items.${item.id}.text`, `Benefit ${index + 1}`, item.text)
      })
      addControlLocalizationKeys(properties, node)
      break
    case "productSelector":
      properties.push(
        {
          address: "unavailableFallback.selection",
          label: "Fallback selection",
          value: node.unavailableFallback.selection,
        },
        {
          address: "unavailableFallback.whenNoneAvailable",
          label: "Unavailable policy",
          value: node.unavailableFallback.whenNoneAvailable,
        },
      )
      addLocalizationKey(
        properties,
        "unavailableFallback.message",
        "Unavailable message",
        node.unavailableFallback.message,
      )
      addControlLocalizationKeys(properties, node)
      break
    case "productCard":
      properties.push(
        {
          address: "productReferenceId",
          label: "Product reference",
          value: node.productReferenceId,
        },
        { address: "children", label: "Child count", value: String(node.children.length) },
      )
      addLocalizationKey(
        properties,
        "accessibility.label",
        "Accessibility label",
        node.accessibility?.label,
      )
      break
    case "productBadge":
      properties.push(
        { address: "placement.mode", label: "Placement", value: node.placement.mode },
        { address: "children", label: "Child count", value: String(node.children.length) },
      )
      break
    case "button":
      properties.push({
        address: "children",
        label: "Child count",
        value: String(node.children.length),
      })
      addControlLocalizationKeys(properties, node)
      break
    case "carousel":
      node.pages.forEach((page, index) => {
        properties.push(
          { address: `pages.${index}.id`, label: `Page ${index + 1} ID`, value: page.id },
          {
            address: `pages.${index}.content.id`,
            label: `Page ${index + 1} content ID`,
            value: page.content.id,
          },
        )
        addLocalizationKey(
          properties,
          `pages.${index}.accessibilityLabel`,
          `Page ${index + 1} label`,
          page.accessibilityLabel,
        )
      })
      addControlLocalizationKeys(properties, node)
      break
    case "switch":
      addLocalizationKey(properties, "label", "Switch label", node.label)
      addControlLocalizationKeys(properties, node)
      break
    case "countdown":
      addLocalizationKey(properties, "completedText", "Completed text", node.completedText)
      addLocalizationKey(
        properties,
        "accessibility.label",
        "Accessibility label",
        node.accessibility.label,
      )
      break
  }
  return properties
}

export function AdvancedPropertiesSection({
  children,
  properties,
}: {
  children?: ReactNode
  properties: readonly AdvancedProperty[]
}) {
  return (
    <InspectorSection title="Advanced">
      {children}
      {properties.map((property) => (
        <Field address={property.address} key={property.address} label={property.label}>
          {(fieldProps) => (
            <input
              {...fieldProps}
              className={`${CONTROL_CLASS} font-mono text-xs`}
              readOnly
              value={property.value}
            />
          )}
        </Field>
      ))}
    </InspectorSection>
  )
}

export function AdvancedSection({ children, node }: { children?: ReactNode; node: ProtocolNode }) {
  return (
    <AdvancedPropertiesSection properties={advancedProperties(node)}>
      {children}
    </AdvancedPropertiesSection>
  )
}
