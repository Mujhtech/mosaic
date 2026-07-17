import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

void main() {
  final root = Directory.current.parent.parent;

  Object? jsonFixture(String path) => jsonDecode(
        File('${root.path}/protocol/fixtures/$path').readAsStringSync(),
      );

  test('decodes every canonical Local Preview 0.2 message exactly', () {
    final messages = jsonFixture(
      'local-preview/v0.2/session-flow.messages.json',
    )! as List<Object?>;
    const codec = MosaicPreviewMessageCodec();
    for (final value in messages) {
      final source = jsonEncode(value);
      final decoded = codec.decode(
        source,
        expectedSessionId: 'session_phase2_demo',
        expectedProtocolVersion: mosaicLocalPreviewV02ProtocolVersion,
      );
      expect(decoded.protocolVersion, '0.2');
    }
  });

  test('strictly loads both canonical local project formats', () {
    const codec = MosaicPreviewMessageCodec();
    final v01 = codec.decodeLocalProject(
      File('${root.path}/protocol/fixtures/local-preview/v0.1/local-project.json')
          .readAsStringSync(),
    );
    final v02 = codec.decodeLocalProject(
      File('${root.path}/protocol/fixtures/local-preview/v0.2/local-project.json')
          .readAsStringSync(),
      expectedFileFormatVersion: mosaicLocalPreviewV02ProtocolVersion,
    );

    expect(v01.fileFormatVersion, '0.1');
    expect(v01.document.schemaVersion, '0.1');
    expect(v02.fileFormatVersion, '0.2');
    expect(v02.document.schemaVersion, '0.2');
    expect(v02.commerceState.products, hasLength(2));
  });

  test('local project loading is atomic across wrapper and document versions',
      () {
    final project = jsonFixture('local-preview/v0.2/local-project.json')!
        as Map<String, Object?>;
    final mismatched = <String, Object?>{
      ...project,
      'fileFormatVersion': '0.1',
    };
    expect(
      () => const MosaicPreviewMessageCodec().decodeLocalProject(
        jsonEncode(mismatched),
      ),
      throwsA(isA<MosaicPreviewProtocolException>()),
    );

    final unknown = <String, Object?>{...project, 'flutterOnly': true};
    expect(
      () => const MosaicPreviewMessageCodec().decodeLocalProject(
        jsonEncode(unknown),
        expectedFileFormatVersion: mosaicLocalPreviewV02ProtocolVersion,
      ),
      throwsA(isA<MosaicPreviewProtocolException>()),
    );
  });

  test('negotiates the highest mutual exact WebSocket subprotocol', () {
    final v02 = negotiateMosaicLocalPreviewVersion(
      const <String>['0.1', '0.2'],
      const <String>['0.2', '0.1'],
    );
    expect(v02.selectedVersion, '0.2');
    expect(v02.selectedWebSocketSubprotocol, 'mosaic.local-preview.v0.2');

    final fallback = negotiateMosaicLocalPreviewVersion(
      const <String>['0.1', '0.2'],
      const <String>['0.1'],
    );
    expect(fallback.selectedVersion, '0.1');
    expect(fallback.selectedWebSocketSubprotocol, 'mosaic.local-preview.v0.1');

    expect(
      negotiateMosaicLocalPreviewVersion(
        const <String>['0.2'],
        const <String>['0.1'],
      ).diagnosticCode,
      'preview.noMutualVersion',
    );
  });

  test('gates a 0.2 draft by exact report and compact UTF-8 bytes', () {
    final messages = jsonFixture(
      'local-preview/v0.2/session-flow.messages.json',
    )! as List<Object?>;
    final capability = messages.cast<Map<String, Object?>>().firstWhere(
            (message) => message['type'] == 'capabilityReport')['payload']!
        as Map<String, Object?>;
    final project = jsonFixture('local-preview/v0.2/local-project.json')!
        as Map<String, Object?>;
    final document = project['document']! as Map<String, Object?>;
    final negotiation = negotiateMosaicLocalPreviewVersion(
      const <String>['0.1', '0.2'],
      const <String>['0.1', '0.2'],
    );

    expect(
      decideMosaicPreviewDraftDelivery(
        negotiation: negotiation,
        capabilityReport: capability,
        document: document,
      ),
      isA<MosaicPreviewDraftSend>(),
    );

    final limited = <String, Object?>{
      ...capability,
      'limits': <String, Object?>{'maxDocumentBytes': 1},
    };
    final withheld = decideMosaicPreviewDraftDelivery(
      negotiation: negotiation,
      capabilityReport: limited,
      document: document,
    );
    expect(withheld, isA<MosaicPreviewDraftWithhold>());
    expect(
      (withheld as MosaicPreviewDraftWithhold).code,
      'preview.documentTooLarge',
    );
    expect(withheld.fallback, 'keepLastAcceptedDraft');
  });

  test('matches the canonical 0.1-client withholding decision', () {
    final fixture = jsonFixture(
      'local-preview/v0.2/incompatible-v0.1-client.json',
    )! as Map<String, Object?>;
    final project = jsonFixture('local-preview/v0.2/local-project.json')!
        as Map<String, Object?>;
    final negotiation = negotiateMosaicLocalPreviewVersion(
      (fixture['studioSupportedPreviewVersions']! as List<Object?>)
          .cast<String>(),
      (fixture['clientSupportedPreviewVersions']! as List<Object?>)
          .cast<String>(),
    );
    final decision = decideMosaicPreviewDraftDelivery(
      negotiation: negotiation,
      capabilityReport: mosaicFlutterCapabilityPayload(
        'client_flutter_example',
      ),
      document: project['document']! as Map<String, Object?>,
    );
    final expected = fixture['diagnostic']! as Map<String, Object?>;
    final expectedRecovery = expected['recovery']! as Map<String, Object?>;

    expect(negotiation.selectedVersion, fixture['selectedPreviewVersion']);
    expect(
      negotiation.selectedWebSocketSubprotocol,
      fixture['selectedWebSocketSubprotocol'],
    );
    expect(decision, isA<MosaicPreviewDraftWithhold>());
    final withheld = decision as MosaicPreviewDraftWithhold;
    expect(withheld.code, expected['code']);
    expect(withheld.message, expected['message']);
    expect(withheld.fallback, expected['fallback']);
    expect(withheld.recoveryAction, expectedRecovery['action']);
    expect(withheld.recoveryMessage, expectedRecovery['message']);
  });

  test('0.2 capability report is exact and retains 0.1 reader support', () {
    final messages = jsonFixture(
      'local-preview/v0.2/session-flow.messages.json',
    )! as List<Object?>;
    final canonical = messages.cast<Map<String, Object?>>().firstWhere(
            (message) => message['type'] == 'capabilityReport')['payload']!
        as Map<String, Object?>;
    final payload = mosaicFlutterCapabilityPayload(
      'client_flutter_example',
      previewProtocolVersion: mosaicLocalPreviewV02ProtocolVersion,
    );
    expect(payload, canonical);
  });

  test('client uses negotiated 0.2 envelopes and retains last accepted draft',
      () async {
    final messages = jsonFixture(
      'local-preview/v0.2/session-flow.messages.json',
    )! as List<Object?>;
    final drafts = messages
        .cast<Map<String, Object?>>()
        .where((message) => message['type'] == 'draftUpdated')
        .toList(growable: false);
    final valid = drafts.firstWhere((message) {
      final payload = message['payload']! as Map<String, Object?>;
      try {
        const MosaicProtocolDecoder().decode(jsonEncode(payload['document']));
        return true;
      } on Object {
        return false;
      }
    });
    final invalid = drafts.firstWhere((message) {
      final payload = message['payload']! as Map<String, Object?>;
      try {
        const MosaicProtocolDecoder().decode(jsonEncode(payload['document']));
        return false;
      } on Object {
        return true;
      }
    });
    final socket = _V02Socket();
    final client = MosaicPreviewClient(
      configuration: MosaicPreviewClientConfiguration(
        endpoint: Uri.parse('ws://127.0.0.1:7331/preview'),
        sessionId: 'session_phase2_demo',
        identity: _identity(),
      ),
      connector: _V02Connector(socket),
    );
    addTearDown(client.dispose);

    await client.connect();
    expect(client.negotiatedPreviewVersion, '0.2');
    final outbound = socket.sent
        .map((source) => jsonDecode(source) as Map<String, Object?>)
        .toList(growable: false);
    expect(
      outbound.map((message) => message['previewProtocolVersion']),
      everyElement('0.2'),
    );
    final report =
        outbound.firstWhere((message) => message['type'] == 'capabilityReport');
    expect(
      (report['payload']! as Map<String, Object?>)['supportedSchemaVersions'],
      <String>['0.1', '0.2'],
    );

    socket.add(jsonEncode(valid));
    await Future<void>.delayed(Duration.zero);
    expect(client.documentForRendering?.schemaVersion, '0.2');
    final acceptedRevision = client.pendingRevision!;
    client.markRevisionRendered(acceptedRevision);
    final acceptedDocument = client.documentForRendering;

    socket.add(jsonEncode(invalid));
    await Future<void>.delayed(Duration.zero);
    expect(client.documentForRendering, same(acceptedDocument));
    expect(client.draftIssue, isNotNull);
  });

  test('client withholds all messages when no subprotocol was negotiated',
      () async {
    final diagnostics = <MosaicDiagnostic>[];
    final socket = _V02Socket(selectedProtocol: null);
    final client = MosaicPreviewClient(
      configuration: MosaicPreviewClientConfiguration(
        endpoint: Uri.parse('ws://127.0.0.1:7331/preview'),
        sessionId: 'session_phase2_demo',
        identity: _identity(),
      ),
      connector: _V02Connector(socket),
      onDiagnostic: diagnostics.add,
    );
    addTearDown(client.dispose);

    await client.connect();

    expect(client.connectionStatus, MosaicPreviewConnectionStatus.disconnected);
    expect(socket.sent, isEmpty);
    expect(diagnostics.single.code, 'preview.noMutualVersion');
  });
}

MosaicPreviewClientIdentity _identity() => MosaicPreviewClientIdentity(
      clientId: 'client_flutter_v02_test',
      displayName: 'Flutter 0.2 test',
      renderer: MosaicPreviewSoftwareIdentity(
        id: 'mosaic.flutter',
        version: '0.2.0',
      ),
      application: MosaicPreviewApplicationIdentity(
        id: 'mosaic.flutter.test',
        displayName: 'Mosaic Flutter tests',
        version: '0.2.0',
      ),
      device: MosaicPreviewDeviceIdentity(
        displayName: 'Test device',
        systemName: 'Flutter Test',
        systemVersion: '1.0',
      ),
    );

final class _V02Connector implements MosaicPreviewSocketConnector {
  const _V02Connector(this.socket);

  final _V02Socket socket;

  @override
  Future<MosaicPreviewSocket> connect(
    Uri endpoint, {
    required Iterable<String> protocols,
  }) async {
    expect(protocols, mosaicLocalPreviewWebSocketProtocols);
    return socket;
  }
}

final class _V02Socket implements MosaicNegotiatedPreviewSocket {
  _V02Socket({this.selectedProtocol = mosaicLocalPreviewV02WebSocketProtocol});

  final StreamController<Object?> _controller =
      StreamController<Object?>.broadcast(sync: true);
  final List<String> sent = <String>[];

  @override
  final String? selectedProtocol;

  @override
  Stream<Object?> get messages => _controller.stream;

  void add(String source) => _controller.add(source);

  @override
  void send(String message) => sent.add(message);

  @override
  Future<void> close() => _controller.close();
}
