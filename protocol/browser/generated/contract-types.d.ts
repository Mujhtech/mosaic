// Generated from canonical Mosaic JSON Schemas. Do not edit.

export type MosaicPaywallV02Version = "0.2";

export type MosaicPaywallV02Identifier = string;

export type MosaicPaywallV02LocalizationKey = string;

export type MosaicPaywallV02LocaleTag = string;

export type MosaicPaywallV02LocalizedText = {
  "default": string;
  "localizationKey": MosaicPaywallV02LocalizationKey;
};

export type MosaicPaywallV02LocaleCatalog = {
  "direction": "ltr" | "rtl";
  "strings": Record<string, string>;
};

export type MosaicPaywallV02Localization = {
  "defaultLocale": MosaicPaywallV02LocaleTag;
  "fallbackLocale": MosaicPaywallV02LocaleTag;
  "locales": Record<string, MosaicPaywallV02LocaleCatalog>;
};

export type MosaicPaywallV02CapabilityName = "layout.scrollContainer" | "layout.stack" | "layout.sizing" | "layout.heightSizing" | "layout.outerInsets" | "navigation.screens" | "navigation.sheets" | "component.text" | "component.image" | "component.icon" | "component.featureList" | "component.productSelector" | "component.productCard" | "component.productBadge" | "component.button" | "component.carousel" | "component.switch" | "component.countdown" | "localization.catalogs" | "localization.rtl" | "localization.productTemplate" | "product.references" | "asset.bundledImage" | "asset.remoteImage" | "asset.bundledVideo" | "asset.remoteVideo" | "action.purchase" | "action.restore" | "action.close" | "action.navigateTo" | "action.navigateBack" | "action.openExternalUrl" | "accessibility.metadata" | "fallback.asset" | "fallback.product" | "outcome.normalized" | "style.colors" | "style.designTokens" | "style.gradientBackground" | "style.mediaBackground" | "style.shadow" | "style.box" | "style.clipping" | "style.typography" | "style.productCardStates" | "visibility.static" | "condition.switchVisibility";

export type MosaicPaywallV02RequiredCapability = {
  "name": MosaicPaywallV02CapabilityName;
  "version": MosaicPaywallV02Version;
};

export type MosaicPaywallV02DocumentCompatibility = {
  "requiredCapabilities": Array<MosaicPaywallV02RequiredCapability>;
};

export type MosaicPaywallV02LogicalSize = number;

export type MosaicPaywallV02PositiveLogicalSize = number;

export type MosaicPaywallV02EdgeInsets = {
  "top": MosaicPaywallV02LogicalSize;
  "start": MosaicPaywallV02LogicalSize;
  "bottom": MosaicPaywallV02LogicalSize;
  "end": MosaicPaywallV02LogicalSize;
};

export type MosaicPaywallV02TextAlignment = "start" | "center" | "end";

export type MosaicPaywallV02SemanticColor = "text.primary" | "text.secondary" | "surface.default" | "surface.elevated" | "action.primary" | "action.onPrimary" | "border.default" | "transparent";

export type MosaicPaywallV02LiteralColor = string;

export type MosaicPaywallV02ColorTokenReference = {
  "type": "colorToken";
  "id": MosaicPaywallV02Identifier;
};

export type MosaicPaywallV02Color = MosaicPaywallV02SemanticColor | MosaicPaywallV02LiteralColor | MosaicPaywallV02ColorTokenReference;

export type MosaicPaywallV02AxisSizingValue = "fit" | "fill" | {
  "mode": "fixed";
  "value": MosaicPaywallV02PositiveLogicalSize;
};

export type MosaicPaywallV02BoxSizing = {
  "width": MosaicPaywallV02AxisSizingValue;
  "height": MosaicPaywallV02AxisSizingValue;
};

export type MosaicPaywallV02GradientStop = {
  "position": number;
  "color": MosaicPaywallV02Color;
};

export type MosaicPaywallV02GradientStops = Array<MosaicPaywallV02GradientStop>;

export type MosaicPaywallV02NormalizedPoint = {
  "x": number;
  "y": number;
};

export type MosaicPaywallV02ColorBackground = {
  "type": "color";
  "value": MosaicPaywallV02Color;
};

export type MosaicPaywallV02LinearGradientBackground = {
  "type": "linearGradient";
  "angle": number;
  "stops": MosaicPaywallV02GradientStops;
};

export type MosaicPaywallV02RadialGradientBackground = {
  "type": "radialGradient";
  "center": MosaicPaywallV02NormalizedPoint;
  "radius": number;
  "stops": MosaicPaywallV02GradientStops;
};

export type MosaicPaywallV02MediaContentMode = "fit" | "fill";

export type MosaicPaywallV02ImageBackground = {
  "type": "image";
  "assetId": MosaicPaywallV02Identifier;
  "contentMode": MosaicPaywallV02MediaContentMode;
  "fallbackColor": MosaicPaywallV02Color;
};

export type MosaicPaywallV02VideoBackground = {
  "type": "video";
  "assetId": MosaicPaywallV02Identifier;
  "contentMode": MosaicPaywallV02MediaContentMode;
  "posterAssetId"?: MosaicPaywallV02Identifier;
  "fallbackColor": MosaicPaywallV02Color;
};

export type MosaicPaywallV02BackgroundTokenReference = {
  "type": "backgroundToken";
  "id": MosaicPaywallV02Identifier;
};

export type MosaicPaywallV02Background = MosaicPaywallV02ColorBackground | MosaicPaywallV02LinearGradientBackground | MosaicPaywallV02RadialGradientBackground | MosaicPaywallV02ImageBackground | MosaicPaywallV02VideoBackground | MosaicPaywallV02BackgroundTokenReference;

export type MosaicPaywallV02InlineShadow = {
  "type": "shadow";
  "color": MosaicPaywallV02Color;
  "offsetX": number;
  "offsetY": number;
  "blurRadius": MosaicPaywallV02LogicalSize;
};

export type MosaicPaywallV02ShadowTokenReference = {
  "type": "shadowToken";
  "id": MosaicPaywallV02Identifier;
};

export type MosaicPaywallV02Shadow = MosaicPaywallV02InlineShadow | MosaicPaywallV02ShadowTokenReference;

export type MosaicPaywallV02DesignTokenName = string;

export type MosaicPaywallV02ColorToken = {
  "id": MosaicPaywallV02Identifier;
  "name": MosaicPaywallV02DesignTokenName;
  "value": MosaicPaywallV02Color;
};

export type MosaicPaywallV02BackgroundToken = {
  "id": MosaicPaywallV02Identifier;
  "name": MosaicPaywallV02DesignTokenName;
  "value": MosaicPaywallV02Background;
};

export type MosaicPaywallV02ShadowToken = {
  "id": MosaicPaywallV02Identifier;
  "name": MosaicPaywallV02DesignTokenName;
  "value": MosaicPaywallV02Shadow;
};

export type MosaicPaywallV02DesignSystem = {
  "colors": Array<MosaicPaywallV02ColorToken>;
  "backgrounds": Array<MosaicPaywallV02BackgroundToken>;
  "shadows": Array<MosaicPaywallV02ShadowToken>;
};

export type MosaicPaywallV02Border = {
  "color": MosaicPaywallV02Color;
  "width": MosaicPaywallV02LogicalSize;
};

export type MosaicPaywallV02BorderOverride = {
  "color"?: MosaicPaywallV02Color;
  "width"?: MosaicPaywallV02LogicalSize;
};

export type MosaicPaywallV02BoxAppearance = {
  "background"?: MosaicPaywallV02Background;
  "border"?: MosaicPaywallV02Border;
  "cornerRadius"?: MosaicPaywallV02LogicalSize;
  "opacity"?: number;
  "padding"?: MosaicPaywallV02EdgeInsets;
  "shadow"?: MosaicPaywallV02Shadow;
};

export type MosaicPaywallV02ContainerAppearance = {
  "background"?: MosaicPaywallV02Background;
  "border"?: MosaicPaywallV02Border;
  "cornerRadius"?: MosaicPaywallV02LogicalSize;
  "opacity"?: number;
  "clipContent"?: boolean;
  "shadow"?: MosaicPaywallV02Shadow;
};

export type MosaicPaywallV02TypographyStyle = "display" | "title" | "heading" | "body" | "label" | "caption";

export type MosaicPaywallV02FontWeight = "regular" | "medium" | "semibold" | "bold";

export type MosaicPaywallV02BaseTypography = {
  "style": MosaicPaywallV02TypographyStyle;
  "fontSize": number;
  "lineHeightMultiplier": number;
  "weight": MosaicPaywallV02FontWeight;
  "color": MosaicPaywallV02Color;
  "alignment": MosaicPaywallV02TextAlignment;
};

export type MosaicPaywallV02Typography = {
  "style": MosaicPaywallV02TypographyStyle;
  "fontSize": number;
  "lineHeightMultiplier": number;
  "weight": MosaicPaywallV02FontWeight;
  "color": MosaicPaywallV02Color;
  "alignment": MosaicPaywallV02TextAlignment;
  "maxLines"?: number;
  "overflow"?: "clip" | "ellipsis";
};

export type MosaicPaywallV02Visibility = {
  "mode": "always";
} | {
  "mode": "hidden";
} | {
  "mode": "switch";
  "switchId": MosaicPaywallV02Identifier;
  "equals": boolean;
};

export type MosaicPaywallV02ControlAccessibility = {
  "label": MosaicPaywallV02LocalizedText;
  "hint"?: MosaicPaywallV02LocalizedText;
};

export type MosaicPaywallV02TextAccessibility = {
  "role": "text";
  "label"?: MosaicPaywallV02LocalizedText;
} | {
  "role": "heading";
  "level": number;
  "label"?: MosaicPaywallV02LocalizedText;
};

export type MosaicPaywallV02ImageAccessibility = {
  "hidden": true;
} | {
  "hidden": false;
  "label": MosaicPaywallV02LocalizedText;
};

export type MosaicPaywallV02BundledAssetSource = {
  "type": "bundled";
  "key": string;
};

export type MosaicPaywallV02RemoteAssetSource = {
  "type": "remote";
  "url": MosaicPaywallV02ExternalUrl;
};

export type MosaicPaywallV02AssetSource = MosaicPaywallV02BundledAssetSource | MosaicPaywallV02RemoteAssetSource;

export type MosaicPaywallV02ImageAssetFallback = {
  "type": "placeholder";
  "value": MosaicPaywallV02LocalizedText;
};

export type MosaicPaywallV02ImageAsset = {
  "type": "image";
  "id": MosaicPaywallV02Identifier;
  "source": MosaicPaywallV02AssetSource;
  "fallback": MosaicPaywallV02ImageAssetFallback;
};

export type MosaicPaywallV02VideoAsset = {
  "type": "video";
  "id": MosaicPaywallV02Identifier;
  "source": MosaicPaywallV02AssetSource;
};

export type MosaicPaywallV02Asset = MosaicPaywallV02ImageAsset | MosaicPaywallV02VideoAsset;

export type MosaicPaywallV02ProductReference = {
  "id": MosaicPaywallV02Identifier;
  "productId": string;
  "label": MosaicPaywallV02LocalizedText;
};

export type MosaicPaywallV02ScreenPresentation = {
  "type": "screen";
} | {
  "type": "sheet";
};

export type MosaicPaywallV02Screen = {
  "id": MosaicPaywallV02Identifier;
  "accessibilityLabel"?: MosaicPaywallV02LocalizedText;
  "presentation": MosaicPaywallV02ScreenPresentation;
  "layout": MosaicPaywallV02ScrollContainer;
};

export type MosaicPaywallV02ScrollContainer = {
  "type": "scrollContainer";
  "id": MosaicPaywallV02Identifier;
  "axis": "vertical";
  "safeArea": "respect";
  "showsIndicators": boolean;
  "background"?: MosaicPaywallV02Background;
  "content": MosaicPaywallV02Stack;
};

export type MosaicPaywallV02Stack = {
  "type": "stack";
  "id": MosaicPaywallV02Identifier;
  "direction": "vertical" | "horizontal";
  "gap": MosaicPaywallV02LogicalSize;
  "padding": MosaicPaywallV02EdgeInsets;
  "mainAxisDistribution": "start" | "center" | "end" | "spaceBetween";
  "crossAxisAlignment": "start" | "center" | "end" | "stretch";
  "appearance"?: MosaicPaywallV02ContainerAppearance;
  "sizing"?: MosaicPaywallV02BoxSizing;
  "outerInsets"?: MosaicPaywallV02EdgeInsets;
  "visibility"?: MosaicPaywallV02Visibility;
  "children": Array<MosaicPaywallV02Node>;
};

export type MosaicPaywallV02Node = MosaicPaywallV02Stack | MosaicPaywallV02TextComponent | MosaicPaywallV02ImageComponent | MosaicPaywallV02IconComponent | MosaicPaywallV02FeatureListComponent | MosaicPaywallV02ProductSelectorComponent | MosaicPaywallV02ButtonComponent | MosaicPaywallV02CarouselComponent | MosaicPaywallV02SwitchComponent | MosaicPaywallV02CountdownComponent;

export type MosaicPaywallV02TextComponent = {
  "type": "text";
  "id": MosaicPaywallV02Identifier;
  "value": MosaicPaywallV02LocalizedText;
  "typography": MosaicPaywallV02Typography;
  "appearance"?: MosaicPaywallV02BoxAppearance;
  "sizing"?: MosaicPaywallV02BoxSizing;
  "outerInsets"?: MosaicPaywallV02EdgeInsets;
  "visibility"?: MosaicPaywallV02Visibility;
  "accessibility": MosaicPaywallV02TextAccessibility;
};

export type MosaicPaywallV02ImageComponent = {
  "type": "image";
  "id": MosaicPaywallV02Identifier;
  "assetId": MosaicPaywallV02Identifier;
  "aspectRatio"?: number;
  "contentMode": "fit" | "fill";
  "appearance"?: MosaicPaywallV02BoxAppearance;
  "sizing"?: MosaicPaywallV02BoxSizing;
  "outerInsets"?: MosaicPaywallV02EdgeInsets;
  "visibility"?: MosaicPaywallV02Visibility;
  "accessibility": MosaicPaywallV02ImageAccessibility;
};

export type MosaicPaywallV02IconName = "checkmark" | "close" | "lock" | "restore" | "externalLink" | "arrowBackward" | "arrowForward" | "chevronBackward" | "chevronForward";

export type MosaicPaywallV02IconComponent = {
  "type": "icon";
  "id": MosaicPaywallV02Identifier;
  "name": MosaicPaywallV02IconName;
  "size": MosaicPaywallV02PositiveLogicalSize;
  "color": MosaicPaywallV02Color;
  "appearance"?: MosaicPaywallV02BoxAppearance;
  "sizing"?: MosaicPaywallV02BoxSizing;
  "outerInsets"?: MosaicPaywallV02EdgeInsets;
  "visibility"?: MosaicPaywallV02Visibility;
  "accessibility": MosaicPaywallV02ImageAccessibility;
};

export type MosaicPaywallV02FeatureListItem = {
  "id": MosaicPaywallV02Identifier;
  "text": MosaicPaywallV02LocalizedText;
};

export type MosaicPaywallV02FeatureListComponent = {
  "type": "featureList";
  "id": MosaicPaywallV02Identifier;
  "marker": "checkmark";
  "gap": MosaicPaywallV02LogicalSize;
  "markerColor": MosaicPaywallV02Color;
  "items": Array<MosaicPaywallV02FeatureListItem>;
  "typography": MosaicPaywallV02BaseTypography;
  "appearance"?: MosaicPaywallV02BoxAppearance;
  "sizing"?: MosaicPaywallV02BoxSizing;
  "outerInsets"?: MosaicPaywallV02EdgeInsets;
  "visibility"?: MosaicPaywallV02Visibility;
  "accessibility": MosaicPaywallV02ControlAccessibility;
};

export type MosaicPaywallV02UnavailableProductFallback = {
  "selection": "firstAvailable";
  "whenNoneAvailable": "showMessageAndDisablePurchase";
  "message": MosaicPaywallV02LocalizedText;
};

export type MosaicPaywallV02ProductCardDefaultStyle = {
  "background": MosaicPaywallV02Background;
  "border": MosaicPaywallV02Border;
  "cornerRadius": MosaicPaywallV02LogicalSize;
  "padding": MosaicPaywallV02EdgeInsets;
  "opacity": number;
  "shadow"?: MosaicPaywallV02Shadow;
};

export type MosaicPaywallV02EdgeInsetsOverride = {
  "top"?: MosaicPaywallV02LogicalSize;
  "start"?: MosaicPaywallV02LogicalSize;
  "bottom"?: MosaicPaywallV02LogicalSize;
  "end"?: MosaicPaywallV02LogicalSize;
};

export type MosaicPaywallV02ProductCardSelectedStyle = {
  "background"?: MosaicPaywallV02Background;
  "border"?: MosaicPaywallV02BorderOverride;
  "cornerRadius"?: MosaicPaywallV02LogicalSize;
  "padding"?: MosaicPaywallV02EdgeInsetsOverride;
  "opacity"?: number;
  "shadow"?: MosaicPaywallV02Shadow;
};

export type MosaicPaywallV02ProductCardStyles = {
  "default": MosaicPaywallV02ProductCardDefaultStyle;
  "selected": MosaicPaywallV02ProductCardSelectedStyle;
};

export type MosaicPaywallV02ProductCardAccessibility = {
  "label": MosaicPaywallV02LocalizedText;
};

export type MosaicPaywallV02ProductBadgePlacement = {
  "mode": "nested";
} | {
  "mode": "overlay";
  "anchor": "topStart" | "topEnd" | "bottomStart" | "bottomEnd";
  "inset": number;
};

export type MosaicPaywallV02ProductCardPassiveStack = {
  "type": "stack";
  "id": MosaicPaywallV02Identifier;
  "direction": "vertical" | "horizontal";
  "gap": MosaicPaywallV02LogicalSize;
  "padding": MosaicPaywallV02EdgeInsets;
  "mainAxisDistribution": "start" | "center" | "end" | "spaceBetween";
  "crossAxisAlignment": "start" | "center" | "end" | "stretch";
  "appearance"?: MosaicPaywallV02ContainerAppearance;
  "sizing"?: MosaicPaywallV02BoxSizing;
  "outerInsets"?: MosaicPaywallV02EdgeInsets;
  "visibility"?: MosaicPaywallV02Visibility;
  "children": Array<MosaicPaywallV02ProductCardPassiveNode>;
};

export type MosaicPaywallV02ProductCardPassiveNode = MosaicPaywallV02ProductCardPassiveStack | MosaicPaywallV02TextComponent | MosaicPaywallV02ImageComponent | MosaicPaywallV02IconComponent | MosaicPaywallV02FeatureListComponent | MosaicPaywallV02CountdownComponent;

export type MosaicPaywallV02ProductBadgeComponent = {
  "type": "productBadge";
  "id": MosaicPaywallV02Identifier;
  "placement": MosaicPaywallV02ProductBadgePlacement;
  "direction": "vertical" | "horizontal";
  "gap": MosaicPaywallV02LogicalSize;
  "mainAxisDistribution": "start" | "center" | "end" | "spaceBetween";
  "crossAxisAlignment": "start" | "center" | "end" | "stretch";
  "children": Array<MosaicPaywallV02ProductCardPassiveNode>;
  "styles": MosaicPaywallV02ProductCardStyles;
  "sizing"?: MosaicPaywallV02BoxSizing;
};

export type MosaicPaywallV02ProductCardChild = MosaicPaywallV02ProductCardPassiveNode | MosaicPaywallV02ProductBadgeComponent;

export type MosaicPaywallV02ProductCardComponent = {
  "type": "productCard";
  "id": MosaicPaywallV02Identifier;
  "productReferenceId": MosaicPaywallV02Identifier;
  "direction": "vertical" | "horizontal";
  "gap": MosaicPaywallV02LogicalSize;
  "mainAxisDistribution": "start" | "center" | "end" | "spaceBetween";
  "crossAxisAlignment": "start" | "center" | "end" | "stretch";
  "children": Array<MosaicPaywallV02ProductCardChild>;
  "styles": MosaicPaywallV02ProductCardStyles;
  "sizing"?: MosaicPaywallV02BoxSizing;
  "clipContent"?: false;
  "accessibility"?: MosaicPaywallV02ProductCardAccessibility;
};

export type MosaicPaywallV02ProductSelectorComponent = {
  "type": "productSelector";
  "id": MosaicPaywallV02Identifier;
  "direction": "vertical" | "horizontal";
  "gap": MosaicPaywallV02LogicalSize;
  "crossAxisAlignment": "start" | "center" | "end" | "stretch";
  "initialProductCardId": MosaicPaywallV02Identifier;
  "cards": Array<MosaicPaywallV02ProductCardComponent>;
  "appearance"?: MosaicPaywallV02BoxAppearance;
  "sizing"?: MosaicPaywallV02BoxSizing;
  "outerInsets"?: MosaicPaywallV02EdgeInsets;
  "visibility"?: MosaicPaywallV02Visibility;
  "unavailableFallback": MosaicPaywallV02UnavailableProductFallback;
  "accessibility": MosaicPaywallV02ControlAccessibility;
};

export type MosaicPaywallV02PurchaseAction = {
  "type": "purchase";
  "productSelectorId": MosaicPaywallV02Identifier;
};

export type MosaicPaywallV02RestoreAction = {
  "type": "restore";
};

export type MosaicPaywallV02CloseAction = {
  "type": "close";
};

export type MosaicPaywallV02NavigateToAction = {
  "type": "navigateTo";
  "screenId": MosaicPaywallV02Identifier;
};

export type MosaicPaywallV02NavigateBackAction = {
  "type": "navigateBack";
};

export type MosaicPaywallV02ExternalUrl = string;

export type MosaicPaywallV02OpenExternalUrlAction = {
  "type": "openExternalUrl";
  "url": MosaicPaywallV02ExternalUrl;
};

export type MosaicPaywallV02ButtonAction = MosaicPaywallV02PurchaseAction | MosaicPaywallV02RestoreAction | MosaicPaywallV02CloseAction | MosaicPaywallV02NavigateToAction | MosaicPaywallV02NavigateBackAction | MosaicPaywallV02OpenExternalUrlAction;

export type MosaicPaywallV02ButtonComponent = {
  "type": "button";
  "id": MosaicPaywallV02Identifier;
  "direction": "vertical" | "horizontal";
  "gap": MosaicPaywallV02LogicalSize;
  "mainAxisDistribution": "start" | "center" | "end" | "spaceBetween";
  "crossAxisAlignment": "start" | "center" | "end" | "stretch";
  "children": Array<MosaicPaywallV02Node>;
  "inProgressChildren"?: Array<MosaicPaywallV02Node>;
  "appearance"?: MosaicPaywallV02BoxAppearance;
  "sizing"?: MosaicPaywallV02BoxSizing;
  "outerInsets"?: MosaicPaywallV02EdgeInsets;
  "visibility"?: MosaicPaywallV02Visibility;
  "action": MosaicPaywallV02ButtonAction;
  "accessibility": MosaicPaywallV02ControlAccessibility;
};

export type MosaicPaywallV02CarouselPage = {
  "id": MosaicPaywallV02Identifier;
  "accessibilityLabel": MosaicPaywallV02LocalizedText;
  "content": MosaicPaywallV02Stack;
};

export type MosaicPaywallV02CarouselComponent = {
  "type": "carousel";
  "id": MosaicPaywallV02Identifier;
  "initialPageIndex": number;
  "showsIndicators": boolean;
  "pages": Array<MosaicPaywallV02CarouselPage>;
  "appearance"?: MosaicPaywallV02ContainerAppearance;
  "sizing"?: MosaicPaywallV02BoxSizing;
  "outerInsets"?: MosaicPaywallV02EdgeInsets;
  "visibility"?: MosaicPaywallV02Visibility;
  "accessibility": MosaicPaywallV02ControlAccessibility;
};

export type MosaicPaywallV02SwitchComponent = {
  "type": "switch";
  "id": MosaicPaywallV02Identifier;
  "label": MosaicPaywallV02LocalizedText;
  "initialValue": boolean;
  "typography": MosaicPaywallV02BaseTypography;
  "offTrackColor": MosaicPaywallV02Color;
  "onTrackColor": MosaicPaywallV02Color;
  "thumbColor": MosaicPaywallV02Color;
  "appearance"?: MosaicPaywallV02BoxAppearance;
  "sizing"?: MosaicPaywallV02BoxSizing;
  "outerInsets"?: MosaicPaywallV02EdgeInsets;
  "visibility"?: MosaicPaywallV02Visibility;
  "accessibility": MosaicPaywallV02ControlAccessibility;
};

export type MosaicPaywallV02CountdownComponent = {
  "type": "countdown";
  "id": MosaicPaywallV02Identifier;
  "endsAt": string;
  "largestUnit": "day" | "hour" | "minute" | "second";
  "smallestUnit": "day" | "hour" | "minute" | "second";
  "completedText": MosaicPaywallV02LocalizedText;
  "typography": MosaicPaywallV02BaseTypography;
  "appearance"?: MosaicPaywallV02BoxAppearance;
  "sizing"?: MosaicPaywallV02BoxSizing;
  "outerInsets"?: MosaicPaywallV02EdgeInsets;
  "visibility"?: MosaicPaywallV02Visibility;
  "accessibility": MosaicPaywallV02TextAccessibility;
};

export type MosaicPaywallV02Document = {
  "schemaVersion": MosaicPaywallV02Version;
  "id": MosaicPaywallV02Identifier;
  "revision": number;
  "compatibility": MosaicPaywallV02DocumentCompatibility;
  "localization": MosaicPaywallV02Localization;
  "designSystem": MosaicPaywallV02DesignSystem;
  "assets": Array<MosaicPaywallV02Asset>;
  "products": Array<MosaicPaywallV02ProductReference>;
  "initialScreenId": MosaicPaywallV02Identifier;
  "screens": Array<MosaicPaywallV02Screen>;
};

export type MosaicPreviewV02MessageId = string;

export type MosaicPreviewV02SessionId = string;

export type MosaicPreviewV02ClientId = string;

export type MosaicPreviewV02EditableDocumentId = string;

export type MosaicPreviewV02RevisionId = string;

export type MosaicPreviewV02UtcTimestamp = string;

export type MosaicPreviewV02MachineIdentifier = string;

export type MosaicPreviewV02SemanticVersion = string;

export type MosaicPreviewV02SafeText = string;

export type MosaicPreviewV02SafeDisplayName = string;

export type MosaicPreviewV02DiagnosticCode = string;

export type MosaicPreviewV02JsonPointer = string;

export type MosaicPreviewV02ComponentId = string;

export type MosaicPreviewV02LocaleTag = string;

export type MosaicPreviewV02LocalRevision = {
  "revisionId": MosaicPreviewV02RevisionId;
  "sequence": number;
};

export type MosaicPreviewV02SoftwareIdentity = {
  "id": MosaicPreviewV02MachineIdentifier;
  "version": MosaicPreviewV02SemanticVersion;
};

export type MosaicPreviewV02ApplicationIdentity = {
  "id": MosaicPreviewV02MachineIdentifier;
  "displayName": MosaicPreviewV02SafeDisplayName;
  "version": string;
};

export type MosaicPreviewV02DeviceIdentity = {
  "displayName": MosaicPreviewV02SafeDisplayName;
  "systemName": MosaicPreviewV02SafeDisplayName;
  "systemVersion": string;
};

export type MosaicPreviewV02ClientIdentity = {
  "clientId": MosaicPreviewV02ClientId;
  "displayName": MosaicPreviewV02SafeDisplayName;
  "renderer": MosaicPreviewV02SoftwareIdentity;
  "application": MosaicPreviewV02ApplicationIdentity;
  "device": MosaicPreviewV02DeviceIdentity;
};

export type MosaicPreviewV02SupportedCapability = {
  "name": MosaicPreviewV02MachineIdentifier;
  "version": MosaicPreviewV02SemanticVersion;
};

export type MosaicPreviewV02CapabilityName = "preview.liveUpdate" | "preview.mockCommerce" | "preview.localeOverride" | "preview.textScale" | "preview.diagnostics";

export type MosaicPreviewV02Capability = {
  "name": MosaicPreviewV02CapabilityName;
  "version": "0.2";
};

export type MosaicPreviewV02Limits = {
  "maxDocumentBytes": number;
};

export type MosaicPreviewV02Context = {
  "locale": MosaicPreviewV02LocaleTag;
  "textScale": number;
};

export type MosaicPreviewV02DiagnosticLocation = {
  "documentPath": MosaicPreviewV02JsonPointer;
  "componentId"?: MosaicPreviewV02ComponentId;
  "property"?: string;
};

export type MosaicPreviewV02RecoveryAction = {
  "action": "editProperty" | "removeComponent" | "bindProduct" | "selectSupportedTemplate" | "updatePreviewClient" | "restoreLastValidDraft" | "retry" | "reconnect" | "inspectComponent";
  "message": MosaicPreviewV02SafeText;
};

export type MosaicPreviewV02ValidationDiagnostic = {
  "code": MosaicPreviewV02DiagnosticCode;
  "message": MosaicPreviewV02SafeText;
  "location": MosaicPreviewV02DiagnosticLocation;
  "recovery": MosaicPreviewV02RecoveryAction;
};

export type MosaicPreviewV02CompatibilityWarning = {
  "code": MosaicPreviewV02DiagnosticCode;
  "severity": "warning" | "blocking";
  "message": MosaicPreviewV02SafeText;
  "location"?: MosaicPreviewV02DiagnosticLocation;
  "capability"?: MosaicPreviewV02SupportedCapability;
  "fallback": "keepLastAcceptedDraft" | "useDeclaredAssetFallback" | "useSelectorFallback" | "nativeApproximation";
  "recovery": MosaicPreviewV02RecoveryAction;
};

export type MosaicPreviewV02RenderDiagnostic = {
  "code": MosaicPreviewV02DiagnosticCode;
  "message": MosaicPreviewV02SafeText;
  "location"?: MosaicPreviewV02DiagnosticLocation;
  "fallback": "keepLastAcceptedDraft";
  "recovery": MosaicPreviewV02RecoveryAction;
};

export type MosaicPreviewV02Period = {
  "unit": "day" | "week" | "month" | "year";
  "value": number;
};

export type MosaicPreviewV02IntroductoryOffer = {
  "localizedPrice": MosaicPreviewV02SafeDisplayName;
  "period": MosaicPreviewV02Period;
  "cycles": number;
};

export type MosaicPreviewV02AvailableSubscriptionProduct = {
  "productReferenceId": MosaicPreviewV02ComponentId;
  "availability": "available";
  "kind": "subscription";
  "localizedPrice": MosaicPreviewV02SafeDisplayName;
  "currencyCode": string;
  "billingPeriod": MosaicPreviewV02Period;
  "trialPeriod"?: MosaicPreviewV02Period;
  "introductoryOffer"?: MosaicPreviewV02IntroductoryOffer;
};

export type MosaicPreviewV02AvailableNonConsumableProduct = {
  "productReferenceId": MosaicPreviewV02ComponentId;
  "availability": "available";
  "kind": "nonConsumable";
  "localizedPrice": MosaicPreviewV02SafeDisplayName;
  "currencyCode": string;
};

export type MosaicPreviewV02UnavailableMockProduct = {
  "productReferenceId": MosaicPreviewV02ComponentId;
  "availability": "unavailable";
  "reason": "notConfigured" | "temporarilyUnavailable" | "unsupported";
};

export type MosaicPreviewV02MockProduct = MosaicPreviewV02AvailableSubscriptionProduct | MosaicPreviewV02AvailableNonConsumableProduct | MosaicPreviewV02UnavailableMockProduct;

export type MosaicPreviewV02NoEntitlement = {
  "status": "none";
};

export type MosaicPreviewV02ActiveEntitlement = {
  "status": "active";
  "productReferenceId": MosaicPreviewV02ComponentId;
};

export type MosaicPreviewV02MockEntitlement = MosaicPreviewV02NoEntitlement | MosaicPreviewV02ActiveEntitlement;

export type MosaicPreviewV02MockCommerceState = {
  "products": Array<MosaicPreviewV02MockProduct>;
  "purchaseOutcome": "purchased" | "alreadyEntitled" | "cancelled" | "purchaseFailed";
  "restoreOutcome": "restored" | "alreadyEntitled" | "restoreNoPurchases" | "restoreFailed";
  "entitlement": MosaicPreviewV02MockEntitlement;
};

export type MosaicPreviewV02RevisionTarget = {
  "clientId": MosaicPreviewV02ClientId;
  "editableDocumentId": MosaicPreviewV02EditableDocumentId;
  "revision": MosaicPreviewV02LocalRevision;
};

export type MosaicPreviewV02ClientConnectedPayload = {
  "client": MosaicPreviewV02ClientIdentity;
};

export type MosaicPreviewV02ClientDisconnectedPayload = {
  "clientId": MosaicPreviewV02ClientId;
  "reason": "closed" | "timeout" | "transportError" | "replaced" | "sessionEnded";
  "diagnostic"?: MosaicPreviewV02SafeText;
};

export type MosaicPreviewV02CapabilityReportPayload = {
  "clientId": MosaicPreviewV02ClientId;
  "supportedSchemaVersions": Array<MosaicPreviewV02SemanticVersion>;
  "supportedCapabilities": Array<MosaicPreviewV02SupportedCapability>;
  "previewCapabilities": Array<MosaicPreviewV02Capability>;
  "limits": MosaicPreviewV02Limits;
};

export type MosaicPreviewV02DraftUpdatedPayload = {
  "editableDocumentId": MosaicPreviewV02EditableDocumentId;
  "revision": MosaicPreviewV02LocalRevision;
  "document": MosaicPaywallV02Document;
  "preview": MosaicPreviewV02Context;
};

export type MosaicPreviewV02DraftAcceptedPayload = {
  "clientId": MosaicPreviewV02ClientId;
  "editableDocumentId": MosaicPreviewV02EditableDocumentId;
  "revision": MosaicPreviewV02LocalRevision;
};

export type MosaicPreviewV02DraftRejectedPayload = {
  "clientId": MosaicPreviewV02ClientId;
  "editableDocumentId": MosaicPreviewV02EditableDocumentId;
  "revision": MosaicPreviewV02LocalRevision;
  "reason": "staleRevision" | "revisionConflict" | "validationFailed" | "unsupportedSchemaVersion" | "unsupportedCapability" | "documentTooLarge" | "renderFailed";
  "diagnostics": Array<MosaicPreviewV02ValidationDiagnostic>;
};

export type MosaicPreviewV02ValidationErrorPayload = {
  "clientId": MosaicPreviewV02ClientId;
  "editableDocumentId": MosaicPreviewV02EditableDocumentId;
  "revision": MosaicPreviewV02LocalRevision;
  "errors": Array<MosaicPreviewV02ValidationDiagnostic>;
};

export type MosaicPreviewV02RenderWarningPayload = {
  "clientId": MosaicPreviewV02ClientId;
  "editableDocumentId": MosaicPreviewV02EditableDocumentId;
  "revision": MosaicPreviewV02LocalRevision;
  "warnings": Array<MosaicPreviewV02CompatibilityWarning>;
};

export type MosaicPreviewV02RenderFailurePayload = {
  "clientId": MosaicPreviewV02ClientId;
  "editableDocumentId": MosaicPreviewV02EditableDocumentId;
  "revision": MosaicPreviewV02LocalRevision;
  "failure": MosaicPreviewV02RenderDiagnostic;
};

export type MosaicPreviewV02MockCommerceStateChangedPayload = {
  "editableDocumentId": MosaicPreviewV02EditableDocumentId;
  "stateRevision": MosaicPreviewV02LocalRevision;
  "state": MosaicPreviewV02MockCommerceState;
};

export type MosaicPreviewV02HeartbeatPayload = {
  "clientId": MosaicPreviewV02ClientId;
  "kind": "ping" | "pong";
  "sequence": number;
};

export type MosaicPreviewV02MessageType = "previewClientConnected" | "previewClientDisconnected" | "capabilityReport" | "draftUpdated" | "draftAccepted" | "draftRejected" | "validationError" | "renderWarning" | "renderFailure" | "mockCommerceStateChanged" | "previewHeartbeat";

export type MosaicPreviewV02Envelope<
  TType extends MosaicPreviewV02MessageType,
  TPayload,
> = {
  "previewProtocolVersion": "0.2";
  "messageId": MosaicPreviewV02MessageId;
  "sessionId": MosaicPreviewV02SessionId;
  "sentAt": MosaicPreviewV02UtcTimestamp;
} & {
  "type": TType;
  "payload": TPayload;
};

export type MosaicPreviewV02Message =
  | MosaicPreviewV02Envelope<"previewClientConnected", MosaicPreviewV02ClientConnectedPayload>
  | MosaicPreviewV02Envelope<"previewClientDisconnected", MosaicPreviewV02ClientDisconnectedPayload>
  | MosaicPreviewV02Envelope<"capabilityReport", MosaicPreviewV02CapabilityReportPayload>
  | MosaicPreviewV02Envelope<"draftUpdated", MosaicPreviewV02DraftUpdatedPayload>
  | MosaicPreviewV02Envelope<"draftAccepted", MosaicPreviewV02DraftAcceptedPayload>
  | MosaicPreviewV02Envelope<"draftRejected", MosaicPreviewV02DraftRejectedPayload>
  | MosaicPreviewV02Envelope<"validationError", MosaicPreviewV02ValidationErrorPayload>
  | MosaicPreviewV02Envelope<"renderWarning", MosaicPreviewV02RenderWarningPayload>
  | MosaicPreviewV02Envelope<"renderFailure", MosaicPreviewV02RenderFailurePayload>
  | MosaicPreviewV02Envelope<"mockCommerceStateChanged", MosaicPreviewV02MockCommerceStateChangedPayload>
  | MosaicPreviewV02Envelope<"previewHeartbeat", MosaicPreviewV02HeartbeatPayload>;

export type MosaicLocalProjectV02 = {
  "fileFormatVersion": "0.2";
  "editableDocumentId": MosaicPreviewV02EditableDocumentId;
  "revision": MosaicPreviewV02LocalRevision;
  "document": MosaicPaywallV02Document;
  "preview": MosaicPreviewV02Context;
  "mockCommerce": {
    "revision": MosaicPreviewV02LocalRevision;
    "state": MosaicPreviewV02MockCommerceState;
  };
};

export type MosaicPaywallDocument = MosaicPaywallV02Document;
export type MosaicPreviewMessage = MosaicPreviewV02Message;
export type MosaicLocalProject = MosaicLocalProjectV02;
export type MosaicPreviewCapabilityReportPayload = MosaicPreviewV02CapabilityReportPayload;
export type MosaicPreviewCapabilityName = MosaicPreviewV02CapabilityName;
export type MosaicPreviewValidationDiagnostic = MosaicPreviewV02ValidationDiagnostic;
