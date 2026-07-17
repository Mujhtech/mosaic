import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const toolsDirectory = dirname(fileURLToPath(import.meta.url));
const protocolRoot = resolve(toolsDirectory, "..");
const generatedDirectory = resolve(protocolRoot, "browser/generated");

const schemaPaths = Object.freeze({
  localProject: resolve(
    protocolRoot,
    "schema/local-preview/v0.1/local-project.schema.json",
  ),
  paywall: resolve(protocolRoot, "schema/v0.1/paywall.schema.json"),
  preview: resolve(
    protocolRoot,
    "schema/local-preview/v0.1/preview-message.schema.json",
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
  if (context === "paywall") {
    return `MosaicPaywall${name}`;
  }
  if (name.startsWith("Preview")) {
    return `MosaicPreview${name.slice("Preview".length)}`;
  }
  return `MosaicPreview${name}`;
}

function literal(value) {
  return JSON.stringify(value);
}

function refType(ref, context) {
  if (ref.startsWith("#/$defs/")) {
    return definitionTypeName(context, ref.slice("#/$defs/".length));
  }

  const [schemaId, fragment] = ref.split("#", 2);
  if (schemaId === "urn:mosaic:protocol:schema:v0.1:paywall") {
    return fragment?.startsWith("/$defs/")
      ? definitionTypeName("paywall", fragment.slice("/$defs/".length))
      : "MosaicPaywallDocument";
  }
  if (
    schemaId ===
    "urn:mosaic:protocol:schema:local-preview:v0.1:message"
  ) {
    return fragment?.startsWith("/$defs/")
      ? definitionTypeName("preview", fragment.slice("/$defs/".length))
      : "MosaicPreviewMessage";
  }
  if (
    schemaId ===
    "urn:mosaic:protocol:schema:local-preview:v0.1:local-project"
  ) {
    return "MosaicLocalProject";
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

function previewMessageSource(schema) {
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
    "preview",
  );
  const variants = schema.allOf.map((branch) => ({
    payload: refType(
      branch.then.properties.payload.$ref,
      "preview",
    ),
    type: branch.if.properties.type.const,
  }));

  return [
    `export type MosaicPreviewMessageType = ${variants
      .map((variant) => literal(variant.type))
      .join(" | ")};`,
    "",
    "export type MosaicPreviewEnvelope<",
    "  TType extends MosaicPreviewMessageType,",
    "  TPayload,",
    `> = ${common} & {`,
    "  \"type\": TType;",
    "  \"payload\": TPayload;",
    "};",
    "",
    `export type MosaicPreviewMessage =\n${variants
      .map(
        (variant) =>
          `  | MosaicPreviewEnvelope<${literal(variant.type)}, ${variant.payload}>`,
      )
      .join("\n")};`,
  ].join("\n");
}

export function buildBrowserContractDeclarations() {
  const paywall = readJson(schemaPaths.paywall);
  const preview = readJson(schemaPaths.preview);
  const localProject = readJson(schemaPaths.localProject);

  const contractTypes = [
    "// Generated from canonical Mosaic JSON Schemas. Do not edit.",
    "",
    definitionsSource(paywall, "paywall"),
    "",
    `export type MosaicPaywallDocument = ${schemaType(paywall, "paywall")};`,
    "",
    definitionsSource(preview, "preview"),
    "",
    previewMessageSource(preview),
    "",
    `export type MosaicLocalProject = ${schemaType(localProject, "preview")};`,
    "",
  ].join("\n");

  const indexDeclaration = `// Generated public declarations for protocol/browser/index.js. Do not edit.
import type {
  MosaicLocalProject,
  MosaicPaywallDocument,
  MosaicPreviewCapabilityName,
  MosaicPreviewMessage,
  MosaicPreviewValidationDiagnostic,
} from "./generated/contract-types.js";

export * from "./generated/contract-types.js";

export type MosaicContractDiagnostic = MosaicPreviewValidationDiagnostic;

export type MosaicValidationResult<T> =
  | { readonly ok: true; readonly value: T; readonly diagnostics: readonly [] }
  | {
      readonly ok: false;
      readonly value: null;
      readonly diagnostics: readonly MosaicContractDiagnostic[];
    };

export declare const localPreviewContractVersion: ${literal(
    preview.properties.previewProtocolVersion.const,
  )};
export declare const localPreviewWebSocketProtocol: ${literal(
    `mosaic.local-preview.v${preview.properties.previewProtocolVersion.const}`,
  )};
export declare const previewMessageTypes: readonly MosaicPreviewMessage["type"][];
export declare const requiredPreviewCapabilities: readonly MosaicPreviewCapabilityName[];
export declare const canonicalSchemas: Readonly<{
  paywall: Readonly<Record<string, unknown>>;
  previewMessage: Readonly<Record<string, unknown>>;
  localProject: Readonly<Record<string, unknown>>;
}>;

export declare function validatePaywallDocument(
  value: unknown,
): MosaicValidationResult<MosaicPaywallDocument>;

export declare function validatePreviewMessage(
  value: unknown,
  options?: { readonly document?: MosaicPaywallDocument },
): MosaicValidationResult<MosaicPreviewMessage>;

export declare function validateLocalProject(
  value: unknown,
): MosaicValidationResult<MosaicLocalProject>;

export declare function parsePortablePaywallJson(
  source: string,
  options?: { readonly maxDocumentBytes?: number },
): MosaicValidationResult<MosaicPaywallDocument>;

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
