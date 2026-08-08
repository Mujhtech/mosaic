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
export type {
  IntermediateFrame,
  IntermediateLineHeight,
  IntermediateNode,
  IntermediatePaint,
  IntermediateText,
  IntermediateUnsupported,
} from "./intermediate.js";
export {
  mapDocument,
  orderAbsoluteChildren,
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
