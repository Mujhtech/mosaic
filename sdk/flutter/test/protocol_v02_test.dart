import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

void main() {
  final root = Directory.current.parent.parent;

  String fixture(String name) => File(
        '${root.path}/protocol/fixtures/v0.2/$name',
      ).readAsStringSync();

  test('strictly decodes every canonical valid Protocol 0.2 fixture', () {
    for (final name in <String>[
      'complete-paywall.json',
      'migrated-v0.1.json',
      'edge-cases.json',
      'expired-countdown.json',
      'hidden-purchase-target.json',
    ]) {
      final document = const MosaicProtocolDecoder().decode(fixture(name));
      expect(document.schemaVersion, mosaicProtocolV02Version, reason: name);
      expect(document.layout.content, isA<MosaicStackComponent>());
    }
  });

  test('rejects the canonical noncanonical literal color', () {
    expect(
      () => const MosaicProtocolDecoder().decode(
        fixture('invalid/noncanonical-color.json'),
      ),
      throwsA(isA<MosaicProtocolException>()),
    );
  });

  test('migration fixture preserves the 0.1 document identity and node IDs',
      () {
    final v01 = const MosaicProtocolDecoder().decode(
      File('${root.path}/protocol/fixtures/v0.1/complete-paywall.json')
          .readAsStringSync(),
    );
    final migrated = const MosaicProtocolDecoder().decode(
      fixture('migrated-v0.1.json'),
    );

    expect(migrated.id, v01.id);
    expect(migrated.revision, v01.revision);
    expect(
      migrated.nodes.map((node) => node.id).toSet(),
      v01.nodes.map((node) => node.id).toSet(),
    );
    expect(v01.layout.content, isA<MosaicVerticalStack>());
    expect(migrated.layout.content, isA<MosaicStackComponent>());
  });

  test('0.2 reader rejects unknown fields and unknown components atomically',
      () {
    final source =
        jsonDecode(fixture('complete-paywall.json'))! as Map<String, Object?>;
    final withUnknownField = Map<String, Object?>.from(source)
      ..['flutterOnly'] = true;
    expect(
      () => const MosaicProtocolDecoder().decode(jsonEncode(withUnknownField)),
      throwsA(isA<MosaicProtocolException>()),
    );

    final withUnknownComponent =
        jsonDecode(fixture('complete-paywall.json'))! as Map<String, Object?>;
    final layout = withUnknownComponent['layout']! as Map<String, Object?>;
    final rootStack = layout['content']! as Map<String, Object?>;
    final children = rootStack['children']! as List<Object?>;
    final first = children.first! as Map<String, Object?>;
    children[0] = <String, Object?>{...first, 'type': 'flutterWidget'};
    expect(
      () => const MosaicProtocolDecoder()
          .decode(jsonEncode(withUnknownComponent)),
      throwsA(isA<MosaicProtocolException>()),
    );
  });

  test('bundled fallback safely replaces a rejected 0.2 candidate', () async {
    final result = await const MosaicPaywallLoader().load(
      candidateDocument: fixture('invalid/noncanonical-color.json'),
      bundledFallbackLoader: () async => fixture('complete-paywall.json'),
    );

    expect(result, isA<MosaicPaywallLoaded>());
    expect((result as MosaicPaywallLoaded).document.schemaVersion, '0.2');
    expect(result.source, MosaicPaywallDocumentSource.bundledFallback);
  });

  test('capability report is exact for strict dual-version support', () {
    final document = const MosaicProtocolDecoder().decode(
      fixture('complete-paywall.json'),
    );
    expect(
      mosaicFlutterCapabilityReport.supportedSchemaVersions,
      <String>{'0.1', '0.2'},
    );
    expect(
      mosaicProtocolV02Capabilities,
      document.compatibility.requiredCapabilities
          .map((capability) => capability.name)
          .toSet(),
    );
    expect(
      document.compatibility.requiredCapabilities
          .map((capability) => capability.version),
      everyElement('0.2'),
    );
  });
}
