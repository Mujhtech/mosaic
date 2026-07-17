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
