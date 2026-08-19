import type {
  LocalizedText,
  MosaicDocument,
  ProtocolNode,
} from "@/features/paywall-editor/types/editor";
import { updateNode } from "@/features/paywall-editor/utils/document-tree-traversal";
import { createSeededLocalizedText } from "@/features/paywall-editor/utils/editor-transforms";

export function seedOptionalLocalizedText(options: {
  defaultValue: string;
  keyBase: string;
  nodeId: string;
  update: (node: ProtocolNode, text: LocalizedText) => ProtocolNode;
}) {
  return (document: MosaicDocument) => {
    const seeded = createSeededLocalizedText({
      document,
      defaultValue: options.defaultValue,
      keyBase: options.keyBase,
    });
    return updateNode(seeded.document, options.nodeId, (node) =>
      options.update(node, seeded.text)
    );
  };
}
