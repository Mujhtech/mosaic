import assert from "node:assert/strict";
import test from "node:test";
import { rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkGuardVacuity } from "./check-guard-vacuity.mjs";

const toolsDirectory = dirname(fileURLToPath(import.meta.url));

/**
 * A lint that stops firing is the defect class it exists to catch.
 *
 * Each case writes a probe file into `tools/`, runs the real check over the
 * real tree, and removes the probe. Both directions matter: a rule that never
 * fires protects nothing, and a rule that fires on correct code gets switched
 * off, which protects nothing either.
 */
function withProbes(files, assertion) {
  const paths = Object.keys(files).map((name) => resolve(toolsDirectory, name));
  try {
    for (const [name, source] of Object.entries(files)) {
      writeFileSync(resolve(toolsDirectory, name), source);
    }
    assertion(checkGuardVacuity());
  } finally {
    for (const path of paths) rmSync(path, { force: true });
  }
}

const firesOn = (errors, fragment) =>
  errors.some((error) => error.includes("zz-guard-probe") && error.includes(fragment));

const silentOnProbe = (errors) =>
  !errors.some((error) => error.includes("zz-guard-probe"));

test("the tree it guards is clean", () => {
  assert.deepEqual(checkGuardVacuity(), []);
});

test("rule 1 catches a condition half that can never change the result", () => {
  withProbes(
    {
      "zz-guard-probe.mjs":
        "export function f(x, V) {\n  if (x !== V && x !== V) return 1;\n  return 0;\n}\n",
    },
    (errors) => assert.ok(firesOn(errors, "repeats the condition operand")),
  );
});

test("rule 1 leaves distinct comparisons alone", () => {
  // The first draft blanked every literal to spaces, so these read as one
  // operand repeated. Single-character literals are the sharp case.
  withProbes(
    {
      "zz-guard-probe.mjs":
        'export function f(n, c) {\n' +
        '  if (n.type === "a" || n.type === "b") return 1;\n' +
        '  if (c === "(" || c === "[" || c === "{") return 2;\n' +
        "  if (c === '\"' || c === \"'\") return 3;\n" +
        "  return 0;\n}\n",
    },
    (errors) => assert.ok(silentOnProbe(errors)),
  );
});

test("rule 2 catches a corpus loop that never asks how much it saw", () => {
  withProbes(
    {
      "zz-guard-probe.mjs":
        "export function validateThing(a) {\n  const errors = [];\n" +
        "  for (const c of a.cases) errors.push(c);\n  return errors;\n}\n",
    },
    (errors) => assert.ok(firesOn(errors, "never checks how many cases")),
  );
});

test("rule 2 accepts a count checked through a variable", () => {
  // `validateRejectionLayers` captures the length first and compares the
  // variable; flagging that shape would have been a false positive.
  withProbes(
    {
      "zz-guard-probe.mjs":
        "export function validateThing(a) {\n  const errors = [];\n" +
        '  const seen = a.cases.length;\n  if (seen < 3) errors.push("floor");\n' +
        "  for (const c of a.cases) errors.push(c);\n  return errors;\n}\n",
    },
    (errors) => assert.ok(silentOnProbe(errors)),
  );
});

test("rule 3 catches a floor asserted against itself", () => {
  withProbes(
    {
      "zz-guard-probe.mjs": "export const PROBE_CASE_FLOOR = 4;\n",
      "zz-guard-probe.test.mjs":
        "assert.ok(vectors.cases.length >= PROBE_CASE_FLOOR);\n",
    },
    (errors) => assert.ok(firesOn(errors, "asserts a corpus length against")),
  );
});

test("rule 3 accepts a floor pinned against a literal", () => {
  withProbes(
    {
      "zz-guard-probe.mjs": "export const PROBE_CASE_FLOOR = 4;\n",
      "zz-guard-probe.test.mjs": "assert.ok(PROBE_CASE_FLOOR >= 4);\n",
    },
    (errors) => assert.ok(silentOnProbe(errors)),
  );
});
