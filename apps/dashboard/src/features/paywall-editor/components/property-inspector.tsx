import { ArrowDownIcon } from "@phosphor-icons/react/dist/ssr/ArrowDown"
import { AlignBottomSimpleIcon } from "@phosphor-icons/react/dist/ssr/AlignBottomSimple"
import { AlignCenterHorizontalSimpleIcon } from "@phosphor-icons/react/dist/ssr/AlignCenterHorizontalSimple"
import { AlignCenterVerticalSimpleIcon } from "@phosphor-icons/react/dist/ssr/AlignCenterVerticalSimple"
import { AlignLeftSimpleIcon } from "@phosphor-icons/react/dist/ssr/AlignLeftSimple"
import { AlignRightSimpleIcon } from "@phosphor-icons/react/dist/ssr/AlignRightSimple"
import { AlignTopSimpleIcon } from "@phosphor-icons/react/dist/ssr/AlignTopSimple"
import { ArrowsHorizontalIcon } from "@phosphor-icons/react/dist/ssr/ArrowsHorizontal"
import { ArrowsVerticalIcon } from "@phosphor-icons/react/dist/ssr/ArrowsVertical"
import { ArrowUpIcon } from "@phosphor-icons/react/dist/ssr/ArrowUp"
import { CaretDownIcon } from "@phosphor-icons/react/dist/ssr/CaretDown"
import { ColumnsIcon } from "@phosphor-icons/react/dist/ssr/Columns"
import { CornersOutIcon } from "@phosphor-icons/react/dist/ssr/CornersOut"
import { EyeIcon } from "@phosphor-icons/react/dist/ssr/Eye"
import { EyeSlashIcon } from "@phosphor-icons/react/dist/ssr/EyeSlash"
import { LineSegmentIcon } from "@phosphor-icons/react/dist/ssr/LineSegment"
import { MinusIcon } from "@phosphor-icons/react/dist/ssr/Minus"
import { PercentIcon } from "@phosphor-icons/react/dist/ssr/Percent"
import { PlusIcon } from "@phosphor-icons/react/dist/ssr/Plus"
import { RowsIcon } from "@phosphor-icons/react/dist/ssr/Rows"
import { TextTIcon } from "@phosphor-icons/react/dist/ssr/TextT"
import { TrashIcon } from "@phosphor-icons/react/dist/ssr/Trash"
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import type { KeyboardEvent, ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { LAYER_TYPE_LABELS } from "@/features/paywall-editor/components/component-catalog"
import { InspectorColorControl } from "@/features/paywall-editor/components/inspector-color-control"
import { LayerTypeIcon } from "@/features/paywall-editor/components/layer-type-icon"
import { useEditorSelection } from "@/features/paywall-editor/hooks/use-editor-selection"
import {
  useEditorActions,
  useEditorStore,
} from "@/features/paywall-editor/stores/editor-store-context"
import type { StudioWorkspaceSnapshot } from "@/features/paywall-editor/stores/studio-workspace-store"
import {
  useStudioWorkspaceActions,
  useStudioWorkspaceSelector,
} from "@/features/paywall-editor/stores/studio-workspace-store-context"
import type {
  LocalizedText,
  MosaicDocument,
  AxisSizing,
  ProtocolBackground,
  ProtocolColor,
  ProtocolNode,
  ProtocolShadow,
  Screen,
  ValidationIssue,
  Visibility,
} from "@/features/paywall-editor/types/editor"
import {
  appendProductBadge,
  appendProductCard,
  findAncestorNodeIds,
  findAncestorNodes,
  findNode,
  findParent,
  flattenDocument,
  resolveLocalizedText,
  updateNode,
} from "@/features/paywall-editor/utils/document-tree"
import {
  createSeededLocalizedText,
  updateLocalizedTextByKey,
} from "@/features/paywall-editor/utils/editor-transforms"
import {
  getInspectorFieldId,
  validationPropertyAddress,
} from "@/features/paywall-editor/utils/property-inspector-navigation"
import { sizingMode } from "@/features/paywall-editor/utils/protocol-styles"
import { fillAxisIsBounded } from "@/features/paywall-editor/utils/sizing"
import {
  appendBackgroundAsset,
  clampGradientAngle,
  defaultMediaBackground,
  insertGradientStop,
  updateGradientStopPosition,
} from "@/features/paywall-editor/utils/style-authoring"
import type {
  MosaicPaywallV02BaseTypography,
  MosaicPaywallV02BoxAppearance,
  MosaicPaywallV02ContainerAppearance,
  MosaicPaywallV02EdgeInsets,
  MosaicPaywallV02ProductCardSelectedStyle,
  MosaicPaywallV02ProductCardStyles,
  MosaicPaywallV02Typography,
} from "@/lib/mosaic-protocol"
import { resolveProductBadgeStyle, resolveProductCardStyle } from "@/lib/mosaic-protocol"

const CONTROL_CLASS =
  "border-input bg-background focus-visible:border-ring focus-visible:ring-ring/30 h-8 w-full rounded-md border px-2 text-sm outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
const TEXTAREA_CLASS =
  "border-input bg-background focus-visible:border-ring focus-visible:ring-ring/30 min-h-24 w-full resize-y rounded-md border px-2 py-2 text-sm outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
const ZERO_INSETS: MosaicPaywallV02EdgeInsets = {
  top: 0,
  start: 0,
  bottom: 0,
  end: 0,
}
const PRODUCT_VARIABLE_TOKENS = [
  { label: "Product name", value: "{{ product.name }}" },
  { label: "Product price", value: "{{ product.price }}" },
] as const
const selectLayerMetadata = (snapshot: StudioWorkspaceSnapshot) =>
  snapshot.preferences.layerMetadata

type ScrollContainer = Screen["layout"]
type InspectorNode = ProtocolNode
type ControlNode = Extract<
  ProtocolNode,
  {
    type: "featureList" | "productSelector" | "button" | "carousel" | "switch"
  }
>
type TypographyValue = MosaicPaywallV02BaseTypography | MosaicPaywallV02Typography
type AppearanceValue = MosaicPaywallV02BoxAppearance | MosaicPaywallV02ContainerAppearance

function isControlNode(node: ProtocolNode): node is ControlNode {
  return (
    node.type === "featureList" ||
    node.type === "productSelector" ||
    node.type === "button" ||
    node.type === "carousel" ||
    node.type === "switch"
  )
}

function layerDisplayLabel(
  document: MosaicDocument,
  id: string,
  labels: Readonly<Record<string, string>>,
) {
  if (document.screens.some((screen) => id === screen.layout.id)) return "Scroll Container"
  const customLabel = labels[id]?.trim()
  if (customLabel) return customLabel
  const node = findNode(document, id)
  if (!node) return "Unknown layer"
  return document.screens.some((screen) => node.id === screen.layout.content.id)
    ? "Content Stack"
    : LAYER_TYPE_LABELS[node.type]
}

function updateScrollContainer(
  document: MosaicDocument,
  layoutId: string,
  updater: (layout: ScrollContainer) => ScrollContainer,
) {
  return {
    ...document,
    screens: document.screens.map((screen) =>
      screen.layout.id === layoutId ? { ...screen, layout: updater(screen.layout) } : screen,
    ),
  }
}

interface InspectorContextValue {
  readonly componentId: string
  readonly disabled: boolean
  readonly document: MosaicDocument
  readonly issues: readonly ValidationIssue[]
  readonly locale: string
}

const InspectorContext = createContext<InspectorContextValue | null>(null)

function useInspectorContext() {
  const context = useContext(InspectorContext)
  if (!context) throw new Error("Inspector fields must be rendered inside PropertyInspector")
  return context
}

function issueMatchesAddress(issue: ValidationIssue, address: string) {
  const issueAddress = validationPropertyAddress(issue)
  return (
    issueAddress === address ||
    (issueAddress.startsWith("items.") && address.startsWith(issueAddress))
  )
}

function Field({
  address,
  children,
  description,
  group = false,
  hideLabel = false,
  label,
}: {
  address: string
  children: (props: {
    "aria-describedby"?: string
    "aria-invalid"?: true
    "aria-labelledby"?: string
    id: string
  }) => ReactNode
  description?: ReactNode
  group?: boolean
  hideLabel?: boolean
  label: ReactNode
}) {
  const { componentId, issues } = useInspectorContext()
  const fieldId = getInspectorFieldId(componentId, address)
  const fieldIssues = issues.filter(
    (issue) => issue.componentId === componentId && issueMatchesAddress(issue, address),
  )
  const descriptionId = description ? `${fieldId}-description` : undefined
  const errorId = fieldIssues.length > 0 ? `${fieldId}-error` : undefined
  const labelId = group ? `${fieldId}-label` : undefined
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined

  return (
    <div
      aria-labelledby={labelId}
      data-component-id={componentId}
      data-property-address={address}
      role={group ? "group" : undefined}
    >
      {group ? (
        <p
          className={hideLabel ? "sr-only" : "text-muted-foreground mb-1.5 text-[11px] font-medium"}
          id={labelId}
        >
          {label}
        </p>
      ) : (
        <label
          className={
            hideLabel ? "sr-only" : "text-muted-foreground mb-1.5 block text-[11px] font-medium"
          }
          htmlFor={fieldId}
        >
          {label}
        </label>
      )}
      {children({
        id: fieldId,
        ...(describedBy ? { "aria-describedby": describedBy } : {}),
        ...(fieldIssues.length > 0 ? { "aria-invalid": true as const } : {}),
      })}
      {description ? (
        <p className="text-muted-foreground mt-1 text-[11px] leading-4" id={descriptionId}>
          {description}
        </p>
      ) : null}
      {fieldIssues.length > 0 ? (
        <div className="text-destructive mt-1 space-y-1 text-xs" id={errorId} role="alert">
          {fieldIssues.map((issue) => (
            <p key={`${issue.code}:${issue.documentPath}`}>{issue.message}</p>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function InspectorSection({
  children,
  defaultOpen = false,
  title,
}: {
  children: ReactNode
  defaultOpen?: boolean
  title: string
}) {
  const initializeOpen = useCallback(
    (section: HTMLDetailsElement | null) => {
      if (section) section.open = defaultOpen
    },
    [defaultOpen],
  )

  return (
    <details
      className="group border-border border-b"
      data-inspector-section={title}
      ref={initializeOpen}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold marker:hidden">
        {title}
        <CaretDownIcon
          aria-hidden
          className="text-muted-foreground size-3.5 transition-transform group-open:rotate-180 motion-reduce:transition-none"
        />
      </summary>
      <div className="space-y-4 px-4 pb-4">{children}</div>
    </details>
  )
}

function TwoColumn({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-2">{children}</div>
}

interface CompactOption {
  readonly icon: ReactNode
  readonly label: string
  readonly value: string
}

function CompactOptionField({
  address,
  label,
  onChange,
  options,
  value,
}: {
  address: string
  label: string
  onChange: (value: string) => void
  options: readonly CompactOption[]
  value: string
}) {
  const { disabled } = useInspectorContext()
  return (
    <Field address={address} group label={label}>
      {(fieldProps) => (
        <div
          {...fieldProps}
          className="border-input bg-muted/35 grid h-9 overflow-hidden rounded-md border p-0.5"
          role="group"
          style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
        >
          {options.map((option) => {
            const selected = option.value === value
            return (
              <button
                aria-label={`${label}: ${option.label}`}
                aria-pressed={selected}
                className={`focus-visible:ring-ring/40 flex min-w-0 items-center justify-center rounded-[5px] outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                  selected
                    ? "bg-primary/10 text-primary ring-primary/20 shadow-xs ring-1"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                disabled={disabled}
                key={option.value}
                onClick={() => onChange(option.value)}
                title={option.label}
                type="button"
              >
                {option.icon}
              </button>
            )
          })}
        </div>
      )}
    </Field>
  )
}

const FLOW_OPTIONS: readonly CompactOption[] = [
  { icon: <RowsIcon aria-hidden className="size-4" />, label: "Vertical", value: "vertical" },
  {
    icon: <ColumnsIcon aria-hidden className="size-4" />,
    label: "Horizontal",
    value: "horizontal",
  },
]

function distributionOptions(direction: "horizontal" | "vertical"): readonly CompactOption[] {
  const vertical = direction === "vertical"
  return [
    {
      icon: vertical ? (
        <AlignTopSimpleIcon aria-hidden className="size-4" />
      ) : (
        <AlignLeftSimpleIcon aria-hidden className="size-4" />
      ),
      label: "Start",
      value: "start",
    },
    {
      icon: vertical ? (
        <AlignCenterVerticalSimpleIcon aria-hidden className="size-4" />
      ) : (
        <AlignCenterHorizontalSimpleIcon aria-hidden className="size-4" />
      ),
      label: "Centre",
      value: "center",
    },
    {
      icon: vertical ? (
        <AlignBottomSimpleIcon aria-hidden className="size-4" />
      ) : (
        <AlignRightSimpleIcon aria-hidden className="size-4" />
      ),
      label: "End",
      value: "end",
    },
    {
      icon: vertical ? (
        <ArrowsVerticalIcon aria-hidden className="size-4" />
      ) : (
        <ArrowsHorizontalIcon aria-hidden className="size-4" />
      ),
      label: "Space between",
      value: "spaceBetween",
    },
  ]
}

function alignmentOptions(direction: "horizontal" | "vertical"): readonly CompactOption[] {
  const vertical = direction === "vertical"
  return [
    {
      icon: vertical ? (
        <AlignLeftSimpleIcon aria-hidden className="size-4" />
      ) : (
        <AlignTopSimpleIcon aria-hidden className="size-4" />
      ),
      label: "Start",
      value: "start",
    },
    {
      icon: vertical ? (
        <AlignCenterHorizontalSimpleIcon aria-hidden className="size-4" />
      ) : (
        <AlignCenterVerticalSimpleIcon aria-hidden className="size-4" />
      ),
      label: "Centre",
      value: "center",
    },
    {
      icon: vertical ? (
        <AlignRightSimpleIcon aria-hidden className="size-4" />
      ) : (
        <AlignBottomSimpleIcon aria-hidden className="size-4" />
      ),
      label: "End",
      value: "end",
    },
    {
      icon: vertical ? (
        <ArrowsHorizontalIcon aria-hidden className="size-4" />
      ) : (
        <ArrowsVerticalIcon aria-hidden className="size-4" />
      ),
      label: "Stretch",
      value: "stretch",
    },
  ]
}

function useDocumentTransaction() {
  const editor = useEditorActions()
  const activeRef = useRef(false)

  function begin() {
    if (activeRef.current) return true
    activeRef.current = editor.beginDocumentTransaction()
    return activeRef.current
  }

  function commit() {
    if (!activeRef.current) return false
    activeRef.current = false
    return editor.commitDocumentTransaction()
  }

  function cancel() {
    if (!activeRef.current) return false
    activeRef.current = false
    return editor.cancelDocumentTransaction()
  }

  return { begin, cancel, commit, editor, isActive: () => activeRef.current }
}

function transactionEscape(event: KeyboardEvent<HTMLElement>, cancel: () => boolean) {
  if (event.key !== "Escape") return
  event.preventDefault()
  cancel()
  event.currentTarget.blur()
}

function LocalizedField({
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

function ComponentTextField({
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

function numberFieldLeadingIcon(address: string, label: string) {
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

function NumberField({
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

function SelectField({
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

function CheckboxField({
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

function ColorField({
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

function DocumentColorField({
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

function EdgeInsetsFields({
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

function updateAppearance(
  node: ProtocolNode,
  updater: (appearance: AppearanceValue) => AppearanceValue,
) {
  return {
    ...node,
    appearance: updater(("appearance" in node ? node.appearance : undefined) ?? {}),
  } as ProtocolNode
}

function defaultBackground(
  type: ProtocolBackground["type"],
  document: MosaicDocument,
): ProtocolBackground | undefined {
  switch (type) {
    case "color":
      return { type, value: "transparent" }
    case "linearGradient":
      return {
        type,
        angle: 180,
        stops: [
          { position: 0, color: "surface.default" },
          { position: 1, color: "surface.elevated" },
        ],
      }
    case "radialGradient":
      return {
        type,
        center: { x: 0.5, y: 0.5 },
        radius: 0.75,
        stops: [
          { position: 0, color: "surface.elevated" },
          { position: 1, color: "surface.default" },
        ],
      }
    case "image":
      return document.assets.find((asset) => asset.type === "image")?.id
        ? defaultMediaBackground(type, document.assets.find((asset) => asset.type === "image")!.id)
        : undefined
    case "video":
      return document.assets.find((asset) => asset.type === "video")?.id
        ? defaultMediaBackground(type, document.assets.find((asset) => asset.type === "video")!.id)
        : undefined
    case "backgroundToken":
      return document.designSystem.backgrounds[0]
        ? { type, id: document.designSystem.backgrounds[0].id }
        : undefined
  }
}

function DocumentBackgroundEditor({
  address,
  colorLabel = "Background",
  noneIsTransparent = false,
  onUpdate,
  value,
}: {
  address: string
  colorLabel?: string
  noneIsTransparent?: boolean
  onUpdate: (document: MosaicDocument, value: ProtocolBackground | undefined) => MosaicDocument
  value: ProtocolBackground | undefined
}) {
  const { componentId, disabled, document } = useInspectorContext()
  const editor = useEditorActions()
  const transparentNone =
    noneIsTransparent && value?.type === "color" && value.value === "transparent"
  const type = transparentNone ? "none" : (value?.type ?? "none")
  const backgroundKey = `${componentId ?? "document"}:${address}`
  const preservedBackground = useRef<{
    key: string
    value: ProtocolBackground | undefined
  }>({
    key: backgroundKey,
    value: type === "none" ? undefined : value,
  })

  if (preservedBackground.current.key !== backgroundKey) {
    preservedBackground.current = {
      key: backgroundKey,
      value: type === "none" ? undefined : value,
    }
  } else if (type !== "none") {
    preservedBackground.current.value = value
  }

  function update(next: ProtocolBackground | undefined) {
    editor.updateDocument((current) => onUpdate(current, next))
  }

  function updateGradientStop(index: number, color: ProtocolColor) {
    if (!value || (value.type !== "linearGradient" && value.type !== "radialGradient")) return
    update({
      ...value,
      stops: value.stops.map((stop, current) => (current === index ? { ...stop, color } : stop)),
    })
  }

  function addAndUseMedia(type: "image" | "video") {
    editor.updateDocument((current) => {
      const result = appendBackgroundAsset(current, type)
      return onUpdate(result.document, defaultMediaBackground(type, result.assetId))
    })
  }

  const imageAssets = document.assets.filter((asset) => asset.type === "image")
  const videoAssets = document.assets.filter((asset) => asset.type === "video")
  const selectedMediaExists =
    value?.type === "image" || value?.type === "video"
      ? document.assets.some((asset) => asset.type === value.type && asset.id === value.assetId)
      : true
  const tokenBackground =
    value?.type === "backgroundToken"
      ? document.designSystem.backgrounds.find((token) => token.id === value.id)?.value
      : undefined
  const visibleBackground = tokenBackground ?? (type === "none" ? undefined : value)
  const fillKind =
    visibleBackground?.type === "linearGradient" || visibleBackground?.type === "radialGradient"
      ? "gradient"
      : visibleBackground?.type === "image" || visibleBackground?.type === "video"
        ? "image"
        : visibleBackground
          ? "color"
          : "none"

  function selectFillKind(nextKind: "color" | "gradient" | "image") {
    if (nextKind === fillKind) return

    if (nextKind === "color") {
      update({ type: "color", value: "surface.default" })
      return
    }

    if (nextKind === "gradient") {
      update(defaultBackground("linearGradient", document))
      return
    }

    const imageBackground = defaultBackground("image", document)
    if (imageBackground) update(imageBackground)
    else addAndUseMedia("image")
  }

  function toggleFillVisibility() {
    if (type === "none") {
      update(preservedBackground.current.value ?? { type: "color", value: "surface.default" })
      return
    }

    preservedBackground.current.value = value
    update(undefined)
  }

  function removeFill() {
    preservedBackground.current.value = undefined
    update(undefined)
  }

  return (
    <div className="space-y-3" data-component-id={componentId} data-property-address={address}>
      <div className="grid grid-cols-[minmax(0,1fr)_2rem_2rem] items-center gap-1.5">
        <div
          aria-label={`${colorLabel} type`}
          className="bg-muted grid h-8 min-w-0 grid-cols-3 rounded-md p-0.5"
          role="group"
        >
          {(
            [
              ["color", "Solid"],
              ["gradient", "Gradient"],
              ["image", "Image"],
            ] as const
          ).map(([kind, label]) => {
            const selected = fillKind === kind
            return (
              <Button
                aria-pressed={selected}
                className={`h-7 min-w-0 rounded-[5px] px-2 text-xs font-medium shadow-none ${
                  selected
                    ? "bg-background text-foreground hover:bg-background shadow-sm"
                    : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
                }`}
                disabled={disabled}
                key={kind}
                onClick={() => selectFillKind(kind)}
                size="sm"
                type="button"
                variant="ghost"
              >
                {label}
              </Button>
            )
          })}
        </div>
        <Button
          aria-label={
            type === "none"
              ? `Show ${colorLabel.toLowerCase()}`
              : `Hide ${colorLabel.toLowerCase()}`
          }
          aria-pressed={type !== "none"}
          disabled={disabled}
          onClick={toggleFillVisibility}
          size="icon"
          title={
            type === "none"
              ? `Show ${colorLabel.toLowerCase()}`
              : `Hide ${colorLabel.toLowerCase()}`
          }
          type="button"
          variant="ghost"
        >
          {type === "none" ? <EyeSlashIcon aria-hidden /> : <EyeIcon aria-hidden />}
        </Button>
        <Button
          aria-label={`Remove ${colorLabel.toLowerCase()}`}
          disabled={disabled || type === "none"}
          onClick={removeFill}
          size="icon"
          title={`Remove ${colorLabel.toLowerCase()}`}
          type="button"
          variant="ghost"
        >
          <MinusIcon aria-hidden />
        </Button>
      </div>
      {imageAssets.length === 0 || videoAssets.length === 0 || !selectedMediaExists ? (
        <div className="border-border bg-muted/30 flex flex-wrap items-center gap-1.5 rounded-md border p-2">
          {!selectedMediaExists ? (
            <p className="text-muted-foreground w-full text-[11px] leading-4">
              The selected media asset is missing. Add a replacement to keep this background valid.
            </p>
          ) : null}
          {imageAssets.length === 0 || (value?.type === "image" && !selectedMediaExists) ? (
            <Button
              onClick={() => addAndUseMedia("image")}
              size="xs"
              type="button"
              variant="outline"
            >
              <PlusIcon aria-hidden /> Add image
            </Button>
          ) : null}
          {videoAssets.length === 0 || (value?.type === "video" && !selectedMediaExists) ? (
            <Button
              onClick={() => addAndUseMedia("video")}
              size="xs"
              type="button"
              variant="outline"
            >
              <PlusIcon aria-hidden /> Add video
            </Button>
          ) : null}
        </div>
      ) : null}
      {value?.type === "backgroundToken" ? (
        <SelectField
          address={`${address}.id`}
          label="Background style"
          onChange={(id) => update({ type: "backgroundToken", id })}
          value={value.id}
        >
          {document.designSystem.backgrounds.map((token) => (
            <option key={token.id} value={token.id}>
              {token.name}
            </option>
          ))}
        </SelectField>
      ) : null}
      {type === "color" && value?.type === "color" ? (
        <DocumentColorField
          address={`${address}.value`}
          label={colorLabel}
          onUpdate={(current, color) => onUpdate(current, { ...value, value: color })}
          value={value.value}
        />
      ) : null}
      {value?.type === "linearGradient" ? (
        <NumberField
          address={`${address}.angle`}
          label="Angle"
          max={360}
          min={0}
          onChange={(angle) => update({ ...value, angle: clampGradientAngle(angle) })}
          unit="°"
          value={value.angle}
        />
      ) : null}
      {value?.type === "radialGradient" ? (
        <>
          <TwoColumn>
            <NumberField
              address={`${address}.center.x`}
              label="Centre X"
              max={100}
              min={0}
              onChange={(x) => update({ ...value, center: { ...value.center, x: x / 100 } })}
              unit="%"
              value={Math.round(value.center.x * 100)}
            />
            <NumberField
              address={`${address}.center.y`}
              label="Centre Y"
              max={100}
              min={0}
              onChange={(y) => update({ ...value, center: { ...value.center, y: y / 100 } })}
              unit="%"
              value={Math.round(value.center.y * 100)}
            />
          </TwoColumn>
          <NumberField
            address={`${address}.radius`}
            label="Radius"
            max={200}
            min={1}
            onChange={(radius) => update({ ...value, radius: radius / 100 })}
            unit="%"
            value={Math.round(value.radius * 100)}
          />
        </>
      ) : null}
      {value?.type === "linearGradient" || value?.type === "radialGradient" ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-[11px]">Colour stops</span>
            <Button
              disabled={value.stops.length >= 8}
              onClick={() =>
                update({
                  ...value,
                  stops: insertGradientStop(value.stops),
                })
              }
              size="xs"
              type="button"
              variant="ghost"
            >
              <PlusIcon aria-hidden /> Stop
            </Button>
          </div>
          {value.stops.map((stop, index) => (
            <div className="grid grid-cols-[1fr_4.5rem_auto] items-end gap-1.5" key={index}>
              <InspectorColorControl
                disabled={false}
                document={document}
                id={`${address}-stop-${index}`}
                label={`Stop ${index + 1}`}
                onBegin={() => editor.beginDocumentTransaction()}
                onCancel={() => editor.cancelDocumentTransaction()}
                onChange={(color) => updateGradientStop(index, color)}
                onCommit={() => editor.commitDocumentTransaction()}
                value={stop.color}
              />
              <label className="grid gap-1 text-[11px]">
                <span className="text-muted-foreground">Position</span>
                <input
                  className={CONTROL_CLASS}
                  max={100}
                  min={0}
                  onChange={(event) =>
                    update({
                      ...value,
                      stops: updateGradientStopPosition(
                        value.stops,
                        index,
                        event.target.valueAsNumber / 100,
                      ),
                    })
                  }
                  type="number"
                  value={Math.round(stop.position * 100)}
                />
              </label>
              <Button
                aria-label={`Delete stop ${index + 1}`}
                disabled={value.stops.length <= 2}
                onClick={() =>
                  update({ ...value, stops: value.stops.filter((_, i) => i !== index) })
                }
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <TrashIcon aria-hidden />
              </Button>
            </div>
          ))}
        </div>
      ) : null}
      {value?.type === "image" || value?.type === "video" ? (
        <>
          <SelectField
            address={`${address}.assetId`}
            label={`${value.type === "image" ? "Image" : "Video"} asset`}
            onChange={(assetId) => update({ ...value, assetId })}
            value={value.assetId}
          >
            {(value.type === "image" ? imageAssets : videoAssets).map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.id}
              </option>
            ))}
          </SelectField>
          <SelectField
            address={`${address}.contentMode`}
            label="Content mode"
            onChange={(contentMode) =>
              update({ ...value, contentMode: contentMode as "fit" | "fill" })
            }
            value={value.contentMode}
          >
            <option value="fit">Fit</option>
            <option value="fill">Fill</option>
          </SelectField>
          {value.type === "video" ? (
            <SelectField
              address={`${address}.posterAssetId`}
              label="Poster image"
              onChange={(posterAssetId) =>
                update({ ...value, posterAssetId: posterAssetId || undefined })
              }
              value={value.posterAssetId ?? ""}
            >
              <option value="">No poster</option>
              {document.assets
                .filter((asset) => asset.type === "image")
                .map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.id}
                  </option>
                ))}
            </SelectField>
          ) : null}
          <DocumentColorField
            address={`${address}.fallbackColor`}
            label="Fallback colour"
            onUpdate={(current, fallbackColor) => onUpdate(current, { ...value, fallbackColor })}
            value={value.fallbackColor}
          />
        </>
      ) : null}
    </div>
  )
}

function BackgroundSection({ node }: { node: ProtocolNode }) {
  const appearance = ("appearance" in node ? node.appearance : undefined) ?? {}
  return (
    <>
      <InspectorSection title="Background">
        <DocumentBackgroundEditor
          address="appearance.background"
          onUpdate={(document, background) =>
            updateNode(document, node.id, (current) =>
              updateAppearance(current, (currentAppearance) => {
                if (background) return { ...currentAppearance, background }
                const rest = { ...currentAppearance }
                delete rest.background
                return rest
              }),
            )
          }
          value={appearance.background}
        />
      </InspectorSection>
      <ShadowSection node={node} />
    </>
  )
}

function ShadowSection({ node }: { node: ProtocolNode }) {
  const { document } = useInspectorContext()
  const editor = useEditorActions()
  const appearance = ("appearance" in node ? node.appearance : undefined) ?? {}
  const shadow = appearance.shadow

  function update(next: ProtocolShadow | undefined) {
    editor.updateComponent(node.id, (current) =>
      updateAppearance(current, (currentAppearance) => {
        if (next) return { ...currentAppearance, shadow: next }
        const rest = { ...currentAppearance }
        delete rest.shadow
        return rest
      }),
    )
  }

  return (
    <InspectorSection title="Shadow">
      <SelectField
        address="appearance.shadow.type"
        label="Style"
        onChange={(type) =>
          update(
            type === "none"
              ? undefined
              : type === "shadowToken"
                ? document.designSystem.shadows[0]
                  ? { type, id: document.designSystem.shadows[0].id }
                  : undefined
                : {
                    type: "shadow",
                    color: "#00000033",
                    offsetX: 0,
                    offsetY: 8,
                    blurRadius: 24,
                  },
          )
        }
        value={shadow?.type ?? "none"}
      >
        <option value="none">None</option>
        <option value="shadow">Custom</option>
        <option disabled={document.designSystem.shadows.length === 0} value="shadowToken">
          Design-system shadow
        </option>
      </SelectField>
      {shadow?.type === "shadowToken" ? (
        <SelectField
          address="appearance.shadow.id"
          label="Shadow style"
          onChange={(id) => update({ type: "shadowToken", id })}
          value={shadow.id}
        >
          {document.designSystem.shadows.map((token) => (
            <option key={token.id} value={token.id}>
              {token.name}
            </option>
          ))}
        </SelectField>
      ) : null}
      {shadow?.type === "shadow" ? (
        <>
          <ColorField
            address="appearance.shadow.color"
            label="Colour"
            onUpdate={(current, color) =>
              updateAppearance(current, (currentAppearance) => ({
                ...currentAppearance,
                shadow:
                  currentAppearance.shadow?.type === "shadow"
                    ? { ...currentAppearance.shadow, color }
                    : shadow,
              }))
            }
            value={shadow.color}
          />
          <div className="grid grid-cols-3 gap-1.5">
            {(["offsetX", "offsetY", "blurRadius"] as const).map((property) => (
              <NumberField
                address={`appearance.shadow.${property}`}
                key={property}
                label={property === "offsetX" ? "X" : property === "offsetY" ? "Y" : "Blur"}
                max={4096}
                min={property === "blurRadius" ? 0 : -4096}
                onChange={(value) => update({ ...shadow, [property]: value })}
                unit="lu"
                value={shadow[property]}
              />
            ))}
          </div>
        </>
      ) : null}
    </InspectorSection>
  )
}

function BorderFields({ node }: { node: ProtocolNode }) {
  const editor = useEditorActions()
  const appearance = ("appearance" in node ? node.appearance : undefined) ?? {}
  const border = appearance.border ?? { color: "border.default" as const, width: 0 }

  function update(updater: (value: AppearanceValue) => AppearanceValue) {
    editor.updateComponent(node.id, (current) => updateAppearance(current, updater))
  }

  return (
    <div className="space-y-3">
      <ColorField
        address="appearance.border.color"
        label="Stroke colour"
        onUpdate={(current, color) =>
          updateAppearance(current, (currentAppearance) => ({
            ...currentAppearance,
            border: {
              color,
              width: currentAppearance.border?.width ?? 1,
            },
          }))
        }
        value={border.color}
      />
      <NumberField
        address="appearance.border.width"
        label="Stroke weight"
        max={4096}
        min={0}
        onChange={(width) =>
          update((currentAppearance) => ({
            ...currentAppearance,
            border: { color: currentAppearance.border?.color ?? "border.default", width },
          }))
        }
        unit="lu"
        value={border.width}
      />
    </div>
  )
}

function BorderSection({ node }: { node: ProtocolNode }) {
  return (
    <InspectorSection title="Border">
      <BorderFields node={node} />
    </InspectorSection>
  )
}

function AppearanceSection({
  children,
  container = false,
  node,
}: {
  children?: ReactNode
  container?: boolean
  node: ProtocolNode
}) {
  const editor = useEditorActions()
  const appearance = ("appearance" in node ? node.appearance : undefined) ?? {}

  function update(updater: (value: AppearanceValue) => AppearanceValue) {
    editor.updateComponent(node.id, (current) => updateAppearance(current, updater))
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
            update((currentAppearance) => ({ ...currentAppearance, cornerRadius }))
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
            update((currentAppearance) => ({ ...currentAppearance, opacity: opacity / 100 }))
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
            "clipContent" in appearance && typeof appearance.clipContent === "boolean"
              ? appearance.clipContent
              : false
          }
          label="Clip content"
          onChange={(clipContent) =>
            update((currentAppearance) => ({ ...currentAppearance, clipContent }))
          }
        />
      ) : null}
    </InspectorSection>
  )
}

function AppearancePaddingFields({ node }: { node: ProtocolNode }) {
  const editor = useEditorActions()
  const appearance = ("appearance" in node ? node.appearance : undefined) ?? {}
  const padding = "padding" in appearance && appearance.padding ? appearance.padding : ZERO_INSETS

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
              })),
            )
          }
          value={padding}
        />
      )}
    </Field>
  )
}

function SpacingSection({
  box = false,
  children,
  node,
}: {
  box?: boolean
  children?: ReactNode
  node: ProtocolNode
}) {
  return (
    <InspectorSection title="Spacing">
      {children}
      {box ? <AppearancePaddingFields node={node} /> : null}
      <OuterInsetsFields node={node} />
    </InspectorSection>
  )
}

function SizingLayoutSection({ node }: { node: ProtocolNode }) {
  return (
    <InspectorSection defaultOpen title="Layout">
      <SizingFields node={node} />
    </InspectorSection>
  )
}

function SwitchAppearanceFields({ node }: { node: Extract<ProtocolNode, { type: "switch" }> }) {
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
  )
}

function SizingFields({ node }: { node: ProtocolNode }) {
  const { document } = useInspectorContext()
  const editor = useEditorActions()
  const sizing = "sizing" in node ? node.sizing : undefined
  const width: AxisSizing = sizing?.width ?? "fit"
  const height: AxisSizing = sizing?.height ?? "fit"
  const widthFillBounded = fillAxisIsBounded(document, node, "width")
  const heightFillBounded = fillAxisIsBounded(document, node, "height")

  function updateSizing(nextSizing: Record<string, unknown>) {
    editor.updateComponent(node.id, (current) => {
      return {
        ...current,
        sizing: {
          width: ("sizing" in current ? current.sizing?.width : undefined) ?? "fit",
          height: ("sizing" in current ? current.sizing?.height : undefined) ?? "fit",
          ...nextSizing,
        },
      } as ProtocolNode
    })
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
          onValueChange={(value) => updateSizing({ width: { mode: "fixed", value } })}
          value={width}
        />
        <SizingAxisField
          axis="height"
          onModeChange={(mode) =>
            updateSizing({
              height: mode === "fixed" ? { mode: "fixed", value: 240 } : mode,
            })
          }
          onValueChange={(value) => updateSizing({ height: { mode: "fixed", value } })}
          value={height}
        />
      </TwoColumn>
      {sizingMode(width) === "fill" && !widthFillBounded ? (
        <p className="text-muted-foreground text-[11px] leading-4">
          Width Fill is unbounded here, so previews recover to Fit.
        </p>
      ) : null}
      {sizingMode(height) === "fill" && !heightFillBounded ? (
        <p className="text-muted-foreground text-[11px] leading-4">
          Height Fill is unbounded here, so previews recover to Fit.
        </p>
      ) : null}
    </div>
  )
}

function SizingAxisField({
  axis,
  onModeChange,
  onValueChange,
  value,
}: {
  axis: "height" | "width"
  onModeChange: (mode: "fill" | "fit" | "fixed") => void
  onValueChange: (value: number) => void
  value: AxisSizing
}) {
  const { disabled } = useInspectorContext()
  const mode = sizingMode(value)
  const axisLabel = axis === "width" ? "Width" : "Height"
  const prefix = axis === "width" ? "W" : "H"

  return (
    <Field address={`sizing.${axis}`} hideLabel label={axisLabel}>
      {(fieldProps) => (
        <div className="border-input bg-background focus-within:border-ring focus-within:ring-ring/30 flex h-9 min-w-0 items-center overflow-hidden rounded-md border focus-within:ring-2">
          <span className="text-muted-foreground ps-2 text-xs font-medium" aria-hidden>
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
                const next = event.target.valueAsNumber
                if (Number.isFinite(next) && next > 0 && next <= 4096) onValueChange(next)
              }}
              step={1}
              type="number"
              value={value.value}
            />
          ) : (
            <span className="min-w-0 flex-1 px-2 text-sm capitalize">{mode}</span>
          )}
          <span
            className="border-input relative h-full w-8 shrink-0 border-s"
            title={`${axisLabel} behaviour`}
          >
            <select
              {...fieldProps}
              aria-label={`${axisLabel} behaviour`}
              className="absolute inset-0 size-full cursor-pointer appearance-none bg-transparent text-transparent outline-none disabled:cursor-not-allowed"
              disabled={disabled}
              onChange={(event) => onModeChange(event.target.value as "fill" | "fit" | "fixed")}
              value={mode}
            >
              <option value="fit">Fit</option>
              <option value="fill">Fill</option>
              <option value="fixed">Fixed</option>
            </select>
            <CaretDownIcon
              aria-hidden
              className="text-muted-foreground pointer-events-none absolute start-1/2 top-1/2 size-3 -translate-x-1/2 -translate-y-1/2"
            />
          </span>
        </div>
      )}
    </Field>
  )
}

function OuterInsetsFields({ node }: { node: ProtocolNode }) {
  const editor = useEditorActions()
  return (
    <Field address="outerInsets" group label="Outer spacing">
      {() => (
        <EdgeInsetsFields
          address="outerInsets"
          onChange={(outerInsets) =>
            editor.updateComponent(
              node.id,
              (current) => ({ ...current, outerInsets }) as ProtocolNode,
            )
          }
          value={("outerInsets" in node ? node.outerInsets : undefined) ?? ZERO_INSETS}
        />
      )}
    </Field>
  )
}

function TypographyFields({
  node,
  onChange,
  supportsMaxLines = false,
  typography,
}: {
  node: ProtocolNode
  onChange: (node: ProtocolNode, typography: TypographyValue) => ProtocolNode
  supportsMaxLines?: boolean
  typography: TypographyValue
}) {
  const editor = useEditorActions()
  const extended = typography as MosaicPaywallV02Typography

  function update(next: TypographyValue) {
    editor.updateComponent(node.id, (current) => onChange(current, next))
  }

  return (
    <>
      <TwoColumn>
        <SelectField
          address="typography.style"
          label="Text style"
          onChange={(style) => update({ ...typography, style } as TypographyValue)}
          value={typography.style}
        >
          {["display", "title", "heading", "body", "label", "caption"].map((style) => (
            <option key={style} value={style}>
              {style[0]?.toUpperCase()}
              {style.slice(1)}
            </option>
          ))}
        </SelectField>
        <SelectField
          address="typography.weight"
          label="Weight"
          onChange={(weight) => update({ ...typography, weight } as TypographyValue)}
          value={typography.weight}
        >
          {["regular", "medium", "semibold", "bold"].map((weight) => (
            <option key={weight} value={weight}>
              {weight[0]?.toUpperCase()}
              {weight.slice(1)}
            </option>
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
          onChange={(lineHeightMultiplier) => update({ ...typography, lineHeightMultiplier })}
          step={0.05}
          unit="×"
          value={typography.lineHeightMultiplier}
        />
      </TwoColumn>
      <div className="space-y-3">
        <ColorField
          address="typography.color"
          label="Colour"
          onUpdate={(current, color) => onChange(current, { ...typography, color })}
          value={typography.color}
        />
        <SelectField
          address="typography.alignment"
          label="Alignment"
          onChange={(alignment) => update({ ...typography, alignment } as TypographyValue)}
          value={typography.alignment}
        >
          <option value="start">Start</option>
          <option value="center">Centre</option>
          <option value="end">End</option>
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
                update({ ...extended, maxLines: 2, overflow: "ellipsis" })
                return
              }
              const next = { ...extended }
              delete next.maxLines
              delete next.overflow
              update(next)
            }}
          />
          {extended.maxLines !== undefined ? (
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
                  update({ ...extended, overflow } as MosaicPaywallV02Typography)
                }
                value={extended.overflow ?? "ellipsis"}
              >
                <option value="ellipsis">Ellipsis</option>
                <option value="clip">Clip</option>
              </SelectField>
            </TwoColumn>
          ) : null}
        </>
      ) : null}
    </>
  )
}

function TypographySection({
  node,
  onChange,
  supportsMaxLines = false,
  typography,
}: {
  node: ProtocolNode
  onChange: (node: ProtocolNode, typography: TypographyValue) => ProtocolNode
  supportsMaxLines?: boolean
  typography: TypographyValue
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
  )
}

function VisibilitySection({ node }: { node: ProtocolNode }) {
  const { document } = useInspectorContext()
  const editor = useEditorActions()
  const switches = flattenDocument(document)
    .map((entry) => entry.node)
    .filter(
      (candidate): candidate is Extract<ProtocolNode, { type: "switch" }> =>
        candidate.type === "switch",
    )
  const visibility = ("visibility" in node ? node.visibility : undefined) ?? {
    mode: "always" as const,
  }

  function update(nextVisibility: Visibility) {
    editor.updateComponent(
      node.id,
      (current) =>
        ({
          ...current,
          visibility: nextVisibility,
        }) as ProtocolNode,
    )
  }

  return (
    <InspectorSection title="Visibility">
      <SelectField
        address="visibility.mode"
        label="Visibility"
        onChange={(mode) => {
          if (mode === "hidden") {
            update({ mode: "hidden" })
          } else if (mode === "switch" && switches[0]) {
            update({ mode: "switch", switchId: switches[0].id, equals: true })
          } else {
            update({ mode: "always" })
          }
        }}
        value={visibility.mode}
      >
        <option value="always">Always visible</option>
        <option value="hidden">Hidden</option>
        <option disabled={switches.length === 0} value="switch">
          Controlled by switch
        </option>
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
              <option key={candidate.id} value={candidate.id}>
                {resolveLocalizedText(
                  document,
                  candidate.label,
                  document.localization.defaultLocale,
                )}
              </option>
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
    </InspectorSection>
  )
}

function seedOptionalLocalizedText(options: {
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

function ControlAccessibilitySection({ node }: { node: ControlNode }) {
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

function TextAccessibilitySection({
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

function ImageAccessibilitySection({
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

interface AdvancedProperty {
  readonly address: string
  readonly label: string
  readonly value: string
}

function addLocalizationKey(
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

function addControlLocalizationKeys(properties: AdvancedProperty[], node: ControlNode) {
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

function advancedProperties(node: ProtocolNode) {
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

function AdvancedPropertiesSection({
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

function AdvancedSection({ children, node }: { children?: ReactNode; node: ProtocolNode }) {
  return (
    <AdvancedPropertiesSection properties={advancedProperties(node)}>
      {children}
    </AdvancedPropertiesSection>
  )
}

function ScrollContainerInspector({ layout }: { layout: ScrollContainer }) {
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

function StackInspector({ node }: { node: Extract<ProtocolNode, { type: "stack" }> }) {
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

function TextInspector({ node }: { node: Extract<ProtocolNode, { type: "text" }> }) {
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

function ImageInspector({ node }: { node: Extract<ProtocolNode, { type: "image" }> }) {
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
          {document.assets
            .filter((asset) => asset.type === "image")
            .map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.id}
              </option>
            ))}
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

function IconInspector({ node }: { node: Extract<ProtocolNode, { type: "icon" }> }) {
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

function FeatureListInspector({ node }: { node: Extract<ProtocolNode, { type: "featureList" }> }) {
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

type CardState = "default" | "selected"
type ProductLayerNode = Extract<ProtocolNode, { type: "productCard" | "productBadge" }>

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
] as const

function productStyleOverrideExists(
  style: MosaicPaywallV02ProductCardSelectedStyle,
  path: readonly string[],
) {
  let current: unknown = style
  for (const segment of path) {
    if (!current || typeof current !== "object" || !(segment in current)) return false
    current = (current as Record<string, unknown>)[segment]
  }
  return true
}

function removeProductStyleOverride(
  style: MosaicPaywallV02ProductCardSelectedStyle,
  path: readonly string[],
) {
  function remove(value: Record<string, unknown>, remaining: readonly string[]) {
    const [segment, ...rest] = remaining
    if (!segment) return value
    const next = { ...value }
    if (rest.length === 0) {
      delete next[segment]
      return next
    }
    const child = next[segment]
    if (!child || typeof child !== "object" || Array.isArray(child)) return next
    const nextChild = remove(child as Record<string, unknown>, rest)
    if (Object.keys(nextChild).length === 0) delete next[segment]
    else next[segment] = nextChild
    return next
  }

  return remove(style as Record<string, unknown>, path) as MosaicPaywallV02ProductCardSelectedStyle
}

function ProductLayerStyleSection({ node }: { node: ProductLayerNode }) {
  const { disabled, document, issues } = useInspectorContext()
  const editor = useEditorActions()
  const [state, setState] = useState<CardState>(() =>
    issues.some(
      (issue) => issue.componentId === node.id && issue.property?.startsWith("styles.selected"),
    )
      ? "selected"
      : "default",
  )
  const resolved =
    node.type === "productCard"
      ? resolveProductCardStyle(node, state === "selected")
      : resolveProductBadgeStyle(node, state === "selected")
  const customShadow = resolved.shadow?.type === "shadow" ? resolved.shadow : null
  const activeOverrides = PRODUCT_STYLE_OVERRIDE_FIELDS.filter(({ path }) =>
    productStyleOverrideExists(node.styles.selected, path),
  )

  useEffect(() => {
    editor.setProductLayerPreview({ nodeId: node.id, state })
    return () => editor.setProductLayerPreview(null)
  }, [editor, node.id, state])

  function updateStyles(
    updater: (styles: MosaicPaywallV02ProductCardStyles) => MosaicPaywallV02ProductCardStyles,
  ) {
    editor.updateComponent(node.id, (current) => {
      if (current.type !== "productCard" && current.type !== "productBadge") return current
      return { ...current, styles: updater(current.styles) } as ProtocolNode
    })
  }

  function setValue(key: "background" | "cornerRadius" | "opacity" | "shadow", value: unknown) {
    updateStyles((styles) =>
      state === "default"
        ? { ...styles, default: { ...styles.default, [key]: value } }
        : { ...styles, selected: { ...styles.selected, [key]: value } },
    )
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
          },
    )
  }

  function setPaddingEdge(edge: keyof MosaicPaywallV02EdgeInsets, value: number) {
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
          },
    )
  }

  function resetSelectedOverride(path: readonly string[]) {
    updateStyles((styles) => ({
      ...styles,
      selected: removeProductStyleOverride(styles.selected, path),
    }))
  }

  return (
    <InspectorSection title="Appearance">
      <div
        aria-label="Product layer state"
        className="bg-muted grid grid-cols-2 rounded-md p-0.5"
        role="group"
      >
        {(["default", "selected"] as const).map((candidate) => (
          <button
            aria-pressed={state === candidate}
            className="aria-pressed:bg-background aria-pressed:text-foreground text-muted-foreground h-7 rounded-[5px] text-xs font-medium aria-pressed:shadow-sm"
            key={candidate}
            onClick={() => setState(candidate)}
            type="button"
          >
            {candidate === "default" ? "Default" : "Selected"}
          </button>
        ))}
      </div>
      {state === "selected" ? (
        <div className="bg-muted/60 space-y-2 rounded-md p-2 text-[11px] leading-4">
          <p>Selected values inherit from Default until you change them.</p>
          {activeOverrides.length > 0 ? (
            <div aria-label="Selected appearance overrides" className="flex flex-wrap gap-1">
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
            </div>
          ) : (
            <p className="text-muted-foreground">No Selected overrides.</p>
          )}
          <Button
            className="w-full"
            disabled={disabled || activeOverrides.length === 0}
            onClick={() => updateStyles((styles) => ({ ...styles, selected: {} }))}
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
            current.type === "productCard" || current.type === "productBadge"
              ? {
                  ...current,
                  styles: {
                    ...current.styles,
                    [state]: {
                      ...current.styles[state],
                      background: background ?? { type: "color", value: "transparent" },
                    },
                  },
                }
              : current,
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
            type === "none"
              ? undefined
              : type === "shadowToken"
                ? document.designSystem.shadows[0]
                  ? { type, id: document.designSystem.shadows[0].id }
                  : undefined
                : {
                    type: "shadow",
                    color: "#00000033",
                    offsetX: 0,
                    offsetY: 8,
                    blurRadius: 24,
                  },
          )
        }
        value={resolved.shadow?.type ?? "none"}
      >
        <option value="none">None</option>
        <option value="shadow">Custom</option>
        <option disabled={document.designSystem.shadows.length === 0} value="shadowToken">
          Design-system shadow
        </option>
      </SelectField>
      {resolved.shadow?.type === "shadowToken" ? (
        <SelectField
          address={`styles.${state}.shadow.id`}
          label="Shadow style"
          onChange={(id) => setValue("shadow", { type: "shadowToken", id })}
          value={resolved.shadow.id}
        >
          {document.designSystem.shadows.map((token) => (
            <option key={token.id} value={token.id}>
              {token.name}
            </option>
          ))}
        </SelectField>
      ) : null}
      {customShadow ? (
        <>
          <ColorField
            address={`styles.${state}.shadow.color`}
            label="Shadow colour"
            onUpdate={(current, color) => {
              if (current.type !== "productCard" && current.type !== "productBadge") return current
              const shadow = { ...customShadow, color }
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
              } as ProtocolNode
            }}
            value={customShadow.color}
          />
          <TwoColumn>
            <NumberField
              address={`styles.${state}.shadow.offsetX`}
              label="Shadow X"
              max={4096}
              min={-4096}
              onChange={(offsetX) => setValue("shadow", { ...customShadow, offsetX })}
              unit="lu"
              value={customShadow.offsetX}
            />
            <NumberField
              address={`styles.${state}.shadow.offsetY`}
              label="Shadow Y"
              max={4096}
              min={-4096}
              onChange={(offsetY) => setValue("shadow", { ...customShadow, offsetY })}
              unit="lu"
              value={customShadow.offsetY}
            />
          </TwoColumn>
          <NumberField
            address={`styles.${state}.shadow.blurRadius`}
            label="Shadow blur"
            max={4096}
            min={0}
            onChange={(blurRadius) => setValue("shadow", { ...customShadow, blurRadius })}
            unit="lu"
            value={customShadow.blurRadius}
          />
        </>
      ) : null}
      <ColorField
        address={`styles.${state}.border.color`}
        label="Stroke"
        onUpdate={(current, color) =>
          current.type === "productCard" || current.type === "productBadge"
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
  )
}

function ProductLayerLayoutSection({ node }: { node: ProductLayerNode }) {
  const editor = useEditorActions()
  return (
    <InspectorSection defaultOpen title="Layout">
      <CompactOptionField
        address="direction"
        label="Flow"
        onChange={(direction) =>
          editor.updateComponent(node.id, (current) =>
            current.type === node.type ? ({ ...current, direction } as ProtocolNode) : current,
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
            current.type === node.type
              ? ({ ...current, crossAxisAlignment } as ProtocolNode)
              : current,
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
            current.type === node.type ? ({ ...current, gap } as ProtocolNode) : current,
          )
        }
        unit="lu"
        value={node.gap}
      />
    </InspectorSection>
  )
}

function ProductCardInspector({ node }: { node: Extract<ProtocolNode, { type: "productCard" }> }) {
  const { disabled, document, locale } = useInspectorContext()
  const editor = useEditorActions()
  const parent = findParent(document, node.id)
  const selector = parent?.parent.type === "productSelector" ? parent.parent : null
  const product = document.products.find((candidate) => candidate.id === node.productReferenceId)
  const usedProductIds = new Set(
    selector?.cards.filter((card) => card.id !== node.id).map((card) => card.productReferenceId),
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

function ProductBadgeInspector({
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

function ProductSelectorInspector({
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

function ButtonInspector({ node }: { node: Extract<ProtocolNode, { type: "button" }> }) {
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

function CarouselInspector({ node }: { node: Extract<ProtocolNode, { type: "carousel" }> }) {
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

function SwitchInspector({ node }: { node: Extract<ProtocolNode, { type: "switch" }> }) {
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

function CountdownInspector({ node }: { node: Extract<ProtocolNode, { type: "countdown" }> }) {
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

function InspectorForNode({ node }: { node: ProtocolNode }) {
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

export function PropertyInspector({ issues = [] }: { issues?: readonly ValidationIssue[] }) {
  const { selectedComponent, selectedComponentId } = useEditorSelection()
  const { currentLocale, document } = useEditorStore()
  const metadata = useStudioWorkspaceSelector(selectLayerMetadata)
  const workspace = useStudioWorkspaceActions()
  const selectedScrollContainer = document
    ? (document.screens.find((screen) => selectedComponentId === screen.layout.id)?.layout ?? null)
    : null
  const selectedTarget = selectedScrollContainer ?? selectedComponent
  const selectedLabel =
    selectedTarget && document
      ? layerDisplayLabel(document, selectedTarget.id, metadata.labels)
      : null
  const selectedType = selectedScrollContainer?.type ?? selectedComponent?.type
  const selectionPath =
    selectedTarget && document
      ? [
          selectedScrollContainer?.id ??
            document.screens.find((screen) =>
              selectedComponent
                ? findAncestorNodeIds(document, selectedComponent.id).includes(
                    screen.layout.content.id,
                  ) || selectedComponent.id === screen.layout.content.id
                : false,
            )?.layout.id ??
            document.screens[0]?.layout.id,
          ...(selectedComponent
            ? [...findAncestorNodeIds(document, selectedComponent.id), selectedComponent.id]
            : []),
        ]
          .filter((id): id is string => Boolean(id))
          .filter((id, index, ids) => ids.indexOf(id) === index)
      : []
  const selectedIssueCount = selectedTarget
    ? issues.filter((issue) => issue.componentId === selectedTarget.id).length
    : 0
  const lockedIds = new Set(metadata.lockedIds)
  const lockedBy =
    document && selectedComponent
      ? [selectedComponent.id, ...findAncestorNodeIds(document, selectedComponent.id)].find((id) =>
          lockedIds.has(id),
        )
      : undefined
  const lockedLabel =
    lockedBy && document ? layerDisplayLabel(document, lockedBy, metadata.labels) : null

  return (
    <section aria-labelledby="property-inspector-title">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          {selectedType ? (
            <span
              aria-hidden
              className="bg-muted text-muted-foreground mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg"
            >
              <LayerTypeIcon type={selectedType} />
            </span>
          ) : null}
          <div className="min-w-0">
            <h2
              className="text-sm font-semibold focus:outline-none"
              id="property-inspector-title"
              tabIndex={-1}
            >
              Properties
            </h2>
            {selectionPath.length > 0 && document ? (
              <nav aria-label="Selected layer path" className="mt-0.5" title={selectedLabel ?? ""}>
                <ol className="text-muted-foreground flex min-w-0 items-center gap-1 overflow-hidden text-xs">
                  {selectionPath.map((id, index) => (
                    <li className="flex min-w-0 items-center gap-1" key={id}>
                      {index > 0 ? <span aria-hidden>/</span> : null}
                      <span className="truncate">
                        {layerDisplayLabel(document, id, metadata.labels)}
                      </span>
                    </li>
                  ))}
                </ol>
              </nav>
            ) : (
              <p className="text-muted-foreground mt-0.5 text-xs">Select content to edit it</p>
            )}
          </div>
        </div>
        {selectedTarget ? (
          <span className="bg-muted rounded-full px-2 py-1 text-[10px] font-medium">
            {selectedIssueCount} {selectedIssueCount === 1 ? "issue" : "issues"}
          </span>
        ) : null}
      </div>
      {!selectedTarget || !document ? (
        <div className="bg-muted text-muted-foreground mt-4 rounded-xl p-4 text-sm">
          Select a block in Layers or the Canvas to edit its Protocol 0.2 properties.
        </div>
      ) : (
        <InspectorContext.Provider
          value={{
            componentId: selectedTarget.id,
            disabled: lockedBy !== undefined,
            document,
            issues,
            locale: currentLocale,
          }}
        >
          {lockedBy ? (
            <div
              className="border-border bg-muted mt-4 rounded-lg border p-3 text-xs"
              role="status"
            >
              <p className="font-semibold">Properties are read-only</p>
              <p className="text-muted-foreground mt-1">
                {lockedBy === selectedTarget.id
                  ? "This layer is locked."
                  : `Ancestor ${lockedLabel ?? "layer"} is locked.`}
              </p>
              <Button
                className="mt-2"
                onClick={() => workspace.setLayerLocked(lockedBy, false)}
                size="xs"
                type="button"
                variant="outline"
              >
                Unlock {lockedLabel ?? "layer"}
              </Button>
            </div>
          ) : null}
          <div className="-mx-4 mt-4 border-t">
            {selectedScrollContainer ? (
              <ScrollContainerInspector
                key={selectedScrollContainer.id}
                layout={selectedScrollContainer}
              />
            ) : selectedComponent ? (
              <InspectorForNode key={selectedComponent.id} node={selectedComponent} />
            ) : null}
          </div>
        </InspectorContext.Provider>
      )}
    </section>
  )
}
