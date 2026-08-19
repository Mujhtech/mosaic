import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef } from "react";

import { frameStyle } from "@/features/paywall-editor/components/canvas-preview-node-primitives-support";
import { useEditorActions } from "@/features/paywall-editor/stores/editor-store-context";
import type {
  MosaicDocument,
  ProtocolNode,
} from "@/features/paywall-editor/types/editor";
import { resolvedBackground } from "@/features/paywall-editor/utils/protocol-styles";

export function InlineEditor({
  ariaLabel,
  className,
  multiline,
  onCancel,
  onCommit,
  onUpdate,
  style,
  value,
}: {
  ariaLabel: string;
  className: string;
  multiline: boolean;
  onCancel: () => void;
  onCommit: () => void;
  onUpdate: (value: string) => void;
  style?: CSSProperties;
  value: string;
}) {
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => fieldRef.current?.focus(), []);
  return (
    <textarea
      aria-label={ariaLabel}
      className={className}
      onBlur={onCommit}
      onChange={(event) => onUpdate(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        } else if (event.key === "Enter" && !(multiline && event.shiftKey)) {
          event.preventDefault();
          event.stopPropagation();
          onCommit();
        }
      }}
      ref={fieldRef}
      rows={multiline ? 3 : 1}
      style={style}
      value={value}
    />
  );
}

export function NodeFrame({
  children,
  document,
  inheritedLocked,
  node,
  selected,
  hovered,
  lockedIds,
}: {
  children: ReactNode;
  document: MosaicDocument;
  inheritedLocked: boolean;
  node: ProtocolNode;
  selected: boolean;
  hovered: boolean;
  lockedIds: ReadonlySet<string>;
}) {
  const editor = useEditorActions();
  const appearance = "appearance" in node ? node.appearance : undefined;
  const background = resolvedBackground(document, appearance?.background);
  const locked = inheritedLocked || lockedIds.has(node.id);
  const stateClass = (() => {
    if (locked) {
      return "cursor-not-allowed opacity-65 ring-slate-300 ring-1";
    }
    if (selected) {
      return "ring-primary ring-2 ring-offset-2 ring-offset-white";
    }
    if (hovered) {
      return "ring-primary/40 ring-1";
    }
    return "hover:ring-primary/35 hover:ring-1";
  })();
  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: a direct-manipulation canvas surface; selection is also reachable from the Layers tree and the command palette
    <fieldset
      aria-current={selected ? "true" : undefined}
      aria-disabled={locked || undefined}
      // A canvas node frequently contains its own buttons and text controls,
      // so it must not claim role="button": that nests interactive content
      // inside a control and hides the children from assistive technology.
      aria-label={`${node.type} component`}
      className={`relative min-w-0 rounded outline-none ${stateClass}`}
      data-component-id={node.id}
      data-preview-node-type={node.type}
      onClick={(event) => {
        event.stopPropagation();
        if (!locked) {
          editor.selectComponent(node.id);
        }
      }}
      onKeyDown={(event) => {
        if (locked || (event.key !== "Enter" && event.key !== " ")) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        editor.selectComponent(node.id);
      }}
      onMouseEnter={(event) => {
        event.stopPropagation();
        editor.hoverComponent(node.id);
      }}
      onMouseLeave={(event) => {
        event.stopPropagation();
        editor.hoverComponent(null);
      }}
      style={{
        ...frameStyle(document, node),
        ...(background.video ? background.style : {}),
        isolation: "isolate",
      }}
      tabIndex={locked ? -1 : 0}
      title={locked ? "Locked in Studio Layers" : undefined}
    >
      {background.video ? (
        <video
          aria-hidden
          autoPlay
          className="pointer-events-none absolute inset-0 -z-10 size-full rounded-[inherit]"
          loop
          muted
          playsInline
          poster={background.video.poster}
          src={background.video.src}
          style={{
            objectFit:
              background.video.contentMode === "fill" ? "cover" : "contain",
          }}
        />
      ) : null}
      {children}
    </fieldset>
  );
}
