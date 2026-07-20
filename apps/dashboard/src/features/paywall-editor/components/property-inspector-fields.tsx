/* eslint-disable react-refresh/only-export-components -- internal inspector modules colocate private controls with their supporting types and transforms. */
import { ArrowsHorizontalIcon } from "@phosphor-icons/react/dist/ssr/ArrowsHorizontal"
import { ArrowsVerticalIcon } from "@phosphor-icons/react/dist/ssr/ArrowsVertical"
import { CaretDownIcon } from "@phosphor-icons/react/dist/ssr/CaretDown"
import { ColumnsIcon } from "@phosphor-icons/react/dist/ssr/Columns"
import { CornersOutIcon } from "@phosphor-icons/react/dist/ssr/CornersOut"
import { LineSegmentIcon } from "@phosphor-icons/react/dist/ssr/LineSegment"
import { PercentIcon } from "@phosphor-icons/react/dist/ssr/Percent"
import { RowsIcon } from "@phosphor-icons/react/dist/ssr/Rows"
import { TextTIcon } from "@phosphor-icons/react/dist/ssr/TextT"
import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { InspectorColorControl } from "@/features/paywall-editor/components/inspector-color-control"
import type {
  LocalizedText,
  MosaicDocument,
  ProtocolColor,
} from "@/features/paywall-editor/types/editor"
import { resolveLocalizedText } from "@/features/paywall-editor/utils/document-tree"
import { updateLocalizedTextByKey } from "@/features/paywall-editor/utils/editor-transforms"
import type { MosaicPaywallV02EdgeInsets } from "@/lib/mosaic-protocol"

import {
  CONTROL_CLASS,
  Field,
  InspectorNode,
  TEXTAREA_CLASS,
  TwoColumn,
  transactionEscape,
  useDocumentTransaction,
  useInspectorContext,
} from "@/features/paywall-editor/components/property-inspector-core"

export function LocalizedField({
  address,
  label,
  multiline = false,
  text,
  tokens,
}: {
  address: string
  label: string
  multiline?: boolean
  text: LocalizedText
  tokens?: readonly { readonly label: string; readonly value: string }[]
}) {
  const { disabled, document, locale } = useInspectorContext()
  const transaction = useDocumentTransaction()
  const value = resolveLocalizedText(document, text, locale)

  function update(value: string) {
    if (disabled || (!transaction.isActive() && !transaction.begin())) return
    transaction.editor.updateDocumentInTransaction((current) =>
      updateLocalizedTextByKey({
        document: current,
        locale,
        localizationKey: text.localizationKey,
        value,
      }),
    )
  }

  return (
    <Field
      address={address}
      description={`Editing ${locale}. Localization keys live under Advanced.`}
      label={label}
    >
      {(fieldProps) => (
        <>
          {multiline ? (
            <textarea
              {...fieldProps}
              className={TEXTAREA_CLASS}
              disabled={disabled}
              onBlur={transaction.commit}
              onChange={(event) => update(event.target.value)}
              onFocus={transaction.begin}
              onKeyDown={(event) => transactionEscape(event, transaction.cancel)}
              value={value}
            />
          ) : (
            <input
              {...fieldProps}
              className={CONTROL_CLASS}
              disabled={disabled}
              onBlur={transaction.commit}
              onChange={(event) => update(event.target.value)}
              onFocus={transaction.begin}
              onKeyDown={(event) => transactionEscape(event, transaction.cancel)}
              type="text"
              value={value}
            />
          )}
          {tokens?.length ? (
            <div aria-label={`${label} variables`} className="flex flex-wrap gap-1.5">
              {tokens.map((token) => (
                <Button
                  disabled={disabled}
                  key={token.value}
                  onClick={() => {
                    const separator = value.length === 0 || value.endsWith(" ") ? "" : " "
                    transaction.editor.updateDocument((current) =>
                      updateLocalizedTextByKey({
                        document: current,
                        locale,
                        localizationKey: text.localizationKey,
                        value: `${value}${separator}${token.value}`,
                      }),
                    )
                  }}
                  size="xs"
                  type="button"
                  variant="outline"
                >
                  {token.label}
                </Button>
              ))}
            </div>
          ) : null}
        </>
      )}
    </Field>
  )
}

export function ComponentTextField({
  address,
  description,
  label,
  onUpdate,
  suggestions,
  value,
}: {
  address: string
  description?: string
  label: string
  onUpdate: (node: InspectorNode, value: string) => InspectorNode
  suggestions?: readonly string[]
  value: string
}) {
  const { componentId, disabled } = useInspectorContext()
  const transaction = useDocumentTransaction()

  function update(nextValue: string) {
    if (disabled || (!transaction.isActive() && !transaction.begin())) return
    transaction.editor.updateComponentInTransaction(componentId, (node) =>
      onUpdate(node, nextValue),
    )
  }

  return (
    <Field address={address} description={description} label={label}>
      {(fieldProps) => (
        <>
          <input
            {...fieldProps}
            className={CONTROL_CLASS}
            disabled={disabled}
            list={suggestions ? `${fieldProps.id}-suggestions` : undefined}
            onBlur={transaction.commit}
            onChange={(event) => update(event.target.value)}
            onFocus={transaction.begin}
            onKeyDown={(event) => transactionEscape(event, transaction.cancel)}
            type="text"
            value={value}
          />
          {suggestions ? (
            <datalist id={`${fieldProps.id}-suggestions`}>
              {suggestions.map((suggestion) => (
                <option key={suggestion} value={suggestion} />
              ))}
            </datalist>
          ) : null}
        </>
      )}
    </Field>
  )
}

export function numberFieldLeadingIcon(address: string, label: string) {
  const iconClass = "size-3.5"
  if (address.includes("cornerRadius")) {
    return <CornersOutIcon aria-hidden className={iconClass} />
  }
  if (address.includes("opacity")) {
    return <PercentIcon aria-hidden className={iconClass} />
  }
  if (address.endsWith("border.width") || label.toLowerCase().includes("weight")) {
    return <LineSegmentIcon aria-hidden className={iconClass} />
  }
  if (address.endsWith("gap") || label.toLowerCase().includes("spacing")) {
    return <RowsIcon aria-hidden className={iconClass} />
  }
  if (address.includes("fontSize")) {
    return <TextTIcon aria-hidden className={iconClass} />
  }
  if (address.includes("lineHeight") || address.includes("height.value")) {
    return <ArrowsVerticalIcon aria-hidden className={iconClass} />
  }
  if (address.includes("width.value")) {
    return <ArrowsHorizontalIcon aria-hidden className={iconClass} />
  }
  return null
}

export function NumberField({
  address,
  description,
  exclusiveMin = false,
  integer = false,
  label,
  max,
  min,
  onChange,
  step = 1,
  unit,
  value,
}: {
  address: string
  description?: string
  exclusiveMin?: boolean
  integer?: boolean
  label: string
  max?: number
  min?: number
  onChange: (value: number) => void
  step?: number
  unit?: string
  value: number
}) {
  const { disabled } = useInspectorContext()
  const transaction = useDocumentTransaction()
  const leadingIcon = numberFieldLeadingIcon(address, label)

  function update(next: number) {
    if (
      disabled ||
      !Number.isFinite(next) ||
      (integer && !Number.isInteger(next)) ||
      (min !== undefined && (exclusiveMin ? next <= min : next < min)) ||
      (max !== undefined && next > max) ||
      (!transaction.isActive() && !transaction.begin())
    ) {
      return
    }
    onChange(next)
  }

  return (
    <Field address={address} description={description} label={label}>
      {(fieldProps) => (
        <div className="relative">
          {leadingIcon ? (
            <span
              aria-hidden
              className="text-muted-foreground pointer-events-none absolute inset-y-0 start-2 flex items-center"
            >
              {leadingIcon}
            </span>
          ) : null}
          <input
            {...fieldProps}
            className={`${CONTROL_CLASS} appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${leadingIcon ? "ps-7" : ""} ${unit ? "pe-10" : ""}`}
            disabled={disabled}
            inputMode="decimal"
            max={max}
            min={min}
            onBlur={transaction.commit}
            onChange={(event) => update(event.target.valueAsNumber)}
            onFocus={transaction.begin}
            onKeyDown={(event) => transactionEscape(event, transaction.cancel)}
            step={step}
            type="number"
            value={value}
          />
          {unit ? (
            <span
              aria-hidden
              className="text-muted-foreground pointer-events-none absolute inset-y-0 end-2 flex items-center text-[11px]"
            >
              {unit}
            </span>
          ) : null}
        </div>
      )}
    </Field>
  )
}

export function SelectField({
  address,
  children,
  description,
  label,
  onChange,
  value,
}: {
  address: string
  children: ReactNode
  description?: string
  label: string
  onChange: (value: string) => void
  value: string
}) {
  const { disabled } = useInspectorContext()
  const leadingIcon = address.includes("direction") ? (
    value === "horizontal" ? (
      <ColumnsIcon aria-hidden className="size-3.5" />
    ) : (
      <RowsIcon aria-hidden className="size-3.5" />
    )
  ) : address.includes("width") ? (
    <ArrowsHorizontalIcon aria-hidden className="size-3.5" />
  ) : address.includes("height") ? (
    <ArrowsVerticalIcon aria-hidden className="size-3.5" />
  ) : null
  return (
    <Field address={address} description={description} label={label}>
      {(fieldProps) => (
        <div className="relative">
          {leadingIcon ? (
            <span
              aria-hidden
              className="text-muted-foreground pointer-events-none absolute inset-y-0 start-2 flex items-center"
            >
              {leadingIcon}
            </span>
          ) : null}
          <select
            {...fieldProps}
            className={`${CONTROL_CLASS} appearance-none pe-7 ${leadingIcon ? "ps-7" : ""}`}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            value={value}
          >
            {children}
          </select>
          <CaretDownIcon
            aria-hidden
            className="text-muted-foreground pointer-events-none absolute end-2 top-1/2 size-3 -translate-y-1/2"
          />
        </div>
      )}
    </Field>
  )
}

export function CheckboxField({
  address,
  checked,
  description,
  label,
  onChange,
}: {
  address: string
  checked: boolean
  description?: string
  label: string
  onChange: (checked: boolean) => void
}) {
  const { disabled } = useInspectorContext()
  return (
    <Field address={address} description={description} label={label}>
      {(fieldProps) => (
        <input
          {...fieldProps}
          checked={checked}
          className="size-4 accent-teal-700"
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          type="checkbox"
        />
      )}
    </Field>
  )
}

export function ColorField({
  address,
  label,
  onUpdate,
  value,
}: {
  address: string
  label: string
  onUpdate: (node: InspectorNode, value: ProtocolColor) => InspectorNode
  value: ProtocolColor
}) {
  const { componentId, disabled, document } = useInspectorContext()
  const transaction = useDocumentTransaction()

  function update(nextValue: ProtocolColor) {
    if (disabled || (!transaction.isActive() && !transaction.begin())) return
    transaction.editor.updateComponentInTransaction(componentId, (node) =>
      onUpdate(node, nextValue),
    )
  }

  return (
    <Field address={address} label={label}>
      {(fieldProps) => (
        <InspectorColorControl
          describedBy={fieldProps["aria-describedby"]}
          disabled={disabled}
          document={document}
          id={fieldProps.id}
          invalid={fieldProps["aria-invalid"] === true}
          label={label}
          onBegin={() => {
            transaction.begin()
          }}
          onCancel={() => {
            transaction.cancel()
          }}
          onChange={update}
          onCommit={() => {
            transaction.commit()
          }}
          value={value}
        />
      )}
    </Field>
  )
}

export function DocumentColorField({
  address,
  label,
  onUpdate,
  value,
}: {
  address: string
  label: string
  onUpdate: (document: MosaicDocument, value: ProtocolColor) => MosaicDocument
  value: ProtocolColor
}) {
  const { disabled, document } = useInspectorContext()
  const transaction = useDocumentTransaction()

  function update(nextValue: ProtocolColor) {
    if (disabled || (!transaction.isActive() && !transaction.begin())) return
    transaction.editor.updateDocumentInTransaction((document) => onUpdate(document, nextValue))
  }

  return (
    <Field address={address} label={label}>
      {(fieldProps) => (
        <InspectorColorControl
          describedBy={fieldProps["aria-describedby"]}
          disabled={disabled}
          document={document}
          id={fieldProps.id}
          invalid={fieldProps["aria-invalid"] === true}
          label={label}
          onBegin={() => {
            transaction.begin()
          }}
          onCancel={() => {
            transaction.cancel()
          }}
          onChange={update}
          onCommit={() => {
            transaction.commit()
          }}
          value={value}
        />
      )}
    </Field>
  )
}

export function EdgeInsetsFields({
  address,
  onChange,
  onEdgeChange,
  value,
}: {
  address: string
  onChange?: (value: MosaicPaywallV02EdgeInsets) => void
  onEdgeChange?: (edge: keyof MosaicPaywallV02EdgeInsets, value: number) => void
  value: MosaicPaywallV02EdgeInsets
}) {
  return (
    <TwoColumn>
      {(
        [
          ["top", "Top"],
          ["start", "Start"],
          ["bottom", "Bottom"],
          ["end", "End"],
        ] as const
      ).map(([edge, label]) => (
        <NumberField
          address={`${address}.${edge}`}
          key={edge}
          label={label}
          max={4096}
          min={0}
          onChange={(next) =>
            onEdgeChange ? onEdgeChange(edge, next) : onChange?.({ ...value, [edge]: next })
          }
          unit="lu"
          value={value[edge]}
        />
      ))}
    </TwoColumn>
  )
}
