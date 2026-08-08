/**
 * The plugin main thread.
 *
 * Its only job is to turn the current selection into the plain intermediate
 * tree and hand it to the mapper. No mapping rule lives here -- that is what
 * makes the rules testable without Figma.
 */

import { mapDocument } from "./mapper/map-document.js";
import type {
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

function base(node: SceneNode) {
  return {
    figmaId: node.id,
    name: node.name,
    visible: node.visible !== false,
    opacity: numberOr((node as { opacity?: number }).opacity, 1),
    x: numberOr((node as { x?: number }).x, 0),
    y: numberOr((node as { y?: number }).y, 0),
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
  if (node.type === "TEXT") {
    const text = node;
    const fontName = isMixed(text.fontName) ? null : (text.fontName as FontName);
    const fontWeight = (text as { fontWeight?: number | symbol }).fontWeight;
    return {
      ...base(node),
      kind: "text",
      characters: text.characters,
      fontSize: isMixed(text.fontSize) ? null : (text.fontSize as number),
      fontWeight:
        typeof fontWeight === "number" && Number.isFinite(fontWeight)
          ? fontWeight
          : null,
      fontStyleName: fontName ? fontName.style : null,
      lineHeight: serializeLineHeight(text.lineHeight),
      textAlign: serializeTextAlign(text.textAlignHorizontal),
      fills: isMixed(text.fills) ? [] : serializePaints(text.fills),
    };
  }

  const container = node as SceneNode & Partial<ChildrenMixin>;
  const isContainer =
    CONTAINER_TYPES.has(node.type) && Array.isArray(container.children);
  const imageFilled = hasVisibleImagePaint(
    (node as { fills?: unknown }).fills,
  );

  // A container with children is worth keeping even if its own fill cannot
  // cross; a childless one that is only an image is the image.
  if (isContainer && ((container.children?.length ?? 0) > 0 || !imageFilled)) {
    return serializeFrame(container as SceneNode & ChildrenMixin);
  }

  return {
    ...base(node),
    kind: "unsupported",
    figmaType: node.type,
    reason: imageFilled ? "image" : VECTOR_TYPES.has(node.type) ? "vector" : "unsupported",
  };
}

function post(message: PluginToUiMessage): void {
  figma.ui.postMessage(message);
}

function fileNameFor(documentId: string): string {
  return `${documentId}.mosaic.json`;
}

function runExport(): void {
  const selection = figma.currentPage.selection;
  if (selection.length === 0) {
    post({
      type: "exportFailed",
      message: "Nothing is selected.",
      hint: "Select the top-level frame of the paywall you want to export.",
    });
    return;
  }
  if (selection.length > 1) {
    post({
      type: "exportFailed",
      message: `${selection.length} layers are selected.`,
      hint: "Mosaic Export maps exactly one top-level frame into one paywall screen.",
    });
    return;
  }
  const [root] = selection;
  if (!root || !ROOT_TYPES.has(root.type)) {
    post({
      type: "exportFailed",
      message: `A ${root ? root.type.toLowerCase() : "layer"} cannot be an export root.`,
      hint: "Select a frame, component, or instance.",
    });
    return;
  }

  try {
    const tree = serializeFrame(root as SceneNode & ChildrenMixin);
    const { document, report } = mapDocument(tree);
    post({
      type: "exportReady",
      json: `${JSON.stringify(document, null, 2)}\n`,
      fileName: fileNameFor(report.documentId),
      report,
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

figma.showUI(__html__, { width: 420, height: 560, themeColors: true });

figma.ui.onmessage = (message: UiToPluginMessage) => {
  if (message.type === "requestExport") {
    runExport();
    return;
  }
  if (message.type === "notify") {
    figma.notify(message.message);
    return;
  }
  if (message.type === "close") figma.closePlugin();
};

figma.on("selectionchange", runExport);

runExport();
