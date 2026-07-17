import type { ComponentProps, ReactNode } from "react";

type AccessibleName =
  | { "aria-label": string; "aria-labelledby"?: never }
  | { "aria-label"?: never; "aria-labelledby": string };

type ToolbarGroupProps = Omit<
  ComponentProps<"div">,
  "aria-label" | "aria-labelledby" | "role"
> &
  AccessibleName;

type PanelSectionProps = Omit<
  ComponentProps<"section">,
  "aria-label" | "aria-labelledby" | "role"
> & {
  "aria-label"?: never;
  "aria-labelledby": string;
};

type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

type StatusMessageProps = Omit<
  ComponentProps<"div">,
  "aria-atomic" | "aria-live" | "children" | "role"
> & {
  children: ReactNode;
  tone?: StatusTone;
};

const STATUS_BEHAVIOR = {
  neutral: { live: "polite", role: "status" },
  info: { live: "polite", role: "status" },
  success: { live: "polite", role: "status" },
  warning: { live: "polite", role: "status" },
  danger: { live: "assertive", role: "alert" },
} as const;

function classNames(base: string, className: string | undefined) {
  return className ? `${base} ${className}` : base;
}

export function ToolbarGroup({ className, ...props }: ToolbarGroupProps) {
  return (
    <div
      role="group"
      className={classNames("mosaic-toolbar-group", className)}
      {...props}
    />
  );
}

export function PanelSection({ className, ...props }: PanelSectionProps) {
  return (
    <section
      className={classNames("mosaic-panel-section", className)}
      {...props}
    />
  );
}

export function StatusMessage({
  children,
  className,
  tone = "neutral",
  ...props
}: StatusMessageProps) {
  const behavior = STATUS_BEHAVIOR[tone];

  return (
    <div
      {...props}
      role={behavior.role}
      aria-live={behavior.live}
      aria-atomic="true"
      className={classNames("mosaic-status-message", className)}
      data-tone={tone}
    >
      {children}
    </div>
  );
}
