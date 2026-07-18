import 'dart:io';

void main() {
  final exampleDirectory = File.fromUri(Platform.script).parent.parent;
  final source = _findCanonicalFixture(exampleDirectory);
  final target = File(
    '${exampleDirectory.path}/assets/generated/complete-paywall.json',
  );
  target.parent.createSync(recursive: true);

  final sourceBytes = source.readAsBytesSync();
  if (!target.existsSync() ||
      !_sameBytes(target.readAsBytesSync(), sourceBytes)) {
    target.writeAsBytesSync(sourceBytes, flush: true);
  }
  stdout.writeln('Synced ${source.path} -> ${target.path}');
}

File _findCanonicalFixture(Directory start) {
  var directory = start.absolute;
  while (true) {
    final candidate = File(
      '${directory.path}/protocol/fixtures/v0.2/complete-paywall.json',
    );
    if (candidate.existsSync()) {
      return candidate;
    }
    final parent = directory.parent;
    if (parent.path == directory.path) {
      stderr.writeln(
        'Cannot locate protocol/fixtures/v0.2/complete-paywall.json from '
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
