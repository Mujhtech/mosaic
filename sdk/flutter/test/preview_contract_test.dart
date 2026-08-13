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

  test('decodes every canonical Local Preview message exactly', () {
    final messages = jsonFixture(
      'local-preview/v0.4/session-flow.messages.json',
    )! as List<Object?>;
    const codec = MosaicPreviewMessageCodec();
    for (final value in messages) {
      final source = jsonEncode(value);
      final decoded = codec.decode(
        source,
        expectedSessionId: 'session_phase2_demo',
        expectedProtocolVersion: mosaicLocalPreviewProtocolVersion,
      );
      expect(decoded.protocolVersion, mosaicLocalPreviewProtocolVersion);
    }
  });

  test('strictly loads the canonical Local Preview project', () {
    const codec = MosaicPreviewMessageCodec();
    final v03 = codec.decodeLocalProject(
      File('${root.path}/protocol/fixtures/local-preview/v0.4/local-project.json')
          .readAsStringSync(),
      expectedFileFormatVersion: mosaicLocalPreviewProtocolVersion,
    );

    expect(v03.fileFormatVersion, mosaicLocalPreviewProtocolVersion);
    expect(v03.document.schemaVersion, mosaicProtocolVersion);
    expect(
      v03.commerceState.products.map((product) => product.productReferenceId),
      <String>['monthly-plan', 'yearly-plan', 'lifetime-plan'],
    );
  });

  test('local project loading is atomic across wrapper and document versions',
      () {
    final project = jsonFixture('local-preview/v0.4/local-project.json')!
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
        expectedFileFormatVersion: mosaicLocalPreviewProtocolVersion,
      ),
      throwsA(isA<MosaicPreviewProtocolException>()),
    );
  });

  test('negotiates the single exact WebSocket subprotocol', () {
    final negotiated = negotiateMosaicLocalPreviewVersion(
      const <String>[mosaicLocalPreviewProtocolVersion],
      const <String>[mosaicLocalPreviewProtocolVersion],
    );
    expect(negotiated.selectedVersion, mosaicLocalPreviewProtocolVersion);
    expect(
      negotiated.selectedWebSocketSubprotocol,
      mosaicLocalPreviewWebSocketProtocol,
    );

    // Exactly one subprotocol is offered. A peer speaking only a retired
    // version has no overlap and is refused rather than served a version it
    // did not offer; Studio keeps its last accepted draft.
    expect(
      negotiateMosaicLocalPreviewVersion(
        const <String>[mosaicLocalPreviewProtocolVersion],
        const <String>['0.3'],
      ).diagnosticCode,
      'preview.noMutualVersion',
    );
  });

  test('gates a draft by exact report and compact UTF-8 bytes', () {
    final messages = jsonFixture(
      'local-preview/v0.4/session-flow.messages.json',
    )! as List<Object?>;
    final capability = messages.cast<Map<String, Object?>>().firstWhere(
            (message) => message['type'] == 'capabilityReport')['payload']!
        as Map<String, Object?>;
    final project = jsonFixture('local-preview/v0.4/local-project.json')!
        as Map<String, Object?>;
    final document = project['document']! as Map<String, Object?>;
    final negotiation = negotiateMosaicLocalPreviewVersion(
      const <String>[mosaicLocalPreviewProtocolVersion],
      const <String>[mosaicLocalPreviewProtocolVersion],
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

  test('the capability report is exact', () {
    final messages = jsonFixture(
      'local-preview/v0.4/session-flow.messages.json',
    )! as List<Object?>;
    final canonical = messages.cast<Map<String, Object?>>().firstWhere(
            (message) => message['type'] == 'capabilityReport')['payload']!
        as Map<String, Object?>;
    final payload = mosaicFlutterCapabilityPayload(
      'client_flutter_example',
      previewProtocolVersion: mosaicLocalPreviewProtocolVersion,
    );
    expect(payload, canonical);
  });

  test('client uses negotiated envelopes and retains last accepted draft',
      () async {
    final messages = jsonFixture(
      'local-preview/v0.4/session-flow.messages.json',
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
    final socket = _PreviewSocket();
    final client = MosaicPreviewClient(
      configuration: MosaicPreviewClientConfiguration(
        endpoint: Uri.parse('ws://127.0.0.1:7331/preview'),
        sessionId: 'session_phase2_demo',
        identity: _identity(),
      ),
      connector: _PreviewConnector(socket),
    );
    addTearDown(client.dispose);

    await client.connect();
    expect(client.negotiatedPreviewVersion, mosaicLocalPreviewProtocolVersion);
    final outbound = socket.sent
        .map((source) => jsonDecode(source) as Map<String, Object?>)
        .toList(growable: false);
    expect(
      outbound.map((message) => message['previewProtocolVersion']),
      everyElement(mosaicLocalPreviewProtocolVersion),
    );
    final report =
        outbound.firstWhere((message) => message['type'] == 'capabilityReport');
    expect(
      (report['payload']! as Map<String, Object?>)['supportedSchemaVersions'],
      <String>[mosaicProtocolVersion],
    );

    socket.add(jsonEncode(valid));
    await Future<void>.delayed(Duration.zero);
    expect(client.documentForRendering?.schemaVersion, mosaicProtocolVersion);
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
    final socket = _PreviewSocket(selectedProtocol: null);
    final client = MosaicPreviewClient(
      configuration: MosaicPreviewClientConfiguration(
        endpoint: Uri.parse('ws://127.0.0.1:7331/preview'),
        sessionId: 'session_phase2_demo',
        identity: _identity(),
      ),
      connector: _PreviewConnector(socket),
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
      clientId: 'client_flutter_preview_test',
      displayName: 'Flutter preview test',
      renderer: MosaicPreviewSoftwareIdentity(
        id: 'mosaic.flutter',
        version: '0.3.0',
      ),
      application: MosaicPreviewApplicationIdentity(
        id: 'mosaic.flutter.test',
        displayName: 'Mosaic Flutter tests',
        version: '0.3.0',
      ),
      device: MosaicPreviewDeviceIdentity(
        displayName: 'Test device',
        systemName: 'Flutter Test',
        systemVersion: '1.0',
      ),
    );

final class _PreviewConnector implements MosaicPreviewSocketConnector {
  const _PreviewConnector(this.socket);

  final _PreviewSocket socket;

  @override
  Future<MosaicPreviewSocket> connect(
    Uri endpoint, {
    required Iterable<String> protocols,
  }) async {
    expect(protocols, mosaicLocalPreviewWebSocketProtocols);
    return socket;
  }
}

final class _PreviewSocket implements MosaicNegotiatedPreviewSocket {
  _PreviewSocket({this.selectedProtocol = mosaicLocalPreviewWebSocketProtocol});

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
