import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { orderedV02Capabilities } from "./validation-v0.2.mjs";
import { loadProtocolArtifacts, validateProtocol } from "./validation.mjs";

const toolsDirectory = dirname(fileURLToPath(import.meta.url));
const protocolRoot = resolve(toolsDirectory, "..");
const sourceFixturePath = resolve(
  protocolRoot,
  "fixtures/v0.1/complete-paywall.json",
);
const targetFixturePath = resolve(
  protocolRoot,
  "fixtures/v0.2/migrated-v0.1.json",
);
const schemaPath = resolve(protocolRoot, "schema/v0.2/paywall.schema.json");

const zeroInsets = Object.freeze({ top: 0, start: 0, bottom: 0, end: 0 });

const typographyDefaults = Object.freeze({
  body: Object.freeze({
    style: "body",
    fontSize: 16,
    lineHeightMultiplier: 1.5,
    weight: "regular",
    color: "text.primary",
  }),
  caption: Object.freeze({
    style: "caption",
    fontSize: 13,
    lineHeightMultiplier: 18 / 13,
    weight: "regular",
    color: "text.secondary",
  }),
  label: Object.freeze({
    style: "label",
    fontSize: 16,
    lineHeightMultiplier: 1.25,
    weight: "semibold",
    color: "text.primary",
  }),
  title: Object.freeze({
    style: "title",
    fontSize: 32,
    lineHeightMultiplier: 38 / 32,
    weight: "bold",
    color: "text.primary",
  }),
});

function typography(style, alignment) {
  return { ...typographyDefaults[style], alignment };
}

function productCardStyles() {
  return {
    default: {
      background: "surface.default",
      border: {
        color: "border.default",
        width: 0,
      },
      cornerRadius: 0,
      padding: { ...zeroInsets },
      contentGap: 0,
      contentAlignment: "start",
      productLabelColor: "text.primary",
      runtimePriceColor: "text.primary",
      badge: {
        background: "transparent",
        textColor: "text.primary",
        border: {
          color: "border.default",
          width: 0,
        },
        cornerRadius: 0,
        padding: { ...zeroInsets },
      },
    },
    selected: {},
  };
}

function migrateNode(node) {
  const migrated = structuredClone(node);

  if (migrated.type === "scrollContainer") {
    migrated.content = migrateNode(migrated.content);
    return migrated;
  }

  if (migrated.type === "verticalStack") {
    migrated.type = "stack";
    migrated.direction = "vertical";
    migrated.gap = migrated.spacing;
    delete migrated.spacing;
    migrated.mainAxisDistribution = "start";
    migrated.crossAxisAlignment = migrated.horizontalAlignment;
    delete migrated.horizontalAlignment;
    migrated.children = migrated.children.map(migrateNode);
    return migrated;
  }

  if (migrated.type === "text") {
    migrated.typography = typography(migrated.style, migrated.alignment);
    delete migrated.style;
    delete migrated.alignment;
  } else if (migrated.type === "legalText") {
    migrated.typography = typography("caption", migrated.alignment);
    delete migrated.alignment;
    migrated.accessibility = {
      role: "text",
      ...(migrated.accessibility.label
        ? { label: structuredClone(migrated.accessibility.label) }
        : {}),
    };
  } else if (migrated.type === "featureList") {
    migrated.gap = migrated.itemSpacing;
    delete migrated.itemSpacing;
    migrated.markerColor = "text.primary";
    migrated.typography = typography("body", "start");
  } else if (migrated.type === "productSelector") {
    migrated.direction = "vertical";
    migrated.gap = migrated.itemSpacing;
    delete migrated.itemSpacing;
    migrated.cardStyles = productCardStyles();
  } else if (
    migrated.type === "purchaseButton" ||
    migrated.type === "restoreButton" ||
    migrated.type === "closeButton"
  ) {
    migrated.typography = typography("label", "center");
  }

  return migrated;
}

export function migrateV01ToV02(document, paywallSchema) {
  if (!document || document.schemaVersion !== "0.1") {
    throw new Error("Mosaic Protocol migration requires a 0.1 document.");
  }
  const sourceArtifacts = loadProtocolArtifacts();
  const sourceErrors = validateProtocol({
    ...sourceArtifacts,
    document,
  });
  if (sourceErrors.length > 0) {
    throw new Error(
      "Mosaic Protocol migration requires a valid 0.1 document: " +
        sourceErrors[0],
    );
  }

  const migrated = structuredClone(document);
  migrated.schemaVersion = "0.2";
  migrated.layout = migrateNode(migrated.layout);
  migrated.compatibility.requiredCapabilities = orderedV02Capabilities(
    migrated,
    paywallSchema,
  );
  return migrated;
}

export function migrateCanonicalV01Fixture() {
  const document = JSON.parse(readFileSync(sourceFixturePath, "utf8"));
  const paywallSchema = JSON.parse(readFileSync(schemaPath, "utf8"));
  return migrateV01ToV02(document, paywallSchema);
}

export function writeCanonicalMigrationFixture() {
  const migrated = migrateCanonicalV01Fixture();
  writeFileSync(targetFixturePath, `${JSON.stringify(migrated, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--write-canonical")) {
    writeCanonicalMigrationFixture();
  } else {
    const inputPath = process.argv[2]
      ? resolve(process.cwd(), process.argv[2])
      : sourceFixturePath;
    const document = JSON.parse(readFileSync(inputPath, "utf8"));
    const paywallSchema = JSON.parse(readFileSync(schemaPath, "utf8"));
    process.stdout.write(
      `${JSON.stringify(migrateV01ToV02(document, paywallSchema), null, 2)}\n`,
    );
  }
}
