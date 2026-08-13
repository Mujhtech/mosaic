import type {
  AuthoredNodeMotion,
  DocumentCompatibility,
  MosaicDocument,
  MotionToken,
  ProductBadgeComponent,
  ProductCardComponent,
  ProtocolBackground,
  ProtocolColor,
  ProtocolNode,
  ProtocolShadow,
  Screen,
} from "@/features/paywall-editor/types/editor";
import {
  expectedDocumentCapabilities as expectedCapabilities,
  type MosaicPaywallV03CapabilityName,
  type MosaicPaywallV03Document,
  type MosaicPaywallV03ProductBadgeComponent,
  type MosaicPaywallV03ProductCardComponent,
  type MosaicPaywallV04CapabilityName,
  type MosaicPaywallV04Document,
  motionCapabilitiesFor,
  paywallContractVersion,
  paywallDocumentVersion,
  paywallV04ContractVersion,
  resolveBackgroundToken,
  resolveColorToken,
  resolveMediaBackgroundFallback,
  resolveProductBadgeStyle,
  resolveProductCardStyle,
  resolveShadowToken,
  runtimeStateForAcceptedRevision,
} from "@/lib/mosaic-protocol";

/**
 * The contract version a document claims.
 *
 * Delegates to the protocol reference rather than reading `schemaVersion`
 * directly, so a document with a missing or unknown version reads as 0.3 here
 * exactly as it does inside the validator.
 */
export function documentSchemaVersion(document: MosaicDocument): "0.3" | "0.4" {
  return paywallDocumentVersion(document);
}

/**
 * Whether a document is on the contract that can carry motion.
 *
 * This is the narrowing every motion-authoring surface goes through: the
 * `motions` catalog and the per-node `motion` block exist only on 0.4, so a
 * 0.3 document must not be offered either.
 */
export function isMotionCapableDocument(
  document: MosaicDocument
): document is MosaicPaywallV04Document {
  return document.schemaVersion === paywallV04ContractVersion;
}

/**
 * The parts of a document the editor replaces wholesale.
 *
 * Keys are checked against the document shape -- a typo is still a compile
 * error -- while values are not, because every one of them is itself a union of
 * the two versions' shapes and the correlation is what TypeScript cannot see.
 */
type DocumentParts = {
  readonly [K in keyof MosaicPaywallV03Document]?: unknown;
};

/**
 * Replace parts of a document while preserving its contract version.
 *
 * `MosaicDocument` is a union discriminated on `schemaVersion`, and every part
 * above is itself a union of the two versions' shapes. TypeScript cannot verify
 * that the caller paired a 0.4 part with a 0.4 document -- it sees the cross
 * product of the branches, not the correlated pair -- so the branch is
 * re-attached here. Centralising it means the assertion is stated once, next to
 * the reason for it, instead of at each of the ~30 places the editor rebuilds a
 * document.
 *
 * The invariant callers must hold: parts are derived from `document`, so they
 * are already the version `document` claims.
 */
export function withDocumentParts<TDocument extends MosaicDocument>(
  document: TDocument,
  parts: DocumentParts
): TDocument {
  return { ...document, ...parts } as TDocument;
}

/**
 * Replace a node's child collection while preserving the node's contract
 * version, for the same reason `withDocumentParts` exists.
 *
 * Callers pass children produced by mapping the node's own children, so the
 * version is preserved by construction.
 */
/**
 * Replace parts of a screen while preserving its contract version, for the same
 * reason `withDocumentParts` exists.
 */
export function withScreenParts<TScreen extends Screen>(
  screen: TScreen,
  parts: { readonly [K in keyof Screen]?: unknown }
): TScreen {
  return { ...screen, ...parts } as TScreen;
}

export function withNodeParts<TNode extends ProtocolNode>(
  node: TNode,
  parts: { readonly [K in keyof TNode]?: unknown }
): TNode {
  return { ...node, ...parts } as TNode;
}

/**
 * Whether a 0.3 capability survives into 0.4.
 *
 * Exactly one does not. Written as a predicate rather than a cast so the
 * compiler checks the result really is a 0.4 capability name: if a later
 * contract removes a second capability, the `Exclude` stops matching and this
 * fails to compile instead of emitting a name 0.4 rejects.
 */
function isCapabilityKeptByV04(
  name: MosaicPaywallV03CapabilityName
): name is Exclude<MosaicPaywallV03CapabilityName, "style.productCardStates"> &
  MosaicPaywallV04CapabilityName {
  return name !== "style.productCardStates";
}

/**
 * The capabilities a document must declare, in canonical order.
 *
 * The protocol package's `requiredCapabilitiesFor` is **not** version-aware: it
 * stamps every entry `"0.3"`, still derives the `style.productCardStates`
 * capability that 0.4 removed, and does not add the `motion.*` capabilities at
 * all. Feeding its output into a 0.4 document produces a document the 0.4
 * validator rejects three ways over.
 *
 * The 0.4 answer is composed here from the two version-aware pieces the package
 * does expose -- `expectedDocumentCapabilities` for the shared derivation and
 * `motionCapabilitiesFor` for the motion triggers -- rather than by listing
 * capabilities by hand. The composition below reproduces
 * `protocol/fixtures/v0.4/complete-paywall.json` exactly, order included, which
 * is what the migration test pins.
 */
export function documentRequiredCapabilities(
  document: MosaicDocument
): DocumentCompatibility["requiredCapabilities"] {
  if (!isMotionCapableDocument(document)) {
    return expectedDocumentCapabilities(document).map((name) => ({
      name,
      version: paywallContractVersion,
    }));
  }
  const shared = expectedDocumentCapabilities(document).filter(
    isCapabilityKeptByV04
  );
  return [...shared, ...motionCapabilitiesFor(document)].map((name) => ({
    name,
    version: paywallV04ContractVersion,
  }));
}

/**
 * A node's motion block, read through the authoring shape.
 *
 * Narrowing the three trigger-specific shapes by `in` yields `{}` rather than
 * the member type, because they differ only in optional members. Reading them
 * through one shape is both what the authoring surface wants and the only form
 * TypeScript handles cleanly; writes still go back through the node's own type.
 */
export function nodeMotionOf(
  node: ProtocolNode
): AuthoredNodeMotion | undefined {
  return "motion" in node
    ? (node.motion as AuthoredNodeMotion | undefined)
    : undefined;
}

/** The motion tokens a document declares, empty for a 0.3 document. */
export function documentMotionTokens(
  document: MosaicDocument
): readonly MotionToken[] {
  return isMotionCapableDocument(document) ? document.designSystem.motions : [];
}

/**
 * Whether a node sits underneath another node that already carries `appear`.
 *
 * 0.4 rejects the document in that case: two entrance opacities multiply and
 * the three renderers compose that product at different points, so the contract
 * refuses rather than pinning an arithmetic no platform agrees on.
 */
export function findAppearAncestorId(
  document: MosaicDocument,
  nodeId: string
): string | null {
  if (!isMotionCapableDocument(document)) {
    return null;
  }
  let found: string | null = null;
  const visit = (node: ProtocolNode, appearAncestorId: string | null) => {
    if (found) {
      return;
    }
    if (node.id === nodeId) {
      found = appearAncestorId;
      return;
    }
    const nextAncestorId =
      "motion" in node && node.motion?.appear ? node.id : appearAncestorId;
    for (const child of childNodesOf(node)) {
      visit(child, nextAncestorId);
    }
  };
  for (const screen of document.screens) {
    visit(screen.layout.content, null);
  }
  return found;
}

/** Every descendant collection a node can carry, flattened. */
export function childNodesOf(node: ProtocolNode): readonly ProtocolNode[] {
  switch (node.type) {
    case "stack":
      return node.children;
    case "button":
      return [...node.children, ...(node.inProgressChildren ?? [])];
    case "carousel":
      return node.pages.map((page) => page.content);
    case "tabs":
      return node.tabs.map((tab) => tab.content);
    case "productSelector":
      return node.cards;
    case "productCard":
    case "productBadge":
      return node.children;
    default:
      return [];
  }
}

/**
 * Read a 0.4 document through the protocol package's 0.3-typed readers.
 *
 * `protocol/browser/index.d.ts` is generated and types `resolveColorToken`,
 * `resolveShadowToken`, `expectedDocumentCapabilities`,
 * `accessibilityAnnouncement` and friends for a 0.3 document, even though their
 * runtime is version-agnostic. That is a declaration gap, not a behavioural
 * one: each of those readers touches only structures 0.4 leaves byte-identical
 * -- the three shared token catalogs, the product-card styles, the node
 * appearance and accessibility members. 0.4 adds a fourth catalog and an
 * optional `motion` block; it changes none of what these readers read.
 *
 * The dashboard cannot fix the declarations (the package is generated and owned
 * elsewhere) and must not reimplement the readers (the protocol reference is
 * the single source of the derivation). So the variance is absorbed here, once,
 * rather than at each of the twenty-odd call sites.
 */
function asProtocolReaderDocument(
  document: MosaicDocument
): MosaicPaywallV03Document {
  return document as unknown as MosaicPaywallV03Document;
}

/** `resolveColorToken`, widened to either contract version. */
export function resolveDocumentColorToken(
  document: MosaicDocument,
  color: ProtocolColor
) {
  return resolveColorToken(asProtocolReaderDocument(document), color);
}

/** `resolveBackgroundToken`, widened to either contract version. */
export function resolveDocumentBackgroundToken(
  document: MosaicDocument,
  background: ProtocolBackground
) {
  return resolveBackgroundToken(asProtocolReaderDocument(document), background);
}

/** `resolveShadowToken`, widened to either contract version. */
export function resolveDocumentShadowToken(
  document: MosaicDocument,
  shadow: ProtocolShadow
) {
  return resolveShadowToken(asProtocolReaderDocument(document), shadow);
}

/** `resolveMediaBackgroundFallback`, widened to either contract version. */
export function resolveDocumentMediaBackgroundFallback(
  document: MosaicDocument,
  background: ProtocolBackground,
  availableAssetIds: readonly string[]
) {
  return resolveMediaBackgroundFallback(
    asProtocolReaderDocument(document),
    background,
    availableAssetIds
  );
}

/** `runtimeStateForAcceptedRevision`, widened to either contract version. */
export function documentRuntimeState(document: MosaicDocument) {
  return runtimeStateForAcceptedRevision(asProtocolReaderDocument(document));
}

/** `resolveProductCardStyle`, widened to either contract version. */
export function resolveCardStyle(
  productCard: ProductCardComponent,
  selected: boolean
) {
  return resolveProductCardStyle(
    productCard as MosaicPaywallV03ProductCardComponent,
    selected
  );
}

/** `resolveProductBadgeStyle`, widened to either contract version. */
export function resolveBadgeStyle(
  productBadge: ProductBadgeComponent,
  selected: boolean
) {
  return resolveProductBadgeStyle(
    productBadge as MosaicPaywallV03ProductBadgeComponent,
    selected
  );
}

/** `expectedDocumentCapabilities`, widened to either contract version. */
function expectedDocumentCapabilities(document: MosaicDocument) {
  return expectedCapabilities(asProtocolReaderDocument(document));
}
