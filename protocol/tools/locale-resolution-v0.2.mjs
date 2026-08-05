import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const toolsDirectory = dirname(fileURLToPath(import.meta.url));
export const localeResolutionV02Root = resolve(toolsDirectory, "..");
export const localeResolutionV02Paths = Object.freeze({
  fixture: resolve(localeResolutionV02Root, "fixtures/v0.2/locale-resolution.json"),
});

export function loadLocaleResolutionV02Artifacts() {
  return { fixture: JSON.parse(readFileSync(localeResolutionV02Paths.fixture, "utf8")) };
}

/**
 * The canonical comparison form of one locale tag.
 *
 * This is deliberately the same normalization the Placement decision evaluator
 * applies to `application.locale` (see
 * `placement-decision-validation-v1.mjs`): underscores become hyphens, empty
 * subtags are dropped, the tag is truncated at the first singleton subtag
 * (`-u-`, `-t-`, `-x-`), language is lowercase, script is title case, and a
 * two-letter or three-digit region is uppercase. Targeting and catalog lookup
 * must agree on what "the same locale" means, so they share one rule.
 *
 * The value is first cut at `@`, `.`, or `#`: a host reports an ICU identifier,
 * not a language tag, and `en_US@rg=gbzzzz`, `en_US.UTF-8`, and
 * `en_US_#u-rg-gbzzzz` (Java `Locale.toString`) all denote `en-US`.
 *
 * Returns `null` when nothing usable remains, which resolution treats as "no
 * requested locale" rather than as a match.
 */
export function canonicalLocaleTag(value) {
  if (typeof value !== "string") return null;
  const parts = [];
  for (const part of value.trim().split(/[@.#]/, 1)[0].replaceAll("_", "-").split("-")) {
    if (part.length === 0) continue;
    if (part.length === 1) break;
    parts.push(part);
  }
  if (
    parts.length === 0 ||
    parts.length > 8 ||
    !/^[A-Za-z]{2,8}$/.test(parts[0]) ||
    parts.slice(1).some((part) => !/^[A-Za-z0-9]{1,8}$/.test(part))
  ) {
    return null;
  }
  return parts
    .map((part, index) => {
      if (index === 0) return part.toLowerCase();
      if (/^[A-Za-z]{4}$/.test(part)) return `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}`;
      if (/^(?:[A-Za-z]{2}|[0-9]{3})$/.test(part)) return part.toUpperCase();
      return part.toLowerCase();
    })
    .join("-");
}

/**
 * The requested locale as a catalog candidate.
 *
 * Catalog lookup recovers the leading language subtag when the whole tag cannot
 * be canonicalized, so `en-US-verylongsubtag` still reaches the `en` catalog.
 * Placement targeting deliberately does *not* do this: retargeting a malformed
 * tag onto a broader language changes which users match a Rule, which is a
 * monetization decision, whereas here the chain would fall through to the
 * document's own fallback anyway and the worst outcome of recovery is a
 * less-specific translation of the author's own copy.
 */
export function canonicalRequestedLocaleTag(value) {
  const canonical = canonicalLocaleTag(value);
  if (canonical !== null) return canonical;
  if (typeof value !== "string") return null;
  return canonicalLocaleTag(value.trim().split(/[@.#]/, 1)[0].replaceAll("_", "-").split("-")[0]);
}

/**
 * The ordered catalog candidates for one requested locale, in Protocol 0.2
 * order: canonical requested tag, its base language, the declared fallback
 * locale, then the declared default locale.
 *
 * The candidates are catalog *keys*, not necessarily declared catalogs: a
 * candidate that no catalog declares is simply skipped at lookup time. A
 * requested tag carrying a script subtag (`zh-Hans-CN`) therefore reduces to
 * its base language (`zh`); 0.2 defines no language+region reduction step, so
 * `zh-CN` is not a candidate. See `docs/protocol/v0.2.md`.
 */
export function localeCandidatesV02(localization, requestedLocale) {
  const candidates = [];
  const append = (value) => {
    if (typeof value === "string" && value.length > 0 && !candidates.includes(value)) candidates.push(value);
  };
  const requested = canonicalRequestedLocaleTag(requestedLocale);
  append(requested);
  if (requested !== null) append(requested.split("-")[0]);
  append(localization.fallbackLocale);
  append(localization.defaultLocale);
  return candidates;
}

/**
 * The catalog a requested locale resolves to, or `null` when the document
 * declares none of the candidates.
 */
export function resolveLocaleCatalogV02(localization, requestedLocale) {
  const declared = new Set(Array.isArray(localization.locales) ? localization.locales : Object.keys(localization.locales ?? {}));
  const candidates = localeCandidatesV02(localization, requestedLocale);
  return { candidates, resolved: candidates.find((candidate) => declared.has(candidate)) ?? null };
}

export function validateLocaleResolutionV02Artifacts(artifacts = loadLocaleResolutionV02Artifacts()) {
  const errors = [];
  const { localization, cases } = artifacts.fixture;
  const declared = new Set(localization.locales);
  for (const locale of [localization.defaultLocale, localization.fallbackLocale]) {
    if (!declared.has(locale)) errors.push(`locale resolution fixture declares no catalog for ${locale}`);
  }
  for (const locale of localization.locales) {
    if (!/^[a-z]{2,3}(?:-(?:[A-Z]{2}|[0-9]{3}))?$/.test(locale)) errors.push(`locale resolution fixture catalog key ${locale} is not a valid Protocol 0.2 locale tag`);
  }
  for (const testCase of cases) {
    const actual = resolveLocaleCatalogV02(localization, testCase.requested);
    if (JSON.stringify(actual.candidates) !== JSON.stringify(testCase.expectedCandidates)) {
      errors.push(`locale resolution case ${testCase.name} expected candidates ${JSON.stringify(testCase.expectedCandidates)} but received ${JSON.stringify(actual.candidates)}`);
    }
    if (actual.resolved !== testCase.expectedCatalog) {
      errors.push(`locale resolution case ${testCase.name} expected catalog ${JSON.stringify(testCase.expectedCatalog)} but received ${JSON.stringify(actual.resolved)}`);
    }
  }
  return errors;
}

export function validateLocaleResolutionV02JsonFormatting() {
  return [localeResolutionV02Paths.fixture].flatMap((path) => {
    const source = readFileSync(path, "utf8");
    return source === `${JSON.stringify(JSON.parse(source), null, 2)}\n`
      ? []
      : [`${relative(localeResolutionV02Root, path)} is not canonical JSON`];
  });
}
