import type { PreviewClient } from "@/features/paywall-editor/types/editor"
import { useComponentTreeModel } from "./component-tree-controller"
import { ComponentTreeView } from "./component-tree-view"

export function ComponentTree({ previewClients }: { previewClients: readonly PreviewClient[] }) {
  const model = useComponentTreeModel({ previewClients })
  return model ? <ComponentTreeView model={model} /> : null
}
