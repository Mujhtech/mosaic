import 'dart:convert';

import 'protocol.dart';

const String mosaicLocalPreviewProtocolVersion = '0.1';
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
    required this.messageId,
    required this.sentAt,
    required this.message,
  });

  final String messageId;

  /// Raw timestamp accepted by the normative Local Preview 0.1 regex.
  final String sentAt;
  final MosaicPreviewIncomingMessage message;
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
final class MosaicPreviewMessageCodec {
  const MosaicPreviewMessageCodec();

  MosaicPreviewDecodedMessage decode(
    String source, {
    required String expectedSessionId,
  }) {
    final Object? decoded;
    try {
      decoded = jsonDecode(source);
    } on FormatException {
      throw const MosaicPreviewProtocolException(
        'The preview message was not valid JSON.',
      );
    }
    final envelope = _object(decoded, r'$');
    _expectKeys(
      envelope,
      const <String>{
        'previewProtocolVersion',
        'messageId',
        'sessionId',
        'sentAt',
        'type',
        'payload',
      },
      r'$',
    );
    if (_string(envelope['previewProtocolVersion'], 'previewProtocolVersion') !=
        mosaicLocalPreviewProtocolVersion) {
      throw const MosaicPreviewProtocolException(
        'The preview protocol version is unsupported.',
      );
    }
    final messageId =
        _patternString(envelope['messageId'], 'messageId', _messageIdPattern);
    final sessionId =
        _patternString(envelope['sessionId'], 'sessionId', _sessionIdPattern);
    if (sessionId != expectedSessionId) {
      throw const MosaicPreviewProtocolException(
        'The preview message belongs to a different session.',
      );
    }
    final sentAtSource = _string(envelope['sentAt'], 'sentAt');
    if (sentAtSource.length > 32 ||
        !RegExp(
          r'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?Z$',
        ).hasMatch(sentAtSource)) {
      throw const MosaicPreviewProtocolException(
        'The preview message timestamp is invalid.',
      );
    }
    final type = _string(envelope['type'], 'type');
    final payload = _object(envelope['payload'], 'payload');
    final message = switch (type) {
      'draftUpdated' => _draftUpdated(payload),
      'mockCommerceStateChanged' => _commerceChanged(payload),
      'previewHeartbeat' => _heartbeat(payload),
      'previewClientDisconnected' => _disconnected(payload),
      'previewClientConnected' => _connected(payload),
      'capabilityReport' => _capabilityReport(payload),
      'draftAccepted' => _draftAccepted(payload),
      'draftRejected' => _draftRejected(payload),
      'validationError' => _validationError(payload),
      'renderWarning' => _renderWarning(payload),
      'renderFailure' => _renderFailure(payload),
      _ => throw const MosaicPreviewProtocolException(
          'The preview message type is unsupported.',
        ),
    };
    return MosaicPreviewDecodedMessage(
      messageId: messageId,
      sentAt: sentAtSource,
      message: message,
    );
  }

  String encode({
    required String messageId,
    required String sessionId,
    required DateTime sentAt,
    required String type,
    required Map<String, Object?> payload,
  }) {
    _validatedString(
      messageId,
      name: 'messageId',
      minimumLength: 5,
      maximumLength: 100,
      pattern: _messageIdPattern,
    );
    _validatedString(
      sessionId,
      name: 'sessionId',
      minimumLength: 9,
      maximumLength: 100,
      pattern: _sessionIdPattern,
    );
    final source = jsonEncode(<String, Object?>{
      'previewProtocolVersion': mosaicLocalPreviewProtocolVersion,
      'messageId': messageId,
      'sessionId': sessionId,
      'sentAt': sentAt.toUtc().toIso8601String(),
      'type': type,
      'payload': payload,
    });
    decode(source, expectedSessionId: sessionId);
    return source;
  }

  MosaicPreviewDraftUpdated _draftUpdated(Map<String, Object?> payload) {
    _expectKeys(
      payload,
      const <String>{'editableDocumentId', 'revision', 'document', 'preview'},
      'payload',
    );
    return MosaicPreviewDraftUpdated(
      editableDocumentId: _documentId(payload['editableDocumentId']),
      revision: _revision(payload['revision']),
      document: Map.unmodifiable(_object(payload['document'], 'document')),
      preview: _previewContext(payload['preview']),
    );
  }

  MosaicPreviewCommerceStateChanged _commerceChanged(
    Map<String, Object?> payload,
  ) {
    _expectKeys(
      payload,
      const <String>{'editableDocumentId', 'stateRevision', 'state'},
      'payload',
    );
    return MosaicPreviewCommerceStateChanged(
      editableDocumentId: _documentId(payload['editableDocumentId']),
      stateRevision: _revision(payload['stateRevision']),
      state: _mockCommerceState(payload['state']),
    );
  }

  MosaicPreviewHeartbeat _heartbeat(Map<String, Object?> payload) {
    _expectKeys(
      payload,
      const <String>{'clientId', 'kind', 'sequence'},
      'payload',
    );
    final kind = _enumString(
      payload['kind'],
      'kind',
      const <String>{'ping', 'pong'},
    );
    return MosaicPreviewHeartbeat(
      clientId:
          _patternString(payload['clientId'], 'clientId', _clientIdPattern),
      kind: kind == 'ping'
          ? MosaicPreviewHeartbeatKind.ping
          : MosaicPreviewHeartbeatKind.pong,
      sequence: _integer(payload['sequence'], 'sequence', minimum: 0),
    );
  }

  MosaicPreviewRemoteDisconnected _disconnected(
    Map<String, Object?> payload,
  ) {
    final allowed = <String>{'clientId', 'reason', 'diagnostic'};
    _expectKeys(payload, allowed, 'payload', required: const <String>{
      'clientId',
      'reason',
    });
    final clientId =
        _patternString(payload['clientId'], 'clientId', _clientIdPattern);
    final reason = _enumString(
      payload['reason'],
      'reason',
      const <String>{
        'closed',
        'timeout',
        'transportError',
        'replaced',
        'sessionEnded',
      },
    );
    if (payload['diagnostic'] != null) {
      _wireSafeText(payload['diagnostic'], 'diagnostic', 512);
    }
    return MosaicPreviewRemoteDisconnected(
      clientId: clientId,
      reason: reason,
    );
  }

  MosaicPreviewNoopMessage _connected(Map<String, Object?> payload) {
    _expectKeys(payload, const <String>{'client'}, 'payload');
    _clientIdentity(payload['client']);
    return const MosaicPreviewNoopMessage(type: 'previewClientConnected');
  }

  MosaicPreviewNoopMessage _capabilityReport(Map<String, Object?> payload) {
    _expectKeys(
      payload,
      const <String>{
        'clientId',
        'supportedSchemaVersions',
        'supportedCapabilities',
        'previewCapabilities',
        'limits',
      },
      'payload',
    );
    _patternString(payload['clientId'], 'clientId', _clientIdPattern);
    final versions =
        _list(payload['supportedSchemaVersions'], 'supportedSchemaVersions');
    if (versions.isEmpty || versions.length > 16) {
      throw const MosaicPreviewProtocolException(
        'Supported schema versions are invalid.',
      );
    }
    final seenVersions = <String>{};
    for (final version in versions) {
      final parsed = _patternString(
        version,
        'supportedSchemaVersion',
        _semanticVersionPattern,
      );
      if (!seenVersions.add(parsed)) {
        throw const MosaicPreviewProtocolException(
          'Supported schema versions must be unique.',
        );
      }
    }
    _capabilityList(payload['supportedCapabilities'], maximum: 128);
    _capabilityList(
      payload['previewCapabilities'],
      maximum: 32,
      previewCapabilities: true,
    );
    final limits = _object(payload['limits'], 'limits');
    _expectKeys(limits, const <String>{'maxDocumentBytes'}, 'limits');
    _integer(
      limits['maxDocumentBytes'],
      'maxDocumentBytes',
      minimum: 65536,
      maximum: 2097152,
    );
    return const MosaicPreviewNoopMessage(type: 'capabilityReport');
  }

  MosaicPreviewNoopMessage _draftAccepted(Map<String, Object?> payload) {
    _expectKeys(
      payload,
      const <String>{'clientId', 'editableDocumentId', 'revision'},
      'payload',
    );
    _revisionTargetFields(payload);
    return const MosaicPreviewNoopMessage(type: 'draftAccepted');
  }

  MosaicPreviewNoopMessage _draftRejected(Map<String, Object?> payload) {
    _expectKeys(
      payload,
      const <String>{
        'clientId',
        'editableDocumentId',
        'revision',
        'reason',
        'diagnostics',
      },
      'payload',
    );
    _revisionTargetFields(payload);
    _enumString(payload['reason'], 'reason', const <String>{
      'staleRevision',
      'revisionConflict',
      'validationFailed',
      'unsupportedSchemaVersion',
      'unsupportedCapability',
      'documentTooLarge',
      'renderFailed',
    });
    _diagnosticList(payload['diagnostics'], maximum: 50);
    return const MosaicPreviewNoopMessage(type: 'draftRejected');
  }

  MosaicPreviewNoopMessage _validationError(Map<String, Object?> payload) {
    _expectKeys(
      payload,
      const <String>{
        'clientId',
        'editableDocumentId',
        'revision',
        'errors',
      },
      'payload',
    );
    _revisionTargetFields(payload);
    _diagnosticList(payload['errors'], maximum: 100);
    return const MosaicPreviewNoopMessage(type: 'validationError');
  }

  MosaicPreviewNoopMessage _renderWarning(Map<String, Object?> payload) {
    _expectKeys(
      payload,
      const <String>{
        'clientId',
        'editableDocumentId',
        'revision',
        'warnings',
      },
      'payload',
    );
    _revisionTargetFields(payload);
    final warnings = _list(payload['warnings'], 'warnings');
    if (warnings.isEmpty || warnings.length > 50) {
      throw const MosaicPreviewProtocolException(
        'Render warnings are invalid.',
      );
    }
    for (final warningValue in warnings) {
      final warning = _object(warningValue, 'warning');
      _expectKeys(
        warning,
        const <String>{
          'code',
          'severity',
          'message',
          'location',
          'capability',
          'fallback',
          'recovery',
        },
        'warning',
        required: const <String>{
          'code',
          'severity',
          'message',
          'fallback',
          'recovery',
        },
      );
      _diagnosticCode(warning['code']);
      _wireSafeText(warning['message'], 'message', 512);
      _enumString(
        warning['severity'],
        'severity',
        const <String>{'warning', 'blocking'},
      );
      final fallback =
          _enumString(warning['fallback'], 'fallback', const <String>{
        'keepLastAcceptedDraft',
        'useDeclaredAssetFallback',
        'useSelectorFallback',
        'nativeApproximation',
      });
      if (warning['severity'] == 'blocking' &&
          fallback != 'keepLastAcceptedDraft') {
        throw const MosaicPreviewProtocolException(
          'A blocking warning must keep the last accepted draft.',
        );
      }
      if (warning['location'] != null) {
        _diagnosticLocation(warning['location']);
      }
      if (warning['capability'] != null) {
        _capability(warning['capability']);
      }
      _recovery(warning['recovery']);
    }
    return const MosaicPreviewNoopMessage(type: 'renderWarning');
  }

  MosaicPreviewNoopMessage _renderFailure(Map<String, Object?> payload) {
    _expectKeys(
      payload,
      const <String>{
        'clientId',
        'editableDocumentId',
        'revision',
        'failure',
      },
      'payload',
    );
    _revisionTargetFields(payload);
    final failure = _object(payload['failure'], 'failure');
    _expectKeys(
      failure,
      const <String>{
        'code',
        'message',
        'location',
        'fallback',
        'recovery',
      },
      'failure',
      required: const <String>{
        'code',
        'message',
        'fallback',
        'recovery',
      },
    );
    _diagnosticCode(failure['code']);
    _wireSafeText(failure['message'], 'message', 512);
    if (failure['fallback'] != 'keepLastAcceptedDraft') {
      throw const MosaicPreviewProtocolException(
        'The render failure fallback is invalid.',
      );
    }
    if (failure['location'] != null) {
      _diagnosticLocation(failure['location']);
    }
    _recovery(failure['recovery']);
    return const MosaicPreviewNoopMessage(type: 'renderFailure');
  }

  void _clientIdentity(Object? value) {
    final client = _object(value, 'client');
    _expectKeys(
      client,
      const <String>{
        'clientId',
        'displayName',
        'renderer',
        'application',
        'device',
      },
      'client',
    );
    _patternString(client['clientId'], 'clientId', _clientIdPattern);
    _wireSafeText(client['displayName'], 'displayName', 80);
    final renderer = _object(client['renderer'], 'renderer');
    _expectKeys(renderer, const <String>{'id', 'version'}, 'renderer');
    _patternString(renderer['id'], 'renderer.id', _machineIdentifierPattern);
    _patternString(
      renderer['version'],
      'renderer.version',
      _semanticVersionPattern,
    );
    final application = _object(client['application'], 'application');
    _expectKeys(
      application,
      const <String>{'id', 'displayName', 'version'},
      'application',
    );
    _patternString(
      application['id'],
      'application.id',
      _machineIdentifierPattern,
    );
    _wireSafeText(application['displayName'], 'displayName', 80);
    _wireSafeText(application['version'], 'version', 64);
    final device = _object(client['device'], 'device');
    _expectKeys(
      device,
      const <String>{'displayName', 'systemName', 'systemVersion'},
      'device',
    );
    _wireSafeText(device['displayName'], 'displayName', 80);
    _wireSafeText(device['systemName'], 'systemName', 80);
    _wireSafeText(device['systemVersion'], 'systemVersion', 64);
  }

  void _revisionTargetFields(Map<String, Object?> payload) {
    _patternString(payload['clientId'], 'clientId', _clientIdPattern);
    _documentId(payload['editableDocumentId']);
    _revision(payload['revision']);
  }

  void _capabilityList(
    Object? value, {
    required int maximum,
    bool previewCapabilities = false,
  }) {
    final values = _list(value, 'capabilities');
    if (values.isEmpty || values.length > maximum) {
      throw const MosaicPreviewProtocolException(
        'The capability list is invalid.',
      );
    }
    final seen = <String>{};
    for (final capability in values) {
      final key = previewCapabilities
          ? _previewCapability(capability)
          : _capability(capability);
      if (!seen.add(key)) {
        throw const MosaicPreviewProtocolException(
          'Capabilities must be unique.',
        );
      }
    }
  }

  String _capability(Object? value) {
    final capability = _object(value, 'capability');
    _expectKeys(capability, const <String>{'name', 'version'}, 'capability');
    final name =
        _patternString(capability['name'], 'name', _machineIdentifierPattern);
    final version = _patternString(
      capability['version'],
      'version',
      _semanticVersionPattern,
    );
    return '$name@$version';
  }

  String _previewCapability(Object? value) {
    final capability = _object(value, 'previewCapability');
    _expectKeys(
      capability,
      const <String>{'name', 'version'},
      'previewCapability',
    );
    final name = _enumString(
      capability['name'],
      'name',
      mosaicFlutterPreviewCapabilities,
    );
    if (capability['version'] != mosaicLocalPreviewProtocolVersion) {
      throw const MosaicPreviewProtocolException(
        'The preview capability version is unsupported.',
      );
    }
    return '$name@$mosaicLocalPreviewProtocolVersion';
  }

  void _diagnosticList(Object? value, {required int maximum}) {
    final diagnostics = _list(value, 'diagnostics');
    if (diagnostics.isEmpty || diagnostics.length > maximum) {
      throw const MosaicPreviewProtocolException(
        'The diagnostic list is invalid.',
      );
    }
    for (final value in diagnostics) {
      final diagnostic = _object(value, 'diagnostic');
      _expectKeys(
        diagnostic,
        const <String>{'code', 'message', 'location', 'recovery'},
        'diagnostic',
      );
      _diagnosticCode(diagnostic['code']);
      _wireSafeText(diagnostic['message'], 'message', 512);
      _diagnosticLocation(diagnostic['location']);
      _recovery(diagnostic['recovery']);
    }
  }

  void _diagnosticLocation(Object? value) {
    final location = _object(value, 'location');
    _expectKeys(
      location,
      const <String>{'documentPath', 'componentId', 'property'},
      'location',
      required: const <String>{'documentPath'},
    );
    final pointerValue = location['documentPath'];
    if (pointerValue is! String ||
        pointerValue.length > 512 ||
        !RegExp(r'^(?:/(?:[^~/]|~[01])*)*$').hasMatch(pointerValue)) {
      throw const MosaicPreviewProtocolException(
        'The diagnostic document path is invalid.',
      );
    }
    if (location['componentId'] != null) {
      _componentId(location['componentId']);
    }
    if (location['property'] != null) {
      final property = _string(location['property'], 'property');
      if (property.length > 128 ||
          !RegExp(r'^[A-Za-z][A-Za-z0-9]*$').hasMatch(property)) {
        throw const MosaicPreviewProtocolException(
          'The diagnostic property is invalid.',
        );
      }
    }
  }

  void _recovery(Object? value) {
    final recovery = _object(value, 'recovery');
    _expectKeys(recovery, const <String>{'action', 'message'}, 'recovery');
    _enumString(recovery['action'], 'action', const <String>{
      'editProperty',
      'removeComponent',
      'bindProduct',
      'selectSupportedTemplate',
      'updatePreviewClient',
      'restoreLastValidDraft',
      'retry',
      'reconnect',
      'inspectComponent',
    });
    _wireSafeText(recovery['message'], 'message', 512);
  }

  void _diagnosticCode(Object? value) {
    final code = _string(value, 'code');
    if (code.length > 96 ||
        !RegExp(r'^[a-z][a-zA-Z0-9]*(?:[._-][a-zA-Z0-9]+)+$').hasMatch(code)) {
      throw const MosaicPreviewProtocolException(
        'The diagnostic code is invalid.',
      );
    }
  }

  String _wireSafeText(Object? value, String path, int maximumLength) {
    final text = _string(value, path);
    if (text.length > maximumLength ||
        text.contains('\n') ||
        text.contains('\r')) {
      throw MosaicPreviewProtocolException('Unsafe text at $path.');
    }
    return text;
  }

  MosaicLocalRevision _revision(Object? value) {
    final object = _object(value, 'revision');
    _expectKeys(object, const <String>{'revisionId', 'sequence'}, 'revision');
    return MosaicLocalRevision(
      revisionId: _patternString(
        object['revisionId'],
        'revisionId',
        _revisionIdPattern,
      ),
      sequence: _integer(object['sequence'], 'sequence', minimum: 1),
    );
  }

  MosaicPreviewContext _previewContext(Object? value) {
    final object = _object(value, 'preview');
    _expectKeys(object, const <String>{'locale', 'textScale'}, 'preview');
    return MosaicPreviewContext(
      locale: _patternString(object['locale'], 'locale', _localePattern),
      textScale: _number(object['textScale'], 'textScale'),
    );
  }

  MosaicPreviewMockCommerceState _mockCommerceState(Object? value) {
    final object = _object(value, 'state');
    _expectKeys(
      object,
      const <String>{
        'products',
        'purchaseOutcome',
        'restoreOutcome',
        'entitlement',
      },
      'state',
    );
    final products = _list(object['products'], 'products');
    if (products.length > 50) {
      throw const MosaicPreviewProtocolException(
        'Mock commerce products are invalid.',
      );
    }
    final parsedProducts = products.map(_mockProduct).toList(growable: false);
    final referenceIds =
        parsedProducts.map((product) => product.productReferenceId).toSet();
    if (referenceIds.length != parsedProducts.length) {
      throw const MosaicPreviewProtocolException(
        'Mock product reference identifiers must be unique.',
      );
    }
    final entitlement = _entitlement(object['entitlement']);
    if (entitlement.productReferenceId case final activeReferenceId?) {
      if (!referenceIds.contains(activeReferenceId)) {
        throw const MosaicPreviewProtocolException(
          'The mock entitlement does not resolve to a mock product.',
        );
      }
    }
    return MosaicPreviewMockCommerceState(
      products: parsedProducts,
      purchaseOutcome: MosaicPreviewPurchaseOutcome.values.byName(
        _enumString(
          object['purchaseOutcome'],
          'purchaseOutcome',
          MosaicPreviewPurchaseOutcome.values
              .map((value) => value.name)
              .toSet(),
        ),
      ),
      restoreOutcome: MosaicPreviewRestoreOutcome.values.byName(
        _enumString(
          object['restoreOutcome'],
          'restoreOutcome',
          MosaicPreviewRestoreOutcome.values.map((value) => value.name).toSet(),
        ),
      ),
      entitlement: entitlement,
    );
  }

  MosaicPreviewMockProduct _mockProduct(Object? value) {
    final object = _object(value, 'product');
    final referenceId = _componentId(object['productReferenceId']);
    final availability = _enumString(
      object['availability'],
      'availability',
      const <String>{'available', 'unavailable'},
    );
    if (availability == 'unavailable') {
      _expectKeys(
        object,
        const <String>{'productReferenceId', 'availability', 'reason'},
        'product',
      );
      return MosaicPreviewUnavailableProduct(
        productReferenceId: referenceId,
        reason: MosaicPreviewUnavailableReason.values.byName(
          _enumString(
            object['reason'],
            'reason',
            MosaicPreviewUnavailableReason.values
                .map((value) => value.name)
                .toSet(),
          ),
        ),
      );
    }
    final kind = _enumString(
      object['kind'],
      'kind',
      const <String>{'subscription', 'nonConsumable'},
    );
    if (kind == 'nonConsumable') {
      _expectKeys(
        object,
        const <String>{
          'productReferenceId',
          'availability',
          'kind',
          'localizedPrice',
          'currencyCode',
        },
        'product',
      );
      return MosaicPreviewNonConsumableProduct(
        productReferenceId: referenceId,
        localizedPrice: _safeString(
          object['localizedPrice'],
          'localizedPrice',
          80,
        ),
        currencyCode: _currencyCode(object['currencyCode']),
      );
    }
    _expectKeys(
      object,
      const <String>{
        'productReferenceId',
        'availability',
        'kind',
        'localizedPrice',
        'currencyCode',
        'billingPeriod',
        'trialPeriod',
        'introductoryOffer',
      },
      'product',
      required: const <String>{
        'productReferenceId',
        'availability',
        'kind',
        'localizedPrice',
        'currencyCode',
        'billingPeriod',
      },
    );
    return MosaicPreviewSubscriptionProduct(
      productReferenceId: referenceId,
      localizedPrice: _safeString(
        object['localizedPrice'],
        'localizedPrice',
        80,
      ),
      currencyCode: _currencyCode(object['currencyCode']),
      billingPeriod: _period(object['billingPeriod']),
      trialPeriod:
          object['trialPeriod'] == null ? null : _period(object['trialPeriod']),
      introductoryOffer: object['introductoryOffer'] == null
          ? null
          : _introductoryOffer(object['introductoryOffer']),
    );
  }

  MosaicPreviewIntroductoryOffer _introductoryOffer(Object? value) {
    final object = _object(value, 'introductoryOffer');
    _expectKeys(
      object,
      const <String>{'localizedPrice', 'period', 'cycles'},
      'introductoryOffer',
    );
    return MosaicPreviewIntroductoryOffer(
      localizedPrice: _safeString(
        object['localizedPrice'],
        'localizedPrice',
        80,
      ),
      period: _period(object['period']),
      cycles: _integer(object['cycles'], 'cycles', minimum: 1, maximum: 120),
    );
  }

  MosaicPreviewPeriod _period(Object? value) {
    final object = _object(value, 'period');
    _expectKeys(object, const <String>{'unit', 'value'}, 'period');
    return MosaicPreviewPeriod(
      unit: MosaicPreviewPeriodUnit.values.byName(
        _enumString(
          object['unit'],
          'unit',
          MosaicPreviewPeriodUnit.values.map((value) => value.name).toSet(),
        ),
      ),
      value: _integer(object['value'], 'value', minimum: 1, maximum: 120),
    );
  }

  MosaicPreviewMockEntitlement _entitlement(Object? value) {
    final object = _object(value, 'entitlement');
    final status = _enumString(
      object['status'],
      'status',
      const <String>{'none', 'active'},
    );
    if (status == 'none') {
      _expectKeys(object, const <String>{'status'}, 'entitlement');
      return const MosaicPreviewMockEntitlement.none();
    }
    _expectKeys(
      object,
      const <String>{'status', 'productReferenceId'},
      'entitlement',
    );
    return MosaicPreviewMockEntitlement.active(
      _componentId(object['productReferenceId']),
    );
  }

  String _documentId(Object? value) => _patternString(
        value,
        'editableDocumentId',
        _documentIdPattern,
      );

  String _componentId(Object? value) {
    final id = _string(value, 'productReferenceId');
    if (!RegExp(r'^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$').hasMatch(id) ||
        id.length > 128) {
      throw const MosaicPreviewProtocolException(
        'A mock product reference is invalid.',
      );
    }
    return id;
  }

  String _currencyCode(Object? value) {
    final code = _string(value, 'currencyCode');
    if (!RegExp(r'^[A-Z]{3}$').hasMatch(code)) {
      throw const MosaicPreviewProtocolException(
        'A mock product currency code is invalid.',
      );
    }
    return code;
  }
}

String _validatedString(
  String value, {
  required String name,
  required int minimumLength,
  required int maximumLength,
  required RegExp pattern,
}) {
  if (value.length < minimumLength ||
      value.length > maximumLength ||
      !pattern.hasMatch(value)) {
    throw ArgumentError.value(value, name, 'Value does not satisfy contract.');
  }
  return value;
}

String _safeDisplayName(String value, String name) =>
    _safeString(value, name, 80);

String _safeString(Object? value, String name, int maximumLength) {
  final string = value is String ? value : null;
  if (string == null ||
      string.isEmpty ||
      string.length > maximumLength ||
      string.contains('\n') ||
      string.contains('\r')) {
    throw ArgumentError.value(
        value, name, 'Value must be safe single-line text.');
  }
  return string;
}

Map<String, Object?> _object(Object? value, String path) {
  if (value is! Map<String, Object?>) {
    throw MosaicPreviewProtocolException('Expected an object at $path.');
  }
  return value;
}

List<Object?> _list(Object? value, String path) {
  if (value is! List<Object?>) {
    throw MosaicPreviewProtocolException('Expected an array at $path.');
  }
  return value;
}

String _string(Object? value, String path) {
  if (value is! String || value.isEmpty) {
    throw MosaicPreviewProtocolException('Expected a string at $path.');
  }
  return value;
}

String _patternString(Object? value, String path, RegExp pattern) {
  final string = _string(value, path);
  final (minimumLength, maximumLength) = switch (pattern) {
    _ when identical(pattern, _messageIdPattern) => (5, 100),
    _ when identical(pattern, _sessionIdPattern) => (9, 100),
    _ when identical(pattern, _clientIdPattern) => (8, 100),
    _ when identical(pattern, _documentIdPattern) => (10, 100),
    _ when identical(pattern, _revisionIdPattern) => (10, 100),
    _ when identical(pattern, _machineIdentifierPattern) => (1, 128),
    _ when identical(pattern, _semanticVersionPattern) => (1, 64),
    _ when identical(pattern, _localePattern) => (2, 7),
    _ => (1, 512),
  };
  if (string.length < minimumLength ||
      string.length > maximumLength ||
      !pattern.hasMatch(string)) {
    throw MosaicPreviewProtocolException('Invalid value at $path.');
  }
  return string;
}

String _enumString(
  Object? value,
  String path,
  Set<String> allowed,
) {
  final string = _string(value, path);
  if (!allowed.contains(string)) {
    throw MosaicPreviewProtocolException('Unsupported value at $path.');
  }
  return string;
}

int _integer(
  Object? value,
  String path, {
  required int minimum,
  int maximum = 2147483647,
}) {
  if (value is! num || !value.isFinite || value != value.truncateToDouble()) {
    throw MosaicPreviewProtocolException('Expected an integer at $path.');
  }
  final integer = value.toInt();
  if (integer < minimum || integer > maximum) {
    throw MosaicPreviewProtocolException('Integer out of range at $path.');
  }
  return integer;
}

double _number(Object? value, String path) {
  if (value is! num || !value.isFinite) {
    throw MosaicPreviewProtocolException('Expected a number at $path.');
  }
  return value.toDouble();
}

void _expectKeys(
  Map<String, Object?> object,
  Set<String> allowed,
  String path, {
  Set<String>? required,
}) {
  final requiredKeys = required ?? allowed;
  final missing = requiredKeys.difference(object.keys.toSet());
  final extra = object.keys.toSet().difference(allowed);
  if (missing.isNotEmpty || extra.isNotEmpty) {
    throw MosaicPreviewProtocolException('Unexpected fields at $path.');
  }
}

Map<String, Object?> mosaicFlutterCapabilityPayload(String clientId) =>
    <String, Object?>{
      'clientId': clientId,
      'supportedSchemaVersions': <String>[mosaicProtocolVersion],
      'supportedCapabilities': <Map<String, String>>[
        for (final capability in mosaicProtocolV01Capabilities)
          <String, String>{
            'name': capability,
            'version': mosaicProtocolVersion,
          },
      ],
      'previewCapabilities': <Map<String, String>>[
        for (final capability in mosaicFlutterPreviewCapabilities)
          <String, String>{
            'name': capability,
            'version': mosaicLocalPreviewProtocolVersion,
          },
      ],
      'limits': <String, Object?>{
        'maxDocumentBytes': mosaicFlutterPreviewMaximumDocumentBytes,
      },
    };
