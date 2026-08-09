export { deriveCapabilityNames, deriveRequiredCapabilities } from "./capabilities.js";
export {
  firstVisibleSolid,
  hasVisibleUnsupportedPaint,
  solidFillColor,
  toLiteralColor,
  type LiteralColor,
} from "./color.js";
export {
  identifierAllocator,
  localizationKeyAllocator,
  NameAllocator,
  slugifyIdentifier,
  slugifyKeySegment,
} from "./identifiers.js";
export {
  detectProductCardGroups,
  detectsAsButton,
  looksLikePrice,
  soleTextChild,
  structureSignature,
} from "./detect.js";
export type {
  IntermediateBounds,
  IntermediateFrame,
  IntermediateLineHeight,
  IntermediateNode,
  IntermediatePaint,
  IntermediateShape,
  IntermediateText,
  IntermediateUnsupported,
} from "./intermediate.js";
export {
  clusterRows,
  horizontalExtent,
  inferAlignment,
  inferGap,
  inferPadding,
  median,
  overlapsSubstantially,
  unionExtent,
  verticalExtent,
  type Extent,
  type InferredAlignment,
  type InferredInsets,
} from "./layout-inference.js";
export {
  mapDocument,
  orderAbsoluteChildren,
  type ImagePlacement,
  type MapOptions,
  type MapResult,
} from "./map-document.js";
export type {
  ExportReport,
  ExportSkip,
  ExportSkipReason,
  ExportWarning,
  ExportWarningCode,
} from "./report.js";
export {
  clampFontSize,
  isAllCaps,
  numericWeightFromStyleName,
  pickTypographyStyle,
  snapFontWeight,
  toLineHeightMultiplier,
  toTextAlignment,
} from "./typography.js";
