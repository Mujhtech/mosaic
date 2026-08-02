import { useEffect, useEffectEvent, useRef } from "react";

import { useEditorActions } from "@/features/paywall-editor/stores/editor-store-context";
import type {
  StudioTool,
  StudioWorkspacePanel,
} from "@/features/paywall-editor/types/studio-workspace";

export const STUDIO_SHORTCUT_HINTS = Object.freeze({
  appearance: "Shift A",
  commandPalette: "⌘/Ctrl Shift K",
  deleteSelection: "Delete",
  duplicateSelection: "Alt Shift D",
  fitCanvas: "F",
  openComponents: "G then C",
  openLayers: "G then L",
  openLocalization: "G then O",
  openProducts: "G then P",
  redo: "⌘/Ctrl Shift Z",
  resetZoom: "Shift 0",
  toggleDiagnostics: "\\",
  toggleLeft: "[",
  toggleProperties: "]",
  undo: "⌘/Ctrl Z",
});

const TOOL_CHORDS: Readonly<Record<string, StudioTool>> = Object.freeze({
  c: "components",
  l: "layers",
  o: "localization",
  p: "products",
});
const CHORD_TIMEOUT_MS = 1200;

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.closest('[contenteditable]:not([contenteditable="false"])') !== null
  );
}

export interface EditorKeyboardShortcutHandlers {
  readonly onFitCanvas?: () => void;
  readonly onOpenCommandPalette?: () => void;
  readonly onOpenTool?: (tool: StudioTool) => void;
  readonly onResetZoom?: () => void;
  readonly onToggleAppearance?: () => void;
  readonly onTogglePanel?: (panel: StudioWorkspacePanel) => void;
}

export function useEditorKeyboardShortcuts(
  handlers: EditorKeyboardShortcutHandlers = {}
) {
  const editor = useEditorActions();
  const chordRef = useRef<"g" | null>(null);
  const chordTimeoutRef = useRef<number | null>(null);
  const invokeHandler = useEffectEvent(
    (
      name: keyof EditorKeyboardShortcutHandlers,
      argument?: StudioTool | StudioWorkspacePanel
    ) => {
      const handler = handlers[name];
      if (!handler) {
        return;
      }
      if (argument === undefined) {
        (handler as () => void)();
      } else {
        (handler as (value: StudioTool | StudioWorkspacePanel) => void)(
          argument
        );
      }
    }
  );

  useEffect(() => {
    /** The `g` chord: a pending prefix, then the tool it opens. */
    function handleChord(
      event: KeyboardEvent,
      key: string,
      modifier: boolean
    ): boolean {
      if (chordRef.current === "g") {
        chordRef.current = null;
        if (chordTimeoutRef.current !== null) {
          window.clearTimeout(chordTimeoutRef.current);
          chordTimeoutRef.current = null;
        }
        const tool = TOOL_CHORDS[key];
        if (tool && !modifier && !event.altKey) {
          invokeHandler("onOpenTool", tool);
          event.preventDefault();
        }
        return true;
      }
      if (key === "g" && !modifier && !event.altKey && !event.shiftKey) {
        chordRef.current = "g";
        if (chordTimeoutRef.current !== null) {
          window.clearTimeout(chordTimeoutRef.current);
        }
        chordTimeoutRef.current = window.setTimeout(() => {
          chordRef.current = null;
          chordTimeoutRef.current = null;
        }, CHORD_TIMEOUT_MS);
        event.preventDefault();
        return true;
      }
      return false;
    }

    /** Command palette. */
    function handleCommandShortcut(
      event: KeyboardEvent,
      key: string,
      modifier: boolean
    ): boolean {
      if (modifier && event.shiftKey && key === "k") {
        invokeHandler("onOpenCommandPalette");
        event.preventDefault();
        return true;
      }
      return false;
    }

    /** Undo and redo. */
    function handleHistoryShortcut(
      event: KeyboardEvent,
      key: string,
      modifier: boolean,
      snapshot: ReturnType<typeof editor.getSnapshot>
    ): boolean {
      if (modifier && key === "z") {
        if (event.shiftKey && snapshot.redoStack.length > 0) {
          editor.redo();
        } else if (snapshot.undoStack.length > 0) {
          editor.undo();
        }
        event.preventDefault();
        return true;
      }
      if (modifier && key === "y" && snapshot.redoStack.length > 0) {
        editor.redo();
        event.preventDefault();
        return true;
      }
      return false;
    }

    /** Duplicate, delete and reorder the selection. */
    function handleComponentShortcut(
      event: KeyboardEvent,
      key: string,
      modifier: boolean
    ): boolean {
      if (event.altKey && event.shiftKey && key === "d") {
        editor.duplicateSelectedComponent();
        event.preventDefault();
        return true;
      }
      if ((event.key === "Backspace" || event.key === "Delete") && !modifier) {
        editor.removeSelectedComponent();
        event.preventDefault();
        return true;
      }
      if (modifier && event.key === "ArrowUp") {
        editor.moveSelectedComponent(-1);
        event.preventDefault();
        return true;
      }
      if (modifier && event.key === "ArrowDown") {
        editor.moveSelectedComponent(1);
        event.preventDefault();
        return true;
      }
      return false;
    }

    /** Arrow-key movement across the tree. */
    function handleArrowNavigation(
      event: KeyboardEvent,
      key: string,
      modifier: boolean
    ): boolean {
      if (!(modifier || event.altKey || event.shiftKey) && event.key === "[") {
        invokeHandler("onTogglePanel", "left");
        event.preventDefault();
      } else if (
        !(modifier || event.altKey || event.shiftKey) &&
        event.key === "]"
      ) {
        invokeHandler("onTogglePanel", "properties");
        event.preventDefault();
      } else if (
        !(modifier || event.altKey || event.shiftKey) &&
        event.key === "\\"
      ) {
        invokeHandler("onTogglePanel", "diagnostics");
        event.preventDefault();
      } else if (!(modifier || event.altKey || event.shiftKey) && key === "f") {
        invokeHandler("onFitCanvas");
        event.preventDefault();
      } else if (
        !(modifier || event.altKey) &&
        event.shiftKey &&
        (event.code === "Digit0" || event.key === ")" || event.key === "0")
      ) {
        invokeHandler("onResetZoom");
        event.preventDefault();
      } else if (!(modifier || event.altKey) && event.shiftKey && key === "a") {
        invokeHandler("onToggleAppearance");
        event.preventDefault();
      }
      return false;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (isEditableTarget(event.target)) {
        chordRef.current = null;
        return;
      }
      const modifier = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      const snapshot = editor.getSnapshot();
      // Each returns whether it claimed the key; the first that does wins.
      const shortcutHandlers = [
        () => handleChord(event, key, modifier),
        () => handleCommandShortcut(event, key, modifier),
        () => handleHistoryShortcut(event, key, modifier, snapshot),
        () => handleComponentShortcut(event, key, modifier),
        () => handleArrowNavigation(event, key, modifier),
      ];
      for (const handle of shortcutHandlers) {
        if (handle()) {
          return;
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (chordTimeoutRef.current !== null) {
        window.clearTimeout(chordTimeoutRef.current);
      }
    };
  }, [editor]);
}
