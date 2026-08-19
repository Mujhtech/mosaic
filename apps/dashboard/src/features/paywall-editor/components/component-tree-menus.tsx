import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import { ArrowDownIcon } from "@phosphor-icons/react/dist/ssr/ArrowDown";
import { ArrowLineLeftIcon } from "@phosphor-icons/react/dist/ssr/ArrowLineLeft";
import { ArrowLineRightIcon } from "@phosphor-icons/react/dist/ssr/ArrowLineRight";
import { ArrowUpIcon } from "@phosphor-icons/react/dist/ssr/ArrowUp";
import { CopyIcon } from "@phosphor-icons/react/dist/ssr/Copy";
import { EyeIcon } from "@phosphor-icons/react/dist/ssr/Eye";
import { EyeSlashIcon } from "@phosphor-icons/react/dist/ssr/EyeSlash";
import { LockIcon } from "@phosphor-icons/react/dist/ssr/Lock";
import { LockOpenIcon } from "@phosphor-icons/react/dist/ssr/LockOpen";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/ssr/PencilSimple";
import { TrashIcon } from "@phosphor-icons/react/dist/ssr/Trash";

import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import type { LayerActionItemsProps } from "@/features/paywall-editor/components/component-tree-support";

const contextMenuItemClass =
  "focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 relative flex cursor-default items-center gap-1.5 rounded px-1.5 py-1 text-sm outline-none select-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0";

export function LayerActionItems({
  availability,
  state,
  onDelete,
  onDuplicate,
  onIndent,
  onMoveDown,
  onMoveUp,
  onOutdent,
  onRename,
  onToggleHidden,
  onToggleLocked,
}: LayerActionItemsProps) {
  return (
    <>
      <DropdownMenuItem onClick={onRename}>
        <PencilSimpleIcon aria-hidden /> Rename layer
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled={!availability.moveUp} onClick={onMoveUp}>
        <ArrowUpIcon aria-hidden /> Move up
      </DropdownMenuItem>
      <DropdownMenuItem disabled={!availability.moveDown} onClick={onMoveDown}>
        <ArrowDownIcon aria-hidden /> Move down
      </DropdownMenuItem>
      {availability.indent ? (
        <DropdownMenuItem onClick={onIndent}>
          <ArrowLineRightIcon aria-hidden /> Indent
        </DropdownMenuItem>
      ) : null}
      {availability.outdent ? (
        <DropdownMenuItem onClick={onOutdent}>
          <ArrowLineLeftIcon aria-hidden /> Outdent
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem
        disabled={!availability.duplicate}
        onClick={onDuplicate}
      >
        <CopyIcon aria-hidden /> Duplicate
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={onToggleLocked}>
        {state.locked ? <LockOpenIcon aria-hidden /> : <LockIcon aria-hidden />}
        {state.locked ? "Unlock canvas layer" : "Lock canvas layer"}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={onToggleHidden}>
        {state.hidden ? <EyeIcon aria-hidden /> : <EyeSlashIcon aria-hidden />}
        {state.hidden ? "Show on canvas" : "Hide on canvas"}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        disabled={!availability.delete}
        onClick={onDelete}
        variant="destructive"
      >
        <TrashIcon aria-hidden /> Delete
      </DropdownMenuItem>
    </>
  );
}

function ContextLayerActionItems(props: LayerActionItemsProps) {
  return (
    <>
      <ContextMenuPrimitive.Item
        className={contextMenuItemClass}
        onClick={props.onRename}
      >
        <PencilSimpleIcon aria-hidden /> Rename layer
      </ContextMenuPrimitive.Item>
      <ContextMenuPrimitive.Separator className="-mx-1 my-1 h-px bg-border" />
      <ContextMenuPrimitive.Item
        className={contextMenuItemClass}
        disabled={!props.availability.moveUp}
        onClick={props.onMoveUp}
      >
        <ArrowUpIcon aria-hidden /> Move up
      </ContextMenuPrimitive.Item>
      <ContextMenuPrimitive.Item
        className={contextMenuItemClass}
        disabled={!props.availability.moveDown}
        onClick={props.onMoveDown}
      >
        <ArrowDownIcon aria-hidden /> Move down
      </ContextMenuPrimitive.Item>
      {props.availability.indent ? (
        <ContextMenuPrimitive.Item
          className={contextMenuItemClass}
          onClick={props.onIndent}
        >
          <ArrowLineRightIcon aria-hidden /> Indent
        </ContextMenuPrimitive.Item>
      ) : null}
      {props.availability.outdent ? (
        <ContextMenuPrimitive.Item
          className={contextMenuItemClass}
          onClick={props.onOutdent}
        >
          <ArrowLineLeftIcon aria-hidden /> Outdent
        </ContextMenuPrimitive.Item>
      ) : null}
      <ContextMenuPrimitive.Item
        className={contextMenuItemClass}
        disabled={!props.availability.duplicate}
        onClick={props.onDuplicate}
      >
        <CopyIcon aria-hidden /> Duplicate
      </ContextMenuPrimitive.Item>
      <ContextMenuPrimitive.Separator className="-mx-1 my-1 h-px bg-border" />
      <ContextMenuPrimitive.Item
        className={contextMenuItemClass}
        onClick={props.onToggleLocked}
      >
        {props.state.locked ? (
          <LockOpenIcon aria-hidden />
        ) : (
          <LockIcon aria-hidden />
        )}
        {props.state.locked ? "Unlock canvas layer" : "Lock canvas layer"}
      </ContextMenuPrimitive.Item>
      <ContextMenuPrimitive.Item
        className={contextMenuItemClass}
        onClick={props.onToggleHidden}
      >
        {props.state.hidden ? (
          <EyeIcon aria-hidden />
        ) : (
          <EyeSlashIcon aria-hidden />
        )}
        {props.state.hidden ? "Show on canvas" : "Hide on canvas"}
      </ContextMenuPrimitive.Item>
      <ContextMenuPrimitive.Separator className="-mx-1 my-1 h-px bg-border" />
      <ContextMenuPrimitive.Item
        className={`${contextMenuItemClass} text-destructive focus:bg-destructive/10 focus:text-destructive`}
        disabled={!props.availability.delete}
        onClick={props.onDelete}
      >
        <TrashIcon aria-hidden /> Delete
      </ContextMenuPrimitive.Item>
    </>
  );
}

export function LayerContextMenuContent({
  actions,
  finalFocus,
}: {
  actions: LayerActionItemsProps;
  finalFocus: boolean;
}) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Positioner
        className="isolate z-50 outline-none"
        sideOffset={2}
      >
        <ContextMenuPrimitive.Popup
          className="z-50 w-52 min-w-32 rounded bg-popover p-1 text-popover-foreground shadow-md outline-none ring-1 ring-foreground/10"
          finalFocus={finalFocus}
        >
          <ContextLayerActionItems {...actions} />
        </ContextMenuPrimitive.Popup>
      </ContextMenuPrimitive.Positioner>
    </ContextMenuPrimitive.Portal>
  );
}
