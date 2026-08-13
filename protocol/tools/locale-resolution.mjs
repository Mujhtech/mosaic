import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const toolsDirectory = dirname(fileURLToPath(import.meta.url));
export const localeResolutionRoot = resolve(toolsDirectory, "..");
export const localeResolutionPaths = Object.freeze({
  fixture: resolve(localeResolutionRoot, "fixtures/v0.4/locale-resolution.json"),
});

export function loadLocaleResolutionArtifacts() {
  return { fixture: JSON.parse(readFileSync(localeResolutionPaths.fixture, "utf8")) };
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
 * The ordered catalog candidates for one requested locale, in Protocol 0.3
 * order: canonical requested tag, its base language, the declared fallback
 * locale, then the declared default locale.
 *
 * The candidates are catalog *keys*, not necessarily declared catalogs: a
 * candidate that no catalog declares is simply skipped at lookup time. A
 * requested tag carrying a script subtag (`zh-Hans-CN`) therefore reduces to
 * its base language (`zh`); 0.3 defines no language+region reduction step, so
 * `zh-CN` is not a candidate. See `docs/protocol/v0.4.md`.
 */
/**
 * A refusal to resolve, rather than a plausible-looking answer over nothing.
 *
 * `localization` is required by the 0.3 schema to carry `defaultLocale`,
 * `fallbackLocale`, and a non-empty `locales`. A document missing any of them
 * never passed validation, and the honest response is to say so: defaulting the
 * catalog set to `{}` would report "the document declares none of the
 * candidates", which is the same answer a well-formed document with an
 * unsupported locale gets, and the terminal guarantee of the chain -- that the
 * default locale always resolves -- would be silently gone.
 */
export class LocaleResolutionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "LocaleResolutionError";
    this.code = code;
  }
}

function declaredCatalogKeys(localization) {
  if (localization === null || typeof localization !== "object" || Array.isArray(localization)) {
    throw new LocaleResolutionError("invalid_localization", `Locale resolution requires the document's localization object; received ${JSON.stringify(localization)}`);
  }
  // The 0.3 schema declares `locales` as an object keyed by locale tag. The
  // cross-SDK corpus states the same set as an array, since it has no catalogs
  // to carry; both are accepted, nothing else is.
  const keys = Array.isArray(localization.locales)
    ? localization.locales
    : localization.locales !== null && typeof localization.locales === "object"
      ? Object.keys(localization.locales)
      : null;
  if (keys === null || keys.length === 0) {
    throw new LocaleResolutionError("no_declared_catalogs", `Locale resolution requires a non-empty localization.locales; received ${JSON.stringify(localization.locales)}`);
  }
  for (const field of ["defaultLocale", "fallbackLocale"]) {
    if (typeof localization[field] !== "string" || localization[field].length === 0) {
      throw new LocaleResolutionError("missing_terminal_locale", `Locale resolution requires localization.${field}; without it the candidate chain has no terminal fallback and an unsupported locale would resolve to nothing`);
    }
  }
  return new Set(keys);
}

export function localeCandidates(localization, requestedLocale) {
  declaredCatalogKeys(localization);
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
export function resolveLocaleCatalog(localization, requestedLocale) {
  const declared = declaredCatalogKeys(localization);
  const candidates = localeCandidates(localization, requestedLocale);
  return { candidates, resolved: candidates.find((candidate) => declared.has(candidate)) ?? null };
}

/**
 * The size the corpus had when the resolution rulings it pins were approved.
 * The loop below reports no errors over an empty `cases`, so a truncated corpus
 * would read as perfect conformance on every SDK that consumes it.
 */
const LOCALE_RESOLUTION_CASE_FLOOR = 13;

export function validateLocaleResolutionArtifacts(artifacts = loadLocaleResolutionArtifacts()) {
  const errors = [];
  const { localization, cases } = artifacts.fixture;
  if (!Array.isArray(cases) || cases.length < LOCALE_RESOLUTION_CASE_FLOOR) {
    errors.push(`locale resolution corpus holds ${Array.isArray(cases) ? cases.length : "no array"} cases, below the floor of ${LOCALE_RESOLUTION_CASE_FLOOR}; a conformance loop over a shrunken corpus passes vacuously`);
  }
  if (Array.isArray(cases)) {
    const names = cases.map((testCase) => testCase.name);
    if (new Set(names).size !== names.length) errors.push("locale resolution case names must be unique");
  }
  const declared = new Set(localization.locales);
  for (const locale of [localization.defaultLocale, localization.fallbackLocale]) {
    if (!declared.has(locale)) errors.push(`locale resolution fixture declares no catalog for ${locale}`);
  }
  for (const locale of localization.locales) {
    if (!/^[a-z]{2,3}(?:-(?:[A-Z]{2}|[0-9]{3}))?$/.test(locale)) errors.push(`locale resolution fixture catalog key ${locale} is not a valid Protocol 0.3 locale tag`);
  }
  for (const testCase of Array.isArray(cases) ? cases : []) {
    const actual = resolveLocaleCatalog(localization, testCase.requested);
    if (JSON.stringify(actual.candidates) !== JSON.stringify(testCase.expectedCandidates)) {
      errors.push(`locale resolution case ${testCase.name} expected candidates ${JSON.stringify(testCase.expectedCandidates)} but received ${JSON.stringify(actual.candidates)}`);
    }
    if (actual.resolved !== testCase.expectedCatalog) {
      errors.push(`locale resolution case ${testCase.name} expected catalog ${JSON.stringify(testCase.expectedCatalog)} but received ${JSON.stringify(actual.resolved)}`);
    }
  }
  return errors;
}

export function validateLocaleResolutionJsonFormatting() {
  return [localeResolutionPaths.fixture].flatMap((path) => {
    const source = readFileSync(path, "utf8");
    return source === `${JSON.stringify(JSON.parse(source), null, 2)}\n`
      ? []
      : [`${relative(localeResolutionRoot, path)} is not canonical JSON`];
  });
}
