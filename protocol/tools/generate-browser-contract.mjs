import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const toolsDirectory = dirname(fileURLToPath(import.meta.url));
const protocolRoot = resolve(toolsDirectory, "..");
const generatedDirectory = resolve(protocolRoot, "browser/generated");

const schemaPaths = Object.freeze({
  configurationDeliveryV3: resolve(
    protocolRoot,
    "schema/configuration-delivery/v3/release.schema.json",
  ),
  commerceConfigurationV2: resolve(
    protocolRoot,
    "schema/commerce-configuration/v2/configuration.schema.json",
  ),
  commerceProviderV2: resolve(
    protocolRoot,
    "schema/commerce-provider/v2/contract.schema.json",
  ),
  experimentAssignmentV1: resolve(
    protocolRoot,
    "schema/experiment-assignment/v1/assignment.schema.json",
  ),
  localProjectV04: resolve(
    protocolRoot,
    "schema/local-preview/v0.4/local-project.schema.json",
  ),
  placementDecisionV1: resolve(
    protocolRoot,
    "schema/placement-decision/v1/decision.schema.json",
  ),
  paywallV04: resolve(protocolRoot, "schema/v0.4/paywall.schema.json"),
  previewV04: resolve(
    protocolRoot,
    "schema/local-preview/v0.4/preview-message.schema.json",
  ),
});

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function pascalCase(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
}

/**
 * `preview` is the unversioned alias set; `previewV0x` are the versioned ones.
 * Derived rather than branched so that adding a preview version cannot leave a
 * name pointing at the previous one.
 */
function previewTypePrefix(context) {
  return context === "preview"
    ? "MosaicPreview"
    : `MosaicPreview${context.slice("preview".length)}`;
}

const typePrefixByContext = Object.freeze({
  paywallV04: "MosaicPaywallV04",
  commerceProviderV2: "MosaicCommerceProviderV2",
  commerceConfigurationV2: "MosaicCommerceConfigurationV2",
  placementDecisionV1: "MosaicPlacementDecisionV1",
  configurationDeliveryV3: "MosaicConfigurationDeliveryV3",
  experimentAssignmentV1: "MosaicExperimentAssignmentV1",
});

function definitionTypeName(context, definitionName) {
  const name = pascalCase(definitionName);
  if (context === "previewV04") {
    const prefix = previewTypePrefix(context);
    return name.startsWith("Preview")
      ? `${prefix}${name.slice("Preview".length)}`
      : `${prefix}${name}`;
  }
  const prefix = typePrefixByContext[context];
  if (!prefix) throw new Error(`Unsupported declaration context ${context}`);
  return `${prefix}${name}`;
}

function literal(value) {
  return JSON.stringify(value);
}

const documentTypeBySchemaId = Object.freeze({
  "urn:mosaic:protocol:schema:v0.4:paywall": ["paywallV04", "MosaicPaywallV04Document"],
  "urn:mosaic:protocol:schema:local-preview:v0.4:message": ["previewV04", "MosaicPreviewV04Message"],
  "urn:mosaic:protocol:schema:local-preview:v0.4:local-project": ["previewV04", "MosaicLocalProjectV04"],
  "urn:mosaic:protocol:schema:placement-decision:v1:decision": ["placementDecisionV1", "MosaicPlacementDecisionV1"],
  "urn:mosaic:protocol:schema:experiment-assignment:v1:assignment": ["experimentAssignmentV1", "MosaicExperimentAssignmentV1"],
  "urn:mosaic:protocol:schema:commerce-provider:v2:contract": ["commerceProviderV2", "MosaicCommerceProviderV2Record"],
  "urn:mosaic:protocol:schema:commerce-configuration:v2:configuration": ["commerceConfigurationV2", "MosaicCommerceConfigurationV2"],
  "urn:mosaic:protocol:schema:configuration-delivery:v3:release": ["configurationDeliveryV3", "MosaicConfigurationDeliveryV3"],
});

function refType(ref, context) {
  if (ref.startsWith("#/$defs/")) {
    return definitionTypeName(context, ref.slice("#/$defs/".length));
  }

  const [schemaId, fragment] = ref.split("#", 2);
  const target = documentTypeBySchemaId[schemaId];
  if (!target) throw new Error(`Unsupported schema reference ${ref}`);
  const [refContext, documentType] = target;
  return fragment?.startsWith("/$defs/")
    ? definitionTypeName(refContext, fragment.slice("/$defs/".length))
    : documentType;
}

function indent(value, spaces = 2) {
  const padding = " ".repeat(spaces);
  return value
    .split("\n")
    .map((line) => `${padding}${line}`)
    .join("\n");
}

function schemaType(schema, context) {
  if (schema === true) return "unknown";
  if (schema === false) return "never";
  if (schema.$ref) return refType(schema.$ref, context);
  if (Object.hasOwn(schema, "const")) return literal(schema.const);
  if (Array.isArray(schema.enum)) {
    return schema.enum.map(literal).join(" | ");
  }
  if (
    Array.isArray(schema.oneOf) &&
    (schema.type === "object" || schema.properties || schema.additionalProperties)
  ) {
    const { oneOf, ...commonSchema } = schema;
    const common = schemaType(commonSchema, context);
    const variants = oneOf.map((entry) => schemaType(entry, context)).join(" | ");
    return `${common} & (${variants})`;
  }
  if (Array.isArray(schema.oneOf)) {
    return schema.oneOf
      .map((entry) => schemaType(entry, context))
      .join(" | ");
  }
  if (Array.isArray(schema.anyOf)) {
    return schema.anyOf
      .map((entry) => schemaType(entry, context))
      .join(" | ");
  }
  if (Array.isArray(schema.type)) {
    return schema.type
      .map((type) => schemaType({ ...schema, type }, context))
      .join(" | ");
  }
  if (schema.type === "array") {
    return `Array<${schemaType(schema.items ?? true, context)}>`;
  }
  if (
    schema.type === "object" ||
    schema.properties ||
    schema.additionalProperties
  ) {
    const properties = schema.properties ?? {};
    const propertyEntries = Object.entries(properties);
    if (
      propertyEntries.length === 0 &&
      schema.additionalProperties &&
      schema.additionalProperties !== true
    ) {
      return `Record<string, ${schemaType(schema.additionalProperties, context)}>`;
    }

    const required = new Set(schema.required ?? []);
    const lines = propertyEntries.map(([name, propertySchema]) => {
      const optional = required.has(name) ? "" : "?";
      return `${literal(name)}${optional}: ${schemaType(propertySchema, context)};`;
    });
    if (schema.additionalProperties === true) {
      lines.push("[key: string]: unknown;");
    }
    return lines.length === 0
      ? "Record<string, unknown>"
      : `{\n${indent(lines.join("\n"))}\n}`;
  }
  if (schema.type === "string") return "string";
  if (schema.type === "integer" || schema.type === "number") return "number";
  if (schema.type === "boolean") return "boolean";
  if (schema.type === "null") return "null";
  if (Array.isArray(schema.allOf)) {
    return schema.allOf
      .filter((entry) => !entry.if && !entry.then)
      .map((entry) => schemaType(entry, context))
      .join(" & ") || "unknown";
  }
  return "unknown";
}

function definitionsSource(schema, context) {
  return Object.entries(schema.$defs ?? {})
    .map(
      ([name, definition]) =>
        `export type ${definitionTypeName(context, name)} = ${schemaType(definition, context)};`,
    )
    .join("\n\n");
}

function previewMessageSource(schema, context = "preview") {
  const commonProperties = Object.fromEntries(
    Object.entries(schema.properties).filter(
      ([name]) => name !== "type" && name !== "payload",
    ),
  );
  const commonRequired = schema.required.filter(
    (name) => name !== "type" && name !== "payload",
  );
  const common = schemaType(
    {
      type: "object",
      additionalProperties: false,
      required: commonRequired,
      properties: commonProperties,
    },
    context,
  );
  const variants = schema.allOf.map((branch) => ({
    payload: refType(
      branch.then.properties.payload.$ref,
      context,
    ),
    type: branch.if.properties.type.const,
  }));

  const prefix = previewTypePrefix(context);
  return [
    `export type ${prefix}MessageType = ${variants
      .map((variant) => literal(variant.type))
      .join(" | ")};`,
    "",
    `export type ${prefix}Envelope<`,
    `  TType extends ${prefix}MessageType,`,
    "  TPayload,",
    `> = ${common} & {`,
    "  \"type\": TType;",
    "  \"payload\": TPayload;",
    "};",
    "",
    `export type ${prefix}Message =\n${variants
      .map(
        (variant) =>
          `  | ${prefix}Envelope<${literal(variant.type)}, ${variant.payload}>`,
      )
      .join("\n")};`,
  ].join("\n");
}

function commerceProviderRecordSource(schema, context = "commerceProviderV2") {
  const prefix = typePrefixByContext[context];
  const commonProperties = Object.fromEntries(
    Object.entries(schema.properties).filter(
      ([name]) => name !== "recordType" && name !== "payload",
    ),
  );
  const commonRequired = schema.required.filter(
    (name) => name !== "recordType" && name !== "payload",
  );
  const common = schemaType(
    {
      type: "object",
      additionalProperties: false,
      required: commonRequired,
      properties: commonProperties,
    },
    context,
  );
  const variants = schema.allOf.map((branch) => ({
    payload: refType(branch.then.properties.payload.$ref, context),
    recordType: branch.if.properties.recordType.const,
  }));

  return [
    `export type ${prefix}Envelope<`,
    `  TRecordType extends ${prefix}RecordType,`,
    "  TPayload,",
    `> = ${common} & {`,
    "  \"recordType\": TRecordType;",
    "  \"payload\": TPayload;",
    "};",
    "",
    `export type ${prefix}Record =\n${variants
      .map(
        (variant) =>
          `  | ${prefix}Envelope<${literal(variant.recordType)}, ${variant.payload}>`,
      )
      .join("\n")};`,
  ].join("\n");
}

export function buildBrowserContractDeclarations() {
  const configurationDeliveryV3 = readJson(schemaPaths.configurationDeliveryV3);
  const commerceConfigurationV2 = readJson(schemaPaths.commerceConfigurationV2);
  const commerceProviderV2 = readJson(schemaPaths.commerceProviderV2);
  const experimentAssignmentV1 = readJson(schemaPaths.experimentAssignmentV1);
  const paywallV04 = readJson(schemaPaths.paywallV04);
  const previewV04 = readJson(schemaPaths.previewV04);
  const localProjectV04 = readJson(schemaPaths.localProjectV04);
  const placementDecisionV1 = readJson(schemaPaths.placementDecisionV1);

  const contractTypes = [
    "// Generated from canonical Mosaic JSON Schemas. Do not edit.",
    "",
    definitionsSource(paywallV04, "paywallV04"),
    "",
    `export type MosaicPaywallV04Document = ${schemaType(paywallV04, "paywallV04")};`,
    "",
    definitionsSource(previewV04, "previewV04"),
    "",
    previewMessageSource(previewV04, "previewV04"),
    "",
    `export type MosaicLocalProjectV04 = ${schemaType(localProjectV04, "previewV04")};`,
    "",
    definitionsSource(commerceProviderV2, "commerceProviderV2"),
    "",
    commerceProviderRecordSource(commerceProviderV2, "commerceProviderV2"),
    "",
    definitionsSource(commerceConfigurationV2, "commerceConfigurationV2"),
    "",
    `export type MosaicCommerceConfigurationV2 = ${schemaType(
      commerceConfigurationV2,
      "commerceConfigurationV2",
    )};`,
    "",
    definitionsSource(placementDecisionV1, "placementDecisionV1"),
    "",
    `export type MosaicPlacementDecisionV1 = ${schemaType(placementDecisionV1, "placementDecisionV1")};`,
    "",
    definitionsSource(experimentAssignmentV1, "experimentAssignmentV1"),
    "",
    `export type MosaicExperimentAssignmentV1 = ${schemaType(experimentAssignmentV1, "experimentAssignmentV1")};`,
    "",
    definitionsSource(configurationDeliveryV3, "configurationDeliveryV3"),
    "",
    `export type MosaicConfigurationDeliveryV3 = ${schemaType(configurationDeliveryV3, "configurationDeliveryV3")};`,
    "",
    "export type MosaicPaywallDocument = MosaicPaywallV04Document;",
    "export type MosaicPreviewMessage = MosaicPreviewV04Message;",
    "export type MosaicLocalProject = MosaicLocalProjectV04;",
    "export type MosaicPreviewCapabilityReportPayload = MosaicPreviewV04CapabilityReportPayload;",
    "export type MosaicPreviewCapabilityName = MosaicPreviewV04CapabilityName;",
    "export type MosaicPreviewValidationDiagnostic = MosaicPreviewV04ValidationDiagnostic;",
    "",
  ].join("\n");

  const indexDeclaration = `// Generated public declarations for protocol/browser/index.js. Do not edit.
import type {
  MosaicCommerceConfigurationV2,
  MosaicCommerceProviderV2Record,
  MosaicConfigurationDeliveryV3,
  MosaicExperimentAssignmentV1,
  MosaicLocalProject,
  MosaicLocalProjectV04,
  MosaicPaywallDocument,
  MosaicPaywallV04Document,
  MosaicPaywallV04AppearMotion,
  MosaicPaywallV04CapabilityName,
  MosaicPaywallV04LoopMotion,
  MosaicPaywallV04Motion,
  MosaicPaywallV04MotionEasing,
  MosaicPaywallV04SelectionMotion,
  MosaicPaywallV04SelectionStateStyle,
  MosaicPaywallV04CountdownComponent,
  MosaicPaywallV04AxisSizingValue,
  MosaicPaywallV04Background,
  MosaicPaywallV04Color,
  MosaicPaywallV04NavigateBackAction,
  MosaicPaywallV04NavigateToAction,
  MosaicPaywallV04ProductBadgeComponent,
  MosaicPaywallV04ProductCardComponent,
  MosaicPaywallV04ProductCardDefaultStyle,
  MosaicPaywallV04ProductSelectorComponent,
  MosaicPaywallV04RequiredCapability,
  MosaicPaywallV04ReservedAccessibilityKey,
  MosaicPaywallV04SocialProofRating,
  MosaicPaywallV04Localization,
  MosaicPaywallV04Node,
  MosaicPaywallV04Shadow,
  MosaicPaywallV04Visibility,
  MosaicPlacementDecisionV1,
  MosaicPreviewCapabilityReportPayload,
  MosaicPreviewCapabilityName,
  MosaicPreviewMessage,
  MosaicPreviewV04CapabilityReportPayload,
  MosaicPreviewV04Message,
  MosaicPreviewValidationDiagnostic,
} from "./generated/contract-types.js";

export * from "./generated/contract-types.js";

export type MosaicContractDiagnostic = MosaicPreviewValidationDiagnostic;
/**
 * Every paywall contract version this runtime can read.
 *
 * Every Mosaic contract carries exactly one version pre-GA, so each of these
 * aliases names one type rather than a union. They are kept as names because
 * they say what they mean at a call site -- "whatever this runtime reads" --
 * and because a later parallel version widens the alias without renaming
 * anything. See docs/architecture/decisions/0028-single-version-contracts.md.
 */
export type MosaicAnyPaywallDocument = MosaicPaywallV04Document;
export type MosaicAnyPreviewMessage = MosaicPreviewV04Message;
export type MosaicAnyLocalProject = MosaicLocalProjectV04;
export type MosaicAnyCommerceProviderRecord = MosaicCommerceProviderV2Record;
export type MosaicAnyCommerceConfiguration = MosaicCommerceConfigurationV2;
export type MosaicAnyPlacementDecision = MosaicPlacementDecisionV1;
export type MosaicAnyExperimentAssignment = MosaicExperimentAssignmentV1;
export type MosaicAnyConfigurationDelivery = MosaicConfigurationDeliveryV3;

export type MosaicLocalPreviewNegotiationDiagnostic = {
  readonly code: "preview.noMutualVersion" | "preview.incompatibleSchemaVersion" | "preview.invalidNegotiation" | "preview.invalidCapabilityReport" | "preview.invalidDraft" | "preview.unsupportedPreviewCapability" | "preview.unsupportedCapability" | "preview.documentTooLarge";
  readonly message: string;
  readonly fallback: "keepLastAcceptedDraft";
  readonly recovery: {
    readonly action: "updatePreviewClient" | "editProperty" | "removeComponent";
    readonly message: string;
  };
};
export type MosaicLocalPreviewNegotiation =
  | {
      readonly ok: true;
      readonly selectedVersion: "0.4";
      readonly selectedWebSocketSubprotocol: "mosaic.local-preview.v0.4";
    }
  | {
      readonly ok: false;
      readonly selectedVersion: null;
      readonly selectedWebSocketSubprotocol: null;
      readonly diagnostic: MosaicLocalPreviewNegotiationDiagnostic;
    };
export type MosaicLocalPreviewDeliveryDecision =
  | { readonly delivery: "send" }
  | {
      readonly delivery: "withhold";
      readonly diagnostic: MosaicLocalPreviewNegotiationDiagnostic;
    };
export type MosaicPaywallNavigationState = {
  readonly currentScreenId: string;
  readonly history: readonly string[];
};
export type MosaicPaywallSelectionState = {
  readonly switches: Readonly<Record<string, boolean>>;
  readonly tabs: Readonly<Record<string, string>>;
};
export type MosaicPaywallRuntimeDiagnostic =
  | {
      readonly code: "purchase.hiddenProductSelector";
      readonly componentId: string;
      readonly productSelectorId: string;
      readonly behavior: "disablePurchase";
      readonly message: string;
    }
  | {
      readonly code: "navigation.noBackTarget";
      readonly componentId?: string;
      readonly screenId?: string;
      readonly behavior: "noOp";
      readonly message: string;
    };
export type MosaicProductTemplateResolution =
  | { readonly available: true; readonly value: string; readonly diagnostic: null }
  | {
      readonly available: false;
      readonly value: null;
      readonly diagnostic: "invalidTemplate" | "missingName" | "missingPrice";
    };
export type MosaicValidationResult<T> =
  | { readonly ok: true; readonly value: T; readonly diagnostics: readonly [] }
  | {
      readonly ok: false;
      readonly value: null;
      readonly diagnostics: readonly MosaicContractDiagnostic[];
    };

export declare const localPreviewContractVersion: ${literal(
    previewV04.properties.previewProtocolVersion.const,
  )};
export declare const localPreviewWebSocketProtocol: ${literal(
    `mosaic.local-preview.v${previewV04.properties.previewProtocolVersion.const}`,
  )};
export declare const localPreviewContractVersions: readonly ["0.4"];
/** One version is still negotiated: a peer that speaks none of these is refused. */
export declare const localPreviewVersionPreference: readonly ["0.4"];
export declare const localPreviewWebSocketProtocols: Readonly<{
  "0.4": "mosaic.local-preview.v0.4";
}>;
export declare const paywallContractVersion: "0.4";
export declare const paywallContractVersions: readonly ["0.4"];
export declare const motionCapabilityNames: readonly [
  "motion.appear",
  "motion.selection",
  "motion.loop",
];
/** Normative cubic-bezier control points, in [x1, y1, x2, y2] order. */
export declare const motionEasingControlPoints: Readonly<
  Record<MosaicPaywallV04MotionEasing, readonly [number, number, number, number]>
>;
export declare const motionLoopMinimumDurationMilliseconds: 500;

export declare function easedMotionProgress(
  easing: MosaicPaywallV04MotionEasing,
  fraction: number,
): number;

export declare function resolveMotionToken(
  document: MosaicPaywallV04Document,
  motion: MosaicPaywallV04Motion,
): Exclude<MosaicPaywallV04Motion, { readonly type: "motionToken" }> | null;

export declare function motionCapabilitiesFor(
  document: MosaicPaywallV04Document,
): readonly MosaicPaywallV04CapabilityName[];

export declare type MosaicPaywallAppearFrame = {
  readonly trigger: "appear";
  readonly reducedMotion: boolean;
  readonly complete: boolean;
  readonly progress: number;
  readonly opacity: number;
  /** Always 0 under reduced motion: the contract owns what changes. */
  readonly translateLogicalSize: number;
};
export declare type MosaicPaywallSelectionFrame = {
  readonly trigger: "selection";
  readonly reducedMotion: boolean;
  readonly complete: boolean;
  readonly progress: number;
  readonly style: MosaicPaywallV04SelectionStateStyle;
};
export declare type MosaicPaywallLoopFrame = {
  readonly trigger: "loop";
  readonly reducedMotion: boolean;
  readonly complete: boolean;
  readonly cycle: number;
  readonly cyclePhase: number;
  readonly excursion: number;
  readonly scale: number;
  /** A fraction of the node's resolved static opacity, never an absolute. */
  readonly opacityMultiplier: number;
};

/**
 * The frame a renderer must be showing at an exact elapsed time.
 *
 * Terminal state equals the static rendering exactly, which is what makes the
 * renderWithoutMotion fallback lossless. Throws on a non-integer or negative
 * elapsed time rather than resolving a plausible-looking frame from a clock
 * that cannot be trusted.
 */
export declare function resolveMotionFrame(
  motion: MosaicPaywallV04AppearMotion,
  options: {
    readonly trigger: "appear";
    readonly elapsedMilliseconds: number;
    readonly reducedMotion?: boolean;
  },
): MosaicPaywallAppearFrame;
export declare function resolveMotionFrame(
  motion: MosaicPaywallV04SelectionMotion,
  options: {
    readonly trigger: "selection";
    readonly elapsedMilliseconds: number;
    readonly reducedMotion?: boolean;
    readonly resolvedFrom: MosaicPaywallV04SelectionStateStyle;
    readonly resolvedTo: MosaicPaywallV04SelectionStateStyle;
  },
): MosaicPaywallSelectionFrame;
export declare function resolveMotionFrame(
  motion: MosaicPaywallV04LoopMotion,
  options: {
    readonly trigger: "loop";
    readonly elapsedMilliseconds: number;
    readonly reducedMotion?: boolean;
  },
): MosaicPaywallLoopFrame;
export declare const capabilityNames: readonly MosaicPaywallV04CapabilityName[];
export declare const capabilityByComponentType: Readonly<
  Record<string, MosaicPaywallV04CapabilityName>
>;
export declare const colorFieldNames: readonly string[];
export declare const reservedAccessibilityKeys: Readonly<
  Record<
    MosaicPaywallV04ReservedAccessibilityKey,
    {
      readonly placeholders: readonly string[];
      readonly consumedBy: (
        entries: readonly { readonly node: Record<string, unknown> }[],
      ) => boolean;
      readonly consumer: string;
    }
  >
>;

export declare function usesColor(value: unknown): boolean;

export declare function expectedDocumentCapabilities(
  document: MosaicPaywallV04Document,
): readonly MosaicPaywallV04CapabilityName[];

export declare function requiredCapabilitiesFor(
  document: MosaicPaywallV04Document,
): readonly MosaicPaywallV04RequiredCapability[];

export declare type MosaicPaywallAnnouncement = {
  readonly composition: "separateElements" | "singleElement";
  /** Null by contract: segments are never joined. */
  readonly separator: null;
  readonly container: {
    readonly role: "group" | "list" | "button";
    readonly label: string;
    readonly value: string | null;
    readonly hint: string | null;
  };
  readonly elements: readonly {
    readonly item?: string;
    readonly segment: string;
    readonly text: string;
  }[];
  readonly decorative: readonly string[];
};

export declare function resolvedCatalogStrings(
  localization: MosaicPaywallV04Localization,
  requestedLocale: string,
): Readonly<Record<string, string>>;

export declare function accessibilityAnnouncement(
  node: MosaicPaywallV04Node,
  options: {
    readonly strings: Readonly<Record<string, string>>;
    readonly state?: "idle" | "inProgress" | null;
  },
): MosaicPaywallAnnouncement;

export declare function ratingPoints(
  rating: MosaicPaywallV04SocialProofRating,
): string;
export declare function ratingMaximumPoints(
  rating: MosaicPaywallV04SocialProofRating,
): string;
export declare function resolveRatingAnnouncement(
  rating: MosaicPaywallV04SocialProofRating,
  template: string,
): string;

export declare const previewMessageTypes: readonly MosaicPreviewMessage["type"][];
export declare const requiredPreviewCapabilities: readonly MosaicPreviewCapabilityName[];
export declare const canonicalSchemas: Readonly<{
  paywall: Readonly<Record<string, unknown>>;
  previewMessage: Readonly<Record<string, unknown>>;
  localProject: Readonly<Record<string, unknown>>;
}>;

export declare function negotiateLocalPreviewVersion(
  localSupportedVersions: readonly string[],
  remoteSupportedVersions: readonly string[],
): MosaicLocalPreviewNegotiation;

export declare function decideLocalPreviewDraftDelivery(options?: {
  readonly capabilityReport?:
    | MosaicPreviewCapabilityReportPayload
    | MosaicPreviewV04CapabilityReportPayload;
  readonly document?: MosaicAnyPaywallDocument;
  readonly negotiation?: MosaicLocalPreviewNegotiation;
}): MosaicLocalPreviewDeliveryDecision;

export declare function resolveColorToken(
  document: MosaicPaywallV04Document,
  color: MosaicPaywallV04Color,
): Exclude<MosaicPaywallV04Color, { readonly type: "colorToken" }> | null;

export declare function resolveBackgroundToken(
  document: MosaicPaywallV04Document,
  background: MosaicPaywallV04Background,
): Exclude<MosaicPaywallV04Background, { readonly type: "backgroundToken" }> | null;

export declare function resolveShadowToken(
  document: MosaicPaywallV04Document,
  shadow: MosaicPaywallV04Shadow,
): Exclude<MosaicPaywallV04Shadow, { readonly type: "shadowToken" }> | null;

export declare function resolveAxisSizing(
  value: MosaicPaywallV04AxisSizingValue,
  options?: {
    readonly axis?: "width" | "height";
    readonly bounded?: boolean;
    readonly componentId?: string | null;
  },
): {
  readonly value: MosaicPaywallV04AxisSizingValue;
  readonly diagnostic: null | {
    readonly code: "layout.unboundedFill";
    readonly componentId: string | null;
    readonly axis: "width" | "height";
    readonly behavior: "useFit";
    readonly message: string;
  };
};

export declare function resolveMediaBackgroundFallback(
  document: MosaicPaywallV04Document,
  background: MosaicPaywallV04Background,
  availableAssetIds: readonly string[],
): {
  readonly background: MosaicPaywallV04Background | null;
  readonly diagnostic: null | Readonly<{
    code: "background.videoUnavailable" | "background.imageUnavailable";
    assetId: string;
    behavior: "usePoster" | "useFallbackColor";
    message: string;
  }>;
};

export declare function resolveProductCardStyle(
  productCard: MosaicPaywallV04ProductCardComponent,
  selected: boolean,
): MosaicPaywallV04ProductCardDefaultStyle;

export declare function resolveProductBadgeStyle(
  productBadge: MosaicPaywallV04ProductBadgeComponent,
  selected: boolean,
): MosaicPaywallV04ProductCardDefaultStyle;

export declare function interpolateProductText(
  value: string,
  product?: {
    readonly name?: string;
    readonly fallbackName?: string;
    readonly price?: string;
  },
): MosaicProductTemplateResolution;

export declare function resolveProductSelectorSelection(
  productSelector: MosaicPaywallV04ProductSelectorComponent,
  availableProductReferenceIds: readonly string[],
  currentProductCardId?: string,
): {
  readonly selectedProductCardId: string | null;
  readonly selectedProductReferenceId: string | null;
  readonly purchaseEnabled: boolean;
  readonly showUnavailableFallback: boolean;
};

export declare function runtimeStateForAcceptedRevision(
  document: MosaicPaywallV04Document,
): {
  readonly switches: Readonly<Record<string, boolean>>;
  readonly tabs: Readonly<Record<string, string>>;
  readonly carousels: Readonly<Record<string, number>>;
  readonly navigation: MosaicPaywallNavigationState;
  readonly selectedProducts: Readonly<Record<string, string>>;
};

export declare function applyNavigationAction(
  navigationState: MosaicPaywallNavigationState,
  action: MosaicPaywallV04NavigateToAction | MosaicPaywallV04NavigateBackAction,
): {
  readonly state: MosaicPaywallNavigationState;
  readonly diagnostic: MosaicPaywallRuntimeDiagnostic | null;
};

export declare function evaluateVisibility(
  visibility: MosaicPaywallV04Visibility | undefined,
  selectionState?: Partial<MosaicPaywallSelectionState>,
): boolean;

export declare function paywallRuntimeDiagnostics(
  document: MosaicAnyPaywallDocument,
  selectionState?: MosaicPaywallSelectionState,
  navigationState?: MosaicPaywallNavigationState,
): readonly MosaicPaywallRuntimeDiagnostic[];

export declare function resolveCountdownState(
  countdown: MosaicPaywallV04CountdownComponent,
  now: Date | string | number,
): {
  readonly completed: boolean;
  readonly remainingMilliseconds: number;
  readonly largestUnit: MosaicPaywallV04CountdownComponent["largestUnit"];
  readonly smallestUnit: MosaicPaywallV04CountdownComponent["smallestUnit"];
  readonly completedText: MosaicPaywallV04CountdownComponent["completedText"];
};

export declare function validatePaywallDocument(
  value: unknown,
): MosaicValidationResult<MosaicAnyPaywallDocument>;

export declare function validatePreviewMessage(
  value: unknown,
  options?: { readonly document?: MosaicAnyPaywallDocument },
): MosaicValidationResult<MosaicAnyPreviewMessage>;

export declare function validateLocalProject(
  value: unknown,
): MosaicValidationResult<MosaicAnyLocalProject>;

export declare function parsePortablePaywallJson(
  source: string,
  options?: { readonly maxDocumentBytes?: number },
): MosaicValidationResult<MosaicAnyPaywallDocument>;

export declare function serializePortablePaywallJson(
  value: unknown,
): MosaicValidationResult<string>;
`;

  return { contractTypes, indexDeclaration };
}

export function writeBrowserContractDeclarations() {
  const output = buildBrowserContractDeclarations();
  mkdirSync(generatedDirectory, { recursive: true });
  writeFileSync(
    resolve(generatedDirectory, "contract-types.d.ts"),
    output.contractTypes,
  );
  writeFileSync(resolve(protocolRoot, "browser/index.d.ts"), output.indexDeclaration);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeBrowserContractDeclarations();
}
