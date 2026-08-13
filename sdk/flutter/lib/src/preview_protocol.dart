import 'dart:convert';

import 'protocol.dart';

part 'preview_message_codec.dart';
part 'preview_protocol_support.dart';

const String mosaicLocalPreviewProtocolVersion = '0.4';
const int mosaicFlutterPreviewMaximumDocumentBytes = 1048576;

const Set<String> mosaicFlutterPreviewCapabilities = <String>{
  'preview.liveUpdate',
  'preview.mockCommerce',
  'preview.localeOverride',
  'preview.textScale',
  'preview.diagnostics',
};

final RegExp _messageIdPattern = RegExp(r'^msg_[A-Za-z0-9][A-Za-z0-9_-]*$');
final RegExp _sessionIdPattern = RegExp(r'^session_[A-Za-z0-9][A-Za-z0-9_-]*$');
final RegExp _clientIdPattern = RegExp(r'^client_[A-Za-z0-9][A-Za-z0-9_-]*$');
final RegExp _documentIdPattern =
    RegExp(r'^document_[A-Za-z0-9][A-Za-z0-9_-]*$');
final RegExp _revisionIdPattern =
    RegExp(r'^revision_[A-Za-z0-9][A-Za-z0-9_-]*$');
final RegExp _machineIdentifierPattern =
    RegExp(r'^[A-Za-z0-9][A-Za-z0-9._:-]*$');
final RegExp _semanticVersionPattern = RegExp(
  r'^[0-9]+\.[0-9]+(?:\.[0-9]+)?(?:[-+][A-Za-z0-9.-]+)?$',
);
final RegExp _localePattern =
    RegExp(r'^[a-z]{2,3}(?:-(?:[A-Z]{2}|[0-9]{3}))?$');

final class MosaicPreviewSoftwareIdentity {
  MosaicPreviewSoftwareIdentity({required String id, required String version})
      : id = _validatedString(
          id,
          name: 'renderer.id',
          minimumLength: 1,
          maximumLength: 128,
          pattern: _machineIdentifierPattern,
        ),
        version = _validatedString(
          version,
          name: 'renderer.version',
          minimumLength: 1,
          maximumLength: 64,
          pattern: _semanticVersionPattern,
        );

  final String id;
  final String version;

  Map<String, Object?> toJson() => <String, Object?>{
        'id': id,
        'version': version,
      };
}

final class MosaicPreviewApplicationIdentity {
  MosaicPreviewApplicationIdentity({
    required String id,
    required String displayName,
    required String version,
  })  : id = _validatedString(
          id,
          name: 'application.id',
          minimumLength: 1,
          maximumLength: 128,
          pattern: _machineIdentifierPattern,
        ),
        displayName = _safeDisplayName(displayName, 'application.displayName'),
        version = _safeString(version, 'application.version', 64);

  final String id;
  final String displayName;
  final String version;

  Map<String, Object?> toJson() => <String, Object?>{
        'id': id,
        'displayName': displayName,
        'version': version,
      };
}

final class MosaicPreviewDeviceIdentity {
  MosaicPreviewDeviceIdentity({
    required String displayName,
    required String systemName,
    required String systemVersion,
  })  : displayName = _safeDisplayName(displayName, 'device.displayName'),
        systemName = _safeDisplayName(systemName, 'device.systemName'),
        systemVersion = _safeString(
          systemVersion,
          'device.systemVersion',
          64,
        );

  final String displayName;
  final String systemName;
  final String systemVersion;

  Map<String, Object?> toJson() => <String, Object?>{
        'displayName': displayName,
        'systemName': systemName,
        'systemVersion': systemVersion,
      };
}

final class MosaicPreviewClientIdentity {
  MosaicPreviewClientIdentity({
    required String clientId,
    required String displayName,
    required this.renderer,
    required this.application,
    required this.device,
  })  : clientId = _validatedString(
          clientId,
          name: 'clientId',
          minimumLength: 8,
          maximumLength: 100,
          pattern: _clientIdPattern,
        ),
        displayName = _safeDisplayName(displayName, 'displayName');

  final String clientId;
  final String displayName;
  final MosaicPreviewSoftwareIdentity renderer;
  final MosaicPreviewApplicationIdentity application;
  final MosaicPreviewDeviceIdentity device;

  Map<String, Object?> toJson() => <String, Object?>{
        'clientId': clientId,
        'displayName': displayName,
        'renderer': renderer.toJson(),
        'application': application.toJson(),
        'device': device.toJson(),
      };
}

final class MosaicLocalRevision {
  MosaicLocalRevision({required String revisionId, required this.sequence})
      : revisionId = _validatedString(
          revisionId,
          name: 'revisionId',
          minimumLength: 10,
          maximumLength: 100,
          pattern: _revisionIdPattern,
        ) {
    if (sequence < 1 || sequence > 2147483647) {
      throw RangeError.range(sequence, 1, 2147483647, 'sequence');
    }
  }

  final String revisionId;
  final int sequence;

  Map<String, Object?> toJson() => <String, Object?>{
        'revisionId': revisionId,
        'sequence': sequence,
      };

  @override
  bool operator ==(Object other) =>
      other is MosaicLocalRevision &&
      revisionId == other.revisionId &&
      sequence == other.sequence;

  @override
  int get hashCode => Object.hash(revisionId, sequence);
}

final class MosaicPreviewContext {
  MosaicPreviewContext({required String locale, required this.textScale})
      : locale = _validatedString(
          locale,
          name: 'locale',
          minimumLength: 2,
          maximumLength: 10,
          pattern: _localePattern,
        ) {
    if (!textScale.isFinite || textScale < 0.5 || textScale > 3) {
      throw ArgumentError.value(
        textScale,
        'textScale',
        'Must be finite and between 0.5 and 3.',
      );
    }
  }

  final String locale;
  final double textScale;

  Map<String, Object?> toJson() => <String, Object?>{
        'locale': locale,
        'textScale': textScale,
      };
}

enum MosaicPreviewPeriodUnit { day, week, month, year }

final class MosaicPreviewPeriod {
  const MosaicPreviewPeriod({required this.unit, required this.value});

  final MosaicPreviewPeriodUnit unit;
  final int value;

  String get displayValue => value == 1 ? unit.name : '${unit.name}s';
}

final class MosaicPreviewIntroductoryOffer {
  const MosaicPreviewIntroductoryOffer({
    required this.localizedPrice,
    required this.period,
    required this.cycles,
  });

  final String localizedPrice;
  final MosaicPreviewPeriod period;
  final int cycles;
}

sealed class MosaicPreviewMockProduct {
  const MosaicPreviewMockProduct({required this.productReferenceId});

  final String productReferenceId;

  bool get isAvailable;
}

final class MosaicPreviewSubscriptionProduct extends MosaicPreviewMockProduct {
  const MosaicPreviewSubscriptionProduct({
    required super.productReferenceId,
    required this.localizedPrice,
    required this.currencyCode,
    required this.billingPeriod,
    this.trialPeriod,
    this.introductoryOffer,
  });

  final String localizedPrice;
  final String currencyCode;
  final MosaicPreviewPeriod billingPeriod;
  final MosaicPreviewPeriod? trialPeriod;
  final MosaicPreviewIntroductoryOffer? introductoryOffer;

  @override
  bool get isAvailable => true;
}

final class MosaicPreviewNonConsumableProduct extends MosaicPreviewMockProduct {
  const MosaicPreviewNonConsumableProduct({
    required super.productReferenceId,
    required this.localizedPrice,
    required this.currencyCode,
  });

  final String localizedPrice;
  final String currencyCode;

  @override
  bool get isAvailable => true;
}

enum MosaicPreviewUnavailableReason {
  notConfigured,
  temporarilyUnavailable,
  unsupported,
}

final class MosaicPreviewUnavailableProduct extends MosaicPreviewMockProduct {
  const MosaicPreviewUnavailableProduct({
    required super.productReferenceId,
    required this.reason,
  });

  final MosaicPreviewUnavailableReason reason;

  @override
  bool get isAvailable => false;
}

enum MosaicPreviewPurchaseOutcome {
  purchased,
  alreadyEntitled,
  cancelled,
  purchaseFailed,
}

enum MosaicPreviewRestoreOutcome {
  restored,
  alreadyEntitled,
  restoreNoPurchases,
  restoreFailed,
}

final class MosaicPreviewMockEntitlement {
  const MosaicPreviewMockEntitlement.none() : productReferenceId = null;

  const MosaicPreviewMockEntitlement.active(this.productReferenceId);

  final String? productReferenceId;

  bool get isActive => productReferenceId != null;
}

final class MosaicPreviewMockCommerceState {
  MosaicPreviewMockCommerceState({
    required Iterable<MosaicPreviewMockProduct> products,
    required this.purchaseOutcome,
    required this.restoreOutcome,
    required this.entitlement,
  }) : products = List.unmodifiable(products);

  final List<MosaicPreviewMockProduct> products;
  final MosaicPreviewPurchaseOutcome purchaseOutcome;
  final MosaicPreviewRestoreOutcome restoreOutcome;
  final MosaicPreviewMockEntitlement entitlement;
}

final class MosaicPreviewDiagnosticLocation {
  const MosaicPreviewDiagnosticLocation({
    required this.documentPath,
    this.componentId,
    this.property,
  });

  final String documentPath;
  final String? componentId;
  final String? property;

  Map<String, Object?> toJson() => <String, Object?>{
        'documentPath': documentPath,
        if (componentId != null) 'componentId': componentId,
        if (property != null) 'property': property,
      };
}

enum MosaicPreviewRecoveryAction {
  editProperty,
  removeComponent,
  bindProduct,
  selectSupportedTemplate,
  updatePreviewClient,
  restoreLastValidDraft,
  retry,
  reconnect,
  inspectComponent,
}

final class MosaicPreviewRecovery {
  const MosaicPreviewRecovery({required this.action, required this.message});

  final MosaicPreviewRecoveryAction action;
  final String message;

  Map<String, Object?> toJson() => <String, Object?>{
        'action': action.name,
        'message': message,
      };
}

final class MosaicPreviewValidationDiagnostic {
  const MosaicPreviewValidationDiagnostic({
    required this.code,
    required this.message,
    required this.location,
    required this.recovery,
  });

  final String code;
  final String message;
  final MosaicPreviewDiagnosticLocation location;
  final MosaicPreviewRecovery recovery;

  Map<String, Object?> toJson() => <String, Object?>{
        'code': code,
        'message': message,
        'location': location.toJson(),
        'recovery': recovery.toJson(),
      };
}

enum MosaicPreviewCompatibilitySeverity { warning, blocking }

enum MosaicPreviewCompatibilityFallback {
  keepLastAcceptedDraft,
  useDeclaredAssetFallback,
  useSelectorFallback,
  nativeApproximation,
}

final class MosaicPreviewCompatibilityWarning {
  const MosaicPreviewCompatibilityWarning({
    required this.code,
    required this.severity,
    required this.message,
    required this.fallback,
    required this.recovery,
    this.location,
    this.capabilityName,
    this.capabilityVersion,
  });

  final String code;
  final MosaicPreviewCompatibilitySeverity severity;
  final String message;
  final MosaicPreviewDiagnosticLocation? location;
  final String? capabilityName;
  final String? capabilityVersion;
  final MosaicPreviewCompatibilityFallback fallback;
  final MosaicPreviewRecovery recovery;

  Map<String, Object?> toJson() => <String, Object?>{
        'code': code,
        'severity': severity.name,
        'message': message,
        if (location != null) 'location': location!.toJson(),
        if (capabilityName != null && capabilityVersion != null)
          'capability': <String, Object?>{
            'name': capabilityName,
            'version': capabilityVersion,
          },
        'fallback': fallback.name,
        'recovery': recovery.toJson(),
      };
}

final class MosaicPreviewRenderDiagnostic {
  const MosaicPreviewRenderDiagnostic({
    required this.code,
    required this.message,
    required this.recovery,
    this.location,
  });

  final String code;
  final String message;
  final MosaicPreviewDiagnosticLocation? location;
  final MosaicPreviewRecovery recovery;

  Map<String, Object?> toJson() => <String, Object?>{
        'code': code,
        'message': message,
        if (location != null) 'location': location!.toJson(),
        'fallback': 'keepLastAcceptedDraft',
        'recovery': recovery.toJson(),
      };
}

sealed class MosaicPreviewIncomingMessage {
  const MosaicPreviewIncomingMessage();
}

final class MosaicPreviewDecodedMessage {
  const MosaicPreviewDecodedMessage({
    required this.protocolVersion,
    required this.messageId,
    required this.sentAt,
    required this.message,
  });

  final String protocolVersion;
  final String messageId;

  /// Raw timestamp accepted by the normative Local Preview timestamp regex.
  final String sentAt;
  final MosaicPreviewIncomingMessage message;
}

/// A fully validated, local-only Studio project snapshot.
final class MosaicLocalPreviewProject {
  const MosaicLocalPreviewProject({
    required this.fileFormatVersion,
    required this.editableDocumentId,
    required this.revision,
    required this.document,
    required this.preview,
    required this.commerceRevision,
    required this.commerceState,
  });

  final String fileFormatVersion;
  final String editableDocumentId;
  final MosaicLocalRevision revision;
  final MosaicPaywallDocument document;
  final MosaicPreviewContext preview;
  final MosaicLocalRevision commerceRevision;
  final MosaicPreviewMockCommerceState commerceState;
}

final class MosaicPreviewDraftUpdated extends MosaicPreviewIncomingMessage {
  const MosaicPreviewDraftUpdated({
    required this.editableDocumentId,
    required this.revision,
    required this.document,
    required this.preview,
  });

  final String editableDocumentId;
  final MosaicLocalRevision revision;
  final Map<String, Object?> document;
  final MosaicPreviewContext preview;
}

final class MosaicPreviewCommerceStateChanged
    extends MosaicPreviewIncomingMessage {
  const MosaicPreviewCommerceStateChanged({
    required this.editableDocumentId,
    required this.stateRevision,
    required this.state,
  });

  final String editableDocumentId;
  final MosaicLocalRevision stateRevision;
  final MosaicPreviewMockCommerceState state;
}

enum MosaicPreviewHeartbeatKind { ping, pong }

final class MosaicPreviewHeartbeat extends MosaicPreviewIncomingMessage {
  const MosaicPreviewHeartbeat({
    required this.clientId,
    required this.kind,
    required this.sequence,
  });

  final String clientId;
  final MosaicPreviewHeartbeatKind kind;
  final int sequence;
}

final class MosaicPreviewRemoteDisconnected
    extends MosaicPreviewIncomingMessage {
  const MosaicPreviewRemoteDisconnected({
    required this.clientId,
    required this.reason,
  });

  final String clientId;
  final String reason;
}

final class MosaicPreviewNoopMessage extends MosaicPreviewIncomingMessage {
  const MosaicPreviewNoopMessage({required this.type});

  final String type;
}

final class MosaicPreviewProtocolException implements Exception {
  const MosaicPreviewProtocolException(this.message);

  final String message;

  @override
  String toString() => 'MosaicPreviewProtocolException: $message';
}

/// Single adapter between the canonical local-preview JSON contract and Dart.

final class MosaicLocalPreviewNegotiation {
  const MosaicLocalPreviewNegotiation._({
    required this.isCompatible,
    this.selectedVersion,
    this.selectedWebSocketSubprotocol,
    this.diagnosticCode,
  });

  const MosaicLocalPreviewNegotiation.selected({
    required String version,
    required String webSocketSubprotocol,
  }) : this._(
          isCompatible: true,
          selectedVersion: version,
          selectedWebSocketSubprotocol: webSocketSubprotocol,
        );

  const MosaicLocalPreviewNegotiation.incompatible()
      : this._(
          isCompatible: false,
          diagnosticCode: 'preview.noMutualVersion',
        );

  final bool isCompatible;
  final String? selectedVersion;
  final String? selectedWebSocketSubprotocol;
  final String? diagnosticCode;
}

MosaicLocalPreviewNegotiation negotiateMosaicLocalPreviewVersion(
  Iterable<String> localSupportedVersions,
  Iterable<String> remoteSupportedVersions,
) {
  final local = localSupportedVersions.toSet();
  final remote = remoteSupportedVersions.toSet();
  for (final version in mosaicLocalPreviewVersionPreference) {
    if (local.contains(version) && remote.contains(version)) {
      return MosaicLocalPreviewNegotiation.selected(
        version: version,
        webSocketSubprotocol: 'mosaic.local-preview.v$version',
      );
    }
  }
  return const MosaicLocalPreviewNegotiation.incompatible();
}

sealed class MosaicPreviewDraftDeliveryDecision {
  const MosaicPreviewDraftDeliveryDecision();
}

final class MosaicPreviewDraftSend extends MosaicPreviewDraftDeliveryDecision {
  const MosaicPreviewDraftSend();
}

final class MosaicPreviewDraftWithhold
    extends MosaicPreviewDraftDeliveryDecision {
  const MosaicPreviewDraftWithhold({
    required this.code,
    required this.message,
    required this.recoveryAction,
    required this.recoveryMessage,
  });

  final String code;
  final String message;
  final String recoveryAction;
  final String recoveryMessage;
  String get fallback => 'keepLastAcceptedDraft';
}

/// Applies the exact Local Preview 0.4 schema, capability, and compact UTF-8
/// byte gate before a draft is sent. Malformed reports withhold safely.
MosaicPreviewDraftDeliveryDecision decideMosaicPreviewDraftDelivery({
  required MosaicLocalPreviewNegotiation negotiation,
  required Map<String, Object?> capabilityReport,
  required Map<String, Object?> document,
}) {
  MosaicPreviewDraftWithhold withhold(
    String code,
    String message,
    String recoveryMessage, {
    String action = 'updatePreviewClient',
  }) =>
      MosaicPreviewDraftWithhold(
        code: code,
        message: message,
        recoveryAction: action,
        recoveryMessage: recoveryMessage,
      );

  if (!negotiation.isCompatible || negotiation.selectedVersion == null) {
    return withhold(
      'preview.noMutualVersion',
      'Studio and the preview client have no mutually supported Local Preview version.',
      'Update Studio or the preview client to a mutually supported version.',
    );
  }
  final schemaVersion = document['schemaVersion'];
  if (schemaVersion is! String ||
      negotiation.selectedVersion != schemaVersion) {
    return withhold(
      'preview.incompatibleSchemaVersion',
      'This Local Preview ${negotiation.selectedVersion} client cannot receive a Protocol $schemaVersion draft.',
      'Update the preview client to a version that supports Local Preview and Protocol $schemaVersion.',
    );
  }
  try {
    final clientId = capabilityReport['clientId'];
    final schemas = capabilityReport['supportedSchemaVersions'];
    final capabilities = capabilityReport['supportedCapabilities'];
    final previewCapabilities = capabilityReport['previewCapabilities'];
    final limits = capabilityReport['limits'];
    if (clientId is! String ||
        clientId.isEmpty ||
        schemas is! List<Object?> ||
        schemas.isEmpty ||
        schemas.any((value) => value is! String) ||
        schemas.toSet().length != schemas.length ||
        capabilities is! List<Object?> ||
        previewCapabilities is! List<Object?> ||
        limits is! Map<String, Object?> ||
        limits['maxDocumentBytes'] is! num) {
      throw const FormatException();
    }
    final maximum = limits['maxDocumentBytes'] as num;
    if (!maximum.isFinite || maximum <= 0 || maximum != maximum.truncate()) {
      throw const FormatException();
    }
    if (!schemas.contains(schemaVersion)) {
      return withhold(
        'preview.incompatibleSchemaVersion',
        'The preview client does not support the draft schema.',
        'Update the preview client to support Protocol $schemaVersion.',
      );
    }
    Map<String, String> capabilityMap(List<Object?> values) {
      final result = <String, String>{};
      for (final entry in values) {
        if (entry is! Map<String, Object?> ||
            entry['name'] is! String ||
            entry['version'] is! String ||
            result.containsKey(entry['name'])) {
          throw const FormatException();
        }
        result[entry['name']! as String] = entry['version']! as String;
      }
      return result;
    }

    final supported = capabilityMap(capabilities);
    final supportedPreview = capabilityMap(previewCapabilities);
    final compatibility = document['compatibility'];
    if (compatibility is! Map<String, Object?> ||
        compatibility['requiredCapabilities'] is! List<Object?>) {
      return withhold(
        'preview.invalidDraft',
        'The preview draft is missing its capability contract.',
        'Validate the complete draft before preview delivery.',
        action: 'editProperty',
      );
    }
    final required = compatibility['requiredCapabilities']! as List<Object?>;
    final missing = <String>[];
    for (final entry in required) {
      if (entry is! Map<String, Object?> ||
          entry['name'] is! String ||
          entry['version'] is! String) {
        return withhold(
          'preview.invalidDraft',
          'The preview draft has an invalid capability contract.',
          'Validate the complete draft before preview delivery.',
          action: 'editProperty',
        );
      }
      final name = entry['name']! as String;
      if (supported[name] != entry['version']) missing.add(name);
    }
    if (missing.isNotEmpty) {
      return withhold(
        'preview.unsupportedCapability',
        'The preview client does not support every capability required by this draft.',
        'Update the preview client to support: ${missing.join(', ')}.',
      );
    }
    final missingPreview = <String>[
      for (final capability in mosaicFlutterPreviewCapabilities)
        if (supportedPreview[capability] != negotiation.selectedVersion)
          capability,
    ];
    if (missingPreview.isNotEmpty) {
      return withhold(
        'preview.unsupportedPreviewCapability',
        'The preview client does not support every required Local Preview capability.',
        'Update the preview client to support: ${missingPreview.join(', ')}@${negotiation.selectedVersion}.',
      );
    }
    final bytes = utf8.encode(jsonEncode(document)).length;
    if (bytes > maximum.toInt()) {
      return withhold(
        'preview.documentTooLarge',
        'The serialized preview draft exceeds the client document byte limit.',
        'Reduce the draft size or use a preview client with a larger document limit.',
        action: 'removeComponent',
      );
    }
    return const MosaicPreviewDraftSend();
  } on Object {
    return withhold(
      'preview.invalidCapabilityReport',
      'The preview client capability report is missing or malformed.',
      'Reconnect or update the preview client so it sends a complete capability report.',
    );
  }
}

Map<String, Object?> mosaicFlutterCapabilityPayload(
  String clientId, {
  String previewProtocolVersion = mosaicLocalPreviewProtocolVersion,
}) {
  if (previewProtocolVersion != mosaicLocalPreviewProtocolVersion) {
    throw ArgumentError.value(
      previewProtocolVersion,
      'previewProtocolVersion',
      'Must be $mosaicLocalPreviewProtocolVersion.',
    );
  }
  return <String, Object?>{
    'clientId': clientId,
    'supportedSchemaVersions': <String>[mosaicProtocolVersion],
    'supportedCapabilities': <Map<String, String>>[
      for (final capability in mosaicProtocolCapabilities)
        <String, String>{
          'name': capability,
          'version': mosaicProtocolVersion,
        },
    ],
    'previewCapabilities': <Map<String, String>>[
      for (final capability in mosaicFlutterPreviewCapabilities)
        <String, String>{
          'name': capability,
          'version': previewProtocolVersion,
        },
    ],
    'limits': <String, Object?>{
      'maxDocumentBytes': mosaicFlutterPreviewMaximumDocumentBytes,
    },
  };
}
