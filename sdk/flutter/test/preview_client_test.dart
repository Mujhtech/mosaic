import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

import 'support/canonical_fixture.dart';

void main() {
  test('accepts local endpoints and rejects remote preview hosts', () {
    for (final endpoint in <String>[
      'ws://127.0.0.1:4317/preview',
      'ws://10.0.2.2:4317/preview',
      'wss://preview.local/preview',
    ]) {
      expect(
        () => MosaicPreviewClientConfiguration(
          endpoint: Uri.parse(endpoint),
          sessionId: 'session_phase2_demo',
          identity: _identity(),
        ),
        returnsNormally,
      );
    }
    for (final endpoint in <String>[
      'wss://preview.example.com/preview',
      'wss://fdexample.com/preview',
      'ws://127.0.0.1:4317/preview?role=studio',
    ]) {
      expect(
        () => MosaicPreviewClientConfiguration(
          endpoint: Uri.parse(endpoint),
          sessionId: 'session_phase2_demo',
          identity: _identity(),
        ),
        throwsArgumentError,
      );
    }
  });

  test('connects with identity then reports exact capabilities', () async {
    final socket = _FakePreviewSocket();
    final connector = _FakePreviewConnector(<_FakePreviewSocket>[socket]);
    final client = _client(connector);

    await client.connect();

    expect(client.connectionStatus, MosaicPreviewConnectionStatus.connected);
    expect(
      connector.protocols.single,
      mosaicLocalPreviewWebSocketProtocols,
    );
    expect(_sentTypes(socket), <String>[
      'previewClientConnected',
      'capabilityReport',
    ]);
    final capability =
        _sentObjects(socket)[1]['payload']! as Map<String, Object?>;
    expect(capability['clientId'], 'client_flutter_example');
    expect(
      (capability['previewCapabilities']! as List<Object?>),
      hasLength(5),
    );

    await client.disconnect();
    expect(_sentTypes(socket).last, 'previewClientDisconnected');
    client.dispose();
  });

  test('keeps acceptance pending until the revision is rendered', () async {
    final socket = _FakePreviewSocket();
    final client = _client(_FakePreviewConnector(<_FakePreviewSocket>[socket]));
    await client.connect();

    socket.add(jsonEncode(_canonicalFlow()[3]));
    final pending = client.pendingRevision!;

    expect(pending.sequence, 2);
    expect(client.documentForRendering?.id, 'phase1-complete-paywall');
    expect(_sentTypes(socket), isNot(contains('draftAccepted')));

    client.markRevisionRendered(pending);

    expect(client.pendingRevision, isNull);
    expect(client.liveRevision, pending);
    expect(_sentTypes(socket).last, 'draftAccepted');
    final accepted =
        _sentObjects(socket).last['payload']! as Map<String, Object?>;
    expect(
      (accepted['revision']! as Map<String, Object?>)['sequence'],
      2,
    );

    await client.disconnect();
    client.dispose();
  });

  test('rejects stale revisions and replays an idempotent acknowledgement',
      () async {
    final socket = _FakePreviewSocket();
    final client = _client(_FakePreviewConnector(<_FakePreviewSocket>[socket]));
    await client.connect();

    final duplicate =
        jsonDecode(jsonEncode(_canonicalFlow()[3])) as Map<String, Object?>;
    duplicate['messageId'] = 'msg_duplicate_000002';
    socket.add(jsonEncode(duplicate));
    client.markRevisionRendered(client.pendingRevision!);
    final acceptedCount =
        _sentTypes(socket).where((type) => type == 'draftAccepted').length;

    socket.add(jsonEncode(_canonicalFlow()[3]));
    expect(
      _sentTypes(socket).where((type) => type == 'draftAccepted').length,
      acceptedCount + 1,
    );

    socket.add(jsonEncode(_canonicalFlow()[6]));
    final rejection = _sentObjects(socket).last;
    expect(rejection['type'], 'draftRejected');
    expect(
      (rejection['payload']! as Map<String, Object?>)['reason'],
      'staleRevision',
    );
    expect(client.liveRevision?.sequence, 2);

    await client.disconnect();
    client.dispose();
  });

  test('rejects invalid and unsupported drafts without replacing live state',
      () async {
    final socket = _FakePreviewSocket();
    final client = _client(_FakePreviewConnector(<_FakePreviewSocket>[socket]));
    await client.connect();
    socket.add(jsonEncode(_canonicalFlow()[3]));
    client.markRevisionRendered(client.pendingRevision!);

    socket.add(jsonEncode(_canonicalFlow()[8]));

    expect(client.liveRevision?.sequence, 2);
    expect(client.documentForRendering?.id, 'phase1-complete-paywall');
    expect(
      client.draftIssue?.kind,
      MosaicPreviewDraftIssueKind.invalidDocument,
    );
    expect(
      _sentTypes(socket).sublist(_sentTypes(socket).length - 2),
      <String>['validationError', 'draftRejected'],
    );

    final unsupported = _unsupportedDraftMessage(sequence: 5);
    socket.add(jsonEncode(unsupported));

    expect(
      client.draftIssue?.kind,
      MosaicPreviewDraftIssueKind.unsupportedComponent,
    );
    expect(client.draftIssue?.location.componentId, 'headline');
    final rejected =
        _sentObjects(socket).last['payload']! as Map<String, Object?>;
    expect(rejected['reason'], 'unsupportedCapability');

    await client.disconnect();
    client.dispose();
  });

  test('invalid newer revision cancels an older pending render', () async {
    final socket = _FakePreviewSocket();
    final client = _client(_FakePreviewConnector(<_FakePreviewSocket>[socket]));
    await client.connect();

    socket.add(jsonEncode(_canonicalFlow()[3]));
    final superseded = client.pendingRevision!;
    socket.add(jsonEncode(_canonicalFlow()[8]));

    expect(client.pendingRevision, isNull);
    expect(client.documentForRendering, isNull);
    client.markRevisionRendered(superseded);
    expect(_sentTypes(socket), isNot(contains('draftAccepted')));
    expect(
      _sentTypes(socket).sublist(_sentTypes(socket).length - 2),
      <String>['validationError', 'draftRejected'],
    );

    await client.disconnect();
    client.dispose();
  });

  test('applies ordered mock commerce and answers heartbeat pings', () async {
    final socket = _FakePreviewSocket();
    final client = _client(_FakePreviewConnector(<_FakePreviewSocket>[socket]));
    await client.connect();

    socket.add(jsonEncode(_canonicalFlow()[2]));
    expect(client.mockCommerceRevision, isNull);

    socket.add(jsonEncode(_canonicalFlow()[3]));
    expect(client.mockCommerceRevision?.sequence, 1);
    expect(
      client.mockCommerceState?.purchaseOutcome,
      MosaicPreviewPurchaseOutcome.purchased,
    );

    socket.add(jsonEncode(_canonicalFlow()[14]));
    final heartbeat = _sentObjects(socket).last;
    expect(heartbeat['type'], 'previewHeartbeat');
    expect(
      heartbeat['payload'],
      containsPair('kind', 'pong'),
    );
    expect(
      heartbeat['payload'],
      containsPair('sequence', 1),
    );

    await client.disconnect();
    client.dispose();
  });

  test('falls back safely when mock products do not match the draft', () async {
    final diagnostics = <MosaicDiagnostic>[];
    final socket = _FakePreviewSocket();
    final client = _client(
      _FakePreviewConnector(<_FakePreviewSocket>[socket]),
      onDiagnostic: diagnostics.add,
    );
    await client.connect();

    final commerce =
        jsonDecode(jsonEncode(_canonicalFlow()[2])) as Map<String, Object?>;
    commerce['messageId'] = 'msg_commerce_mismatch';
    final payload = commerce['payload']! as Map<String, Object?>;
    final state = payload['state']! as Map<String, Object?>;
    final products = state['products']! as List<Object?>;
    final firstProduct = products.first! as Map<String, Object?>;
    firstProduct['productReferenceId'] = 'monthly_mismatch';
    final entitlement = state['entitlement']! as Map<String, Object?>;
    if (entitlement['productReferenceId'] == 'monthly') {
      entitlement['productReferenceId'] = 'monthly_mismatch';
    }

    socket.add(jsonEncode(commerce));
    socket.add(jsonEncode(_canonicalFlow()[3]));

    expect(client.mockCommerceState, isNull);
    expect(
      diagnostics.map((diagnostic) => diagnostic.code),
      contains('preview.commerce.productReferencesMismatch'),
    );
    expect(_sentTypes(socket), contains('renderWarning'));

    await client.disconnect();
    client.dispose();
  });

  test('warns once when later commerce activates the live selector fallback',
      () async {
    final socket = _FakePreviewSocket();
    final client = _client(_FakePreviewConnector(<_FakePreviewSocket>[socket]));
    await client.connect();

    socket.add(jsonEncode(_canonicalFlow()[3]));
    client.markRevisionRendered(client.pendingRevision!);

    final commerce =
        jsonDecode(jsonEncode(_canonicalFlow()[2])) as Map<String, Object?>;
    commerce['messageId'] = 'msg_commerce_unavailable';
    final payload = commerce['payload']! as Map<String, Object?>;
    payload['stateRevision'] = <String, Object?>{
      'revisionId': 'revision_commerce_unavailable',
      'sequence': 2,
    };
    final state = payload['state']! as Map<String, Object?>;
    final products = state['products']! as List<Object?>;
    state['products'] = <Map<String, Object?>>[
      for (final product in products.cast<Map<String, Object?>>())
        <String, Object?>{
          'productReferenceId': product['productReferenceId'],
          'availability': 'unavailable',
          'reason': 'temporarilyUnavailable',
        },
    ];

    socket.add(jsonEncode(commerce));
    expect(
        client.mockCommerceState?.products
            .every((product) => !product.isAvailable),
        isTrue);
    final warnings = _sentObjects(socket)
        .where((message) => message['type'] == 'renderWarning')
        .toList(growable: false);
    expect(warnings, hasLength(1));
    expect(
      warnings.single['payload'],
      containsPair(
        'revision',
        <String, Object?>{'revisionId': 'revision_000002', 'sequence': 2},
      ),
    );

    socket.add(
      jsonEncode(<String, Object?>{
        ...commerce,
        'messageId': 'msg_commerce_unavailable_duplicate',
      }),
    );
    expect(_sentTypes(socket).where((type) => type == 'renderWarning'),
        hasLength(1));

    await client.disconnect();
    client.dispose();
  });

  test('does not reconnect after a terminal server disconnect', () async {
    final socket = _FakePreviewSocket();
    final connector = _FakePreviewConnector(<_FakePreviewSocket>[socket]);
    final client = _client(connector);
    await client.connect();

    socket.add(jsonEncode(_canonicalFlow()[16]));
    await Future<void>.delayed(Duration.zero);

    expect(client.connectionStatus, MosaicPreviewConnectionStatus.disconnected);
    expect(connector.protocols, hasLength(1));

    client.dispose();
  });

  test('ignores a disconnect event for another preview client', () async {
    final socket = _FakePreviewSocket();
    final connector = _FakePreviewConnector(<_FakePreviewSocket>[socket]);
    final client = _client(connector);
    await client.connect();

    final disconnected =
        jsonDecode(jsonEncode(_canonicalFlow()[16])) as Map<String, Object?>;
    disconnected['messageId'] = 'msg_other_client_closed';
    final payload = disconnected['payload']! as Map<String, Object?>;
    payload['clientId'] = 'client_android_example';
    socket.add(jsonEncode(disconnected));

    expect(client.connectionStatus, MosaicPreviewConnectionStatus.connected);
    expect(connector.protocols, hasLength(1));

    await client.disconnect();
    client.dispose();
  });

  test('reconnects with bounded delay and preserves revision ordering',
      () async {
    final first = _FakePreviewSocket();
    final second = _FakePreviewSocket();
    final connector =
        _FakePreviewConnector(<_FakePreviewSocket>[first, second]);
    final delayCompleter = Completer<void>();
    final delays = <Duration>[];
    final client = _client(
      connector,
      delay: (duration) {
        delays.add(duration);
        return delayCompleter.future;
      },
    );
    await client.connect();
    first.add(jsonEncode(_canonicalFlow()[3]));
    client.markRevisionRendered(client.pendingRevision!);

    await first.drop();
    await Future<void>.delayed(Duration.zero);

    expect(client.connectionStatus, MosaicPreviewConnectionStatus.reconnecting);
    expect(delays, <Duration>[const Duration(milliseconds: 250)]);

    delayCompleter.complete();
    await Future<void>.delayed(Duration.zero);
    await Future<void>.delayed(Duration.zero);

    expect(client.connectionStatus, MosaicPreviewConnectionStatus.connected);
    expect(_sentTypes(second).take(2), <String>[
      'previewClientConnected',
      'capabilityReport',
    ]);
    second.add(jsonEncode(_canonicalFlow()[6]));
    expect(_sentTypes(second).last, 'draftRejected');

    await client.disconnect();
    client.dispose();
  });

  test('rejects binary frames with a safe diagnostic', () async {
    final diagnostics = <MosaicDiagnostic>[];
    final socket = _FakePreviewSocket();
    final client = _client(
      _FakePreviewConnector(<_FakePreviewSocket>[socket]),
      onDiagnostic: diagnostics.add,
    );
    await client.connect();

    socket.add(<int>[1, 2, 3]);

    expect(diagnostics.single.code, 'preview.message.binaryRejected');
    expect(diagnostics.single.message, isNot(contains('[1, 2, 3]')));

    await client.disconnect();
    client.dispose();
  });
}

MosaicPreviewClient _client(
  MosaicPreviewSocketConnector connector, {
  MosaicPreviewDelay delay = mosaicPreviewDelay,
  MosaicDiagnosticCallback? onDiagnostic,
}) {
  return MosaicPreviewClient(
    configuration: MosaicPreviewClientConfiguration(
      endpoint: Uri.parse('ws://127.0.0.1:43110/preview'),
      sessionId: 'session_phase2_demo',
      identity: _identity(),
      heartbeatInterval: const Duration(hours: 1),
      peerTimeout: const Duration(hours: 2),
    ),
    connector: connector,
    delay: delay,
    clock: () => DateTime.utc(2026, 7, 17, 8),
    onDiagnostic: onDiagnostic,
  );
}

MosaicPreviewClientIdentity _identity() => MosaicPreviewClientIdentity(
      clientId: 'client_flutter_example',
      displayName: 'Flutter example preview',
      renderer: MosaicPreviewSoftwareIdentity(
        id: 'mosaic.flutter',
        version: '0.1.0',
      ),
      application: MosaicPreviewApplicationIdentity(
        id: 'mosaic.flutter.example',
        displayName: 'Mosaic Flutter Example',
        version: '0.1.0',
      ),
      device: MosaicPreviewDeviceIdentity(
        displayName: 'Local preview device',
        systemName: 'Example OS',
        systemVersion: '1.0',
      ),
    );

List<Map<String, Object?>> _canonicalFlow() {
  return (jsonDecode(
    repositoryFile(
      'protocol/fixtures/local-preview/v0.1/session-flow.messages.json',
    ).readAsStringSync(),
  ) as List<Object?>)
      .cast<Map<String, Object?>>();
}

Map<String, Object?> _unsupportedDraftMessage({required int sequence}) {
  final message =
      jsonDecode(jsonEncode(_canonicalFlow()[3])) as Map<String, Object?>;
  message['messageId'] = 'msg_unsupported_$sequence';
  final payload = message['payload']! as Map<String, Object?>;
  payload['revision'] = <String, Object?>{
    'revisionId': 'revision_unsupported_$sequence',
    'sequence': sequence,
  };
  final document = payload['document']! as Map<String, Object?>;
  final headline = findNode(document, 'text');
  headline['type'] = 'video';
  return message;
}

List<Map<String, Object?>> _sentObjects(_FakePreviewSocket socket) =>
    socket.sent
        .map((source) => jsonDecode(source) as Map<String, Object?>)
        .toList(growable: false);

List<String> _sentTypes(_FakePreviewSocket socket) => _sentObjects(socket)
    .map((message) => message['type']! as String)
    .toList(growable: false);

final class _FakePreviewConnector implements MosaicPreviewSocketConnector {
  _FakePreviewConnector(List<_FakePreviewSocket> sockets)
      : _sockets = List.of(sockets);

  final List<_FakePreviewSocket> _sockets;
  final List<List<String>> protocols = <List<String>>[];

  @override
  Future<MosaicPreviewSocket> connect(
    Uri endpoint, {
    required Iterable<String> protocols,
  }) async {
    this.protocols.add(protocols.toList(growable: false));
    if (_sockets.isEmpty) {
      throw StateError('No fake socket is available.');
    }
    return _sockets.removeAt(0);
  }
}

final class _FakePreviewSocket implements MosaicPreviewSocket {
  final StreamController<Object?> _messages =
      StreamController<Object?>.broadcast(sync: true);
  final List<String> sent = <String>[];

  @override
  Stream<Object?> get messages => _messages.stream;

  void add(Object? message) => _messages.add(message);

  Future<void> drop() => _messages.close();

  @override
  void send(String message) => sent.add(message);

  @override
  Future<void> close() async {
    if (!_messages.isClosed) {
      await _messages.close();
    }
  }
}
