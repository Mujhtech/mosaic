import type {
  MotionEasing,
  PaywallDesignSystem,
} from "@/features/paywall-editor/types/editor";
import { cloneValue } from "@/features/paywall-editor/utils/clone";
import type { DesignCategory } from "@/features/paywall-editor/utils/style-authoring";
import type {
  MosaicPaywallV04BackgroundToken,
  MosaicPaywallV04ColorToken,
  MosaicPaywallV04MotionToken,
  MosaicPaywallV04ShadowToken,
} from "@/lib/mosaic-protocol";

export type DesignToken =
  | MosaicPaywallV04ColorToken
  | MosaicPaywallV04BackgroundToken
  | MosaicPaywallV04ShadowToken
  | MosaicPaywallV04MotionToken;

export interface PendingDelete {
  readonly category: DesignCategory;
  readonly id: string;
}

export const FIELD_CLASS =
  "border-input bg-background focus:border-ring focus:ring-ring/30 h-8 min-w-0 rounded border px-2 text-xs outline-none focus:ring-2";

/** The four normative easing presets, in the contract's own order. */
export const MOTION_EASING_OPTIONS: readonly {
  readonly description: string;
  readonly label: string;
  readonly value: MotionEasing;
}[] = [
  { description: "No shaping", label: "Linear", value: "linear" },
  {
    description: "Starts and ends on screen",
    label: "Standard",
    value: "standard",
  },
  {
    description: "Something entering; fast in, settles",
    label: "Decelerate",
    value: "decelerate",
  },
  {
    description: "Something leaving; slow out, speeds up",
    label: "Accelerate",
    value: "accelerate",
  },
];

/** Durations are whole milliseconds, bounded by the contract at 0 to 2000. */
export const MOTION_DURATION_MINIMUM = 0;
export const MOTION_DURATION_MAXIMUM = 2000;

/**
 * A duration the contract will accept.
 *
 * An empty number input reads back as NaN, which would otherwise reach the
 * document and fail schema validation with a message about a type rather than
 * about the field the author was editing.
 */
export function clampMotionDuration(candidate: number): number {
  if (!Number.isFinite(candidate)) {
    return MOTION_DURATION_MINIMUM;
  }
  return Math.min(
    MOTION_DURATION_MAXIMUM,
    Math.max(MOTION_DURATION_MINIMUM, Math.round(candidate))
  );
}

export function replaceTokenReferences(
  value: unknown,
  referenceType: string,
  id: string,
  replacement: unknown
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) =>
      replaceTokenReferences(entry, referenceType, id, replacement)
    );
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const record = value as Record<string, unknown>;
  if (record.type === referenceType && record.id === id) {
    return cloneValue(replacement);
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [
      key,
      replaceTokenReferences(entry, referenceType, id, replacement),
    ])
  );
}

export function countTokenReferences(
  value: unknown,
  referenceType: string,
  id: string
): number {
  if (Array.isArray(value)) {
    return value.reduce(
      (total, entry) => total + countTokenReferences(entry, referenceType, id),
      0
    );
  }
  if (!value || typeof value !== "object") {
    return 0;
  }
  const record = value as Record<string, unknown>;
  return (
    (record.type === referenceType && record.id === id ? 1 : 0) +
    Object.values(record).reduce<number>(
      (total, entry) => total + countTokenReferences(entry, referenceType, id),
      0
    )
  );
}

export function nextTokenId(tokens: readonly DesignToken[], prefix: string) {
  const used = new Set(tokens.map((token) => token.id));
  let ordinal = tokens.length + 1;
  while (used.has(`${prefix}-${ordinal}`)) {
    ordinal += 1;
  }
  return `${prefix}-${ordinal}`;
}

export function tokensFor(
  system: PaywallDesignSystem,
  category: DesignCategory
): readonly DesignToken[] {
  if (category === "colors") {
    return system.colors;
  }
  if (category === "backgrounds") {
    return system.backgrounds;
  }
  if (category === "motions") {
    return "motions" in system ? system.motions : [];
  }
  return system.shadows;
}

/**
 * Drop a token from one catalog, leaving the other three untouched.
 *
 * Written once over `DesignCategory` rather than as a branch per catalog: the
 * filter is identical for all four, and a fourth copy of it was the shape the
 * motions catalog would otherwise have added.
 */
export function withoutToken(
  system: PaywallDesignSystem,
  category: DesignCategory,
  id: string
): PaywallDesignSystem {
  return {
    ...system,
    [category]: tokensFor(system, category).filter((token) => token.id !== id),
  } as PaywallDesignSystem;
}

/** The id stem new tokens in a catalog are numbered from. */
function tokenIdPrefix(category: DesignCategory) {
  if (category === "colors") {
    return "colour";
  }
  if (category === "backgrounds") {
    return "background";
  }
  return category === "motions" ? "motion" : "shadow";
}

/**
 * Append a copy of one token, leaving the other catalogs untouched.
 *
 * Generic over the category for the same reason `withoutToken` is: the four
 * catalogs duplicate identically, and a per-catalog branch was the shape that
 * made adding a fourth catalog a four-place edit.
 */
export function withDuplicatedToken(
  system: PaywallDesignSystem,
  category: DesignCategory,
  id: string
): PaywallDesignSystem {
  const tokens = tokensFor(system, category);
  const source = tokens.find((token) => token.id === id);
  if (!source) {
    return system;
  }
  return {
    ...system,
    [category]: [
      ...tokens,
      {
        ...cloneValue(source),
        id: nextTokenId(tokens, tokenIdPrefix(category)),
        name: `${source.name} copy`,
      },
    ],
  } as PaywallDesignSystem;
}

/** Move one token within its catalog, clamped at both ends. */
export function withMovedToken(
  system: PaywallDesignSystem,
  category: DesignCategory,
  id: string,
  offset: -1 | 1
): PaywallDesignSystem {
  const tokens = tokensFor(system, category);
  const index = tokens.findIndex((token) => token.id === id);
  const target = index + offset;
  if (index < 0 || target < 0 || target >= tokens.length) {
    return system;
  }
  const next = [...tokens];
  const [moved] = next.splice(index, 1);
  if (moved) {
    next.splice(target, 0, moved);
  }
  return { ...system, [category]: next } as PaywallDesignSystem;
}
