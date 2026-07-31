"use client";

import { Select as SelectPrimitive } from "@base-ui/react/select";
import { CaretUpDownIcon } from "@phosphor-icons/react/dist/ssr/CaretUpDown";
import { CheckIcon } from "@phosphor-icons/react/dist/ssr/Check";
import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Base UI resolves the trigger's label from `items`, not from the rendered
 * `SelectItem` children, so a caller whose option text differs from its value
 * builds the list once and passes it to both.
 */
export interface SelectOption<Value extends string = string> {
  label: string;
  value: Value;
}

type SelectChangeDetails<
  Value,
  Multiple extends boolean | undefined,
> = Parameters<
  NonNullable<SelectPrimitive.Root.Props<Value, Multiple>["onValueChange"]>
>[1];

/**
 * Base UI reports `null` only when an item whose own value is `null` is chosen,
 * which is how it models a clearable select. Mosaic spells "nothing chosen" as
 * an empty-string item instead, so the callback is narrowed here rather than at
 * every call site. Introducing a null-valued item means widening this again.
 */
export type SelectRootProps<
  Value,
  Multiple extends boolean | undefined = false,
> = Omit<SelectPrimitive.Root.Props<Value, Multiple>, "onValueChange"> & {
  onValueChange?: (
    value: Multiple extends true ? Value[] : Value,
    eventDetails: SelectChangeDetails<Value, Multiple>
  ) => void;
};

function Select<Value, Multiple extends boolean | undefined = false>({
  onValueChange,
  ...props
}: SelectRootProps<Value, Multiple>) {
  return (
    <SelectPrimitive.Root
      data-slot="select"
      onValueChange={
        onValueChange as SelectPrimitive.Root.Props<
          Value,
          Multiple
        >["onValueChange"]
      }
      {...props}
    />
  );
}

function SelectGroup({ ...props }: SelectPrimitive.Group.Props) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  return (
    <SelectPrimitive.Value
      className={cn("flex-1 truncate text-left", className)}
      data-slot="select-value"
      {...props}
    />
  );
}

function SelectTrigger({
  className,
  children,
  size = "default",
  ...props
}: SelectPrimitive.Trigger.Props & { size?: "default" | "sm" }) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "flex w-full select-none items-center justify-between gap-2 whitespace-nowrap rounded border border-input bg-background px-3 text-foreground text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive data-[size=default]:h-9 data-[size=sm]:h-8 data-[popup-open]:border-ring data-placeholder:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className
      )}
      data-size={size}
      data-slot="select-trigger"
      {...props}
    >
      {children}
      <SelectPrimitive.Icon
        className="flex size-4 shrink-0 items-center justify-center text-muted-foreground"
        data-slot="select-icon"
      >
        <CaretUpDownIcon />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  sideOffset = 4,
  ...props
}: SelectPrimitive.Popup.Props & {
  sideOffset?: SelectPrimitive.Positioner.Props["sideOffset"];
}) {
  return (
    <SelectPrimitive.Portal data-slot="select-portal">
      <SelectPrimitive.Positioner
        alignItemWithTrigger={false}
        className="z-50"
        data-slot="select-positioner"
        sideOffset={sideOffset}
      >
        <SelectPrimitive.Popup
          className={cn(
            "max-h-(--available-height) min-w-(--anchor-width) origin-(--transform-origin) overflow-y-auto rounded border bg-popover bg-clip-padding p-1 text-popover-foreground text-sm shadow-lg transition duration-150 ease-out data-ending-style:scale-[0.98] data-starting-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:opacity-0",
            className
          )}
          data-slot="select-content"
          {...props}
        >
          {children}
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

function SelectLabel({
  className,
  ...props
}: SelectPrimitive.GroupLabel.Props) {
  return (
    <SelectPrimitive.GroupLabel
      className={cn(
        "px-2 py-1.5 font-medium text-muted-foreground text-xs",
        className
      )}
      data-slot="select-label"
      {...props}
    />
  );
}

function SelectItem({
  className,
  children,
  ...props
}: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "relative flex w-full cursor-default select-none items-center gap-2 rounded py-1.5 pr-8 pl-2 outline-none data-disabled:pointer-events-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:opacity-50",
        className
      )}
      data-slot="select-item"
      {...props}
    >
      <SelectPrimitive.ItemText
        className="flex-1 truncate whitespace-nowrap"
        data-slot="select-item-text"
      >
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator
        className="pointer-events-none absolute right-2 flex size-4 items-center justify-center"
        data-slot="select-item-indicator"
      >
        <CheckIcon />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

function SelectSeparator({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      data-slot="select-separator"
      {...props}
    />
  );
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};
