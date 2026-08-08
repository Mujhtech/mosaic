/**
 * The plugin UI.
 *
 * Shows the export report and hands the JSON to the user. It never mutates the
 * document -- the report is the whole point, so a lossy export is visible
 * before it is imported.
 */

import type { ExportReport } from "../mapper/report.js";
import type { PluginToUiMessage, UiToPluginMessage } from "../messages.js";

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`The UI is missing #${id}.`);
  return found as T;
}

function post(message: UiToPluginMessage): void {
  parent.postMessage({ pluginMessage: message }, "*");
}

function renderList(list: HTMLUListElement, entries: readonly {
  readonly label: string;
  readonly layerPath: string;
  readonly message: string;
}[]): void {
  list.textContent = "";
  for (const entry of entries) {
    const item = document.createElement("li");
    const path = document.createElement("code");
    path.textContent = entry.layerPath;
    item.append(`${entry.label}: ${entry.message} `, path);
    list.append(item);
  }
}

let currentJson: string | null = null;
let currentFileName = "paywall.mosaic.json";

function renderReport(report: ExportReport): void {
  element("stat-nodes").textContent = String(report.mappedNodeCount);
  element("stat-text").textContent = String(report.textCount);
  element("stat-strings").textContent = String(report.localizedStringCount);
  element("doc-id").textContent = report.documentId;
  element("doc-summary").textContent =
    `${report.stackCount} stack${report.stackCount === 1 ? "" : "s"} from "${report.rootLayerName}", one screen, no assets or products.`;

  const warningsPanel = element("warnings-panel");
  warningsPanel.hidden = report.warnings.length === 0;
  element("warnings-count").textContent = String(report.warnings.length);
  renderList(
    element<HTMLUListElement>("warnings"),
    report.warnings.map((warning) => ({
      label: warning.code,
      layerPath: warning.layerPath,
      message: warning.message,
    })),
  );

  const skippedPanel = element("skipped-panel");
  skippedPanel.hidden = report.skipped.length === 0;
  element("skipped-count").textContent = String(report.skipped.length);
  renderList(
    element<HTMLUListElement>("skipped"),
    report.skipped.map((skip) => ({
      label: skip.figmaType,
      layerPath: skip.layerPath,
      message: skip.message,
    })),
  );
}

function showResult(): void {
  element("result").hidden = false;
  element("error").hidden = true;
}

function showError(message: string, hint: string): void {
  element("error-message").textContent = message;
  element("error-hint").textContent = hint;
  element("error").hidden = false;
  element("result").hidden = true;
  currentJson = null;
}

function download(): void {
  if (currentJson === null) return;
  const blob = new Blob([currentJson], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = currentFileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  post({ type: "notify", message: `Exported ${currentFileName}` });
}

/**
 * Copies the JSON.
 *
 * The clipboard API is not always reachable from the plugin iframe, so the
 * selection-based path is a real fallback rather than a formality.
 */
async function copy(): Promise<void> {
  if (currentJson === null) return;
  try {
    await navigator.clipboard.writeText(currentJson);
    post({ type: "notify", message: "Copied the Mosaic document" });
    return;
  } catch {
    // Fall through to the selection-based copy.
  }
  const area = document.createElement("textarea");
  area.value = currentJson;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  const copied = document.execCommand("copy");
  area.remove();
  post({
    type: "notify",
    message: copied
      ? "Copied the Mosaic document"
      : "Could not copy. Use Download JSON instead.",
  });
}

element("download").addEventListener("click", download);
element("copy").addEventListener("click", () => {
  void copy();
});

window.addEventListener("message", (event: MessageEvent) => {
  const message = event.data?.pluginMessage as PluginToUiMessage | undefined;
  if (!message) return;
  if (message.type === "exportFailed") {
    showError(message.message, message.hint);
    return;
  }
  if (message.type === "exportReady") {
    currentJson = message.json;
    currentFileName = message.fileName;
    renderReport(message.report);
    showResult();
  }
});

post({ type: "requestExport" });
