import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

void main() {
  test('reconnect delay doubles and remains bounded', () {
    const policy = MosaicPreviewReconnectPolicy(
      initialDelay: Duration(milliseconds: 100),
      maximumDelay: Duration(milliseconds: 350),
      maximumAttempts: 6,
    );

    expect(policy.delayForAttempt(1), const Duration(milliseconds: 100));
    expect(policy.delayForAttempt(2), const Duration(milliseconds: 200));
    expect(policy.delayForAttempt(3), const Duration(milliseconds: 350));
    expect(policy.delayForAttempt(6), const Duration(milliseconds: 350));
    expect(() => policy.delayForAttempt(0), throwsRangeError);
  });

  test('IO connector negotiates the exact preview subprotocol', () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final serverSocketFuture = server.first.then(
      (request) => WebSocketTransformer.upgrade(
        request,
        protocolSelector: (protocols) {
          expect(protocols, contains(mosaicLocalPreviewWebSocketProtocol));
          return mosaicLocalPreviewWebSocketProtocol;
        },
      ),
    );
    final connector = const MosaicIoPreviewSocketConnector();
    final clientSocket = await connector.connect(
      Uri.parse('ws://127.0.0.1:${server.port}/preview'),
      protocols: const <String>[mosaicLocalPreviewWebSocketProtocol],
    );
    final serverSocket = await serverSocketFuture;

    expect(serverSocket.protocol, mosaicLocalPreviewWebSocketProtocol);
    final inbound = clientSocket.messages.first;
    serverSocket.add('server message');
    expect(await inbound, 'server message');

    final outbound = serverSocket.first;
    clientSocket.send('client message');
    expect(await outbound, 'client message');

    await clientSocket.close();
    await server.close(force: true);
  });
}
