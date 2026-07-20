/* eslint-disable react-refresh/only-export-components -- internal inspector modules colocate private controls with their supporting types and transforms. */
import { AlignBottomSimpleIcon } from "@phosphor-icons/react/dist/ssr/AlignBottomSimple"
import { AlignCenterHorizontalSimpleIcon } from "@phosphor-icons/react/dist/ssr/AlignCenterHorizontalSimple"
import { AlignCenterVerticalSimpleIcon } from "@phosphor-icons/react/dist/ssr/AlignCenterVerticalSimple"
import { AlignLeftSimpleIcon } from "@phosphor-icons/react/dist/ssr/AlignLeftSimple"
import { AlignRightSimpleIcon } from "@phosphor-icons/react/dist/ssr/AlignRightSimple"
import { AlignTopSimpleIcon } from "@phosphor-icons/react/dist/ssr/AlignTopSimple"
import { ArrowsHorizontalIcon } from "@phosphor-icons/react/dist/ssr/ArrowsHorizontal"
import { ArrowsVerticalIcon } from "@phosphor-icons/react/dist/ssr/ArrowsVertical"
import { CaretDownIcon } from "@phosphor-icons/react/dist/ssr/CaretDown"
import { ColumnsIcon } from "@phosphor-icons/react/dist/ssr/Columns"
import { RowsIcon } from "@phosphor-icons/react/dist/ssr/Rows"
import type { KeyboardEvent, ReactNode } from "react"
import { createContext, useCallback, useContext, useRef } from "react"

import { LAYER_TYPE_LABELS } from "@/features/paywall-editor/components/component-catalog"
import { useEditorActions } from "@/features/paywall-editor/stores/editor-store-context"
import type { StudioWorkspaceSnapshot } from "@/features/paywall-editor/stores/studio-workspace-store"
import type {
  MosaicDocument,
  ProtocolNode,
  Screen,
  ValidationIssue,
} from "@/features/paywall-editor/types/editor"
import { findNode } from "@/features/paywall-editor/utils/document-tree"
import {
  getInspectorFieldId,
  validationPropertyAddress,
} from "@/features/paywall-editor/utils/property-inspector-navigation"
import type {
  MosaicPaywallV02BaseTypography,
  MosaicPaywallV02BoxAppearance,
  MosaicPaywallV02ContainerAppearance,
  MosaicPaywallV02EdgeInsets,
  MosaicPaywallV02Typography,
} from "@/lib/mosaic-protocol"

export const CONTROL_CLASS =
  "border-input bg-background focus-visible:border-ring focus-visible:ring-ring/30 h-8 w-full rounded-md border px-2 text-sm outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
export const TEXTAREA_CLASS =
  "border-input bg-background focus-visible:border-ring focus-visible:ring-ring/30 min-h-24 w-full resize-y rounded-md border px-2 py-2 text-sm outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
export const ZERO_INSETS: MosaicPaywallV02EdgeInsets = {
  top: 0,
  start: 0,
  bottom: 0,
  end: 0,
}
export const PRODUCT_VARIABLE_TOKENS = [
  { label: "Product name", value: "{{ product.name }}" },
  { label: "Product price", value: "{{ product.price }}" },
] as const
export const selectLayerMetadata = (snapshot: StudioWorkspaceSnapshot) =>
  snapshot.preferences.layerMetadata

export type ScrollContainer = Screen["layout"]
export type InspectorNode = ProtocolNode
export type ControlNode = Extract<
  ProtocolNode,
  {
    type: "featureList" | "productSelector" | "button" | "carousel" | "switch"
  }
>
export type TypographyValue = MosaicPaywallV02BaseTypography | MosaicPaywallV02Typography
export type AppearanceValue = MosaicPaywallV02BoxAppearance | MosaicPaywallV02ContainerAppearance

export function isControlNode(node: ProtocolNode): node is ControlNode {
  return (
    node.type === "featureList" ||
    node.type === "productSelector" ||
    node.type === "button" ||
    node.type === "carousel" ||
    node.type === "switch"
  )
}

export function layerDisplayLabel(
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

export function updateScrollContainer(
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

export interface InspectorContextValue {
  readonly componentId: string
  readonly disabled: boolean
  readonly document: MosaicDocument
  readonly issues: readonly ValidationIssue[]
  readonly locale: string
}

export const InspectorContext = createContext<InspectorContextValue | null>(null)
export const EMPTY_VALIDATION_ISSUES: readonly ValidationIssue[] = []

export function useInspectorContext() {
  const context = useContext(InspectorContext)
  if (!context) throw new Error("Inspector fields must be rendered inside PropertyInspector")
  return context
}

export function issueMatchesAddress(issue: ValidationIssue, address: string) {
  const issueAddress = validationPropertyAddress(issue)
  return (
    issueAddress === address ||
    (issueAddress.startsWith("items.") && address.startsWith(issueAddress))
  )
}

export function Field({
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

export function InspectorSection({
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

export function TwoColumn({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-2">{children}</div>
}

export interface CompactOption {
  readonly icon: ReactNode
  readonly label: string
  readonly value: string
}

export function CompactOptionField({
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

export const FLOW_OPTIONS: readonly CompactOption[] = [
  { icon: <RowsIcon aria-hidden className="size-4" />, label: "Vertical", value: "vertical" },
  {
    icon: <ColumnsIcon aria-hidden className="size-4" />,
    label: "Horizontal",
    value: "horizontal",
  },
]

export function distributionOptions(
  direction: "horizontal" | "vertical",
): readonly CompactOption[] {
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

export function alignmentOptions(direction: "horizontal" | "vertical"): readonly CompactOption[] {
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

export function useDocumentTransaction() {
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

export function transactionEscape(event: KeyboardEvent<HTMLElement>, cancel: () => boolean) {
  if (event.key !== "Escape") return
  event.preventDefault()
  cancel()
  event.currentTarget.blur()
}
