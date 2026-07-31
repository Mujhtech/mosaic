import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

File canonicalFixtureFile() {
  return repositoryFile('protocol/fixtures/v0.2/complete-paywall.json');
}

File repositoryFile(String relativePath) {
  var directory = Directory.current.absolute;
  while (true) {
    final candidate = File('${directory.path}/$relativePath');
    if (candidate.existsSync()) {
      return candidate;
    }
    final parent = directory.parent;
    if (parent.path == directory.path) {
      fail(
        'Cannot locate $relativePath from '
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
  Map<String, Object?>? result;
  for (final screen
      in (document['screens']! as List<Object?>).cast<Map<String, Object?>>()) {
    result = _findNode(screen['layout']! as Map<String, Object?>, type);
    if (result != null) break;
  }
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
  if (node.containsKey('children')) {
    for (final value in node['children']! as List<Object?>) {
      final result = _findNode(value! as Map<String, Object?>, type);
      if (result != null) {
        return result;
      }
    }
  }
  return null;
}
