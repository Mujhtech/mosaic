// Generated from canonical Mosaic JSON Schemas. Do not edit.

export type MosaicPaywallVersion = "0.1";

export type MosaicPaywallIdentifier = string;

export type MosaicPaywallLocalizationKey = string;

export type MosaicPaywallLocaleTag = string;

export type MosaicPaywallLocalizedText = {
  "default": string;
  "localizationKey": MosaicPaywallLocalizationKey;
};

export type MosaicPaywallLocaleCatalog = {
  "direction": "ltr" | "rtl";
  "strings": Record<string, string>;
};

export type MosaicPaywallLocalization = {
  "defaultLocale": MosaicPaywallLocaleTag;
  "fallbackLocale": MosaicPaywallLocaleTag;
  "locales": Record<string, MosaicPaywallLocaleCatalog>;
};

export type MosaicPaywallCapabilityName = "layout.scrollContainer" | "layout.verticalStack" | "component.text" | "component.image" | "component.featureList" | "component.productSelector" | "component.purchaseButton" | "component.restoreButton" | "component.closeButton" | "component.legalText" | "localization.catalogs" | "localization.rtl" | "product.references" | "asset.bundledImage" | "action.purchase" | "action.restore" | "action.close" | "accessibility.metadata" | "fallback.asset" | "fallback.product" | "outcome.normalized";

export type MosaicPaywallRequiredCapability = {
  "name": MosaicPaywallCapabilityName;
  "version": MosaicPaywallVersion;
};

export type MosaicPaywallDocumentCompatibility = {
  "requiredCapabilities": Array<MosaicPaywallRequiredCapability>;
};

export type MosaicPaywallLogicalSize = number;

export type MosaicPaywallPositiveLogicalSize = number;

export type MosaicPaywallEdgeInsets = {
  "top": MosaicPaywallLogicalSize;
  "start": MosaicPaywallLogicalSize;
  "bottom": MosaicPaywallLogicalSize;
  "end": MosaicPaywallLogicalSize;
};

export type MosaicPaywallTextAlignment = "start" | "center" | "end";

export type MosaicPaywallControlAccessibility = {
  "label": MosaicPaywallLocalizedText;
  "hint"?: MosaicPaywallLocalizedText;
};

export type MosaicPaywallTextAccessibility = {
  "role": "text";
} | {
  "role": "heading";
  "level": number;
};

export type MosaicPaywallImageAccessibility = {
  "hidden": true;
} | {
  "hidden": false;
  "label": MosaicPaywallLocalizedText;
};

export type MosaicPaywallBundledImageSource = {
  "type": "bundled";
  "key": string;
};

export type MosaicPaywallImageAssetFallback = {
  "type": "placeholder";
  "value": MosaicPaywallLocalizedText;
};

export type MosaicPaywallImageAsset = {
  "type": "image";
  "id": MosaicPaywallIdentifier;
  "source": MosaicPaywallBundledImageSource;
  "fallback": MosaicPaywallImageAssetFallback;
};

export type MosaicPaywallProductReference = {
  "id": MosaicPaywallIdentifier;
  "productId": string;
  "label": MosaicPaywallLocalizedText;
  "badge"?: MosaicPaywallLocalizedText;
};

export type MosaicPaywallScrollContainer = {
  "type": "scrollContainer";
  "id": MosaicPaywallIdentifier;
  "axis": "vertical";
  "safeArea": "respect";
  "showsIndicators": boolean;
  "content": MosaicPaywallVerticalStack;
};

export type MosaicPaywallVerticalStack = {
  "type": "verticalStack";
  "id": MosaicPaywallIdentifier;
  "spacing": MosaicPaywallLogicalSize;
  "padding": MosaicPaywallEdgeInsets;
  "horizontalAlignment": "start" | "center" | "end" | "stretch";
  "children": Array<MosaicPaywallNode>;
};

export type MosaicPaywallNode = MosaicPaywallVerticalStack | MosaicPaywallTextComponent | MosaicPaywallImageComponent | MosaicPaywallFeatureListComponent | MosaicPaywallProductSelectorComponent | MosaicPaywallPurchaseButtonComponent | MosaicPaywallRestoreButtonComponent | MosaicPaywallCloseButtonComponent | MosaicPaywallLegalTextComponent;

export type MosaicPaywallTextComponent = {
  "type": "text";
  "id": MosaicPaywallIdentifier;
  "value": MosaicPaywallLocalizedText;
  "style": "title" | "body" | "caption";
  "alignment": MosaicPaywallTextAlignment;
  "accessibility": MosaicPaywallTextAccessibility;
};

export type MosaicPaywallImageComponent = {
  "type": "image";
  "id": MosaicPaywallIdentifier;
  "assetId": MosaicPaywallIdentifier;
  "width": "fill";
  "aspectRatio": number;
  "contentMode": "fit" | "fill";
  "accessibility": MosaicPaywallImageAccessibility;
};

export type MosaicPaywallFeatureListItem = {
  "id": MosaicPaywallIdentifier;
  "text": MosaicPaywallLocalizedText;
};

export type MosaicPaywallFeatureListComponent = {
  "type": "featureList";
  "id": MosaicPaywallIdentifier;
  "marker": "checkmark";
  "itemSpacing": MosaicPaywallLogicalSize;
  "items": Array<MosaicPaywallFeatureListItem>;
  "accessibility": MosaicPaywallControlAccessibility;
};

export type MosaicPaywallUnavailableProductFallback = {
  "selection": "firstAvailable";
  "whenNoneAvailable": "showMessageAndDisablePurchase";
  "message": MosaicPaywallLocalizedText;
};

export type MosaicPaywallProductSelectorComponent = {
  "type": "productSelector";
  "id": MosaicPaywallIdentifier;
  "productReferenceIds": Array<MosaicPaywallIdentifier>;
  "initiallySelectedProductReferenceId": MosaicPaywallIdentifier;
  "itemSpacing": MosaicPaywallLogicalSize;
  "unavailableFallback": MosaicPaywallUnavailableProductFallback;
  "accessibility": MosaicPaywallControlAccessibility;
};

export type MosaicPaywallPurchaseAction = {
  "type": "purchase";
  "productSelectorId": MosaicPaywallIdentifier;
};

export type MosaicPaywallRestoreAction = {
  "type": "restore";
};

export type MosaicPaywallCloseAction = {
  "type": "close";
};

export type MosaicPaywallPurchaseButtonComponent = {
  "type": "purchaseButton";
  "id": MosaicPaywallIdentifier;
  "label": MosaicPaywallLocalizedText;
  "inProgressLabel": MosaicPaywallLocalizedText;
  "action": MosaicPaywallPurchaseAction;
  "accessibility": MosaicPaywallControlAccessibility;
};

export type MosaicPaywallRestoreButtonComponent = {
  "type": "restoreButton";
  "id": MosaicPaywallIdentifier;
  "label": MosaicPaywallLocalizedText;
  "inProgressLabel": MosaicPaywallLocalizedText;
  "action": MosaicPaywallRestoreAction;
  "accessibility": MosaicPaywallControlAccessibility;
};

export type MosaicPaywallCloseButtonComponent = {
  "type": "closeButton";
  "id": MosaicPaywallIdentifier;
  "label": MosaicPaywallLocalizedText;
  "action": MosaicPaywallCloseAction;
  "accessibility": MosaicPaywallControlAccessibility;
};

export type MosaicPaywallLegalTextComponent = {
  "type": "legalText";
  "id": MosaicPaywallIdentifier;
  "value": MosaicPaywallLocalizedText;
  "alignment": MosaicPaywallTextAlignment;
  "accessibility": MosaicPaywallTextAccessibility;
};

export type MosaicPaywallDocument = {
  "schemaVersion": MosaicPaywallVersion;
  "id": MosaicPaywallIdentifier;
  "revision": number;
  "compatibility": MosaicPaywallDocumentCompatibility;
  "localization": MosaicPaywallLocalization;
  "assets": Array<MosaicPaywallImageAsset>;
  "products": Array<MosaicPaywallProductReference>;
  "layout": MosaicPaywallScrollContainer;
};

export type MosaicPreviewMessageId = string;

export type MosaicPreviewSessionId = string;

export type MosaicPreviewClientId = string;

export type MosaicPreviewEditableDocumentId = string;

export type MosaicPreviewRevisionId = string;

export type MosaicPreviewUtcTimestamp = string;

export type MosaicPreviewMachineIdentifier = string;

export type MosaicPreviewSemanticVersion = string;

export type MosaicPreviewSafeText = string;

export type MosaicPreviewSafeDisplayName = string;

export type MosaicPreviewDiagnosticCode = string;

export type MosaicPreviewJsonPointer = string;

export type MosaicPreviewComponentId = string;

export type MosaicPreviewLocaleTag = string;

export type MosaicPreviewLocalRevision = {
  "revisionId": MosaicPreviewRevisionId;
  "sequence": number;
};

export type MosaicPreviewSoftwareIdentity = {
  "id": MosaicPreviewMachineIdentifier;
  "version": MosaicPreviewSemanticVersion;
};

export type MosaicPreviewApplicationIdentity = {
  "id": MosaicPreviewMachineIdentifier;
  "displayName": MosaicPreviewSafeDisplayName;
  "version": string;
};

export type MosaicPreviewDeviceIdentity = {
  "displayName": MosaicPreviewSafeDisplayName;
  "systemName": MosaicPreviewSafeDisplayName;
  "systemVersion": string;
};

export type MosaicPreviewClientIdentity = {
  "clientId": MosaicPreviewClientId;
  "displayName": MosaicPreviewSafeDisplayName;
  "renderer": MosaicPreviewSoftwareIdentity;
  "application": MosaicPreviewApplicationIdentity;
  "device": MosaicPreviewDeviceIdentity;
};

export type MosaicPreviewSupportedCapability = {
  "name": MosaicPreviewMachineIdentifier;
  "version": MosaicPreviewSemanticVersion;
};

export type MosaicPreviewCapabilityName = "preview.liveUpdate" | "preview.mockCommerce" | "preview.localeOverride" | "preview.textScale" | "preview.diagnostics";

export type MosaicPreviewCapability = {
  "name": MosaicPreviewCapabilityName;
  "version": "0.1";
};

export type MosaicPreviewLimits = {
  "maxDocumentBytes": number;
};

export type MosaicPreviewContext = {
  "locale": MosaicPreviewLocaleTag;
  "textScale": number;
};

export type MosaicPreviewDiagnosticLocation = {
  "documentPath": MosaicPreviewJsonPointer;
  "componentId"?: MosaicPreviewComponentId;
  "property"?: string;
};

export type MosaicPreviewRecoveryAction = {
  "action": "editProperty" | "removeComponent" | "bindProduct" | "selectSupportedTemplate" | "updatePreviewClient" | "restoreLastValidDraft" | "retry" | "reconnect" | "inspectComponent";
  "message": MosaicPreviewSafeText;
};

export type MosaicPreviewValidationDiagnostic = {
  "code": MosaicPreviewDiagnosticCode;
  "message": MosaicPreviewSafeText;
  "location": MosaicPreviewDiagnosticLocation;
  "recovery": MosaicPreviewRecoveryAction;
};

export type MosaicPreviewCompatibilityWarning = {
  "code": MosaicPreviewDiagnosticCode;
  "severity": "warning" | "blocking";
  "message": MosaicPreviewSafeText;
  "location"?: MosaicPreviewDiagnosticLocation;
  "capability"?: MosaicPreviewSupportedCapability;
  "fallback": "keepLastAcceptedDraft" | "useDeclaredAssetFallback" | "useSelectorFallback" | "nativeApproximation";
  "recovery": MosaicPreviewRecoveryAction;
};

export type MosaicPreviewRenderDiagnostic = {
  "code": MosaicPreviewDiagnosticCode;
  "message": MosaicPreviewSafeText;
  "location"?: MosaicPreviewDiagnosticLocation;
  "fallback": "keepLastAcceptedDraft";
  "recovery": MosaicPreviewRecoveryAction;
};

export type MosaicPreviewPeriod = {
  "unit": "day" | "week" | "month" | "year";
  "value": number;
};

export type MosaicPreviewIntroductoryOffer = {
  "localizedPrice": MosaicPreviewSafeDisplayName;
  "period": MosaicPreviewPeriod;
  "cycles": number;
};

export type MosaicPreviewAvailableSubscriptionProduct = {
  "productReferenceId": MosaicPreviewComponentId;
  "availability": "available";
  "kind": "subscription";
  "localizedPrice": MosaicPreviewSafeDisplayName;
  "currencyCode": string;
  "billingPeriod": MosaicPreviewPeriod;
  "trialPeriod"?: MosaicPreviewPeriod;
  "introductoryOffer"?: MosaicPreviewIntroductoryOffer;
};

export type MosaicPreviewAvailableNonConsumableProduct = {
  "productReferenceId": MosaicPreviewComponentId;
  "availability": "available";
  "kind": "nonConsumable";
  "localizedPrice": MosaicPreviewSafeDisplayName;
  "currencyCode": string;
};

export type MosaicPreviewUnavailableMockProduct = {
  "productReferenceId": MosaicPreviewComponentId;
  "availability": "unavailable";
  "reason": "notConfigured" | "temporarilyUnavailable" | "unsupported";
};

export type MosaicPreviewMockProduct = MosaicPreviewAvailableSubscriptionProduct | MosaicPreviewAvailableNonConsumableProduct | MosaicPreviewUnavailableMockProduct;

export type MosaicPreviewNoEntitlement = {
  "status": "none";
};

export type MosaicPreviewActiveEntitlement = {
  "status": "active";
  "productReferenceId": MosaicPreviewComponentId;
};

export type MosaicPreviewMockEntitlement = MosaicPreviewNoEntitlement | MosaicPreviewActiveEntitlement;

export type MosaicPreviewMockCommerceState = {
  "products": Array<MosaicPreviewMockProduct>;
  "purchaseOutcome": "purchased" | "alreadyEntitled" | "cancelled" | "purchaseFailed";
  "restoreOutcome": "restored" | "alreadyEntitled" | "restoreNoPurchases" | "restoreFailed";
  "entitlement": MosaicPreviewMockEntitlement;
};

export type MosaicPreviewRevisionTarget = {
  "clientId": MosaicPreviewClientId;
  "editableDocumentId": MosaicPreviewEditableDocumentId;
  "revision": MosaicPreviewLocalRevision;
};

export type MosaicPreviewClientConnectedPayload = {
  "client": MosaicPreviewClientIdentity;
};

export type MosaicPreviewClientDisconnectedPayload = {
  "clientId": MosaicPreviewClientId;
  "reason": "closed" | "timeout" | "transportError" | "replaced" | "sessionEnded";
  "diagnostic"?: MosaicPreviewSafeText;
};

export type MosaicPreviewCapabilityReportPayload = {
  "clientId": MosaicPreviewClientId;
  "supportedSchemaVersions": Array<MosaicPreviewSemanticVersion>;
  "supportedCapabilities": Array<MosaicPreviewSupportedCapability>;
  "previewCapabilities": Array<MosaicPreviewCapability>;
  "limits": MosaicPreviewLimits;
};

export type MosaicPreviewDraftUpdatedPayload = {
  "editableDocumentId": MosaicPreviewEditableDocumentId;
  "revision": MosaicPreviewLocalRevision;
  "document": MosaicPaywallDocument;
  "preview": MosaicPreviewContext;
};

export type MosaicPreviewDraftAcceptedPayload = {
  "clientId": MosaicPreviewClientId;
  "editableDocumentId": MosaicPreviewEditableDocumentId;
  "revision": MosaicPreviewLocalRevision;
};

export type MosaicPreviewDraftRejectedPayload = {
  "clientId": MosaicPreviewClientId;
  "editableDocumentId": MosaicPreviewEditableDocumentId;
  "revision": MosaicPreviewLocalRevision;
  "reason": "staleRevision" | "revisionConflict" | "validationFailed" | "unsupportedSchemaVersion" | "unsupportedCapability" | "documentTooLarge" | "renderFailed";
  "diagnostics": Array<MosaicPreviewValidationDiagnostic>;
};

export type MosaicPreviewValidationErrorPayload = {
  "clientId": MosaicPreviewClientId;
  "editableDocumentId": MosaicPreviewEditableDocumentId;
  "revision": MosaicPreviewLocalRevision;
  "errors": Array<MosaicPreviewValidationDiagnostic>;
};

export type MosaicPreviewRenderWarningPayload = {
  "clientId": MosaicPreviewClientId;
  "editableDocumentId": MosaicPreviewEditableDocumentId;
  "revision": MosaicPreviewLocalRevision;
  "warnings": Array<MosaicPreviewCompatibilityWarning>;
};

export type MosaicPreviewRenderFailurePayload = {
  "clientId": MosaicPreviewClientId;
  "editableDocumentId": MosaicPreviewEditableDocumentId;
  "revision": MosaicPreviewLocalRevision;
  "failure": MosaicPreviewRenderDiagnostic;
};

export type MosaicPreviewMockCommerceStateChangedPayload = {
  "editableDocumentId": MosaicPreviewEditableDocumentId;
  "stateRevision": MosaicPreviewLocalRevision;
  "state": MosaicPreviewMockCommerceState;
};

export type MosaicPreviewHeartbeatPayload = {
  "clientId": MosaicPreviewClientId;
  "kind": "ping" | "pong";
  "sequence": number;
};

export type MosaicPreviewMessageType = "previewClientConnected" | "previewClientDisconnected" | "capabilityReport" | "draftUpdated" | "draftAccepted" | "draftRejected" | "validationError" | "renderWarning" | "renderFailure" | "mockCommerceStateChanged" | "previewHeartbeat";

export type MosaicPreviewEnvelope<
  TType extends MosaicPreviewMessageType,
  TPayload,
> = {
  "previewProtocolVersion": "0.1";
  "messageId": MosaicPreviewMessageId;
  "sessionId": MosaicPreviewSessionId;
  "sentAt": MosaicPreviewUtcTimestamp;
} & {
  "type": TType;
  "payload": TPayload;
};

export type MosaicPreviewMessage =
  | MosaicPreviewEnvelope<"previewClientConnected", MosaicPreviewClientConnectedPayload>
  | MosaicPreviewEnvelope<"previewClientDisconnected", MosaicPreviewClientDisconnectedPayload>
  | MosaicPreviewEnvelope<"capabilityReport", MosaicPreviewCapabilityReportPayload>
  | MosaicPreviewEnvelope<"draftUpdated", MosaicPreviewDraftUpdatedPayload>
  | MosaicPreviewEnvelope<"draftAccepted", MosaicPreviewDraftAcceptedPayload>
  | MosaicPreviewEnvelope<"draftRejected", MosaicPreviewDraftRejectedPayload>
  | MosaicPreviewEnvelope<"validationError", MosaicPreviewValidationErrorPayload>
  | MosaicPreviewEnvelope<"renderWarning", MosaicPreviewRenderWarningPayload>
  | MosaicPreviewEnvelope<"renderFailure", MosaicPreviewRenderFailurePayload>
  | MosaicPreviewEnvelope<"mockCommerceStateChanged", MosaicPreviewMockCommerceStateChangedPayload>
  | MosaicPreviewEnvelope<"previewHeartbeat", MosaicPreviewHeartbeatPayload>;

export type MosaicLocalProject = {
  "fileFormatVersion": "0.1";
  "editableDocumentId": MosaicPreviewEditableDocumentId;
  "revision": MosaicPreviewLocalRevision;
  "document": MosaicPaywallDocument;
  "preview": MosaicPreviewContext;
  "mockCommerce": {
    "revision": MosaicPreviewLocalRevision;
    "state": MosaicPreviewMockCommerceState;
  };
};

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

export type MosaicPaywallV02CapabilityName = "layout.scrollContainer" | "layout.stack" | "layout.sizing" | "layout.outerInsets" | "component.text" | "component.image" | "component.featureList" | "component.productSelector" | "component.purchaseButton" | "component.restoreButton" | "component.closeButton" | "component.legalText" | "component.carousel" | "component.switch" | "component.countdown" | "localization.catalogs" | "localization.rtl" | "product.references" | "asset.bundledImage" | "action.purchase" | "action.restore" | "action.close" | "accessibility.metadata" | "fallback.asset" | "fallback.product" | "outcome.normalized" | "style.colors" | "style.box" | "style.clipping" | "style.typography" | "style.productCardStates" | "visibility.static" | "condition.switchVisibility";

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

export type MosaicPaywallV02Color = MosaicPaywallV02SemanticColor | MosaicPaywallV02LiteralColor;

export type MosaicPaywallV02WidthSizingValue = "content" | "fill" | {
  "mode": "fixed";
  "value": MosaicPaywallV02PositiveLogicalSize;
};

export type MosaicPaywallV02SafeHeightSizingValue = "content" | {
  "mode": "fixed";
  "value": MosaicPaywallV02PositiveLogicalSize;
};

export type MosaicPaywallV02WidthOnlySizing = {
  "width"?: MosaicPaywallV02WidthSizingValue;
};

export type MosaicPaywallV02SafeBoxSizing = {
  "width"?: MosaicPaywallV02WidthSizingValue;
  "height"?: MosaicPaywallV02SafeHeightSizingValue;
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
  "background"?: MosaicPaywallV02Color;
  "border"?: MosaicPaywallV02Border;
  "cornerRadius"?: MosaicPaywallV02LogicalSize;
  "opacity"?: number;
  "padding"?: MosaicPaywallV02EdgeInsets;
};

export type MosaicPaywallV02ContainerAppearance = {
  "background"?: MosaicPaywallV02Color;
  "border"?: MosaicPaywallV02Border;
  "cornerRadius"?: MosaicPaywallV02LogicalSize;
  "opacity"?: number;
  "clipContent"?: boolean;
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

export type MosaicPaywallV02LegalTextAccessibility = {
  "role": "text";
  "label"?: MosaicPaywallV02LocalizedText;
};

export type MosaicPaywallV02ImageAccessibility = {
  "hidden": true;
} | {
  "hidden": false;
  "label": MosaicPaywallV02LocalizedText;
};

export type MosaicPaywallV02BundledImageSource = {
  "type": "bundled";
  "key": string;
};

export type MosaicPaywallV02ImageAssetFallback = {
  "type": "placeholder";
  "value": MosaicPaywallV02LocalizedText;
};

export type MosaicPaywallV02ImageAsset = {
  "type": "image";
  "id": MosaicPaywallV02Identifier;
  "source": MosaicPaywallV02BundledImageSource;
  "fallback": MosaicPaywallV02ImageAssetFallback;
};

export type MosaicPaywallV02ProductReference = {
  "id": MosaicPaywallV02Identifier;
  "productId": string;
  "label": MosaicPaywallV02LocalizedText;
  "badge"?: MosaicPaywallV02LocalizedText;
};

export type MosaicPaywallV02ScrollContainer = {
  "type": "scrollContainer";
  "id": MosaicPaywallV02Identifier;
  "axis": "vertical";
  "safeArea": "respect";
  "showsIndicators": boolean;
  "background"?: MosaicPaywallV02Color;
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
  "sizing"?: MosaicPaywallV02SafeBoxSizing;
  "outerInsets"?: MosaicPaywallV02EdgeInsets;
  "visibility"?: MosaicPaywallV02Visibility;
  "children": Array<MosaicPaywallV02Node>;
};

export type MosaicPaywallV02Node = MosaicPaywallV02Stack | MosaicPaywallV02TextComponent | MosaicPaywallV02ImageComponent | MosaicPaywallV02FeatureListComponent | MosaicPaywallV02ProductSelectorComponent | MosaicPaywallV02PurchaseButtonComponent | MosaicPaywallV02RestoreButtonComponent | MosaicPaywallV02CloseButtonComponent | MosaicPaywallV02LegalTextComponent | MosaicPaywallV02CarouselComponent | MosaicPaywallV02SwitchComponent | MosaicPaywallV02CountdownComponent;

export type MosaicPaywallV02TextComponent = {
  "type": "text";
  "id": MosaicPaywallV02Identifier;
  "value": MosaicPaywallV02LocalizedText;
  "typography": MosaicPaywallV02Typography;
  "appearance"?: MosaicPaywallV02BoxAppearance;
  "sizing"?: MosaicPaywallV02WidthOnlySizing;
  "outerInsets"?: MosaicPaywallV02EdgeInsets;
  "visibility"?: MosaicPaywallV02Visibility;
  "accessibility": MosaicPaywallV02TextAccessibility;
};

export type MosaicPaywallV02ImageComponent = {
  "type": "image";
  "id": MosaicPaywallV02Identifier;
  "assetId": MosaicPaywallV02Identifier;
  "width": MosaicPaywallV02WidthSizingValue;
  "aspectRatio"?: number;
  "height"?: MosaicPaywallV02PositiveLogicalSize;
  "contentMode": "fit" | "fill";
  "appearance"?: MosaicPaywallV02BoxAppearance;
  "outerInsets"?: MosaicPaywallV02EdgeInsets;
  "visibility"?: MosaicPaywallV02Visibility;
  "accessibility": MosaicPaywallV02ImageAccessibility;
} & ({
  "aspectRatio": unknown;
  "height"?: never;
} | {
  "aspectRatio"?: never;
  "height": unknown;
});

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
  "sizing"?: MosaicPaywallV02WidthOnlySizing;
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
  "background": MosaicPaywallV02Color;
  "border": MosaicPaywallV02Border;
  "cornerRadius": MosaicPaywallV02LogicalSize;
  "padding": MosaicPaywallV02EdgeInsets;
  "contentGap": MosaicPaywallV02LogicalSize;
  "contentAlignment": "start" | "center" | "end" | "spaceBetween";
  "productLabelColor": MosaicPaywallV02Color;
  "runtimePriceColor": MosaicPaywallV02Color;
  "badge": MosaicPaywallV02ProductCardBadgeDefaultStyle;
};

export type MosaicPaywallV02ProductCardBadgeDefaultStyle = {
  "background": MosaicPaywallV02Color;
  "textColor": MosaicPaywallV02Color;
  "border": MosaicPaywallV02Border;
  "cornerRadius": MosaicPaywallV02LogicalSize;
  "padding": MosaicPaywallV02EdgeInsets;
};

export type MosaicPaywallV02EdgeInsetsOverride = {
  "top"?: MosaicPaywallV02LogicalSize;
  "start"?: MosaicPaywallV02LogicalSize;
  "bottom"?: MosaicPaywallV02LogicalSize;
  "end"?: MosaicPaywallV02LogicalSize;
};

export type MosaicPaywallV02ProductCardBadgeSelectedStyle = {
  "background"?: MosaicPaywallV02Color;
  "textColor"?: MosaicPaywallV02Color;
  "border"?: MosaicPaywallV02BorderOverride;
  "cornerRadius"?: MosaicPaywallV02LogicalSize;
  "padding"?: MosaicPaywallV02EdgeInsetsOverride;
};

export type MosaicPaywallV02ProductCardSelectedStyle = {
  "background"?: MosaicPaywallV02Color;
  "border"?: MosaicPaywallV02BorderOverride;
  "cornerRadius"?: MosaicPaywallV02LogicalSize;
  "padding"?: MosaicPaywallV02EdgeInsetsOverride;
  "contentGap"?: MosaicPaywallV02LogicalSize;
  "contentAlignment"?: "start" | "center" | "end" | "spaceBetween";
  "productLabelColor"?: MosaicPaywallV02Color;
  "runtimePriceColor"?: MosaicPaywallV02Color;
  "badge"?: MosaicPaywallV02ProductCardBadgeSelectedStyle;
};

export type MosaicPaywallV02ProductCardStyles = {
  "default": MosaicPaywallV02ProductCardDefaultStyle;
  "selected": MosaicPaywallV02ProductCardSelectedStyle;
};

export type MosaicPaywallV02ProductSelectorComponent = {
  "type": "productSelector";
  "id": MosaicPaywallV02Identifier;
  "productReferenceIds": Array<MosaicPaywallV02Identifier>;
  "initiallySelectedProductReferenceId": MosaicPaywallV02Identifier;
  "direction": "vertical" | "horizontal";
  "gap": MosaicPaywallV02LogicalSize;
  "cardStyles": MosaicPaywallV02ProductCardStyles;
  "appearance"?: MosaicPaywallV02BoxAppearance;
  "sizing"?: MosaicPaywallV02WidthOnlySizing;
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

export type MosaicPaywallV02PurchaseButtonComponent = {
  "type": "purchaseButton";
  "id": MosaicPaywallV02Identifier;
  "label": MosaicPaywallV02LocalizedText;
  "inProgressLabel": MosaicPaywallV02LocalizedText;
  "typography": MosaicPaywallV02BaseTypography;
  "appearance"?: MosaicPaywallV02BoxAppearance;
  "sizing"?: MosaicPaywallV02WidthOnlySizing;
  "outerInsets"?: MosaicPaywallV02EdgeInsets;
  "visibility"?: MosaicPaywallV02Visibility;
  "action": MosaicPaywallV02PurchaseAction;
  "accessibility": MosaicPaywallV02ControlAccessibility;
};

export type MosaicPaywallV02RestoreButtonComponent = {
  "type": "restoreButton";
  "id": MosaicPaywallV02Identifier;
  "label": MosaicPaywallV02LocalizedText;
  "inProgressLabel": MosaicPaywallV02LocalizedText;
  "typography": MosaicPaywallV02BaseTypography;
  "appearance"?: MosaicPaywallV02BoxAppearance;
  "sizing"?: MosaicPaywallV02WidthOnlySizing;
  "outerInsets"?: MosaicPaywallV02EdgeInsets;
  "visibility"?: MosaicPaywallV02Visibility;
  "action": MosaicPaywallV02RestoreAction;
  "accessibility": MosaicPaywallV02ControlAccessibility;
};

export type MosaicPaywallV02CloseButtonComponent = {
  "type": "closeButton";
  "id": MosaicPaywallV02Identifier;
  "label": MosaicPaywallV02LocalizedText;
  "typography": MosaicPaywallV02BaseTypography;
  "appearance"?: MosaicPaywallV02BoxAppearance;
  "sizing"?: MosaicPaywallV02WidthOnlySizing;
  "outerInsets"?: MosaicPaywallV02EdgeInsets;
  "visibility"?: MosaicPaywallV02Visibility;
  "action": MosaicPaywallV02CloseAction;
  "accessibility": MosaicPaywallV02ControlAccessibility;
};

export type MosaicPaywallV02LegalTextComponent = {
  "type": "legalText";
  "id": MosaicPaywallV02Identifier;
  "value": MosaicPaywallV02LocalizedText;
  "typography": MosaicPaywallV02BaseTypography;
  "appearance"?: MosaicPaywallV02BoxAppearance;
  "sizing"?: MosaicPaywallV02WidthOnlySizing;
  "outerInsets"?: MosaicPaywallV02EdgeInsets;
  "visibility"?: MosaicPaywallV02Visibility;
  "accessibility": MosaicPaywallV02LegalTextAccessibility;
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
  "sizing"?: MosaicPaywallV02WidthOnlySizing;
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
  "sizing"?: MosaicPaywallV02WidthOnlySizing;
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
  "assets": Array<MosaicPaywallV02ImageAsset>;
  "products": Array<MosaicPaywallV02ProductReference>;
  "layout": MosaicPaywallV02ScrollContainer;
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

export type MosaicPreviewV02IncompatibleClientDecision = {
  "studioSupportedPreviewVersions": Array<"0.1" | "0.2">;
  "clientSupportedPreviewVersions": Array<"0.1" | "0.2">;
  "selectedPreviewVersion": "0.1";
  "selectedWebSocketSubprotocol": "mosaic.local-preview.v0.1";
  "draftSchemaVersion": "0.2";
  "delivery": "withhold";
  "diagnostic": {
    "code": "preview.incompatibleSchemaVersion";
    "message": string;
    "fallback": "keepLastAcceptedDraft";
    "recovery": {
      "action": "updatePreviewClient";
      "message": string;
    };
  };
};
