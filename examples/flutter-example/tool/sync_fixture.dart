import 'dart:io';

void main() {
  final exampleDirectory = File.fromUri(Platform.script).parent.parent;
  final repository = _findRepository(exampleDirectory);
  final fixtures = <String, String>{
    'protocol/fixtures/v0.2/complete-paywall.json': 'complete-paywall.json',
    'protocol/fixtures/configuration-delivery/v1/valid-release.json':
        'configuration-release.json',
    'protocol/fixtures/configuration-delivery/v2/advanced-release.json':
        'advanced-configuration-release.json',
  };
  for (final entry in fixtures.entries) {
    final source = File('${repository.path}/${entry.key}');
    final target = File(
      '${exampleDirectory.path}/assets/generated/${entry.value}',
    );
    target.parent.createSync(recursive: true);
    final sourceBytes = source.readAsBytesSync();
    if (!target.existsSync() ||
        !_sameBytes(target.readAsBytesSync(), sourceBytes)) {
      target.writeAsBytesSync(sourceBytes, flush: true);
    }
    stdout.writeln('Synced ${source.path} -> ${target.path}');
  }
}

Directory _findRepository(Directory start) {
  var directory = start.absolute;
  while (true) {
    final paywall = File(
      '${directory.path}/protocol/fixtures/v0.2/complete-paywall.json',
    );
    final release = File(
      '${directory.path}/protocol/fixtures/configuration-delivery/v1/valid-release.json',
    );
    if (paywall.existsSync() && release.existsSync()) {
      return directory;
    }
    final parent = directory.parent;
    if (parent.path == directory.path) {
      stderr.writeln(
        'Cannot locate canonical Protocol and Delivery fixtures from '
        '${start.path}. Run this example inside the Mosaic checkout.',
      );
      exitCode = 1;
      throw StateError('Canonical Mosaic fixture not found.');
    }
    directory = parent;
  }
}

bool _sameBytes(List<int> left, List<int> right) {
  if (left.length != right.length) {
    return false;
  }
  for (var index = 0; index < left.length; index += 1) {
    if (left[index] != right[index]) {
      return false;
    }
  }
  return true;
}
