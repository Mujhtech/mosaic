import assert from "node:assert/strict";
import test from "node:test";

import {
  loadProtocolArtifacts,
  validateJsonFormatting,
  validateProtocol,
} from "./validation.mjs";

function artifacts() {
  return structuredClone(loadProtocolArtifacts());
}

test("the canonical fixture and compatibility manifest are valid", () => {
  assert.deepEqual(validateProtocol(artifacts()), []);
  assert.deepEqual(validateJsonFormatting(), []);
});

test("an unsupported schema version is rejected", () => {
  const input = artifacts();
  input.document.schemaVersion = "1.0";

  assert.notDeepEqual(validateProtocol(input), []);
});

test("the maximum revision is accepted", () => {
  const input = artifacts();
  input.document.revision = 2147483647;

  assert.deepEqual(validateProtocol(input), []);
});

test("a revision above the maximum is rejected", () => {
  const input = artifacts();
  input.document.revision = 2147483648;

  assert.deepEqual(validateProtocol(input), [
    "document/revision must be <= 2147483647",
  ]);
});

test("an integral JSON number spelling is accepted as a revision", () => {
  const input = artifacts();
  input.document.revision = JSON.parse("1.0");

  assert.deepEqual(validateProtocol(input), []);
});

test("an unknown component is rejected", () => {
  const input = artifacts();
  input.document.layout.children.push({
    type: "unknown",
    id: "unknown",
  });

  assert.notDeepEqual(validateProtocol(input), []);
});

test("an unknown property is rejected", () => {
  const input = artifacts();
  input.document.executable = "never";

  assert.notDeepEqual(validateProtocol(input), []);
});

test("a missing capability declaration is rejected", () => {
  const input = artifacts();
  input.document.compatibility.requiredCapabilities =
    input.document.compatibility.requiredCapabilities.filter(
      (capability) => capability.name !== "component.legalText",
    );

  assert.deepEqual(validateProtocol(input), [
    "document is missing required capability component.legalText",
  ]);
});

test("a manifest missing a schema capability is rejected", () => {
  const input = artifacts();
  input.manifest.capabilities = input.manifest.capabilities.filter(
    (capability) => capability.name !== "component.legalText",
  );

  assert.deepEqual(validateProtocol(input), [
    "manifest does not support required capability component.legalText",
    "manifest omits schema capability component.legalText",
  ]);
});

test("a selector cannot choose an undeclared product", () => {
  const input = artifacts();
  const selector = input.document.layout.children.find(
    (component) => component.type === "productSelector",
  );
  selector.initiallySelectedProductId = "not_declared";

  assert.deepEqual(validateProtocol(input), [
    "product selector plans initially selects an undeclared product",
  ]);
});

test("a selector cannot declare duplicate products", () => {
  const input = artifacts();
  const selector = input.document.layout.children.find(
    (component) => component.type === "productSelector",
  );
  selector.products.push({ productId: "mosaic_pro_monthly" });

  assert.deepEqual(validateProtocol(input), [
    "product selector plans contains duplicate product IDs",
  ]);
});
