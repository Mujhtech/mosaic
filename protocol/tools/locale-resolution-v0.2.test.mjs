import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalLocaleTag,
  canonicalRequestedLocaleTag,
  localeCandidatesV02,
  loadLocaleResolutionV02Artifacts,
  resolveLocaleCatalogV02,
  validateLocaleResolutionV02Artifacts,
  validateLocaleResolutionV02JsonFormatting,
} from "./locale-resolution-v0.2.mjs";

test("the shared locale-resolution corpus matches the reference resolver", () => {
  assert.deepEqual(validateLocaleResolutionV02Artifacts(), []);
  assert.deepEqual(validateLocaleResolutionV02JsonFormatting(), []);
});

test("catalog lookup canonicalizes the runtime side to the authored grammar's casing", () => {
  // The authored grammar is canonical-case, so no two catalog keys can differ
  // only by case. A resolver that compared raw host strings would miss the one
  // catalog that exists, and would disagree with Placement targeting, which
  // already canonicalizes case.
  const localization = loadLocaleResolutionV02Artifacts().fixture.localization;
  for (const requested of ["pt-BR", "pt_br", "PT-br", "PT_BR", "pt-BR-u-nu-latn"]) {
    assert.equal(resolveLocaleCatalogV02(localization, requested).resolved, "pt-BR", requested);
  }
});

test("an ICU identifier denotes the locale before its keyword, charset, or extension marker", () => {
  // The original cross-SDK defect: a region-override or POSIX device asked for
  // en-US and silently read the document's default language, because the raw
  // identifier matched no catalog and failed the subtag grammar outright.
  for (const identifier of ["en_US@rg=gbzzzz", "en_US.UTF-8", "en_US_#u-rg-gbzzzz", "en-US-u-rg-gbzzzz"]) {
    assert.equal(canonicalLocaleTag(identifier), "en-US", identifier);
  }
  // Recovery is lookup-only: a tag that cannot be canonicalized still reaches
  // its language catalog rather than the document fallback.
  assert.equal(canonicalLocaleTag("en-US-verylongsubtag"), null);
  assert.equal(canonicalRequestedLocaleTag("en-US-verylongsubtag"), "en");
  assert.equal(canonicalRequestedLocaleTag("!!"), null);
});

test("a script subtag reaches the base language, not a language-region catalog", () => {
  // Protocol 0.2 defines no language+region reduction step: `zh-CN` is declared
  // here and must still not be a candidate for `zh-Hans-CN`. Recorded as a
  // known limitation rather than silently changed in an approved contract.
  const localization = loadLocaleResolutionV02Artifacts().fixture.localization;
  assert.deepEqual(localeCandidatesV02(localization, "zh-Hans-CN"), ["zh-Hans-CN", "zh", "en-GB", "en"]);
  assert.equal(resolveLocaleCatalogV02(localization, "zh-Hans-CN").resolved, "zh");
});

test("an unusable requested locale is absent rather than an accidental match", () => {
  for (const requested of ["", "   ", "!!", "x-private", "1234", null]) {
    assert.equal(canonicalLocaleTag(requested), null, JSON.stringify(requested));
  }
});
