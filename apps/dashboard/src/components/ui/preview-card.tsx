"use client";

import { PreviewCard as PreviewCardPrimitive } from "@base-ui/react/preview-card";

import { cn } from "@/lib/utils";

/**
 * Base UI's preview card is the hover-card primitive: it opens on pointer
 * hover after `delay`, opens immediately on keyboard focus, and dismisses on
 * Escape without trapping focus. Mosaic uses Base UI, never Radix.
 */
function PreviewCard(props: PreviewCardPrimitive.Root.Props) {
  return <PreviewCardPrimitive.Root data-slot="preview-card" {...props} />;
}

function PreviewCardTrigger(props: PreviewCardPrimitive.Trigger.Props) {
  return (
    <PreviewCardPrimitive.Trigger data-slot="preview-card-trigger" {...props} />
  );
}

function PreviewCardContent({
  align = "start",
  alignOffset = 0,
  children,
  className,
  side = "right",
  sideOffset = 8,
  ...props
}: PreviewCardPrimitive.Popup.Props &
  Pick<
    PreviewCardPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  return (
    <PreviewCardPrimitive.Portal>
      <PreviewCardPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        className="isolate z-50 outline-none"
        side={side}
        sideOffset={sideOffset}
      >
        <PreviewCardPrimitive.Popup
          className={cn(
            "w-72 origin-(--transform-origin) rounded bg-popover p-3 text-popover-foreground shadow-xl outline-none ring-1 ring-foreground/10 transition-[transform,opacity] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] data-ending-style:scale-[0.98] data-starting-style:scale-[0.97] data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transform-none motion-reduce:transition-opacity",
            className
          )}
          data-slot="preview-card-content"
          {...props}
        >
          {children}
        </PreviewCardPrimitive.Popup>
      </PreviewCardPrimitive.Positioner>
    </PreviewCardPrimitive.Portal>
  );
}

export { PreviewCard, PreviewCardContent, PreviewCardTrigger };
