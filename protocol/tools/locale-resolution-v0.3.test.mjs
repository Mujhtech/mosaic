import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalLocaleTag,
  canonicalRequestedLocaleTag,
  LocaleResolutionError,
  localeCandidatesV03,
  loadLocaleResolutionV03Artifacts,
  resolveLocaleCatalogV03,
  validateLocaleResolutionV03Artifacts,
  validateLocaleResolutionV03JsonFormatting,
} from "./locale-resolution-v0.3.mjs";
import { normalizeLocale } from "./placement-decision-validation-v1.mjs";

test("the shared locale-resolution corpus matches the reference resolver", () => {
  assert.deepEqual(validateLocaleResolutionV03Artifacts(), []);
  assert.deepEqual(validateLocaleResolutionV03JsonFormatting(), []);
});

test("a shrunken locale-resolution corpus fails instead of conforming over nothing", () => {
  // Regression: the conformance loop reports no errors over an empty `cases`,
  // so a corpus that failed to load, was truncated, or was renamed out from
  // under the loop would read as perfect conformance on every SDK.
  const artifacts = loadLocaleResolutionV03Artifacts();
  for (const cases of [[], artifacts.fixture.cases.slice(0, 2), undefined]) {
    const shrunken = { fixture: { ...structuredClone(artifacts.fixture), cases } };
    assert.ok(
      validateLocaleResolutionV03Artifacts(shrunken).some((error) =>
        error.includes("below the floor"),
      ),
      `expected a corpus-floor error for ${JSON.stringify(cases?.length ?? null)} cases`,
    );
  }
});

test("a localization block that never passed validation is refused, not resolved to null", () => {
  // Regression: `localization.locales ?? {}` reported "the document declares
  // none of the candidates" for a malformed document -- the same answer a
  // well-formed document with an unsupported locale gets -- and silently
  // dropped the chain's terminal guarantee that the default locale resolves.
  const { localization } = loadLocaleResolutionV03Artifacts().fixture;
  const refusals = [
    [undefined, "invalid_localization"],
    [{ ...localization, locales: undefined }, "no_declared_catalogs"],
    [{ ...localization, locales: [] }, "no_declared_catalogs"],
    [{ ...localization, locales: "en" }, "no_declared_catalogs"],
    [{ ...localization, defaultLocale: undefined }, "missing_terminal_locale"],
    [{ ...localization, fallbackLocale: undefined }, "missing_terminal_locale"],
  ];
  for (const [broken, code] of refusals) {
    for (const call of [
      () => localeCandidatesV03(broken, "pt-BR"),
      () => resolveLocaleCatalogV03(broken, "pt-BR"),
    ]) {
      assert.throws(
        call,
        (error) => error instanceof LocaleResolutionError && error.code === code,
        `expected ${code} for ${JSON.stringify(broken?.locales ?? broken)}`,
      );
    }
  }
});

test("both reference normalizers really do share one rule", () => {
  // `canonicalLocaleTag` documents itself as deliberately the same
  // normalization Placement targeting applies, but they are two
  // implementations in two files. Nothing but this test stops one from being
  // corrected and the other left behind, at which point targeting and catalog
  // lookup would disagree about what "the same locale" means -- silently, since
  // each corpus only checks its own side.
  const inputs = [
    "pt-BR", "pt_br", "PT-br", "PT_BR", "en", "EN", "zh-Hans-CN", "zh_hans_cn",
    "es-419", "es_419", "en-US-u-rg-gbzzzz", "en_US@rg=gbzzzz", "en_US.UTF-8",
    "en_US_#u-rg-gbzzzz", "en--US", "en-US-", "  en-US  ", "x-private",
    "en-US-verylongsubtag", "", "   ", "!!", "1234", "e", "a-b-c",
    "en-Latn-US-a-b-c-d-e-f", null, undefined, 42, {},
  ];
  for (const input of inputs) {
    assert.equal(
      canonicalLocaleTag(input),
      normalizeLocale(input),
      `normalizers disagree on ${JSON.stringify(input)}`,
    );
  }
});

test("catalog lookup canonicalizes the runtime side to the authored grammar's casing", () => {
  // The authored grammar is canonical-case, so no two catalog keys can differ
  // only by case. A resolver that compared raw host strings would miss the one
  // catalog that exists, and would disagree with Placement targeting, which
  // already canonicalizes case.
  const localization = loadLocaleResolutionV03Artifacts().fixture.localization;
  for (const requested of ["pt-BR", "pt_br", "PT-br", "PT_BR", "pt-BR-u-nu-latn"]) {
    assert.equal(resolveLocaleCatalogV03(localization, requested).resolved, "pt-BR", requested);
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
  // Protocol 0.3 defines no language+region reduction step: `zh-CN` is declared
  // here and must still not be a candidate for `zh-Hans-CN`. Recorded as a
  // known limitation rather than silently changed in an approved contract.
  const localization = loadLocaleResolutionV03Artifacts().fixture.localization;
  assert.deepEqual(localeCandidatesV03(localization, "zh-Hans-CN"), ["zh-Hans-CN", "zh", "en-GB", "en"]);
  assert.equal(resolveLocaleCatalogV03(localization, "zh-Hans-CN").resolved, "zh");
});

test("an unusable requested locale is absent rather than an accidental match", () => {
  for (const requested of ["", "   ", "!!", "x-private", "1234", null]) {
    assert.equal(canonicalLocaleTag(requested), null, JSON.stringify(requested));
  }
});
