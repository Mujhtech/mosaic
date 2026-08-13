/**
 * Shape heuristics: which frames read as buttons, and which read as plan cards.
 *
 * Figma carries no semantics, so both of these are guesses. They differ in what
 * a wrong guess costs, and the two are treated accordingly:
 *
 * - A frame detected as a **button** is emitted as a `button` node with a
 *   placeholder action. Wrong, that is a stack rendered slightly differently
 *   and one field to fix in Studio.
 * - A group detected as **plan cards** changes nothing about the emitted
 *   document; it only adds a suggestion to the report. Emitting a
 *   `productSelector` would mean fabricating `products[]` entries -- store
 *   identifiers the plugin cannot know -- and a fabricated product reference is
 *   a paywall that charges nothing.
 */

import { firstVisibleSolid } from "./color.js";
import type { IntermediateFrame, IntermediateNode } from "./intermediate.js";

/** Layer names that say "button" out loud. */
const BUTTON_NAME = /\b(button|btn|cta)\b/i;

/**
 * Text that reads as a price: a currency sign before digits, or a
 * two-decimal amount. Deliberately narrow -- "4.99", "$9", "£12,00" -- so a
 * feature list mentioning "1.5 GB" does not turn a section into plan cards.
 */
const PRICE_TEXT = /[$€£]\s?\d|\d+[.,]\d{2}/;

/** How many sibling frames must match before the suggestion is worth making. */
const MINIMUM_CARD_SIBLINGS = 2;

export function looksLikePrice(characters: string): boolean {
  return PRICE_TEXT.test(characters);
}

/** The single visible text child of a frame, when that is all it has. */
export function soleTextChild(frame: IntermediateFrame) {
  if (frame.children.length !== 1) return null;
  const [only] = frame.children;
  if (!only || only.kind !== "text" || !only.visible) return null;
  if (only.characters.trim().length === 0) return null;
  return only;
}

/**
 * Whether a frame should be emitted as a `button`.
 *
 * Two independent signals, either of which is enough:
 *
 *   painted   a solid fill and a rounded corner -- the shape of every tappable
 *             thing in a paywall -- wrapped around exactly one label
 *   named     the layer is called something with "button", "btn", or "cta" in
 *             it, and wraps exactly one label
 *
 * Both require the *only* child to be a non-empty visible text layer. A frame
 * with an icon beside its label stays a stack: the protocol's button would
 * accept the icon, but the plugin has no asset to put there, so it would ship a
 * button missing half its content.
 */
export function detectsAsButton(frame: IntermediateFrame): boolean {
  if (soleTextChild(frame) === null) return false;
  if (BUTTON_NAME.test(frame.name)) return true;
  const painted =
    firstVisibleSolid(frame.fills) !== null &&
    frame.cornerRadius !== null &&
    frame.cornerRadius > 0;
  return painted;
}

/**
 * Whether a frame, or anything visible inside it, will be emitted as a button.
 *
 * Multi-screen export needs to know this *before* mapping: the protocol
 * requires every screen to be reachable from the first, and the only edge a
 * plugin can honestly draw is repointing a detected button's placeholder
 * action at the next screen. A frame with no button is where a flow stops.
 */
export function containsDetectableButton(frame: IntermediateFrame): boolean {
  if (detectsAsButton(frame)) return true;
  return frame.children.some(
    (child) =>
      child.kind === "frame" && child.visible && containsDetectableButton(child),
  );
}

function containsPriceText(node: IntermediateNode): boolean {
  if (!node.visible) return false;
  if (node.kind === "text") return looksLikePrice(node.characters);
  if (node.kind !== "frame") return false;
  return node.children.some(containsPriceText);
}

/**
 * A frame's structural fingerprint: the kinds of its direct children, in
 * order. Two plan cards built from the same component have the same one; a
 * price tag sitting next to a paragraph does not.
 */
export function structureSignature(frame: IntermediateFrame): string {
  return frame.children
    .filter((child) => child.visible)
    .map((child) => child.kind)
    .join(",");
}

export type ProductCardCandidate = {
  /** The frame whose children look like a row or column of plan cards. */
  readonly parent: IntermediateFrame;
  /** The sibling frames themselves, in tree order. */
  readonly cards: readonly IntermediateFrame[];
};

/**
 * Sibling frames that look like a set of plan cards.
 *
 * Requires at least two visible sibling frames that share a structural
 * fingerprint and each contain price-shaped text. Both conditions matter: the
 * price alone would flag a single hero price, and the structure alone would
 * flag any repeated row.
 */
export function detectProductCardGroups(
  frame: IntermediateFrame,
): readonly IntermediateFrame[] {
  const candidates = frame.children.filter(
    (child): child is IntermediateFrame =>
      child.kind === "frame" && child.visible && containsPriceText(child),
  );
  if (candidates.length < MINIMUM_CARD_SIBLINGS) return [];

  const bySignature = new Map<string, IntermediateFrame[]>();
  for (const candidate of candidates) {
    const signature = structureSignature(candidate);
    const bucket = bySignature.get(signature);
    if (bucket) bucket.push(candidate);
    else bySignature.set(signature, [candidate]);
  }

  let best: IntermediateFrame[] = [];
  for (const bucket of bySignature.values()) {
    if (bucket.length > best.length) best = bucket;
  }
  return best.length >= MINIMUM_CARD_SIBLINGS ? best : [];
}
