import { BrowserIcon } from "@phosphor-icons/react/dist/ssr/Browser";
import { CreditCardIcon } from "@phosphor-icons/react/dist/ssr/CreditCard";
import { CursorClickIcon } from "@phosphor-icons/react/dist/ssr/CursorClick";
import { ImageIcon } from "@phosphor-icons/react/dist/ssr/Image";
import { ListChecksIcon } from "@phosphor-icons/react/dist/ssr/ListChecks";
import { ListNumbersIcon } from "@phosphor-icons/react/dist/ssr/ListNumbers";
import { MedalIcon } from "@phosphor-icons/react/dist/ssr/Medal";
import { PackageIcon } from "@phosphor-icons/react/dist/ssr/Package";
import { QuotesIcon } from "@phosphor-icons/react/dist/ssr/Quotes";
import { ShapesIcon } from "@phosphor-icons/react/dist/ssr/Shapes";
import { SlideshowIcon } from "@phosphor-icons/react/dist/ssr/Slideshow";
import { StackIcon } from "@phosphor-icons/react/dist/ssr/Stack";
import { TabsIcon } from "@phosphor-icons/react/dist/ssr/Tabs";
import { TagIcon } from "@phosphor-icons/react/dist/ssr/Tag";
import { TextTIcon } from "@phosphor-icons/react/dist/ssr/TextT";
import { TimerIcon } from "@phosphor-icons/react/dist/ssr/Timer";
import { ToggleRightIcon } from "@phosphor-icons/react/dist/ssr/ToggleRight";

import type { ProtocolNode } from "@/features/paywall-editor/types/editor";

export type LayerType = ProtocolNode["type"] | "scrollContainer";

export function LayerTypeIcon({ type }: { type: LayerType }) {
  const props = { "aria-hidden": true, "data-layer-type-icon": type } as const;

  switch (type) {
    case "scrollContainer":
      return <BrowserIcon {...props} />;
    case "stack":
      return <StackIcon {...props} />;
    case "carousel":
      return <SlideshowIcon {...props} />;
    case "switch":
      return <ToggleRightIcon {...props} />;
    case "countdown":
      return <TimerIcon {...props} />;
    case "text":
      return <TextTIcon {...props} />;
    case "image":
      return <ImageIcon {...props} />;
    case "icon":
      return <ShapesIcon {...props} />;
    case "featureList":
      return <ListChecksIcon {...props} />;
    case "productSelector":
      return <CreditCardIcon {...props} />;
    case "productCard":
      return <PackageIcon {...props} />;
    case "productBadge":
      return <TagIcon {...props} />;
    case "button":
      return <CursorClickIcon {...props} />;
    case "tabs":
      return <TabsIcon {...props} />;
    case "timeline":
      return <ListNumbersIcon {...props} />;
    case "award":
      return <MedalIcon {...props} />;
    case "socialProof":
      return <QuotesIcon {...props} />;
    default: {
      const unhandled: never = type;
      throw new Error(`Unhandled type: ${JSON.stringify(unhandled)}`);
    }
  }
}
