import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

import 'support/canonical_fixture.dart';

const bool _runRelayIntegration = bool.fromEnvironment(
  'MOSAIC_RUN_RELAY_INTEGRATION',
);
const String _relayEndpoint = String.fromEnvironment(
  'MOSAIC_PREVIEW_ENDPOINT',
  defaultValue: 'ws://127.0.0.1:4317/preview',
);
// Keep this transport smoke test isolated from an interactive Studio session.
// A running Studio may immediately send its current cached revision to any new
// client in `session_local_01`, which is valid relay behaviour but not the
// revision this test is proving.
const String _sessionId = 'session_flutter_relay_test';
const String _editedHeadline = 'Edited live through the local Studio relay';

void main() {
  test(
    'relay delivers a draft and returns its post-render acknowledgement',
    () async {
      final studioMessages = <Map<String, Object?>>[];
      final studio = await WebSocket.connect(
        '$_relayEndpoint?role=studio&sessionId=$_sessionId',
        protocols: const <String>[mosaicLocalPreviewWebSocketProtocol],
      );
      final studioSubscription = studio.listen((frame) {
        if (frame is String) {
          studioMessages.add(
            jsonDecode(frame) as Map<String, Object?>,
          );
        }
      });
      final client = _client();
      await client.connect();
      await _waitUntil(() => studioMessages.length >= 2);

      studio.add(jsonEncode(_messageForSession(2)));
      studio.add(jsonEncode(_editedDraft()));
      await _waitUntil(() => client.pendingRevision != null);
      final headline = client.documentForRendering!.nodes
          .whereType<MosaicTextComponent>()
          .firstWhere((component) => component.id == 'headline');
      expect(headline.value.defaultValue, _editedHeadline);

      client.markRevisionRendered(client.pendingRevision!);
      await _waitUntil(
        () => studioMessages.any(
          (message) => message['type'] == 'draftAccepted',
        ),
      );

      expect(client.liveRevision?.sequence, 2);
      expect(
        studioMessages.map((message) => message['type']),
        containsAllInOrder(<String>[
          'previewClientConnected',
          'capabilityReport',
          'draftAccepted',
        ]),
      );

      await client.disconnect();
      client.dispose();
      await studioSubscription.cancel();
      await studio.close();
    },
    // Start the relay and pass the Dart define to enable this opt-in test.
    skip: !_runRelayIntegration,
  );
}

MosaicPreviewClient _client() => MosaicPreviewClient(
      configuration: MosaicPreviewClientConfiguration(
        endpoint: Uri.parse(_relayEndpoint),
        sessionId: _sessionId,
        identity: MosaicPreviewClientIdentity(
          clientId: 'client_flutter_relay_test',
          displayName: 'Flutter relay integration test',
          renderer: MosaicPreviewSoftwareIdentity(
            id: 'mosaic.flutter',
            version: mosaicFlutterSdkVersion,
          ),
          application: MosaicPreviewApplicationIdentity(
            id: 'mosaic.flutter.relay-test',
            displayName: 'Mosaic Flutter Relay Test',
            version: '1.0.0',
          ),
          device: MosaicPreviewDeviceIdentity(
            displayName: 'Flutter widget test',
            systemName: 'Flutter test',
            systemVersion: 'local',
          ),
        ),
        heartbeatInterval: const Duration(hours: 1),
        peerTimeout: const Duration(hours: 2),
      ),
    );

Map<String, Object?> _editedDraft() {
  final message = _messageForSession(3);
  message['messageId'] = 'msg_flutter_relay_edited';
  final payload = message['payload']! as Map<String, Object?>;
  final document = payload['document']! as Map<String, Object?>;
  final headline = findNode(document, 'text');
  final value = headline['value']! as Map<String, Object?>;
  value['default'] = _editedHeadline;
  final localization = document['localization']! as Map<String, Object?>;
  final locales = localization['locales']! as Map<String, Object?>;
  final english = locales['en']! as Map<String, Object?>;
  final strings = english['strings']! as Map<String, Object?>;
  strings['paywall.headline'] = _editedHeadline;
  return message;
}

Map<String, Object?> _messageForSession(int index) {
  final messages = jsonDecode(
    repositoryFile(
      'protocol/fixtures/local-preview/v0.1/session-flow.messages.json',
    ).readAsStringSync(),
  ) as List<Object?>;
  final message =
      jsonDecode(jsonEncode(messages[index])) as Map<String, Object?>;
  message['sessionId'] = _sessionId;
  return message;
}

Future<void> _waitUntil(bool Function() condition) async {
  for (var attempt = 0; attempt < 200 && !condition(); attempt += 1) {
    await Future<void>.delayed(const Duration(milliseconds: 10));
  }
  expect(condition(), isTrue);
}
