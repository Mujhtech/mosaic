import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const toolsDirectory = dirname(fileURLToPath(import.meta.url));
const protocolRoot = resolve(toolsDirectory, "..");
const generatedDirectory = resolve(protocolRoot, "browser/generated");

const schemaPaths = Object.freeze({
  localProjectV02: resolve(
    protocolRoot,
    "schema/local-preview/v0.2/local-project.schema.json",
  ),
  paywallV02: resolve(protocolRoot, "schema/v0.2/paywall.schema.json"),
  previewV02: resolve(
    protocolRoot,
    "schema/local-preview/v0.2/preview-message.schema.json",
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
  if (context === "paywallV02") {
    return `MosaicPaywallV02${name}`;
  }
  if (context === "previewV02") {
    return name.startsWith("Preview")
      ? `MosaicPreviewV02${name.slice("Preview".length)}`
      : `MosaicPreviewV02${name}`;
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
  if (schemaId === "urn:mosaic:protocol:schema:v0.2:paywall") {
    return fragment?.startsWith("/$defs/")
      ? definitionTypeName("paywallV02", fragment.slice("/$defs/".length))
      : "MosaicPaywallV02Document";
  }
  if (
    schemaId ===
    "urn:mosaic:protocol:schema:local-preview:v0.2:message"
  ) {
    return fragment?.startsWith("/$defs/")
      ? definitionTypeName("previewV02", fragment.slice("/$defs/".length))
      : "MosaicPreviewV02Message";
  }
  if (
    schemaId ===
    "urn:mosaic:protocol:schema:local-preview:v0.2:local-project"
  ) {
    return "MosaicLocalProjectV02";
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
    `export type ${context === "preview" ? "MosaicPreviewMessageType" : "MosaicPreviewV02MessageType"} = ${variants
      .map((variant) => literal(variant.type))
      .join(" | ")};`,
    "",
    `export type ${context === "preview" ? "MosaicPreviewEnvelope" : "MosaicPreviewV02Envelope"}<`,
    `  TType extends ${context === "preview" ? "MosaicPreviewMessageType" : "MosaicPreviewV02MessageType"},`,
    "  TPayload,",
    `> = ${common} & {`,
    "  \"type\": TType;",
    "  \"payload\": TPayload;",
    "};",
    "",
    `export type ${context === "preview" ? "MosaicPreviewMessage" : "MosaicPreviewV02Message"} =\n${variants
      .map(
        (variant) =>
          `  | ${context === "preview" ? "MosaicPreviewEnvelope" : "MosaicPreviewV02Envelope"}<${literal(variant.type)}, ${variant.payload}>`,
      )
      .join("\n")};`,
  ].join("\n");
}

export function buildBrowserContractDeclarations() {
  const paywallV02 = readJson(schemaPaths.paywallV02);
  const previewV02 = readJson(schemaPaths.previewV02);
  const localProjectV02 = readJson(schemaPaths.localProjectV02);

  const contractTypes = [
    "// Generated from canonical Mosaic JSON Schemas. Do not edit.",
    "",
    definitionsSource(paywallV02, "paywallV02"),
    "",
    `export type MosaicPaywallV02Document = ${schemaType(paywallV02, "paywallV02")};`,
    "",
    definitionsSource(previewV02, "previewV02"),
    "",
    previewMessageSource(previewV02, "previewV02"),
    "",
    `export type MosaicLocalProjectV02 = ${schemaType(localProjectV02, "previewV02")};`,
    "",
    "export type MosaicPaywallDocument = MosaicPaywallV02Document;",
    "export type MosaicPreviewMessage = MosaicPreviewV02Message;",
    "export type MosaicLocalProject = MosaicLocalProjectV02;",
    "export type MosaicPreviewCapabilityReportPayload = MosaicPreviewV02CapabilityReportPayload;",
    "export type MosaicPreviewCapabilityName = MosaicPreviewV02CapabilityName;",
    "export type MosaicPreviewValidationDiagnostic = MosaicPreviewV02ValidationDiagnostic;",
    "",
  ].join("\n");

  const indexDeclaration = `// Generated public declarations for protocol/browser/index.js. Do not edit.
import type {
  MosaicLocalProject,
  MosaicLocalProjectV02,
  MosaicPaywallDocument,
  MosaicPaywallV02Document,
  MosaicPaywallV02CountdownComponent,
  MosaicPaywallV02AxisSizingValue,
  MosaicPaywallV02Background,
  MosaicPaywallV02Color,
  MosaicPaywallV02NavigateBackAction,
  MosaicPaywallV02NavigateToAction,
  MosaicPaywallV02ProductBadgeComponent,
  MosaicPaywallV02ProductCardComponent,
  MosaicPaywallV02ProductCardDefaultStyle,
  MosaicPaywallV02ProductSelectorComponent,
  MosaicPaywallV02Shadow,
  MosaicPaywallV02Visibility,
  MosaicPreviewCapabilityReportPayload,
  MosaicPreviewCapabilityName,
  MosaicPreviewMessage,
  MosaicPreviewV02CapabilityReportPayload,
  MosaicPreviewV02Message,
  MosaicPreviewValidationDiagnostic,
} from "./generated/contract-types.js";

export * from "./generated/contract-types.js";

export type MosaicContractDiagnostic = MosaicPreviewValidationDiagnostic;
export type MosaicAnyPaywallDocument = MosaicPaywallV02Document;
export type MosaicAnyPreviewMessage = MosaicPreviewV02Message;
export type MosaicAnyLocalProject = MosaicLocalProjectV02;

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
      readonly selectedVersion: "0.2";
      readonly selectedWebSocketSubprotocol: "mosaic.local-preview.v0.2";
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
export type MosaicPaywallV02RC2Candidate = Readonly<Record<string, unknown>> & {
  readonly schemaVersion: "0.2";
};
export type MosaicV02RC2MigrationDiagnostic = {
  readonly code: "migration.reviewRequired";
  readonly severity: "reviewRequired";
  readonly selectorId: string;
  readonly field: string;
  readonly message: string;
};
export type MosaicV02RC2MigrationResult = {
  readonly document: MosaicPaywallV02Document;
  readonly diagnostics: readonly MosaicV02RC2MigrationDiagnostic[];
};
export type MosaicPaywallV02RC3Candidate = Readonly<Record<string, unknown>> & {
  readonly schemaVersion: "0.2";
};
export type MosaicV02RC3MigrationResult = {
  readonly document: MosaicPaywallV02Document;
  readonly diagnostics: readonly [];
};

export type MosaicValidationResult<T> =
  | { readonly ok: true; readonly value: T; readonly diagnostics: readonly [] }
  | {
      readonly ok: false;
      readonly value: null;
      readonly diagnostics: readonly MosaicContractDiagnostic[];
    };

export declare const localPreviewContractVersion: ${literal(
    previewV02.properties.previewProtocolVersion.const,
  )};
export declare const localPreviewWebSocketProtocol: ${literal(
    `mosaic.local-preview.v${previewV02.properties.previewProtocolVersion.const}`,
  )};
export declare const localPreviewContractVersions: readonly ["0.2"];
export declare const localPreviewVersionPreference: readonly ["0.2"];
export declare const localPreviewWebSocketProtocols: Readonly<{
  "0.2": "mosaic.local-preview.v0.2";
}>;
export declare const previewMessageTypes: readonly MosaicPreviewMessage["type"][];
export declare const previewMessageTypesByVersion: Readonly<{
  "0.2": readonly MosaicPreviewV02Message["type"][];
}>;
export declare const requiredPreviewCapabilities: readonly MosaicPreviewCapabilityName[];
export declare const canonicalSchemas: Readonly<{
  paywall: Readonly<Record<string, unknown>>;
  previewMessage: Readonly<Record<string, unknown>>;
  localProject: Readonly<Record<string, unknown>>;
}>;
export declare const canonicalSchemasByVersion: Readonly<{
  "0.2": Readonly<{
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
  readonly capabilityReport?: MosaicPreviewCapabilityReportPayload | MosaicPreviewV02CapabilityReportPayload;
  readonly document?: MosaicAnyPaywallDocument;
  readonly negotiation?: MosaicLocalPreviewNegotiation;
}): MosaicLocalPreviewDeliveryDecision;

export declare function migrateV02RC2CandidateToRC3(
  document: MosaicPaywallV02RC2Candidate,
): MosaicV02RC2MigrationResult;

export declare function migrateV02RC3CandidateToRC4(
  document: MosaicPaywallV02RC3Candidate,
): MosaicV02RC3MigrationResult;

export declare function resolveColorToken(
  document: MosaicPaywallV02Document,
  color: MosaicPaywallV02Color,
): Exclude<MosaicPaywallV02Color, { readonly type: "colorToken" }> | null;

export declare function resolveBackgroundToken(
  document: MosaicPaywallV02Document,
  background: MosaicPaywallV02Background,
): Exclude<MosaicPaywallV02Background, { readonly type: "backgroundToken" }> | null;

export declare function resolveShadowToken(
  document: MosaicPaywallV02Document,
  shadow: MosaicPaywallV02Shadow,
): Exclude<MosaicPaywallV02Shadow, { readonly type: "shadowToken" }> | null;

export declare function resolveAxisSizing(
  value: MosaicPaywallV02AxisSizingValue,
  options?: {
    readonly axis?: "width" | "height";
    readonly bounded?: boolean;
    readonly componentId?: string | null;
  },
): {
  readonly value: MosaicPaywallV02AxisSizingValue;
  readonly diagnostic: null | {
    readonly code: "layout.unboundedFill";
    readonly componentId: string | null;
    readonly axis: "width" | "height";
    readonly behavior: "useFit";
    readonly message: string;
  };
};

export declare function resolveMediaBackgroundFallback(
  document: MosaicPaywallV02Document,
  background: MosaicPaywallV02Background,
  availableAssetIds: readonly string[],
): {
  readonly background: MosaicPaywallV02Background | null;
  readonly diagnostic: null | Readonly<{
    code: "background.videoUnavailable" | "background.imageUnavailable";
    assetId: string;
    behavior: "usePoster" | "useFallbackColor";
    message: string;
  }>;
};

export declare function resolveProductCardStyle(
  productCard: MosaicPaywallV02ProductCardComponent,
  selected: boolean,
): MosaicPaywallV02ProductCardDefaultStyle;

export declare function resolveProductBadgeStyle(
  productBadge: MosaicPaywallV02ProductBadgeComponent,
  selected: boolean,
): MosaicPaywallV02ProductCardDefaultStyle;

export declare function interpolateProductText(
  value: string,
  product?: {
    readonly name?: string;
    readonly fallbackName?: string;
    readonly price?: string;
  },
): MosaicProductTemplateResolution;

export declare function resolveProductSelectorSelection(
  productSelector: MosaicPaywallV02ProductSelectorComponent,
  availableProductReferenceIds: readonly string[],
  currentProductCardId?: string,
): {
  readonly selectedProductCardId: string | null;
  readonly selectedProductReferenceId: string | null;
  readonly purchaseEnabled: boolean;
  readonly showUnavailableFallback: boolean;
};

export declare function runtimeStateForAcceptedRevision(
  document: MosaicPaywallV02Document,
): {
  readonly switches: Readonly<Record<string, boolean>>;
  readonly carousels: Readonly<Record<string, number>>;
  readonly navigation: MosaicPaywallNavigationState;
  readonly selectedProducts: Readonly<Record<string, string>>;
};

export declare function applyNavigationAction(
  navigationState: MosaicPaywallNavigationState,
  action: MosaicPaywallV02NavigateToAction | MosaicPaywallV02NavigateBackAction,
): {
  readonly state: MosaicPaywallNavigationState;
  readonly diagnostic: MosaicPaywallRuntimeDiagnostic | null;
};

export declare function evaluateVisibility(
  visibility: MosaicPaywallV02Visibility | undefined,
  switchValues?: Readonly<Record<string, boolean>>,
): boolean;

export declare function paywallRuntimeDiagnostics(
  document: MosaicAnyPaywallDocument,
  switchValues?: Readonly<Record<string, boolean>>,
  navigationState?: MosaicPaywallNavigationState,
): readonly MosaicPaywallRuntimeDiagnostic[];

export declare function resolveCountdownState(
  countdown: MosaicPaywallV02CountdownComponent,
  now: Date | string | number,
): {
  readonly completed: boolean;
  readonly remainingMilliseconds: number;
  readonly largestUnit: MosaicPaywallV02CountdownComponent["largestUnit"];
  readonly smallestUnit: MosaicPaywallV02CountdownComponent["smallestUnit"];
  readonly completedText: MosaicPaywallV02CountdownComponent["completedText"];
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
