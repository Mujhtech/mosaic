import type { AppearanceValue } from "@/features/paywall-editor/components/property-inspector-core";
import type { ProtocolNode } from "@/features/paywall-editor/types/editor";

export function updateAppearance(
  node: ProtocolNode,
  updater: (appearance: AppearanceValue) => AppearanceValue
) {
  return {
    ...node,
    appearance: updater(
      ("appearance" in node ? node.appearance : undefined) ?? {}
    ),
  } as ProtocolNode;
}
