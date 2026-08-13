// Generated from canonical Mosaic JSON Schemas. Do not edit.

export type MosaicPaywallV04Version = "0.4";

export type MosaicPaywallV04Identifier = string;

export type MosaicPaywallV04LocalizationKey = string;

export type MosaicPaywallV04LocaleTag = string;

export type MosaicPaywallV04LocalizedText = {
  "default": string;
  "localizationKey": MosaicPaywallV04LocalizationKey;
};

export type MosaicPaywallV04ReservedAccessibilityKey = "mosaic.a11y.rating" | "mosaic.a11y.in_progress";

export type MosaicPaywallV04LocaleCatalog = {
  "direction": "ltr" | "rtl";
  "strings": Record<string, string>;
};

export type MosaicPaywallV04Localization = {
  "defaultLocale": MosaicPaywallV04LocaleTag;
  "fallbackLocale": MosaicPaywallV04LocaleTag;
  "locales": Record<string, MosaicPaywallV04LocaleCatalog>;
};

export type MosaicPaywallV04CapabilityName = "layout.scrollContainer" | "layout.stack" | "layout.sizing" | "layout.heightSizing" | "layout.outerInsets" | "navigation.screens" | "navigation.sheets" | "component.text" | "component.image" | "component.icon" | "component.featureList" | "component.productSelector" | "component.productCard" | "component.productBadge" | "component.button" | "component.carousel" | "component.switch" | "component.countdown" | "component.tabs" | "component.timeline" | "component.award" | "component.socialProof" | "localization.catalogs" | "localization.rtl" | "localization.productTemplate" | "product.references" | "asset.bundledImage" | "asset.remoteImage" | "asset.bundledVideo" | "asset.remoteVideo" | "action.purchase" | "action.restore" | "action.close" | "action.navigateTo" | "action.navigateBack" | "action.openExternalUrl" | "accessibility.metadata" | "accessibility.reservedStrings" | "fallback.asset" | "fallback.product" | "outcome.normalized" | "style.colors" | "style.designTokens" | "style.gradientBackground" | "style.mediaBackground" | "style.shadow" | "style.box" | "style.clipping" | "style.typography" | "visibility.static" | "condition.switchVisibility" | "condition.tabVisibility" | "motion.appear" | "motion.selection" | "motion.loop";

export type MosaicPaywallV04RequiredCapability = {
  "name": MosaicPaywallV04CapabilityName;
  "version": MosaicPaywallV04Version;
};

export type MosaicPaywallV04DocumentCompatibility = {
  "requiredCapabilities": Array<MosaicPaywallV04RequiredCapability>;
};

export type MosaicPaywallV04LogicalSize = number;

export type MosaicPaywallV04PositiveLogicalSize = number;

export type MosaicPaywallV04EdgeInsets = {
  "top": MosaicPaywallV04LogicalSize;
  "start": MosaicPaywallV04LogicalSize;
  "bottom": MosaicPaywallV04LogicalSize;
  "end": MosaicPaywallV04LogicalSize;
};

export type MosaicPaywallV04TextAlignment = "start" | "center" | "end";

export type MosaicPaywallV04SemanticColor = "text.primary" | "text.secondary" | "surface.default" | "surface.elevated" | "action.primary" | "action.onPrimary" | "border.default" | "transparent";

export type MosaicPaywallV04LiteralColor = string;

export type MosaicPaywallV04ColorTokenReference = {
  "type": "colorToken";
  "id": MosaicPaywallV04Identifier;
};

export type MosaicPaywallV04Color = MosaicPaywallV04SemanticColor | MosaicPaywallV04LiteralColor | MosaicPaywallV04ColorTokenReference;

export type MosaicPaywallV04AxisSizingValue = "fit" | "fill" | {
  "mode": "fixed";
  "value": MosaicPaywallV04PositiveLogicalSize;
};

export type MosaicPaywallV04BoxSizing = {
  "width": MosaicPaywallV04AxisSizingValue;
  "height": MosaicPaywallV04AxisSizingValue;
};

export type MosaicPaywallV04GradientStop = {
  "position": number;
  "color": MosaicPaywallV04Color;
};

export type MosaicPaywallV04GradientStops = Array<MosaicPaywallV04GradientStop>;

export type MosaicPaywallV04NormalizedPoint = {
  "x": number;
  "y": number;
};

export type MosaicPaywallV04ColorBackground = {
  "type": "color";
  "value": MosaicPaywallV04Color;
};

export type MosaicPaywallV04LinearGradientBackground = {
  "type": "linearGradient";
  "angle": number;
  "stops": MosaicPaywallV04GradientStops;
};

export type MosaicPaywallV04RadialGradientBackground = {
  "type": "radialGradient";
  "center": MosaicPaywallV04NormalizedPoint;
  "radius": number;
  "stops": MosaicPaywallV04GradientStops;
};

export type MosaicPaywallV04MediaContentMode = "fit" | "fill";

export type MosaicPaywallV04ImageBackground = {
  "type": "image";
  "assetId": MosaicPaywallV04Identifier;
  "contentMode": MosaicPaywallV04MediaContentMode;
  "fallbackColor": MosaicPaywallV04Color;
};

export type MosaicPaywallV04VideoBackground = {
  "type": "video";
  "assetId": MosaicPaywallV04Identifier;
  "contentMode": MosaicPaywallV04MediaContentMode;
  "posterAssetId"?: MosaicPaywallV04Identifier;
  "fallbackColor": MosaicPaywallV04Color;
};

export type MosaicPaywallV04BackgroundTokenReference = {
  "type": "backgroundToken";
  "id": MosaicPaywallV04Identifier;
};

export type MosaicPaywallV04Background = MosaicPaywallV04ColorBackground | MosaicPaywallV04LinearGradientBackground | MosaicPaywallV04RadialGradientBackground | MosaicPaywallV04ImageBackground | MosaicPaywallV04VideoBackground | MosaicPaywallV04BackgroundTokenReference;

export type MosaicPaywallV04InlineShadow = {
  "type": "shadow";
  "color": MosaicPaywallV04Color;
  "offsetX": number;
  "offsetY": number;
  "blurRadius": MosaicPaywallV04LogicalSize;
};

export type MosaicPaywallV04ShadowTokenReference = {
  "type": "shadowToken";
  "id": MosaicPaywallV04Identifier;
};

export type MosaicPaywallV04Shadow = MosaicPaywallV04InlineShadow | MosaicPaywallV04ShadowTokenReference;

export type MosaicPaywallV04DesignTokenName = string;

export type MosaicPaywallV04ColorToken = {
  "id": MosaicPaywallV04Identifier;
  "name": MosaicPaywallV04DesignTokenName;
  "value": MosaicPaywallV04Color;
};

export type MosaicPaywallV04BackgroundToken = {
  "id": MosaicPaywallV04Identifier;
  "name": MosaicPaywallV04DesignTokenName;
  "value": MosaicPaywallV04Background;
};

export type MosaicPaywallV04ShadowToken = {
  "id": MosaicPaywallV04Identifier;
  "name": MosaicPaywallV04DesignTokenName;
  "value": MosaicPaywallV04Shadow;
};

export type MosaicPaywallV04MotionDurationMilliseconds = number;

export type MosaicPaywallV04MotionEasing = "linear" | "standard" | "decelerate" | "accelerate";

export type MosaicPaywallV04InlineMotion = {
  "type": "motion";
  "durationMilliseconds": MosaicPaywallV04MotionDurationMilliseconds;
  "easing": MosaicPaywallV04MotionEasing;
};

export type MosaicPaywallV04MotionTokenReference = {
  "type": "motionToken";
  "id": MosaicPaywallV04Identifier;
};

export type MosaicPaywallV04Motion = MosaicPaywallV04InlineMotion | MosaicPaywallV04MotionTokenReference;

export type MosaicPaywallV04MotionToken = {
  "id": MosaicPaywallV04Identifier;
  "name": MosaicPaywallV04DesignTokenName;
  "value": MosaicPaywallV04Motion;
};

export type MosaicPaywallV04MotionRiseLogicalSize = number;

export type MosaicPaywallV04AppearMotion = {
  "effect": "fade";
  "curve": MosaicPaywallV04Motion;
  "delayMilliseconds": MosaicPaywallV04MotionDurationMilliseconds;
} | {
  "effect": "fadeRise";
  "riseLogicalSize": MosaicPaywallV04MotionRiseLogicalSize;
  "curve": MosaicPaywallV04Motion;
  "delayMilliseconds": MosaicPaywallV04MotionDurationMilliseconds;
};

export type MosaicPaywallV04SelectionMotion = {
  "curve": MosaicPaywallV04Motion;
};

export type MosaicPaywallV04LoopMotion = {
  "effect": "pulse";
  "scaleAmplitude": number;
  "opacityAmplitude": number;
  "curve": MosaicPaywallV04Motion;
  "repeat": {
    "count": number;
  };
};

export type MosaicPaywallV04NodeMotion = {
  "appear"?: MosaicPaywallV04AppearMotion;
};

export type MosaicPaywallV04SelectableMotion = {
  "appear"?: MosaicPaywallV04AppearMotion;
  "selection"?: MosaicPaywallV04SelectionMotion;
};

export type MosaicPaywallV04ButtonMotion = {
  "appear"?: MosaicPaywallV04AppearMotion;
  "loop"?: MosaicPaywallV04LoopMotion;
};

export type MosaicPaywallV04DesignSystem = {
  "colors": Array<MosaicPaywallV04ColorToken>;
  "backgrounds": Array<MosaicPaywallV04BackgroundToken>;
  "shadows": Array<MosaicPaywallV04ShadowToken>;
  "motions": Array<MosaicPaywallV04MotionToken>;
};

export type MosaicPaywallV04Border = {
  "color": MosaicPaywallV04Color;
  "width": MosaicPaywallV04LogicalSize;
};

export type MosaicPaywallV04BorderOverride = {
  "color"?: MosaicPaywallV04Color;
  "width"?: MosaicPaywallV04LogicalSize;
};

export type MosaicPaywallV04BoxAppearance = {
  "background"?: MosaicPaywallV04Background;
  "border"?: MosaicPaywallV04Border;
  "cornerRadius"?: MosaicPaywallV04LogicalSize;
  "opacity"?: number;
  "padding"?: MosaicPaywallV04EdgeInsets;
  "shadow"?: MosaicPaywallV04Shadow;
};

export type MosaicPaywallV04ContainerAppearance = {
  "background"?: MosaicPaywallV04Background;
  "border"?: MosaicPaywallV04Border;
  "cornerRadius"?: MosaicPaywallV04LogicalSize;
  "opacity"?: number;
  "clipContent"?: boolean;
  "shadow"?: MosaicPaywallV04Shadow;
};

export type MosaicPaywallV04TypographyStyle = "display" | "title" | "heading" | "body" | "label" | "caption";

export type MosaicPaywallV04FontWeight = "regular" | "medium" | "semibold" | "bold";

export type MosaicPaywallV04BaseTypography = {
  "style": MosaicPaywallV04TypographyStyle;
  "fontSize": number;
  "lineHeightMultiplier": number;
  "weight": MosaicPaywallV04FontWeight;
  "color": MosaicPaywallV04Color;
  "alignment": MosaicPaywallV04TextAlignment;
};

export type MosaicPaywallV04Typography = {
  "style": MosaicPaywallV04TypographyStyle;
  "fontSize": number;
  "lineHeightMultiplier": number;
  "weight": MosaicPaywallV04FontWeight;
  "color": MosaicPaywallV04Color;
  "alignment": MosaicPaywallV04TextAlignment;
  "maxLines"?: number;
  "overflow"?: "clip" | "ellipsis";
};

export type MosaicPaywallV04Visibility = {
  "mode": "always";
} | {
  "mode": "hidden";
} | {
  "mode": "switch";
  "switchId": MosaicPaywallV04Identifier;
  "equals": boolean;
} | {
  "mode": "tab";
  "tabsId": MosaicPaywallV04Identifier;
  "equals": MosaicPaywallV04Identifier;
};

export type MosaicPaywallV04ControlAccessibility = {
  "label": MosaicPaywallV04LocalizedText;
  "hint"?: MosaicPaywallV04LocalizedText;
};

export type MosaicPaywallV04TextAccessibility = {
  "role": "text";
  "label"?: MosaicPaywallV04LocalizedText;
} | {
  "role": "heading";
  "level": number;
  "label"?: MosaicPaywallV04LocalizedText;
};

export type MosaicPaywallV04ImageAccessibility = {
  "hidden": true;
} | {
  "hidden": false;
  "label": MosaicPaywallV04LocalizedText;
};

export type MosaicPaywallV04BundledAssetSource = {
  "type": "bundled";
  "key": string;
};

export type MosaicPaywallV04RemoteAssetSource = {
  "type": "remote";
  "url": MosaicPaywallV04ExternalUrl;
};

export type MosaicPaywallV04AssetSource = MosaicPaywallV04BundledAssetSource | MosaicPaywallV04RemoteAssetSource;

export type MosaicPaywallV04ImageAssetFallback = {
  "type": "placeholder";
  "value": MosaicPaywallV04LocalizedText;
};

export type MosaicPaywallV04ImageAsset = {
  "type": "image";
  "id": MosaicPaywallV04Identifier;
  "source": MosaicPaywallV04AssetSource;
  "fallback": MosaicPaywallV04ImageAssetFallback;
};

export type MosaicPaywallV04VideoAsset = {
  "type": "video";
  "id": MosaicPaywallV04Identifier;
  "source": MosaicPaywallV04AssetSource;
};

export type MosaicPaywallV04Asset = MosaicPaywallV04ImageAsset | MosaicPaywallV04VideoAsset;

export type MosaicPaywallV04ProductReference = {
  "id": MosaicPaywallV04Identifier;
  "productId": string;
  "label": MosaicPaywallV04LocalizedText;
};

export type MosaicPaywallV04ScreenPresentation = {
  "type": "screen";
} | {
  "type": "sheet";
};

export type MosaicPaywallV04Screen = {
  "id": MosaicPaywallV04Identifier;
  "accessibilityLabel"?: MosaicPaywallV04LocalizedText;
  "presentation": MosaicPaywallV04ScreenPresentation;
  "layout": MosaicPaywallV04ScrollContainer;
};

export type MosaicPaywallV04ScrollContainer = {
  "type": "scrollContainer";
  "id": MosaicPaywallV04Identifier;
  "axis": "vertical";
  "safeArea": "respect";
  "showsIndicators": boolean;
  "background"?: MosaicPaywallV04Background;
  "content": MosaicPaywallV04Stack;
};

export type MosaicPaywallV04Stack = {
  "type": "stack";
  "id": MosaicPaywallV04Identifier;
  "direction": "vertical" | "horizontal";
  "gap": MosaicPaywallV04LogicalSize;
  "padding": MosaicPaywallV04EdgeInsets;
  "mainAxisDistribution": "start" | "center" | "end" | "spaceBetween";
  "crossAxisAlignment": "start" | "center" | "end" | "stretch";
  "appearance"?: MosaicPaywallV04ContainerAppearance;
  "sizing"?: MosaicPaywallV04BoxSizing;
  "outerInsets"?: MosaicPaywallV04EdgeInsets;
  "motion"?: MosaicPaywallV04NodeMotion;
  "visibility"?: MosaicPaywallV04Visibility;
  "children": Array<MosaicPaywallV04Node>;
};

export type MosaicPaywallV04Node = MosaicPaywallV04Stack | MosaicPaywallV04TextComponent | MosaicPaywallV04ImageComponent | MosaicPaywallV04IconComponent | MosaicPaywallV04FeatureListComponent | MosaicPaywallV04ProductSelectorComponent | MosaicPaywallV04ButtonComponent | MosaicPaywallV04CarouselComponent | MosaicPaywallV04SwitchComponent | MosaicPaywallV04CountdownComponent | MosaicPaywallV04TabsComponent | MosaicPaywallV04TimelineComponent | MosaicPaywallV04AwardComponent | MosaicPaywallV04SocialProofComponent;

export type MosaicPaywallV04TextComponent = {
  "type": "text";
  "id": MosaicPaywallV04Identifier;
  "value": MosaicPaywallV04LocalizedText;
  "typography": MosaicPaywallV04Typography;
  "appearance"?: MosaicPaywallV04BoxAppearance;
  "sizing"?: MosaicPaywallV04BoxSizing;
  "outerInsets"?: MosaicPaywallV04EdgeInsets;
  "motion"?: MosaicPaywallV04NodeMotion;
  "visibility"?: MosaicPaywallV04Visibility;
  "accessibility": MosaicPaywallV04TextAccessibility;
};

export type MosaicPaywallV04ImageComponent = {
  "type": "image";
  "id": MosaicPaywallV04Identifier;
  "assetId": MosaicPaywallV04Identifier;
  "aspectRatio"?: number;
  "contentMode": "fit" | "fill";
  "appearance"?: MosaicPaywallV04BoxAppearance;
  "sizing"?: MosaicPaywallV04BoxSizing;
  "outerInsets"?: MosaicPaywallV04EdgeInsets;
  "motion"?: MosaicPaywallV04NodeMotion;
  "visibility"?: MosaicPaywallV04Visibility;
  "accessibility": MosaicPaywallV04ImageAccessibility;
};

export type MosaicPaywallV04IconName = "checkmark" | "close" | "lock" | "restore" | "externalLink" | "arrowBackward" | "arrowForward" | "chevronBackward" | "chevronForward";

export type MosaicPaywallV04IconComponent = {
  "type": "icon";
  "id": MosaicPaywallV04Identifier;
  "name": MosaicPaywallV04IconName;
  "size": MosaicPaywallV04PositiveLogicalSize;
  "color": MosaicPaywallV04Color;
  "appearance"?: MosaicPaywallV04BoxAppearance;
  "sizing"?: MosaicPaywallV04BoxSizing;
  "outerInsets"?: MosaicPaywallV04EdgeInsets;
  "motion"?: MosaicPaywallV04NodeMotion;
  "visibility"?: MosaicPaywallV04Visibility;
  "accessibility": MosaicPaywallV04ImageAccessibility;
};

export type MosaicPaywallV04FeatureListItem = {
  "id": MosaicPaywallV04Identifier;
  "text": MosaicPaywallV04LocalizedText;
  "marker"?: MosaicPaywallV04Marker;
};

export type MosaicPaywallV04FeatureListComponent = {
  "type": "featureList";
  "id": MosaicPaywallV04Identifier;
  "marker": MosaicPaywallV04Marker;
  "gap": MosaicPaywallV04LogicalSize;
  "markerColor": MosaicPaywallV04Color;
  "markerSize"?: MosaicPaywallV04PositiveLogicalSize;
  "items": Array<MosaicPaywallV04FeatureListItem>;
  "typography": MosaicPaywallV04BaseTypography;
  "appearance"?: MosaicPaywallV04BoxAppearance;
  "sizing"?: MosaicPaywallV04BoxSizing;
  "outerInsets"?: MosaicPaywallV04EdgeInsets;
  "motion"?: MosaicPaywallV04NodeMotion;
  "visibility"?: MosaicPaywallV04Visibility;
  "accessibility": MosaicPaywallV04ControlAccessibility;
};

export type MosaicPaywallV04UnavailableProductFallback = {
  "selection": "firstAvailable";
  "whenNoneAvailable": "showMessageAndDisablePurchase";
  "message": MosaicPaywallV04LocalizedText;
};

export type MosaicPaywallV04SelectionStateStyle = {
  "background": MosaicPaywallV04Background;
  "border": MosaicPaywallV04Border;
  "cornerRadius": MosaicPaywallV04LogicalSize;
  "padding": MosaicPaywallV04EdgeInsets;
  "opacity": number;
  "shadow"?: MosaicPaywallV04Shadow;
};

export type MosaicPaywallV04ProductCardDefaultStyle = MosaicPaywallV04SelectionStateStyle;

export type MosaicPaywallV04EdgeInsetsOverride = {
  "top"?: MosaicPaywallV04LogicalSize;
  "start"?: MosaicPaywallV04LogicalSize;
  "bottom"?: MosaicPaywallV04LogicalSize;
  "end"?: MosaicPaywallV04LogicalSize;
};

export type MosaicPaywallV04SelectionStateStyleOverride = {
  "background"?: MosaicPaywallV04Background;
  "border"?: MosaicPaywallV04BorderOverride;
  "cornerRadius"?: MosaicPaywallV04LogicalSize;
  "padding"?: MosaicPaywallV04EdgeInsetsOverride;
  "opacity"?: number;
  "shadow"?: MosaicPaywallV04Shadow;
};

export type MosaicPaywallV04SelectionStyles = {
  "default": MosaicPaywallV04SelectionStateStyle;
  "selected": MosaicPaywallV04SelectionStateStyleOverride;
};

export type MosaicPaywallV04ProductCardSelectedStyle = MosaicPaywallV04SelectionStateStyleOverride;

export type MosaicPaywallV04ProductCardStyles = MosaicPaywallV04SelectionStyles;

export type MosaicPaywallV04ProductCardAccessibility = {
  "label": MosaicPaywallV04LocalizedText;
};

export type MosaicPaywallV04ProductBadgePlacement = {
  "mode": "nested";
} | {
  "mode": "overlay";
  "anchor": "topStart" | "topEnd" | "bottomStart" | "bottomEnd";
  "inset": number;
};

export type MosaicPaywallV04ProductCardPassiveStack = {
  "type": "stack";
  "id": MosaicPaywallV04Identifier;
  "direction": "vertical" | "horizontal";
  "gap": MosaicPaywallV04LogicalSize;
  "padding": MosaicPaywallV04EdgeInsets;
  "mainAxisDistribution": "start" | "center" | "end" | "spaceBetween";
  "crossAxisAlignment": "start" | "center" | "end" | "stretch";
  "appearance"?: MosaicPaywallV04ContainerAppearance;
  "sizing"?: MosaicPaywallV04BoxSizing;
  "outerInsets"?: MosaicPaywallV04EdgeInsets;
  "motion"?: MosaicPaywallV04NodeMotion;
  "visibility"?: MosaicPaywallV04Visibility;
  "children": Array<MosaicPaywallV04ProductCardPassiveNode>;
};

export type MosaicPaywallV04ProductCardPassiveNode = MosaicPaywallV04ProductCardPassiveStack | MosaicPaywallV04TextComponent | MosaicPaywallV04ImageComponent | MosaicPaywallV04IconComponent | MosaicPaywallV04FeatureListComponent | MosaicPaywallV04CountdownComponent | MosaicPaywallV04TimelineComponent | MosaicPaywallV04AwardComponent | MosaicPaywallV04SocialProofComponent;

export type MosaicPaywallV04ProductBadgeComponent = {
  "type": "productBadge";
  "id": MosaicPaywallV04Identifier;
  "placement": MosaicPaywallV04ProductBadgePlacement;
  "direction": "vertical" | "horizontal";
  "gap": MosaicPaywallV04LogicalSize;
  "mainAxisDistribution": "start" | "center" | "end" | "spaceBetween";
  "crossAxisAlignment": "start" | "center" | "end" | "stretch";
  "children": Array<MosaicPaywallV04ProductCardPassiveNode>;
  "styles": MosaicPaywallV04ProductCardStyles;
  "sizing"?: MosaicPaywallV04BoxSizing;
  "motion"?: MosaicPaywallV04NodeMotion;
};

export type MosaicPaywallV04ProductCardChild = MosaicPaywallV04ProductCardPassiveNode | MosaicPaywallV04ProductBadgeComponent;

export type MosaicPaywallV04ProductCardComponent = {
  "type": "productCard";
  "id": MosaicPaywallV04Identifier;
  "productReferenceId": MosaicPaywallV04Identifier;
  "direction": "vertical" | "horizontal";
  "gap": MosaicPaywallV04LogicalSize;
  "mainAxisDistribution": "start" | "center" | "end" | "spaceBetween";
  "crossAxisAlignment": "start" | "center" | "end" | "stretch";
  "children": Array<MosaicPaywallV04ProductCardChild>;
  "styles": MosaicPaywallV04ProductCardStyles;
  "sizing"?: MosaicPaywallV04BoxSizing;
  "motion"?: MosaicPaywallV04NodeMotion;
  "clipContent"?: false;
  "accessibility"?: MosaicPaywallV04ProductCardAccessibility;
};

export type MosaicPaywallV04ProductSelectorComponent = {
  "type": "productSelector";
  "id": MosaicPaywallV04Identifier;
  "direction": "vertical" | "horizontal";
  "gap": MosaicPaywallV04LogicalSize;
  "crossAxisAlignment": "start" | "center" | "end" | "stretch";
  "initialProductCardId": MosaicPaywallV04Identifier;
  "cards": Array<MosaicPaywallV04ProductCardComponent>;
  "appearance"?: MosaicPaywallV04BoxAppearance;
  "sizing"?: MosaicPaywallV04BoxSizing;
  "outerInsets"?: MosaicPaywallV04EdgeInsets;
  "motion"?: MosaicPaywallV04SelectableMotion;
  "visibility"?: MosaicPaywallV04Visibility;
  "unavailableFallback": MosaicPaywallV04UnavailableProductFallback;
  "accessibility": MosaicPaywallV04ControlAccessibility;
};

export type MosaicPaywallV04PurchaseAction = {
  "type": "purchase";
  "productSelectorId": MosaicPaywallV04Identifier;
};

export type MosaicPaywallV04RestoreAction = {
  "type": "restore";
};

export type MosaicPaywallV04CloseAction = {
  "type": "close";
};

export type MosaicPaywallV04NavigateToAction = {
  "type": "navigateTo";
  "screenId": MosaicPaywallV04Identifier;
};

export type MosaicPaywallV04NavigateBackAction = {
  "type": "navigateBack";
};

export type MosaicPaywallV04ExternalUrl = string;

export type MosaicPaywallV04OpenExternalUrlAction = {
  "type": "openExternalUrl";
  "url": MosaicPaywallV04ExternalUrl;
};

export type MosaicPaywallV04ButtonAction = MosaicPaywallV04PurchaseAction | MosaicPaywallV04RestoreAction | MosaicPaywallV04CloseAction | MosaicPaywallV04NavigateToAction | MosaicPaywallV04NavigateBackAction | MosaicPaywallV04OpenExternalUrlAction;

export type MosaicPaywallV04ButtonComponent = {
  "type": "button";
  "id": MosaicPaywallV04Identifier;
  "direction": "vertical" | "horizontal";
  "gap": MosaicPaywallV04LogicalSize;
  "mainAxisDistribution": "start" | "center" | "end" | "spaceBetween";
  "crossAxisAlignment": "start" | "center" | "end" | "stretch";
  "children": Array<MosaicPaywallV04Node>;
  "inProgressChildren"?: Array<MosaicPaywallV04Node>;
  "appearance"?: MosaicPaywallV04BoxAppearance;
  "sizing"?: MosaicPaywallV04BoxSizing;
  "outerInsets"?: MosaicPaywallV04EdgeInsets;
  "motion"?: MosaicPaywallV04ButtonMotion;
  "visibility"?: MosaicPaywallV04Visibility;
  "action": MosaicPaywallV04ButtonAction;
  "accessibility": MosaicPaywallV04ControlAccessibility;
};

export type MosaicPaywallV04CarouselPage = {
  "id": MosaicPaywallV04Identifier;
  "accessibilityLabel": MosaicPaywallV04LocalizedText;
  "content": MosaicPaywallV04Stack;
};

export type MosaicPaywallV04CarouselComponent = {
  "type": "carousel";
  "id": MosaicPaywallV04Identifier;
  "initialPageIndex": number;
  "showsIndicators": boolean;
  "pages": Array<MosaicPaywallV04CarouselPage>;
  "appearance"?: MosaicPaywallV04ContainerAppearance;
  "sizing"?: MosaicPaywallV04BoxSizing;
  "outerInsets"?: MosaicPaywallV04EdgeInsets;
  "motion"?: MosaicPaywallV04NodeMotion;
  "visibility"?: MosaicPaywallV04Visibility;
  "accessibility": MosaicPaywallV04ControlAccessibility;
};

export type MosaicPaywallV04SwitchComponent = {
  "type": "switch";
  "id": MosaicPaywallV04Identifier;
  "label": MosaicPaywallV04LocalizedText;
  "initialValue": boolean;
  "typography": MosaicPaywallV04BaseTypography;
  "offTrackColor": MosaicPaywallV04Color;
  "onTrackColor": MosaicPaywallV04Color;
  "thumbColor": MosaicPaywallV04Color;
  "appearance"?: MosaicPaywallV04BoxAppearance;
  "sizing"?: MosaicPaywallV04BoxSizing;
  "outerInsets"?: MosaicPaywallV04EdgeInsets;
  "motion"?: MosaicPaywallV04NodeMotion;
  "visibility"?: MosaicPaywallV04Visibility;
  "accessibility": MosaicPaywallV04ControlAccessibility;
};

export type MosaicPaywallV04CountdownComponent = {
  "type": "countdown";
  "id": MosaicPaywallV04Identifier;
  "endsAt": string;
  "largestUnit": "day" | "hour" | "minute" | "second";
  "smallestUnit": "day" | "hour" | "minute" | "second";
  "completedText": MosaicPaywallV04LocalizedText;
  "typography": MosaicPaywallV04BaseTypography;
  "appearance"?: MosaicPaywallV04BoxAppearance;
  "sizing"?: MosaicPaywallV04BoxSizing;
  "outerInsets"?: MosaicPaywallV04EdgeInsets;
  "motion"?: MosaicPaywallV04NodeMotion;
  "visibility"?: MosaicPaywallV04Visibility;
  "accessibility": MosaicPaywallV04TextAccessibility;
};

export type MosaicPaywallV04TabsEntry = {
  "id": MosaicPaywallV04Identifier;
  "label": MosaicPaywallV04LocalizedText;
  "content": MosaicPaywallV04Stack;
};

export type MosaicPaywallV04TabsComponent = {
  "type": "tabs";
  "id": MosaicPaywallV04Identifier;
  "tabBarDirection": "vertical" | "horizontal";
  "tabBarGap": MosaicPaywallV04LogicalSize;
  "tabBarDistribution": "start" | "center" | "end" | "spaceBetween";
  "gap": MosaicPaywallV04LogicalSize;
  "initialTabId": MosaicPaywallV04Identifier;
  "tabs": Array<MosaicPaywallV04TabsEntry>;
  "styles": MosaicPaywallV04SelectionStyles;
  "labelTypography": MosaicPaywallV04BaseTypography;
  "selectedLabelColor": MosaicPaywallV04Color;
  "appearance"?: MosaicPaywallV04ContainerAppearance;
  "sizing"?: MosaicPaywallV04BoxSizing;
  "outerInsets"?: MosaicPaywallV04EdgeInsets;
  "motion"?: MosaicPaywallV04SelectableMotion;
  "visibility"?: MosaicPaywallV04Visibility;
  "accessibility": MosaicPaywallV04ControlAccessibility;
};

export type MosaicPaywallV04TimelineMarker = MosaicPaywallV04Marker;

export type MosaicPaywallV04TimelineConnector = {
  "color": MosaicPaywallV04Color;
  "width": MosaicPaywallV04PositiveLogicalSize;
  "style": "solid" | "dashed";
};

export type MosaicPaywallV04TimelineEntry = {
  "id": MosaicPaywallV04Identifier;
  "title": MosaicPaywallV04LocalizedText;
  "description"?: MosaicPaywallV04LocalizedText;
  "marker"?: MosaicPaywallV04TimelineMarker;
};

export type MosaicPaywallV04TimelineComponent = {
  "type": "timeline";
  "id": MosaicPaywallV04Identifier;
  "orientation": "vertical";
  "gap": MosaicPaywallV04LogicalSize;
  "connector": MosaicPaywallV04TimelineConnector;
  "entries": Array<MosaicPaywallV04TimelineEntry>;
  "markerColor"?: MosaicPaywallV04Color;
  "markerSize"?: MosaicPaywallV04PositiveLogicalSize;
  "titleTypography": MosaicPaywallV04BaseTypography;
  "descriptionTypography"?: MosaicPaywallV04BaseTypography;
  "appearance"?: MosaicPaywallV04BoxAppearance;
  "sizing"?: MosaicPaywallV04BoxSizing;
  "outerInsets"?: MosaicPaywallV04EdgeInsets;
  "motion"?: MosaicPaywallV04NodeMotion;
  "visibility"?: MosaicPaywallV04Visibility;
  "accessibility": MosaicPaywallV04ControlAccessibility;
};

export type MosaicPaywallV04AwardEmblem = {
  "type": "image";
  "assetId": MosaicPaywallV04Identifier;
  "size": MosaicPaywallV04PositiveLogicalSize;
} | {
  "type": "icon";
  "name": MosaicPaywallV04IconName;
  "size": MosaicPaywallV04PositiveLogicalSize;
  "color": MosaicPaywallV04Color;
};

export type MosaicPaywallV04AwardComponent = {
  "type": "award";
  "id": MosaicPaywallV04Identifier;
  "direction": "vertical" | "horizontal";
  "gap": MosaicPaywallV04LogicalSize;
  "crossAxisAlignment": "start" | "center" | "end" | "stretch";
  "emblem"?: MosaicPaywallV04AwardEmblem;
  "title": MosaicPaywallV04LocalizedText;
  "titleTypography": MosaicPaywallV04BaseTypography;
  "subtitle"?: MosaicPaywallV04LocalizedText;
  "subtitleTypography"?: MosaicPaywallV04BaseTypography;
  "appearance"?: MosaicPaywallV04BoxAppearance;
  "sizing"?: MosaicPaywallV04BoxSizing;
  "outerInsets"?: MosaicPaywallV04EdgeInsets;
  "motion"?: MosaicPaywallV04NodeMotion;
  "visibility"?: MosaicPaywallV04Visibility;
  "accessibility": MosaicPaywallV04ControlAccessibility;
};

export type MosaicPaywallV04SocialProofRating = {
  "symbol": "star";
  "value": number;
  "maximum": number;
  "step": "whole" | "half";
  "size": MosaicPaywallV04PositiveLogicalSize;
  "filledColor": MosaicPaywallV04Color;
  "emptyColor": MosaicPaywallV04Color;
};

export type MosaicPaywallV04SocialProofAvatar = {
  "assetId": MosaicPaywallV04Identifier;
  "size": MosaicPaywallV04PositiveLogicalSize;
};

export type MosaicPaywallV04SocialProofComponent = {
  "type": "socialProof";
  "id": MosaicPaywallV04Identifier;
  "gap": MosaicPaywallV04LogicalSize;
  "quote": MosaicPaywallV04LocalizedText;
  "quoteTypography": MosaicPaywallV04BaseTypography;
  "attribution": MosaicPaywallV04LocalizedText;
  "attributionTypography": MosaicPaywallV04BaseTypography;
  "rating"?: MosaicPaywallV04SocialProofRating;
  "avatar"?: MosaicPaywallV04SocialProofAvatar;
  "appearance"?: MosaicPaywallV04BoxAppearance;
  "sizing"?: MosaicPaywallV04BoxSizing;
  "outerInsets"?: MosaicPaywallV04EdgeInsets;
  "motion"?: MosaicPaywallV04NodeMotion;
  "visibility"?: MosaicPaywallV04Visibility;
  "accessibility": MosaicPaywallV04ControlAccessibility;
};

export type MosaicPaywallV04Marker = {
  "kind": "dot";
} | {
  "kind": "ordinal";
} | {
  "kind": "icon";
  "name": MosaicPaywallV04IconName;
};

export type MosaicPaywallV04Document = {
  "schemaVersion": MosaicPaywallV04Version;
  "id": MosaicPaywallV04Identifier;
  "revision": number;
  "compatibility": MosaicPaywallV04DocumentCompatibility;
  "localization": MosaicPaywallV04Localization;
  "designSystem": MosaicPaywallV04DesignSystem;
  "assets": Array<MosaicPaywallV04Asset>;
  "products": Array<MosaicPaywallV04ProductReference>;
  "initialScreenId": MosaicPaywallV04Identifier;
  "screens": Array<MosaicPaywallV04Screen>;
};

export type MosaicPreviewV04MessageId = string;

export type MosaicPreviewV04SessionId = string;

export type MosaicPreviewV04ClientId = string;

export type MosaicPreviewV04EditableDocumentId = string;

export type MosaicPreviewV04RevisionId = string;

export type MosaicPreviewV04UtcTimestamp = string;

export type MosaicPreviewV04MachineIdentifier = string;

export type MosaicPreviewV04SemanticVersion = string;

export type MosaicPreviewV04SafeText = string;

export type MosaicPreviewV04SafeDisplayName = string;

export type MosaicPreviewV04DiagnosticCode = string;

export type MosaicPreviewV04JsonPointer = string;

export type MosaicPreviewV04ComponentId = string;

export type MosaicPreviewV04LocaleTag = string;

export type MosaicPreviewV04LocalRevision = {
  "revisionId": MosaicPreviewV04RevisionId;
  "sequence": number;
};

export type MosaicPreviewV04SoftwareIdentity = {
  "id": MosaicPreviewV04MachineIdentifier;
  "version": MosaicPreviewV04SemanticVersion;
};

export type MosaicPreviewV04ApplicationIdentity = {
  "id": MosaicPreviewV04MachineIdentifier;
  "displayName": MosaicPreviewV04SafeDisplayName;
  "version": string;
};

export type MosaicPreviewV04DeviceIdentity = {
  "displayName": MosaicPreviewV04SafeDisplayName;
  "systemName": MosaicPreviewV04SafeDisplayName;
  "systemVersion": string;
};

export type MosaicPreviewV04ClientIdentity = {
  "clientId": MosaicPreviewV04ClientId;
  "displayName": MosaicPreviewV04SafeDisplayName;
  "renderer": MosaicPreviewV04SoftwareIdentity;
  "application": MosaicPreviewV04ApplicationIdentity;
  "device": MosaicPreviewV04DeviceIdentity;
};

export type MosaicPreviewV04SupportedCapability = {
  "name": MosaicPreviewV04MachineIdentifier;
  "version": MosaicPreviewV04SemanticVersion;
};

export type MosaicPreviewV04CapabilityName = "preview.liveUpdate" | "preview.mockCommerce" | "preview.localeOverride" | "preview.textScale" | "preview.diagnostics";

export type MosaicPreviewV04Capability = {
  "name": MosaicPreviewV04CapabilityName;
  "version": "0.4";
};

export type MosaicPreviewV04Limits = {
  "maxDocumentBytes": number;
};

export type MosaicPreviewV04Context = {
  "locale": MosaicPreviewV04LocaleTag;
  "textScale": number;
};

export type MosaicPreviewV04DiagnosticLocation = {
  "documentPath": MosaicPreviewV04JsonPointer;
  "componentId"?: MosaicPreviewV04ComponentId;
  "property"?: string;
};

export type MosaicPreviewV04RecoveryAction = {
  "action": "editProperty" | "removeComponent" | "bindProduct" | "selectSupportedTemplate" | "updatePreviewClient" | "restoreLastValidDraft" | "retry" | "reconnect" | "inspectComponent";
  "message": MosaicPreviewV04SafeText;
};

export type MosaicPreviewV04ValidationDiagnostic = {
  "code": MosaicPreviewV04DiagnosticCode;
  "message": MosaicPreviewV04SafeText;
  "location": MosaicPreviewV04DiagnosticLocation;
  "recovery": MosaicPreviewV04RecoveryAction;
};

export type MosaicPreviewV04CompatibilityWarning = {
  "code": MosaicPreviewV04DiagnosticCode;
  "severity": "warning" | "blocking";
  "message": MosaicPreviewV04SafeText;
  "location"?: MosaicPreviewV04DiagnosticLocation;
  "capability"?: MosaicPreviewV04SupportedCapability;
  "fallback": "keepLastAcceptedDraft" | "useDeclaredAssetFallback" | "useSelectorFallback" | "nativeApproximation";
  "recovery": MosaicPreviewV04RecoveryAction;
};

export type MosaicPreviewV04RenderDiagnostic = {
  "code": MosaicPreviewV04DiagnosticCode;
  "message": MosaicPreviewV04SafeText;
  "location"?: MosaicPreviewV04DiagnosticLocation;
  "fallback": "keepLastAcceptedDraft";
  "recovery": MosaicPreviewV04RecoveryAction;
};

export type MosaicPreviewV04Period = {
  "unit": "day" | "week" | "month" | "year";
  "value": number;
};

export type MosaicPreviewV04IntroductoryOffer = {
  "localizedPrice": MosaicPreviewV04SafeDisplayName;
  "period": MosaicPreviewV04Period;
  "cycles": number;
};

export type MosaicPreviewV04AvailableSubscriptionProduct = {
  "productReferenceId": MosaicPreviewV04ComponentId;
  "availability": "available";
  "kind": "subscription";
  "localizedPrice": MosaicPreviewV04SafeDisplayName;
  "currencyCode": string;
  "billingPeriod": MosaicPreviewV04Period;
  "trialPeriod"?: MosaicPreviewV04Period;
  "introductoryOffer"?: MosaicPreviewV04IntroductoryOffer;
};

export type MosaicPreviewV04AvailableNonConsumableProduct = {
  "productReferenceId": MosaicPreviewV04ComponentId;
  "availability": "available";
  "kind": "nonConsumable";
  "localizedPrice": MosaicPreviewV04SafeDisplayName;
  "currencyCode": string;
};

export type MosaicPreviewV04UnavailableMockProduct = {
  "productReferenceId": MosaicPreviewV04ComponentId;
  "availability": "unavailable";
  "reason": "notConfigured" | "temporarilyUnavailable" | "unsupported";
};

export type MosaicPreviewV04MockProduct = MosaicPreviewV04AvailableSubscriptionProduct | MosaicPreviewV04AvailableNonConsumableProduct | MosaicPreviewV04UnavailableMockProduct;

export type MosaicPreviewV04NoEntitlement = {
  "status": "none";
};

export type MosaicPreviewV04ActiveEntitlement = {
  "status": "active";
  "productReferenceId": MosaicPreviewV04ComponentId;
};

export type MosaicPreviewV04MockEntitlement = MosaicPreviewV04NoEntitlement | MosaicPreviewV04ActiveEntitlement;

export type MosaicPreviewV04MockCommerceState = {
  "products": Array<MosaicPreviewV04MockProduct>;
  "purchaseOutcome": "purchased" | "alreadyEntitled" | "cancelled" | "purchaseFailed";
  "restoreOutcome": "restored" | "alreadyEntitled" | "restoreNoPurchases" | "restoreFailed";
  "entitlement": MosaicPreviewV04MockEntitlement;
};

export type MosaicPreviewV04RevisionTarget = {
  "clientId": MosaicPreviewV04ClientId;
  "editableDocumentId": MosaicPreviewV04EditableDocumentId;
  "revision": MosaicPreviewV04LocalRevision;
};

export type MosaicPreviewV04ClientConnectedPayload = {
  "client": MosaicPreviewV04ClientIdentity;
};

export type MosaicPreviewV04ClientDisconnectedPayload = {
  "clientId": MosaicPreviewV04ClientId;
  "reason": "closed" | "timeout" | "transportError" | "replaced" | "sessionEnded";
  "diagnostic"?: MosaicPreviewV04SafeText;
};

export type MosaicPreviewV04CapabilityReportPayload = {
  "clientId": MosaicPreviewV04ClientId;
  "supportedSchemaVersions": Array<MosaicPreviewV04SemanticVersion>;
  "supportedCapabilities": Array<MosaicPreviewV04SupportedCapability>;
  "previewCapabilities": Array<MosaicPreviewV04Capability>;
  "limits": MosaicPreviewV04Limits;
};

export type MosaicPreviewV04DraftUpdatedPayload = {
  "editableDocumentId": MosaicPreviewV04EditableDocumentId;
  "revision": MosaicPreviewV04LocalRevision;
  "document": MosaicPaywallV04Document;
  "preview": MosaicPreviewV04Context;
};

export type MosaicPreviewV04DraftAcceptedPayload = {
  "clientId": MosaicPreviewV04ClientId;
  "editableDocumentId": MosaicPreviewV04EditableDocumentId;
  "revision": MosaicPreviewV04LocalRevision;
};

export type MosaicPreviewV04DraftRejectedPayload = {
  "clientId": MosaicPreviewV04ClientId;
  "editableDocumentId": MosaicPreviewV04EditableDocumentId;
  "revision": MosaicPreviewV04LocalRevision;
  "reason": "staleRevision" | "revisionConflict" | "validationFailed" | "unsupportedSchemaVersion" | "unsupportedCapability" | "documentTooLarge" | "renderFailed";
  "diagnostics": Array<MosaicPreviewV04ValidationDiagnostic>;
};

export type MosaicPreviewV04ValidationErrorPayload = {
  "clientId": MosaicPreviewV04ClientId;
  "editableDocumentId": MosaicPreviewV04EditableDocumentId;
  "revision": MosaicPreviewV04LocalRevision;
  "errors": Array<MosaicPreviewV04ValidationDiagnostic>;
};

export type MosaicPreviewV04RenderWarningPayload = {
  "clientId": MosaicPreviewV04ClientId;
  "editableDocumentId": MosaicPreviewV04EditableDocumentId;
  "revision": MosaicPreviewV04LocalRevision;
  "warnings": Array<MosaicPreviewV04CompatibilityWarning>;
};

export type MosaicPreviewV04RenderFailurePayload = {
  "clientId": MosaicPreviewV04ClientId;
  "editableDocumentId": MosaicPreviewV04EditableDocumentId;
  "revision": MosaicPreviewV04LocalRevision;
  "failure": MosaicPreviewV04RenderDiagnostic;
};

export type MosaicPreviewV04MockCommerceStateChangedPayload = {
  "editableDocumentId": MosaicPreviewV04EditableDocumentId;
  "stateRevision": MosaicPreviewV04LocalRevision;
  "state": MosaicPreviewV04MockCommerceState;
};

export type MosaicPreviewV04HeartbeatPayload = {
  "clientId": MosaicPreviewV04ClientId;
  "kind": "ping" | "pong";
  "sequence": number;
};

export type MosaicPreviewV04MessageType = "previewClientConnected" | "previewClientDisconnected" | "capabilityReport" | "draftUpdated" | "draftAccepted" | "draftRejected" | "validationError" | "renderWarning" | "renderFailure" | "mockCommerceStateChanged" | "previewHeartbeat";

export type MosaicPreviewV04Envelope<
  TType extends MosaicPreviewV04MessageType,
  TPayload,
> = {
  "previewProtocolVersion": "0.4";
  "messageId": MosaicPreviewV04MessageId;
  "sessionId": MosaicPreviewV04SessionId;
  "sentAt": MosaicPreviewV04UtcTimestamp;
} & {
  "type": TType;
  "payload": TPayload;
};

export type MosaicPreviewV04Message =
  | MosaicPreviewV04Envelope<"previewClientConnected", MosaicPreviewV04ClientConnectedPayload>
  | MosaicPreviewV04Envelope<"previewClientDisconnected", MosaicPreviewV04ClientDisconnectedPayload>
  | MosaicPreviewV04Envelope<"capabilityReport", MosaicPreviewV04CapabilityReportPayload>
  | MosaicPreviewV04Envelope<"draftUpdated", MosaicPreviewV04DraftUpdatedPayload>
  | MosaicPreviewV04Envelope<"draftAccepted", MosaicPreviewV04DraftAcceptedPayload>
  | MosaicPreviewV04Envelope<"draftRejected", MosaicPreviewV04DraftRejectedPayload>
  | MosaicPreviewV04Envelope<"validationError", MosaicPreviewV04ValidationErrorPayload>
  | MosaicPreviewV04Envelope<"renderWarning", MosaicPreviewV04RenderWarningPayload>
  | MosaicPreviewV04Envelope<"renderFailure", MosaicPreviewV04RenderFailurePayload>
  | MosaicPreviewV04Envelope<"mockCommerceStateChanged", MosaicPreviewV04MockCommerceStateChangedPayload>
  | MosaicPreviewV04Envelope<"previewHeartbeat", MosaicPreviewV04HeartbeatPayload>;

export type MosaicLocalProjectV04 = {
  "fileFormatVersion": "0.4";
  "editableDocumentId": MosaicPreviewV04EditableDocumentId;
  "revision": MosaicPreviewV04LocalRevision;
  "document": MosaicPaywallV04Document;
  "preview": MosaicPreviewV04Context;
  "mockCommerce": {
    "revision": MosaicPreviewV04LocalRevision;
    "state": MosaicPreviewV04MockCommerceState;
  };
};

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

export type MosaicExperimentAssignmentV1Identifier = string;

export type MosaicExperimentAssignmentV1UtcTimestamp = string;

export type MosaicExperimentAssignmentV1SafeLabel = string;

export type MosaicExperimentAssignmentV1Sha256Digest = string;

export type MosaicExperimentAssignmentV1AssignmentFeature = "allocation.ranges" | "assignment.installation" | "assignment.identified_user" | "assignment.identified_user_or_installation" | "fallback.normal_placement" | "group.mutual_exclusion" | "override.qa" | "schedule.trusted_server_time";

export type MosaicExperimentAssignmentV1VariantCompatibility = {
  "requiredProductIds": Array<MosaicExperimentAssignmentV1Identifier>;
  "requiredProviderCapabilities": Array<"product_load" | "purchase" | "restore" | "entitlement_lookup" | "native_recovery">;
};

export type MosaicExperimentAssignmentV1Variant = {
  "id": MosaicExperimentAssignmentV1Identifier;
  "name": MosaicExperimentAssignmentV1SafeLabel;
  "role": "control" | "treatment";
  "paywallId": MosaicExperimentAssignmentV1Identifier;
  "paywallVersionId": MosaicExperimentAssignmentV1Identifier;
  "rangeStart": number;
  "rangeEnd": number;
  "compatibility": MosaicExperimentAssignmentV1VariantCompatibility;
};

export type MosaicExperimentAssignmentV1Schedule = {
  "startsAt": MosaicExperimentAssignmentV1UtcTimestamp;
  "endsAt"?: MosaicExperimentAssignmentV1UtcTimestamp;
  "timePolicy": "trusted_server_time_v1";
  "unreliableTimeBehavior": "normal_placement";
};

export type MosaicExperimentAssignmentV1GroupMember = {
  "experimentId": MosaicExperimentAssignmentV1Identifier;
  "rangeStart": number;
  "rangeEnd": number;
};

export type MosaicExperimentAssignmentV1GroupRange = {
  "rangeStart": number;
  "rangeEnd": number;
};

export type MosaicExperimentAssignmentV1Group = {
  "id": MosaicExperimentAssignmentV1Identifier;
  "versionId": MosaicExperimentAssignmentV1Identifier;
  "members": Array<MosaicExperimentAssignmentV1GroupMember>;
  "normalPlacementRange"?: MosaicExperimentAssignmentV1GroupRange;
  "bucketingAlgorithm": "experiment_group_sha256_length_prefixed_v1";
};

export type MosaicExperimentAssignmentV1QaOverride = {
  "id": MosaicExperimentAssignmentV1Identifier;
  "variantId": MosaicExperimentAssignmentV1Identifier;
  "assignmentKeyType": "installation" | "identified_user";
  "selectorDigest": MosaicExperimentAssignmentV1Sha256Digest;
  "safeLabel": MosaicExperimentAssignmentV1SafeLabel;
  "startsAt": MosaicExperimentAssignmentV1UtcTimestamp;
  "expiresAt": MosaicExperimentAssignmentV1UtcTimestamp;
  "visibility": "diagnostic";
};

export type MosaicExperimentAssignmentV1Compatibility = {
  "requiredFeatures": Array<MosaicExperimentAssignmentV1AssignmentFeature>;
  "bucketingAlgorithms": Array<"experiment_sha256_length_prefixed_v1" | "experiment_group_sha256_length_prefixed_v1">;
  "schedulePolicies": Array<"trusted_server_time_v1">;
};

export type MosaicExperimentAssignmentV1Assignment = {
  "projectId": MosaicExperimentAssignmentV1Identifier;
  "environmentId": MosaicExperimentAssignmentV1Identifier;
  "experimentId": MosaicExperimentAssignmentV1Identifier;
  "experimentVersionId": MosaicExperimentAssignmentV1Identifier;
  "placementId": MosaicExperimentAssignmentV1Identifier;
  "controlPaywallVersionId": MosaicExperimentAssignmentV1Identifier;
  "allocationVersion": MosaicExperimentAssignmentV1Identifier;
  "variants": Array<MosaicExperimentAssignmentV1Variant>;
  "assignmentKeyPolicy": "installation" | "identified_user" | "identified_user_or_installation";
  "bucketingAlgorithm": "experiment_sha256_length_prefixed_v1";
  "lifecycle": "scheduled" | "running" | "paused" | "stopped" | "completed";
  "schedule": MosaicExperimentAssignmentV1Schedule;
  "mutualExclusionGroup"?: MosaicExperimentAssignmentV1Group;
  "qaOverrides": Array<MosaicExperimentAssignmentV1QaOverride>;
  "fallback": "normal_placement";
  "compatibility": MosaicExperimentAssignmentV1Compatibility;
};

export type MosaicExperimentAssignmentV1 = {
  "experimentAssignmentVersion": "1";
  "assignment": MosaicExperimentAssignmentV1Assignment;
};

export type MosaicConfigurationDeliveryV3Identifier = string;

export type MosaicConfigurationDeliveryV3Key = string;

export type MosaicConfigurationDeliveryV3UtcTimestamp = string;

export type MosaicConfigurationDeliveryV3Sha256Digest = string;

export type MosaicConfigurationDeliveryV3ImmutableHttpsUrl = string;

export type MosaicConfigurationDeliveryV3Environment = {
  "id": MosaicConfigurationDeliveryV3Identifier;
  "key": string;
  "mode": "development" | "staging" | "production";
};

export type MosaicConfigurationDeliveryV3DecisionFeature = "condition.all" | "condition.any" | "condition.not" | "operator.contains_all" | "operator.contains_any" | "operator.does_not_exist" | "operator.equals" | "operator.exists" | "operator.greater_than" | "operator.greater_than_or_equal" | "operator.in" | "operator.less_than" | "operator.less_than_or_equal" | "operator.locale_matches" | "operator.not_equals" | "operator.not_in" | "outcome.fallback" | "outcome.no_paywall" | "outcome.paywall" | "outcome.unavailable" | "override.qa" | "source.application.locale" | "source.application.version" | "source.context.country" | "source.device.os_version" | "source.device.platform" | "source.entitlement_state" | "source.environment.id" | "source.environment.key" | "source.identity.user_present" | "source.product_availability" | "source.product_readiness" | "source.provider_capability" | "source.user_attribute";

export type MosaicConfigurationDeliveryV3AssetBinding = {
  "documentAssetId": MosaicConfigurationDeliveryV3Identifier;
  "assetReferenceId": MosaicConfigurationDeliveryV3Identifier;
};

export type MosaicConfigurationDeliveryV3PaywallVersion = {
  "id": MosaicConfigurationDeliveryV3Identifier;
  "paywallId": MosaicConfigurationDeliveryV3Identifier;
  "protocolVersion": "0.4";
  "documentDigest": MosaicConfigurationDeliveryV3Sha256Digest;
  "document": MosaicPaywallV04Document;
  "productReferenceIds": Array<MosaicConfigurationDeliveryV3Identifier>;
  "assetBindings": Array<MosaicConfigurationDeliveryV3AssetBinding>;
};

export type MosaicConfigurationDeliveryV3AssetReference = {
  "id": MosaicConfigurationDeliveryV3Identifier;
  "kind": "image" | "video";
  "mediaType": string;
  "byteLength": number;
  "contentDigest": MosaicConfigurationDeliveryV3Sha256Digest;
  "url": MosaicConfigurationDeliveryV3ImmutableHttpsUrl;
};

export type MosaicConfigurationDeliveryV3ProductReference = {
  "id": MosaicConfigurationDeliveryV3Identifier;
  "type": "subscription" | "one_time_non_consumable";
  "fallbackDisplayName": string;
  "readiness": "ready" | "not_ready";
};

export type MosaicConfigurationDeliveryV3EntitlementReference = {
  "id": MosaicConfigurationDeliveryV3Identifier;
  "key": MosaicConfigurationDeliveryV3Key;
};

export type MosaicConfigurationDeliveryV3DecisionCompatibility = {
  "version": "1";
  "requiredFeatures": Array<MosaicConfigurationDeliveryV3DecisionFeature>;
  "bucketingAlgorithms": Array<"sha256_length_prefixed_v1">;
};

export type MosaicConfigurationDeliveryV3PaywallCompatibility = {
  "version": "0.4";
  "requiredCapabilities": Array<MosaicPaywallV04RequiredCapability>;
};

export type MosaicConfigurationDeliveryV3ExperimentCompatibility = {
  "version": "1";
  "requiredFeatures": Array<MosaicExperimentAssignmentV1AssignmentFeature>;
  "bucketingAlgorithms": Array<"experiment_sha256_length_prefixed_v1" | "experiment_group_sha256_length_prefixed_v1">;
  "schedulePolicies": Array<"trusted_server_time_v1">;
};

export type MosaicConfigurationDeliveryV3Compatibility = {
  "placementDecisionContracts": Array<MosaicConfigurationDeliveryV3DecisionCompatibility>;
  "paywallProtocols": Array<MosaicConfigurationDeliveryV3PaywallCompatibility>;
  "acceptance": "atomic";
  "experimentAssignmentContracts": Array<MosaicConfigurationDeliveryV3ExperimentCompatibility>;
};

export type MosaicConfigurationDeliveryV3Release = {
  "id": MosaicConfigurationDeliveryV3Identifier;
  "number": number;
  "projectId": MosaicConfigurationDeliveryV3Identifier;
  "environment": MosaicConfigurationDeliveryV3Environment;
  "publishedAt": MosaicConfigurationDeliveryV3UtcTimestamp;
  "contentDigest": MosaicConfigurationDeliveryV3Sha256Digest;
  "compatibility": MosaicConfigurationDeliveryV3Compatibility;
  "placementDecisions": Array<MosaicPlacementDecisionV1>;
  "paywallVersions": Array<MosaicConfigurationDeliveryV3PaywallVersion>;
  "productReferences": Array<MosaicConfigurationDeliveryV3ProductReference>;
  "entitlementReferences": Array<MosaicConfigurationDeliveryV3EntitlementReference>;
  "assetReferences": Array<MosaicConfigurationDeliveryV3AssetReference>;
  "experimentAssignments": Array<MosaicExperimentAssignmentV1Assignment>;
};

export type MosaicConfigurationDeliveryV3 = {
  "configurationDeliveryVersion": "3";
  "release": MosaicConfigurationDeliveryV3Release;
};

export type MosaicPaywallDocument = MosaicPaywallV04Document;
export type MosaicPreviewMessage = MosaicPreviewV04Message;
export type MosaicLocalProject = MosaicLocalProjectV04;
export type MosaicPreviewCapabilityReportPayload = MosaicPreviewV04CapabilityReportPayload;
export type MosaicPreviewCapabilityName = MosaicPreviewV04CapabilityName;
export type MosaicPreviewValidationDiagnostic = MosaicPreviewV04ValidationDiagnostic;
