import 'dart:async';
import 'dart:collection';
import 'dart:convert';

import 'package:flutter/foundation.dart';

import 'presentation.dart';
import 'preview_protocol.dart';
import 'preview_transport.dart';
import 'protocol.dart';

const String mosaicLocalPreviewWebSocketProtocol = 'mosaic.local-preview.v0.2';
const String mosaicLocalPreviewV02WebSocketProtocol =
    mosaicLocalPreviewWebSocketProtocol;
const List<String> mosaicLocalPreviewWebSocketProtocols = <String>[
  mosaicLocalPreviewWebSocketProtocol,
];

enum MosaicPreviewConnectionStatus {
  disconnected,
  connecting,
  connected,
  reconnecting,
}

enum MosaicPreviewDraftIssueKind {
  invalidDocument,
  unsupportedComponent,
  renderFailure,
}

final class MosaicPreviewDraftIssue {
  const MosaicPreviewDraftIssue({
    required this.kind,
    required this.code,
    required this.message,
    required this.location,
    required this.recovery,
  });

  final MosaicPreviewDraftIssueKind kind;
  final String code;
  final String message;
  final MosaicPreviewDiagnosticLocation location;
  final MosaicPreviewRecovery recovery;
}

final class MosaicPreviewClientConfiguration {
  MosaicPreviewClientConfiguration({
    required Uri endpoint,
    required String sessionId,
    required this.identity,
    this.reconnectPolicy = const MosaicPreviewReconnectPolicy(),
    this.heartbeatInterval = const Duration(seconds: 5),
    this.peerTimeout = const Duration(seconds: 15),
  })  : endpoint = _validateEndpoint(endpoint),
        sessionId = _validateSessionId(sessionId) {
    if (reconnectPolicy.initialDelay.isNegative ||
        reconnectPolicy.maximumDelay.isNegative) {
      throw ArgumentError.value(
        reconnectPolicy,
        'reconnectPolicy',
        'Reconnect delays must not be negative.',
      );
    }
    if (heartbeatInterval <= Duration.zero) {
      throw ArgumentError.value(
        heartbeatInterval,
        'heartbeatInterval',
        'Must be positive.',
      );
    }
    if (peerTimeout <= heartbeatInterval) {
      throw ArgumentError.value(
        peerTimeout,
        'peerTimeout',
        'Must be greater than heartbeatInterval.',
      );
    }
  }

  final Uri endpoint;
  final String sessionId;
  final MosaicPreviewClientIdentity identity;
  final MosaicPreviewReconnectPolicy reconnectPolicy;
  final Duration heartbeatInterval;
  final Duration peerTimeout;

  static Uri _validateEndpoint(Uri value) {
    if ((value.scheme != 'ws' && value.scheme != 'wss') ||
        value.host.isEmpty ||
        value.hasQuery ||
        value.hasFragment ||
        value.userInfo.isNotEmpty ||
        !_isLocalDevelopmentHost(value.host)) {
      throw ArgumentError.value(
        value,
        'endpoint',
        'Must be a local-development ws or wss URI without credentials, queries, or fragments.',
      );
    }
    return value;
  }

  static bool _isLocalDevelopmentHost(String host) {
    final normalized = host.toLowerCase();
    final isLocalIpv6 = normalized.contains(':') &&
        (normalized == '::1' ||
            normalized.startsWith('fc') ||
            normalized.startsWith('fd') ||
            RegExp(r'^fe[89ab]').hasMatch(normalized));
    if (normalized == 'localhost' ||
        normalized.endsWith('.localhost') ||
        normalized.endsWith('.local') ||
        isLocalIpv6) {
      return true;
    }
    final octets = normalized.split('.').map(int.tryParse).toList();
    if (octets.length != 4 || octets.any((octet) => octet == null)) {
      return false;
    }
    final values = octets.cast<int>();
    if (values.any((octet) => octet < 0 || octet > 255)) return false;
    return values[0] == 127 ||
        values[0] == 10 ||
        (values[0] == 192 && values[1] == 168) ||
        (values[0] == 172 && values[1] >= 16 && values[1] <= 31) ||
        (values[0] == 169 && values[1] == 254);
  }

  static String _validateSessionId(String value) {
    if (value.length < 9 ||
        value.length > 100 ||
        !RegExp(r'^session_[A-Za-z0-9][A-Za-z0-9_-]*$').hasMatch(value)) {
      throw ArgumentError.value(
        value,
        'sessionId',
        'Must satisfy the Local Preview session identifier contract.',
      );
    }
    return value;
  }
}

typedef MosaicPreviewClock = DateTime Function();

/// Owns one local-preview WebSocket session and its last safe render state.
///
/// Incoming revisions are decoded atomically. A rejected update never replaces
/// [documentForRendering], and acceptance is sent only after a preview widget
/// calls [markRevisionRendered] from a completed frame.
final class MosaicPreviewClient extends ChangeNotifier {
  MosaicPreviewClient({
    required this.configuration,
    MosaicPreviewSocketConnector connector =
        const MosaicIoPreviewSocketConnector(),
    MosaicPreviewMessageCodec codec = const MosaicPreviewMessageCodec(),
    MosaicProtocolDecoder decoder = const MosaicProtocolDecoder(),
    MosaicPreviewDelay delay = mosaicPreviewDelay,
    MosaicPreviewClock clock = _utcNow,
    this.onDiagnostic,
  })  : _connector = connector,
        _codec = codec,
        _decoder = decoder,
        _delay = delay,
        _clock = clock;

  final MosaicPreviewClientConfiguration configuration;
  final MosaicDiagnosticCallback? onDiagnostic;
  final MosaicPreviewSocketConnector _connector;
  final MosaicPreviewMessageCodec _codec;
  final MosaicProtocolDecoder _decoder;
  final MosaicPreviewDelay _delay;
  final MosaicPreviewClock _clock;

  final Map<String, _RevisionTracker> _documentTrackers =
      <String, _RevisionTracker>{};
  final Map<String, _RevisionTracker> _commerceTrackers =
      <String, _RevisionTracker>{};
  final Map<String, MosaicPreviewMockCommerceState> _commerceStates =
      <String, MosaicPreviewMockCommerceState>{};
  final Map<String, MosaicLocalRevision> _commerceRevisions =
      <String, MosaicLocalRevision>{};
  final LinkedHashSet<String> _seenMessageIds = LinkedHashSet<String>();
  final Set<String> _reportedCommerceMismatchKeys = <String>{};

  MosaicPreviewSocket? _socket;
  StreamSubscription<Object?>? _socketSubscription;
  Timer? _heartbeatTimer;
  var _lifecycleGeneration = 0;
  var _reconnectAttempt = 0;
  var _reconnectScheduled = false;
  var _messageSequence = 0;
  var _heartbeatSequence = 0;
  var _shouldReconnect = false;
  var _disposed = false;
  var _negotiatedPreviewVersion = mosaicLocalPreviewProtocolVersion;
  DateTime? _lastInboundAt;
  DateTime? _lastTrafficAt;

  MosaicPreviewConnectionStatus _connectionStatus =
      MosaicPreviewConnectionStatus.disconnected;
  MosaicPaywallDocument? _liveDocument;
  MosaicPaywallDocument? _pendingDocument;
  String? _liveEditableDocumentId;
  String? _pendingEditableDocumentId;
  MosaicLocalRevision? _liveRevision;
  MosaicLocalRevision? _pendingRevision;
  MosaicPreviewContext? _livePreviewContext;
  MosaicPreviewContext? _pendingPreviewContext;
  MosaicPreviewDraftIssue? _draftIssue;

  MosaicPreviewConnectionStatus get connectionStatus => _connectionStatus;

  String get negotiatedPreviewVersion => _negotiatedPreviewVersion;

  int get reconnectAttempt => _reconnectAttempt;

  MosaicPaywallDocument? get documentForRendering =>
      _pendingDocument ?? _liveDocument;

  String? get editableDocumentIdForRendering =>
      _pendingEditableDocumentId ?? _liveEditableDocumentId;

  MosaicLocalRevision? get revisionForRendering =>
      _pendingRevision ?? _liveRevision;

  MosaicPreviewContext? get previewContextForRendering =>
      _pendingPreviewContext ?? _livePreviewContext;

  MosaicLocalRevision? get liveRevision => _liveRevision;

  MosaicLocalRevision? get pendingRevision => _pendingRevision;

  MosaicPreviewDraftIssue? get draftIssue => _draftIssue;

  MosaicPreviewMockCommerceState? get mockCommerceState {
    final documentId = editableDocumentIdForRendering;
    if (documentId == null) {
      return null;
    }
    final state = _commerceStates[documentId];
    final document = documentForRendering;
    if (state == null || document == null) {
      return state;
    }
    return _commerceMatchesDocument(state, document) ? state : null;
  }

  MosaicLocalRevision? get mockCommerceRevision {
    final documentId = editableDocumentIdForRendering;
    return documentId == null ? null : _commerceRevisions[documentId];
  }

  Future<void> connect() async {
    _ensureUsable();
    if (_shouldReconnect &&
        _connectionStatus != MosaicPreviewConnectionStatus.disconnected) {
      return;
    }
    _shouldReconnect = true;
    _reconnectAttempt = 0;
    final generation = ++_lifecycleGeneration;
    _setConnectionStatus(MosaicPreviewConnectionStatus.connecting);
    await _openSocket(generation);
  }

  Future<void> disconnect() {
    if (_disposed) {
      return Future<void>.value();
    }
    _shouldReconnect = false;
    _reconnectScheduled = false;
    _lifecycleGeneration += 1;
    _heartbeatTimer?.cancel();
    _heartbeatTimer = null;
    final socket = _socket;
    if (socket != null) {
      _send(
        'previewClientDisconnected',
        <String, Object?>{
          'clientId': configuration.identity.clientId,
          'reason': 'closed',
        },
      );
    }
    _socket = null;
    unawaited(_socketSubscription?.cancel());
    _socketSubscription = null;
    if (socket != null) {
      unawaited(_closeBestEffort(socket));
    }
    _setConnectionStatus(MosaicPreviewConnectionStatus.disconnected);
    return Future<void>.value();
  }

  @override
  void dispose() {
    if (_disposed) {
      return;
    }
    _disposed = true;
    _shouldReconnect = false;
    _lifecycleGeneration += 1;
    _heartbeatTimer?.cancel();
    unawaited(_socketSubscription?.cancel());
    final socket = _socket;
    _socket = null;
    if (socket != null) {
      unawaited(socket.close());
    }
    super.dispose();
  }

  /// Confirms that the pending revision completed a Flutter frame.
  void markRevisionRendered(MosaicLocalRevision revision) {
    if (_pendingRevision != revision ||
        _pendingDocument == null ||
        _pendingEditableDocumentId == null ||
        _pendingPreviewContext == null) {
      return;
    }
    final documentId = _pendingEditableDocumentId!;
    _liveDocument = _pendingDocument;
    _liveEditableDocumentId = documentId;
    _liveRevision = revision;
    _livePreviewContext = _pendingPreviewContext;
    _pendingDocument = null;
    _pendingEditableDocumentId = null;
    _pendingRevision = null;
    _pendingPreviewContext = null;
    _draftIssue = null;

    final response = _OutboundPreviewMessage(
      type: 'draftAccepted',
      payload: <String, Object?>{
        'clientId': configuration.identity.clientId,
        'editableDocumentId': documentId,
        'revision': revision.toJson(),
      },
    );
    _recordAndSend(documentId, revision, <_OutboundPreviewMessage>[response]);
    notifyListeners();
  }

  void reportRenderWarning(MosaicPreviewCompatibilityWarning warning) {
    final target = _currentRevisionTarget();
    if (target == null) {
      return;
    }
    _send(
      'renderWarning',
      <String, Object?>{
        ...target,
        'warnings': <Map<String, Object?>>[warning.toJson()],
      },
    );
  }

  /// Rejects a pending revision and restores the last accepted document.
  void reportRenderFailure(MosaicPreviewRenderDiagnostic failure) {
    final documentId = _pendingEditableDocumentId;
    final revision = _pendingRevision;
    if (documentId == null || revision == null) {
      return;
    }
    final validation = MosaicPreviewValidationDiagnostic(
      code: failure.code,
      message: failure.message,
      location: failure.location ??
          const MosaicPreviewDiagnosticLocation(documentPath: ''),
      recovery: failure.recovery,
    );
    final responses = <_OutboundPreviewMessage>[
      _OutboundPreviewMessage(
        type: 'renderFailure',
        payload: <String, Object?>{
          'clientId': configuration.identity.clientId,
          'editableDocumentId': documentId,
          'revision': revision.toJson(),
          'failure': failure.toJson(),
        },
      ),
      _rejectedMessage(
        documentId,
        revision,
        'renderFailed',
        validation,
      ),
    ];
    _recordAndSend(documentId, revision, responses);
    _pendingDocument = null;
    _pendingEditableDocumentId = null;
    _pendingRevision = null;
    _pendingPreviewContext = null;
    _draftIssue = MosaicPreviewDraftIssue(
      kind: MosaicPreviewDraftIssueKind.renderFailure,
      code: failure.code,
      message: failure.message,
      location: validation.location,
      recovery: failure.recovery,
    );
    notifyListeners();
  }

  Future<void> _openSocket(int generation) async {
    if (!_shouldReconnect || generation != _lifecycleGeneration) {
      return;
    }
    try {
      final socket = await _connector.connect(
        configuration.endpoint,
        protocols: mosaicLocalPreviewWebSocketProtocols,
      );
      if (!_shouldReconnect || generation != _lifecycleGeneration) {
        await socket.close();
        return;
      }
      _socket = socket;
      final reportsNegotiation = socket is MosaicNegotiatedPreviewSocket;
      final selected = reportsNegotiation ? socket.selectedProtocol : null;
      if (reportsNegotiation &&
          selected != mosaicLocalPreviewWebSocketProtocol) {
        _socket = null;
        _shouldReconnect = false;
        await _closeBestEffort(socket);
        _setConnectionStatus(MosaicPreviewConnectionStatus.disconnected);
        _emitConnectionDiagnostic(
          'preview.noMutualVersion',
          'Studio and the preview client have no mutually supported Local Preview version.',
        );
        return;
      }
      _negotiatedPreviewVersion = mosaicLocalPreviewProtocolVersion;
      _lastInboundAt = _clock();
      _lastTrafficAt = _lastInboundAt;
      _reconnectAttempt = 0;
      _setConnectionStatus(MosaicPreviewConnectionStatus.connected);
      _socketSubscription = socket.messages.listen(
        (message) => _handleSocketMessage(socket, generation, message),
        onError: (Object _) => _handleSocketDrop(socket, generation),
        onDone: () => _handleSocketDrop(socket, generation),
        cancelOnError: false,
      );
      _send(
        'previewClientConnected',
        <String, Object?>{'client': configuration.identity.toJson()},
      );
      _send(
        'capabilityReport',
        mosaicFlutterCapabilityPayload(
          configuration.identity.clientId,
          previewProtocolVersion: _negotiatedPreviewVersion,
        ),
      );
      _startHeartbeat(socket, generation);
    } on Object {
      _emitConnectionDiagnostic(
        'preview.connection.failed',
        'The local preview connection could not be opened.',
      );
      await _scheduleReconnect(generation);
    }
  }

  void _handleSocketMessage(
    MosaicPreviewSocket socket,
    int generation,
    Object? frame,
  ) {
    if (!identical(socket, _socket) || generation != _lifecycleGeneration) {
      return;
    }
    if (frame is! String) {
      _emitConnectionDiagnostic(
        'preview.message.binaryRejected',
        'The preview client rejected a binary WebSocket frame.',
      );
      return;
    }
    if (utf8.encode(frame).length > 2097152) {
      _emitConnectionDiagnostic(
        'preview.message.frameTooLarge',
        'The preview client rejected a frame larger than 2 MiB.',
      );
      return;
    }
    final MosaicPreviewDecodedMessage decoded;
    try {
      decoded = _codec.decode(
        frame,
        expectedSessionId: configuration.sessionId,
        expectedProtocolVersion: _negotiatedPreviewVersion,
      );
    } on Object {
      _emitConnectionDiagnostic(
        'preview.message.invalid',
        'The preview client rejected an invalid preview message.',
      );
      return;
    }
    _lastInboundAt = _clock();
    _lastTrafficAt = _lastInboundAt;
    if (!_seenMessageIds.add(decoded.messageId)) {
      return;
    }
    if (_seenMessageIds.length > 512) {
      _seenMessageIds.remove(_seenMessageIds.first);
    }
    switch (decoded.message) {
      case final MosaicPreviewDraftUpdated update:
        _handleDraft(update);
        return;
      case final MosaicPreviewCommerceStateChanged update:
        _handleCommerce(update);
        return;
      case final MosaicPreviewHeartbeat heartbeat:
        _handleHeartbeat(heartbeat);
        return;
      case final MosaicPreviewRemoteDisconnected disconnected:
        if (disconnected.clientId != configuration.identity.clientId) {
          return;
        }
        _shouldReconnect = disconnected.reason == 'timeout' ||
            disconnected.reason == 'transportError';
        _handleSocketDrop(socket, generation);
        return;
      case MosaicPreviewNoopMessage():
        return;
    }
  }

  void _handleDraft(MosaicPreviewDraftUpdated update) {
    final tracker = _documentTrackers.putIfAbsent(
      update.editableDocumentId,
      _RevisionTracker.new,
    );
    final ordering = tracker.compare(update.revision);
    switch (ordering) {
      case _RevisionOrdering.idempotent:
        for (final response in tracker.responses) {
          _send(response.type, response.payload);
        }
        return;
      case _RevisionOrdering.conflict:
        final diagnostic = _revisionDiagnostic(
          'preview.revision.conflict',
          'This sequence is already associated with another revision.',
        );
        _sendMessage(
          _rejectedMessage(
            update.editableDocumentId,
            update.revision,
            'revisionConflict',
            diagnostic,
          ),
        );
        return;
      case _RevisionOrdering.stale:
        final diagnostic = _revisionDiagnostic(
          'preview.revision.stale',
          'A newer local revision has already been received.',
        );
        _sendMessage(
          _rejectedMessage(
            update.editableDocumentId,
            update.revision,
            'staleRevision',
            diagnostic,
          ),
        );
        return;
      case _RevisionOrdering.newer:
        tracker.advance(update.revision);
        if (_pendingEditableDocumentId == update.editableDocumentId &&
            _pendingRevision != null &&
            _pendingRevision!.sequence < update.revision.sequence) {
          _clearPendingDraft();
        }
    }

    final source = jsonEncode(update.document);
    if (utf8.encode(source).length > mosaicFlutterPreviewMaximumDocumentBytes) {
      final diagnostic = _documentDiagnostic(
        code: 'preview.document.tooLarge',
        message: 'The draft exceeds this preview client’s document limit.',
        location: const MosaicPreviewDiagnosticLocation(documentPath: ''),
        recovery: const MosaicPreviewRecovery(
          action: MosaicPreviewRecoveryAction.removeComponent,
          message: 'Reduce the draft size and send a new local revision.',
        ),
      );
      _rejectValidation(
        update,
        reason: 'documentTooLarge',
        diagnostic: diagnostic,
      );
      return;
    }

    try {
      final document = _decoder.decode(source);
      if (document.schemaVersion != _negotiatedPreviewVersion) {
        final diagnostic = _documentDiagnostic(
          code: 'preview.incompatibleSchemaVersion',
          message:
              'The negotiated Local Preview version cannot carry this draft schema.',
          location: const MosaicPreviewDiagnosticLocation(documentPath: ''),
          recovery: const MosaicPreviewRecovery(
            action: MosaicPreviewRecoveryAction.updatePreviewClient,
            message:
                'Negotiate the matching Local Preview version before sending this draft.',
          ),
        );
        _rejectValidation(
          update,
          reason: 'unsupportedSchemaVersion',
          diagnostic: diagnostic,
        );
        return;
      }
      _pendingDocument = document;
      _pendingEditableDocumentId = update.editableDocumentId;
      _pendingRevision = update.revision;
      _pendingPreviewContext = update.preview;
      _draftIssue = null;
      tracker.responses = const <_OutboundPreviewMessage>[];
      _reportCommerceWarningsIfNeeded(
        editableDocumentId: update.editableDocumentId,
        documentRevision: update.revision,
        document: document,
      );
      notifyListeners();
    } on MosaicProtocolException catch (error) {
      final rejection = _protocolRejection(error, update.document);
      _rejectValidation(
        update,
        reason: rejection.reason,
        diagnostic: rejection.diagnostic,
      );
    } on Object {
      final diagnostic = _documentDiagnostic(
        code: 'preview.validation.failed',
        message:
            'The draft does not conform to the negotiated Mosaic Protocol.',
        location: const MosaicPreviewDiagnosticLocation(documentPath: ''),
        recovery: const MosaicPreviewRecovery(
          action: MosaicPreviewRecoveryAction.restoreLastValidDraft,
          message: 'Review the draft and send a new local revision.',
        ),
      );
      _rejectValidation(
        update,
        reason: 'validationFailed',
        diagnostic: diagnostic,
      );
    }
  }

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
    notifyListeners();
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
        notifyListeners();
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
    final unsupportedSchema = message.contains('Unsupported schemaVersion');
    final unsupportedCapability = message.contains('Unsupported capability') ||
        message.contains('Unsupported component');
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
    notifyListeners();
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

enum _RevisionOrdering { newer, stale, idempotent, conflict }

final class _RevisionTracker {
  MosaicLocalRevision? highest;
  List<_OutboundPreviewMessage> responses = const <_OutboundPreviewMessage>[];

  _RevisionOrdering compare(MosaicLocalRevision revision) {
    final current = highest;
    if (current == null || revision.sequence > current.sequence) {
      return _RevisionOrdering.newer;
    }
    if (revision.sequence < current.sequence) {
      return _RevisionOrdering.stale;
    }
    return revision.revisionId == current.revisionId
        ? _RevisionOrdering.idempotent
        : _RevisionOrdering.conflict;
  }

  void advance(MosaicLocalRevision revision) {
    highest = revision;
    responses = const <_OutboundPreviewMessage>[];
  }

  bool matches(MosaicLocalRevision revision) => highest == revision;
}

final class _OutboundPreviewMessage {
  const _OutboundPreviewMessage({required this.type, required this.payload});

  final String type;
  final Map<String, Object?> payload;
}

final class _ProtocolRejection {
  const _ProtocolRejection({required this.reason, required this.diagnostic});

  final String reason;
  final MosaicPreviewValidationDiagnostic diagnostic;
}

DateTime _utcNow() => DateTime.now().toUtc();

String _escapePointerToken(String value) =>
    value.replaceAll('~', '~0').replaceAll('/', '~1');
