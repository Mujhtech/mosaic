import type { StudioWorkspaceCommand } from "@/features/paywall-editor/components/studio-command-palette";
import type { StudioResizableWorkspaceHandle } from "@/features/paywall-editor/components/studio-resizable-workspace";
import type { StudioWorkspaceActions } from "@/features/paywall-editor/stores/studio-workspace-store";
import type { ValidationIssue } from "@/features/paywall-editor/types/editor";
import {
  focusDocumentValidationIssue,
  focusInspectorValidationIssue,
} from "@/features/paywall-editor/utils/property-inspector-navigation";

export function downloadStudioDocument(name: string, contents: string) {
  const blob = new Blob([contents], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${name}.mosaic.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function navigateToStudioValidationIssue(
  issue: ValidationIssue,
  {
    selectComponent,
    workspace,
    workspaceActions,
  }: {
    selectComponent: (componentId: string | null) => void;
    workspace: StudioResizableWorkspaceHandle | null;
    workspaceActions: StudioWorkspaceActions;
  }
) {
  selectComponent(issue.componentId ?? null);
  if (issue.componentId) {
    workspace?.expand("properties");
  } else {
    workspaceActions.setSelectedTool("localization");
    workspace?.expand("left");
  }
  window.setTimeout(() => {
    if (issue.componentId && focusInspectorValidationIssue(issue)) {
      return;
    }
    if (!issue.componentId && focusDocumentValidationIssue(issue)) {
      return;
    }
    const fallback = issue.componentId
      ? window.document.querySelector<HTMLElement>("#property-inspector-title")
      : window.document.querySelector<HTMLElement>("#preview-context-title");
    fallback?.scrollIntoView?.({ block: "center" });
    fallback?.focus();
  }, 0);
}

export function openStudioPreviewConnections(
  workspace: StudioResizableWorkspaceHandle | null
) {
  workspace?.expand("diagnostics");
  window.setTimeout(() => {
    const panel = window.document.querySelector<HTMLElement>(
      "#connected-preview-panel"
    );
    panel?.scrollIntoView?.({ block: "nearest" });
    panel?.focus({ preventScroll: true });
  }, 0);
}

export function runStudioWorkspaceCommand(
  workspace: StudioResizableWorkspaceHandle | null,
  command: StudioWorkspaceCommand
) {
  switch (command) {
    case "expand-left":
      workspace?.expand("left");
      break;
    case "toggle-left":
      workspace?.toggle("left");
      break;
    case "toggle-properties":
      workspace?.toggle("properties");
      break;
    case "toggle-diagnostics":
      workspace?.toggle("diagnostics");
      break;
    case "reset":
      workspace?.reset();
      break;
    default:
      // Unreachable for StudioWorkspaceCommand: the cases above are the whole
      // union. It stands guard for a command arriving from outside the type,
      // where ignoring it beats acting on a command nobody defined.
      break;
  }
}
