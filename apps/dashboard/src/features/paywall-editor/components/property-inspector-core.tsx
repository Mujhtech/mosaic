import { CaretDownIcon } from "@phosphor-icons/react/dist/ssr/CaretDown";
import type { ReactNode } from "react";
import { useCallback, useContext, useRef } from "react";

import {
  type CompactOption,
  InspectorContext,
} from "@/features/paywall-editor/components/property-inspector-core-support";
import { useEditorActions } from "@/features/paywall-editor/stores/editor-store-context";
import type {
  ProtocolNode,
  ValidationIssue,
} from "@/features/paywall-editor/types/editor";
import {
  getInspectorFieldId,
  validationPropertyAddress,
} from "@/features/paywall-editor/utils/property-inspector-navigation";
import type {
  MosaicPaywallV04BaseTypography,
  MosaicPaywallV04BoxAppearance,
  MosaicPaywallV04ContainerAppearance,
  MosaicPaywallV04Typography,
} from "@/lib/mosaic-protocol";

export const CONTROL_CLASS =
  "border-input bg-background focus-visible:border-ring focus-visible:ring-ring/30 h-8 w-full rounded border px-2 text-sm outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60";
export const TEXTAREA_CLASS =
  "border-input bg-background focus-visible:border-ring focus-visible:ring-ring/30 min-h-24 w-full resize-y rounded border px-2 py-2 text-sm outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60";

export type InspectorNode = ProtocolNode;
export type TypographyValue =
  | MosaicPaywallV04BaseTypography
  | MosaicPaywallV04Typography;
export type AppearanceValue =
  | MosaicPaywallV04BoxAppearance
  | MosaicPaywallV04ContainerAppearance;

export function useInspectorContext() {
  const context = useContext(InspectorContext);
  if (!context) {
    throw new Error(
      "Inspector fields must be rendered inside PropertyInspector"
    );
  }
  return context;
}

function issueMatchesAddress(issue: ValidationIssue, address: string) {
  const issueAddress = validationPropertyAddress(issue);
  return (
    issueAddress === address ||
    (issueAddress.startsWith("items.") && address.startsWith(issueAddress))
  );
}

export function Field({
  address,
  children,
  description,
  group = false,
  hideLabel = false,
  label,
}: {
  address: string;
  children: (props: {
    "aria-describedby"?: string;
    "aria-invalid"?: true;
    "aria-labelledby"?: string;
    id: string;
  }) => ReactNode;
  description?: ReactNode;
  group?: boolean;
  hideLabel?: boolean;
  label: ReactNode;
}) {
  const { componentId, issues } = useInspectorContext();
  const fieldId = getInspectorFieldId(componentId, address);
  const fieldIssues = issues.filter(
    (issue) =>
      issue.componentId === componentId && issueMatchesAddress(issue, address)
  );
  const descriptionId = description ? `${fieldId}-description` : undefined;
  const errorId = fieldIssues.length > 0 ? `${fieldId}-error` : undefined;
  const labelId = group ? `${fieldId}-label` : undefined;
  const describedBy =
    [descriptionId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <fieldset
      aria-labelledby={labelId}
      className="min-w-0"
      data-component-id={componentId}
      data-property-address={address}
    >
      {group ? (
        <p
          className={
            hideLabel
              ? "sr-only"
              : "mb-1.5 font-medium text-[11px] text-muted-foreground"
          }
          id={labelId}
        >
          {label}
        </p>
      ) : (
        <label
          className={
            hideLabel
              ? "sr-only"
              : "mb-1.5 block font-medium text-[11px] text-muted-foreground"
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
        <p
          className="mt-1 text-[11px] text-muted-foreground leading-4"
          id={descriptionId}
        >
          {description}
        </p>
      ) : null}
      {fieldIssues.length > 0 ? (
        <div
          className="mt-1 space-y-1 text-destructive text-xs"
          id={errorId}
          role="alert"
        >
          {fieldIssues.map((issue) => (
            <p key={`${issue.code}:${issue.documentPath}`}>{issue.message}</p>
          ))}
        </div>
      ) : null}
    </fieldset>
  );
}

export function InspectorSection({
  children,
  defaultOpen = false,
  title,
}: {
  children: ReactNode;
  defaultOpen?: boolean;
  title: string;
}) {
  const initializeOpen = useCallback(
    (section: HTMLDetailsElement | null) => {
      if (section) {
        section.open = defaultOpen;
      }
    },
    [defaultOpen]
  );

  return (
    <details
      className="group border-border border-b"
      data-inspector-section={title}
      ref={initializeOpen}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-semibold text-sm marker:hidden">
        {title}
        <CaretDownIcon
          aria-hidden
          className="size-3.5 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
        />
      </summary>
      <div className="space-y-4 px-4 pb-4">{children}</div>
    </details>
  );
}

export function TwoColumn({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-2">{children}</div>;
}

export function CompactOptionField({
  address,
  label,
  onChange,
  options,
  value,
}: {
  address: string;
  label: string;
  onChange: (value: string) => void;
  options: readonly CompactOption[];
  value: string;
}) {
  const { disabled } = useInspectorContext();
  return (
    <Field address={address} group label={label}>
      {(fieldProps) => (
        <fieldset
          {...fieldProps}
          className="grid h-9 min-w-0 overflow-hidden rounded border border-input bg-muted/35 p-0.5"
          style={{
            gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
          }}
        >
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <button
                aria-label={`${label}: ${option.label}`}
                aria-pressed={selected}
                className={`flex min-w-0 items-center justify-center rounded-[5px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 ${
                  selected
                    ? "bg-primary/10 text-primary shadow-xs ring-1 ring-primary/20"
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
            );
          })}
        </fieldset>
      )}
    </Field>
  );
}

export function useDocumentTransaction() {
  const editor = useEditorActions();
  const activeRef = useRef(false);

  function begin() {
    if (activeRef.current) {
      return true;
    }
    activeRef.current = editor.beginDocumentTransaction();
    return activeRef.current;
  }

  function commit() {
    if (!activeRef.current) {
      return false;
    }
    activeRef.current = false;
    return editor.commitDocumentTransaction();
  }

  function cancel() {
    if (!activeRef.current) {
      return false;
    }
    activeRef.current = false;
    return editor.cancelDocumentTransaction();
  }

  return { begin, cancel, commit, editor, isActive: () => activeRef.current };
}
