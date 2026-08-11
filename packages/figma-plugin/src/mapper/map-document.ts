import type {
  MosaicPaywallV03ContainerAppearance,
  MosaicPaywallV03Document,
  MosaicPaywallV03EdgeInsets,
  MosaicPaywallV03Node,
  MosaicPaywallV03Stack,
  MosaicPaywallV03TextComponent,
} from "../../../../protocol/browser/index.js";
import { deriveRequiredCapabilities } from "./capabilities.js";
import { hasVisibleUnsupportedPaint, solidFillColor } from "./color.js";
import {
  identifierAllocator,
  localizationKeyAllocator,
  slugifyIdentifier,
  slugifyKeySegment,
  type NameAllocator,
} from "./identifiers.js";
import type {
  IntermediateFrame,
  IntermediateNode,
  IntermediateText,
} from "./intermediate.js";
import { ReportBuilder, type ExportReport } from "./report.js";
import {
  clampFontSize,
  pickTypographyStyle,
  snapFontWeight,
  toLineHeightMultiplier,
  toTextAlignment,
} from "./typography.js";

/** `#/$defs/logicalSize` upper bound, shared by gap and every inset. */
const MAX_LOGICAL_SIZE = 4096;

/** The single screen every export produces. */
const SCREEN_ID = "imported";

/** Namespace for every localization key this plugin mints. */
const KEY_NAMESPACE = "figma";

export type MapResult = {
  readonly document: MosaicPaywallV03Document;
  readonly report: ExportReport;
};

export type MapOptions = {
  /**
   * Overrides the document id, which otherwise comes from the frame name.
   * The caller is responsible for passing something that slugifies.
   */
  readonly documentId?: string;
};

function clampLogicalSize(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_LOGICAL_SIZE, Math.max(0, Math.round(value * 100) / 100));
}

/**
 * Figma pads left/right on the physical canvas; the protocol pads start/end on
 * the reading axis. For the LTR documents this plugin emits they coincide, and
 * a mirrored RTL layout is a Studio-side decision, not something to bake in.
 */
function toEdgeInsets(frame: IntermediateFrame): MosaicPaywallV03EdgeInsets {
  return {
    top: clampLogicalSize(frame.paddingTop),
    start: clampLogicalSize(frame.paddingLeft),
    bottom: clampLogicalSize(frame.paddingBottom),
    end: clampLogicalSize(frame.paddingRight),
  };
}

const ZERO_INSETS: MosaicPaywallV03EdgeInsets = {
  top: 0,
  start: 0,
  bottom: 0,
  end: 0,
};

function mainAxisDistribution(
  frame: IntermediateFrame,
): MosaicPaywallV03Stack["mainAxisDistribution"] {
  switch (frame.primaryAxisAlignItems) {
    case "center":
      return "center";
    case "max":
      return "end";
    case "spaceBetween":
      return "spaceBetween";
    default:
      return "start";
  }
}

function crossAxisAlignment(
  frame: IntermediateFrame,
  report: ReportBuilder,
  layerPath: string,
): MosaicPaywallV03Stack["crossAxisAlignment"] {
  switch (frame.counterAxisAlignItems) {
    case "center":
      return "center";
    case "max":
      return "end";
    case "baseline":
      // The protocol has no baseline alignment. Centre is the closest thing
      // that does not silently shift a row to one edge.
      report.warn(
        "layout.baselineAlignment",
        layerPath,
        "Baseline alignment has no protocol equivalent and was mapped to center.",
      );
      return "center";
    default:
      return "start";
  }
}

function containerAppearance(
  frame: IntermediateFrame,
  report: ReportBuilder,
  layerPath: string,
): MosaicPaywallV03ContainerAppearance | null {
  const appearance: {
    background?: { type: "color"; value: string };
    cornerRadius?: number;
  } = {};
  const background = solidFillColor(frame.fills, frame.opacity);
  if (background) {
    appearance.background = { type: "color", value: background };
  }
  if (hasVisibleUnsupportedPaint(frame.fills)) {
    report.warn(
      "style.unsupportedFill",
      layerPath,
      "An image or gradient fill was dropped; re-add it in Studio.",
    );
  }
  if (frame.cornerRadius === null) {
    report.warn(
      "style.mixedCornerRadius",
      layerPath,
      "Per-corner radii have no protocol equivalent and were dropped.",
    );
  } else if (frame.cornerRadius > 0) {
    appearance.cornerRadius = clampLogicalSize(frame.cornerRadius);
  }
  // `containerAppearance` has minProperties 1: an empty object is invalid, so
  // the field is omitted rather than emitted bare.
  return Object.keys(appearance).length > 0
    ? (appearance as MosaicPaywallV03ContainerAppearance)
    : null;
}

type MapContext = {
  readonly ids: NameAllocator;
  readonly keys: NameAllocator;
  readonly strings: Record<string, string>;
  readonly report: ReportBuilder;
  stackCount: number;
  textCount: number;
};

function allocateId(context: MapContext, name: string, fallback: string): string {
  const candidate = slugifyIdentifier(name, fallback);
  const allocated = context.ids.allocate(candidate);
  return allocated;
}

/**
 * Registers a user-visible string and returns the localized-text value.
 *
 * Every string the document shows lives in the default catalog, and the
 * validator rejects both a missing key and an unused one, so this is the only
 * way a string enters the document.
 */
function localize(
  context: MapContext,
  layerName: string,
  value: string,
  fallbackSegment: string,
): { default: string; localizationKey: string } {
  const segment = slugifyKeySegment(layerName, fallbackSegment);
  const key = context.keys.allocate(`${KEY_NAMESPACE}.${segment}`);
  context.strings[key] = value;
  return { default: value, localizationKey: key };
}

function mapText(
  node: IntermediateText,
  context: MapContext,
  layerPath: string,
): MosaicPaywallV03TextComponent | null {
  const characters = node.characters;
  if (characters.trim().length === 0) {
    // `localizedText.default` has minLength 1, and an empty label is not
    // content anyone meant to ship.
    context.report.skip(
      "emptyText",
      layerPath,
      "TEXT",
      "The text layer is empty and was skipped.",
    );
    return null;
  }
  if (node.fontSize === null) {
    context.report.warn(
      "text.mixedFontSize",
      layerPath,
      "The layer mixes font sizes; the default size was used.",
    );
  }
  if (node.fontWeight === null && node.fontStyleName === null) {
    context.report.warn(
      "text.mixedFontWeight",
      layerPath,
      "The layer mixes font weights; regular was used.",
    );
  }
  if (node.textAlign === "justified") {
    context.report.warn(
      "text.justifiedAlignment",
      layerPath,
      "Justified alignment has no protocol equivalent and was mapped to start.",
    );
  }
  if (hasVisibleUnsupportedPaint(node.fills)) {
    context.report.warn(
      "style.unsupportedFill",
      layerPath,
      "An image or gradient text fill was dropped; a solid colour was used.",
    );
  }

  const fontSize = clampFontSize(node.fontSize);
  const color = solidFillColor(node.fills, node.opacity) ?? "text.primary";
  context.textCount += 1;

  return {
    type: "text",
    id: allocateId(context, node.name, "text"),
    value: localize(context, node.name, characters, "text"),
    typography: {
      style: pickTypographyStyle(fontSize, characters),
      fontSize,
      lineHeightMultiplier: toLineHeightMultiplier(node.lineHeight, fontSize),
      weight: snapFontWeight(node.fontWeight, node.fontStyleName),
      color,
      alignment: toTextAlignment(node.textAlign),
    },
    accessibility: { role: "text" },
  };
}

/**
 * Children of a frame without auto-layout, in reading order.
 *
 * Absolute coordinates cannot survive the trip -- the protocol has no absolute
 * positioning -- so the only honest thing is to flatten to a vertical stack and
 * say so. Top-to-bottom, then left-to-right for ties, which is how a person
 * reads the frame.
 */
export function orderAbsoluteChildren(
  children: readonly IntermediateNode[],
): readonly IntermediateNode[] {
  return [...children].sort((left, right) => {
    if (left.y !== right.y) return left.y - right.y;
    return left.x - right.x;
  });
}

function mapFrame(
  frame: IntermediateFrame,
  context: MapContext,
  layerPath: string,
): MosaicPaywallV03Stack {
  const absolute = frame.layoutMode === "none";
  if (absolute) {
    context.report.warn(
      "layout.absoluteFlattened",
      layerPath,
      "Absolute layout flattened: children were stacked vertically in reading order.",
    );
  }

  const orderedChildren = absolute
    ? orderAbsoluteChildren(frame.children)
    : frame.children;

  // The id is allocated before the children so a parent keeps the name it
  // shares with a child, rather than being pushed to "-2".
  const id = allocateId(context, frame.name, "group");
  const spaceBetween =
    !absolute && frame.primaryAxisAlignItems === "spaceBetween";
  const appearance = containerAppearance(frame, context.report, layerPath);
  context.stackCount += 1;

  const children: MosaicPaywallV03Node[] = [];
  for (const child of orderedChildren) {
    const mapped = mapNode(child, context, `${layerPath}/${child.name}`);
    if (mapped) children.push(mapped);
  }

  const stack: MosaicPaywallV03Stack = {
    type: "stack",
    id,
    direction: frame.layoutMode === "horizontal" ? "horizontal" : "vertical",
    // Figma's auto spacing is `SPACE_BETWEEN`, where itemSpacing is not the
    // rendered gap. Distribution carries the intent and the gap goes to zero.
    gap: spaceBetween || absolute ? 0 : clampLogicalSize(frame.itemSpacing),
    padding: absolute ? ZERO_INSETS : toEdgeInsets(frame),
    mainAxisDistribution: absolute ? "start" : mainAxisDistribution(frame),
    crossAxisAlignment: absolute
      ? "stretch"
      : crossAxisAlignment(frame, context.report, layerPath),
    children,
  };
  return appearance ? { ...stack, appearance } : stack;
}

function mapNode(
  node: IntermediateNode,
  context: MapContext,
  layerPath: string,
): MosaicPaywallV03Node | null {
  if (!node.visible) {
    context.report.skip(
      "hidden",
      layerPath,
      node.kind === "frame" || node.kind === "unsupported"
        ? node.figmaType
        : "TEXT",
      "The layer is hidden in Figma and was skipped.",
    );
    return null;
  }
  if (node.kind === "text") return mapText(node, context, layerPath);
  if (node.kind === "unsupported") {
    context.report.skip(
      node.reason,
      layerPath,
      node.figmaType,
      node.reason === "image"
        ? "skipped: image/vector -- re-add in Studio, which uploads the asset."
        : node.reason === "vector"
          ? "skipped: image/vector -- re-add in Studio as an image or icon."
          : `skipped: ${node.figmaType} has no protocol equivalent.`,
    );
    return null;
  }
  return mapFrame(node, context, layerPath);
}

/**
 * The stack a scroll container is allowed to hold.
 *
 * The semantic validator requires a screen's root content to be a *vertical*
 * stack with at least one child. A frame that is neither -- a horizontal
 * top-level auto-layout, or one whose every child was skipped -- is wrapped
 * rather than rewritten, so the original frame's own direction and padding
 * survive one level down.
 */
function rootContent(
  mapped: MosaicPaywallV03Stack,
  context: MapContext,
  layerPath: string,
): MosaicPaywallV03Stack {
  if (mapped.direction === "vertical" && mapped.children.length > 0) {
    return mapped;
  }
  context.report.warn(
    "layout.rootWrapped",
    layerPath,
    mapped.children.length === 0
      ? "A screen needs a root vertical stack with at least one child, so the empty frame was wrapped."
      : "A screen's root must be a vertical stack, so the horizontal frame was wrapped in one.",
  );
  context.stackCount += 1;
  return {
    type: "stack",
    id: context.ids.allocate("imported-root"),
    direction: "vertical",
    gap: 0,
    padding: ZERO_INSETS,
    mainAxisDistribution: "start",
    crossAxisAlignment: "stretch",
    children: [mapped],
  };
}

/**
 * Maps a serialised Figma frame into a Mosaic Paywall Protocol 0.3 document.
 *
 * One frame in, one screen out. The mapping is lossy and one-way: what could
 * not cross is in the report, not in the document.
 */
export function mapDocument(
  root: IntermediateFrame,
  options: MapOptions = {},
): MapResult {
  const report = new ReportBuilder();
  const context: MapContext = {
    ids: identifierAllocator(),
    keys: localizationKeyAllocator(),
    strings: {},
    report,
    stackCount: 0,
    textCount: 0,
  };

  // Reserved first so no layer can take them: the scroll container is not a
  // layer and would otherwise lose a name collision to one.
  const scrollId = context.ids.allocate("imported-scroll");
  const documentId = slugifyIdentifier(
    options.documentId ?? root.name,
    "imported-paywall",
  );

  const screenLabel = localize(
    context,
    "screen",
    root.name.trim().length > 0 ? root.name : "Imported paywall",
    "screen",
  );
  const content = rootContent(mapFrame(root, context, root.name), context, root.name);

  const document: MosaicPaywallV03Document = {
    schemaVersion: "0.3",
    id: documentId,
    revision: 1,
    // Filled in below, once the tree that determines it exists.
    compatibility: { requiredCapabilities: [] },
    localization: {
      defaultLocale: "en",
      fallbackLocale: "en",
      locales: {
        en: { direction: "ltr", strings: context.strings },
      },
    },
    designSystem: { colors: [], backgrounds: [], shadows: [] },
    assets: [],
    products: [],
    initialScreenId: SCREEN_ID,
    screens: [
      {
        id: SCREEN_ID,
        accessibilityLabel: screenLabel,
        presentation: { type: "screen" },
        layout: {
          type: "scrollContainer",
          id: scrollId,
          axis: "vertical",
          safeArea: "respect",
          showsIndicators: false,
          content,
        },
      },
    ],
  };
  const withCapabilities: MosaicPaywallV03Document = {
    ...document,
    compatibility: { requiredCapabilities: deriveRequiredCapabilities(document) },
  };

  return {
    document: withCapabilities,
    report: {
      documentId,
      rootLayerName: root.name,
      // The scroll container is a protocol node too, and the renderer walks it.
      mappedNodeCount: 1 + context.stackCount + context.textCount,
      stackCount: context.stackCount,
      textCount: context.textCount,
      localizedStringCount: Object.keys(context.strings).length,
      warnings: report.warnings,
      skipped: report.skipped,
    },
  };
}
