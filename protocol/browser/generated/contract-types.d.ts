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
  "version": "0.2";
  "requiredCapabilities": Array<MosaicPaywallV02RequiredCapability>;
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
  "protocolVersion": "0.2";
  "documentDigest": MosaicConfigurationDeliveryV1Sha256Digest;
  "document": MosaicPaywallV02Document;
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
  "version": "0.2";
  "requiredCapabilities": Array<MosaicPaywallV02RequiredCapability>;
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

export type MosaicPaywallDocument = MosaicPaywallV02Document;
export type MosaicPreviewMessage = MosaicPreviewV02Message;
export type MosaicLocalProject = MosaicLocalProjectV02;
export type MosaicPreviewCapabilityReportPayload = MosaicPreviewV02CapabilityReportPayload;
export type MosaicPreviewCapabilityName = MosaicPreviewV02CapabilityName;
export type MosaicPreviewValidationDiagnostic = MosaicPreviewV02ValidationDiagnostic;
