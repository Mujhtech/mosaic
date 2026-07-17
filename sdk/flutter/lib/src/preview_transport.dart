import 'dart:async';
import 'dart:io';

/// A connected local-preview WebSocket boundary.
///
/// The abstraction keeps socket lifecycle tests deterministic and prevents
/// transport details from leaking into preview message handling.
abstract interface class MosaicPreviewSocket {
  Stream<Object?> get messages;

  void send(String message);

  Future<void> close();
}

/// Optional extension exposed by transports that can report the WebSocket
/// subprotocol selected by the peer.
abstract interface class MosaicNegotiatedPreviewSocket
    implements MosaicPreviewSocket {
  String? get selectedProtocol;
}

/// Opens WebSockets for the local-preview client.
abstract interface class MosaicPreviewSocketConnector {
  Future<MosaicPreviewSocket> connect(
    Uri endpoint, {
    required Iterable<String> protocols,
  });
}

/// Native Dart WebSocket connector used by Flutter mobile example apps.
final class MosaicIoPreviewSocketConnector
    implements MosaicPreviewSocketConnector {
  const MosaicIoPreviewSocketConnector();

  @override
  Future<MosaicPreviewSocket> connect(
    Uri endpoint, {
    required Iterable<String> protocols,
  }) async {
    final socket = await WebSocket.connect(
      endpoint.toString(),
      protocols: protocols.toList(growable: false),
    );
    return _MosaicIoPreviewSocket(socket);
  }
}

final class _MosaicIoPreviewSocket implements MosaicNegotiatedPreviewSocket {
  const _MosaicIoPreviewSocket(this._socket);

  final WebSocket _socket;

  @override
  String? get selectedProtocol => _socket.protocol;

  @override
  Stream<Object?> get messages => _socket;

  @override
  void send(String message) => _socket.add(message);

  @override
  Future<void> close() async {
    await _socket.close(WebSocketStatus.normalClosure, 'preview client closed');
  }
}

typedef MosaicPreviewDelay = Future<void> Function(Duration duration);

Future<void> mosaicPreviewDelay(Duration duration) => Future<void>.delayed(
      duration,
    );

/// Bounded exponential reconnect policy for local development.
final class MosaicPreviewReconnectPolicy {
  const MosaicPreviewReconnectPolicy({
    this.initialDelay = const Duration(milliseconds: 250),
    this.maximumDelay = const Duration(seconds: 5),
    this.maximumAttempts = 8,
  }) : assert(maximumAttempts >= 0);

  final Duration initialDelay;
  final Duration maximumDelay;
  final int maximumAttempts;

  Duration delayForAttempt(int attempt) {
    if (attempt < 1) {
      throw RangeError.range(attempt, 1, maximumAttempts, 'attempt');
    }
    var milliseconds = initialDelay.inMilliseconds;
    for (var index = 1; index < attempt; index += 1) {
      if (milliseconds >= maximumDelay.inMilliseconds) {
        return maximumDelay;
      }
      milliseconds *= 2;
    }
    if (milliseconds > maximumDelay.inMilliseconds) {
      milliseconds = maximumDelay.inMilliseconds;
    }
    return Duration(milliseconds: milliseconds);
  }
}
