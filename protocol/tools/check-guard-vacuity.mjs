/**
 * Detects guards that cannot fail.
 *
 * Four independent sightings of one defect class landed on a single branch:
 *
 *   1. Conformance corpora reporting success over zero cases -- the loop ran,
 *      found nothing, and returned no errors.
 *   2. The validator and browser capability tables drifting apart, each
 *      internally consistent and mutually wrong.
 *   3. `x !== V && x !== V` left behind when a pair of version aliases
 *      collapsed into one -- a condition with a redundant half.
 *   4. A corpus-floor test asserting `cases.length >= FLOOR` against the same
 *      constant the implementation compares, so lowering the floor satisfied
 *      both and the test passed.
 *
 * Manual review missed all four. This is the mechanical part of the class. It
 * is deliberately three narrow textual rules over `protocol/`'s own JavaScript
 * rather than a general-purpose linter: a rule that fires on correct code gets
 * switched off, and a plugin architecture for three rules is not worth owning.
 *
 * **What this does not cover**, and what stays a review obligation:
 *
 *   - Sighting 2. Two tables in two files that agree today and drift tomorrow
 *     is not textually detectable. It is prevented structurally instead: the
 *     derivation surface is exported from one place
 *     (`expectedDocumentCapabilities` and friends) and a test pins each export
 *     against the code that reads it. When you add a table, export it rather
 *     than copy it.
 *   - Whether a floor is set to a number that means anything. `FLOOR = 1` is
 *     load-bearing and useless. Only a human comparing it to the corpus can say.
 *   - Any of this in Kotlin, Swift, Dart, or Go. Sighting 3 was Dart. Those
 *     languages have their own linters and this script is not going to grow
 *     four parsers.
 *
 * Run by `npm run validate`.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Source files this script judges. Generated output is excluded. */
function sourceFiles() {
  const files = [];
  for (const directory of ["tools", "browser"]) {
    for (const name of readdirSync(resolve(root, directory))) {
      if (!name.endsWith(".mjs") && !name.endsWith(".js")) continue;
      files.push(`${directory}/${name}`);
    }
  }
  return files.sort();
}

const read = (file) => readFileSync(resolve(root, file), "utf8");

/**
 * Replaces string and template literals and comments with same-length filler.
 *
 * Every rule below reasons about code shape, and a message that happens to
 * contain `&&` or the word `length` is not code. Two properties matter and the
 * first draft of this got the second wrong:
 *
 *   - length is preserved, so reported line numbers stay true; and
 *   - **distinct contents stay distinct**. Blanking every literal to spaces
 *     made `node.type === "a" || node.type === "b"` read as one operand
 *     repeated, which is the exact false positive that makes a rule get
 *     switched off. Each literal is filled from a hash of its contents instead.
 */
function blankNonCode(source) {
  const out = [...source];
  let index = 0;
  let context = null;
  let literalStart = -1;
  // Private-use fill, one distinct character per position, keyed by the
  // literal's contents. A one-character literal must still be distinguishable:
  // `char === "(" || char === "["` is a real condition, and `'"'` versus `"'"`
  // are different comparisons.
  const fillerFor = (text, length) => {
    let hash = 0;
    for (const char of text) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
    let filler = "";
    for (let i = 0; i < length; i += 1) {
      filler += String.fromCharCode(0xe000 + ((hash + i * 31) % 0x1000));
    }
    return filler;
  };
  const blank = (from, to) => {
    for (let i = from; i < to && i < out.length; i += 1) {
      if (out[i] !== "\n") out[i] = " ";
    }
  };
  /** Fills a closed literal span with a marker derived from its contents. */
  const stampLiteral = (from, to) => {
    const filler = fillerFor(source.slice(from, to), to - from);
    blank(from, to);
    for (let i = 0; i < filler.length && from + i < to; i += 1) {
      if (out[from + i] !== "\n") out[from + i] = filler[i];
    }
  };
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (context === null) {
      if (char === "/" && next === "/") {
        const end = source.indexOf("\n", index);
        blank(index, end === -1 ? source.length : end);
        index = end === -1 ? source.length : end;
        continue;
      }
      if (char === "/" && next === "*") {
        const end = source.indexOf("*/", index + 2);
        blank(index, end === -1 ? source.length : end + 2);
        index = end === -1 ? source.length : end + 2;
        continue;
      }
      if (char === '"' || char === "'" || char === "`") {
        context = char;
        blank(index, index + 1);
        index += 1;
        literalStart = index;
        continue;
      }
      index += 1;
      continue;
    }
    if (char === "\\") {
      blank(index, index + 2);
      index += 2;
      continue;
    }
    if (char === context) {
      stampLiteral(literalStart, index);
      blank(index, index + 1);
      context = null;
      index += 1;
      continue;
    }
    index += 1;
  }
  return out.join("");
}

const lineOf = (source, offset) => source.slice(0, offset).split("\n").length;

/**
 * Splits a condition on top-level `&&` / `||`, ignoring nested parentheses.
 */
function topLevelOperands(condition) {
  const operands = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < condition.length; index += 1) {
    const char = condition[index];
    if (char === "(" || char === "[" || char === "{") depth += 1;
    else if (char === ")" || char === "]" || char === "}") depth -= 1;
    else if (
      depth === 0 &&
      (condition.startsWith("&&", index) || condition.startsWith("||", index))
    ) {
      operands.push(condition.slice(start, index));
      index += 1;
      start = index + 1;
    }
  }
  operands.push(condition.slice(start));
  return operands.map((operand) => operand.replace(/\s+/g, " ").trim());
}

/**
 * Rule 1: a condition whose operands repeat.
 *
 * `x !== V && x !== V` is what a collapsed pair of version aliases leaves
 * behind. The second half can never change the result, so the guard is half
 * decoration and nobody reading it can tell which half was meant.
 */
function duplicateOperands(errors) {
  for (const file of sourceFiles()) {
    const source = read(file);
    const code = blankNonCode(source);
    for (const match of code.matchAll(/(?:if|while)\s*\(/g)) {
      const open = match.index + match[0].length - 1;
      let depth = 0;
      let close = open;
      while (close < code.length) {
        if (code[close] === "(") depth += 1;
        else if (code[close] === ")") {
          depth -= 1;
          if (depth === 0) break;
        }
        close += 1;
      }
      const operands = topLevelOperands(code.slice(open + 1, close));
      if (operands.length < 2) continue;
      const seen = new Set();
      for (const operand of operands) {
        if (operand.length === 0) continue;
        if (seen.has(operand)) {
          errors.push(
            `${file}:${lineOf(source, open)} repeats the condition operand ` +
              `\`${operand}\`; one half can never change the result`,
          );
        }
        seen.add(operand);
      }
    }
  }
}

const CORPUS_ITERATION =
  /\bfor\s*\(\s*const\s+[^)]*\bof\s+[^)]*\.(?:cases|vectors|fixtures)\b|\.(?:cases|vectors)\.(?:map|forEach|every|some)\s*\(|\bfixtureNames\s*\(/;

/** Extracts each top-level `export function name(...) { ... }` body. */
function exportedFunctions(code) {
  const functions = [];
  for (const match of code.matchAll(/export\s+function\s+([A-Za-z0-9_]+)\s*\(/g)) {
    const open = code.indexOf("{", match.index);
    if (open === -1) continue;
    let depth = 0;
    let index = open;
    while (index < code.length) {
      if (code[index] === "{") depth += 1;
      else if (code[index] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
      index += 1;
    }
    functions.push({
      name: match[1],
      start: match.index,
      body: code.slice(open, index + 1),
    });
  }
  return functions;
}

/**
 * Whether a function body compares a corpus size against anything.
 *
 * Counts both the direct form and the one `validateRejectionLayers` uses, where
 * the length is captured first and the comparison happens against the variable.
 */
function countIsChecked(body) {
  if (/\.length\s*(?:<|>=|!==|===|>|<=)/.test(body)) return true;
  for (const match of body.matchAll(
    /(?:const|let)\s+([A-Za-z0-9_]+)\s*=[^;]*\.length\b/g,
  )) {
    if (new RegExp(`\\b${match[1]}\\s*(?:<|>=|!==|===|>|<=)`).test(body)) {
      return true;
    }
  }
  return false;
}

/**
 * Rule 2: a validator that walks a corpus without ever asking how big it was.
 *
 * A loop over an empty array reports no errors, which reads as conformance. The
 * fix is always the same -- compare the length against a declared floor -- so
 * the rule asks only that some length comparison exists in the same function.
 */
function corpusLoopsWithoutCount(errors) {
  for (const file of sourceFiles()) {
    if (file.includes(".test.")) continue;
    const source = read(file);
    const code = blankNonCode(source);
    for (const fn of exportedFunctions(code)) {
      if (!fn.name.startsWith("validate")) continue;
      if (!CORPUS_ITERATION.test(fn.body)) continue;
      if (countIsChecked(fn.body)) continue;
      errors.push(
        `${file}:${lineOf(source, fn.start)} ${fn.name} iterates a corpus but ` +
          "never checks how many cases it saw; an emptied corpus would report " +
          "no errors",
      );
    }
  }
}

/**
 * Rule 3: a test that asserts exactly what the implementation already asserts.
 *
 * `assert.ok(cases.length >= FLOOR)` cannot fail while the validator enforcing
 * the same inequality is green, so lowering `FLOOR` satisfies both and the
 * floor stops being load-bearing. A floor is pinned by comparing it against a
 * literal, or by shrinking the corpus and expecting the error.
 */
function tautologicalFloorAssertions(errors) {
  const floorNames = new Set();
  for (const file of sourceFiles()) {
    if (file.includes(".test.")) continue;
    for (const match of blankNonCode(read(file)).matchAll(
      /(?:const|let)\s+([A-Za-z0-9_]*(?:FLOOR|Floor)[A-Za-z0-9_]*)\s*=/g,
    )) {
      floorNames.add(match[1]);
    }
  }
  if (floorNames.size === 0) return;
  const pattern = new RegExp(
    `assert[^\\n]*\\.length\\s*(?:>=|>|<|<=)\\s*(${[...floorNames].join("|")})\\b`,
    "g",
  );
  for (const file of sourceFiles()) {
    if (!file.includes(".test.")) continue;
    const source = read(file);
    for (const match of blankNonCode(source).matchAll(pattern)) {
      errors.push(
        `${file}:${lineOf(source, match.index)} asserts a corpus length against ` +
          `${match[1]}, which the implementation already enforces; the ` +
          "assertion cannot fail. Pin the floor against a literal, or shrink " +
          "the corpus and expect the error",
      );
    }
  }
}

export function checkGuardVacuity() {
  const errors = [];
  duplicateOperands(errors);
  corpusLoopsWithoutCount(errors);
  tautologicalFloorAssertions(errors);
  return errors;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const errors = checkGuardVacuity();
  for (const error of errors) console.error(`- ${error}`);
  console.log(
    errors.length === 0
      ? `No vacuous guards in ${sourceFiles().length} files under ${relative(root, root) || "protocol"}/tools and /browser.`
      : `${errors.length} vacuous guard(s).`,
  );
  process.exitCode = errors.length > 0 ? 1 : 0;
}
