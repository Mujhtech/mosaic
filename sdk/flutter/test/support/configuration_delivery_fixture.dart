import 'dart:io';

File deliveryFixture(String relativePath) {
  var directory = Directory.current.absolute;
  while (true) {
    final candidate = File(
      '${directory.path}/protocol/fixtures/configuration-delivery/v3/'
      '$relativePath',
    );
    if (candidate.existsSync()) return candidate;
    final parent = directory.parent;
    if (parent.path == directory.path) {
      throw StateError('Cannot locate Configuration Delivery fixtures.');
    }
    directory = parent;
  }
}

String deliveryFixtureSource([String name = 'rich-release.json']) =>
    deliveryFixture(name).readAsStringSync();
