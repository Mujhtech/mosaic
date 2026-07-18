import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_flutter_example/main.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

void main() {
  testWidgets(
    'shows connection, mock commerce, invalid, and unsupported states',
    (tester) async {
      final first = _ExampleSocket();
      final second = _ExampleSocket();
      final reconnect = Completer<void>();
      final client = _client(
        _ExampleConnector(<_ExampleSocket>[first, second]),
        delay: (_) => reconnect.future,
      );
      final fallback = const MosaicProtocolDecoder().decode(
        _repositoryFile(
          'protocol/fixtures/v0.2/complete-paywall.json',
        ).readAsStringSync(),
      );
      final fallbackSelector = fallback.nodes
          .whereType<MosaicProductSelectorComponent>()
          .single;
      expect(fallback.schemaVersion, '0.2');
      expect(
        fallbackSelector.direction,
        MosaicProductSelectorDirection.horizontal,
      );
      await tester.pumpWidget(
        MaterialApp(
          home: PaywallPlayground(
            previewClient: client,
            fallbackDocument: fallback,
          ),
        ),
      );

      expect(find.text('Disconnected'), findsOneWidget);
      expect(find.text('Mock purchase: local fallback'), findsOneWidget);

      await client.connect();
      await tester.pump();
      expect(find.text('Connected'), findsOneWidget);

      final flow = _flow();
      first.add(jsonEncode(flow[2]));
      first.add(jsonEncode(flow[3]));
      await tester.pump();
      await tester.pump();
      await tester.pump();
      await tester.pump();
      expect(find.text('Revision 2'), findsOneWidget);
      expect(find.text('Mock purchase: purchased'), findsOneWidget);

      first.add(jsonEncode(flow[8]));
      await tester.pump();
      expect(find.text('Invalid document'), findsOneWidget);
      expect(find.text('Unlock every Mosaic Pro feature'), findsOneWidget);

      first.add(jsonEncode(_unsupportedUpdate(flow[3])));
      await tester.pump();
      expect(find.text('Unsupported component'), findsOneWidget);
      expect(find.text('Unlock every Mosaic Pro feature'), findsOneWidget);

      await first.drop();
      await tester.pump();
      expect(find.text('Reconnecting'), findsOneWidget);

      reconnect.complete();
      await tester.pump();
      await tester.pump();
      expect(find.text('Connected'), findsOneWidget);

      await client.disconnect();
      await tester.pump();
      expect(find.text('Disconnected'), findsOneWidget);

      await tester.pumpWidget(const SizedBox.shrink());
      client.dispose();
    },
  );
}

MosaicPreviewClient _client(
  MosaicPreviewSocketConnector connector, {
  required MosaicPreviewDelay delay,
}) {
  return MosaicPreviewClient(
    configuration: MosaicPreviewClientConfiguration(
      endpoint: Uri.parse('ws://127.0.0.1:4317/preview'),
      sessionId: 'session_local_01',
      identity: MosaicPreviewClientIdentity(
        clientId: 'client_flutter_example',
        displayName: 'Flutter example preview',
        renderer: MosaicPreviewSoftwareIdentity(
          id: 'mosaic.flutter',
          version: '0.2.0',
        ),
        application: MosaicPreviewApplicationIdentity(
          id: 'mosaic.flutter.example',
          displayName: 'Mosaic Flutter Example',
          version: '0.2.0',
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
    connector: connector,
    delay: delay,
    clock: () => DateTime.utc(2026, 7, 17, 8),
  );
}

List<Map<String, Object?>> _flow() {
  final messages =
      (jsonDecode(
                _repositoryFile(
                  'protocol/fixtures/local-preview/v0.2/session-flow.messages.json',
                ).readAsStringSync(),
              )
              as List<Object?>)
          .cast<Map<String, Object?>>();
  for (final message in messages) {
    message['sessionId'] = 'session_local_01';
  }
  return messages;
}

Map<String, Object?> _unsupportedUpdate(Map<String, Object?> valid) {
  final message = jsonDecode(jsonEncode(valid)) as Map<String, Object?>;
  message['messageId'] = 'msg_example_unsupported';
  final payload = message['payload']! as Map<String, Object?>;
  payload['revision'] = <String, Object?>{
    'revisionId': 'revision_example_000004',
    'sequence': 4,
  };
  final document = payload['document']! as Map<String, Object?>;
  final screens = document['screens']! as List<Object?>;
  final initialScreen = screens.first! as Map<String, Object?>;
  final content =
      (initialScreen['layout']! as Map<String, Object?>)['content']!
          as Map<String, Object?>;
  final children = content['children']! as List<Object?>;
  final headline = children.cast<Map<String, Object?>>().firstWhere(
    (node) => node['id'] == 'headline',
  );
  headline['type'] = 'video';
  return message;
}

File _repositoryFile(String relativePath) {
  var directory = Directory.current.absolute;
  while (true) {
    final candidate = File('${directory.path}/$relativePath');
    if (candidate.existsSync()) {
      return candidate;
    }
    final parent = directory.parent;
    if (parent.path == directory.path) {
      throw StateError('Could not locate $relativePath.');
    }
    directory = parent;
  }
}

final class _ExampleConnector implements MosaicPreviewSocketConnector {
  _ExampleConnector(List<_ExampleSocket> sockets) : _sockets = List.of(sockets);

  final List<_ExampleSocket> _sockets;

  @override
  Future<MosaicPreviewSocket> connect(
    Uri endpoint, {
    required Iterable<String> protocols,
  }) async => _sockets.removeAt(0);
}

final class _ExampleSocket implements MosaicNegotiatedPreviewSocket {
  final StreamController<Object?> _controller =
      StreamController<Object?>.broadcast(sync: true);
  final List<String> sent = <String>[];

  @override
  String get selectedProtocol => mosaicLocalPreviewV02WebSocketProtocol;

  @override
  Stream<Object?> get messages => _controller.stream;

  void add(String message) => _controller.add(message);

  Future<void> drop() => _controller.close();

  @override
  void send(String message) => sent.add(message);

  @override
  Future<void> close() async {
    if (!_controller.isClosed) {
      unawaited(_controller.close());
    }
  }
}
