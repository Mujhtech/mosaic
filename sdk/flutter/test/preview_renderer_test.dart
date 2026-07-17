import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

import 'support/canonical_fixture.dart';

void main() {
  testWidgets(
      'live revision rerenders, scales text, uses RTL, and acknowledges',
      (tester) async {
    final socket = _WidgetFakeSocket();
    final client = _client(socket);
    await client.connect();
    socket.add(jsonEncode(_canonicalFlow()[2]));
    socket.add(jsonEncode(_canonicalFlow()[3]));

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: MosaicPreviewPaywall(
            client: client,
            fallbackDocument: decodeCanonicalFixture(),
            fallbackPurchaseProvider: _fallbackProvider(),
            onResult: (_) {},
          ),
        ),
      ),
    );
    await tester.pump();

    expect(find.text('Unlock every Mosaic Pro feature'), findsOneWidget);
    expect(_sentTypes(socket), contains('draftAccepted'));
    expect(client.liveRevision?.sequence, 2);

    socket.add(jsonEncode(_localizedUpdate(sequence: 5)));
    await tester.pump();
    await tester.pump();

    expect(find.text('افتح جميع مزايا Mosaic Pro'), findsOneWidget);
    final rtl = tester
        .widgetList<Directionality>(find.byType(Directionality))
        .where((widget) => widget.textDirection == TextDirection.rtl);
    expect(rtl, isNotEmpty);
    final previewMedia = tester
        .widgetList<MediaQuery>(find.byType(MediaQuery))
        .firstWhere((media) => media.data.textScaler.scale(10) == 20);
    expect(previewMedia.data.textScaler.scale(10), 20);
    expect(client.liveRevision?.sequence, 5);

    await tester.pumpWidget(const SizedBox.shrink());
    client.dispose();
  });

  testWidgets('render failure restores the last accepted draft',
      (tester) async {
    final socket = _WidgetFakeSocket();
    final client = _client(socket);
    await client.connect();
    socket.add(jsonEncode(_canonicalFlow()[3]));
    client.markRevisionRendered(client.pendingRevision!);

    socket.add(jsonEncode(_localizedUpdate(sequence: 5)));
    client.reportRenderFailure(
      const MosaicPreviewRenderDiagnostic(
        code: 'preview.render.failed',
        message: 'The revision could not be rendered safely.',
        recovery: MosaicPreviewRecovery(
          action: MosaicPreviewRecoveryAction.inspectComponent,
          message: 'Inspect the affected component and send a new revision.',
        ),
      ),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: MosaicPreviewPaywall(
          client: client,
          fallbackDocument: decodeCanonicalFixture(),
          fallbackPurchaseProvider: _fallbackProvider(),
          onResult: (_) {},
        ),
      ),
    );
    await tester.pump();

    expect(find.text('Unlock every Mosaic Pro feature'), findsOneWidget);
    expect(client.liveRevision?.sequence, 2);
    expect(client.draftIssue?.kind, MosaicPreviewDraftIssueKind.renderFailure);
    expect(
      _sentTypes(socket).sublist(_sentTypes(socket).length - 2),
      <String>['renderFailure', 'draftRejected'],
    );

    await tester.pumpWidget(const SizedBox.shrink());
    client.dispose();
  });
}

MosaicPreviewClient _client(_WidgetFakeSocket socket) => MosaicPreviewClient(
      configuration: MosaicPreviewClientConfiguration(
        endpoint: Uri.parse('ws://127.0.0.1:43110/preview'),
        sessionId: 'session_phase2_demo',
        identity: MosaicPreviewClientIdentity(
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
            displayName: 'Widget test',
            systemName: 'Flutter test',
            systemVersion: '1.0',
          ),
        ),
        heartbeatInterval: const Duration(hours: 1),
        peerTimeout: const Duration(hours: 2),
      ),
      connector: _WidgetFakeConnector(socket),
      clock: () => DateTime.utc(2026, 7, 17, 8),
    );

MockMosaicPurchaseProvider _fallbackProvider() => MockMosaicPurchaseProvider(
      products: const <MosaicProduct>[
        MosaicProduct(
          id: 'mosaic_pro_monthly',
          title: 'Monthly',
          localizedPrice: r'$5.99',
          localizedPeriod: 'month',
        ),
        MosaicProduct(
          id: 'mosaic_pro_yearly',
          title: 'Yearly',
          localizedPrice: r'$49.99',
          localizedPeriod: 'year',
        ),
      ],
    );

List<Map<String, Object?>> _canonicalFlow() => (jsonDecode(
      repositoryFile(
        'protocol/fixtures/local-preview/v0.1/session-flow.messages.json',
      ).readAsStringSync(),
    ) as List<Object?>)
        .cast<Map<String, Object?>>();

Map<String, Object?> _localizedUpdate({required int sequence}) {
  final update =
      jsonDecode(jsonEncode(_canonicalFlow()[3])) as Map<String, Object?>;
  update['messageId'] = 'msg_localized_$sequence';
  final payload = update['payload']! as Map<String, Object?>;
  payload['revision'] = <String, Object?>{
    'revisionId': 'revision_localized_$sequence',
    'sequence': sequence,
  };
  payload['preview'] = <String, Object?>{
    'locale': 'ar',
    'textScale': 2,
  };
  return update;
}

List<String> _sentTypes(_WidgetFakeSocket socket) => socket.sent
    .map((source) =>
        (jsonDecode(source) as Map<String, Object?>)['type']! as String)
    .toList(growable: false);

final class _WidgetFakeConnector implements MosaicPreviewSocketConnector {
  const _WidgetFakeConnector(this.socket);

  final _WidgetFakeSocket socket;

  @override
  Future<MosaicPreviewSocket> connect(
    Uri endpoint, {
    required Iterable<String> protocols,
  }) async =>
      socket;
}

final class _WidgetFakeSocket implements MosaicPreviewSocket {
  final StreamController<Object?> _controller =
      StreamController<Object?>.broadcast(sync: true);
  final List<String> sent = <String>[];

  @override
  Stream<Object?> get messages => _controller.stream;

  void add(String message) => _controller.add(message);

  @override
  void send(String message) => sent.add(message);

  @override
  Future<void> close() async {
    if (!_controller.isClosed) {
      await _controller.close();
    }
  }
}
