import { CheckIcon } from "@phosphor-icons/react/dist/ssr/Check"
import { XIcon } from "@phosphor-icons/react/dist/ssr/X"
import { useState } from "react"
import type { CSSProperties } from "react"

import {
  useEditorActions,
  useEditorStore,
} from "@/features/paywall-editor/stores/editor-store-context"
import type {
  MockProductDefinition,
  MockPurchaseState,
  MosaicDocument,
  ProtocolNode,
} from "@/features/paywall-editor/types/editor"
import { resolveLocalizedText } from "@/features/paywall-editor/utils/document-tree"
import { updateLocalizedProperty } from "@/features/paywall-editor/utils/editor-transforms"

function productPrice(product: MockProductDefinition | undefined) {
  return product?.availability === "available" ? product.localizedPrice : "Unavailable"
}

function PreviewNode({
  node,
  document,
  locale,
  selectedComponentId,
  mockProducts,
  mockPurchaseState,
}: {
  node: ProtocolNode
  document: MosaicDocument
  locale: string
  selectedComponentId: string | null
  mockProducts: readonly MockProductDefinition[]
  mockPurchaseState: MockPurchaseState
}) {
  const { selectComponent, updateDocument } = useEditorActions()
  const selected = selectedComponentId === node.id
  const selectableClass = selected
    ? "ring-primary ring-2 ring-offset-2 ring-offset-white"
    : "hover:ring-primary/35 hover:ring-1"

  function select() {
    selectComponent(node.id)
  }

  switch (node.type) {
    case "verticalStack":
      return (
        <div className={`group relative rounded-lg ${selectableClass}`}>
          <button
            type="button"
            className="focus-visible:ring-ring absolute -top-2 -right-2 z-10 rounded-full bg-slate-900 px-2 py-1 text-[10px] font-medium text-white opacity-0 group-hover:opacity-100 focus:opacity-100 focus-visible:ring-2"
            aria-label="Select content group"
            onClick={select}
          >
            Group
          </button>
          <div style={{ display: "flex", flexDirection: "column", gap: node.spacing }}>
            {node.children.map((child) => (
              <PreviewNode
                key={`${child.id}:${document.revision}:${locale}`}
                node={child}
                document={document}
                locale={locale}
                selectedComponentId={selectedComponentId}
                mockProducts={mockProducts}
                mockPurchaseState={mockPurchaseState}
              />
            ))}
          </div>
        </div>
      )
    case "text": {
      const value = resolveLocalizedText(document, node.value, locale)
      const fontSize =
        node.style === "title" ? "1.5em" : node.style === "caption" ? "0.75em" : "0.875em"
      const typographyClass =
        node.style === "title"
          ? "font-semibold leading-tight"
          : node.style === "caption"
            ? "text-slate-500"
            : "leading-6 text-slate-600"
      return (
        <div className={`rounded-md px-1 py-0.5 ${selectableClass}`}>
          {selected ? (
            <InlineEditor
              className={`w-full resize-none bg-transparent focus:outline-none ${typographyClass}`}
              ariaLabel={node.style === "title" ? "Edit headline inline" : "Edit text inline"}
              rows={node.style === "title" ? 2 : 3}
              value={value}
              style={{ fontSize, textAlign: node.alignment }}
              onFocus={select}
              onCommit={(nextValue) =>
                updateDocument((current) =>
                  updateLocalizedProperty({
                    document: current,
                    componentId: node.id,
                    property: "value",
                    locale,
                    value: nextValue,
                  }),
                )
              }
            />
          ) : (
            <button
              type="button"
              className={`w-full ${typographyClass}`}
              style={{ fontSize, textAlign: node.alignment }}
              aria-label={node.style === "title" ? "Select headline" : "Select text"}
              onClick={select}
            >
              {value}
            </button>
          )}
        </div>
      )
    }
    case "image":
      return (
        <button
          type="button"
          className={`flex aspect-video w-full items-center justify-center rounded-xl bg-gradient-to-br from-cyan-100 to-teal-200 text-xs font-medium text-teal-900 ${selectableClass}`}
          onClick={select}
        >
          Image preview
        </button>
      )
    case "featureList":
      return (
        <button
          type="button"
          className={`w-full space-y-2 rounded-xl bg-slate-50 p-4 text-left ${selectableClass}`}
          onClick={select}
        >
          {node.items.map((item) => (
            <span key={item.id} className="flex items-start gap-2 text-sm">
              <CheckIcon className="mt-0.5 shrink-0 text-teal-700" aria-hidden weight="bold" />
              <span>{resolveLocalizedText(document, item.text, locale)}</span>
            </span>
          ))}
        </button>
      )
    case "productSelector": {
      const unavailable = mockPurchaseState === "productUnavailable"
      return (
        <button
          type="button"
          className={`grid w-full gap-2 rounded-xl text-left sm:grid-cols-2 ${selectableClass}`}
          onClick={select}
        >
          {unavailable ? (
            <span className="col-span-full rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              {resolveLocalizedText(document, node.unavailableFallback.message, locale)}
            </span>
          ) : (
            node.productReferenceIds.map((referenceId) => {
              const product = document.products.find((entry) => entry.id === referenceId)
              const mock = mockProducts.find((entry) => entry.productReferenceId === referenceId)
              const chosen = referenceId === node.initiallySelectedProductReferenceId
              return (
                <span
                  key={referenceId}
                  className={`rounded-lg border p-3 ${chosen ? "border-teal-600 bg-teal-50" : "border-slate-200"}`}
                >
                  <span className="block text-xs text-slate-500">
                    {product ? resolveLocalizedText(document, product.label, locale) : referenceId}
                  </span>
                  <span className="mt-1 block font-semibold">{productPrice(mock)}</span>
                </span>
              )
            })
          )}
        </button>
      )
    }
    case "purchaseButton":
      return (
        <button
          type="button"
          className={`w-full rounded-xl bg-teal-700 px-4 py-3 text-sm font-semibold text-white ${selectableClass}`}
          onClick={select}
        >
          {resolveLocalizedText(document, node.label, locale)}
        </button>
      )
    case "restoreButton":
      return (
        <button
          type="button"
          className={`w-full rounded-lg px-4 py-2 text-sm font-medium text-teal-800 ${selectableClass}`}
          onClick={select}
        >
          {resolveLocalizedText(document, node.label, locale)}
        </button>
      )
    case "closeButton":
      return (
        <div className="flex justify-end">
          <button
            type="button"
            className={`grid size-8 place-items-center rounded-full bg-slate-100 text-slate-700 ${selectableClass}`}
            aria-label={resolveLocalizedText(document, node.label, locale)}
            onClick={select}
          >
            <XIcon aria-hidden />
          </button>
        </div>
      )
    case "legalText": {
      const value = resolveLocalizedText(document, node.value, locale)
      return (
        <div className={`rounded-md px-1 py-0.5 ${selectableClass}`}>
          {selected ? (
            <InlineEditor
              className="w-full resize-none bg-transparent leading-5 text-slate-500 focus:outline-none"
              ariaLabel="Edit legal text inline"
              rows={4}
              value={value}
              style={{ fontSize: "0.6875em", textAlign: node.alignment }}
              onFocus={select}
              onCommit={(nextValue) =>
                updateDocument((current) =>
                  updateLocalizedProperty({
                    document: current,
                    componentId: node.id,
                    property: "value",
                    locale,
                    value: nextValue,
                  }),
                )
              }
            />
          ) : (
            <button
              type="button"
              className="w-full leading-5 text-slate-500"
              style={{ fontSize: "0.6875em", textAlign: node.alignment }}
              aria-label="Select legal text"
              onClick={select}
            >
              {value}
            </button>
          )}
        </div>
      )
    }
  }
}

function InlineEditor({
  value,
  rows,
  className,
  style,
  ariaLabel,
  onFocus,
  onCommit,
}: {
  value: string
  rows: number
  className: string
  style: CSSProperties
  ariaLabel: string
  onFocus: () => void
  onCommit: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)
  return (
    <textarea
      className={className}
      aria-label={ariaLabel}
      rows={rows}
      value={draft}
      style={style}
      onFocus={onFocus}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft)
      }}
    />
  )
}

export function PreviewCanvas({
  mockProducts,
  mockPurchaseState,
}: {
  mockProducts: readonly MockProductDefinition[]
  mockPurchaseState: MockPurchaseState
}) {
  const { document, selectedComponentId, currentLocale, previewMode, textScale } = useEditorStore()
  if (!document) return null
  const catalog = document.localization.locales[currentLocale]
  const direction = catalog?.direction ?? "ltr"
  const widthClass =
    previewMode === "tablet"
      ? "max-w-[640px]"
      : previewMode === "landscape"
        ? "max-w-[720px]"
        : "max-w-[390px]"

  return (
    <section
      className="bg-muted/70 flex min-h-[38rem] items-start justify-center overflow-auto rounded-2xl p-5 lg:p-8"
      aria-label="Browser editing preview"
    >
      <div
        className={`w-full ${widthClass} border-border bg-white text-slate-950 shadow-xl ${
          previewMode === "landscape"
            ? "min-h-[390px] rounded-[2rem]"
            : "min-h-[680px] rounded-[2.4rem]"
        }`}
        dir={direction}
        style={{ fontSize: `${16 * textScale}px` }}
      >
        <div
          className="flex min-h-[inherit] flex-col"
          style={{
            gap: document.layout.content.spacing,
            paddingTop: document.layout.content.padding.top,
            paddingInlineStart: document.layout.content.padding.start,
            paddingBottom: document.layout.content.padding.bottom,
            paddingInlineEnd: document.layout.content.padding.end,
          }}
        >
          {document.layout.content.children.map((node) => (
            <PreviewNode
              key={`${node.id}:${document.revision}:${currentLocale}`}
              node={node}
              document={document}
              locale={currentLocale}
              selectedComponentId={selectedComponentId}
              mockProducts={mockProducts}
              mockPurchaseState={mockPurchaseState}
            />
          ))}
        </div>
      </div>
    </section>
  )
}
