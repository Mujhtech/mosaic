import { BrowserIcon } from "@phosphor-icons/react/dist/ssr/Browser"
import { CreditCardIcon } from "@phosphor-icons/react/dist/ssr/CreditCard"
import { CursorClickIcon } from "@phosphor-icons/react/dist/ssr/CursorClick"
import { SlideshowIcon } from "@phosphor-icons/react/dist/ssr/Slideshow"
import { ImageIcon } from "@phosphor-icons/react/dist/ssr/Image"
import { ListChecksIcon } from "@phosphor-icons/react/dist/ssr/ListChecks"
import { PackageIcon } from "@phosphor-icons/react/dist/ssr/Package"
import { ShapesIcon } from "@phosphor-icons/react/dist/ssr/Shapes"
import { StackIcon } from "@phosphor-icons/react/dist/ssr/Stack"
import { TextTIcon } from "@phosphor-icons/react/dist/ssr/TextT"
import { TimerIcon } from "@phosphor-icons/react/dist/ssr/Timer"
import { TagIcon } from "@phosphor-icons/react/dist/ssr/Tag"
import { ToggleRightIcon } from "@phosphor-icons/react/dist/ssr/ToggleRight"

import type { ProtocolNode } from "@/features/paywall-editor/types/editor"

export type LayerType = ProtocolNode["type"] | "scrollContainer"

export function LayerTypeIcon({ type }: { type: LayerType }) {
  const props = { "aria-hidden": true, "data-layer-type-icon": type } as const

  switch (type) {
    case "scrollContainer":
      return <BrowserIcon {...props} />
    case "stack":
      return <StackIcon {...props} />
    case "carousel":
      return <SlideshowIcon {...props} />
    case "switch":
      return <ToggleRightIcon {...props} />
    case "countdown":
      return <TimerIcon {...props} />
    case "text":
      return <TextTIcon {...props} />
    case "image":
      return <ImageIcon {...props} />
    case "icon":
      return <ShapesIcon {...props} />
    case "featureList":
      return <ListChecksIcon {...props} />
    case "productSelector":
      return <CreditCardIcon {...props} />
    case "productCard":
      return <PackageIcon {...props} />
    case "productBadge":
      return <TagIcon {...props} />
    case "button":
      return <CursorClickIcon {...props} />
  }
}
