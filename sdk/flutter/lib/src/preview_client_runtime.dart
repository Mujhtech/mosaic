part of 'preview_client.dart';

extension on MosaicPreviewClient {
  void _rejectValidation(
    MosaicPreviewDraftUpdated update, {
    required String reason,
    required MosaicPreviewValidationDiagnostic diagnostic,
  }) {
    final responses = <_OutboundPreviewMessage>[
      _OutboundPreviewMessage(
        type: 'validationError',
        payload: <String, Object?>{
          'clientId': configuration.identity.clientId,
          'editableDocumentId': update.editableDocumentId,
          'revision': update.revision.toJson(),
          'errors': <Map<String, Object?>>[diagnostic.toJson()],
        },
      ),
      _rejectedMessage(
        update.editableDocumentId,
        update.revision,
        reason,
        diagnostic,
      ),
    ];
    _recordAndSend(update.editableDocumentId, update.revision, responses);
    final unsupported = reason == 'unsupportedCapability';
    _draftIssue = MosaicPreviewDraftIssue(
      kind: unsupported
          ? MosaicPreviewDraftIssueKind.unsupportedComponent
          : MosaicPreviewDraftIssueKind.invalidDocument,
      code: diagnostic.code,
      message: diagnostic.message,
      location: diagnostic.location,
      recovery: diagnostic.recovery,
    );
    _notifyPreviewListeners();
  }

  void _handleCommerce(MosaicPreviewCommerceStateChanged update) {
    final tracker = _commerceTrackers.putIfAbsent(
      update.editableDocumentId,
      _RevisionTracker.new,
    );
    switch (tracker.compare(update.stateRevision)) {
      case _RevisionOrdering.newer:
        tracker.advance(update.stateRevision);
        _commerceStates[update.editableDocumentId] = update.state;
        _commerceRevisions[update.editableDocumentId] = update.stateRevision;
        final document = _documentForEditableId(update.editableDocumentId);
        if (document != null) {
          _reportCommerceWarningsIfNeeded(
            editableDocumentId: update.editableDocumentId,
            documentRevision: _revisionForEditableId(update.editableDocumentId),
            document: document,
          );
        }
        _notifyPreviewListeners();
        return;
      case _RevisionOrdering.idempotent:
        return;
      case _RevisionOrdering.stale:
        _emitConnectionDiagnostic(
          'preview.commerce.stale',
          'A stale mock commerce state was ignored.',
        );
        return;
      case _RevisionOrdering.conflict:
        _emitConnectionDiagnostic(
          'preview.commerce.conflict',
          'A conflicting mock commerce state was ignored.',
        );
        return;
    }
  }

  MosaicPaywallDocument? _documentForEditableId(String editableDocumentId) {
    if (_pendingEditableDocumentId == editableDocumentId) {
      return _pendingDocument;
    }
    if (_liveEditableDocumentId == editableDocumentId) {
      return _liveDocument;
    }
    return null;
  }

  MosaicLocalRevision? _revisionForEditableId(String editableDocumentId) {
    if (_pendingEditableDocumentId == editableDocumentId) {
      return _pendingRevision;
    }
    if (_liveEditableDocumentId == editableDocumentId) {
      return _liveRevision;
    }
    return null;
  }

  bool _commerceMatchesDocument(
    MosaicPreviewMockCommerceState state,
    MosaicPaywallDocument document,
  ) {
    final expected = document.products.map((product) => product.id).toSet();
    final received =
        state.products.map((product) => product.productReferenceId).toSet();
    return expected.length == received.length && expected.containsAll(received);
  }

  void _reportCommerceWarningsIfNeeded({
    required String editableDocumentId,
    required MosaicLocalRevision? documentRevision,
    required MosaicPaywallDocument document,
  }) {
    final state = _commerceStates[editableDocumentId];
    final commerceRevision = _commerceRevisions[editableDocumentId];
    if (state == null || commerceRevision == null) {
      return;
    }
    final MosaicPreviewCompatibilityWarning warning;
    if (!_commerceMatchesDocument(state, document)) {
      warning = const MosaicPreviewCompatibilityWarning(
        code: 'preview.commerce.productReferencesMismatch',
        severity: MosaicPreviewCompatibilitySeverity.warning,
        message: 'Mock commerce does not match the draft product references.',
        location: MosaicPreviewDiagnosticLocation(documentPath: '/products'),
        fallback: MosaicPreviewCompatibilityFallback.useSelectorFallback,
        recovery: MosaicPreviewRecovery(
          action: MosaicPreviewRecoveryAction.bindProduct,
          message: 'Bind one mock product to every document product reference.',
        ),
      );
    } else if (state.products.any((product) => !product.isAvailable)) {
      warning = const MosaicPreviewCompatibilityWarning(
        code: 'preview.product.unavailable',
        severity: MosaicPreviewCompatibilitySeverity.warning,
        message: 'One or more mock products are unavailable.',
        location: MosaicPreviewDiagnosticLocation(documentPath: '/products'),
        fallback: MosaicPreviewCompatibilityFallback.useSelectorFallback,
        recovery: MosaicPreviewRecovery(
          action: MosaicPreviewRecoveryAction.bindProduct,
          message:
              'Select an available mock product or inspect the selector fallback.',
        ),
      );
    } else {
      return;
    }
    final key = '$editableDocumentId:${documentRevision?.revisionId}:'
        '${commerceRevision.revisionId}:${warning.code}';
    if (!_reportedCommerceMismatchKeys.add(key)) {
      return;
    }
    if (_reportedCommerceMismatchKeys.length > 128) {
      _reportedCommerceMismatchKeys.remove(
        _reportedCommerceMismatchKeys.first,
      );
    }
    _emitConnectionDiagnostic(warning.code, warning.message);
    if (documentRevision != null) {
      _send(
        'renderWarning',
        <String, Object?>{
          'clientId': configuration.identity.clientId,
          'editableDocumentId': editableDocumentId,
          'revision': documentRevision.toJson(),
          'warnings': <Map<String, Object?>>[warning.toJson()],
        },
      );
    }
  }

  void _handleHeartbeat(MosaicPreviewHeartbeat heartbeat) {
    if (heartbeat.clientId != configuration.identity.clientId) {
      _emitConnectionDiagnostic(
        'preview.heartbeat.wrongClient',
        'A heartbeat for another preview client was ignored.',
      );
      return;
    }
    if (heartbeat.kind == MosaicPreviewHeartbeatKind.ping) {
      _send(
        'previewHeartbeat',
        <String, Object?>{
          'clientId': configuration.identity.clientId,
          'kind': 'pong',
          'sequence': heartbeat.sequence,
        },
      );
    }
  }

  void _startHeartbeat(MosaicPreviewSocket socket, int generation) {
    _heartbeatTimer?.cancel();
    _heartbeatTimer = Timer.periodic(configuration.heartbeatInterval, (_) {
      if (!identical(socket, _socket) ||
          generation != _lifecycleGeneration ||
          _connectionStatus != MosaicPreviewConnectionStatus.connected) {
        return;
      }
      final now = _clock();
      final lastInbound = _lastInboundAt;
      if (lastInbound != null &&
          now.difference(lastInbound) >= configuration.peerTimeout) {
        _emitConnectionDiagnostic(
          'preview.connection.timeout',
          'The local preview connection stopped responding.',
        );
        _handleSocketDrop(socket, generation);
        return;
      }
      final lastTraffic = _lastTrafficAt;
      if (lastTraffic == null ||
          now.difference(lastTraffic) >= configuration.heartbeatInterval) {
        _send(
          'previewHeartbeat',
          <String, Object?>{
            'clientId': configuration.identity.clientId,
            'kind': 'ping',
            'sequence': _heartbeatSequence++,
          },
        );
      }
    });
  }

  void _handleSocketDrop(MosaicPreviewSocket socket, int generation) {
    if (!identical(socket, _socket) || generation != _lifecycleGeneration) {
      return;
    }
    _socket = null;
    _heartbeatTimer?.cancel();
    _heartbeatTimer = null;
    unawaited(_socketSubscription?.cancel());
    _socketSubscription = null;
    unawaited(
      Future<void>.microtask(() => _closeBestEffort(socket)),
    );
    if (_shouldReconnect) {
      unawaited(_scheduleReconnect(generation));
    } else {
      _setConnectionStatus(MosaicPreviewConnectionStatus.disconnected);
    }
  }

  Future<void> _scheduleReconnect(int generation) async {
    if (_reconnectScheduled ||
        !_shouldReconnect ||
        generation != _lifecycleGeneration) {
      return;
    }
    if (_reconnectAttempt >= configuration.reconnectPolicy.maximumAttempts) {
      _shouldReconnect = false;
      _setConnectionStatus(MosaicPreviewConnectionStatus.disconnected);
      _emitConnectionDiagnostic(
        'preview.connection.exhausted',
        'The local preview reconnect limit was reached.',
      );
      return;
    }
    _reconnectScheduled = true;
    _reconnectAttempt += 1;
    _setConnectionStatus(MosaicPreviewConnectionStatus.reconnecting);
    final delay =
        configuration.reconnectPolicy.delayForAttempt(_reconnectAttempt);
    await _delay(delay);
    _reconnectScheduled = false;
    if (!_shouldReconnect || generation != _lifecycleGeneration) {
      return;
    }
    await _openSocket(generation);
  }

  void _send(String type, Map<String, Object?> payload) {
    final socket = _socket;
    if (socket == null) {
      return;
    }
    final String source;
    try {
      source = _codec.encode(
        messageId: 'msg_flutter_${++_messageSequence}',
        sessionId: configuration.sessionId,
        sentAt: _clock(),
        type: type,
        payload: payload,
        protocolVersion: _negotiatedPreviewVersion,
      );
    } on Object {
      _emitConnectionDiagnostic(
        'preview.message.encodeFailed',
        'The preview client could not encode a safe protocol message.',
      );
      return;
    }
    try {
      socket.send(source);
      _lastTrafficAt = _clock();
    } on Object {
      _emitConnectionDiagnostic(
        'preview.connection.sendFailed',
        'A local preview message could not be sent.',
      );
      _handleSocketDrop(socket, _lifecycleGeneration);
    }
  }

  void _sendMessage(_OutboundPreviewMessage message) {
    _send(message.type, message.payload);
  }

  void _recordAndSend(
    String documentId,
    MosaicLocalRevision revision,
    List<_OutboundPreviewMessage> responses,
  ) {
    final tracker = _documentTrackers[documentId];
    if (tracker != null && tracker.matches(revision)) {
      tracker.responses = List.unmodifiable(responses);
    }
    for (final response in responses) {
      _sendMessage(response);
    }
  }

  void _clearPendingDraft() {
    _pendingDocument = null;
    _pendingEditableDocumentId = null;
    _pendingRevision = null;
    _pendingPreviewContext = null;
  }

  _OutboundPreviewMessage _rejectedMessage(
    String documentId,
    MosaicLocalRevision revision,
    String reason,
    MosaicPreviewValidationDiagnostic diagnostic,
  ) {
    return _OutboundPreviewMessage(
      type: 'draftRejected',
      payload: <String, Object?>{
        'clientId': configuration.identity.clientId,
        'editableDocumentId': documentId,
        'revision': revision.toJson(),
        'reason': reason,
        'diagnostics': <Map<String, Object?>>[diagnostic.toJson()],
      },
    );
  }

  Map<String, Object?>? _currentRevisionTarget() {
    final documentId = _pendingEditableDocumentId ?? _liveEditableDocumentId;
    final revision = _pendingRevision ?? _liveRevision;
    if (documentId == null || revision == null) {
      return null;
    }
    return <String, Object?>{
      'clientId': configuration.identity.clientId,
      'editableDocumentId': documentId,
      'revision': revision.toJson(),
    };
  }

  _ProtocolRejection _protocolRejection(
    MosaicProtocolException error,
    Map<String, Object?> source,
  ) {
    final message = error.message;
    // Classified from the typed rejection the decoder raised. Message text is
    // used only to locate the offending property, never to decide the code.
    final unsupportedSchema =
        error.rejection == MosaicProtocolRejection.unsupportedSchemaVersion;
    final unsupportedCapability =
        error.rejection == MosaicProtocolRejection.unsupportedCapability;
    final location = _protocolLocation(message, source);
    if (unsupportedSchema) {
      return _ProtocolRejection(
        reason: 'unsupportedSchemaVersion',
        diagnostic: _documentDiagnostic(
          code: 'preview.schema.unsupported',
          message: 'This preview client does not support the draft schema.',
          location: location,
          recovery: const MosaicPreviewRecovery(
            action: MosaicPreviewRecoveryAction.updatePreviewClient,
            message:
                'Use the negotiated Protocol version or update the preview client.',
          ),
        ),
      );
    }
    if (unsupportedCapability) {
      return _ProtocolRejection(
        reason: 'unsupportedCapability',
        diagnostic: _documentDiagnostic(
          code: 'preview.component.unsupported',
          message: 'This preview client cannot render a required component.',
          location: location,
          recovery: const MosaicPreviewRecovery(
            action: MosaicPreviewRecoveryAction.removeComponent,
            message:
                'Remove the unsupported block or use a supported template.',
          ),
        ),
      );
    }
    return _ProtocolRejection(
      reason: 'validationFailed',
      diagnostic: _documentDiagnostic(
        code: 'preview.validation.failed',
        message:
            'The draft does not conform to the negotiated Mosaic Protocol.',
        location: location,
        recovery: const MosaicPreviewRecovery(
          action: MosaicPreviewRecoveryAction.editProperty,
          message: 'Fix the highlighted property and send a new revision.',
        ),
      ),
    );
  }

  MosaicPreviewDiagnosticLocation _protocolLocation(
    String message,
    Map<String, Object?> document,
  ) {
    final match =
        RegExp(r'at (\$[^.\s]*?(?:\.[A-Za-z0-9_-]+|\[[0-9]+\])*)[.]?$')
            .firstMatch(message);
    final jsonPath = match?.group(1) ?? r'$';
    final tokens = <String>[];
    for (final tokenMatch
        in RegExp(r'\.([A-Za-z0-9_-]+)|\[([0-9]+)\]').allMatches(jsonPath)) {
      tokens.add(tokenMatch.group(1) ?? tokenMatch.group(2)!);
    }
    Object? cursor = document;
    String? componentId;
    for (final token in tokens) {
      if (cursor is Map<String, Object?>) {
        final id = cursor['id'];
        if (id is String) {
          componentId = id;
        }
        cursor = cursor[token];
      } else if (cursor is List<Object?>) {
        final index = int.tryParse(token);
        cursor = index == null || index >= cursor.length ? null : cursor[index];
      } else {
        break;
      }
    }
    if (cursor is Map<String, Object?> && cursor['id'] is String) {
      componentId = cursor['id']! as String;
    }
    final pointer =
        tokens.isEmpty ? '' : '/${tokens.map(_escapePointerToken).join('/')}';
    final property = tokens.isEmpty || int.tryParse(tokens.last) != null
        ? null
        : tokens.last;
    return MosaicPreviewDiagnosticLocation(
      documentPath: pointer,
      componentId: componentId,
      property: property,
    );
  }

  MosaicPreviewValidationDiagnostic _revisionDiagnostic(
    String code,
    String message,
  ) {
    return _documentDiagnostic(
      code: code,
      message: message,
      location: const MosaicPreviewDiagnosticLocation(documentPath: ''),
      recovery: const MosaicPreviewRecovery(
        action: MosaicPreviewRecoveryAction.restoreLastValidDraft,
        message: 'Send a new revision with a greater sequence.',
      ),
    );
  }

  MosaicPreviewValidationDiagnostic _documentDiagnostic({
    required String code,
    required String message,
    required MosaicPreviewDiagnosticLocation location,
    required MosaicPreviewRecovery recovery,
  }) {
    return MosaicPreviewValidationDiagnostic(
      code: code,
      message: message,
      location: location,
      recovery: recovery,
    );
  }

  void _emitConnectionDiagnostic(String code, String message) {
    onDiagnostic?.call(
      MosaicDiagnostic(
        code: code,
        message: message,
        severity: MosaicDiagnosticSeverity.warning,
      ),
    );
  }

  void _setConnectionStatus(MosaicPreviewConnectionStatus value) {
    if (_connectionStatus == value || _disposed) {
      return;
    }
    _connectionStatus = value;
    _notifyPreviewListeners();
  }

  void _ensureUsable() {
    if (_disposed) {
      throw StateError('The preview client has been disposed.');
    }
  }

  Future<void> _closeBestEffort(MosaicPreviewSocket socket) async {
    try {
      await socket.close();
    } on Object {
      // Best effort by contract; no internal transport detail is exposed.
    }
  }
}
