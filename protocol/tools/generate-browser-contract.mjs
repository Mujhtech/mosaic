import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const toolsDirectory = dirname(fileURLToPath(import.meta.url));
const protocolRoot = resolve(toolsDirectory, "..");
const generatedDirectory = resolve(protocolRoot, "browser/generated");

const schemaPaths = Object.freeze({
  configurationDeliveryV1: resolve(
    protocolRoot,
    "schema/configuration-delivery/v1/release.schema.json",
  ),
  configurationDeliveryV2: resolve(
    protocolRoot,
    "schema/configuration-delivery/v2/release.schema.json",
  ),
  commerceConfigurationV1: resolve(
    protocolRoot,
    "schema/commerce-configuration/v1/configuration.schema.json",
  ),
  commerceConfigurationV2: resolve(
    protocolRoot,
    "schema/commerce-configuration/v2/configuration.schema.json",
  ),
  commerceProviderV1: resolve(
    protocolRoot,
    "schema/commerce-provider/v1/contract.schema.json",
  ),
  commerceProviderV2: resolve(
    protocolRoot,
    "schema/commerce-provider/v2/contract.schema.json",
  ),
  localProjectV03: resolve(
    protocolRoot,
    "schema/local-preview/v0.3/local-project.schema.json",
  ),
  placementDecisionV1: resolve(
    protocolRoot,
    "schema/placement-decision/v1/decision.schema.json",
  ),
  paywallV03: resolve(protocolRoot, "schema/v0.3/paywall.schema.json"),
  paywallV04: resolve(protocolRoot, "schema/v0.4/paywall.schema.json"),
  previewV03: resolve(
    protocolRoot,
    "schema/local-preview/v0.3/preview-message.schema.json",
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

function definitionTypeName(context, definitionName) {
  const name = pascalCase(definitionName);
  if (context === "paywallV03") {
    return `MosaicPaywallV03${name}`;
  }
  if (context === "paywallV04") {
    return `MosaicPaywallV04${name}`;
  }
  if (context === "previewV03") {
    return name.startsWith("Preview")
      ? `MosaicPreviewV03${name.slice("Preview".length)}`
      : `MosaicPreviewV03${name}`;
  }
  if (context === "commerceProviderV1") {
    return `MosaicCommerceProviderV1${name}`;
  }
  if (context === "commerceProviderV2") {
    return `MosaicCommerceProviderV2${name}`;
  }
  if (context === "commerceConfigurationV1") {
    return `MosaicCommerceConfigurationV1${name}`;
  }
  if (context === "commerceConfigurationV2") {
    return `MosaicCommerceConfigurationV2${name}`;
  }
  if (context === "placementDecisionV1") {
    return `MosaicPlacementDecisionV1${name}`;
  }
  if (context === "configurationDeliveryV1") {
    return `MosaicConfigurationDeliveryV1${name}`;
  }
  if (context === "configurationDeliveryV2") {
    return `MosaicConfigurationDeliveryV2${name}`;
  }
  throw new Error(`Unsupported declaration context ${context}`);
}

function literal(value) {
  return JSON.stringify(value);
}

function refType(ref, context) {
  if (ref.startsWith("#/$defs/")) {
    return definitionTypeName(context, ref.slice("#/$defs/".length));
  }

  const [schemaId, fragment] = ref.split("#", 2);
  if (schemaId === "urn:mosaic:protocol:schema:v0.3:paywall") {
    return fragment?.startsWith("/$defs/")
      ? definitionTypeName("paywallV03", fragment.slice("/$defs/".length))
      : "MosaicPaywallV03Document";
  }
  if (schemaId === "urn:mosaic:protocol:schema:v0.4:paywall") {
    return fragment?.startsWith("/$defs/")
      ? definitionTypeName("paywallV04", fragment.slice("/$defs/".length))
      : "MosaicPaywallV04Document";
  }
  if (
    schemaId ===
    "urn:mosaic:protocol:schema:local-preview:v0.3:message"
  ) {
    return fragment?.startsWith("/$defs/")
      ? definitionTypeName("previewV03", fragment.slice("/$defs/".length))
      : "MosaicPreviewV03Message";
  }
  if (
    schemaId ===
    "urn:mosaic:protocol:schema:configuration-delivery:v1:release"
  ) {
    return fragment?.startsWith("/$defs/")
      ? definitionTypeName(
          "configurationDeliveryV1",
          fragment.slice("/$defs/".length),
        )
      : "MosaicConfigurationDeliveryV1";
  }
  if (
    schemaId ===
    "urn:mosaic:protocol:schema:placement-decision:v1:decision"
  ) {
    return fragment?.startsWith("/$defs/")
      ? definitionTypeName(
          "placementDecisionV1",
          fragment.slice("/$defs/".length),
        )
      : "MosaicPlacementDecisionV1";
  }
  if (
    schemaId ===
    "urn:mosaic:protocol:schema:commerce-provider:v2:contract"
  ) {
    return fragment?.startsWith("/$defs/")
      ? definitionTypeName(
          "commerceProviderV2",
          fragment.slice("/$defs/".length),
        )
      : "MosaicCommerceProviderV2Record";
  }
  if (
    schemaId ===
    "urn:mosaic:protocol:schema:local-preview:v0.3:local-project"
  ) {
    return "MosaicLocalProjectV03";
  }
  if (
    schemaId ===
    "urn:mosaic:protocol:schema:commerce-configuration:v2:configuration"
  ) {
    return fragment?.startsWith("/$defs/")
      ? definitionTypeName(
          "commerceConfigurationV2",
          fragment.slice("/$defs/".length),
        )
      : "MosaicCommerceConfigurationV2";
  }
  if (
    schemaId ===
    "urn:mosaic:protocol:schema:commerce-provider:v1:contract"
  ) {
    return fragment?.startsWith("/$defs/")
      ? definitionTypeName(
          "commerceProviderV1",
          fragment.slice("/$defs/".length),
        )
      : "MosaicCommerceProviderV1Record";
  }
  if (
    schemaId ===
    "urn:mosaic:protocol:schema:commerce-configuration:v1:configuration"
  ) {
    return fragment?.startsWith("/$defs/")
      ? definitionTypeName(
          "commerceConfigurationV1",
          fragment.slice("/$defs/".length),
        )
      : "MosaicCommerceConfigurationV1";
  }

  throw new Error(`Unsupported schema reference ${ref}`);
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

  return [
    `export type ${context === "preview" ? "MosaicPreviewMessageType" : "MosaicPreviewV03MessageType"} = ${variants
      .map((variant) => literal(variant.type))
      .join(" | ")};`,
    "",
    `export type ${context === "preview" ? "MosaicPreviewEnvelope" : "MosaicPreviewV03Envelope"}<`,
    `  TType extends ${context === "preview" ? "MosaicPreviewMessageType" : "MosaicPreviewV03MessageType"},`,
    "  TPayload,",
    `> = ${common} & {`,
    "  \"type\": TType;",
    "  \"payload\": TPayload;",
    "};",
    "",
    `export type ${context === "preview" ? "MosaicPreviewMessage" : "MosaicPreviewV03Message"} =\n${variants
      .map(
        (variant) =>
          `  | ${context === "preview" ? "MosaicPreviewEnvelope" : "MosaicPreviewV03Envelope"}<${literal(variant.type)}, ${variant.payload}>`,
      )
      .join("\n")};`,
  ].join("\n");
}

function commerceProviderRecordSource(
  schema,
  context = "commerceProviderV1",
) {
  const prefix =
    context === "commerceProviderV1"
      ? "MosaicCommerceProviderV1"
      : "MosaicCommerceProviderV2";
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
  const configurationDeliveryV1 = readJson(
    schemaPaths.configurationDeliveryV1,
  );
  const configurationDeliveryV2 = readJson(
    schemaPaths.configurationDeliveryV2,
  );
  const commerceConfigurationV1 = readJson(
    schemaPaths.commerceConfigurationV1,
  );
  const commerceConfigurationV2 = readJson(
    schemaPaths.commerceConfigurationV2,
  );
  const commerceProviderV1 = readJson(schemaPaths.commerceProviderV1);
  const commerceProviderV2 = readJson(schemaPaths.commerceProviderV2);
  const paywallV03 = readJson(schemaPaths.paywallV03);
  const paywallV04 = readJson(schemaPaths.paywallV04);
  const previewV03 = readJson(schemaPaths.previewV03);
  const localProjectV03 = readJson(schemaPaths.localProjectV03);
  const placementDecisionV1 = readJson(schemaPaths.placementDecisionV1);

  const contractTypes = [
    "// Generated from canonical Mosaic JSON Schemas. Do not edit.",
    "",
    definitionsSource(paywallV03, "paywallV03"),
    "",
    `export type MosaicPaywallV03Document = ${schemaType(paywallV03, "paywallV03")};`,
    "",
    definitionsSource(paywallV04, "paywallV04"),
    "",
    `export type MosaicPaywallV04Document = ${schemaType(paywallV04, "paywallV04")};`,
    "",
    definitionsSource(previewV03, "previewV03"),
    "",
    previewMessageSource(previewV03, "previewV03"),
    "",
    `export type MosaicLocalProjectV03 = ${schemaType(localProjectV03, "previewV03")};`,
    "",
    definitionsSource(commerceProviderV1, "commerceProviderV1"),
    "",
    commerceProviderRecordSource(commerceProviderV1),
    "",
    definitionsSource(commerceProviderV2, "commerceProviderV2"),
    "",
    commerceProviderRecordSource(commerceProviderV2, "commerceProviderV2"),
    "",
    definitionsSource(
      commerceConfigurationV1,
      "commerceConfigurationV1",
    ),
    "",
    `export type MosaicCommerceConfigurationV1 = ${schemaType(
      commerceConfigurationV1,
      "commerceConfigurationV1",
    )};`,
    "",
    definitionsSource(
      commerceConfigurationV2,
      "commerceConfigurationV2",
    ),
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
    definitionsSource(configurationDeliveryV1, "configurationDeliveryV1"),
    "",
    `export type MosaicConfigurationDeliveryV1 = ${schemaType(configurationDeliveryV1, "configurationDeliveryV1")};`,
    "",
    definitionsSource(configurationDeliveryV2, "configurationDeliveryV2"),
    "",
    `export type MosaicConfigurationDeliveryV2 = ${schemaType(configurationDeliveryV2, "configurationDeliveryV2")};`,
    "",
    "export type MosaicPaywallDocument = MosaicPaywallV03Document;",
    "export type MosaicPreviewMessage = MosaicPreviewV03Message;",
    "export type MosaicLocalProject = MosaicLocalProjectV03;",
    "export type MosaicPreviewCapabilityReportPayload = MosaicPreviewV03CapabilityReportPayload;",
    "export type MosaicPreviewCapabilityName = MosaicPreviewV03CapabilityName;",
    "export type MosaicPreviewValidationDiagnostic = MosaicPreviewV03ValidationDiagnostic;",
    "",
  ].join("\n");

  const indexDeclaration = `// Generated public declarations for protocol/browser/index.js. Do not edit.
import type {
  MosaicConfigurationDeliveryV1,
  MosaicConfigurationDeliveryV2,
  MosaicCommerceConfigurationV1,
  MosaicCommerceConfigurationV2,
  MosaicCommerceProviderV1Record,
  MosaicCommerceProviderV2Record,
  MosaicLocalProject,
  MosaicLocalProjectV03,
  MosaicPaywallDocument,
  MosaicPaywallV03Document,
  MosaicPaywallV04Document,
  MosaicPaywallV04AppearMotion,
  MosaicPaywallV04CapabilityName,
  MosaicPaywallV04LoopMotion,
  MosaicPaywallV04Motion,
  MosaicPaywallV04MotionEasing,
  MosaicPaywallV04SelectionMotion,
  MosaicPaywallV04SelectionStateStyle,
  MosaicPaywallV03CountdownComponent,
  MosaicPaywallV03AxisSizingValue,
  MosaicPaywallV03Background,
  MosaicPaywallV03Color,
  MosaicPaywallV03NavigateBackAction,
  MosaicPaywallV03NavigateToAction,
  MosaicPaywallV03ProductBadgeComponent,
  MosaicPaywallV03ProductCardComponent,
  MosaicPaywallV03ProductCardDefaultStyle,
  MosaicPaywallV03ProductSelectorComponent,
  MosaicPaywallV03CapabilityName,
  MosaicPaywallV03RequiredCapability,
  MosaicPaywallV03ReservedAccessibilityKey,
  MosaicPaywallV03SocialProofRating,
  MosaicPaywallV03Localization,
  MosaicPaywallV03Node,
  MosaicPaywallV03Shadow,
  MosaicPaywallV03Visibility,
  MosaicPlacementDecisionV1,
  MosaicPreviewCapabilityReportPayload,
  MosaicPreviewCapabilityName,
  MosaicPreviewMessage,
  MosaicPreviewV03CapabilityReportPayload,
  MosaicPreviewV03Message,
  MosaicPreviewValidationDiagnostic,
} from "./generated/contract-types.js";

export * from "./generated/contract-types.js";

export type MosaicContractDiagnostic = MosaicPreviewValidationDiagnostic;
export type MosaicAnyPaywallDocument = MosaicPaywallV03Document;
export type MosaicAnyPreviewMessage = MosaicPreviewV03Message;
export type MosaicAnyLocalProject = MosaicLocalProjectV03;
export type MosaicAnyCommerceProviderRecord =
  | MosaicCommerceProviderV1Record
  | MosaicCommerceProviderV2Record;
export type MosaicAnyCommerceConfiguration =
  | MosaicCommerceConfigurationV1
  | MosaicCommerceConfigurationV2;
export type MosaicAnyPlacementDecision = MosaicPlacementDecisionV1;
export type MosaicAnyConfigurationDelivery =
  | MosaicConfigurationDeliveryV1
  | MosaicConfigurationDeliveryV2;

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
      readonly selectedVersion: "0.3";
      readonly selectedWebSocketSubprotocol: "mosaic.local-preview.v0.3";
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
    previewV03.properties.previewProtocolVersion.const,
  )};
export declare const localPreviewWebSocketProtocol: ${literal(
    `mosaic.local-preview.v${previewV03.properties.previewProtocolVersion.const}`,
  )};
export declare const localPreviewContractVersions: readonly ["0.3"];
export declare const localPreviewVersionPreference: readonly ["0.3"];
export declare const localPreviewWebSocketProtocols: Readonly<{
  "0.3": "mosaic.local-preview.v0.3";
}>;
export declare const paywallContractVersion: "0.3";

/**
 * Paywall Protocol 0.4 (draft): the motion contract.
 *
 * 0.4 is a draft that Studio does not author yet, so the runtime exposes the
 * part of it that has no 0.3 equivalent rather than a second semantic
 * validator. MosaicAnyPaywallDocument deliberately still means 0.3: widening
 * it would tell every existing caller that a draft contract is deliverable.
 */
export declare const paywallV04ContractVersion: "0.4";
export declare const paywallContractVersions: readonly ["0.3", "0.4"];
export declare const paywallSchemasByVersion: Readonly<{
  "0.3": Readonly<Record<string, unknown>>;
  "0.4": Readonly<Record<string, unknown>>;
}>;
export declare const paywallV04CapabilityNames: readonly MosaicPaywallV04CapabilityName[];
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
export declare const capabilityNames: readonly MosaicPaywallV03CapabilityName[];
export declare const capabilityByComponentType: Readonly<
  Record<string, MosaicPaywallV03CapabilityName>
>;
export declare const colorFieldNames: readonly string[];
export declare const reservedAccessibilityKeys: Readonly<
  Record<
    MosaicPaywallV03ReservedAccessibilityKey,
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
  document: MosaicPaywallV03Document,
): readonly MosaicPaywallV03CapabilityName[];

export declare function requiredCapabilitiesFor(
  document: MosaicPaywallV03Document,
): readonly MosaicPaywallV03RequiredCapability[];

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
  localization: MosaicPaywallV03Localization,
  requestedLocale: string,
): Readonly<Record<string, string>>;

export declare function accessibilityAnnouncement(
  node: MosaicPaywallV03Node,
  options: {
    readonly strings: Readonly<Record<string, string>>;
    readonly state?: "idle" | "inProgress" | null;
  },
): MosaicPaywallAnnouncement;

export declare function ratingPoints(
  rating: MosaicPaywallV03SocialProofRating,
): string;
export declare function ratingMaximumPoints(
  rating: MosaicPaywallV03SocialProofRating,
): string;
export declare function resolveRatingAnnouncement(
  rating: MosaicPaywallV03SocialProofRating,
  template: string,
): string;

export declare const previewMessageTypes: readonly MosaicPreviewMessage["type"][];
export declare const previewMessageTypesByVersion: Readonly<{
  "0.3": readonly MosaicPreviewV03Message["type"][];
}>;
export declare const requiredPreviewCapabilities: readonly MosaicPreviewCapabilityName[];
export declare const canonicalSchemas: Readonly<{
  paywall: Readonly<Record<string, unknown>>;
  previewMessage: Readonly<Record<string, unknown>>;
  localProject: Readonly<Record<string, unknown>>;
}>;
export declare const canonicalSchemasByVersion: Readonly<{
  "0.3": Readonly<{
    paywall: Readonly<Record<string, unknown>>;
    previewMessage: Readonly<Record<string, unknown>>;
    localProject: Readonly<Record<string, unknown>>;
  }>;
}>;

export declare function negotiateLocalPreviewVersion(
  localSupportedVersions: readonly string[],
  remoteSupportedVersions: readonly string[],
): MosaicLocalPreviewNegotiation;

export declare function decideLocalPreviewDraftDelivery(options?: {
  readonly capabilityReport?: MosaicPreviewCapabilityReportPayload | MosaicPreviewV03CapabilityReportPayload;
  readonly document?: MosaicAnyPaywallDocument;
  readonly negotiation?: MosaicLocalPreviewNegotiation;
}): MosaicLocalPreviewDeliveryDecision;

export declare function resolveColorToken(
  document: MosaicPaywallV03Document,
  color: MosaicPaywallV03Color,
): Exclude<MosaicPaywallV03Color, { readonly type: "colorToken" }> | null;

export declare function resolveBackgroundToken(
  document: MosaicPaywallV03Document,
  background: MosaicPaywallV03Background,
): Exclude<MosaicPaywallV03Background, { readonly type: "backgroundToken" }> | null;

export declare function resolveShadowToken(
  document: MosaicPaywallV03Document,
  shadow: MosaicPaywallV03Shadow,
): Exclude<MosaicPaywallV03Shadow, { readonly type: "shadowToken" }> | null;

export declare function resolveAxisSizing(
  value: MosaicPaywallV03AxisSizingValue,
  options?: {
    readonly axis?: "width" | "height";
    readonly bounded?: boolean;
    readonly componentId?: string | null;
  },
): {
  readonly value: MosaicPaywallV03AxisSizingValue;
  readonly diagnostic: null | {
    readonly code: "layout.unboundedFill";
    readonly componentId: string | null;
    readonly axis: "width" | "height";
    readonly behavior: "useFit";
    readonly message: string;
  };
};

export declare function resolveMediaBackgroundFallback(
  document: MosaicPaywallV03Document,
  background: MosaicPaywallV03Background,
  availableAssetIds: readonly string[],
): {
  readonly background: MosaicPaywallV03Background | null;
  readonly diagnostic: null | Readonly<{
    code: "background.videoUnavailable" | "background.imageUnavailable";
    assetId: string;
    behavior: "usePoster" | "useFallbackColor";
    message: string;
  }>;
};

export declare function resolveProductCardStyle(
  productCard: MosaicPaywallV03ProductCardComponent,
  selected: boolean,
): MosaicPaywallV03ProductCardDefaultStyle;

export declare function resolveProductBadgeStyle(
  productBadge: MosaicPaywallV03ProductBadgeComponent,
  selected: boolean,
): MosaicPaywallV03ProductCardDefaultStyle;

export declare function interpolateProductText(
  value: string,
  product?: {
    readonly name?: string;
    readonly fallbackName?: string;
    readonly price?: string;
  },
): MosaicProductTemplateResolution;

export declare function resolveProductSelectorSelection(
  productSelector: MosaicPaywallV03ProductSelectorComponent,
  availableProductReferenceIds: readonly string[],
  currentProductCardId?: string,
): {
  readonly selectedProductCardId: string | null;
  readonly selectedProductReferenceId: string | null;
  readonly purchaseEnabled: boolean;
  readonly showUnavailableFallback: boolean;
};

export declare function runtimeStateForAcceptedRevision(
  document: MosaicPaywallV03Document,
): {
  readonly switches: Readonly<Record<string, boolean>>;
  readonly tabs: Readonly<Record<string, string>>;
  readonly carousels: Readonly<Record<string, number>>;
  readonly navigation: MosaicPaywallNavigationState;
  readonly selectedProducts: Readonly<Record<string, string>>;
};

export declare function applyNavigationAction(
  navigationState: MosaicPaywallNavigationState,
  action: MosaicPaywallV03NavigateToAction | MosaicPaywallV03NavigateBackAction,
): {
  readonly state: MosaicPaywallNavigationState;
  readonly diagnostic: MosaicPaywallRuntimeDiagnostic | null;
};

export declare function evaluateVisibility(
  visibility: MosaicPaywallV03Visibility | undefined,
  selectionState?: Partial<MosaicPaywallSelectionState>,
): boolean;

export declare function paywallRuntimeDiagnostics(
  document: MosaicAnyPaywallDocument,
  selectionState?: MosaicPaywallSelectionState,
  navigationState?: MosaicPaywallNavigationState,
): readonly MosaicPaywallRuntimeDiagnostic[];

export declare function resolveCountdownState(
  countdown: MosaicPaywallV03CountdownComponent,
  now: Date | string | number,
): {
  readonly completed: boolean;
  readonly remainingMilliseconds: number;
  readonly largestUnit: MosaicPaywallV03CountdownComponent["largestUnit"];
  readonly smallestUnit: MosaicPaywallV03CountdownComponent["smallestUnit"];
  readonly completedText: MosaicPaywallV03CountdownComponent["completedText"];
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
