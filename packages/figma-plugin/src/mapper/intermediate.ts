/**
 * The plain-JSON intermediate tree.
 *
 * `src/main.ts` walks the Figma scene graph and produces exactly this shape;
 * the mapper consumes exactly this shape and never touches the Figma API. The
 * seam exists so the mapping rules -- the part that has to agree with the
 * protocol -- are unit-testable in plain Node.
 *
 * Everything here is structurally serialisable: the tree survives
 * `JSON.stringify` unchanged, which is also how it crosses the plugin's
 * main-thread/UI boundary.
 */

export type IntermediateSolidPaint = {
  readonly type: "solid";
  readonly visible: boolean;
  /** Channel values in the 0..1 range Figma reports. */
  readonly color: { readonly r: number; readonly g: number; readonly b: number };
  /** Paint alpha in 0..1. */
  readonly opacity: number;
};

/**
 * Any paint the protocol cannot express as a literal colour: image fills,
 * gradients, video fills. Kept in the tree (rather than dropped in main.ts) so
 * the mapper can report it.
 */
export type IntermediateUnsupportedPaint = {
  readonly type: "unsupported";
  readonly visible: boolean;
  /** The raw Figma paint type, for the report. */
  readonly paintType: string;
};

export type IntermediatePaint =
  | IntermediateSolidPaint
  | IntermediateUnsupportedPaint;

export type IntermediateLayoutMode = "none" | "horizontal" | "vertical";

export type IntermediatePrimaryAxisAlign =
  | "min"
  | "center"
  | "max"
  | "spaceBetween";

export type IntermediateCounterAxisAlign =
  | "min"
  | "center"
  | "max"
  | "baseline";

export type IntermediateTextAlign = "left" | "center" | "right" | "justified";

export type IntermediateLineHeight =
  | { readonly unit: "auto" }
  | { readonly unit: "pixels"; readonly value: number }
  | { readonly unit: "percent"; readonly value: number };

/**
 * A node's `absoluteBoundingBox`, in canvas coordinates.
 *
 * Absolute rather than parent-relative on purpose: a GROUP reports its
 * children's coordinates relative to the enclosing *frame*, not to the group,
 * so parent-relative numbers do not compose. Every measurement the layout
 * inference makes -- row clustering, gaps, padding -- happens in this one
 * coordinate system, and is therefore correct at any nesting depth.
 *
 * Null when Figma reports no box (a node that has never been laid out).
 */
export type IntermediateBounds = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

type IntermediateBase = {
  /** The Figma node id. Diagnostics only -- never emitted into the document. */
  readonly figmaId: string;
  readonly name: string;
  readonly visible: boolean;
  /** Node-level opacity in 0..1, multiplied into every emitted colour. */
  readonly opacity: number;
  /** Absolute-ish position, used only to order children of a non-auto-layout frame. */
  readonly x: number;
  readonly y: number;
  /** Absolute bounding box, when Figma reports one. */
  readonly bounds: IntermediateBounds | null;
};

export type IntermediateFrame = IntermediateBase & {
  readonly kind: "frame";
  /** The originating Figma node type, e.g. FRAME, COMPONENT, INSTANCE. */
  readonly figmaType: string;
  readonly layoutMode: IntermediateLayoutMode;
  readonly itemSpacing: number;
  readonly primaryAxisAlignItems: IntermediatePrimaryAxisAlign;
  readonly counterAxisAlignItems: IntermediateCounterAxisAlign;
  readonly paddingTop: number;
  readonly paddingRight: number;
  readonly paddingBottom: number;
  readonly paddingLeft: number;
  /** Null when Figma reports a mixed corner radius. */
  readonly cornerRadius: number | null;
  readonly fills: readonly IntermediatePaint[];
  readonly children: readonly IntermediateNode[];
};

export type IntermediateText = IntermediateBase & {
  readonly kind: "text";
  readonly characters: string;
  /** Null when the layer mixes sizes across ranges. */
  readonly fontSize: number | null;
  /** Numeric CSS weight when Figma reports one, else null. */
  readonly fontWeight: number | null;
  /** The font style name ("Bold", "SemiBold"), used when fontWeight is null. */
  readonly fontStyleName: string | null;
  readonly lineHeight: IntermediateLineHeight;
  readonly textAlign: IntermediateTextAlign;
  readonly fills: readonly IntermediatePaint[];
  /**
   * Figma reported non-uniform styling across the layer's characters. When
   * this is true and the size/weight fields are non-null they describe the
   * *first character* only; the rest of the layer's styling is lost.
   */
  readonly mixedStyling: boolean;
};

/**
 * A childless painted shape: a rectangle, an ellipse, or an empty frame whose
 * only content is a solid fill. These carry real visual weight -- dividers,
 * pills, colour blocks -- so they become an empty stack with a background
 * rather than being dropped.
 */
export type IntermediateShape = IntermediateBase & {
  readonly kind: "shape";
  readonly figmaType: string;
  /** Null when Figma reports a mixed corner radius. */
  readonly cornerRadius: number | null;
  readonly fills: readonly IntermediatePaint[];
};

/**
 * A node the protocol has no lossless home for from a plugin: vectors,
 * image-filled layers, booleans, slices. The mapper reports each one instead
 * of inventing an asset, and the export bundle carries its rendered pixels.
 */
export type IntermediateUnsupported = IntermediateBase & {
  readonly kind: "unsupported";
  readonly figmaType: string;
  readonly reason: "image" | "vector" | "unsupported";
};

export type IntermediateNode =
  | IntermediateFrame
  | IntermediateText
  | IntermediateShape
  | IntermediateUnsupported;
