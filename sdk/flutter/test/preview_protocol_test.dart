import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

import 'support/canonical_fixture.dart';

void main() {
  const codec = MosaicPreviewMessageCodec();

  test('decodes every canonical Local Preview 0.1 flow message', () {
    final messages = _canonicalFlow();
    final decoded = <MosaicPreviewDecodedMessage>[
      for (final message in messages)
        codec.decode(
          jsonEncode(message),
          expectedSessionId: 'session_phase2_demo',
        ),
    ];

    expect(decoded, hasLength(17));
    expect(decoded.first.messageId, 'msg_000001');
    expect(decoded[2].message, isA<MosaicPreviewCommerceStateChanged>());
    expect(decoded[3].message, isA<MosaicPreviewDraftUpdated>());
    expect(decoded[14].message, isA<MosaicPreviewHeartbeat>());
    expect(decoded.last.message, isA<MosaicPreviewRemoteDisconnected>());

    final commerce = decoded[2].message as MosaicPreviewCommerceStateChanged;
    expect(commerce.stateRevision.sequence, 1);
    expect(commerce.state.products, hasLength(2));
    final yearly =
        commerce.state.products[1] as MosaicPreviewSubscriptionProduct;
    expect(yearly.introductoryOffer?.localizedPrice, r'$39.99');

    final update = decoded[3].message as MosaicPreviewDraftUpdated;
    expect(update.editableDocumentId, 'document_phase2_demo');
    expect(update.revision.revisionId, 'revision_000002');
    expect(update.preview.locale, 'en');
    expect(update.preview.textScale, 1);
    expect(update.document['schemaVersion'], '0.1');
  });

  test('rejects unknown envelope fields, sessions, and binary-like JSON', () {
    final source = Map<String, Object?>.from(_canonicalFlow()[3]);
    source['unknown'] = true;
    expect(
      () => codec.decode(
        jsonEncode(source),
        expectedSessionId: 'session_phase2_demo',
      ),
      throwsA(isA<MosaicPreviewProtocolException>()),
    );

    expect(
      () => codec.decode(
        jsonEncode(_canonicalFlow()[3]),
        expectedSessionId: 'session_another',
      ),
      throwsA(isA<MosaicPreviewProtocolException>()),
    );
    expect(
      () => codec.decode(
        '[1,2,3]',
        expectedSessionId: 'session_phase2_demo',
      ),
      throwsA(isA<MosaicPreviewProtocolException>()),
    );

    final oversizedId = Map<String, Object?>.from(_canonicalFlow()[3]);
    oversizedId['messageId'] = 'msg_${List.filled(97, 'a').join()}';
    expect(
      () => codec.decode(
        jsonEncode(oversizedId),
        expectedSessionId: 'session_phase2_demo',
      ),
      throwsA(isA<MosaicPreviewProtocolException>()),
    );
  });

  test('matches regex-only timestamps and empty mock commerce from the schema',
      () {
    final commerce =
        jsonDecode(jsonEncode(_canonicalFlow()[2])) as Map<String, Object?>;
    commerce['sentAt'] = '2026-07-17T99:00:00Z';
    final payload = commerce['payload']! as Map<String, Object?>;
    final state = payload['state']! as Map<String, Object?>;
    state['products'] = <Object?>[];

    final decoded = codec.decode(
      jsonEncode(commerce),
      expectedSessionId: 'session_phase2_demo',
    );

    expect(decoded.sentAt, '2026-07-17T99:00:00Z');
    expect(
      (decoded.message as MosaicPreviewCommerceStateChanged).state.products,
      isEmpty,
    );
  });

  test('capability payload reports the full renderer and preview contract', () {
    final payload = mosaicFlutterCapabilityPayload('client_flutter_example');
    final supported = (payload['supportedCapabilities']! as List<Object?>)
        .cast<Map<String, Object?>>()
        .map((item) => item['name']);
    final preview = (payload['previewCapabilities']! as List<Object?>)
        .cast<Map<String, Object?>>()
        .map((item) => item['name']);

    expect(supported, unorderedEquals(mosaicProtocolV01Capabilities));
    expect(preview, unorderedEquals(mosaicFlutterPreviewCapabilities));
    expect(
      (payload['limits']! as Map<String, Object?>)['maxDocumentBytes'],
      1048576,
    );

    final capabilityMessage =
        jsonDecode(jsonEncode(_canonicalFlow()[1])) as Map<String, Object?>;
    final messagePayload =
        capabilityMessage['payload']! as Map<String, Object?>;
    final previewCapabilities =
        messagePayload['previewCapabilities']! as List<Object?>;
    final first = previewCapabilities.first! as Map<String, Object?>;
    first['version'] = '0.2';
    expect(
      () => codec.decode(
        jsonEncode(capabilityMessage),
        expectedSessionId: 'session_phase2_demo',
      ),
      throwsA(isA<MosaicPreviewProtocolException>()),
    );
  });

  test('codec emits the exact six-field envelope', () {
    final source = codec.encode(
      messageId: 'msg_flutter_1',
      sessionId: 'session_phase2_demo',
      sentAt: DateTime.utc(2026, 7, 17, 8),
      type: 'previewHeartbeat',
      payload: const <String, Object?>{
        'clientId': 'client_flutter_example',
        'kind': 'pong',
        'sequence': 3,
      },
    );
    final object = jsonDecode(source) as Map<String, Object?>;

    expect(object.keys, <String>{
      'previewProtocolVersion',
      'messageId',
      'sessionId',
      'sentAt',
      'type',
      'payload',
    });
    expect(object['previewProtocolVersion'], '0.1');
    expect(object['sentAt'], '2026-07-17T08:00:00.000Z');
  });
}

List<Map<String, Object?>> _canonicalFlow() {
  final source = repositoryFile(
    'protocol/fixtures/local-preview/v0.1/session-flow.messages.json',
  ).readAsStringSync();
  return (jsonDecode(source) as List<Object?>).cast<Map<String, Object?>>();
}
