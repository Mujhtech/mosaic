import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { orderedV02Capabilities } from "./validation-v0.2.mjs";

const toolsDirectory = dirname(fileURLToPath(import.meta.url));
const protocolRoot = resolve(toolsDirectory, "..");
const schemaPath = resolve(protocolRoot, "schema/v0.2/paywall.schema.json");

const authoredBoxTypes = new Set([
  "button",
  "carousel",
  "countdown",
  "featureList",
  "icon",
  "image",
  "productBadge",
  "productCard",
  "productSelector",
  "stack",
  "switch",
  "text",
]);

function axisSizing(value, fallback = "fit") {
  if (value === undefined) return fallback;
  if (value === "content") return "fit";
  return structuredClone(value);
}

function migrateBackgroundFields(value) {
  if (Array.isArray(value)) {
    return value.map(migrateBackgroundFields);
  }
  if (!value || typeof value !== "object") return value;
  const migrated = {};
  for (const [key, entry] of Object.entries(value)) {
    migrated[key] =
      key === "background" &&
      (typeof entry === "string" || entry?.type === "colorToken")
        ? { type: "color", value: structuredClone(entry) }
        : migrateBackgroundFields(entry);
  }
  return migrated;
}

function migrateNode(source) {
  const node = migrateBackgroundFields(source);
  if (node.type === "scrollContainer") {
    node.content = migrateNode(node.content);
    return node;
  }
  if (authoredBoxTypes.has(node.type)) {
    if (node.type === "image") {
      const width = axisSizing(node.width ?? node.sizing?.width);
      const height =
        node.height === undefined
          ? axisSizing(node.sizing?.height)
          : { mode: "fixed", value: node.height };
      node.sizing = { width, height };
      delete node.width;
      delete node.height;
    } else if (node.sizing) {
      node.sizing = {
        width: axisSizing(node.sizing.width),
        height: axisSizing(node.sizing.height),
      };
    }
  }
  if (node.type === "stack") {
    node.children = node.children.map(migrateNode);
  } else if (node.type === "carousel") {
    node.pages = node.pages.map((page) => ({
      ...page,
      content: migrateNode(page.content),
    }));
  } else if (node.type === "button") {
    node.children = node.children.map(migrateNode);
    if (node.inProgressChildren) {
      node.inProgressChildren = node.inProgressChildren.map(migrateNode);
    }
  } else if (node.type === "productSelector") {
    node.cards = node.cards.map(migrateNode);
  } else if (node.type === "productCard" || node.type === "productBadge") {
    node.children = node.children.map(migrateNode);
  }
  return node;
}

export function migrateV02RC3CandidateToRC4(document, paywallSchema) {
  if (!document || document.schemaVersion !== "0.2") {
    throw new Error("RC3 candidate recovery requires a Protocol 0.2 document.");
  }
  const migrated = migrateBackgroundFields(structuredClone(document));
  migrated.designSystem ??= { colors: [], backgrounds: [], shadows: [] };
  migrated.screens = migrated.screens.map((screen) => ({
    ...screen,
    presentation: screen.presentation ?? { type: "screen" },
    layout: migrateNode(screen.layout),
  }));
  migrated.compatibility.requiredCapabilities = orderedV02Capabilities(
    migrated,
    paywallSchema,
  );
  return {
    document: migrated,
    diagnostics: [],
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) {
    throw new Error("Usage: node tools/migrate-v0.2-rc3-to-rc4.mjs input.json");
  }
  const document = JSON.parse(
    readFileSync(resolve(process.cwd(), process.argv[2]), "utf8"),
  );
  const paywallSchema = JSON.parse(readFileSync(schemaPath, "utf8"));
  process.stdout.write(
    `${JSON.stringify(migrateV02RC3CandidateToRC4(document, paywallSchema), null, 2)}\n`,
  );
}
