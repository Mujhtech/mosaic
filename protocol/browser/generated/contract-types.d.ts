// Generated from canonical Mosaic JSON Schemas. Do not edit.

export type MosaicPaywallV03Version = "0.3";

export type MosaicPaywallV03Identifier = string;

export type MosaicPaywallV03LocalizationKey = string;

export type MosaicPaywallV03LocaleTag = string;

export type MosaicPaywallV03LocalizedText = {
  "default": string;
  "localizationKey": MosaicPaywallV03LocalizationKey;
};

export type MosaicPaywallV03ReservedAccessibilityKey = "mosaic.a11y.rating" | "mosaic.a11y.in_progress";

export type MosaicPaywallV03LocaleCatalog = {
  "direction": "ltr" | "rtl";
  "strings": Record<string, string>;
};

export type MosaicPaywallV03Localization = {
  "defaultLocale": MosaicPaywallV03LocaleTag;
  "fallbackLocale": MosaicPaywallV03LocaleTag;
  "locales": Record<string, MosaicPaywallV03LocaleCatalog>;
};

export type MosaicPaywallV03CapabilityName = "layout.scrollContainer" | "layout.stack" | "layout.sizing" | "layout.heightSizing" | "layout.outerInsets" | "navigation.screens" | "navigation.sheets" | "component.text" | "component.image" | "component.icon" | "component.featureList" | "component.productSelector" | "component.productCard" | "component.productBadge" | "component.button" | "component.carousel" | "component.switch" | "component.countdown" | "component.tabs" | "component.timeline" | "component.award" | "component.socialProof" | "localization.catalogs" | "localization.rtl" | "localization.productTemplate" | "product.references" | "asset.bundledImage" | "asset.remoteImage" | "asset.bundledVideo" | "asset.remoteVideo" | "action.purchase" | "action.restore" | "action.close" | "action.navigateTo" | "action.navigateBack" | "action.openExternalUrl" | "accessibility.metadata" | "accessibility.reservedStrings" | "fallback.asset" | "fallback.product" | "outcome.normalized" | "style.colors" | "style.designTokens" | "style.gradientBackground" | "style.mediaBackground" | "style.shadow" | "style.box" | "style.clipping" | "style.typography" | "style.productCardStates" | "visibility.static" | "condition.switchVisibility" | "condition.tabVisibility";

export type MosaicPaywallV03RequiredCapability = {
  "name": MosaicPaywallV03CapabilityName;
  "version": MosaicPaywallV03Version;
};

export type MosaicPaywallV03DocumentCompatibility = {
  "requiredCapabilities": Array<MosaicPaywallV03RequiredCapability>;
};

export type MosaicPaywallV03LogicalSize = number;

export type MosaicPaywallV03PositiveLogicalSize = number;

export type MosaicPaywallV03EdgeInsets = {
  "top": MosaicPaywallV03LogicalSize;
  "start": MosaicPaywallV03LogicalSize;
  "bottom": MosaicPaywallV03LogicalSize;
  "end": MosaicPaywallV03LogicalSize;
};

export type MosaicPaywallV03TextAlignment = "start" | "center" | "end";

export type MosaicPaywallV03SemanticColor = "text.primary" | "text.secondary" | "surface.default" | "surface.elevated" | "action.primary" | "action.onPrimary" | "border.default" | "transparent";

export type MosaicPaywallV03LiteralColor = string;

export type MosaicPaywallV03ColorTokenReference = {
  "type": "colorToken";
  "id": MosaicPaywallV03Identifier;
};

export type MosaicPaywallV03Color = MosaicPaywallV03SemanticColor | MosaicPaywallV03LiteralColor | MosaicPaywallV03ColorTokenReference;

export type MosaicPaywallV03AxisSizingValue = "fit" | "fill" | {
  "mode": "fixed";
  "value": MosaicPaywallV03PositiveLogicalSize;
};

export type MosaicPaywallV03BoxSizing = {
  "width": MosaicPaywallV03AxisSizingValue;
  "height": MosaicPaywallV03AxisSizingValue;
};

export type MosaicPaywallV03GradientStop = {
  "position": number;
  "color": MosaicPaywallV03Color;
};

export type MosaicPaywallV03GradientStops = Array<MosaicPaywallV03GradientStop>;

export type MosaicPaywallV03NormalizedPoint = {
  "x": number;
  "y": number;
};

export type MosaicPaywallV03ColorBackground = {
  "type": "color";
  "value": MosaicPaywallV03Color;
};

export type MosaicPaywallV03LinearGradientBackground = {
  "type": "linearGradient";
  "angle": number;
  "stops": MosaicPaywallV03GradientStops;
};

export type MosaicPaywallV03RadialGradientBackground = {
  "type": "radialGradient";
  "center": MosaicPaywallV03NormalizedPoint;
  "radius": number;
  "stops": MosaicPaywallV03GradientStops;
};

export type MosaicPaywallV03MediaContentMode = "fit" | "fill";

export type MosaicPaywallV03ImageBackground = {
  "type": "image";
  "assetId": MosaicPaywallV03Identifier;
  "contentMode": MosaicPaywallV03MediaContentMode;
  "fallbackColor": MosaicPaywallV03Color;
};

export type MosaicPaywallV03VideoBackground = {
  "type": "video";
  "assetId": MosaicPaywallV03Identifier;
  "contentMode": MosaicPaywallV03MediaContentMode;
  "posterAssetId"?: MosaicPaywallV03Identifier;
  "fallbackColor": MosaicPaywallV03Color;
};

export type MosaicPaywallV03BackgroundTokenReference = {
  "type": "backgroundToken";
  "id": MosaicPaywallV03Identifier;
};

export type MosaicPaywallV03Background = MosaicPaywallV03ColorBackground | MosaicPaywallV03LinearGradientBackground | MosaicPaywallV03RadialGradientBackground | MosaicPaywallV03ImageBackground | MosaicPaywallV03VideoBackground | MosaicPaywallV03BackgroundTokenReference;

export type MosaicPaywallV03InlineShadow = {
  "type": "shadow";
  "color": MosaicPaywallV03Color;
  "offsetX": number;
  "offsetY": number;
  "blurRadius": MosaicPaywallV03LogicalSize;
};

export type MosaicPaywallV03ShadowTokenReference = {
  "type": "shadowToken";
  "id": MosaicPaywallV03Identifier;
};

export type MosaicPaywallV03Shadow = MosaicPaywallV03InlineShadow | MosaicPaywallV03ShadowTokenReference;

export type MosaicPaywallV03DesignTokenName = string;

export type MosaicPaywallV03ColorToken = {
  "id": MosaicPaywallV03Identifier;
  "name": MosaicPaywallV03DesignTokenName;
  "value": MosaicPaywallV03Color;
};

export type MosaicPaywallV03BackgroundToken = {
  "id": MosaicPaywallV03Identifier;
  "name": MosaicPaywallV03DesignTokenName;
  "value": MosaicPaywallV03Background;
};

export type MosaicPaywallV03ShadowToken = {
  "id": MosaicPaywallV03Identifier;
  "name": MosaicPaywallV03DesignTokenName;
  "value": MosaicPaywallV03Shadow;
};

export type MosaicPaywallV03DesignSystem = {
  "colors": Array<MosaicPaywallV03ColorToken>;
  "backgrounds": Array<MosaicPaywallV03BackgroundToken>;
  "shadows": Array<MosaicPaywallV03ShadowToken>;
};

export type MosaicPaywallV03Border = {
  "color": MosaicPaywallV03Color;
  "width": MosaicPaywallV03LogicalSize;
};

export type MosaicPaywallV03BorderOverride = {
  "color"?: MosaicPaywallV03Color;
  "width"?: MosaicPaywallV03LogicalSize;
};

export type MosaicPaywallV03BoxAppearance = {
  "background"?: MosaicPaywallV03Background;
  "border"?: MosaicPaywallV03Border;
  "cornerRadius"?: MosaicPaywallV03LogicalSize;
  "opacity"?: number;
  "padding"?: MosaicPaywallV03EdgeInsets;
  "shadow"?: MosaicPaywallV03Shadow;
};

export type MosaicPaywallV03ContainerAppearance = {
  "background"?: MosaicPaywallV03Background;
  "border"?: MosaicPaywallV03Border;
  "cornerRadius"?: MosaicPaywallV03LogicalSize;
  "opacity"?: number;
  "clipContent"?: boolean;
  "shadow"?: MosaicPaywallV03Shadow;
};

export type MosaicPaywallV03TypographyStyle = "display" | "title" | "heading" | "body" | "label" | "caption";

export type MosaicPaywallV03FontWeight = "regular" | "medium" | "semibold" | "bold";

export type MosaicPaywallV03BaseTypography = {
  "style": MosaicPaywallV03TypographyStyle;
  "fontSize": number;
  "lineHeightMultiplier": number;
  "weight": MosaicPaywallV03FontWeight;
  "color": MosaicPaywallV03Color;
  "alignment": MosaicPaywallV03TextAlignment;
};

export type MosaicPaywallV03Typography = {
  "style": MosaicPaywallV03TypographyStyle;
  "fontSize": number;
  "lineHeightMultiplier": number;
  "weight": MosaicPaywallV03FontWeight;
  "color": MosaicPaywallV03Color;
  "alignment": MosaicPaywallV03TextAlignment;
  "maxLines"?: number;
  "overflow"?: "clip" | "ellipsis";
};

export type MosaicPaywallV03Visibility = {
  "mode": "always";
} | {
  "mode": "hidden";
} | {
  "mode": "switch";
  "switchId": MosaicPaywallV03Identifier;
  "equals": boolean;
} | {
  "mode": "tab";
  "tabsId": MosaicPaywallV03Identifier;
  "equals": MosaicPaywallV03Identifier;
};

export type MosaicPaywallV03ControlAccessibility = {
  "label": MosaicPaywallV03LocalizedText;
  "hint"?: MosaicPaywallV03LocalizedText;
};

export type MosaicPaywallV03TextAccessibility = {
  "role": "text";
  "label"?: MosaicPaywallV03LocalizedText;
} | {
  "role": "heading";
  "level": number;
  "label"?: MosaicPaywallV03LocalizedText;
};

export type MosaicPaywallV03ImageAccessibility = {
  "hidden": true;
} | {
  "hidden": false;
  "label": MosaicPaywallV03LocalizedText;
};

export type MosaicPaywallV03BundledAssetSource = {
  "type": "bundled";
  "key": string;
};

export type MosaicPaywallV03RemoteAssetSource = {
  "type": "remote";
  "url": MosaicPaywallV03ExternalUrl;
};

export type MosaicPaywallV03AssetSource = MosaicPaywallV03BundledAssetSource | MosaicPaywallV03RemoteAssetSource;

export type MosaicPaywallV03ImageAssetFallback = {
  "type": "placeholder";
  "value": MosaicPaywallV03LocalizedText;
};

export type MosaicPaywallV03ImageAsset = {
  "type": "image";
  "id": MosaicPaywallV03Identifier;
  "source": MosaicPaywallV03AssetSource;
  "fallback": MosaicPaywallV03ImageAssetFallback;
};

export type MosaicPaywallV03VideoAsset = {
  "type": "video";
  "id": MosaicPaywallV03Identifier;
  "source": MosaicPaywallV03AssetSource;
};

export type MosaicPaywallV03Asset = MosaicPaywallV03ImageAsset | MosaicPaywallV03VideoAsset;

export type MosaicPaywallV03ProductReference = {
  "id": MosaicPaywallV03Identifier;
  "productId": string;
  "label": MosaicPaywallV03LocalizedText;
};

export type MosaicPaywallV03ScreenPresentation = {
  "type": "screen";
} | {
  "type": "sheet";
};

export type MosaicPaywallV03Screen = {
  "id": MosaicPaywallV03Identifier;
  "accessibilityLabel"?: MosaicPaywallV03LocalizedText;
  "presentation": MosaicPaywallV03ScreenPresentation;
  "layout": MosaicPaywallV03ScrollContainer;
};

export type MosaicPaywallV03ScrollContainer = {
  "type": "scrollContainer";
  "id": MosaicPaywallV03Identifier;
  "axis": "vertical";
  "safeArea": "respect";
  "showsIndicators": boolean;
  "background"?: MosaicPaywallV03Background;
  "content": MosaicPaywallV03Stack;
};

export type MosaicPaywallV03Stack = {
  "type": "stack";
  "id": MosaicPaywallV03Identifier;
  "direction": "vertical" | "horizontal";
  "gap": MosaicPaywallV03LogicalSize;
  "padding": MosaicPaywallV03EdgeInsets;
  "mainAxisDistribution": "start" | "center" | "end" | "spaceBetween";
  "crossAxisAlignment": "start" | "center" | "end" | "stretch";
  "appearance"?: MosaicPaywallV03ContainerAppearance;
  "sizing"?: MosaicPaywallV03BoxSizing;
  "outerInsets"?: MosaicPaywallV03EdgeInsets;
  "visibility"?: MosaicPaywallV03Visibility;
  "children": Array<MosaicPaywallV03Node>;
};

export type MosaicPaywallV03Node = MosaicPaywallV03Stack | MosaicPaywallV03TextComponent | MosaicPaywallV03ImageComponent | MosaicPaywallV03IconComponent | MosaicPaywallV03FeatureListComponent | MosaicPaywallV03ProductSelectorComponent | MosaicPaywallV03ButtonComponent | MosaicPaywallV03CarouselComponent | MosaicPaywallV03SwitchComponent | MosaicPaywallV03CountdownComponent | MosaicPaywallV03TabsComponent | MosaicPaywallV03TimelineComponent | MosaicPaywallV03AwardComponent | MosaicPaywallV03SocialProofComponent;

export type MosaicPaywallV03TextComponent = {
  "type": "text";
  "id": MosaicPaywallV03Identifier;
  "value": MosaicPaywallV03LocalizedText;
  "typography": MosaicPaywallV03Typography;
  "appearance"?: MosaicPaywallV03BoxAppearance;
  "sizing"?: MosaicPaywallV03BoxSizing;
  "outerInsets"?: MosaicPaywallV03EdgeInsets;
  "visibility"?: MosaicPaywallV03Visibility;
  "accessibility": MosaicPaywallV03TextAccessibility;
};

export type MosaicPaywallV03ImageComponent = {
  "type": "image";
  "id": MosaicPaywallV03Identifier;
  "assetId": MosaicPaywallV03Identifier;
  "aspectRatio"?: number;
  "contentMode": "fit" | "fill";
  "appearance"?: MosaicPaywallV03BoxAppearance;
  "sizing"?: MosaicPaywallV03BoxSizing;
  "outerInsets"?: MosaicPaywallV03EdgeInsets;
  "visibility"?: MosaicPaywallV03Visibility;
  "accessibility": MosaicPaywallV03ImageAccessibility;
};

export type MosaicPaywallV03IconName = "checkmark" | "close" | "lock" | "restore" | "externalLink" | "arrowBackward" | "arrowForward" | "chevronBackward" | "chevronForward";

export type MosaicPaywallV03IconComponent = {
  "type": "icon";
  "id": MosaicPaywallV03Identifier;
  "name": MosaicPaywallV03IconName;
  "size": MosaicPaywallV03PositiveLogicalSize;
  "color": MosaicPaywallV03Color;
  "appearance"?: MosaicPaywallV03BoxAppearance;
  "sizing"?: MosaicPaywallV03BoxSizing;
  "outerInsets"?: MosaicPaywallV03EdgeInsets;
  "visibility"?: MosaicPaywallV03Visibility;
  "accessibility": MosaicPaywallV03ImageAccessibility;
};

export type MosaicPaywallV03FeatureListItem = {
  "id": MosaicPaywallV03Identifier;
  "text": MosaicPaywallV03LocalizedText;
};

export type MosaicPaywallV03FeatureListComponent = {
  "type": "featureList";
  "id": MosaicPaywallV03Identifier;
  "marker": "checkmark";
  "gap": MosaicPaywallV03LogicalSize;
  "markerColor": MosaicPaywallV03Color;
  "items": Array<MosaicPaywallV03FeatureListItem>;
  "typography": MosaicPaywallV03BaseTypography;
  "appearance"?: MosaicPaywallV03BoxAppearance;
  "sizing"?: MosaicPaywallV03BoxSizing;
  "outerInsets"?: MosaicPaywallV03EdgeInsets;
  "visibility"?: MosaicPaywallV03Visibility;
  "accessibility": MosaicPaywallV03ControlAccessibility;
};

export type MosaicPaywallV03UnavailableProductFallback = {
  "selection": "firstAvailable";
  "whenNoneAvailable": "showMessageAndDisablePurchase";
  "message": MosaicPaywallV03LocalizedText;
};

export type MosaicPaywallV03SelectionStateStyle = {
  "background": MosaicPaywallV03Background;
  "border": MosaicPaywallV03Border;
  "cornerRadius": MosaicPaywallV03LogicalSize;
  "padding": MosaicPaywallV03EdgeInsets;
  "opacity": number;
  "shadow"?: MosaicPaywallV03Shadow;
};

export type MosaicPaywallV03ProductCardDefaultStyle = MosaicPaywallV03SelectionStateStyle;

export type MosaicPaywallV03EdgeInsetsOverride = {
  "top"?: MosaicPaywallV03LogicalSize;
  "start"?: MosaicPaywallV03LogicalSize;
  "bottom"?: MosaicPaywallV03LogicalSize;
  "end"?: MosaicPaywallV03LogicalSize;
};

export type MosaicPaywallV03SelectionStateStyleOverride = {
  "background"?: MosaicPaywallV03Background;
  "border"?: MosaicPaywallV03BorderOverride;
  "cornerRadius"?: MosaicPaywallV03LogicalSize;
  "padding"?: MosaicPaywallV03EdgeInsetsOverride;
  "opacity"?: number;
  "shadow"?: MosaicPaywallV03Shadow;
};

export type MosaicPaywallV03SelectionStyles = {
  "default": MosaicPaywallV03SelectionStateStyle;
  "selected": MosaicPaywallV03SelectionStateStyleOverride;
};

export type MosaicPaywallV03ProductCardSelectedStyle = MosaicPaywallV03SelectionStateStyleOverride;

export type MosaicPaywallV03ProductCardStyles = MosaicPaywallV03SelectionStyles;

export type MosaicPaywallV03ProductCardAccessibility = {
  "label": MosaicPaywallV03LocalizedText;
};

export type MosaicPaywallV03ProductBadgePlacement = {
  "mode": "nested";
} | {
  "mode": "overlay";
  "anchor": "topStart" | "topEnd" | "bottomStart" | "bottomEnd";
  "inset": number;
};

export type MosaicPaywallV03ProductCardPassiveStack = {
  "type": "stack";
  "id": MosaicPaywallV03Identifier;
  "direction": "vertical" | "horizontal";
  "gap": MosaicPaywallV03LogicalSize;
  "padding": MosaicPaywallV03EdgeInsets;
  "mainAxisDistribution": "start" | "center" | "end" | "spaceBetween";
  "crossAxisAlignment": "start" | "center" | "end" | "stretch";
  "appearance"?: MosaicPaywallV03ContainerAppearance;
  "sizing"?: MosaicPaywallV03BoxSizing;
  "outerInsets"?: MosaicPaywallV03EdgeInsets;
  "visibility"?: MosaicPaywallV03Visibility;
  "children": Array<MosaicPaywallV03ProductCardPassiveNode>;
};

export type MosaicPaywallV03ProductCardPassiveNode = MosaicPaywallV03ProductCardPassiveStack | MosaicPaywallV03TextComponent | MosaicPaywallV03ImageComponent | MosaicPaywallV03IconComponent | MosaicPaywallV03FeatureListComponent | MosaicPaywallV03CountdownComponent | MosaicPaywallV03TimelineComponent | MosaicPaywallV03AwardComponent | MosaicPaywallV03SocialProofComponent;

export type MosaicPaywallV03ProductBadgeComponent = {
  "type": "productBadge";
  "id": MosaicPaywallV03Identifier;
  "placement": MosaicPaywallV03ProductBadgePlacement;
  "direction": "vertical" | "horizontal";
  "gap": MosaicPaywallV03LogicalSize;
  "mainAxisDistribution": "start" | "center" | "end" | "spaceBetween";
  "crossAxisAlignment": "start" | "center" | "end" | "stretch";
  "children": Array<MosaicPaywallV03ProductCardPassiveNode>;
  "styles": MosaicPaywallV03ProductCardStyles;
  "sizing"?: MosaicPaywallV03BoxSizing;
};

export type MosaicPaywallV03ProductCardChild = MosaicPaywallV03ProductCardPassiveNode | MosaicPaywallV03ProductBadgeComponent;

export type MosaicPaywallV03ProductCardComponent = {
  "type": "productCard";
  "id": MosaicPaywallV03Identifier;
  "productReferenceId": MosaicPaywallV03Identifier;
  "direction": "vertical" | "horizontal";
  "gap": MosaicPaywallV03LogicalSize;
  "mainAxisDistribution": "start" | "center" | "end" | "spaceBetween";
  "crossAxisAlignment": "start" | "center" | "end" | "stretch";
  "children": Array<MosaicPaywallV03ProductCardChild>;
  "styles": MosaicPaywallV03ProductCardStyles;
  "sizing"?: MosaicPaywallV03BoxSizing;
  "clipContent"?: false;
  "accessibility"?: MosaicPaywallV03ProductCardAccessibility;
};

export type MosaicPaywallV03ProductSelectorComponent = {
  "type": "productSelector";
  "id": MosaicPaywallV03Identifier;
  "direction": "vertical" | "horizontal";
  "gap": MosaicPaywallV03LogicalSize;
  "crossAxisAlignment": "start" | "center" | "end" | "stretch";
  "initialProductCardId": MosaicPaywallV03Identifier;
  "cards": Array<MosaicPaywallV03ProductCardComponent>;
  "appearance"?: MosaicPaywallV03BoxAppearance;
  "sizing"?: MosaicPaywallV03BoxSizing;
  "outerInsets"?: MosaicPaywallV03EdgeInsets;
  "visibility"?: MosaicPaywallV03Visibility;
  "unavailableFallback": MosaicPaywallV03UnavailableProductFallback;
  "accessibility": MosaicPaywallV03ControlAccessibility;
};

export type MosaicPaywallV03PurchaseAction = {
  "type": "purchase";
  "productSelectorId": MosaicPaywallV03Identifier;
};

export type MosaicPaywallV03RestoreAction = {
  "type": "restore";
};

export type MosaicPaywallV03CloseAction = {
  "type": "close";
};

export type MosaicPaywallV03NavigateToAction = {
  "type": "navigateTo";
  "screenId": MosaicPaywallV03Identifier;
};

export type MosaicPaywallV03NavigateBackAction = {
  "type": "navigateBack";
};

export type MosaicPaywallV03ExternalUrl = string;

export type MosaicPaywallV03OpenExternalUrlAction = {
  "type": "openExternalUrl";
  "url": MosaicPaywallV03ExternalUrl;
};

export type MosaicPaywallV03ButtonAction = MosaicPaywallV03PurchaseAction | MosaicPaywallV03RestoreAction | MosaicPaywallV03CloseAction | MosaicPaywallV03NavigateToAction | MosaicPaywallV03NavigateBackAction | MosaicPaywallV03OpenExternalUrlAction;

export type MosaicPaywallV03ButtonComponent = {
  "type": "button";
  "id": MosaicPaywallV03Identifier;
  "direction": "vertical" | "horizontal";
  "gap": MosaicPaywallV03LogicalSize;
  "mainAxisDistribution": "start" | "center" | "end" | "spaceBetween";
  "crossAxisAlignment": "start" | "center" | "end" | "stretch";
  "children": Array<MosaicPaywallV03Node>;
  "inProgressChildren"?: Array<MosaicPaywallV03Node>;
  "appearance"?: MosaicPaywallV03BoxAppearance;
  "sizing"?: MosaicPaywallV03BoxSizing;
  "outerInsets"?: MosaicPaywallV03EdgeInsets;
  "visibility"?: MosaicPaywallV03Visibility;
  "action": MosaicPaywallV03ButtonAction;
  "accessibility": MosaicPaywallV03ControlAccessibility;
};

export type MosaicPaywallV03CarouselPage = {
  "id": MosaicPaywallV03Identifier;
  "accessibilityLabel": MosaicPaywallV03LocalizedText;
  "content": MosaicPaywallV03Stack;
};

export type MosaicPaywallV03CarouselComponent = {
  "type": "carousel";
  "id": MosaicPaywallV03Identifier;
  "initialPageIndex": number;
  "showsIndicators": boolean;
  "pages": Array<MosaicPaywallV03CarouselPage>;
  "appearance"?: MosaicPaywallV03ContainerAppearance;
  "sizing"?: MosaicPaywallV03BoxSizing;
  "outerInsets"?: MosaicPaywallV03EdgeInsets;
  "visibility"?: MosaicPaywallV03Visibility;
  "accessibility": MosaicPaywallV03ControlAccessibility;
};

export type MosaicPaywallV03SwitchComponent = {
  "type": "switch";
  "id": MosaicPaywallV03Identifier;
  "label": MosaicPaywallV03LocalizedText;
  "initialValue": boolean;
  "typography": MosaicPaywallV03BaseTypography;
  "offTrackColor": MosaicPaywallV03Color;
  "onTrackColor": MosaicPaywallV03Color;
  "thumbColor": MosaicPaywallV03Color;
  "appearance"?: MosaicPaywallV03BoxAppearance;
  "sizing"?: MosaicPaywallV03BoxSizing;
  "outerInsets"?: MosaicPaywallV03EdgeInsets;
  "visibility"?: MosaicPaywallV03Visibility;
  "accessibility": MosaicPaywallV03ControlAccessibility;
};

export type MosaicPaywallV03CountdownComponent = {
  "type": "countdown";
  "id": MosaicPaywallV03Identifier;
  "endsAt": string;
  "largestUnit": "day" | "hour" | "minute" | "second";
  "smallestUnit": "day" | "hour" | "minute" | "second";
  "completedText": MosaicPaywallV03LocalizedText;
  "typography": MosaicPaywallV03BaseTypography;
  "appearance"?: MosaicPaywallV03BoxAppearance;
  "sizing"?: MosaicPaywallV03BoxSizing;
  "outerInsets"?: MosaicPaywallV03EdgeInsets;
  "visibility"?: MosaicPaywallV03Visibility;
  "accessibility": MosaicPaywallV03TextAccessibility;
};

export type MosaicPaywallV03TabsEntry = {
  "id": MosaicPaywallV03Identifier;
  "label": MosaicPaywallV03LocalizedText;
  "content": MosaicPaywallV03Stack;
};

export type MosaicPaywallV03TabsComponent = {
  "type": "tabs";
  "id": MosaicPaywallV03Identifier;
  "tabBarDirection": "vertical" | "horizontal";
  "tabBarGap": MosaicPaywallV03LogicalSize;
  "tabBarDistribution": "start" | "center" | "end" | "spaceBetween";
  "gap": MosaicPaywallV03LogicalSize;
  "initialTabId": MosaicPaywallV03Identifier;
  "tabs": Array<MosaicPaywallV03TabsEntry>;
  "styles": MosaicPaywallV03SelectionStyles;
  "labelTypography": MosaicPaywallV03BaseTypography;
  "selectedLabelColor": MosaicPaywallV03Color;
  "appearance"?: MosaicPaywallV03ContainerAppearance;
  "sizing"?: MosaicPaywallV03BoxSizing;
  "outerInsets"?: MosaicPaywallV03EdgeInsets;
  "visibility"?: MosaicPaywallV03Visibility;
  "accessibility": MosaicPaywallV03ControlAccessibility;
};

export type MosaicPaywallV03TimelineMarker = {
  "kind": "dot";
} | {
  "kind": "ordinal";
} | {
  "kind": "icon";
  "name": MosaicPaywallV03IconName;
};

export type MosaicPaywallV03TimelineConnector = {
  "color": MosaicPaywallV03Color;
  "width": MosaicPaywallV03PositiveLogicalSize;
  "style": "solid" | "dashed";
};

export type MosaicPaywallV03TimelineEntry = {
  "id": MosaicPaywallV03Identifier;
  "title": MosaicPaywallV03LocalizedText;
  "description"?: MosaicPaywallV03LocalizedText;
  "marker"?: MosaicPaywallV03TimelineMarker;
};

export type MosaicPaywallV03TimelineComponent = {
  "type": "timeline";
  "id": MosaicPaywallV03Identifier;
  "orientation": "vertical";
  "gap": MosaicPaywallV03LogicalSize;
  "connector": MosaicPaywallV03TimelineConnector;
  "entries": Array<MosaicPaywallV03TimelineEntry>;
  "markerColor"?: MosaicPaywallV03Color;
  "markerSize"?: MosaicPaywallV03PositiveLogicalSize;
  "titleTypography": MosaicPaywallV03BaseTypography;
  "descriptionTypography"?: MosaicPaywallV03BaseTypography;
  "appearance"?: MosaicPaywallV03BoxAppearance;
  "sizing"?: MosaicPaywallV03BoxSizing;
  "outerInsets"?: MosaicPaywallV03EdgeInsets;
  "visibility"?: MosaicPaywallV03Visibility;
  "accessibility": MosaicPaywallV03ControlAccessibility;
};

export type MosaicPaywallV03AwardEmblem = {
  "type": "image";
  "assetId": MosaicPaywallV03Identifier;
  "size": MosaicPaywallV03PositiveLogicalSize;
} | {
  "type": "icon";
  "name": MosaicPaywallV03IconName;
  "size": MosaicPaywallV03PositiveLogicalSize;
  "color": MosaicPaywallV03Color;
};

export type MosaicPaywallV03AwardComponent = {
  "type": "award";
  "id": MosaicPaywallV03Identifier;
  "direction": "vertical" | "horizontal";
  "gap": MosaicPaywallV03LogicalSize;
  "crossAxisAlignment": "start" | "center" | "end" | "stretch";
  "emblem"?: MosaicPaywallV03AwardEmblem;
  "title": MosaicPaywallV03LocalizedText;
  "titleTypography": MosaicPaywallV03BaseTypography;
  "subtitle"?: MosaicPaywallV03LocalizedText;
  "subtitleTypography"?: MosaicPaywallV03BaseTypography;
  "appearance"?: MosaicPaywallV03BoxAppearance;
  "sizing"?: MosaicPaywallV03BoxSizing;
  "outerInsets"?: MosaicPaywallV03EdgeInsets;
  "visibility"?: MosaicPaywallV03Visibility;
  "accessibility": MosaicPaywallV03ControlAccessibility;
};

export type MosaicPaywallV03SocialProofRating = {
  "symbol": "star";
  "value": number;
  "maximum": number;
  "step": "whole" | "half";
  "size": MosaicPaywallV03PositiveLogicalSize;
  "filledColor": MosaicPaywallV03Color;
  "emptyColor": MosaicPaywallV03Color;
};

export type MosaicPaywallV03SocialProofAvatar = {
  "assetId": MosaicPaywallV03Identifier;
  "size": MosaicPaywallV03PositiveLogicalSize;
};

export type MosaicPaywallV03SocialProofComponent = {
  "type": "socialProof";
  "id": MosaicPaywallV03Identifier;
  "gap": MosaicPaywallV03LogicalSize;
  "quote": MosaicPaywallV03LocalizedText;
  "quoteTypography": MosaicPaywallV03BaseTypography;
  "attribution": MosaicPaywallV03LocalizedText;
  "attributionTypography": MosaicPaywallV03BaseTypography;
  "rating"?: MosaicPaywallV03SocialProofRating;
  "avatar"?: MosaicPaywallV03SocialProofAvatar;
  "appearance"?: MosaicPaywallV03BoxAppearance;
  "sizing"?: MosaicPaywallV03BoxSizing;
  "outerInsets"?: MosaicPaywallV03EdgeInsets;
  "visibility"?: MosaicPaywallV03Visibility;
  "accessibility": MosaicPaywallV03ControlAccessibility;
};

export type MosaicPaywallV03Document = {
  "schemaVersion": MosaicPaywallV03Version;
  "id": MosaicPaywallV03Identifier;
  "revision": number;
  "compatibility": MosaicPaywallV03DocumentCompatibility;
  "localization": MosaicPaywallV03Localization;
  "designSystem": MosaicPaywallV03DesignSystem;
  "assets": Array<MosaicPaywallV03Asset>;
  "products": Array<MosaicPaywallV03ProductReference>;
  "initialScreenId": MosaicPaywallV03Identifier;
  "screens": Array<MosaicPaywallV03Screen>;
};

export type MosaicPreviewV03MessageId = string;

export type MosaicPreviewV03SessionId = string;

export type MosaicPreviewV03ClientId = string;

export type MosaicPreviewV03EditableDocumentId = string;

export type MosaicPreviewV03RevisionId = string;

export type MosaicPreviewV03UtcTimestamp = string;

export type MosaicPreviewV03MachineIdentifier = string;

export type MosaicPreviewV03SemanticVersion = string;

export type MosaicPreviewV03SafeText = string;

export type MosaicPreviewV03SafeDisplayName = string;

export type MosaicPreviewV03DiagnosticCode = string;

export type MosaicPreviewV03JsonPointer = string;

export type MosaicPreviewV03ComponentId = string;

export type MosaicPreviewV03LocaleTag = string;

export type MosaicPreviewV03LocalRevision = {
  "revisionId": MosaicPreviewV03RevisionId;
  "sequence": number;
};

export type MosaicPreviewV03SoftwareIdentity = {
  "id": MosaicPreviewV03MachineIdentifier;
  "version": MosaicPreviewV03SemanticVersion;
};

export type MosaicPreviewV03ApplicationIdentity = {
  "id": MosaicPreviewV03MachineIdentifier;
  "displayName": MosaicPreviewV03SafeDisplayName;
  "version": string;
};

export type MosaicPreviewV03DeviceIdentity = {
  "displayName": MosaicPreviewV03SafeDisplayName;
  "systemName": MosaicPreviewV03SafeDisplayName;
  "systemVersion": string;
};

export type MosaicPreviewV03ClientIdentity = {
  "clientId": MosaicPreviewV03ClientId;
  "displayName": MosaicPreviewV03SafeDisplayName;
  "renderer": MosaicPreviewV03SoftwareIdentity;
  "application": MosaicPreviewV03ApplicationIdentity;
  "device": MosaicPreviewV03DeviceIdentity;
};

export type MosaicPreviewV03SupportedCapability = {
  "name": MosaicPreviewV03MachineIdentifier;
  "version": MosaicPreviewV03SemanticVersion;
};

export type MosaicPreviewV03CapabilityName = "preview.liveUpdate" | "preview.mockCommerce" | "preview.localeOverride" | "preview.textScale" | "preview.diagnostics";

export type MosaicPreviewV03Capability = {
  "name": MosaicPreviewV03CapabilityName;
  "version": "0.3";
};

export type MosaicPreviewV03Limits = {
  "maxDocumentBytes": number;
};

export type MosaicPreviewV03Context = {
  "locale": MosaicPreviewV03LocaleTag;
  "textScale": number;
};

export type MosaicPreviewV03DiagnosticLocation = {
  "documentPath": MosaicPreviewV03JsonPointer;
  "componentId"?: MosaicPreviewV03ComponentId;
  "property"?: string;
};

export type MosaicPreviewV03RecoveryAction = {
  "action": "editProperty" | "removeComponent" | "bindProduct" | "selectSupportedTemplate" | "updatePreviewClient" | "restoreLastValidDraft" | "retry" | "reconnect" | "inspectComponent";
  "message": MosaicPreviewV03SafeText;
};

export type MosaicPreviewV03ValidationDiagnostic = {
  "code": MosaicPreviewV03DiagnosticCode;
  "message": MosaicPreviewV03SafeText;
  "location": MosaicPreviewV03DiagnosticLocation;
  "recovery": MosaicPreviewV03RecoveryAction;
};

export type MosaicPreviewV03CompatibilityWarning = {
  "code": MosaicPreviewV03DiagnosticCode;
  "severity": "warning" | "blocking";
  "message": MosaicPreviewV03SafeText;
  "location"?: MosaicPreviewV03DiagnosticLocation;
  "capability"?: MosaicPreviewV03SupportedCapability;
  "fallback": "keepLastAcceptedDraft" | "useDeclaredAssetFallback" | "useSelectorFallback" | "nativeApproximation";
  "recovery": MosaicPreviewV03RecoveryAction;
};

export type MosaicPreviewV03RenderDiagnostic = {
  "code": MosaicPreviewV03DiagnosticCode;
  "message": MosaicPreviewV03SafeText;
  "location"?: MosaicPreviewV03DiagnosticLocation;
  "fallback": "keepLastAcceptedDraft";
  "recovery": MosaicPreviewV03RecoveryAction;
};

export type MosaicPreviewV03Period = {
  "unit": "day" | "week" | "month" | "year";
  "value": number;
};

export type MosaicPreviewV03IntroductoryOffer = {
  "localizedPrice": MosaicPreviewV03SafeDisplayName;
  "period": MosaicPreviewV03Period;
  "cycles": number;
};

export type MosaicPreviewV03AvailableSubscriptionProduct = {
  "productReferenceId": MosaicPreviewV03ComponentId;
  "availability": "available";
  "kind": "subscription";
  "localizedPrice": MosaicPreviewV03SafeDisplayName;
  "currencyCode": string;
  "billingPeriod": MosaicPreviewV03Period;
  "trialPeriod"?: MosaicPreviewV03Period;
  "introductoryOffer"?: MosaicPreviewV03IntroductoryOffer;
};

export type MosaicPreviewV03AvailableNonConsumableProduct = {
  "productReferenceId": MosaicPreviewV03ComponentId;
  "availability": "available";
  "kind": "nonConsumable";
  "localizedPrice": MosaicPreviewV03SafeDisplayName;
  "currencyCode": string;
};

export type MosaicPreviewV03UnavailableMockProduct = {
  "productReferenceId": MosaicPreviewV03ComponentId;
  "availability": "unavailable";
  "reason": "notConfigured" | "temporarilyUnavailable" | "unsupported";
};

export type MosaicPreviewV03MockProduct = MosaicPreviewV03AvailableSubscriptionProduct | MosaicPreviewV03AvailableNonConsumableProduct | MosaicPreviewV03UnavailableMockProduct;

export type MosaicPreviewV03NoEntitlement = {
  "status": "none";
};

export type MosaicPreviewV03ActiveEntitlement = {
  "status": "active";
  "productReferenceId": MosaicPreviewV03ComponentId;
};

export type MosaicPreviewV03MockEntitlement = MosaicPreviewV03NoEntitlement | MosaicPreviewV03ActiveEntitlement;

export type MosaicPreviewV03MockCommerceState = {
  "products": Array<MosaicPreviewV03MockProduct>;
  "purchaseOutcome": "purchased" | "alreadyEntitled" | "cancelled" | "purchaseFailed";
  "restoreOutcome": "restored" | "alreadyEntitled" | "restoreNoPurchases" | "restoreFailed";
  "entitlement": MosaicPreviewV03MockEntitlement;
};

export type MosaicPreviewV03RevisionTarget = {
  "clientId": MosaicPreviewV03ClientId;
  "editableDocumentId": MosaicPreviewV03EditableDocumentId;
  "revision": MosaicPreviewV03LocalRevision;
};

export type MosaicPreviewV03ClientConnectedPayload = {
  "client": MosaicPreviewV03ClientIdentity;
};

export type MosaicPreviewV03ClientDisconnectedPayload = {
  "clientId": MosaicPreviewV03ClientId;
  "reason": "closed" | "timeout" | "transportError" | "replaced" | "sessionEnded";
  "diagnostic"?: MosaicPreviewV03SafeText;
};

export type MosaicPreviewV03CapabilityReportPayload = {
  "clientId": MosaicPreviewV03ClientId;
  "supportedSchemaVersions": Array<MosaicPreviewV03SemanticVersion>;
  "supportedCapabilities": Array<MosaicPreviewV03SupportedCapability>;
  "previewCapabilities": Array<MosaicPreviewV03Capability>;
  "limits": MosaicPreviewV03Limits;
};

export type MosaicPreviewV03DraftUpdatedPayload = {
  "editableDocumentId": MosaicPreviewV03EditableDocumentId;
  "revision": MosaicPreviewV03LocalRevision;
  "document": MosaicPaywallV03Document;
  "preview": MosaicPreviewV03Context;
};

export type MosaicPreviewV03DraftAcceptedPayload = {
  "clientId": MosaicPreviewV03ClientId;
  "editableDocumentId": MosaicPreviewV03EditableDocumentId;
  "revision": MosaicPreviewV03LocalRevision;
};

export type MosaicPreviewV03DraftRejectedPayload = {
  "clientId": MosaicPreviewV03ClientId;
  "editableDocumentId": MosaicPreviewV03EditableDocumentId;
  "revision": MosaicPreviewV03LocalRevision;
  "reason": "staleRevision" | "revisionConflict" | "validationFailed" | "unsupportedSchemaVersion" | "unsupportedCapability" | "documentTooLarge" | "renderFailed";
  "diagnostics": Array<MosaicPreviewV03ValidationDiagnostic>;
};

export type MosaicPreviewV03ValidationErrorPayload = {
  "clientId": MosaicPreviewV03ClientId;
  "editableDocumentId": MosaicPreviewV03EditableDocumentId;
  "revision": MosaicPreviewV03LocalRevision;
  "errors": Array<MosaicPreviewV03ValidationDiagnostic>;
};

export type MosaicPreviewV03RenderWarningPayload = {
  "clientId": MosaicPreviewV03ClientId;
  "editableDocumentId": MosaicPreviewV03EditableDocumentId;
  "revision": MosaicPreviewV03LocalRevision;
  "warnings": Array<MosaicPreviewV03CompatibilityWarning>;
};

export type MosaicPreviewV03RenderFailurePayload = {
  "clientId": MosaicPreviewV03ClientId;
  "editableDocumentId": MosaicPreviewV03EditableDocumentId;
  "revision": MosaicPreviewV03LocalRevision;
  "failure": MosaicPreviewV03RenderDiagnostic;
};

export type MosaicPreviewV03MockCommerceStateChangedPayload = {
  "editableDocumentId": MosaicPreviewV03EditableDocumentId;
  "stateRevision": MosaicPreviewV03LocalRevision;
  "state": MosaicPreviewV03MockCommerceState;
};

export type MosaicPreviewV03HeartbeatPayload = {
  "clientId": MosaicPreviewV03ClientId;
  "kind": "ping" | "pong";
  "sequence": number;
};

export type MosaicPreviewV03MessageType = "previewClientConnected" | "previewClientDisconnected" | "capabilityReport" | "draftUpdated" | "draftAccepted" | "draftRejected" | "validationError" | "renderWarning" | "renderFailure" | "mockCommerceStateChanged" | "previewHeartbeat";

export type MosaicPreviewV03Envelope<
  TType extends MosaicPreviewV03MessageType,
  TPayload,
> = {
  "previewProtocolVersion": "0.3";
  "messageId": MosaicPreviewV03MessageId;
  "sessionId": MosaicPreviewV03SessionId;
  "sentAt": MosaicPreviewV03UtcTimestamp;
} & {
  "type": TType;
  "payload": TPayload;
};

export type MosaicPreviewV03Message =
  | MosaicPreviewV03Envelope<"previewClientConnected", MosaicPreviewV03ClientConnectedPayload>
  | MosaicPreviewV03Envelope<"previewClientDisconnected", MosaicPreviewV03ClientDisconnectedPayload>
  | MosaicPreviewV03Envelope<"capabilityReport", MosaicPreviewV03CapabilityReportPayload>
  | MosaicPreviewV03Envelope<"draftUpdated", MosaicPreviewV03DraftUpdatedPayload>
  | MosaicPreviewV03Envelope<"draftAccepted", MosaicPreviewV03DraftAcceptedPayload>
  | MosaicPreviewV03Envelope<"draftRejected", MosaicPreviewV03DraftRejectedPayload>
  | MosaicPreviewV03Envelope<"validationError", MosaicPreviewV03ValidationErrorPayload>
  | MosaicPreviewV03Envelope<"renderWarning", MosaicPreviewV03RenderWarningPayload>
  | MosaicPreviewV03Envelope<"renderFailure", MosaicPreviewV03RenderFailurePayload>
  | MosaicPreviewV03Envelope<"mockCommerceStateChanged", MosaicPreviewV03MockCommerceStateChangedPayload>
  | MosaicPreviewV03Envelope<"previewHeartbeat", MosaicPreviewV03HeartbeatPayload>;

export type MosaicLocalProjectV03 = {
  "fileFormatVersion": "0.3";
  "editableDocumentId": MosaicPreviewV03EditableDocumentId;
  "revision": MosaicPreviewV03LocalRevision;
  "document": MosaicPaywallV03Document;
  "preview": MosaicPreviewV03Context;
  "mockCommerce": {
    "revision": MosaicPreviewV03LocalRevision;
    "state": MosaicPreviewV03MockCommerceState;
  };
};

export type MosaicCommerceProviderV1Identifier = string;

export type MosaicCommerceProviderV1SafeText = string;

export type MosaicCommerceProviderV1SafeProviderCode = string;

export type MosaicCommerceProviderV1UtcTimestamp = string;

export type MosaicCommerceProviderV1RecordType = "providerProfile" | "productLoadRequest" | "productLoadResult" | "purchaseRequest" | "purchaseOutcome" | "restoreOutcome" | "activeEntitlementOutcome" | "providerDiagnostics";

export type MosaicCommerceProviderV1ProviderIdentity = {
  "id": MosaicCommerceProviderV1Identifier;
  "displayName": MosaicCommerceProviderV1SafeText;
  "adapterVersion": string;
};

export type MosaicCommerceProviderV1CapabilityName = "productLoading" | "subscriptions" | "oneTimeNonConsumables" | "trials" | "introductoryOffers" | "promotionalOffers" | "restore" | "activeEntitlementLookup" | "pendingPurchases" | "deferredPurchases" | "serverConfirmedTransactions" | "productSynchronization" | "providerDiagnostics";

export type MosaicCommerceProviderV1ProviderCapability = {
  "name": MosaicCommerceProviderV1CapabilityName;
  "support": "supported" | "unsupported" | "conditional";
  "reasonCode"?: string;
};

export type MosaicCommerceProviderV1ProviderProfile = {
  "provider": MosaicCommerceProviderV1ProviderIdentity;
  "capabilities": Array<MosaicCommerceProviderV1ProviderCapability>;
};

export type MosaicCommerceProviderV1ProductType = "subscription" | "one_time_non_consumable";

export type MosaicCommerceProviderV1MosaicProduct = {
  "mosaicProductId": MosaicCommerceProviderV1Identifier;
  "key": MosaicCommerceProviderV1Identifier;
  "type": MosaicCommerceProviderV1ProductType;
  "entitlementKeys": Array<MosaicCommerceProviderV1Identifier>;
};

export type MosaicCommerceProviderV1ProviderProductBinding = {
  "mappingId": MosaicCommerceProviderV1Identifier;
  "providerProductReference": string;
};

export type MosaicCommerceProviderV1ProductLoadRequestItem = {
  "product": MosaicCommerceProviderV1MosaicProduct;
  "binding": MosaicCommerceProviderV1ProviderProductBinding;
};

export type MosaicCommerceProviderV1ProductLoadRequest = {
  "requestId": MosaicCommerceProviderV1Identifier;
  "providerId": MosaicCommerceProviderV1Identifier;
  "products": Array<MosaicCommerceProviderV1ProductLoadRequestItem>;
};

export type MosaicCommerceProviderV1Period = {
  "unit": "day" | "week" | "month" | "year";
  "value": number;
};

export type MosaicCommerceProviderV1OfferEligibility = "eligible" | "ineligible" | "unknown";

export type MosaicCommerceProviderV1Trial = {
  "period": MosaicCommerceProviderV1Period;
  "eligibility"?: MosaicCommerceProviderV1OfferEligibility;
};

export type MosaicCommerceProviderV1IntroductoryOffer = {
  "localizedPrice": MosaicCommerceProviderV1SafeText;
  "period": MosaicCommerceProviderV1Period;
  "cycles": number;
  "paymentMode": "payAsYouGo" | "payUpFront";
  "eligibility"?: MosaicCommerceProviderV1OfferEligibility;
};

export type MosaicCommerceProviderV1ResolvedProductMetadata = {
  "localizedDisplayName": MosaicCommerceProviderV1SafeText;
  "localizedPrice": MosaicCommerceProviderV1SafeText;
  "locale"?: string;
  "currencyCode"?: string;
  "billingPeriod"?: MosaicCommerceProviderV1Period;
  "trial"?: MosaicCommerceProviderV1Trial;
  "introductoryOffer"?: MosaicCommerceProviderV1IntroductoryOffer;
};

export type MosaicCommerceProviderV1MetadataFreshness = {
  "source": "liveProvider" | "providerCache" | "mosaicSynchronization" | "simulated";
  "status": "fresh" | "stale" | "unknown";
  "observedAt": MosaicCommerceProviderV1UtcTimestamp;
  "expiresAt"?: MosaicCommerceProviderV1UtcTimestamp;
};

export type MosaicCommerceProviderV1ProductAvailability = {
  "status": "available" | "unavailable" | "unknown";
  "reason"?: "mappingMissing" | "mappingInvalid" | "productNotFound" | "temporarilyUnavailable" | "providerUnavailable" | "unsupportedProductType" | "metadataUnavailable";
};

export type MosaicCommerceProviderV1Diagnostic = {
  "code": string;
  "safeMessage": MosaicCommerceProviderV1SafeText;
  "severity": "info" | "warning" | "error";
  "retryable": boolean;
  "retryAfterSeconds"?: number;
  "correlationId": MosaicCommerceProviderV1Identifier;
  "providerCode"?: MosaicCommerceProviderV1SafeProviderCode;
  "mosaicProductId"?: MosaicCommerceProviderV1Identifier;
  "recoveryAction"?: "retry" | "reconnectProvider" | "fixProductMapping" | "updateProviderConfiguration" | "contactProvider" | "none";
};

export type MosaicCommerceProviderV1Diagnostics = Array<MosaicCommerceProviderV1Diagnostic>;

export type MosaicCommerceProviderV1ResolvedProduct = {
  "product": MosaicCommerceProviderV1MosaicProduct;
  "availability": MosaicCommerceProviderV1ProductAvailability;
  "metadata"?: MosaicCommerceProviderV1ResolvedProductMetadata;
  "freshness": MosaicCommerceProviderV1MetadataFreshness;
  "diagnostics": MosaicCommerceProviderV1Diagnostics;
};

export type MosaicCommerceProviderV1ProductLoadResult = {
  "requestId": MosaicCommerceProviderV1Identifier;
  "providerId": MosaicCommerceProviderV1Identifier;
  "products": Array<MosaicCommerceProviderV1ResolvedProduct>;
  "diagnostics": MosaicCommerceProviderV1Diagnostics;
};

export type MosaicCommerceProviderV1PurchaseRequest = {
  "operationId": MosaicCommerceProviderV1Identifier;
  "providerId": MosaicCommerceProviderV1Identifier;
  "mosaicProductId": MosaicCommerceProviderV1Identifier;
};

export type MosaicCommerceProviderV1PurchaseOutcomeName = "purchased" | "pending" | "deferred" | "cancelled" | "alreadyEntitled" | "productUnavailable" | "providerUnavailable" | "failed";

export type MosaicCommerceProviderV1PurchaseOutcome = {
  "operationId": MosaicCommerceProviderV1Identifier;
  "providerId": MosaicCommerceProviderV1Identifier;
  "mosaicProductId": MosaicCommerceProviderV1Identifier;
  "outcome": MosaicCommerceProviderV1PurchaseOutcomeName;
  "transactionReference"?: MosaicCommerceProviderV1SafeProviderCode;
  "activeEntitlementKeys"?: Array<MosaicCommerceProviderV1Identifier>;
  "occurredAt": MosaicCommerceProviderV1UtcTimestamp;
  "diagnostics": MosaicCommerceProviderV1Diagnostics;
};

export type MosaicCommerceProviderV1RestoreOutcomeName = "restored" | "nothingToRestore" | "cancelled" | "providerUnavailable" | "failed";

export type MosaicCommerceProviderV1RestoreOutcome = {
  "operationId": MosaicCommerceProviderV1Identifier;
  "providerId": MosaicCommerceProviderV1Identifier;
  "outcome": MosaicCommerceProviderV1RestoreOutcomeName;
  "activeEntitlementKeys"?: Array<MosaicCommerceProviderV1Identifier>;
  "occurredAt": MosaicCommerceProviderV1UtcTimestamp;
  "diagnostics": MosaicCommerceProviderV1Diagnostics;
};

export type MosaicCommerceProviderV1ActiveEntitlementOutcomeName = "available" | "unknown" | "providerUnavailable" | "failed";

export type MosaicCommerceProviderV1ActiveEntitlementOutcome = {
  "lookupId": MosaicCommerceProviderV1Identifier;
  "providerId": MosaicCommerceProviderV1Identifier;
  "outcome": MosaicCommerceProviderV1ActiveEntitlementOutcomeName;
  "activeEntitlementKeys"?: Array<MosaicCommerceProviderV1Identifier>;
  "freshness"?: MosaicCommerceProviderV1MetadataFreshness;
  "checkedAt": MosaicCommerceProviderV1UtcTimestamp;
  "diagnostics": MosaicCommerceProviderV1Diagnostics;
};

export type MosaicCommerceProviderV1ProviderHealth = "healthy" | "degraded" | "unavailable" | "unknown";

export type MosaicCommerceProviderV1ProviderDiagnostics = {
  "providerId": MosaicCommerceProviderV1Identifier;
  "health": MosaicCommerceProviderV1ProviderHealth;
  "freshness": MosaicCommerceProviderV1MetadataFreshness;
  "diagnostics": MosaicCommerceProviderV1Diagnostics;
};

export type MosaicCommerceProviderV1Envelope<
  TRecordType extends MosaicCommerceProviderV1RecordType,
  TPayload,
> = {
  "commerceProviderContractVersion": "1";
} & {
  "recordType": TRecordType;
  "payload": TPayload;
};

export type MosaicCommerceProviderV1Record =
  | MosaicCommerceProviderV1Envelope<"providerProfile", MosaicCommerceProviderV1ProviderProfile>
  | MosaicCommerceProviderV1Envelope<"productLoadRequest", MosaicCommerceProviderV1ProductLoadRequest>
  | MosaicCommerceProviderV1Envelope<"productLoadResult", MosaicCommerceProviderV1ProductLoadResult>
  | MosaicCommerceProviderV1Envelope<"purchaseRequest", MosaicCommerceProviderV1PurchaseRequest>
  | MosaicCommerceProviderV1Envelope<"purchaseOutcome", MosaicCommerceProviderV1PurchaseOutcome>
  | MosaicCommerceProviderV1Envelope<"restoreOutcome", MosaicCommerceProviderV1RestoreOutcome>
  | MosaicCommerceProviderV1Envelope<"activeEntitlementOutcome", MosaicCommerceProviderV1ActiveEntitlementOutcome>
  | MosaicCommerceProviderV1Envelope<"providerDiagnostics", MosaicCommerceProviderV1ProviderDiagnostics>;

export type MosaicCommerceProviderV2Identifier = string;

export type MosaicCommerceProviderV2SafeText = string;

export type MosaicCommerceProviderV2SafeProviderCode = string;

export type MosaicCommerceProviderV2UtcTimestamp = string;

export type MosaicCommerceProviderV2RecordType = "providerProfile" | "productLoadRequest" | "productLoadResult" | "purchaseRequest" | "purchaseOutcome" | "restoreOutcome" | "activeEntitlementOutcome" | "providerDiagnostics" | "commerceUpdate" | "commerceUpdateAcceptance";

export type MosaicCommerceProviderV2ProviderIdentity = {
  "id": MosaicCommerceProviderV2Identifier;
  "displayName": MosaicCommerceProviderV2SafeText;
  "adapterVersion": string;
};

export type MosaicCommerceProviderV2CapabilityName = "productLoading" | "subscriptions" | "oneTimeNonConsumables" | "trials" | "introductoryOffers" | "promotionalOffers" | "restore" | "activeEntitlementLookup" | "pendingPurchases" | "deferredPurchases" | "serverConfirmedTransactions" | "productSynchronization" | "providerDiagnostics" | "basePlans" | "explicitOffers" | "storeSynchronization" | "activePurchaseRecovery" | "asynchronousCommerceUpdates" | "localDeliveryAcceptance";

export type MosaicCommerceProviderV2ProviderCapability = {
  "name": MosaicCommerceProviderV2CapabilityName;
  "support": "supported" | "unsupported" | "conditional";
  "reasonCode"?: string;
};

export type MosaicCommerceProviderV2ProviderProfile = {
  "provider": MosaicCommerceProviderV2ProviderIdentity;
  "capabilities": Array<MosaicCommerceProviderV2ProviderCapability>;
  "recoveryMode": MosaicCommerceProviderV2RecoveryMode;
};

export type MosaicCommerceProviderV2RecoveryMode = "providerDefined" | "storeSynchronization" | "activePurchaseRecovery";

export type MosaicCommerceProviderV2ConfigurationReference = {
  "configurationId": MosaicCommerceProviderV2Identifier;
  "configurationRevision": string;
};

export type MosaicCommerceProviderV2ProductType = "subscription" | "one_time_non_consumable";

export type MosaicCommerceProviderV2MosaicProduct = {
  "mosaicProductId": MosaicCommerceProviderV2Identifier;
  "key": MosaicCommerceProviderV2Identifier;
  "type": MosaicCommerceProviderV2ProductType;
  "entitlementKeys": Array<MosaicCommerceProviderV2Identifier>;
};

export type MosaicCommerceProviderV2ProviderProductBinding = {
  "mappingId": MosaicCommerceProviderV2Identifier;
  "providerProductReference": string;
};

export type MosaicCommerceProviderV2ProductLoadRequestItem = {
  "product": MosaicCommerceProviderV2MosaicProduct;
  "binding": MosaicCommerceProviderV2ProviderProductBinding;
};

export type MosaicCommerceProviderV2ProductLoadRequest = {
  "requestId": MosaicCommerceProviderV2Identifier;
  "providerId": MosaicCommerceProviderV2Identifier;
  "products": Array<MosaicCommerceProviderV2ProductLoadRequestItem>;
};

export type MosaicCommerceProviderV2Period = {
  "unit": "day" | "week" | "month" | "year";
  "value": number;
};

export type MosaicCommerceProviderV2OfferEligibility = "eligible" | "ineligible" | "unknown";

export type MosaicCommerceProviderV2Trial = {
  "period": MosaicCommerceProviderV2Period;
  "eligibility"?: MosaicCommerceProviderV2OfferEligibility;
};

export type MosaicCommerceProviderV2IntroductoryOffer = {
  "localizedPrice": MosaicCommerceProviderV2SafeText;
  "period": MosaicCommerceProviderV2Period;
  "cycles": number;
  "paymentMode": "payAsYouGo" | "payUpFront";
  "eligibility"?: MosaicCommerceProviderV2OfferEligibility;
};

export type MosaicCommerceProviderV2ResolvedProductMetadata = {
  "localizedDisplayName": MosaicCommerceProviderV2SafeText;
  "localizedPrice": MosaicCommerceProviderV2SafeText;
  "locale"?: string;
  "currencyCode"?: string;
  "billingPeriod"?: MosaicCommerceProviderV2Period;
  "trial"?: MosaicCommerceProviderV2Trial;
  "introductoryOffer"?: MosaicCommerceProviderV2IntroductoryOffer;
};

export type MosaicCommerceProviderV2MetadataFreshness = {
  "source": "liveProvider" | "providerCache" | "mosaicSynchronization" | "simulated";
  "status": "fresh" | "stale" | "unknown";
  "observedAt": MosaicCommerceProviderV2UtcTimestamp;
  "expiresAt"?: MosaicCommerceProviderV2UtcTimestamp;
};

export type MosaicCommerceProviderV2ProductAvailability = {
  "status": "available" | "unavailable" | "unknown";
  "reason"?: "mappingMissing" | "mappingInvalid" | "productNotFound" | "temporarilyUnavailable" | "providerUnavailable" | "unsupportedProductType" | "metadataUnavailable";
};

export type MosaicCommerceProviderV2Diagnostic = {
  "code": string;
  "safeMessage": MosaicCommerceProviderV2SafeText;
  "severity": "info" | "warning" | "error";
  "retryable": boolean;
  "retryAfterSeconds"?: number;
  "correlationId": MosaicCommerceProviderV2Identifier;
  "providerCode"?: MosaicCommerceProviderV2SafeProviderCode;
  "mosaicProductId"?: MosaicCommerceProviderV2Identifier;
  "recoveryAction"?: "retry" | "reconnectProvider" | "fixProductMapping" | "updateProviderConfiguration" | "contactProvider" | "none";
};

export type MosaicCommerceProviderV2Diagnostics = Array<MosaicCommerceProviderV2Diagnostic>;

export type MosaicCommerceProviderV2ResolvedProduct = {
  "product": MosaicCommerceProviderV2MosaicProduct;
  "availability": MosaicCommerceProviderV2ProductAvailability;
  "metadata"?: MosaicCommerceProviderV2ResolvedProductMetadata;
  "freshness": MosaicCommerceProviderV2MetadataFreshness;
  "diagnostics": MosaicCommerceProviderV2Diagnostics;
};

export type MosaicCommerceProviderV2ProductLoadResult = {
  "requestId": MosaicCommerceProviderV2Identifier;
  "providerId": MosaicCommerceProviderV2Identifier;
  "products": Array<MosaicCommerceProviderV2ResolvedProduct>;
  "diagnostics": MosaicCommerceProviderV2Diagnostics;
};

export type MosaicCommerceProviderV2PurchaseRequest = {
  "operationId": MosaicCommerceProviderV2Identifier;
  "providerId": MosaicCommerceProviderV2Identifier;
  "mosaicProductId": MosaicCommerceProviderV2Identifier;
  "configuration": MosaicCommerceProviderV2ConfigurationReference;
};

export type MosaicCommerceProviderV2PurchaseOutcomeName = "purchased" | "pending" | "deferred" | "cancelled" | "alreadyEntitled" | "productUnavailable" | "providerUnavailable" | "failed";

export type MosaicCommerceProviderV2PurchaseOutcome = {
  "operationId": MosaicCommerceProviderV2Identifier;
  "providerId": MosaicCommerceProviderV2Identifier;
  "mosaicProductId": MosaicCommerceProviderV2Identifier;
  "outcome": MosaicCommerceProviderV2PurchaseOutcomeName;
  "transactionReference"?: MosaicCommerceProviderV2SafeProviderCode;
  "activeEntitlementKeys"?: Array<MosaicCommerceProviderV2Identifier>;
  "occurredAt": MosaicCommerceProviderV2UtcTimestamp;
  "diagnostics": MosaicCommerceProviderV2Diagnostics;
};

export type MosaicCommerceProviderV2RestoreOutcomeName = "restored" | "nothingToRestore" | "cancelled" | "providerUnavailable" | "failed";

export type MosaicCommerceProviderV2RestoreOutcome = {
  "operationId": MosaicCommerceProviderV2Identifier;
  "providerId": MosaicCommerceProviderV2Identifier;
  "outcome": MosaicCommerceProviderV2RestoreOutcomeName;
  "recoveryMode": MosaicCommerceProviderV2RecoveryMode;
  "activeEntitlementKeys"?: Array<MosaicCommerceProviderV2Identifier>;
  "completedAt": MosaicCommerceProviderV2UtcTimestamp;
  "diagnostics": MosaicCommerceProviderV2Diagnostics;
};

export type MosaicCommerceProviderV2ActiveEntitlementOutcomeName = "available" | "unknown" | "providerUnavailable" | "failed";

export type MosaicCommerceProviderV2ActiveEntitlementOutcome = {
  "lookupId": MosaicCommerceProviderV2Identifier;
  "providerId": MosaicCommerceProviderV2Identifier;
  "outcome": MosaicCommerceProviderV2ActiveEntitlementOutcomeName;
  "activeEntitlementKeys"?: Array<MosaicCommerceProviderV2Identifier>;
  "freshness"?: MosaicCommerceProviderV2MetadataFreshness;
  "observedAt": MosaicCommerceProviderV2UtcTimestamp;
  "diagnostics": MosaicCommerceProviderV2Diagnostics;
};

export type MosaicCommerceProviderV2ProviderHealth = "healthy" | "degraded" | "unavailable" | "unknown";

export type MosaicCommerceProviderV2CommerceUpdateOutcomeName = "purchased" | "pending" | "cancelled" | "providerUnavailable" | "failed" | "entitlementsChanged";

export type MosaicCommerceProviderV2CommerceUpdate = {
  "updateId": MosaicCommerceProviderV2Identifier;
  "operationId"?: MosaicCommerceProviderV2Identifier;
  "providerId": MosaicCommerceProviderV2Identifier;
  "mosaicProductId": MosaicCommerceProviderV2Identifier;
  "configuration": MosaicCommerceProviderV2ConfigurationReference;
  "outcome": MosaicCommerceProviderV2CommerceUpdateOutcomeName;
  "transactionReference"?: MosaicCommerceProviderV2SafeProviderCode;
  "activeEntitlementKeys"?: Array<MosaicCommerceProviderV2Identifier>;
  "occurredAt": MosaicCommerceProviderV2UtcTimestamp;
  "diagnostics": MosaicCommerceProviderV2Diagnostics;
};

export type MosaicCommerceProviderV2CommerceUpdateAcceptanceDisposition = "accepted" | "alreadyAccepted" | "rejectedStaleConfiguration" | "deliveryFailed";

export type MosaicCommerceProviderV2CommerceUpdateAcceptance = {
  "updateId": MosaicCommerceProviderV2Identifier;
  "providerId": MosaicCommerceProviderV2Identifier;
  "configuration": MosaicCommerceProviderV2ConfigurationReference;
  "disposition": MosaicCommerceProviderV2CommerceUpdateAcceptanceDisposition;
  "decidedAt": MosaicCommerceProviderV2UtcTimestamp;
  "diagnostics": MosaicCommerceProviderV2Diagnostics;
};

export type MosaicCommerceProviderV2ProviderDiagnostics = {
  "providerId": MosaicCommerceProviderV2Identifier;
  "health": MosaicCommerceProviderV2ProviderHealth;
  "freshness": MosaicCommerceProviderV2MetadataFreshness;
  "diagnostics": MosaicCommerceProviderV2Diagnostics;
};

export type MosaicCommerceProviderV2Envelope<
  TRecordType extends MosaicCommerceProviderV2RecordType,
  TPayload,
> = {
  "commerceProviderContractVersion": "2";
} & {
  "recordType": TRecordType;
  "payload": TPayload;
};

export type MosaicCommerceProviderV2Record =
  | MosaicCommerceProviderV2Envelope<"providerProfile", MosaicCommerceProviderV2ProviderProfile>
  | MosaicCommerceProviderV2Envelope<"productLoadRequest", MosaicCommerceProviderV2ProductLoadRequest>
  | MosaicCommerceProviderV2Envelope<"productLoadResult", MosaicCommerceProviderV2ProductLoadResult>
  | MosaicCommerceProviderV2Envelope<"purchaseRequest", MosaicCommerceProviderV2PurchaseRequest>
  | MosaicCommerceProviderV2Envelope<"purchaseOutcome", MosaicCommerceProviderV2PurchaseOutcome>
  | MosaicCommerceProviderV2Envelope<"restoreOutcome", MosaicCommerceProviderV2RestoreOutcome>
  | MosaicCommerceProviderV2Envelope<"activeEntitlementOutcome", MosaicCommerceProviderV2ActiveEntitlementOutcome>
  | MosaicCommerceProviderV2Envelope<"providerDiagnostics", MosaicCommerceProviderV2ProviderDiagnostics>
  | MosaicCommerceProviderV2Envelope<"commerceUpdate", MosaicCommerceProviderV2CommerceUpdate>
  | MosaicCommerceProviderV2Envelope<"commerceUpdateAcceptance", MosaicCommerceProviderV2CommerceUpdateAcceptance>;

export type MosaicCommerceConfigurationV1Identifier = string;

export type MosaicCommerceConfigurationV1EntitlementKey = string;

export type MosaicCommerceConfigurationV1OpaqueProviderIdentifier = string;

export type MosaicCommerceConfigurationV1Sha256Digest = string;

export type MosaicCommerceConfigurationV1UtcTimestamp = string;

export type MosaicCommerceConfigurationV1StorePlatform = "ios" | "android";

export type MosaicCommerceConfigurationV1ConfigurationRelease = {
  "id": MosaicCommerceConfigurationV1Identifier;
  "contentDigest": MosaicCommerceConfigurationV1Sha256Digest;
};

export type MosaicCommerceConfigurationV1ProviderActivation = {
  "source": "providerConnection";
  "providerConnectionId": MosaicCommerceConfigurationV1Identifier;
} | {
  "source": "sdkLocal";
  "localSnapshotId": MosaicCommerceConfigurationV1Identifier;
};

export type MosaicCommerceConfigurationV1ActiveProvider = {
  "identity": MosaicCommerceProviderV1ProviderIdentity;
  "activation": MosaicCommerceConfigurationV1ProviderActivation;
  "capabilities": Array<MosaicCommerceProviderV1ProviderCapability>;
};

export type MosaicCommerceConfigurationV1AdapterMapping = {
  "kind": "directProduct";
} | {
  "kind": "revenueCatPackage";
  "offeringIdentifier": MosaicCommerceConfigurationV1OpaqueProviderIdentifier;
  "packageIdentifier": MosaicCommerceConfigurationV1OpaqueProviderIdentifier;
};

export type MosaicCommerceConfigurationV1ProductMapping = {
  "mosaicProductId": MosaicCommerceConfigurationV1Identifier;
  "mappingId": MosaicCommerceConfigurationV1Identifier;
  "providerProductReference": MosaicCommerceConfigurationV1OpaqueProviderIdentifier;
  "adapterMapping": MosaicCommerceConfigurationV1AdapterMapping;
};

export type MosaicCommerceConfigurationV1EntitlementMapping = {
  "mosaicEntitlementKey": MosaicCommerceConfigurationV1EntitlementKey;
  "providerEntitlementIdentifier": MosaicCommerceConfigurationV1OpaqueProviderIdentifier;
};

export type MosaicCommerceConfigurationV1Freshness = {
  "source": "providerSynchronization" | "sdkLocalSnapshot";
  "status": "fresh" | "stale";
  "providerObservedAt": MosaicCommerceConfigurationV1UtcTimestamp;
  "synchronizedAt": MosaicCommerceConfigurationV1UtcTimestamp;
  "staleAt": MosaicCommerceConfigurationV1UtcTimestamp;
  "expiresAt"?: MosaicCommerceConfigurationV1UtcTimestamp;
};

export type MosaicCommerceConfigurationV1Configuration = {
  "id": MosaicCommerceConfigurationV1Identifier;
  "environmentId": MosaicCommerceConfigurationV1Identifier;
  "applicationId": MosaicCommerceConfigurationV1Identifier;
  "storePlatform": MosaicCommerceConfigurationV1StorePlatform;
  "configurationRelease": MosaicCommerceConfigurationV1ConfigurationRelease;
  "contentDigest": MosaicCommerceConfigurationV1Sha256Digest;
  "activeProvider": MosaicCommerceConfigurationV1ActiveProvider;
  "productMappings": Array<MosaicCommerceConfigurationV1ProductMapping>;
  "entitlementMappings": Array<MosaicCommerceConfigurationV1EntitlementMapping>;
  "freshness": MosaicCommerceConfigurationV1Freshness;
  "diagnostics": Array<MosaicCommerceProviderV1Diagnostic>;
};

export type MosaicCommerceConfigurationV1 = {
  "commerceConfigurationVersion": "1";
  "configuration": MosaicCommerceConfigurationV1Configuration;
};

export type MosaicCommerceConfigurationV2Identifier = string;

export type MosaicCommerceConfigurationV2EntitlementKey = string;

export type MosaicCommerceConfigurationV2OpaqueProviderIdentifier = string;

export type MosaicCommerceConfigurationV2Sha256Digest = string;

export type MosaicCommerceConfigurationV2UtcTimestamp = string;

export type MosaicCommerceConfigurationV2StorePlatform = "ios" | "android";

export type MosaicCommerceConfigurationV2ConfigurationRelease = {
  "id": MosaicCommerceConfigurationV2Identifier;
  "contentDigest": MosaicCommerceConfigurationV2Sha256Digest;
};

export type MosaicCommerceConfigurationV2ProviderActivation = {
  "source": "providerConnection";
  "providerConnectionId": MosaicCommerceConfigurationV2Identifier;
} | {
  "source": "sdkLocal";
  "localSnapshotId": MosaicCommerceConfigurationV2Identifier;
} | {
  "source": "nativeStore";
};

export type MosaicCommerceConfigurationV2ActiveProvider = {
  "identity": MosaicCommerceProviderV2ProviderIdentity;
  "activation": MosaicCommerceConfigurationV2ProviderActivation;
  "capabilities": Array<MosaicCommerceProviderV2ProviderCapability>;
  "recoveryMode": MosaicCommerceProviderV2RecoveryMode;
};

export type MosaicCommerceConfigurationV2AdapterMapping = {
  "kind": "directProduct";
} | {
  "kind": "revenueCatPackage";
  "offeringIdentifier": MosaicCommerceConfigurationV2OpaqueProviderIdentifier;
  "packageIdentifier": MosaicCommerceConfigurationV2OpaqueProviderIdentifier;
} | {
  "kind": "storeKitProduct";
} | {
  "kind": "googlePlayProduct";
  "basePlanId"?: MosaicCommerceConfigurationV2OpaqueProviderIdentifier;
  "offerId"?: MosaicCommerceConfigurationV2OpaqueProviderIdentifier;
};

export type MosaicCommerceConfigurationV2ProductMapping = {
  "mosaicProductId": MosaicCommerceConfigurationV2Identifier;
  "mappingId": MosaicCommerceConfigurationV2Identifier;
  "productType": MosaicCommerceProviderV2ProductType;
  "entitlementKeys": Array<MosaicCommerceConfigurationV2EntitlementKey>;
  "providerProductReference": MosaicCommerceConfigurationV2OpaqueProviderIdentifier;
  "adapterMapping": MosaicCommerceConfigurationV2AdapterMapping;
};

export type MosaicCommerceConfigurationV2EntitlementMapping = {
  "mosaicEntitlementKey": MosaicCommerceConfigurationV2EntitlementKey;
  "providerEntitlementIdentifier": MosaicCommerceConfigurationV2OpaqueProviderIdentifier;
};

export type MosaicCommerceConfigurationV2Freshness = {
  "source": "providerSynchronization" | "sdkLocalSnapshot";
  "status": "fresh" | "stale";
  "providerObservedAt": MosaicCommerceConfigurationV2UtcTimestamp;
  "synchronizedAt": MosaicCommerceConfigurationV2UtcTimestamp;
  "staleAt": MosaicCommerceConfigurationV2UtcTimestamp;
  "expiresAt"?: MosaicCommerceConfigurationV2UtcTimestamp;
} | {
  "source": "nativeStoreConfiguration";
  "status": "configured" | "fresh" | "stale";
  "configuredAt": MosaicCommerceConfigurationV2UtcTimestamp;
  "observation"?: {
    "environment": "test" | "production" | "unknown";
    "observedAt": MosaicCommerceConfigurationV2UtcTimestamp;
    "expiresAt"?: MosaicCommerceConfigurationV2UtcTimestamp;
  };
};

export type MosaicCommerceConfigurationV2Configuration = {
  "id": MosaicCommerceConfigurationV2Identifier;
  "environmentId": MosaicCommerceConfigurationV2Identifier;
  "applicationId": MosaicCommerceConfigurationV2Identifier;
  "storePlatform": MosaicCommerceConfigurationV2StorePlatform;
  "configurationRelease": MosaicCommerceConfigurationV2ConfigurationRelease;
  "contentDigest": MosaicCommerceConfigurationV2Sha256Digest;
  "activeProvider": MosaicCommerceConfigurationV2ActiveProvider;
  "productMappings": Array<MosaicCommerceConfigurationV2ProductMapping>;
  "entitlementMappings": Array<MosaicCommerceConfigurationV2EntitlementMapping>;
  "freshness": MosaicCommerceConfigurationV2Freshness;
  "diagnostics": Array<MosaicCommerceProviderV2Diagnostic>;
};

export type MosaicCommerceConfigurationV2 = {
  "commerceConfigurationVersion": "2";
  "configuration": MosaicCommerceConfigurationV2Configuration;
};

export type MosaicPlacementDecisionV1Identifier = string;

export type MosaicPlacementDecisionV1Key = string;

export type MosaicPlacementDecisionV1EnvironmentKey = string;

export type MosaicPlacementDecisionV1UtcTimestamp = string;

export type MosaicPlacementDecisionV1SafeLabel = string;

export type MosaicPlacementDecisionV1TypedValue = {
  "type": "string";
  "value": string;
} | {
  "type": "boolean";
  "value": boolean;
} | {
  "type": "number";
  "value": number;
} | {
  "type": "timestamp";
  "value": MosaicPlacementDecisionV1UtcTimestamp;
} | {
  "type": "semantic_version";
  "value": string;
} | {
  "type": "string_list";
  "value": Array<string>;
};

export type MosaicPlacementDecisionV1Source = {
  "kind": "device.platform" | "device.os_version" | "application.version" | "application.locale" | "context.country" | "environment.id" | "environment.key" | "identity.user_present";
} | {
  "kind": "user_attribute";
  "key": MosaicPlacementDecisionV1Key;
} | {
  "kind": "entitlement_state";
  "key": MosaicPlacementDecisionV1Key;
} | {
  "kind": "product_availability" | "product_readiness";
  "productId": MosaicPlacementDecisionV1Identifier;
} | {
  "kind": "provider_capability";
  "capability": "product_loading" | "purchase" | "restore" | "entitlement_lookup";
};

export type MosaicPlacementDecisionV1Leaf = {
  "type": "condition";
  "source": MosaicPlacementDecisionV1Source;
  "operator": "equals" | "not_equals" | "in" | "not_in" | "greater_than" | "greater_than_or_equal" | "less_than" | "less_than_or_equal" | "exists" | "does_not_exist" | "contains_any" | "contains_all" | "locale_matches";
  "operand"?: MosaicPlacementDecisionV1TypedValue;
};

export type MosaicPlacementDecisionV1ConditionNode = MosaicPlacementDecisionV1Leaf | {
  "type": "all" | "any";
  "children": Array<MosaicPlacementDecisionV1ConditionNode>;
} | {
  "type": "not";
  "child": MosaicPlacementDecisionV1ConditionNode;
};

export type MosaicPlacementDecisionV1Outcome = {
  "type": "paywall";
  "paywallVersionId": MosaicPlacementDecisionV1Identifier;
  "unavailableFallbackKey"?: MosaicPlacementDecisionV1Key;
} | {
  "type": "no_paywall";
} | {
  "type": "fallback";
  "key": MosaicPlacementDecisionV1Key;
} | {
  "type": "unavailable";
  "reason": "no_safe_decision" | "configuration_incompatible" | "content_unavailable" | "commerce_unavailable";
};

export type MosaicPlacementDecisionV1Rollout = {
  "algorithm": "sha256_length_prefixed_v1";
  "thresholdBasisPoints": number;
};

export type MosaicPlacementDecisionV1Rule = {
  "id": MosaicPlacementDecisionV1Identifier;
  "priority": number;
  "enabled": boolean;
  "safeLabel"?: MosaicPlacementDecisionV1SafeLabel;
  "conditions": MosaicPlacementDecisionV1ConditionNode;
  "rollout"?: MosaicPlacementDecisionV1Rollout;
  "outcome": MosaicPlacementDecisionV1Outcome;
};

export type MosaicPlacementDecisionV1Fallback = {
  "key": MosaicPlacementDecisionV1Key;
  "safeLabel"?: MosaicPlacementDecisionV1SafeLabel;
  "outcome": MosaicPlacementDecisionV1Outcome;
};

export type MosaicPlacementDecisionV1AttributeDefinition = {
  "key": MosaicPlacementDecisionV1Key;
  "type": "string" | "boolean" | "number" | "timestamp" | "semantic_version" | "string_list";
  "sensitivity": "standard" | "sensitive";
  "allowedOperators": Array<"equals" | "not_equals" | "in" | "not_in" | "greater_than" | "greater_than_or_equal" | "less_than" | "less_than_or_equal" | "exists" | "does_not_exist" | "contains_any" | "contains_all">;
};

export type MosaicPlacementDecisionV1Compatibility = {
  "requiredFeatures": Array<"condition.all" | "condition.any" | "condition.not" | "operator.contains_all" | "operator.contains_any" | "operator.does_not_exist" | "operator.equals" | "operator.exists" | "operator.greater_than" | "operator.greater_than_or_equal" | "operator.in" | "operator.less_than" | "operator.less_than_or_equal" | "operator.locale_matches" | "operator.not_equals" | "operator.not_in" | "outcome.fallback" | "outcome.no_paywall" | "outcome.paywall" | "outcome.unavailable" | "override.qa" | "source.application.locale" | "source.application.version" | "source.context.country" | "source.device.os_version" | "source.device.platform" | "source.entitlement_state" | "source.environment.id" | "source.environment.key" | "source.identity.user_present" | "source.product_availability" | "source.product_readiness" | "source.provider_capability" | "source.user_attribute">;
  "bucketingAlgorithms": Array<"sha256_length_prefixed_v1">;
};

export type MosaicPlacementDecisionV1QaOverride = {
  "id": MosaicPlacementDecisionV1Identifier;
  "selectorDigest": string;
  "safeLabel": MosaicPlacementDecisionV1SafeLabel;
  "startsAt": MosaicPlacementDecisionV1UtcTimestamp;
  "expiresAt": MosaicPlacementDecisionV1UtcTimestamp;
  "outcome": MosaicPlacementDecisionV1Outcome;
};

export type MosaicPlacementDecisionV1RuleSet = {
  "id": MosaicPlacementDecisionV1Identifier;
  "version": number;
  "projectId": MosaicPlacementDecisionV1Identifier;
  "environmentId": MosaicPlacementDecisionV1Identifier;
  "environmentKey": MosaicPlacementDecisionV1EnvironmentKey;
  "placementId": MosaicPlacementDecisionV1Identifier;
  "placementKey": MosaicPlacementDecisionV1Key;
  "enabled": boolean;
  "assignmentPolicy": "installation" | "identified_user" | "identified_user_or_installation";
  "attributeDefinitions": Array<MosaicPlacementDecisionV1AttributeDefinition>;
  "fallbacks": Array<MosaicPlacementDecisionV1Fallback>;
  "rules": Array<MosaicPlacementDecisionV1Rule>;
  "defaultOutcome": MosaicPlacementDecisionV1Outcome;
  "qaOverrides": Array<MosaicPlacementDecisionV1QaOverride>;
  "compatibility": MosaicPlacementDecisionV1Compatibility;
};

export type MosaicPlacementDecisionV1 = {
  "placementDecisionVersion": "1";
  "ruleSet": MosaicPlacementDecisionV1RuleSet;
};

export type MosaicConfigurationDeliveryV1Identifier = string;

export type MosaicConfigurationDeliveryV1PlacementKey = string;

export type MosaicConfigurationDeliveryV1EnvironmentKey = string;

export type MosaicConfigurationDeliveryV1UtcTimestamp = string;

export type MosaicConfigurationDeliveryV1Sha256Digest = string;

export type MosaicConfigurationDeliveryV1ImmutableHttpsUrl = string;

export type MosaicConfigurationDeliveryV1Environment = {
  "id": MosaicConfigurationDeliveryV1Identifier;
  "key": MosaicConfigurationDeliveryV1EnvironmentKey;
};

export type MosaicConfigurationDeliveryV1ProtocolCompatibility = {
  "version": "0.3";
  "requiredCapabilities": Array<MosaicPaywallV03RequiredCapability>;
};

export type MosaicConfigurationDeliveryV1ReleaseCompatibility = {
  "paywallProtocols": Array<MosaicConfigurationDeliveryV1ProtocolCompatibility>;
  "acceptance": "atomic";
};

export type MosaicConfigurationDeliveryV1PlacementBinding = {
  "key": MosaicConfigurationDeliveryV1PlacementKey;
  "paywallVersionId": MosaicConfigurationDeliveryV1Identifier;
};

export type MosaicConfigurationDeliveryV1AssetBinding = {
  "documentAssetId": MosaicConfigurationDeliveryV1Identifier;
  "assetReferenceId": MosaicConfigurationDeliveryV1Identifier;
};

export type MosaicConfigurationDeliveryV1PaywallVersion = {
  "id": MosaicConfigurationDeliveryV1Identifier;
  "paywallId": MosaicConfigurationDeliveryV1Identifier;
  "protocolVersion": "0.3";
  "documentDigest": MosaicConfigurationDeliveryV1Sha256Digest;
  "document": MosaicPaywallV03Document;
  "productReferenceIds": Array<MosaicConfigurationDeliveryV1Identifier>;
  "assetBindings": Array<MosaicConfigurationDeliveryV1AssetBinding>;
};

export type MosaicConfigurationDeliveryV1ProductReference = {
  "id": MosaicConfigurationDeliveryV1Identifier;
  "type": "subscription" | "one_time_non_consumable";
  "fallbackDisplayName": string;
};

export type MosaicConfigurationDeliveryV1AssetReference = {
  "id": MosaicConfigurationDeliveryV1Identifier;
  "kind": "image" | "video";
  "mediaType": string;
  "byteLength": number;
  "contentDigest": MosaicConfigurationDeliveryV1Sha256Digest;
  "url": MosaicConfigurationDeliveryV1ImmutableHttpsUrl;
};

export type MosaicConfigurationDeliveryV1Release = {
  "id": MosaicConfigurationDeliveryV1Identifier;
  "number": number;
  "environment": MosaicConfigurationDeliveryV1Environment;
  "publishedAt": MosaicConfigurationDeliveryV1UtcTimestamp;
  "contentDigest": MosaicConfigurationDeliveryV1Sha256Digest;
  "compatibility": MosaicConfigurationDeliveryV1ReleaseCompatibility;
  "placements": Array<MosaicConfigurationDeliveryV1PlacementBinding>;
  "paywallVersions": Array<MosaicConfigurationDeliveryV1PaywallVersion>;
  "productReferences": Array<MosaicConfigurationDeliveryV1ProductReference>;
  "assetReferences": Array<MosaicConfigurationDeliveryV1AssetReference>;
};

export type MosaicConfigurationDeliveryV1 = {
  "configurationDeliveryVersion": "1";
  "release": MosaicConfigurationDeliveryV1Release;
};

export type MosaicConfigurationDeliveryV2Identifier = MosaicConfigurationDeliveryV1Identifier;

export type MosaicConfigurationDeliveryV2Key = string;

export type MosaicConfigurationDeliveryV2Environment = {
  "id": MosaicConfigurationDeliveryV2Identifier;
  "key": string;
  "mode": "development" | "staging" | "production";
};

export type MosaicConfigurationDeliveryV2DecisionFeature = "condition.all" | "condition.any" | "condition.not" | "operator.contains_all" | "operator.contains_any" | "operator.does_not_exist" | "operator.equals" | "operator.exists" | "operator.greater_than" | "operator.greater_than_or_equal" | "operator.in" | "operator.less_than" | "operator.less_than_or_equal" | "operator.locale_matches" | "operator.not_equals" | "operator.not_in" | "outcome.fallback" | "outcome.no_paywall" | "outcome.paywall" | "outcome.unavailable" | "override.qa" | "source.application.locale" | "source.application.version" | "source.context.country" | "source.device.os_version" | "source.device.platform" | "source.entitlement_state" | "source.environment.id" | "source.environment.key" | "source.identity.user_present" | "source.product_availability" | "source.product_readiness" | "source.provider_capability" | "source.user_attribute";

export type MosaicConfigurationDeliveryV2PaywallVersion = MosaicConfigurationDeliveryV1PaywallVersion;

export type MosaicConfigurationDeliveryV2AssetReference = MosaicConfigurationDeliveryV1AssetReference;

export type MosaicConfigurationDeliveryV2ProductReference = {
  "id": MosaicConfigurationDeliveryV2Identifier;
  "type": "subscription" | "one_time_non_consumable";
  "fallbackDisplayName": string;
  "readiness": "ready" | "not_ready";
};

export type MosaicConfigurationDeliveryV2EntitlementReference = {
  "id": MosaicConfigurationDeliveryV2Identifier;
  "key": MosaicConfigurationDeliveryV2Key;
};

export type MosaicConfigurationDeliveryV2DecisionCompatibility = {
  "version": "1";
  "requiredFeatures": Array<MosaicConfigurationDeliveryV2DecisionFeature>;
  "bucketingAlgorithms": Array<"sha256_length_prefixed_v1">;
};

export type MosaicConfigurationDeliveryV2PaywallCompatibility = {
  "version": "0.3";
  "requiredCapabilities": Array<MosaicPaywallV03RequiredCapability>;
};

export type MosaicConfigurationDeliveryV2Compatibility = {
  "placementDecisionContracts": Array<MosaicConfigurationDeliveryV2DecisionCompatibility>;
  "paywallProtocols": Array<MosaicConfigurationDeliveryV2PaywallCompatibility>;
  "acceptance": "atomic";
};

export type MosaicConfigurationDeliveryV2Release = {
  "id": MosaicConfigurationDeliveryV2Identifier;
  "number": number;
  "projectId": MosaicConfigurationDeliveryV2Identifier;
  "environment": MosaicConfigurationDeliveryV2Environment;
  "publishedAt": MosaicConfigurationDeliveryV1UtcTimestamp;
  "contentDigest": MosaicConfigurationDeliveryV1Sha256Digest;
  "compatibility": MosaicConfigurationDeliveryV2Compatibility;
  "placementDecisions": Array<MosaicPlacementDecisionV1>;
  "paywallVersions": Array<MosaicConfigurationDeliveryV2PaywallVersion>;
  "productReferences": Array<MosaicConfigurationDeliveryV2ProductReference>;
  "entitlementReferences": Array<MosaicConfigurationDeliveryV2EntitlementReference>;
  "assetReferences": Array<MosaicConfigurationDeliveryV2AssetReference>;
};

export type MosaicConfigurationDeliveryV2 = {
  "configurationDeliveryVersion": "2";
  "release": MosaicConfigurationDeliveryV2Release;
};

export type MosaicPaywallDocument = MosaicPaywallV03Document;
export type MosaicPreviewMessage = MosaicPreviewV03Message;
export type MosaicLocalProject = MosaicLocalProjectV03;
export type MosaicPreviewCapabilityReportPayload = MosaicPreviewV03CapabilityReportPayload;
export type MosaicPreviewCapabilityName = MosaicPreviewV03CapabilityName;
export type MosaicPreviewValidationDiagnostic = MosaicPreviewV03ValidationDiagnostic;
