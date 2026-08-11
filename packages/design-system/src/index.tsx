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

/** Indexed view of the table above, so an out-of-union tone reads as undefined. */
const statusBehavior: Record<
  string,
  (typeof STATUS_BEHAVIOR)[StatusTone] | undefined
> = STATUS_BEHAVIOR;

const warnedTones = new Set<string>();

function warnUnknownTone(tone: string) {
  if (
    typeof process === "undefined" ||
    process.env.NODE_ENV === "production" ||
    warnedTones.has(tone)
  ) {
    return;
  }
  warnedTones.add(tone);
  // Once per distinct tone: this runs in render, and a bad tone in a list would
  // otherwise reprint on every commit and bury itself.
  console.warn(
    `[@mosaic/design-system] StatusMessage received an unrecognized tone ${JSON.stringify(
      tone
    )}. Announcing it assertively (role="alert") because an unknown tone may be a failure. Expected one of: ${Object.keys(
      STATUS_BEHAVIOR
    ).join(", ")}.`
  );
}

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
  // The union is a compile-time guarantee only. A JavaScript caller, or a tone
  // that arrives from data rather than a literal, can be outside it, and an
  // undefined lookup would throw inside render and take the message with it --
  // the status message being, often, the explanation of what just went wrong.
  //
  // So we still never throw, but we fall back *upward* on the accessibility
  // axis: an unrecognized tone announces at the danger level. Falling back to
  // neutral would silently demote "error" to aria-live="polite", and a failure
  // that is never announced is unrecoverable for a screen-reader user, whereas
  // a benign message announced too loudly is merely noisy. Visuals fall back
  // the other way -- data-tone passes the raw value through, which matches no
  // [data-tone=...] rule and so paints the neutral base styling -- because
  // guessing at danger colors would be a false claim about the content.
  const behavior = statusBehavior[tone];

  if (!behavior) {
    warnUnknownTone(String(tone));
  }

  const { live, role } = behavior ?? STATUS_BEHAVIOR.danger;

  return (
    <div
      {...props}
      role={role}
      aria-live={live}
      aria-atomic="true"
      className={classNames("mosaic-status-message", className)}
      data-tone={tone}
    >
      {children}
    </div>
  );
}
