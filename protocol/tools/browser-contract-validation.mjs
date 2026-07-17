import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildBrowserContractDeclarations } from "./generate-browser-contract.mjs";

const toolsDirectory = dirname(fileURLToPath(import.meta.url));

export const browserContractRoot = resolve(toolsDirectory, "..");

export const browserContractPaths = Object.freeze({
  contractTypes: resolve(
    browserContractRoot,
    "browser/generated/contract-types.d.ts",
  ),
  indexDeclaration: resolve(browserContractRoot, "browser/index.d.ts"),
  indexModule: resolve(browserContractRoot, "browser/index.js"),
});

export function validateBrowserContractGeneration() {
  const expected = buildBrowserContractDeclarations();
  const errors = [];
  const actualTypes = readFileSync(
    browserContractPaths.contractTypes,
    "utf8",
  );
  const actualIndex = readFileSync(
    browserContractPaths.indexDeclaration,
    "utf8",
  );

  if (actualTypes !== expected.contractTypes) {
    errors.push(
      `${relative(browserContractRoot, browserContractPaths.contractTypes)} ` +
        "is stale; run npm run generate:browser-contract",
    );
  }
  if (actualIndex !== expected.indexDeclaration) {
    errors.push(
      `${relative(browserContractRoot, browserContractPaths.indexDeclaration)} ` +
        "is stale; run npm run generate:browser-contract",
    );
  }

  const browserSource = readFileSync(browserContractPaths.indexModule, "utf8");
  if (/from\s+["']node:/.test(browserSource)) {
    errors.push("browser/index.js imports a Node-only module");
  }
  if (browserSource.includes("apps/dashboard")) {
    errors.push("browser/index.js depends on dashboard implementation files");
  }

  return errors;
}
