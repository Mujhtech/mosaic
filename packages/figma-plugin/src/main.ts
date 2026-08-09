/**
 * The plugin main thread.
 *
 * Its only jobs are to turn the current selection into the plain intermediate
 * tree, to render the pixels the bundle carries, and to reveal a layer the
 * report names. No mapping rule lives here -- that is what makes the rules
 * testable without Figma.
 */

import {
  assembleBundle,
  pngDimensions,
  IMAGE_SCALE,
  type RenderedImage,
} from "./bundle.js";
import { mapDocument, type MapResult } from "./mapper/map-document.js";
import type {
  IntermediateBounds,
  IntermediateFrame,
  IntermediateLineHeight,
  IntermediateNode,
  IntermediatePaint,
  IntermediateTextAlign,
} from "./mapper/intermediate.js";
import type { PluginToUiMessage, UiToPluginMessage } from "./messages.js";

const CONTAINER_TYPES = new Set([
  "FRAME",
  "COMPONENT",
  "COMPONENT_SET",
  "INSTANCE",
  "GROUP",
  "SECTION",
]);

/** Selections the plugin accepts as an export root. */
const ROOT_TYPES = new Set(["FRAME", "COMPONENT", "INSTANCE"]);

/** Childless layers whose solid fill is worth keeping as a colour block. */
const SHAPE_TYPES = new Set([
  "RECTANGLE",
  "ELLIPSE",
  "FRAME",
  "COMPONENT",
  "INSTANCE",
]);

const VECTOR_TYPES = new Set([
  "RECTANGLE",
  "ELLIPSE",
  "POLYGON",
  "STAR",
  "LINE",
  "VECTOR",
  "BOOLEAN_OPERATION",
  "SLICE",
  "STICKY",
  "SHAPE_WITH_TEXT",
  "CONNECTOR",
]);

function isMixed(value: unknown): boolean {
  return value === figma.mixed;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Reads a Figma getter that throws on some node states rather than returning. */
function attempt<T>(read: () => T): T | null {
  try {
    return read();
  } catch {
    return null;
  }
}

function serializePaints(fills: unknown): IntermediatePaint[] {
  if (!Array.isArray(fills)) return [];
  return fills.map((paint: Paint): IntermediatePaint => {
    const visible = paint.visible !== false;
    if (paint.type === "SOLID") {
      return {
        type: "solid",
        visible,
        color: { r: paint.color.r, g: paint.color.g, b: paint.color.b },
        opacity: numberOr(paint.opacity, 1),
      };
    }
    return { type: "unsupported", visible, paintType: paint.type };
  });
}

function hasVisibleImagePaint(fills: unknown): boolean {
  if (!Array.isArray(fills)) return false;
  return fills.some(
    (paint: Paint) =>
      paint.visible !== false &&
      (paint.type === "IMAGE" || paint.type === "VIDEO"),
  );
}

function hasVisibleSolidPaint(fills: unknown): boolean {
  if (!Array.isArray(fills)) return false;
  return fills.some(
    (paint: Paint) => paint.visible !== false && paint.type === "SOLID",
  );
}

function serializeLineHeight(value: unknown): IntermediateLineHeight {
  if (!value || typeof value !== "object" || isMixed(value)) {
    return { unit: "auto" };
  }
  const lineHeight = value as LineHeight;
  if (lineHeight.unit === "PIXELS") {
    return { unit: "pixels", value: lineHeight.value };
  }
  if (lineHeight.unit === "PERCENT") {
    return { unit: "percent", value: lineHeight.value };
  }
  return { unit: "auto" };
}

function serializeTextAlign(value: unknown): IntermediateTextAlign {
  switch (value) {
    case "CENTER":
      return "center";
    case "RIGHT":
      return "right";
    case "JUSTIFIED":
      return "justified";
    default:
      return "left";
  }
}

/**
 * The node's absolute bounding box.
 *
 * Absolute rather than `x`/`y`, because a GROUP's children report coordinates
 * relative to the enclosing frame rather than to the group, and the layout
 * inference needs one coordinate system that composes at any depth.
 */
function serializeBounds(node: SceneNode): IntermediateBounds | null {
  const box = (node as { absoluteBoundingBox?: Rect | null }).absoluteBoundingBox;
  if (!box) return null;
  if (
    !Number.isFinite(box.x) ||
    !Number.isFinite(box.y) ||
    !Number.isFinite(box.width) ||
    !Number.isFinite(box.height)
  ) {
    return null;
  }
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}

function base(node: SceneNode) {
  return {
    figmaId: node.id,
    name: node.name,
    visible: node.visible !== false,
    opacity: numberOr((node as { opacity?: number }).opacity, 1),
    x: numberOr((node as { x?: number }).x, 0),
    y: numberOr((node as { y?: number }).y, 0),
    bounds: serializeBounds(node),
  };
}

/**
 * A text layer's typography.
 *
 * Figma reports `figma.mixed` for any property that varies across the layer's
 * characters. Rather than give up and fall back to a default, the first
 * character's styling is read back with the range getters -- it is what the
 * layer opens with, and it is very often the whole layer bar one styled word.
 * `mixedStyling` records that this happened so the report can say so.
 */
function serializeText(node: TextNode): IntermediateNode {
  const hasCharacters = node.characters.length > 0;
  const mixedSize = isMixed(node.fontSize);
  const mixedName = isMixed(node.fontName);
  const rawWeight = (node as { fontWeight?: number | symbol }).fontWeight;
  const mixedWeight = isMixed(rawWeight);

  let fontSize = mixedSize ? null : (node.fontSize as number);
  if (fontSize === null && hasCharacters) {
    const first = attempt(() => node.getRangeFontSize(0, 1));
    if (typeof first === "number" && Number.isFinite(first)) fontSize = first;
  }

  let fontStyleName = mixedName ? null : (node.fontName as FontName).style;
  if (fontStyleName === null && hasCharacters) {
    const first = attempt(() => node.getRangeFontName(0, 1));
    if (first && typeof first === "object" && "style" in first) {
      fontStyleName = (first as FontName).style;
    }
  }

  let fontWeight =
    typeof rawWeight === "number" && Number.isFinite(rawWeight)
      ? rawWeight
      : null;
  if (fontWeight === null && mixedWeight && hasCharacters) {
    const first = attempt(() => node.getRangeFontWeight(0, 1));
    if (typeof first === "number" && Number.isFinite(first)) fontWeight = first;
  }

  return {
    ...base(node),
    kind: "text",
    characters: node.characters,
    fontSize,
    fontWeight,
    fontStyleName,
    lineHeight: serializeLineHeight(node.lineHeight),
    textAlign: serializeTextAlign(node.textAlignHorizontal),
    fills: isMixed(node.fills) ? [] : serializePaints(node.fills),
    mixedStyling: mixedSize || mixedName || mixedWeight,
  };
}

function serializeFrame(node: SceneNode & ChildrenMixin): IntermediateFrame {
  const layout = node as unknown as Partial<AutoLayoutMixin> & {
    cornerRadius?: number | PluginAPI["mixed"];
    fills?: unknown;
  };
  const layoutMode =
    layout.layoutMode === "HORIZONTAL"
      ? "horizontal"
      : layout.layoutMode === "VERTICAL"
        ? "vertical"
        : "none";
  const primary = layout.primaryAxisAlignItems;
  const counter = layout.counterAxisAlignItems;
  return {
    ...base(node),
    kind: "frame",
    figmaType: node.type,
    layoutMode,
    itemSpacing: numberOr(layout.itemSpacing, 0),
    primaryAxisAlignItems:
      primary === "CENTER"
        ? "center"
        : primary === "MAX"
          ? "max"
          : primary === "SPACE_BETWEEN"
            ? "spaceBetween"
            : "min",
    counterAxisAlignItems:
      counter === "CENTER"
        ? "center"
        : counter === "MAX"
          ? "max"
          : counter === "BASELINE"
            ? "baseline"
            : "min",
    paddingTop: numberOr(layout.paddingTop, 0),
    paddingRight: numberOr(layout.paddingRight, 0),
    paddingBottom: numberOr(layout.paddingBottom, 0),
    paddingLeft: numberOr(layout.paddingLeft, 0),
    cornerRadius: isMixed(layout.cornerRadius)
      ? null
      : numberOr(layout.cornerRadius, 0),
    fills: isMixed(layout.fills) ? [] : serializePaints(layout.fills),
    children: node.children.map(serializeNode),
  };
}

function serializeNode(node: SceneNode): IntermediateNode {
  if (node.type === "TEXT") return serializeText(node);

  const container = node as SceneNode & Partial<ChildrenMixin>;
  const isContainer =
    CONTAINER_TYPES.has(node.type) && Array.isArray(container.children);
  const childCount = container.children?.length ?? 0;
  const rawFills = (node as { fills?: unknown }).fills;
  const fills = isMixed(rawFills) ? [] : rawFills;
  const imageFilled = hasVisibleImagePaint(fills);

  // A container with children is worth keeping even if its own fill cannot
  // cross; a childless one that is only an image is the image.
  if (isContainer && childCount > 0) {
    return serializeFrame(container as SceneNode & ChildrenMixin);
  }

  // A childless painted box -- a divider, a pill, a colour block -- is content,
  // not decoration, and the mapper has a home for it.
  if (SHAPE_TYPES.has(node.type) && !imageFilled && hasVisibleSolidPaint(fills)) {
    const radius = (node as { cornerRadius?: number | PluginAPI["mixed"] })
      .cornerRadius;
    return {
      ...base(node),
      kind: "shape",
      figmaType: node.type,
      cornerRadius: isMixed(radius) ? null : numberOr(radius, 0),
      fills: serializePaints(fills),
    };
  }

  if (isContainer && !imageFilled) {
    return serializeFrame(container as SceneNode & ChildrenMixin);
  }

  return {
    ...base(node),
    kind: "unsupported",
    figmaType: node.type,
    reason: imageFilled
      ? "image"
      : VECTOR_TYPES.has(node.type)
        ? "vector"
        : "unsupported",
  };
}

function post(message: PluginToUiMessage): void {
  figma.ui.postMessage(message);
}

function fileNameFor(documentId: string): string {
  return `${documentId}.mosaic.json`;
}

function bundleFileNameFor(documentId: string): string {
  return `${documentId}.mosaic-figma.json`;
}

/**
 * The last successful mapping.
 *
 * Held so the bundle can be built on demand: rendering every image is far too
 * slow to do on every selection change, and most exports never ask for it.
 */
let lastExport: MapResult | null = null;

/**
 * Guards against a slow bundle landing after the selection moved on. Each run
 * takes the next number; a result whose number is stale is dropped.
 */
let runToken = 0;

function rootsFromSelection(): readonly SceneNode[] | null {
  const selection = figma.currentPage.selection;
  if (selection.length === 0) {
    post({
      type: "exportFailed",
      message: "Nothing is selected.",
      hint: "Select one or more top-level frames. Each frame becomes one paywall screen.",
    });
    return null;
  }
  const rejected = selection.find((node) => !ROOT_TYPES.has(node.type));
  if (rejected) {
    post({
      type: "exportFailed",
      message: `A ${rejected.type.toLowerCase()} cannot be an export root.`,
      hint: "Select frames, components, or instances -- one per screen.",
    });
    return null;
  }
  return selection;
}

function runExport(): void {
  runToken += 1;
  lastExport = null;
  const roots = rootsFromSelection();
  if (!roots) return;

  try {
    const trees = roots.map((root) =>
      serializeFrame(root as SceneNode & ChildrenMixin),
    );
    const result = mapDocument(trees);
    lastExport = result;
    post({
      type: "exportReady",
      json: `${JSON.stringify(result.document, null, 2)}\n`,
      fileName: fileNameFor(result.report.documentId),
      bundleFileName: bundleFileNameFor(result.report.documentId),
      report: result.report,
    });
  } catch (error) {
    post({
      type: "exportFailed",
      message:
        error instanceof Error ? error.message : "The selection could not be mapped.",
      hint: "Simplify the frame and try again, or report this with the frame name.",
    });
  }
}

/** Renders every placed image at 2x. One failure costs one image, not the export. */
async function renderPlacedImages(result: MapResult): Promise<RenderedImage[]> {
  const rendered: RenderedImage[] = [];
  for (const placement of result.imagePlacements) {
    const node = await figma.getNodeByIdAsync(placement.figmaId);
    if (!node || node.removed) continue;
    const exportable = node as unknown as ExportMixin & {
      width?: number;
      height?: number;
    };
    if (typeof exportable.exportAsync !== "function") continue;
    let bytes: Uint8Array;
    try {
      bytes = await exportable.exportAsync({
        format: "PNG",
        constraint: { type: "SCALE", value: IMAGE_SCALE },
      });
    } catch {
      continue;
    }
    // The PNG header is exact; the layer's own size times the scale is the
    // fallback for a byte stream that somehow is not a PNG.
    const measured = pngDimensions(bytes) ?? {
      width: Math.max(1, Math.round(numberOr(exportable.width, 1) * IMAGE_SCALE)),
      height: Math.max(1, Math.round(numberOr(exportable.height, 1) * IMAGE_SCALE)),
    };
    rendered.push({
      assetId: placement.assetId,
      bytes,
      width: measured.width,
      height: measured.height,
    });
  }
  return rendered;
}

async function runBundle(): Promise<void> {
  const result = lastExport;
  if (!result) {
    post({ type: "bundleFailed", message: "Re-run the export first." });
    return;
  }
  const token = runToken;
  try {
    const rendered = await renderPlacedImages(result);
    if (token !== runToken) return;
    const { bundle, dropped } = assembleBundle({
      document: result.document,
      report: result.report,
      placements: result.imagePlacements,
      rendered,
    });
    post({
      type: "bundleReady",
      json: `${JSON.stringify(bundle, null, 2)}\n`,
      fileName: bundleFileNameFor(result.report.documentId),
      dropped,
    });
  } catch (error) {
    if (token !== runToken) return;
    post({
      type: "bundleFailed",
      message:
        error instanceof Error
          ? error.message
          : "The images could not be rendered.",
    });
  }
}

function pageOf(node: BaseNode): PageNode | null {
  let current: BaseNode | null = node;
  while (current) {
    if (current.type === "PAGE") return current;
    current = current.parent;
  }
  return null;
}

/**
 * True while the plugin is moving the selection itself.
 *
 * Revealing a layer changes the selection, which would otherwise re-run the
 * export and replace the very report the user clicked in with a one-layer one.
 */
let revealing = false;

/** Selects and reveals the layer a report entry names, if it is still there. */
async function revealNode(nodeId: string): Promise<void> {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node || node.removed || node.type === "DOCUMENT" || node.type === "PAGE") {
    figma.notify("That layer no longer exists.");
    return;
  }
  const scene = node as SceneNode;
  const page = pageOf(scene);
  if (!page) {
    figma.notify("That layer no longer exists.");
    return;
  }
  if (page !== figma.currentPage) {
    revealing = true;
    await figma.setCurrentPageAsync(page);
  }
  const current = figma.currentPage.selection;
  const alreadySelected = current.length === 1 && current[0] === scene;
  if (!alreadySelected) {
    revealing = true;
    figma.currentPage.selection = [scene];
  }
  figma.viewport.scrollAndZoomIntoView([scene]);
}

figma.showUI(__html__, { width: 460, height: 620, themeColors: true });

figma.ui.onmessage = (message: UiToPluginMessage) => {
  if (message.type === "requestExport") {
    runExport();
    return;
  }
  if (message.type === "requestBundle") {
    void runBundle();
    return;
  }
  if (message.type === "selectNode") {
    void revealNode(message.nodeId);
    return;
  }
  if (message.type === "notify") {
    figma.notify(message.message);
    return;
  }
  if (message.type === "close") figma.closePlugin();
};

figma.on("selectionchange", () => {
  if (revealing) {
    revealing = false;
    return;
  }
  runExport();
});

runExport();
