import type { MosaicDocument } from "@/features/paywall-editor/types/editor";
import type { MosaicPaywallV03Document } from "@/lib/mosaic-protocol";

/**
 * Narrow an editor document to the 0.3 branch, for fixtures that author 0.3.
 *
 * The editor's tree operations take and return the version union, because they
 * work on either contract. A 0.3 fixture that puts a 0.3 document through one
 * of them gets the union back, and the tests below then want the concrete 0.3
 * node types again.
 *
 * This is a real check on the discriminant rather than an assertion: if a tree
 * operation ever changed the version of the document it was handed -- which
 * would be a bug, since only the explicit upgrade command may do that -- the
 * fixture fails here instead of silently proving the wrong thing.
 */
export function v03(document: MosaicDocument): MosaicPaywallV03Document {
  if (document.schemaVersion !== "0.3") {
    throw new Error(
      `Expected a 0.3 document, received schemaVersion ${document.schemaVersion}.`
    );
  }
  return document;
}
