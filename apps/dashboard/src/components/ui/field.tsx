import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, ReactNode, RefObject } from "react";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
} from "react";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

interface FieldContextValue {
  descriptionId: string;
  errorId: string;
}

const FieldContext = createContext<FieldContextValue | null>(null);

const CONTROL_SELECTOR = "input, select, textarea, [contenteditable='true']";
const MANAGED_ATTRIBUTE = "data-field-described-by";

/**
 * Associates the field's description and error text with its control.
 *
 * Mosaic forms are written with many different control components (native
 * inputs, shadcn wrappers, Base UI primitives), so the association is applied
 * from the field root rather than by threading props through every call site.
 * Author-supplied `aria-describedby` values are preserved; only the ids this
 * component added are recalculated, so the error id disappears together with
 * the error text.
 */
function useFieldDescribedBy(
  root: RefObject<HTMLFieldSetElement | null>,
  { descriptionId, errorId }: FieldContextValue
) {
  useEffect(() => {
    const element = root.current;
    if (!element) {
      return;
    }

    const control = element.querySelector<HTMLElement>(CONTROL_SELECTOR);
    if (!control) {
      return;
    }

    const owned = [descriptionId, errorId].filter((id) =>
      element.querySelector(`[id="${id}"]`)
    );
    const previouslyOwned = (control.getAttribute(MANAGED_ATTRIBUTE) ?? "")
      .split(" ")
      .filter(Boolean);
    const authored = (control.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .filter((id) => id.length > 0 && !previouslyOwned.includes(id));
    const next = [...authored, ...owned.filter((id) => !authored.includes(id))];

    if (next.length > 0) {
      control.setAttribute("aria-describedby", next.join(" "));
    } else {
      control.removeAttribute("aria-describedby");
    }

    if (owned.length > 0) {
      control.setAttribute(MANAGED_ATTRIBUTE, owned.join(" "));
    } else {
      control.removeAttribute(MANAGED_ATTRIBUTE);
    }
  });
}

function FieldSet({ className, ...props }: ComponentProps<"fieldset">) {
  return (
    <fieldset
      className={cn(
        "flex flex-col gap-4 has-[>[data-slot=checkbox-group]]:gap-3 has-[>[data-slot=radio-group]]:gap-3",
        className
      )}
      data-slot="field-set"
      {...props}
    />
  );
}

function FieldLegend({
  className,
  variant = "legend",
  ...props
}: ComponentProps<"legend"> & { variant?: "legend" | "label" }) {
  return (
    <legend
      className={cn(
        "mb-1.5 font-medium data-[variant=label]:text-sm data-[variant=legend]:text-base",
        className
      )}
      data-slot="field-legend"
      data-variant={variant}
      {...props}
    />
  );
}

function FieldGroup({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "group/field-group @container/field-group flex w-full flex-col gap-5 data-[slot=checkbox-group]:gap-3 *:data-[slot=field-group]:gap-4",
        className
      )}
      data-slot="field-group"
      {...props}
    />
  );
}

const fieldVariants = cva(
  "group/field flex w-full gap-2 data-[invalid=true]:text-destructive",
  {
    variants: {
      orientation: {
        vertical: "flex-col *:w-full [&>.sr-only]:w-auto",
        horizontal:
          "flex-row items-center has-[>[data-slot=field-content]]:items-start *:data-[slot=field-label]:flex-auto has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px",
        responsive:
          "@md/field-group:flex-row flex-col @md/field-group:items-center *:w-full @md/field-group:*:w-auto @md/field-group:has-[>[data-slot=field-content]]:items-start @md/field-group:*:data-[slot=field-label]:flex-auto [&>.sr-only]:w-auto @md/field-group:has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px",
      },
    },
    defaultVariants: {
      orientation: "vertical",
    },
  }
);

function Field({
  className,
  orientation = "vertical",
  ...props
}: ComponentProps<"fieldset"> & VariantProps<typeof fieldVariants>) {
  const generatedId = useId();
  const ids = useMemo(
    () => ({
      descriptionId: `field-${generatedId}-description`,
      errorId: `field-${generatedId}-error`,
    }),
    [generatedId]
  );
  const rootRef = useRef<HTMLFieldSetElement>(null);
  useFieldDescribedBy(rootRef, ids);

  return (
    <FieldContext.Provider value={ids}>
      <fieldset
        className={cn(fieldVariants({ orientation }), "min-w-0", className)}
        data-orientation={orientation}
        data-slot="field"
        ref={rootRef}
        {...props}
      />
    </FieldContext.Provider>
  );
}

function FieldContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "group/field-content flex flex-1 flex-col gap-0.5 leading-snug",
        className
      )}
      data-slot="field-content"
      {...props}
    />
  );
}

function FieldLabel({ className, ...props }: ComponentProps<typeof Label>) {
  return (
    <Label
      className={cn(
        "group/field-label peer/field-label flex w-fit gap-2 leading-snug has-[>[data-slot=field]]:rounded has-[>[data-slot=field]]:border has-data-checked:border-primary/30 has-data-checked:bg-primary/5 *:data-[slot=field]:p-2.5 group-data-[disabled=true]/field:opacity-50 dark:has-data-checked:border-primary/20 dark:has-data-checked:bg-primary/10",
        "has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:flex-col",
        className
      )}
      data-slot="field-label"
      {...props}
    />
  );
}

function FieldTitle({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex w-fit items-center gap-2 font-medium text-sm group-data-[disabled=true]/field:opacity-50",
        className
      )}
      data-slot="field-label"
      {...props}
    />
  );
}

function FieldDescription({ className, id, ...props }: ComponentProps<"p">) {
  const ids = useContext(FieldContext);
  return (
    <p
      className={cn(
        "text-left font-normal text-muted-foreground text-sm leading-normal group-has-data-horizontal/field:text-balance [[data-variant=legend]+&]:-mt-1.5",
        "nth-last-2:-mt-1 last:mt-0",
        "[&>a:hover]:text-primary [&>a]:underline [&>a]:underline-offset-4",
        className
      )}
      data-slot="field-description"
      id={id ?? ids?.descriptionId}
      {...props}
    />
  );
}

function FieldSeparator({
  children,
  className,
  ...props
}: ComponentProps<"div"> & {
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative -my-2 h-5 text-sm group-data-[variant=outline]/field-group:-mb-2",
        className
      )}
      data-content={!!children}
      data-slot="field-separator"
      {...props}
    >
      <Separator className="absolute inset-0 top-1/2" />
      {children && (
        <span
          className="relative mx-auto block w-fit bg-background px-2 text-muted-foreground"
          data-slot="field-separator-content"
        >
          {children}
        </span>
      )}
    </div>
  );
}

function FieldError({
  className,
  children,
  errors,
  id,
  ...props
}: ComponentProps<"div"> & {
  errors?: Array<{ message?: string } | undefined>;
}) {
  const ids = useContext(FieldContext);
  const content = useMemo(() => {
    if (children) {
      return children;
    }

    if (!errors?.length) {
      return null;
    }

    const uniqueErrors = [
      ...new Map(errors.map((error) => [error?.message, error])).values(),
    ];

    if (uniqueErrors?.length === 1) {
      return uniqueErrors[0]?.message;
    }

    return (
      <ul className="ml-4 flex list-disc flex-col gap-1">
        {uniqueErrors.map(
          (error, index) =>
            error?.message && <li key={index}>{error.message}</li>
        )}
      </ul>
    );
  }, [children, errors]);

  if (!content) {
    return null;
  }

  return (
    <div
      className={cn("font-normal text-destructive text-sm", className)}
      data-slot="field-error"
      id={id ?? ids?.errorId}
      role="alert"
      {...props}
    >
      {content}
    </div>
  );
}

export {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
};
