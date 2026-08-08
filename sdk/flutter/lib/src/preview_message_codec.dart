part of 'preview_protocol.dart';

final class MosaicPreviewMessageCodec {
  const MosaicPreviewMessageCodec();

  /// Decodes the canonical Local Preview project container and its embedded
  /// current protocol document atomically. No implicit migration is performed.
  MosaicLocalPreviewProject decodeLocalProject(
    String source, {
    String expectedFileFormatVersion = mosaicLocalPreviewProtocolVersion,
  }) {
    final Object? decoded;
    try {
      decoded = jsonDecode(source);
    } on FormatException {
      throw const MosaicPreviewProtocolException(
        'The local project was not valid JSON.',
      );
    }
    final project = _object(decoded, r'$');
    _expectKeys(
      project,
      const <String>{
        'fileFormatVersion',
        'editableDocumentId',
        'revision',
        'document',
        'preview',
        'mockCommerce',
      },
      r'$',
    );
    final fileFormatVersion = _string(
      project['fileFormatVersion'],
      'fileFormatVersion',
    );
    // One implemented contract version, so the caller's expectation and this
    // reader's version must both match. There is no second accepted version to
    // fall through to.
    if (fileFormatVersion != expectedFileFormatVersion ||
        fileFormatVersion != mosaicLocalPreviewProtocolVersion) {
      throw const MosaicPreviewProtocolException(
        'The local project format version is unsupported.',
      );
    }
    final documentObject = _object(project['document'], 'document');
    if (documentObject['schemaVersion'] != fileFormatVersion) {
      throw const MosaicPreviewProtocolException(
        'The local project and document versions do not match.',
      );
    }
    final commerce = _object(project['mockCommerce'], 'mockCommerce');
    _expectKeys(
      commerce,
      const <String>{'revision', 'state'},
      'mockCommerce',
    );
    final MosaicPaywallDocument document;
    try {
      document = const MosaicProtocolDecoder().decode(
        jsonEncode(documentObject),
      );
    } on MosaicProtocolException {
      throw const MosaicPreviewProtocolException(
        'The local project document is invalid.',
      );
    }
    return MosaicLocalPreviewProject(
      fileFormatVersion: fileFormatVersion,
      editableDocumentId: _documentId(project['editableDocumentId']),
      revision: _revision(project['revision']),
      document: document,
      preview: _previewContext(project['preview']),
      commerceRevision: _revision(commerce['revision']),
      commerceState: _mockCommerceState(commerce['state']),
    );
  }

  MosaicPreviewDecodedMessage decode(
    String source, {
    required String expectedSessionId,
    String expectedProtocolVersion = mosaicLocalPreviewProtocolVersion,
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
    final protocolVersion = _string(
      envelope['previewProtocolVersion'],
      'previewProtocolVersion',
    );
    if (protocolVersion != expectedProtocolVersion ||
        protocolVersion != mosaicLocalPreviewProtocolVersion) {
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
      'capabilityReport' => _capabilityReport(payload, protocolVersion),
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
      protocolVersion: protocolVersion,
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
    String protocolVersion = mosaicLocalPreviewProtocolVersion,
  }) {
    if (protocolVersion != mosaicLocalPreviewProtocolVersion) {
      throw const MosaicPreviewProtocolException(
        'The preview protocol version is unsupported.',
      );
    }
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
      'previewProtocolVersion': protocolVersion,
      'messageId': messageId,
      'sessionId': sessionId,
      'sentAt': sentAt.toUtc().toIso8601String(),
      'type': type,
      'payload': payload,
    });
    decode(
      source,
      expectedSessionId: sessionId,
      expectedProtocolVersion: protocolVersion,
    );
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

  MosaicPreviewNoopMessage _capabilityReport(
    Map<String, Object?> payload,
    String protocolVersion,
  ) {
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
      expectedPreviewVersion: protocolVersion,
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
    String? expectedPreviewVersion,
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
          ? _previewCapability(capability, expectedPreviewVersion!)
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

  String _previewCapability(Object? value, String expectedVersion) {
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
    final version = capability['version'];
    if (version != expectedVersion) {
      throw const MosaicPreviewProtocolException(
        'The preview capability version is unsupported.',
      );
    }
    return '$name@$version';
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
