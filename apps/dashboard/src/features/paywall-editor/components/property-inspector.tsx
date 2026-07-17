import { useForm } from "@tanstack/react-form"
import type { ReactNode } from "react"

import { useEditorSelection } from "@/features/paywall-editor/hooks/use-editor-selection"
import {
  useEditorActions,
  useEditorStore,
} from "@/features/paywall-editor/stores/editor-store-context"
import type { LocalizedText, ProtocolNode } from "@/features/paywall-editor/types/editor"
import { resolveLocalizedText } from "@/features/paywall-editor/utils/document-tree"
import {
  updateCatalogString,
  updateLocalizedProperty,
} from "@/features/paywall-editor/utils/editor-transforms"

const CONTROL_CLASS =
  "border-input bg-background focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"

function FieldLabel({ children, htmlFor }: { children: ReactNode; htmlFor: string }) {
  return (
    <label className="text-muted-foreground mb-1.5 block text-xs font-medium" htmlFor={htmlFor}>
      {children}
    </label>
  )
}

function LocalizedField({
  componentId,
  property,
  text,
  label,
  multiline = false,
}: {
  componentId: string
  property: "value" | "label"
  text: LocalizedText
  label: string
  multiline?: boolean
}) {
  const { document, currentLocale } = useEditorStore()
  const { updateDocument } = useEditorActions()
  const value = document ? resolveLocalizedText(document, text, currentLocale) : text.default
  const form = useForm({ defaultValues: { value } })
  const fieldId = `property-${componentId}-${property}`

  return (
    <form.Field name="value">
      {(field) => (
        <div>
          <FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
          {multiline ? (
            <textarea
              id={fieldId}
              className={`${CONTROL_CLASS} min-h-24 resize-y`}
              value={field.state.value}
              onBlur={() => {
                field.handleBlur()
                updateDocument((current) =>
                  updateLocalizedProperty({
                    document: current,
                    componentId,
                    property,
                    locale: currentLocale,
                    value: field.state.value,
                  }),
                )
              }}
              onChange={(event) => {
                field.handleChange(event.target.value)
              }}
            />
          ) : (
            <input
              id={fieldId}
              className={CONTROL_CLASS}
              value={field.state.value}
              onBlur={() => {
                field.handleBlur()
                updateDocument((current) =>
                  updateLocalizedProperty({
                    document: current,
                    componentId,
                    property,
                    locale: currentLocale,
                    value: field.state.value,
                  }),
                )
              }}
              onChange={(event) => {
                field.handleChange(event.target.value)
              }}
            />
          )}
          <p className="text-muted-foreground mt-1 text-[11px]">
            Editing {currentLocale}; fallback text remains available offline.
          </p>
        </div>
      )}
    </form.Field>
  )
}

function TextInspector({ node }: { node: Extract<ProtocolNode, { type: "text" }> }) {
  const { updateComponent } = useEditorActions()
  return (
    <div className="space-y-4">
      <LocalizedField
        componentId={node.id}
        property="value"
        text={node.value}
        label="Text"
        multiline
      />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel htmlFor="text-style">Style</FieldLabel>
          <select
            id="text-style"
            className={CONTROL_CLASS}
            value={node.style}
            onChange={(event) =>
              updateComponent(node.id, (current) =>
                current.type === "text"
                  ? { ...current, style: event.target.value as typeof current.style }
                  : current,
              )
            }
          >
            <option value="title">Title</option>
            <option value="body">Body</option>
            <option value="caption">Caption</option>
          </select>
        </div>
        <AlignmentField node={node} />
      </div>
    </div>
  )
}

function AlignmentField({ node }: { node: Extract<ProtocolNode, { type: "text" | "legalText" }> }) {
  const { updateComponent } = useEditorActions()
  return (
    <div>
      <FieldLabel htmlFor={`alignment-${node.id}`}>Alignment</FieldLabel>
      <select
        id={`alignment-${node.id}`}
        className={CONTROL_CLASS}
        value={node.alignment}
        onChange={(event) =>
          updateComponent(node.id, (current) =>
            current.type === "text" || current.type === "legalText"
              ? { ...current, alignment: event.target.value as typeof current.alignment }
              : current,
          )
        }
      >
        <option value="start">Start</option>
        <option value="center">Center</option>
        <option value="end">End</option>
      </select>
    </div>
  )
}

function ProductSelectorInspector({
  node,
}: {
  node: Extract<ProtocolNode, { type: "productSelector" }>
}) {
  const { document, currentLocale } = useEditorStore()
  const { updateComponent } = useEditorActions()
  if (!document) return null

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="text-muted-foreground mb-2 text-xs font-medium">Bound products</legend>
        <div className="space-y-2">
          {document.products.map((product) => {
            const checked = node.productReferenceIds.includes(product.id)
            return (
              <label
                key={product.id}
                className="border-border flex items-center gap-2 rounded-lg border p-2.5 text-sm"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    updateComponent(node.id, (current) => {
                      if (current.type !== "productSelector") return current
                      const references = checked
                        ? current.productReferenceIds.filter((id) => id !== product.id)
                        : [...current.productReferenceIds, product.id]
                      if (references.length === 0) return current
                      return {
                        ...current,
                        productReferenceIds: references,
                        initiallySelectedProductReferenceId: references.includes(
                          current.initiallySelectedProductReferenceId,
                        )
                          ? current.initiallySelectedProductReferenceId
                          : (references[0] ?? current.initiallySelectedProductReferenceId),
                      }
                    })
                  }
                />
                <span>{resolveLocalizedText(document, product.label, currentLocale)}</span>
              </label>
            )
          })}
        </div>
      </fieldset>
      <div>
        <FieldLabel htmlFor="initial-product">Selected by default</FieldLabel>
        <select
          id="initial-product"
          className={CONTROL_CLASS}
          value={node.initiallySelectedProductReferenceId}
          onChange={(event) =>
            updateComponent(node.id, (current) =>
              current.type === "productSelector"
                ? { ...current, initiallySelectedProductReferenceId: event.target.value }
                : current,
            )
          }
        >
          {node.productReferenceIds.map((reference) => (
            <option key={reference} value={reference}>
              {document.products.find((product) => product.id === reference)?.label.default ??
                reference}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

function FeatureValueField({
  componentId,
  localizationKey,
  label,
  value,
}: {
  componentId: string
  localizationKey: string
  label: string
  value: string
}) {
  const { currentLocale } = useEditorStore()
  const { updateDocument } = useEditorActions()
  const form = useForm({ defaultValues: { value } })
  const fieldId = `feature-${componentId}-${localizationKey}`

  return (
    <form.Field name="value">
      {(field) => (
        <div>
          <FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
          <input
            id={fieldId}
            className={CONTROL_CLASS}
            value={field.state.value}
            onBlur={() => {
              field.handleBlur()
              updateDocument((current) =>
                updateCatalogString({
                  document: current,
                  locale: currentLocale,
                  localizationKey,
                  value: field.state.value,
                }),
              )
            }}
            onChange={(event) => field.handleChange(event.target.value)}
          />
        </div>
      )}
    </form.Field>
  )
}

function FeatureListInspector({ node }: { node: Extract<ProtocolNode, { type: "featureList" }> }) {
  const { document, currentLocale } = useEditorStore()
  if (!document) return null

  return (
    <div className="space-y-3">
      {node.items.map((item, index) => (
        <FeatureValueField
          key={item.id}
          componentId={node.id}
          localizationKey={item.text.localizationKey}
          label={`Benefit ${index + 1}`}
          value={resolveLocalizedText(document, item.text, currentLocale)}
        />
      ))}
    </div>
  )
}

function SimpleLabelInspector({
  node,
}: {
  node: Extract<ProtocolNode, { type: "purchaseButton" | "restoreButton" | "closeButton" }>
}) {
  return (
    <LocalizedField componentId={node.id} property="label" text={node.label} label="Button label" />
  )
}

function LegalInspector({ node }: { node: Extract<ProtocolNode, { type: "legalText" }> }) {
  return (
    <div className="space-y-4">
      <LocalizedField
        componentId={node.id}
        property="value"
        text={node.value}
        label="Legal text"
        multiline
      />
      <AlignmentField node={node} />
    </div>
  )
}

function ImageInspector({ node }: { node: Extract<ProtocolNode, { type: "image" }> }) {
  const { document } = useEditorStore()
  const { updateComponent } = useEditorActions()
  if (!document) return null
  return (
    <div className="space-y-4">
      <div>
        <FieldLabel htmlFor="image-asset">Bundled asset</FieldLabel>
        <select
          id="image-asset"
          className={CONTROL_CLASS}
          value={node.assetId}
          onChange={(event) =>
            updateComponent(node.id, (current) =>
              current.type === "image" ? { ...current, assetId: event.target.value } : current,
            )
          }
        >
          {document.assets.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.id}
            </option>
          ))}
        </select>
      </div>
      <div>
        <FieldLabel htmlFor="image-mode">Image fit</FieldLabel>
        <select
          id="image-mode"
          className={CONTROL_CLASS}
          value={node.contentMode}
          onChange={(event) =>
            updateComponent(node.id, (current) =>
              current.type === "image"
                ? { ...current, contentMode: event.target.value as "fit" | "fill" }
                : current,
            )
          }
        >
          <option value="fill">Fill</option>
          <option value="fit">Fit</option>
        </select>
      </div>
    </div>
  )
}

export function PropertyInspector() {
  const { selectedComponent } = useEditorSelection()
  const { currentLocale, document } = useEditorStore()

  return (
    <section aria-labelledby="property-inspector-title">
      <div className="mb-4">
        <h2 id="property-inspector-title" className="text-sm font-semibold">
          Properties
        </h2>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {selectedComponent ? "Changes are applied immediately" : "Select content to edit it"}
        </p>
      </div>
      <div key={`${selectedComponent?.id ?? "none"}:${currentLocale}:${document?.revision ?? 0}`}>
        {!selectedComponent ? (
          <div className="bg-muted text-muted-foreground rounded-xl p-4 text-sm">
            Select a block in the paywall order or preview.
          </div>
        ) : selectedComponent.type === "text" ? (
          <TextInspector node={selectedComponent} />
        ) : selectedComponent.type === "legalText" ? (
          <LegalInspector node={selectedComponent} />
        ) : selectedComponent.type === "productSelector" ? (
          <ProductSelectorInspector node={selectedComponent} />
        ) : selectedComponent.type === "featureList" ? (
          <FeatureListInspector node={selectedComponent} />
        ) : selectedComponent.type === "image" ? (
          <ImageInspector node={selectedComponent} />
        ) : selectedComponent.type === "purchaseButton" ||
          selectedComponent.type === "restoreButton" ||
          selectedComponent.type === "closeButton" ? (
          <SimpleLabelInspector node={selectedComponent} />
        ) : (
          <p className="text-muted-foreground text-sm">
            This stack is arranged in the paywall order panel.
          </p>
        )}
      </div>
    </section>
  )
}
