import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

File canonicalFixtureFile() {
  var directory = Directory.current.absolute;
  while (true) {
    final candidate = File(
      '${directory.path}/protocol/fixtures/v0.1/complete-paywall.json',
    );
    if (candidate.existsSync()) {
      return candidate;
    }
    final parent = directory.parent;
    if (parent.path == directory.path) {
      fail(
        'Cannot locate protocol/fixtures/v0.1/complete-paywall.json from '
        '${Directory.current.path}. Run tests inside the Mosaic checkout.',
      );
    }
    directory = parent;
  }
}

String canonicalFixtureSource() => canonicalFixtureFile().readAsStringSync();

Map<String, Object?> canonicalFixtureObject() =>
    jsonDecode(canonicalFixtureSource()) as Map<String, Object?>;

MosaicPaywallDocument decodeCanonicalFixture() =>
    const MosaicProtocolDecoder().decode(canonicalFixtureSource());

Map<String, Object?> findNode(
  Map<String, Object?> document,
  String type,
) {
  final layout = document['layout']! as Map<String, Object?>;
  final result = _findNode(layout, type);
  if (result == null) {
    fail('Canonical fixture has no $type node.');
  }
  return result;
}

Map<String, Object?>? _findNode(Map<String, Object?> node, String type) {
  if (node['type'] == type) {
    return node;
  }
  if (node['type'] == 'scrollContainer') {
    return _findNode(node['content']! as Map<String, Object?>, type);
  }
  if (node['type'] == 'verticalStack') {
    for (final value in node['children']! as List<Object?>) {
      final result = _findNode(value! as Map<String, Object?>, type);
      if (result != null) {
        return result;
      }
    }
  }
  return null;
}
