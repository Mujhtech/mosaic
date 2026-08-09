import type {
  MosaicPaywallV03BoxAppearance,
  MosaicPaywallV03BoxSizing,
  MosaicPaywallV03ButtonComponent,
  MosaicPaywallV03ContainerAppearance,
  MosaicPaywallV03Document,
  MosaicPaywallV03EdgeInsets,
  MosaicPaywallV03Node,
  MosaicPaywallV03Screen,
  MosaicPaywallV03Stack,
  MosaicPaywallV03TextComponent,
} from "../../../../protocol/browser/index.js";
import { deriveRequiredCapabilities } from "./capabilities.js";
import { hasVisibleUnsupportedPaint, solidFillColor } from "./color.js";
import {
  containsDetectableButton,
  detectProductCardGroups,
  detectsAsButton,
  soleTextChild,
} from "./detect.js";
import {
  identifierAllocator,
  localizationKeyAllocator,
  slugifyIdentifier,
  slugifyKeySegment,
  type NameAllocator,
} from "./identifiers.js";
import type {
  IntermediateBounds,
  IntermediateFrame,
  IntermediateNode,
  IntermediateShape,
  IntermediateText,
} from "./intermediate.js";
import {
  clusterRows,
  horizontalExtent,
  inferAlignment,
  inferGap,
  inferPadding,
  unionExtent,
  verticalExtent,
  type Extent,
} from "./layout-inference.js";
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

/** `#/$defs/positiveLogicalSize` is exclusive of zero, so a fixed size needs a floor. */
const MIN_POSITIVE_LOGICAL_SIZE = 0.01;

/** The screen id a single-frame export produces, unchanged since 0.1. */
const SINGLE_SCREEN_ID = "imported";

/** Namespace for every localization key this plugin mints. */
const KEY_NAMESPACE = "figma";

/** A child covering this much of its parent is the parent's background. */
const BACKGROUND_SPAN_RATIO = 0.9;

/** A shape this wide relative to the content box gets `fill` rather than a fixed width. */
const FILL_SPAN_RATIO = 0.9;

/**
 * Where an image layer would have sat, had the protocol been able to carry it.
 *
 * The document itself never references these -- an asset needs a bundled or
 * remote source the plugin cannot produce. The export bundle carries the
 * rendered pixels plus this placement, so Studio can upload the asset and
 * insert the node at the position the designer drew it in.
 */
export type ImagePlacement = {
  /** Unique identifier-grammar id, derived from the layer name. */
  readonly assetId: string;
  readonly figmaId: string;
  readonly name: string;
  readonly layerPath: string;
  readonly screenId: string;
  readonly parentStackId: string;
  readonly childIndex: number;
};

export type MapResult = {
  readonly document: MosaicPaywallV03Document;
  readonly report: ExportReport;
  readonly imagePlacements: readonly ImagePlacement[];
};

export type MapOptions = {
  /**
   * Overrides the document id, which otherwise comes from the first frame's
   * name. The caller is responsible for passing something that slugifies.
   */
  readonly documentId?: string;
};

function clampLogicalSize(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_LOGICAL_SIZE, Math.max(0, Math.round(value * 100) / 100));
}

function clampPositiveLogicalSize(value: number): number {
  if (!Number.isFinite(value)) return MIN_POSITIVE_LOGICAL_SIZE;
  return Math.min(
    MAX_LOGICAL_SIZE,
    Math.max(MIN_POSITIVE_LOGICAL_SIZE, Math.round(value * 100) / 100),
  );
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
        frame.figmaId,
        "Baseline alignment has no protocol equivalent and was mapped to center. Set the alignment explicitly in Studio if that is wrong.",
      );
      return "center";
    default:
      return "start";
  }
}

/** A painted box, still open for a full-bleed child to merge itself into. */
type AppearanceDraft = {
  background?: { type: "color"; value: string };
  cornerRadius?: number;
};

type PaintedNode = {
  readonly figmaId: string;
  readonly opacity: number;
  readonly cornerRadius: number | null;
  readonly fills: IntermediateFrame["fills"];
};

/**
 * The painted box a node describes, plus a report entry for anything in its
 * fills that could not cross.
 *
 * `ownerId` is the stack a dropped image fill would be inserted into, or null
 * when there is nowhere valid to put one -- inside a button, where the
 * protocol forbids anything but passive content.
 */
function appearanceDraft(
  node: PaintedNode,
  context: MapContext,
  layerPath: string,
  ownerId: string | null,
): AppearanceDraft {
  const draft: AppearanceDraft = {};
  const background = solidFillColor(node.fills, node.opacity);
  if (background) {
    draft.background = { type: "color", value: background };
  }
  if (hasVisibleUnsupportedPaint(node.fills)) {
    context.report.warn(
      "style.unsupportedFill",
      layerPath,
      node.figmaId,
      "An image or gradient fill was dropped. Download the Studio bundle to keep the rendered pixels, or re-add the fill in Studio.",
    );
    const pixels = node.fills.some(
      (fill) =>
        fill.visible && fill.type === "unsupported" && isPixelPaint(fill.paintType),
    );
    if (pixels && ownerId !== null) {
      notePlacement(context, {
        figmaId: node.figmaId,
        name: layerPath.split("/").at(-1) ?? "image",
        layerPath,
        parentStackId: ownerId,
        childIndex: 0,
      });
    }
  }
  if (node.cornerRadius === null) {
    context.report.warn(
      "style.mixedCornerRadius",
      layerPath,
      node.figmaId,
      "Per-corner radii have no protocol equivalent and were dropped; set one radius in Studio.",
    );
  } else if (node.cornerRadius > 0) {
    draft.cornerRadius = clampLogicalSize(node.cornerRadius);
  }
  return draft;
}

/** Paints whose content the bundle can render to PNG. */
function isPixelPaint(paintType: string): boolean {
  return paintType === "IMAGE" || paintType === "VIDEO";
}

/**
 * `containerAppearance` and `boxAppearance` both have minProperties 1: an empty
 * object is invalid, so the field is omitted rather than emitted bare.
 */
function sealContainerAppearance(
  draft: AppearanceDraft,
): MosaicPaywallV03ContainerAppearance | null {
  return Object.keys(draft).length > 0
    ? (draft as MosaicPaywallV03ContainerAppearance)
    : null;
}

function sealBoxAppearance(
  draft: AppearanceDraft & { padding?: MosaicPaywallV03EdgeInsets },
): MosaicPaywallV03BoxAppearance | null {
  return Object.keys(draft).length > 0
    ? (draft as MosaicPaywallV03BoxAppearance)
    : null;
}

type PendingPlacement = {
  readonly figmaId: string;
  readonly name: string;
  readonly layerPath: string;
  readonly childIndex: number;
};

/**
 * A protocol container under construction.
 *
 * It holds the emitted children *and* the image placements recorded while they
 * were being emitted. Placements cannot be finalised inline because a synthetic
 * row does not know its own id until its children reveal whether it needs one.
 */
class ContainerBuilder {
  readonly nodes: MosaicPaywallV03Node[] = [];
  readonly pending: PendingPlacement[] = [];

  /** Records the slot a layer would have filled, before it is skipped. */
  note(figmaId: string, name: string, layerPath: string): void {
    this.pending.push({
      figmaId,
      name,
      layerPath,
      childIndex: this.nodes.length,
    });
  }

  add(node: MosaicPaywallV03Node): void {
    this.nodes.push(node);
  }
}

type MapContext = {
  readonly ids: NameAllocator;
  readonly keys: NameAllocator;
  readonly assetIds: NameAllocator;
  readonly strings: Record<string, string>;
  readonly report: ReportBuilder;
  readonly placements: ImagePlacement[];
  /** The screen currently being mapped. */
  screenId: string;
  /** The localization-key prefix for that screen. */
  keyPrefix: string;
  stackCount: number;
  textCount: number;
  buttonCount: number;
  /** Ids of the buttons emitted on the screen being mapped, in document order. */
  buttonIds: string[];
};

function notePlacement(
  context: MapContext,
  entry: {
    readonly figmaId: string;
    readonly name: string;
    readonly layerPath: string;
    readonly parentStackId: string;
    readonly childIndex: number;
  },
): void {
  context.placements.push({
    assetId: context.assetIds.allocate(
      slugifyIdentifier(entry.name, "image"),
    ),
    figmaId: entry.figmaId,
    name: entry.name,
    layerPath: entry.layerPath,
    screenId: context.screenId,
    parentStackId: entry.parentStackId,
    childIndex: entry.childIndex,
  });
}

/** Hands every placement recorded for a container the container's own id. */
function sealPlacements(
  context: MapContext,
  container: { readonly pending: readonly PendingPlacement[] },
  containerId: string,
): void {
  for (const pending of container.pending) {
    notePlacement(context, { ...pending, parentStackId: containerId });
  }
}

function allocateId(context: MapContext, name: string, fallback: string): string {
  return context.ids.allocate(slugifyIdentifier(name, fallback));
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
  const key = context.keys.allocate(`${context.keyPrefix}.${segment}`);
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
      node.figmaId,
      "TEXT",
      "The text layer is empty and was skipped. Delete it in Figma, or give it content and re-export.",
    );
    return null;
  }
  if (node.mixedStyling) {
    context.report.warn(
      "text.mixedStyling",
      layerPath,
      node.figmaId,
      "The layer styles its characters differently; the first character's font was used for the whole layer. Split it into one layer per style for an exact export.",
    );
  }
  if (node.fontSize === null) {
    context.report.warn(
      "text.mixedFontSize",
      layerPath,
      node.figmaId,
      "No single font size could be read; 16 was used. Set the size in Studio.",
    );
  }
  if (node.fontWeight === null && node.fontStyleName === null) {
    context.report.warn(
      "text.mixedFontWeight",
      layerPath,
      node.figmaId,
      "No single font weight could be read; regular was used. Set the weight in Studio.",
    );
  }
  if (node.textAlign === "justified") {
    context.report.warn(
      "text.justifiedAlignment",
      layerPath,
      node.figmaId,
      "Justified alignment has no protocol equivalent and was mapped to start.",
    );
  }
  if (hasVisibleUnsupportedPaint(node.fills)) {
    context.report.warn(
      "style.unsupportedFill",
      layerPath,
      node.figmaId,
      "An image or gradient text fill was dropped; a solid colour was used. Set the colour in Studio.",
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
 * The fallback for a frame whose children report no bounding box, where row
 * clustering has nothing to measure. Top-to-bottom, then left-to-right for
 * ties, which is how a person reads the frame.
 */
export function orderAbsoluteChildren(
  children: readonly IntermediateNode[],
): readonly IntermediateNode[] {
  return [...children].sort((left, right) => {
    if (left.y !== right.y) return left.y - right.y;
    return left.x - right.x;
  });
}

/** The parent a child may merge its background into. */
type ParentSlot = {
  readonly frame: IntermediateFrame;
  readonly appearance: AppearanceDraft;
} | null;

function spansParent(
  child: IntermediateBounds,
  parent: IntermediateBounds,
): boolean {
  return (
    parent.width > 0 &&
    parent.height > 0 &&
    child.width >= parent.width * BACKGROUND_SPAN_RATIO &&
    child.height >= parent.height * BACKGROUND_SPAN_RATIO
  );
}

/**
 * A childless painted shape.
 *
 * The protocol has no rectangle, but `#/$defs/stack` allows `children: []` and
 * the semantic validator only requires a *screen root* to be non-empty, so an
 * empty stack carrying a background and an explicit size is a schema-valid
 * colour block. Two cases avoid one entirely:
 *
 * - A shape that covers its parent is that parent's background, and merging it
 *   is both smaller and more faithful than nesting a full-bleed sibling.
 * - A shape with no usable box cannot be sized, and an empty stack with no
 *   size renders as nothing at all, so it is skipped and said so.
 */
function mapShape(
  shape: IntermediateShape,
  context: MapContext,
  layerPath: string,
  parent: ParentSlot,
): MosaicPaywallV03Stack | null {
  const colour = solidFillColor(shape.fills, shape.opacity);
  if (!colour) {
    context.report.skip(
      "unmeasurable",
      layerPath,
      shape.figmaId,
      shape.figmaType,
      "The shape has no visible solid fill, so there was nothing to carry across.",
    );
    return null;
  }

  if (
    parent &&
    shape.bounds &&
    parent.frame.bounds &&
    parent.appearance.background === undefined &&
    spansParent(shape.bounds, parent.frame.bounds)
  ) {
    parent.appearance.background = { type: "color", value: colour };
    context.report.warn(
      "style.backgroundMerged",
      layerPath,
      shape.figmaId,
      "The shape covers its parent, so it became the parent's background instead of a nested box.",
    );
    return null;
  }

  if (!shape.bounds || shape.bounds.width <= 0 || shape.bounds.height <= 0) {
    context.report.skip(
      "unmeasurable",
      layerPath,
      shape.figmaId,
      shape.figmaType,
      "Figma reported no usable size for the shape. The protocol has no rectangle, so a colour block needs an explicit width and height, and an unsized empty stack renders as nothing.",
    );
    return null;
  }

  const id = allocateId(context, shape.name, "block");
  const draft = appearanceDraft(shape, context, layerPath, id);
  if (shape.figmaType === "ELLIPSE") {
    // A rounded rectangle is the closest the protocol gets. A circle survives
    // exactly; a wide ellipse becomes a pill, which is worth saying out loud.
    draft.cornerRadius = clampLogicalSize(
      Math.min(shape.bounds.width, shape.bounds.height) / 2,
    );
    context.report.warn(
      "style.shapeApproximated",
      layerPath,
      shape.figmaId,
      "An ellipse was approximated with a rounded rectangle; only a circle survives exactly.",
    );
  }

  const parentBounds = parent?.frame.bounds ?? null;
  const spansWidth =
    parentBounds !== null &&
    parentBounds.width > 0 &&
    shape.bounds.width >= parentBounds.width * FILL_SPAN_RATIO;
  const sizing: MosaicPaywallV03BoxSizing = {
    width: spansWidth
      ? "fill"
      : { mode: "fixed", value: clampPositiveLogicalSize(shape.bounds.width) },
    height: {
      mode: "fixed",
      value: clampPositiveLogicalSize(shape.bounds.height),
    },
  };

  context.stackCount += 1;
  const appearance = sealContainerAppearance(draft);
  const stack: MosaicPaywallV03Stack = {
    type: "stack",
    id,
    direction: "vertical",
    gap: 0,
    padding: ZERO_INSETS,
    mainAxisDistribution: "start",
    crossAxisAlignment: "stretch",
    children: [],
    sizing,
  };
  return appearance ? { ...stack, appearance } : stack;
}

/**
 * Maps one child into `builder`, or records why it could not cross.
 *
 * Returns true when the child produced a node, which is what the layout
 * inference measures: a row whose every member was skipped is not a row.
 */
function mapChild(
  node: IntermediateNode,
  context: MapContext,
  layerPath: string,
  builder: ContainerBuilder,
  parent: ParentSlot,
): boolean {
  if (!node.visible) {
    context.report.skip(
      "hidden",
      layerPath,
      node.figmaId,
      node.kind === "text" ? "TEXT" : node.figmaType,
      "The layer is hidden in Figma and was skipped. Show it and re-export if it belongs in the paywall.",
    );
    return false;
  }
  if (node.kind === "text") {
    const mapped = mapText(node, context, layerPath);
    if (!mapped) return false;
    builder.add(mapped);
    return true;
  }
  if (node.kind === "shape") {
    const mapped = mapShape(node, context, layerPath, parent);
    if (!mapped) return false;
    builder.add(mapped);
    return true;
  }
  if (node.kind === "unsupported") {
    if (node.reason === "image" || node.reason === "vector") {
      builder.note(node.figmaId, node.name, layerPath);
      context.report.skip(
        node.reason,
        layerPath,
        node.figmaId,
        node.figmaType,
        "Skipped: the protocol needs an uploaded asset. Download the Studio bundle to carry its pixels, or re-add it in Studio.",
      );
      return false;
    }
    context.report.skip(
      node.reason,
      layerPath,
      node.figmaId,
      node.figmaType,
      `Skipped: ${node.figmaType} has no protocol equivalent. Rebuild it from frames and text if it matters.`,
    );
    return false;
  }
  builder.add(mapFrame(node, context, layerPath));
  return true;
}

function reportProductCardCandidates(
  frame: IntermediateFrame,
  context: MapContext,
  layerPath: string,
): void {
  const cards = detectProductCardGroups(frame);
  if (cards.length === 0) return;
  const paths = cards.map((card) => `${layerPath}/${card.name}`).join(", ");
  context.report.warn(
    "component.productCardCandidate",
    layerPath,
    frame.figmaId,
    `These look like plan cards -- consider converting them to a product selector in Studio: ${paths}. They were exported as plain stacks because a product selector needs store product identifiers the plugin cannot know.`,
  );
}

/**
 * A frame detected as a button.
 *
 * `#/$defs/buttonComponent` requires an action, and the plugin has no way to
 * know which one: a purchase needs a product selector to bind to, a navigation
 * needs a target screen. `close` is the only member of `#/$defs/buttonAction`
 * with no field to invent, so it is the placeholder, and the report says so
 * for every button.
 *
 * Note the button carries no `padding` field -- the schema has none. Auto-layout
 * padding goes to `appearance.padding`, which `#/$defs/boxAppearance` does have.
 */
function mapButton(
  frame: IntermediateFrame,
  child: IntermediateText,
  context: MapContext,
  layerPath: string,
  id: string,
): MosaicPaywallV03Node {
  // A button's fill can hold no dropped image: `semantic.layout` forbids
  // anything interactive inside button content, and Studio has no valid slot
  // to insert an image node into, so no placement is recorded.
  const draft = appearanceDraft(frame, context, layerPath, null);
  const label = mapText(child, context, `${layerPath}/${child.name}`);
  if (!label) {
    // Unreachable: `soleTextChild` rejects exactly the blank layers `mapText`
    // skips. A button with no children is invalid, so this degrades to the
    // empty stack rather than re-mapping the child and reporting it twice.
    context.stackCount += 1;
    const bare: MosaicPaywallV03Stack = {
      type: "stack",
      id,
      direction: "vertical",
      gap: 0,
      padding: ZERO_INSETS,
      mainAxisDistribution: "start",
      crossAxisAlignment: "stretch",
      children: [],
    };
    const appearance = sealContainerAppearance(draft);
    return appearance ? { ...bare, appearance } : bare;
  }

  const padding = frame.layoutMode === "none" ? ZERO_INSETS : toEdgeInsets(frame);
  const padded =
    padding.top > 0 || padding.start > 0 || padding.bottom > 0 || padding.end > 0;
  const appearance = sealBoxAppearance(padded ? { ...draft, padding } : draft);

  context.buttonCount += 1;
  context.buttonIds.push(id);
  context.report.warn(
    "component.buttonDetected",
    layerPath,
    frame.figmaId,
    "Detected as button with placeholder action -- set the real action in Studio.",
  );

  const button: MosaicPaywallV03ButtonComponent = {
    type: "button",
    id,
    direction: frame.layoutMode === "horizontal" ? "horizontal" : "vertical",
    gap: 0,
    mainAxisDistribution: "center",
    crossAxisAlignment: "center",
    children: [label],
    action: { type: "close" },
    // The label doubles as the control's accessible name. Referencing the same
    // localization key twice is fine -- the validator checks that every key is
    // referenced at least once, not exactly once -- and it avoids a second
    // catalog entry with identical content.
    accessibility: { label: label.value },
  };
  return appearance ? { ...button, appearance } : button;
}

type RowResult = {
  readonly nodes: readonly MosaicPaywallV03Node[];
  readonly pending: readonly PendingPlacement[];
  /** Bounds of the children that actually produced a node, in row order. */
  readonly bounds: readonly IntermediateBounds[];
};

/**
 * A frame without auto-layout, reconstructed from its children's geometry.
 *
 * Children are clustered into visual rows, each row of two or more becomes a
 * horizontal sub-stack, and the gaps, padding, and alignments are read back out
 * of the bounding boxes. This is the difference between an export that looks
 * like the design and the all-zero spacing a naive flatten produces.
 */
function mapInferredStack(
  frame: IntermediateFrame,
  context: MapContext,
  layerPath: string,
  id: string,
  draft: AppearanceDraft,
  frameBounds: IntermediateBounds,
): MosaicPaywallV03Stack {
  context.report.warn(
    "layout.absoluteFlattened",
    layerPath,
    frame.figmaId,
    `${frame.name} has no auto-layout -- spacing, padding, and alignment were inferred from layer positions. For an exact export select it in Figma and press Shift+A, then re-export.`,
  );

  const parent: ParentSlot = { frame, appearance: draft };
  const clustered = clusterRows(
    frame.children,
    (child) => child.bounds as IntermediateBounds,
  );

  // Pass one maps every row without deciding what it becomes: a row's own id
  // depends on how many of its children survived, which is only known here.
  const rows: RowResult[] = clustered.map((row) => {
    const rowBuilder = new ContainerBuilder();
    const bounds: IntermediateBounds[] = [];
    for (const child of row) {
      if (mapChild(child, context, `${layerPath}/${child.name}`, rowBuilder, parent)) {
        bounds.push(child.bounds as IntermediateBounds);
      }
    }
    return { nodes: rowBuilder.nodes, pending: rowBuilder.pending, bounds };
  });

  const surviving = rows.filter((row) => row.nodes.length > 0);
  const allBounds = surviving.flatMap((row) => [...row.bounds]);
  const padding = inferPadding(frameBounds, allBounds);
  const content: Extent = {
    start: frameBounds.x + padding.start,
    end: frameBounds.x + frameBounds.width - padding.end,
  };
  const rowVertical = surviving.map((row) =>
    unionExtent(row.bounds.map(verticalExtent)),
  );
  const rowHorizontal = surviving.map((row) =>
    unionExtent(row.bounds.map(horizontalExtent)),
  );

  // Pass two turns each row into a child, now that the container's own content
  // box -- and therefore every alignment inside it -- is known.
  const builder = new ContainerBuilder();
  for (const row of rows) {
    if (row.nodes.length === 0) {
      // Nothing survived, but a dropped image still belongs somewhere: the
      // frame itself, at the slot the row would have occupied.
      for (const pending of row.pending) {
        builder.pending.push({ ...pending, childIndex: builder.nodes.length });
      }
      continue;
    }
    if (row.nodes.length === 1) {
      const index = builder.nodes.length;
      for (const pending of row.pending) {
        builder.pending.push({
          ...pending,
          childIndex: pending.childIndex > 0 ? index + 1 : index,
        });
      }
      builder.add(row.nodes[0] as MosaicPaywallV03Node);
      continue;
    }
    builder.add(buildRowStack(row, context, frame, content));
  }

  sealPlacements(context, builder, id);
  const appearance = sealContainerAppearance(draft);
  const stack: MosaicPaywallV03Stack = {
    type: "stack",
    id,
    direction: "vertical",
    gap: clampLogicalSize(inferGap(rowVertical)),
    padding: {
      top: clampLogicalSize(padding.top),
      start: clampLogicalSize(padding.start),
      bottom: clampLogicalSize(padding.bottom),
      end: clampLogicalSize(padding.end),
    },
    mainAxisDistribution: "start",
    crossAxisAlignment: inferAlignment(rowHorizontal, content),
    children: builder.nodes,
  };
  return appearance ? { ...stack, appearance } : stack;
}

/** A synthetic horizontal stack for one inferred row. */
function buildRowStack(
  row: RowResult,
  context: MapContext,
  frame: IntermediateFrame,
  content: Extent,
): MosaicPaywallV03Stack {
  const id = context.ids.allocate(
    slugifyIdentifier(`${frame.name} row`, "row"),
  );
  sealPlacements(context, row, id);

  const horizontal = row.bounds.map(horizontalExtent);
  const vertical = row.bounds.map(verticalExtent);
  const rowExtent = unionExtent(horizontal);
  // The parent stack has one padding value for every row, so a row that is
  // narrower than the content box carries its own horizontal placement.
  const placement = inferAlignment([rowExtent], content);
  context.stackCount += 1;
  return {
    type: "stack",
    id,
    direction: "horizontal",
    gap: clampLogicalSize(inferGap(horizontal)),
    padding: ZERO_INSETS,
    mainAxisDistribution:
      placement === "center" ? "center" : placement === "end" ? "end" : "start",
    crossAxisAlignment: inferAlignment(vertical, unionExtent(vertical)),
    children: [...row.nodes],
  };
}

/** The pre-inference fallback: reading order, no spacing, and an explanation. */
function mapFlattenedStack(
  frame: IntermediateFrame,
  context: MapContext,
  layerPath: string,
  id: string,
  draft: AppearanceDraft,
): MosaicPaywallV03Stack {
  context.report.warn(
    "layout.absoluteFlattened",
    layerPath,
    frame.figmaId,
    `${frame.name} has no auto-layout and Figma reported no bounding box for its children, so spacing could not be inferred and the children were stacked in reading order. Select it in Figma and press Shift+A, then re-export.`,
  );
  const builder = new ContainerBuilder();
  const parent: ParentSlot = { frame, appearance: draft };
  for (const child of orderAbsoluteChildren(frame.children)) {
    mapChild(child, context, `${layerPath}/${child.name}`, builder, parent);
  }
  sealPlacements(context, builder, id);
  const appearance = sealContainerAppearance(draft);
  const stack: MosaicPaywallV03Stack = {
    type: "stack",
    id,
    direction: "vertical",
    gap: 0,
    padding: ZERO_INSETS,
    mainAxisDistribution: "start",
    crossAxisAlignment: "stretch",
    children: builder.nodes,
  };
  return appearance ? { ...stack, appearance } : stack;
}

function mapAutoLayoutStack(
  frame: IntermediateFrame,
  context: MapContext,
  layerPath: string,
  id: string,
  draft: AppearanceDraft,
): MosaicPaywallV03Stack {
  const builder = new ContainerBuilder();
  const parent: ParentSlot = { frame, appearance: draft };
  for (const child of frame.children) {
    mapChild(child, context, `${layerPath}/${child.name}`, builder, parent);
  }
  sealPlacements(context, builder, id);

  const spaceBetween = frame.primaryAxisAlignItems === "spaceBetween";
  const appearance = sealContainerAppearance(draft);
  const stack: MosaicPaywallV03Stack = {
    type: "stack",
    id,
    direction: frame.layoutMode === "horizontal" ? "horizontal" : "vertical",
    // Figma's auto spacing is `SPACE_BETWEEN`, where itemSpacing is not the
    // rendered gap. Distribution carries the intent and the gap goes to zero.
    gap: spaceBetween ? 0 : clampLogicalSize(frame.itemSpacing),
    padding: toEdgeInsets(frame),
    mainAxisDistribution: mainAxisDistribution(frame),
    crossAxisAlignment: crossAxisAlignment(frame, context.report, layerPath),
    children: builder.nodes,
  };
  return appearance ? { ...stack, appearance } : stack;
}

function mapFrame(
  frame: IntermediateFrame,
  context: MapContext,
  layerPath: string,
): MosaicPaywallV03Node {
  // The id is allocated before the children so a parent keeps the name it
  // shares with a child, rather than being pushed to "-2".
  const id = allocateId(context, frame.name, "group");

  const label = detectsAsButton(frame) ? soleTextChild(frame) : null;
  if (label) return mapButton(frame, label, context, layerPath, id);

  reportProductCardCandidates(frame, context, layerPath);
  const draft = appearanceDraft(frame, context, layerPath, id);
  context.stackCount += 1;

  if (frame.layoutMode !== "none") {
    return mapAutoLayoutStack(frame, context, layerPath, id, draft);
  }
  const measurable =
    frame.bounds !== null &&
    frame.children.every((child) => child.bounds !== null);
  if (!measurable) {
    return mapFlattenedStack(frame, context, layerPath, id, draft);
  }
  return mapInferredStack(
    frame,
    context,
    layerPath,
    id,
    draft,
    frame.bounds as IntermediateBounds,
  );
}

/**
 * The stack a scroll container is allowed to hold.
 *
 * The semantic validator requires a screen's root content to be a *vertical*
 * stack with at least one child. A frame that is neither -- a horizontal
 * top-level auto-layout, one detected as a button, or one whose every child was
 * skipped -- is wrapped rather than rewritten, so the original frame's own
 * direction and padding survive one level down.
 */
function rootContent(
  mapped: MosaicPaywallV03Node,
  context: MapContext,
  layerPath: string,
  figmaId: string,
  wrapperId: string,
): MosaicPaywallV03Stack {
  if (
    mapped.type === "stack" &&
    mapped.direction === "vertical" &&
    mapped.children.length > 0
  ) {
    return mapped;
  }
  context.report.warn(
    "layout.rootWrapped",
    layerPath,
    figmaId,
    mapped.type !== "stack"
      ? "A screen's root must be a vertical stack, so the detected button was wrapped in one."
      : mapped.children.length === 0
        ? "A screen needs a root vertical stack with at least one child, so the empty frame was wrapped."
        : "A screen's root must be a vertical stack, so the horizontal frame was wrapped in one.",
  );
  context.stackCount += 1;
  return {
    type: "stack",
    id: context.ids.allocate(wrapperId),
    direction: "vertical",
    gap: 0,
    padding: ZERO_INSETS,
    mainAxisDistribution: "start",
    crossAxisAlignment: "stretch",
    children: [mapped],
  };
}

/**
 * Repoints one button's placeholder action at the next screen.
 *
 * The protocol requires every screen to be reachable from the initial one, and
 * `navigateTo` on a button is the only edge that exists. Rebuilt rather than
 * mutated so the emitted tree stays a value.
 */
function withNavigation(
  node: MosaicPaywallV03Node,
  buttonId: string,
  screenId: string,
): MosaicPaywallV03Node {
  if (node.type === "button") {
    return node.id === buttonId
      ? { ...node, action: { type: "navigateTo", screenId } }
      : node;
  }
  if (node.type !== "stack") return node;
  return {
    ...node,
    children: node.children.map((child) =>
      withNavigation(child, buttonId, screenId),
    ),
  };
}

function mapScreen(
  root: IntermediateFrame,
  context: MapContext,
  screenId: string,
  keyPrefix: string,
): MosaicPaywallV03Screen {
  context.screenId = screenId;
  context.keyPrefix = keyPrefix;
  context.buttonIds = [];

  // Reserved first so no layer can take them: the scroll container is not a
  // layer and would otherwise lose a name collision to one.
  const scrollId = context.ids.allocate(`${screenId}-scroll`);
  const wrapperId = `${screenId}-root`;

  const screenLabel = localize(
    context,
    "screen",
    root.name.trim().length > 0 ? root.name : "Imported paywall",
    "screen",
  );
  const content = rootContent(
    mapFrame(root, context, root.name),
    context,
    root.name,
    root.figmaId,
    wrapperId,
  );

  return {
    id: screenId,
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
  };
}

/**
 * Canvas reading order for a multi-frame selection: left to right, then top to
 * bottom. Artboards on a Figma canvas are laid out in a row far more often than
 * in a column, so x leads.
 */
function orderRoots(
  roots: readonly IntermediateFrame[],
): readonly IntermediateFrame[] {
  return [...roots].sort((left, right) => {
    const a = left.bounds ?? { x: left.x, y: left.y };
    const b = right.bounds ?? { x: right.x, y: right.y };
    if (a.x !== b.x) return a.x - b.x;
    return a.y - b.y;
  });
}

/**
 * Maps one or more serialised Figma frames into a Mosaic Paywall Protocol 0.3
 * document.
 *
 * One frame in, one screen out, and the frames' canvas order becomes the
 * screens' order. The mapping is lossy and one-way: what could not cross is in
 * the report, not in the document.
 */
export function mapDocument(
  roots: IntermediateFrame | readonly IntermediateFrame[],
  options: MapOptions = {},
): MapResult {
  const selection = Array.isArray(roots)
    ? (roots as readonly IntermediateFrame[])
    : [roots as IntermediateFrame];
  if (selection.length === 0) {
    throw new Error("mapDocument needs at least one frame.");
  }
  const report = new ReportBuilder();

  // A screen the protocol cannot reach is a screen the protocol rejects, and
  // the only edge a plugin can draw honestly is repointing a detected button's
  // placeholder action. So the flow runs as far as the buttons carry it, and
  // the frames past that point are reported rather than exported into an
  // invalid document.
  const canvasOrder = orderRoots(selection);
  let reach = 1;
  while (
    reach < canvasOrder.length &&
    containsDetectableButton(canvasOrder[reach - 1] as IntermediateFrame)
  ) {
    reach += 1;
  }
  const ordered = canvasOrder.slice(0, reach);
  const stopped = canvasOrder[reach - 1] as IntermediateFrame;
  for (const dropped of canvasOrder.slice(reach)) {
    report.skip(
      "unreachable",
      dropped.name,
      dropped.figmaId,
      dropped.figmaType,
      `Every screen must be reachable from the first one, and the flow stops at "${stopped.name}", which has no button to navigate from. Give that frame a button, or export this frame on its own.`,
    );
  }
  const single = ordered.length === 1;

  const context: MapContext = {
    ids: identifierAllocator(),
    keys: localizationKeyAllocator(),
    assetIds: identifierAllocator(),
    strings: {},
    report,
    placements: [],
    screenId: SINGLE_SCREEN_ID,
    keyPrefix: KEY_NAMESPACE,
    stackCount: 0,
    textCount: 0,
    buttonCount: 0,
    buttonIds: [],
  };

  // Screen ids live in their own namespace -- the validator checks them against
  // each other, not against node ids -- so they get their own allocator and a
  // single-frame export keeps the `imported` id it has always had.
  const screenIds = identifierAllocator();
  const mapped = ordered.map((root, index) => {
    const screenId = single
      ? screenIds.allocate(SINGLE_SCREEN_ID)
      : screenIds.allocate(slugifyIdentifier(root.name, `screen-${index + 1}`));
    // Keys are namespaced per screen so two frames with a "Title" layer cannot
    // collide. Screen ids never contain an underscore, so the derived segments
    // stay as distinct as the ids they come from.
    const keyPrefix = single
      ? KEY_NAMESPACE
      : `${KEY_NAMESPACE}.${slugifyKeySegment(screenId, `screen_${index + 1}`)}`;
    const screen = mapScreen(root, context, screenId, keyPrefix);
    return { screen, buttonIds: [...context.buttonIds] };
  });

  // The primary call to action is the last one down the screen, so that is the
  // button the flow is threaded through.
  const screens = mapped.map(({ screen, buttonIds }, index): MosaicPaywallV03Screen => {
    const next = mapped[index + 1]?.screen;
    const buttonId = buttonIds.at(-1);
    if (!next || !buttonId) return screen;
    context.report.warn(
      "navigation.threaded",
      (ordered[index] as IntermediateFrame).name,
      (ordered[index] as IntermediateFrame).figmaId,
      `Button ${buttonId} was pointed at the "${next.id}" screen, because every screen must be reachable from the first one. Set the real action in Studio.`,
    );
    return {
      ...screen,
      layout: {
        ...screen.layout,
        content: withNavigation(
          screen.layout.content,
          buttonId,
          next.id,
        ) as MosaicPaywallV03Stack,
      },
    };
  });

  const documentId = slugifyIdentifier(
    options.documentId ?? (ordered[0] as IntermediateFrame).name,
    "imported-paywall",
  );

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
    initialScreenId: (screens[0] as MosaicPaywallV03Screen).id,
    screens,
  };
  const withCapabilities: MosaicPaywallV03Document = {
    ...document,
    compatibility: { requiredCapabilities: deriveRequiredCapabilities(document) },
  };

  return {
    document: withCapabilities,
    imagePlacements: context.placements,
    report: {
      documentId,
      rootLayerNames: ordered.map((root) => root.name),
      screenCount: screens.length,
      // Each scroll container is a protocol node too, and the renderer walks it.
      mappedNodeCount:
        screens.length +
        context.stackCount +
        context.textCount +
        context.buttonCount,
      stackCount: context.stackCount,
      textCount: context.textCount,
      buttonCount: context.buttonCount,
      localizedStringCount: Object.keys(context.strings).length,
      imageCount: context.placements.length,
      warnings: report.warnings,
      skipped: report.skipped,
    },
  };
}
