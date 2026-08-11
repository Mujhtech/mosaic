/**
 * Figma layer names are free text. The protocol's `identifier` and
 * `localizationKey` are not, and they use *different* alphabets:
 *
 *   identifier      ^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$      (hyphen allowed)
 *   localizationKey ^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$ (no hyphen, dotted)
 *
 * So a layer name is slugified twice, with two different separators.
 */

/** `#/$defs/identifier` maxLength. */
const IDENTIFIER_MAX_LENGTH = 128;

/** `#/$defs/localizationKey` maxLength. */
const LOCALIZATION_KEY_MAX_LENGTH = 256;

/** Room for the `figma.` namespace and a de-duplication suffix. */
const LOCALIZATION_KEY_SEGMENT_MAX_LENGTH = 120;

function normalizeWords(value: string): readonly string[] {
  return value
    .normalize("NFKD")
    // Strip combining marks so "Café" slugs to "cafe" rather than losing the e.
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
}

function truncate(value: string, max: number, separator: string): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  // Never end on the separator: "a-b-" is not a valid identifier.
  const lastSeparator = cut.lastIndexOf(separator);
  const trimmed = cut.endsWith(separator)
    ? cut.slice(0, lastSeparator)
    : cut;
  return trimmed.length > 0 ? trimmed : cut.slice(0, 1);
}

/**
 * A protocol `identifier` derived from a layer name.
 *
 * `fallback` covers names with nothing slugifiable in them (emoji-only layers,
 * "···", the empty string). A leading digit is prefixed rather than dropped, so
 * "2 columns" stays distinguishable from "columns".
 */
export function slugifyIdentifier(name: string, fallback = "node"): string {
  const words = normalizeWords(name);
  if (words.length === 0) return fallback;
  let slug = words.join("-");
  if (!/^[a-z]/.test(slug)) slug = `n-${slug}`;
  return truncate(slug, IDENTIFIER_MAX_LENGTH, "-");
}

/** The same derivation in the localization-key alphabet: underscores, no hyphens. */
export function slugifyKeySegment(name: string, fallback = "text"): string {
  const words = normalizeWords(name);
  if (words.length === 0) return fallback;
  let slug = words.join("_");
  if (!/^[a-z]/.test(slug)) slug = `n_${slug}`;
  // Bounded well below the key limit so the "figma." namespace and any
  // de-duplication suffix always fit.
  return truncate(slug, LOCALIZATION_KEY_SEGMENT_MAX_LENGTH, "_");
}

/**
 * Hands out unique names in one namespace.
 *
 * Duplicate layer names are the norm in Figma ("Frame 12" three times over),
 * and the validator rejects a layout tree with a duplicate id, so every emitted
 * id and localization key goes through one of these.
 */
export class NameAllocator {
  readonly #taken = new Set<string>();
  readonly #separator: string;
  readonly #maxLength: number;

  constructor(separator: "-" | "_", maxLength: number) {
    this.#separator = separator;
    this.#maxLength = maxLength;
  }

  /** Reserve `candidate`, suffixing `-2`, `-3`, ... until it is free. */
  allocate(candidate: string): string {
    if (!this.#taken.has(candidate)) {
      this.#taken.add(candidate);
      return candidate;
    }
    for (let counter = 2; ; counter += 1) {
      const suffix = `${this.#separator}${counter}`;
      const base = truncate(
        candidate,
        this.#maxLength - suffix.length,
        this.#separator,
      );
      const next = `${base}${suffix}`;
      if (!this.#taken.has(next)) {
        this.#taken.add(next);
        return next;
      }
    }
  }

  has(candidate: string): boolean {
    return this.#taken.has(candidate);
  }
}

export function identifierAllocator(): NameAllocator {
  return new NameAllocator("-", IDENTIFIER_MAX_LENGTH);
}

export function localizationKeyAllocator(): NameAllocator {
  return new NameAllocator("_", LOCALIZATION_KEY_MAX_LENGTH);
}

export { IDENTIFIER_MAX_LENGTH, LOCALIZATION_KEY_MAX_LENGTH };
