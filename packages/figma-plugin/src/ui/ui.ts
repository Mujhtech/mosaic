/**
 * The plugin UI.
 *
 * Shows the export report and hands the JSON to the user. It never mutates the
 * document -- the report is the whole point, so a lossy export is visible
 * before it is imported. Every report row is a button that selects and reveals
 * its layer in Figma: a warning naming a layer you cannot find is a warning you
 * ignore.
 */

import type { ExportReport, ExportWarning } from "../mapper/report.js";
import type { PluginToUiMessage, UiToPluginMessage } from "../messages.js";

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`The UI is missing #${id}.`);
  return found as T;
}

function post(message: UiToPluginMessage): void {
  parent.postMessage({ pluginMessage: message }, "*");
}

type ReportRow = {
  readonly label: string;
  readonly layerPath: string;
  readonly figmaId: string;
  readonly message: string;
};

function appendRows(
  list: HTMLUListElement,
  entries: readonly ReportRow[],
): void {
  for (const entry of entries) {
    const item = document.createElement("li");
    const row = document.createElement("button");
    row.type = "button";
    row.className = "row";
    row.title = "Select this layer in Figma";

    const label = document.createElement("span");
    label.className = "row-label";
    label.textContent = entry.label;
    const message = document.createElement("span");
    message.textContent = ` ${entry.message} `;
    const path = document.createElement("code");
    path.textContent = entry.layerPath;

    row.append(label, message, path);
    row.addEventListener("click", () => {
      post({ type: "selectNode", nodeId: entry.figmaId });
    });
    item.append(row);
    list.append(item);
  }
}

function renderList(list: HTMLUListElement, entries: readonly ReportRow[]): void {
  list.textContent = "";
  appendRows(list, entries);
}

let currentJson: string | null = null;
let currentFileName = "paywall.mosaic.json";
let bundleJson: string | null = null;
let bundleFileName = "paywall.mosaic-figma.json";
let bundlePending = false;
/** True when the user asked for the bundle and it is still being rendered. */
let bundleRequested = false;

function warningRows(warnings: readonly ExportWarning[]): ReportRow[] {
  return warnings.map((warning) => ({
    label: warning.code,
    layerPath: warning.layerPath,
    figmaId: warning.figmaId,
    message: warning.message,
  }));
}

function renderReport(report: ExportReport): void {
  element("stat-nodes").textContent = String(report.mappedNodeCount);
  element("stat-text").textContent = String(report.textCount);
  element("stat-strings").textContent = String(report.localizedStringCount);
  element("doc-id").textContent = report.documentId;

  const screens = `${report.screenCount} screen${report.screenCount === 1 ? "" : "s"}`;
  const stacks = `${report.stackCount} stack${report.stackCount === 1 ? "" : "s"}`;
  const buttons =
    report.buttonCount > 0
      ? `, ${report.buttonCount} button${report.buttonCount === 1 ? "" : "s"}`
      : "";
  const images =
    report.imageCount > 0
      ? `, ${report.imageCount} image${report.imageCount === 1 ? "" : "s"} for the bundle`
      : "";
  element("doc-summary").textContent =
    `${screens} from ${report.rootLayerNames.map((name) => `"${name}"`).join(", ")}: ${stacks}${buttons}${images}.`;

  const warningsPanel = element("warnings-panel");
  warningsPanel.hidden = report.warnings.length === 0;
  element("warnings-count").textContent = String(report.warnings.length);
  renderList(element<HTMLUListElement>("warnings"), warningRows(report.warnings));

  const skippedPanel = element("skipped-panel");
  skippedPanel.hidden = report.skipped.length === 0;
  element("skipped-count").textContent = String(report.skipped.length);
  renderList(
    element<HTMLUListElement>("skipped"),
    report.skipped.map((skip) => ({
      label: skip.figmaType,
      layerPath: skip.layerPath,
      figmaId: skip.figmaId,
      message: skip.message,
    })),
  );
}

function setBundleLabel(text: string, disabled: boolean): void {
  const button = element<HTMLButtonElement>("download-bundle");
  button.textContent = text;
  button.disabled = disabled;
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
  bundleJson = null;
}

function save(contents: string, fileName: string): void {
  const blob = new Blob([contents], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  post({ type: "notify", message: `Exported ${fileName}` });
}

function downloadDocument(): void {
  if (currentJson === null) return;
  save(currentJson, currentFileName);
}

/**
 * Downloads the bundle, rendering the images first if that has not happened.
 *
 * Rendering is deliberately lazy: it costs one `exportAsync` per image, which
 * is far too slow to run on every selection change when most exports never ask
 * for it.
 */
function downloadBundle(): void {
  if (bundleJson !== null) {
    save(bundleJson, bundleFileName);
    return;
  }
  if (bundlePending) return;
  bundlePending = true;
  bundleRequested = true;
  setBundleLabel("Rendering images…", true);
  post({ type: "requestBundle" });
}

element("download-document").addEventListener("click", downloadDocument);
element("download-bundle").addEventListener("click", downloadBundle);
element("copy").addEventListener("click", () => {
  void copy();
});

/**
 * Copies the document JSON.
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
      : "Could not copy. Use Download document only instead.",
  });
}

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
    bundleFileName = message.bundleFileName;
    // A new mapping invalidates whatever was rendered for the old one.
    bundleJson = null;
    bundlePending = false;
    bundleRequested = false;
    setBundleLabel("Download for Studio (with images)", false);
    renderReport(message.report);
    showResult();
    return;
  }
  if (message.type === "bundleReady") {
    bundleJson = message.json;
    bundleFileName = message.fileName;
    bundlePending = false;
    setBundleLabel("Download for Studio (with images)", false);
    if (message.dropped.length > 0) {
      // The size caps only bite once the images have been rendered, so these
      // warnings arrive after the report was drawn and are appended to it.
      element("warnings-panel").hidden = false;
      const existing = Number(element("warnings-count").textContent ?? "0");
      element("warnings-count").textContent = String(
        existing + message.dropped.length,
      );
      appendRows(
        element<HTMLUListElement>("warnings"),
        warningRows(message.dropped),
      );
    }
    if (bundleRequested) {
      bundleRequested = false;
      save(bundleJson, bundleFileName);
    }
    return;
  }
  if (message.type === "bundleFailed") {
    bundlePending = false;
    bundleRequested = false;
    setBundleLabel("Download for Studio (with images)", false);
    post({ type: "notify", message: message.message });
  }
});

post({ type: "requestExport" });
